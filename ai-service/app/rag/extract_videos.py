"""Extraction automatique du lien vidéo depuis les articles de fact-check.

POURQUOI : les fact-checks du RAG portent l'URL de l'ARTICLE, pas la vidéo. La
vidéo débunkée est embarquée DANS l'article (iframe YouTube, tweet, TikTok...).
Ce script la retrouve par motif d'URL -> il pré-remplit la colonne `video_url` de
la table Claim ; il ne reste qu'à valider et ajouter le timestamp.

LIMITE : ça donne des CANDIDATS (un article peut référencer plusieurs vidéos). On
propose la plus fréquente (souvent la débunkée) + les autres. Le timestamp (?t=)
reste manuel.

Sortie : ai-service/data/video_candidates.tsv (+ résumé à l'écran).
Lancer :  docker compose exec ai-service python -m app.rag.extract_videos
Nombre réglable via RAG_EXTRACT_LIMIT (défaut 20).
"""
import os
import re
from collections import Counter
from pathlib import Path

import httpx

from app.db import connect

# UA de navigateur (les sites de presse bloquent les bots).
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}
OUT_FILE = Path(__file__).resolve().parents[2] / "data" / "video_candidates.tsv"
LIMIT = int(os.getenv("RAG_EXTRACT_LIMIT", "20"))

# Motifs de VRAIES vidéos (une vidéo précise, pas une chaîne ni un bouton de partage).
VIDEO_RE = re.compile(
    r"https?://(?:www\.)?(?:"
    r"youtube\.com/(?:watch\?v=|embed/|shorts/)[\w-]{6,}"
    r"|youtu\.be/[\w-]{6,}"
    r"|(?:twitter|x)\.com/\w+/status/\d+"
    r"|tiktok\.com/@[\w.]+/video/\d+"
    r"|fb\.watch/\w+"
    r"|facebook\.com/[\w.]+/videos/\d+"
    r"|instagram\.com/(?:reel|p|tv)/[\w-]+"
    r"|dailymotion\.com/video/\w+"
    r")",
    re.I,
)


def _fetch(client: httpx.Client, url: str) -> str:
    """Récupère le HTML de l'article ; bascule sur l'archive si le site bloque."""
    for target in (url, "https://web.archive.org/web/2id_/" + url):
        try:
            r = client.get(target, timeout=40)
            if r.status_code == 200 and len(r.text) > 3000:
                return r.text
        except httpx.HTTPError:
            continue
    return ""


def _videos(html: str):
    """(meilleur candidat, autres) : la vidéo la plus fréquente d'abord — c'est
    en général la débunkée (embarquée + citée plusieurs fois)."""
    matches = VIDEO_RE.findall(html)
    if not matches:
        return None, []
    ranked = [u for u, _ in Counter(matches).most_common()]
    return ranked[0], ranked[1:4]


def _rows(limit: int):
    with connect() as conn, conn.cursor() as cur:
        # Les % littéraux du LIKE sont doublés (%%) car la requête a un paramètre
        # (%s) : sinon psycopg prend « %v » de %vidéo% pour un placeholder.
        cur.execute(
            "SELECT url, content FROM documents "
            "WHERE source = 'factcheck' AND content ILIKE '%%vidéo%%' "
            "ORDER BY random() LIMIT %s",
            (limit,),
        )
        return cur.fetchall()


def _claim(content: str) -> str:
    m = re.search(r"Affirmation : « (.*?) »", content)
    return (m.group(1) if m else content)[:110]


def main() -> None:
    rows = _rows(LIMIT)
    print(f"{len(rows)} fact-checks vidéo à traiter...\n")
    results = []
    with httpx.Client(headers=HEADERS, follow_redirects=True) as client:
        for i, (url, content) in enumerate(rows, 1):
            html = _fetch(client, url)
            best, others = _videos(html) if html else (None, [])
            results.append((_claim(content), url, best, others))
            etat = best or ("(article injoignable)" if not html else "(aucune vidéo trouvée)")
            print(f"  {i:2}. {etat}")

    OUT_FILE.write_text(
        "claim\tarticle_url\tvideo_url\tautres_candidats\n"
        + "\n".join(f"{c}\t{a}\t{b or ''}\t{'; '.join(o)}" for c, a, b, o in results),
        encoding="utf-8",
    )
    trouves = sum(1 for _, _, b, _ in results if b)
    print(f"\n{trouves}/{len(results)} vidéos trouvées. Détails -> {OUT_FILE}")


if __name__ == "__main__":
    main()
