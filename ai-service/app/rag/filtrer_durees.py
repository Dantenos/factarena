"""Écarte du tirage les clips trop longs pour une manche.

Une manche enchaîne dix clips. Au-delà de deux minutes quarante-deux par clip,
soit le joueur ne regarde pas jusqu'au bout et juge sur les premières secondes,
soit la manche s'éternise et le chat décroche. Mieux vaut perdre une vidéo que
casser le rythme.

Comment on obtient la durée, selon l'hébergeur :

- Wikimedia : l'API la donne directement dans imageinfo.
- YouTube : elle n'apparaît pas dans la page d'embed, mais la page de
  visionnage contient « lengthSeconds ». On va donc la chercher là.
- Facebook : aucun moyen fiable sans authentification. Ces clips sont laissés
  en place et comptés à part — on ne va pas les écarter sur une supposition.

On vide mediaRef sans rien supprimer, comme partout ailleurs : le texte et la
source restent utiles au moteur de recherche.

Lancer :
    docker compose exec ai-service python -m app.rag.filtrer_durees
    docker compose exec ai-service python -m app.rag.filtrer_durees --max 200
"""
import argparse
import re
import time
from urllib.parse import unquote

import httpx

from app.db import connect

NAVIGATEUR = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
COMMONS_API = "https://commons.wikimedia.org/w/api.php"


def _titre_commons(url: str) -> str | None:
    nu = unquote(url.split("?")[0])
    if "/transcoded/" in nu:
        # Un transcodage garde le nom d'origine en avant-dernier segment.
        return nu.split("/")[-2]
    if "upload.wikimedia.org" not in nu:
        return None
    return nu.split("/")[-1]


def _duree_commons(titre: str) -> float | None:
    for _essai in range(3):
        try:
            r = httpx.get(COMMONS_API, params={
                "action": "query", "format": "json", "titles": f"File:{titre}",
                "prop": "imageinfo", "iiprop": "size",
            }, headers=NAVIGATEUR, timeout=30)
            if r.status_code == 200:
                for p in r.json().get("query", {}).get("pages", {}).values():
                    info = (p.get("imageinfo") or [{}])[0]
                    if info.get("duration") is not None:
                        return float(info["duration"])
                return None
        except Exception:
            pass
        time.sleep(3)
    return None


def _duree_youtube(video_id: str) -> float | None:
    for _essai in range(3):
        try:
            r = httpx.get(f"https://www.youtube.com/watch?v={video_id}",
                          headers=NAVIGATEUR, timeout=30, follow_redirects=True)
            if r.status_code == 200:
                trouve = re.search(r'"lengthSeconds":\\?"(\d+)', r.text)
                if trouve:
                    return float(trouve.group(1))
                return None
        except Exception:
            pass
        time.sleep(3)
    return None


def main() -> None:
    parseur = argparse.ArgumentParser(description="Écarte les clips trop longs")
    parseur.add_argument("--max", type=int, default=162,
                         help="durée maximale en secondes (défaut 162, soit 2 min 42)")
    options = parseur.parse_args()

    with connect() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id, text, "mediaRef" FROM "Claim"
                       WHERE "mediaRef" LIKE '%upload.wikimedia%'
                          OR "mediaRef" LIKE '%/embed/%'
                          OR "mediaRef" LIKE '%plugins/video.php%'""")
        clips = cur.fetchall()

    print(f"{len(clips)} clip(s) à mesurer (seuil {options.max} s).\n")
    trop_longs, inconnus, facebook = [], 0, 0
    cache: dict[str, float | None] = {}

    for claim_id, texte, media in clips:
        duree = None
        if "facebook.com/plugins" in media:
            facebook += 1
            continue
        if "upload.wikimedia" in media:
            titre = _titre_commons(media)
            if titre:
                if titre not in cache:
                    cache[titre] = _duree_commons(titre)
                    time.sleep(1)
                duree = cache[titre]
        else:
            trouve = re.search(r"/embed/([A-Za-z0-9_-]{11})", media)
            if trouve:
                vid = trouve.group(1)
                if vid not in cache:
                    cache[vid] = _duree_youtube(vid)
                    time.sleep(1.5)
                duree = cache[vid]

        if duree is None:
            inconnus += 1
            continue
        if duree > options.max:
            minutes, secondes = divmod(int(duree), 60)
            print(f"  {minutes}:{secondes:02d}  {texte[:72]}")
            trop_longs.append((claim_id,))

    if trop_longs:
        with connect() as conn, conn.cursor() as cur:
            cur.executemany('UPDATE "Claim" SET "mediaRef" = NULL WHERE id = %s', trop_longs)
            conn.commit()

    print(f"\n{len(trop_longs)} clip(s) écarté(s) pour dépassement.")
    print(f"{facebook} clip(s) Facebook non mesurables, laissés en place.")
    print(f"{inconnus} durée(s) indéterminée(s), laissées en place.")


if __name__ == "__main__":
    main()
