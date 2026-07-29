"""Ingestion du corpus RAG : un sous-ensemble de Wikipédia en français.

POURQUOI Wikipédia FR : il couvre nativement nos domaines (science, histoire,
sciences humaines, politique), en français, et c'est le type de corpus qu'un
système de vérification factuelle (façon FEVER) utilise pour ancrer ses
explications.

POURQUOI un SOUS-ENSEMBLE et pas tout Wikipédia : on re-vectorise nous-mêmes
chaque passage avec mistral-embed. Tout Wikipédia = des millions de passages =
bien trop long et cher. Quelques milliers d'articles suffisent à constituer un
« large dataset » (des milliers de documents) pour quelques centimes.

Ce n'est PAS un endpoint : c'est un script à lancer UNE fois, à la main, pour
remplir la base. Voir la commande tout en bas.
"""
import asyncio
import os

# datasets (HuggingFace) : sert UNIQUEMENT à ce script d'ingestion, pour lire
# Wikipédia FR en streaming (sans télécharger tout le dump). C'est la façon
# standard de charger un dataset public. Justifié ici car il n'existe pas de
# voie plus simple pour récupérer des milliers d'articles FR proprement.
from datasets import load_dataset

from app.db import connect, ensure_schema, to_pgvector, truncate_documents
from app.mistral_client import embed
from app.rag.chunking import chunk_text

# Dataset Wikipédia FR sur HuggingFace. Le nom de config est « <date>.<langue> » ;
# si ce snapshot n'existe plus, en choisir un valide sur la page du dataset et le
# passer via la variable d'env RAG_WIKI_CONFIG.
WIKI_DATASET = os.getenv("RAG_WIKI_DATASET", "wikimedia/wikipedia")
WIKI_CONFIG = os.getenv("RAG_WIKI_CONFIG", "20231101.fr")

# Nombre d'articles à ingérer (réglable via RAG_MAX_ARTICLES). 2000 articles
# donnent ~10-20K passages : largement « large » sans exploser le temps de
# vectorisation.
MAX_ARTICLES = int(os.getenv("RAG_MAX_ARTICLES", "2000"))

# Le découpage en passages est factorisé dans app/rag/chunking.py (partagé avec
# l'ingestion politique).

# Vectorisation par PAQUETS : une seule requête Mistral pour BATCH passages.
# Indispensable — le tier gratuit limite le nombre de requêtes/minute, pas le
# volume. 200 passages/requête au lieu d'un par un.
BATCH = 200


def _wiki_url(title: str) -> str:
    # Reconstruit l'URL de l'article : sert de citation dans les réponses RAG.
    return "https://fr.wikipedia.org/wiki/" + title.replace(" ", "_")


def _existing_titles() -> set[str]:
    """Titres déjà présents en base. Sert à REPRENDRE une ingestion interrompue
    (une coupure réseau au milieu, par exemple) sans tout refaire : on saute les
    articles déjà ingérés."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT DISTINCT title FROM documents WHERE source = 'wikipedia_fr';")
        return {row[0] for row in cur.fetchall()}


def _documents(skip: set[str]) -> list[dict]:
    """Génère les passages (title, url, content, chunk_index) depuis Wikipédia FR.

    `skip` : les titres déjà en base, qu'on ne re-traite pas (reprise).
    """
    # streaming=True : on lit article par article sans télécharger tout le dump.
    ds = load_dataset(WIKI_DATASET, WIKI_CONFIG, split="train", streaming=True)
    docs: list[dict] = []
    for i, article in enumerate(ds):
        if i >= MAX_ARTICLES:
            break
        title = article["title"]
        if title in skip:  # déjà ingéré lors d'un run précédent -> on saute
            continue
        url = _wiki_url(title)
        for idx, chunk in enumerate(chunk_text(article["text"])):
            docs.append(
                {"title": title, "url": url, "content": chunk, "chunk_index": idx}
            )
    return docs


async def ingest() -> None:
    ensure_schema()

    # Par défaut on REPREND (on complète ce qui manque). Pour repartir de zéro,
    # lancer avec RAG_RESET=1 (utile si on change de corpus ou de découpage).
    if os.getenv("RAG_RESET", "0") == "1":
        truncate_documents()
        print("Table vidée (RAG_RESET=1) : ré-ingestion complète.")

    done = _existing_titles()
    if done:
        print(f"{len(done)} articles déjà en base -> sautés (reprise).")

    docs = _documents(done)
    if not docs:
        print("Rien de nouveau à ingérer (corpus déjà complet, ou snapshot invalide).")
        return
    print(f"{len(docs)} passages à ingérer (depuis {MAX_ARTICLES} articles max)...")

    with connect() as conn:
        for start in range(0, len(docs), BATCH):
            batch = docs[start : start + BATCH]
            # Un seul appel Mistral pour tout le paquet.
            vectors = await embed([d["content"] for d in batch])
            with conn.cursor() as cur:
                for d, vec in zip(batch, vectors):
                    cur.execute(
                        "INSERT INTO documents "
                        "(source, title, url, content, chunk_index, embedding) "
                        "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                        (
                            "wikipedia_fr",
                            d["title"],
                            d["url"],
                            d["content"],
                            d["chunk_index"],
                            to_pgvector(vec),
                        ),
                    )
            conn.commit()  # commit par paquet : la progression est sauvegardée
            print(f"  {min(start + BATCH, len(docs))}/{len(docs)}")

    print("Ingestion terminée.")


# À lancer dans le conteneur (l'ingestion appelle Mistral -> clé requise) :
#     docker compose exec ai-service python -m app.rag.ingest
if __name__ == "__main__":
    asyncio.run(ingest())
