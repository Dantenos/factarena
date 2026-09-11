"""Ingestion des ARTICLES DE FACT-CHECK dans le corpus RAG (source='factcheck').

POURQUOI : pour que l'IA EXPLIQUE un verdict en citant la vraie source (AFP Factuel,
franceinfo...) au lieu de le deviner. On ingère le TEXTE des articles pointés par les
Claim du jeu ; /rag/ask retrouve alors l'article et le cite.

Le verdict, lui, reste dans la table `Claim` (Prisma, cf. app/rag/README.md) — ici on ne
stocke que le texte explicatif de l'article, pour l'ancrage RAG.

Entrée : les URLs d'articles de fact-check, une par ligne dans
`ai-service/data/factcheck_urls.txt` (# = commentaire). Plus tard, on pourra les tirer
directement de la table Claim (colonne factcheckUrl).

Reprenable : saute les URLs déjà en base. Lancer :
    docker compose exec ai-service python -m app.rag.ingest_factcheck
"""
import asyncio
import time
from html.parser import HTMLParser
from pathlib import Path

import httpx

from app.db import connect, ensure_schema, to_pgvector
from app.mistral_client import embed
from app.rag.chunking import chunk_text

# User-Agent de NAVIGATEUR : beaucoup de sites de presse (France24, AFP...) bloquent
# les User-Agent qui ressemblent à un bot. On se présente comme un vrai navigateur.
# NB : certains sites (France24, AFP) bloquent quand même -> passer par leur snapshot
# web.archive.org, qui est fetchable et sert d'archive de toute façon.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}
URLS_FILE = Path(__file__).resolve().parents[2] / "data" / "factcheck_urls.txt"
BATCH = 100


class _ArticleText(HTMLParser):
    """Extracteur de texte minimal (lib standard).

    POURQUOI pas BeautifulSoup : un article de fact-check est surtout des <p> et des
    titres. Une classe de ~30 lignes suffit -> pas de dépendance HTML en plus. On
    garde le texte des paragraphes/titres, on jette script/style/nav/footer (bruit).
    """
    _TEXT_TAGS = {"p", "h1", "h2", "h3", "li", "blockquote"}
    _SKIP_TAGS = {"script", "style", "nav", "footer", "header", "aside"}

    def __init__(self) -> None:
        super().__init__()
        self._keep = 0
        self._skip = 0
        self._in_title = False
        self.title = ""
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        if tag in self._SKIP_TAGS:
            self._skip += 1
        elif tag in self._TEXT_TAGS:
            self._keep += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in self._SKIP_TAGS and self._skip:
            self._skip -= 1
        elif tag in self._TEXT_TAGS and self._keep:
            self._keep -= 1
            self.parts.append("\n")  # une frontière entre blocs de texte

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._skip == 0 and self._keep > 0:
            self.parts.append(data)

    def text(self) -> str:
        lignes = [l.strip() for l in "".join(self.parts).splitlines() if l.strip()]
        return "\n".join(lignes)


def _fetch(client: httpx.Client, url: str) -> str:
    """Télécharge le HTML d'un article, avec quelques réessais réseau."""
    for attempt in range(3):
        try:
            r = client.get(url, headers=HEADERS, timeout=30, follow_redirects=True)
            r.raise_for_status()
            return r.text
        except httpx.HTTPError:
            if attempt == 2:
                return ""
            time.sleep(2 ** attempt)
    return ""


def _read_urls() -> list[str]:
    """Lit les URLs (une par ligne, # pour commenter)."""
    if not URLS_FILE.exists():
        return []
    urls = []
    for line in URLS_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            urls.append(line)
    return urls


def _existing_urls() -> set[str]:
    """URLs déjà ingérées (reprise)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT DISTINCT url FROM documents WHERE source = 'factcheck';")
        return {row[0] for row in cur.fetchall()}


async def _flush(rows: list[dict], conn) -> None:
    if not rows:
        return
    vectors = await embed([r["content"] for r in rows])
    with conn.cursor() as cur:
        for r, vec in zip(rows, vectors):
            cur.execute(
                "INSERT INTO documents (source, title, url, content, chunk_index, embedding) "
                "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                ("factcheck", r["title"], r["url"], r["content"], r["chunk_index"], to_pgvector(vec)),
            )
    conn.commit()


async def ingest() -> None:
    ensure_schema()
    urls = _read_urls()
    if not urls:
        print(f"Aucune URL. Ajoute des liens de fact-check (un par ligne) dans :\n  {URLS_FILE}")
        return

    done = _existing_urls()
    urls = [u for u in urls if u not in done]
    if not urls:
        print("Rien de nouveau (toutes les URLs sont déjà en base).")
        return
    print(f"{len(urls)} article(s) à ingérer...")

    buffer: list[dict] = []
    with connect() as conn, httpx.Client() as client:
        for i, url in enumerate(urls, 1):
            html = _fetch(client, url)
            if not html:
                print(f"  échec réseau, ignoré : {url}")
                continue
            parser = _ArticleText()
            parser.feed(html)
            texte = parser.text()
            titre = (parser.title.strip() or url)[:200]
            # Garde-fou : une page qui ne rend presque pas de texte (site en JS,
            # blocage bot) ne doit pas polluer le corpus.
            if len(texte) < 200:
                print(f"  trop peu de texte, ignoré : {url}")
                continue
            for idx, chunk in enumerate(chunk_text(texte)):
                buffer.append({"title": titre, "url": url, "content": chunk, "chunk_index": idx})
            while len(buffer) >= BATCH:
                await _flush(buffer[:BATCH], conn)
                buffer = buffer[BATCH:]
            print(f"  {i}/{len(urls)} : {titre[:70]}")
        await _flush(buffer, conn)

    print("Ingestion fact-check terminée.")


if __name__ == "__main__":
    asyncio.run(ingest())
