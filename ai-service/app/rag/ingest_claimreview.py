"""Ingestion via l'API Google Fact Check Tools (claims:search) -> corpus RAG.

POURQUOI cette source : Google agrège le ClaimReview mondial (AFP Factuel,
franceinfo, Snopes...) en DONNÉES STRUCTURÉES. Un seul appel API rend
claim + verdict + éditeur + lien -> pas de scraping, pas d'anti-bot, et le
verdict vient d'un fact-checkeur identifié (règle d'or, app/rag/README.md).

Chaque résultat devient un document RAG sourcé (source='factcheck') :
« Affirmation ... — jugé <verdict> par <éditeur> (<date>). Source: <url> ».
Les mêmes champs peuvent aussi seeder la table Claim du jeu (côté Prisma).

Prérequis : GOOGLE_API_KEY dans .env (clé gratuite, "Fact Check Tools API").
Reprenable : saute les URLs déjà en base. Lancer :
    docker compose exec ai-service python -m app.rag.ingest_claimreview
"""
import asyncio
import json
import os
import time

import httpx

from app.config import settings
from app.db import connect, ensure_schema, to_pgvector
from app.mistral_client import embed

API = "https://factchecktools.googleapis.com/v1alpha1/claims:search"

# L'API est une RECHERCHE : on balaie plusieurs sujets FR pour ratisser large.
# Réglable via CLAIMREVIEW_QUERIES (séparés par des virgules).
QUERIES = os.getenv(
    "CLAIMREVIEW_QUERIES",
    "vidéo,intelligence artificielle,élection,gouvernement,immigration,climat,vaccin",
).split(",")
MAX_AGE_DAYS = int(os.getenv("CLAIMREVIEW_MAX_AGE_DAYS", "1825"))  # ~5 ans
PAGES_PER_QUERY = int(os.getenv("CLAIMREVIEW_PAGES", "4"))  # 4 x 50 = 200 max par terme
BATCH = 100


def _get(client: httpx.Client, params: dict) -> dict:
    """Appel API avec réessais (réseau, 429). Lève sur clé invalide (401/403)."""
    for attempt in range(3):
        try:
            resp = client.get(API, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            # 429 = quota -> on réessaie ; 401/403/400 = clé/requête -> on remonte.
            if e.response.status_code != 429 or attempt == 2:
                raise
            time.sleep(2 ** attempt)
        except (httpx.TransportError, json.JSONDecodeError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def _collect() -> list[dict]:
    """Interroge l'API pour chaque terme -> items dédupliqués (par url + claim)."""
    seen: set[str] = set()
    items: list[dict] = []
    with httpx.Client() as client:
        for query in QUERIES:
            query = query.strip()
            page_token = None
            for _ in range(PAGES_PER_QUERY):
                params = {
                    "query": query, "languageCode": "fr",
                    "maxAgeDays": MAX_AGE_DAYS, "pageSize": 50,
                    "key": settings.google_api_key,
                }
                if page_token:
                    params["pageToken"] = page_token
                data = _get(client, params)
                for claim in data.get("claims", []):
                    reviews = claim.get("claimReview") or []
                    if not reviews:
                        continue
                    review = reviews[0]
                    url = review.get("url", "")
                    cle = url + "|" + claim.get("text", "")[:80]
                    if not url or cle in seen:
                        continue
                    seen.add(cle)
                    items.append({
                        "claim": claim.get("text", ""),
                        "claimant": claim.get("claimant", ""),
                        "verdict": review.get("textualRating", ""),
                        "url": url,
                        "publisher": (review.get("publisher") or {}).get("name", ""),
                        "date": (review.get("reviewDate") or "")[:10],
                    })
                page_token = data.get("nextPageToken")
                if not page_token:
                    break
    return items


def _to_text(it: dict) -> str:
    """Phrase-fait sourcée, prête pour l'embedding."""
    qui = f" (attribuée à {it['claimant']})" if it["claimant"] else ""
    quand = f" le {it['date']}" if it["date"] else ""
    return (
        f"Affirmation : « {it['claim']} »{qui}. "
        f"Verdict : {it['verdict'] or 'non précisé'} — jugé par "
        f"{it['publisher'] or 'un fact-checkeur'}{quand}. Source : {it['url']}"
    )


def _existing_urls() -> set[str]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT DISTINCT url FROM documents WHERE source = 'factcheck';")
        return {row[0] for row in cur.fetchall()}


async def ingest() -> None:
    if not settings.google_api_key:
        print("GOOGLE_API_KEY manquante dans .env — impossible d'interroger l'API.")
        return
    ensure_schema()

    print("Interrogation de l'API Fact Check Tools...")
    items = _collect()
    done = _existing_urls()
    items = [it for it in items if it["url"] not in done]
    if not items:
        print("Rien de nouveau (aucun résultat, ou tout est déjà en base).")
        return
    print(f"{len(items)} fact-checks à ingérer...")

    with connect() as conn:
        for start in range(0, len(items), BATCH):
            batch = items[start:start + BATCH]
            vectors = await embed([_to_text(it) for it in batch])
            with conn.cursor() as cur:
                for it, vec in zip(batch, vectors):
                    cur.execute(
                        "INSERT INTO documents (source, title, url, content, chunk_index, embedding) "
                        "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                        ("factcheck", (it["claim"] or it["url"])[:200], it["url"],
                         _to_text(it), 0, to_pgvector(vec)),
                    )
            conn.commit()
            print(f"  {min(start + BATCH, len(items))}/{len(items)}")

    print("Ingestion ClaimReview terminée.")


if __name__ == "__main__":
    asyncio.run(ingest())
