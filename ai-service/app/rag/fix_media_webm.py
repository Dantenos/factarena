"""Remplace les vidéos Wikimedia en .ogv par leur transcodage WebM.

POURQUOI C'EST INDISPENSABLE : Chrome a retiré la prise en charge du codec
Theora (celui des fichiers .ogv) à partir de la version 123. Une balise <video>
pointant vers un .ogv n'affiche donc plus rien du tout dans le navigateur de
correction — et le sujet interdit par ailleurs la moindre erreur en console.
Or beaucoup de fichiers Wikimedia, surtout les archives historiques, ne sont
disponibles qu'en .ogv à l'origine.

LA SOLUTION : Commons génère automatiquement des versions WebM (VP9) de chaque
vidéo, exposées par l'API sous le nom de « derivatives ». On garde donc la même
vidéo, la même source, la même licence — on change juste le fichier servi au
navigateur pour un format que Chrome et Firefox lisent tous les deux.

On en profite pour retirer les paramètres de suivi (utm_source) que l'API
ajoute parfois aux URL : inutiles, et on évite d'envoyer au navigateur des
paramètres qui n'ont rien à faire dans une balise <video>.

Lancer :
    docker compose exec ai-service python -m app.rag.fix_media_webm
"""
import time

import httpx

from app.db import connect

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
UA = "FactArena-42-project/0.1 (educational; contact via 42 school)"

# Du plus confortable au plus léger. On ne monte pas au-delà de 720p : la vidéo
# occupe une colonne de la page, et un fichier plus lourd ralentirait le
# démarrage de la manche pour tous les joueurs en même temps.
PREFERENCES = ["720p.vp9.webm", "480p.vp9.webm", "360p.vp9.webm", "240p.vp9.webm",
               "720p.webm", "480p.webm", "360p.webm", "240p.webm"]


def _titre_depuis_url(url: str) -> str | None:
    """Retrouve le nom du fichier Commons à partir de l'URL de la vidéo."""
    nu = url.split("?")[0]
    if "/transcoded/" in nu:
        # Déjà transcodé : le nom d'origine est l'avant-dernier segment.
        return nu.split("/")[-2]
    if "upload.wikimedia.org" not in nu:
        return None
    return nu.split("/")[-1]


def _meilleur_webm(titre: str) -> str | None:
    for essai in range(4):
        try:
            r = httpx.get(COMMONS_API, params={
                "action": "query", "format": "json", "titles": f"File:{titre}",
                "prop": "videoinfo", "viprop": "derivatives",
            }, headers={"User-Agent": UA}, timeout=40)
            if r.status_code != 200:
                time.sleep(4)
                continue
            for page in r.json().get("query", {}).get("pages", {}).values():
                infos = (page.get("videoinfo") or [{}])[0]
                derives = {d.get("transcodekey"): d.get("src")
                           for d in (infos.get("derivatives") or []) if d.get("src")}
                for cle in PREFERENCES:
                    if derives.get(cle):
                        return derives[cle].split("?")[0]
            return None
        except Exception:
            time.sleep(4)
    return None


def main() -> None:
    with connect() as conn, conn.cursor() as cur:
        # Les URL renvoyées par l'API traînent un « ?utm_source=... » : on les
        # nettoie d'abord, une balise <video> n'a que faire de ces paramètres.
        cur.execute(
            'UPDATE "Claim" SET "mediaRef" = split_part("mediaRef", \'?\', 1) '
            'WHERE "mediaRef" LIKE %s AND "mediaRef" LIKE %s',
            ("%upload.wikimedia.org%", "%?%"),
        )
        conn.commit()
        # On ne touche ensuite qu'aux fichiers que Chrome ne sait plus lire.
        # Le motif est encadré de « % » des deux côtés : selon la source, l'URL
        # peut encore se terminer par autre chose que l'extension.
        cur.execute(
            'SELECT id, "mediaRef" FROM "Claim" '
            'WHERE "mediaRef" LIKE %s AND (lower("mediaRef") LIKE %s OR lower("mediaRef") LIKE %s)',
            ("%upload.wikimedia.org%", "%.ogv%", "%.ogg%"),
        )
        a_reparer = cur.fetchall()

    print(f"{len(a_reparer)} vidéo(s) en Theora à remplacer.\n")
    corrections, echecs = [], []
    # Un cache par fichier : plusieurs claims peuvent partager la même vidéo,
    # inutile d'interroger l'API deux fois pour le même titre.
    cache: dict[str, str | None] = {}

    for claim_id, media in a_reparer:
        titre = _titre_depuis_url(media)
        if not titre:
            echecs.append(media)
            continue
        if titre not in cache:
            cache[titre] = _meilleur_webm(titre)
            time.sleep(1.2)
        webm = cache[titre]
        if webm:
            corrections.append((webm, claim_id))
        else:
            echecs.append(titre)

    if corrections:
        with connect() as conn, conn.cursor() as cur:
            cur.executemany('UPDATE "Claim" SET "mediaRef" = %s WHERE id = %s', corrections)
            conn.commit()

    print(f"{len(corrections)} vidéo(s) basculée(s) en WebM.")
    if echecs:
        # Sans transcodage WebM, la vidéo est inutilisable en jeu : on le dit
        # clairement plutôt que de laisser une claim silencieusement cassée.
        print(f"{len(echecs)} sans transcodage WebM (claims à écarter) :")
        for e in dict.fromkeys(echecs):
            print(f"  - {e[:90]}")


if __name__ == "__main__":
    main()
