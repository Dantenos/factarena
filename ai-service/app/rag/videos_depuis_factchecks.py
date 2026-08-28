"""Retrouve la publication d'origine débunkée par un article de fact-check.

Le corpus contient près de mille vérifications de contenus viraux, mais sans
vidéo jouable : seule l'adresse de l'article était enregistrée. Or ces articles
citent presque toujours la publication qu'ils analysent. On la récupère donc
pour l'embarquer dans le jeu, et le verdict reste celui du fact-checker — c'est
la condition pour que la clé de réponse soit sourcée et non pas décidée par nous.

Deux plateformes seulement :

- Facebook, via plugins/video.php. C'est le produit d'embarquement officiel,
  une iframe pure, donc aucun script étranger dans notre page.
- YouTube, via /embed/, pour les mêmes raisons.

TikTok et X sont écartés volontairement : leur intégration passe par un script
à charger chez nous, et la moindre erreur de leur code deviendrait une erreur
sous notre domaine — le sujet l'interdit.

L'AFP renvoie une erreur aux requêtes automatisées ; ses articles sont donc
ignorés, sans que ce soit un problème puisque les autres médias couvrent le
même type de contenu.

Lancer :
    docker compose exec ai-service python -m app.rag.videos_depuis_factchecks
"""
import re
import time
from urllib.parse import quote, urlparse

import httpx

from app.db import connect

# Un navigateur ordinaire : plusieurs sites renvoient une page vide à un
# client qui ne se présente pas, et on lit ici des articles publics.
ENTETES = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9",
}

# Médias qui acceptent une lecture automatisée (mesuré, pas supposé).
DOMAINES = ["tf1info.fr", "20minutes.fr", "franceinfo.fr", "defacto-observatoire.fr", "rtbf.be"]

# UNIQUEMENT /videos/. Le lecteur plugins/video.php ne sait afficher que des
# vidéos : sur une publication ordinaire il rend un cadre « Video Unavailable ».
# Accepter /posts/ paraissait logique — beaucoup de vidéos y sont publiées — mais
# rien dans l'URL ne dit si le post en contient une, et l'erreur ne se voyait
# qu'en pleine manche.
POST_FACEBOOK = re.compile(r'https?://(?:www\.|web\.|m\.)?facebook\.com/[^"\'<>\s\\]+?/videos/[0-9A-Za-z._-]+')
EMBED_YOUTUBE = re.compile(r'https?://(?:www\.)?youtube(?:-nocookie)?\.com/embed/([A-Za-z0-9_-]{11})')
WATCH_YOUTUBE = re.compile(r'https?://(?:www\.)?youtube\.com/watch\?v=([A-Za-z0-9_-]{11})')

# Une page d'article contient aussi les liens de partage vers les réseaux
# sociaux du média lui-même. Les prendre pour la publication débunkée
# donnerait un clip qui n'a rien à voir avec l'affirmation.
COMPTES_MEDIAS = re.compile(r'facebook\.com/(?:TF1|LCI|20minutes|franceinfo|rtbf|sharer|dialog)', re.I)


def _embed_facebook(url_post: str) -> str:
    """URL d'embarquement officielle. show_text=false masque la légende, qui
    peut contenir le démenti et vendre la réponse avant le vote."""
    return ("https://www.facebook.com/plugins/video.php?href=" + quote(url_post, safe="")
            + "&show_text=false&width=560")


def _extraire(html: str) -> str | None:
    for brut in POST_FACEBOOK.findall(html):
        # On nettoie les échappements laissés par le JSON embarqué dans la page.
        url = brut.replace("\\/", "/").rstrip('\\"\'')
        if COMPTES_MEDIAS.search(url):
            continue
        return _embed_facebook(url)
    for motif in (EMBED_YOUTUBE, WATCH_YOUTUBE):
        trouve = motif.search(html)
        if trouve:
            return f"https://www.youtube-nocookie.com/embed/{trouve.group(1)}"
    return None


def main(limite: int = 400) -> None:
    condition = " OR ".join(['"sourceUrl" LIKE %s'] * len(DOMAINES))
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            f'SELECT id, "sourceUrl", "truthLabel", text FROM "Claim" '
            f'WHERE "mediaRef" IS NULL AND ({condition}) LIMIT {limite}',
            tuple(f"%{d}%" for d in DOMAINES),
        )
        candidats = cur.fetchall()

    print(f"{len(candidats)} article(s) à examiner.\n")
    trouves, echecs = [], 0
    for claim_id, url, label, texte in candidats:
        try:
            r = httpx.get(url, headers=ENTETES, timeout=30, follow_redirects=True)
            html = r.text if r.status_code == 200 else ""
        except Exception:
            html = ""
        if not html:
            echecs += 1
        else:
            media = _extraire(html)
            if media:
                trouves.append((media, claim_id))
                plateforme = "facebook" if "facebook" in media else "youtube"
                print(f"  [{label:5s}|{plateforme:8s}] {texte[:62]}")
        # On lit des articles un par un, sans charger le serveur du média.
        time.sleep(1.5)

    if trouves:
        with connect() as conn, conn.cursor() as cur:
            cur.executemany('UPDATE "Claim" SET "mediaRef" = %s WHERE id = %s', trouves)
            conn.commit()

    print(f"\n{len(trouves)} vidéo(s) rattachée(s), {echecs} article(s) inaccessible(s).")


if __name__ == "__main__":
    main()
