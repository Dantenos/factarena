"""Ingestion du TEXTE des articles qui ont établi le verdict des clips jouables.

POURQUOI : à la révélation, le RAG répondait « aucun passage ne mentionne cette
vidéo » sur près d'un clip sur deux. Le corpus contenait pourtant l'article — mais
seulement sous forme de fiche ClaimReview (l'affirmation et sa notation, ~330
caractères), pas le raisonnement. Impossible d'expliquer quoi que ce soit avec ça.

Ici on récupère le CORPS des articles pointés par `Claim.sourceUrl`, chunké comme
le reste du corpus. C'est l'évolution annoncée dans l'en-tête de ingest_factcheck :
plutôt qu'une liste d'URLs entretenue à la main, on ingère exactement les articles
dont le jeu a besoin.

On les range sous `source='factcheck_article'` et non 'factcheck' : les fiches
ClaimReview restent utiles pour les questions générales, et séparer les deux permet
de relancer l'un sans écraser l'autre.

Reprenable : saute les URLs déjà ingérées. Lancer :
    docker compose exec ai-service python -m app.rag.ingest_articles_sources
"""
import asyncio
from urllib.parse import urlparse

import httpx

from app.db import connect, ensure_schema, to_pgvector
from app.mistral_client import embed
from app.rag.chunking import chunk_text
from app.rag.ingest_factcheck import _ArticleText, _fetch

SOURCE = "factcheck_article"
BATCH = 50

# Ces domaines hébergent la vidéo, ils n'expliquent rien : les télécharger
# ramènerait une page de métadonnées de fichier, pas un article.
HOTES_MEDIA = {
    "commons.wikimedia.org",
    "upload.wikimedia.org",
    "youtube.com",
    "youtu.be",
    "facebook.com",
    "twitter.com",
    "x.com",
}


def _via_archive(url: str) -> str:
    """Snapshot web.archive.org : l'AFP bloque les robots, son archive non."""
    return f"https://web.archive.org/web/2024/{url}"


def _hote(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").removeprefix("www.")
    except ValueError:
        return ""


def _urls_a_ingerer() -> list[str]:
    """Articles sources des clips jouables, moins ceux déjà en base."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT DISTINCT "sourceUrl" FROM public."Claim" '
            'WHERE "sourceUrl" IS NOT NULL AND "mediaRef" IS NOT NULL'
        )
        candidates = [row[0] for row in cur.fetchall()]
        cur.execute("SELECT DISTINCT url FROM documents WHERE source = %s", (SOURCE,))
        deja = {row[0] for row in cur.fetchall()}

    return [u for u in candidates if _hote(u) not in HOTES_MEDIA and u not in deja]


async def _ecrire(rows: list[dict], conn) -> None:
    if not rows:
        return
    vecteurs = await embed([r["content"] for r in rows])
    with conn.cursor() as cur:
        for r, vec in zip(rows, vecteurs):
            cur.execute(
                "INSERT INTO documents (source, title, url, content, chunk_index, embedding) "
                "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                (SOURCE, r["title"], r["url"], r["content"], r["chunk_index"], to_pgvector(vec)),
            )
    conn.commit()


async def ingest() -> None:
    ensure_schema()
    urls = _urls_a_ingerer()
    if not urls:
        print("Rien à ingérer : tous les articles sources sont déjà en base.")
        return
    print(f"{len(urls)} article(s) à récupérer...")

    tampon: list[dict] = []
    reussis = echecs = 0
    with connect() as conn, httpx.Client() as client:
        for i, url in enumerate(urls, 1):
            html = _fetch(client, url)
            if not html:
                # Repli sur l'archive, qui sert de toute façon de trace datée.
                html = _fetch(client, _via_archive(url))
            if not html:
                echecs += 1
                print(f"  {i}/{len(urls)} échec réseau : {_hote(url)}")
                continue
            parseur = _ArticleText()
            parseur.feed(html)
            texte = parseur.text()
            # Une page rendue en JavaScript ou un blocage anti-bot renvoie du
            # HTML sans contenu : mieux vaut rien que du bruit dans le corpus.
            if len(texte) < 400:
                echecs += 1
                print(f"  {i}/{len(urls)} trop peu de texte ({len(texte)} car.) : {_hote(url)}")
                continue
            titre = (parseur.title.strip() or url)[:200]
            morceaux = chunk_text(texte)
            for idx, morceau in enumerate(morceaux):
                tampon.append({"title": titre, "url": url, "content": morceau, "chunk_index": idx})
            reussis += 1
            print(f"  {i}/{len(urls)} {len(morceaux):3d} passages — {titre[:60]}")
            while len(tampon) >= BATCH:
                await _ecrire(tampon[:BATCH], conn)
                tampon = tampon[BATCH:]
        await _ecrire(tampon, conn)

    print(f"\n{reussis} article(s) ingéré(s), {echecs} inaccessible(s).")


if __name__ == "__main__":
    asyncio.run(ingest())
