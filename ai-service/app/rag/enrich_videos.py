"""Associe une vidéo embarquable à chaque claim du jeu.

POURQUOI ce script en plus de extract_videos.py : celui-ci travaillait sur le
corpus RAG et produisait un TSV de CANDIDATS à relire. Ici on part des claims
réellement en base, on récupère la vidéo dans leur article de fact-check, et on
renseigne directement `Claim.mediaRef` sous une forme DIRECTEMENT EMBARQUABLE.

POURQUOI SEULEMENT YOUTUBE : décision d'équipe sur la console. Un embed YouTube
est une iframe pure — le bruit qu'il génère est attribué aux domaines Google,
jamais au nôtre. X, Instagram et TikTok imposent au contraire de charger LEUR
script dans notre page : une erreur de leur code deviendrait une erreur « à
nous », donc éliminatoire au regard du sujet. On ignore donc ces plateformes,
quitte à avoir moins de vidéos.

On utilise le domaine youtube-nocookie.com (mode « privacy-enhanced ») : moins
de traceurs, et c'est plus simple à justifier dans la politique de
confidentialité.

⚠️ FRONTIÈRE : ce script écrit dans la table Claim, qui appartient à Prisma
(Back Core). C'est un dépannage pour amorcer le contenu. La solution durable est
que l'importeur de claims transporte lui-même `mediaRef` — à voir avec le
Back Core.

Lancer :
    docker compose exec ai-service python -m app.rag.enrich_videos
"""
import os
import re
from urllib.parse import quote

import httpx

from app.db import connect

# Même motif que extract_videos.py, restreint aux formes YouTube : ce sont les
# seules que l'on sait embarquer sans charger de script tiers.
YOUTUBE_RE = re.compile(
    r"https?://(?:www\.)?(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([\w-]{6,})",
    re.I,
)

# Facebook s'embarque lui aussi dans une IFRAME PURE, via plugins/video.php :
# aucun script tiers ne tourne dans notre page, donc même garantie que YouTube
# vis-à-vis de la console. C'est la seule autre plateforme qu'on s'autorise.
# AFP et TF1 renvoient beaucoup vers Facebook, d'où l'intérêt de la couvrir.
FACEBOOK_RE = re.compile(
    r"https?://(?:www\.)?(?:facebook\.com/[\w.]+/videos/\d+|fb\.watch/[\w-]+)",
    re.I,
)

LIMITE = int(os.getenv("VIDEO_ENRICH_LIMIT", "40"))
ENTETES = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120 Safari/537.36",
}


def _html(client: httpx.Client, url: str) -> str:
    """HTML de l'article ; bascule sur l'archive si le site refuse le robot."""
    for cible in (url, "https://web.archive.org/web/2id_/" + url):
        try:
            r = client.get(cible, headers=ENTETES, timeout=25, follow_redirects=True)
            if r.status_code == 200 and len(r.text) > 500:
                return r.text
        except Exception:
            continue
    return ""


def _embed(html: str) -> str | None:
    """Vidéo la PLUS FRÉQUENTE de la page -> URL embarquable, ou None.

    Le plus fréquent est presque toujours la vidéo débunkée : elle apparaît dans
    le lecteur, dans les partages et souvent dans les métadonnées, là où une
    vidéo « suggérée » n'apparaît qu'une fois.

    YouTube d'abord (on sait vérifier qu'il accepte l'intégration), Facebook
    ensuite.
    """
    ids = YOUTUBE_RE.findall(html)
    if ids:
        meilleur = max(set(ids), key=ids.count)
        return f"https://www.youtube-nocookie.com/embed/{meilleur}"

    liens = FACEBOOK_RE.findall(html)
    if liens:
        meilleur = max(set(liens), key=liens.count)
        # Le plugin attend l'URL de la vidéo ENCODÉE en paramètre `href`.
        # show_text=false masque la légende du post, inutile ici.
        return (
            "https://www.facebook.com/plugins/video.php?href="
            + quote(meilleur, safe="")
            + "&show_text=false"
        )
    return None


def _integrable(client: httpx.Client, video_id: str) -> bool:
    """La vidéo accepte-t-elle d'être lue sur un autre site ?

    Beaucoup de vidéos interdisent l'intégration : le lecteur affiche alors
    « Playback on other websites has been disabled by the video owner », ce qui
    donne un clip injouable au milieu d'une manche.

    L'API YouTube Data exposerait un champ `embeddable`, mais elle n'est pas
    activée sur notre clé (403). On se rabat sur l'endpoint oEmbed public, qui
    ne demande aucune clé : vérifié à la main, il renvoie 200 pour une vidéo
    intégrable et 401 pour celle qui refusait de se lire chez nous.
    """
    try:
        r = client.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            timeout=20,
        )
        return r.status_code == 200
    except Exception:
        # En cas de doute (réseau), on refuse : mieux vaut une claim sans vidéo
        # qu'un lecteur mort pendant une partie.
        return False


def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT id, "sourceUrl" FROM "Claim" '
            'WHERE "mediaRef" IS NULL AND "sourceUrl" IS NOT NULL LIMIT %s',
            (LIMITE,),
        )
        claims = cur.fetchall()

    if not claims:
        print("Aucune claim à enrichir (toutes ont déjà une vidéo).")
        return

    print(f"{len(claims)} claims à traiter...")
    trouves: list[tuple[str, str]] = []
    with httpx.Client() as client:
        for claim_id, url in claims:
            embed = _embed(_html(client, url))
            if not embed:
                print(f"  rien {url[:64]}")
                continue
            # La vérification oEmbed ne vaut que pour YouTube : Facebook n'expose
            # plus d'endpoint public équivalent (il exige un jeton d'application).
            # On accepte donc ses vidéos sans pré-contrôle — le plugin fonctionne
            # pour les publications publiques, ce que sont les vidéos débunkées.
            if "youtube-nocookie" in embed:
                video_id = embed.rsplit("/", 1)[-1]
                if not _integrable(client, video_id):
                    print(f"  NON  {video_id} refuse l'intégration -> ignorée")
                    continue
                print(f"  OK   youtube {video_id}  <- {url[:52]}")
            else:
                print(f"  OK   facebook          <- {url[:52]}")
            trouves.append((embed, claim_id))

    if not trouves:
        print("\nAucune vidéo YouTube embarquable trouvée.")
        return

    with connect() as conn, conn.cursor() as cur:
        cur.executemany('UPDATE "Claim" SET "mediaRef" = %s WHERE id = %s', trouves)
        conn.commit()

    print(f"\n{len(trouves)} claims enrichies sur {len(claims)} examinées.")


if __name__ == "__main__":
    main()
