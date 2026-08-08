"""Ingestion THÉMATIQUE de Wikipédia FR (via l'API, texte à jour) -> corpus RAG.

Généralise l'approche par catégories-portail à plusieurs thèmes : politique,
histoire, religion, sciences. Chaque thème est stocké sous sa propre `source`
(wikipedia_fr_<theme>), ce qui permet de voir et gérer la couverture par thème.

POURQUOI l'API (et pas le dump généraliste) : elle sert le texte À JOUR des
articles, et on CIBLE les portails du thème -> couverture précise et fraîche.
Wikipédia maintient une catégorie « Portail:X/Articles liés » qui regroupe les
articles rattachés à un portail : c'est notre point d'entrée par thème.

REPRENABLE par thème (saute les articles déjà en base pour cette source) et
réactualisable (relancer récupère les nouveaux articles).

Script one-shot, LONG (des milliers d'articles + vectorisation). Lancer :
    docker compose exec ai-service python -m app.rag.ingest_themes
Régler le volume PAR THÈME via RAG_MAX_ARTICLES (défaut 1000).
"""
import asyncio
import json
import os
import time

import httpx

from app.db import connect, ensure_schema, to_pgvector
from app.mistral_client import embed
from app.rag.chunking import chunk_text

API = "https://fr.wikipedia.org/w/api.php"
HEADERS = {"User-Agent": "FactArena-42-project/0.1 (ft_transcendence; educational)"}

# Thème -> (source en base, catégories-portail Wikipédia). Noms VÉRIFIÉS : chacune
# de ces catégories ramène des milliers d'articles.
THEMES = {
    "wikipedia_fr_politique": [
        "Catégorie:Portail:Politique française/Articles liés",
        "Catégorie:Portail:Cinquième République/Articles liés",
    ],
    "wikipedia_fr_histoire": [
        "Catégorie:Portail:Histoire/Articles liés",
    ],
    "wikipedia_fr_religion": [
        "Catégorie:Portail:Religions et croyances/Articles liés",
    ],
    "wikipedia_fr_sciences": [
        "Catégorie:Portail:Sciences/Articles liés",
    ],
}

# Nombre d'articles maximum PAR THÈME (réglable via RAG_MAX_ARTICLES).
MAX_ARTICLES = int(os.getenv("RAG_MAX_ARTICLES", "1000"))
# Plafond de passages par article (un article fleuve n'écrase pas le reste).
MAX_CHUNKS_PER_ARTICLE = 30
# Vectorisation par paquets (1 requête Mistral pour BATCH passages).
BATCH = 200


def _get(client: httpx.Client, params: dict) -> dict:
    """Appel API Wikipédia avec réessais (réseau, 429, corps non-JSON)."""
    for attempt in range(3):
        try:
            resp = client.get(API, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except (httpx.TransportError, httpx.HTTPStatusError, json.JSONDecodeError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def _collect_titles(client: httpx.Client, categories: list[str], skip: set[str]) -> list[str]:
    """Titres d'articles (namespace 0) des catégories, sans doublon, hors `skip`,
    jusqu'à MAX_ARTICLES."""
    seen: set[str] = set()
    titles: list[str] = []
    for cat in categories:
        cmcontinue = None
        while len(titles) < MAX_ARTICLES:
            params = {
                "action": "query", "list": "categorymembers",
                "cmtitle": cat, "cmnamespace": "0", "cmtype": "page",
                "cmlimit": "500", "format": "json",
            }
            if cmcontinue:
                params["cmcontinue"] = cmcontinue
            data = _get(client, params)
            for m in data.get("query", {}).get("categorymembers", []):
                t = m["title"]
                if t not in seen and t not in skip:
                    seen.add(t)
                    titles.append(t)
            cmcontinue = data.get("continue", {}).get("cmcontinue")
            if not cmcontinue:
                break
    return titles[:MAX_ARTICLES]


def _existing_titles(source: str) -> set[str]:
    """Titres déjà en base pour cette source (reprise)."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT DISTINCT title FROM documents WHERE source = %s;", (source,))
        return {row[0] for row in cur.fetchall()}


def _fetch_extract(client: httpx.Client, title: str) -> str:
    """Texte brut à jour d'un article. "" si introuvable / échec (on saute l'article)."""
    try:
        data = _get(client, {
            "action": "query", "prop": "extracts", "explaintext": "1",
            "exlimit": "1", "titles": title, "format": "json",
        })
    except Exception:
        return ""
    for _, page in data.get("query", {}).get("pages", {}).items():
        return page.get("extract", "") or ""
    return ""


def _wiki_url(title: str) -> str:
    return "https://fr.wikipedia.org/wiki/" + title.replace(" ", "_")


async def _flush(rows: list[dict], conn, source: str) -> None:
    if not rows:
        return
    vectors = await embed([r["content"] for r in rows])
    with conn.cursor() as cur:
        for r, vec in zip(rows, vectors):
            cur.execute(
                "INSERT INTO documents (source, title, url, content, chunk_index, embedding) "
                "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                (source, r["title"], r["url"], r["content"], r["chunk_index"], to_pgvector(vec)),
            )
    conn.commit()


async def ingest() -> None:
    ensure_schema()
    with httpx.Client(headers=HEADERS) as client:
        for source, categories in THEMES.items():
            done = _existing_titles(source)
            titles = _collect_titles(client, categories, done)
            print(f"[{source}] {len(titles)} nouveaux articles ({len(done)} déjà en base)")
            if not titles:
                continue
            buffer: list[dict] = []
            with connect() as conn:
                for i, title in enumerate(titles, 1):
                    text = _fetch_extract(client, title)
                    if not text:
                        continue
                    url = _wiki_url(title)
                    for idx, chunk in enumerate(chunk_text(text)[:MAX_CHUNKS_PER_ARTICLE]):
                        buffer.append(
                            {"title": title, "url": url, "content": chunk, "chunk_index": idx}
                        )
                    while len(buffer) >= BATCH:
                        await _flush(buffer[:BATCH], conn, source)
                        buffer = buffer[BATCH:]
                    if i % 50 == 0:
                        print(f"  [{source}] {i}/{len(titles)} articles...")
                await _flush(buffer, conn, source)
    print("Ingestion thématique terminée.")


if __name__ == "__main__":
    asyncio.run(ingest())
