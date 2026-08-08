"""Recherche par similarité dans le corpus RAG.

C'est le cœur du « R » de RAG (Retrieval) : on transforme la question en vecteur,
puis on demande à pgvector les documents les plus PROCHES par distance cosinus.
Ce module sera réutilisé tel quel par l'endpoint /rag/ask (étape 2) : là, les
documents récupérés serviront de contexte au LLM pour générer une réponse
sourcée. Ici on ne fait que la récupération.
"""
from app.db import connect, to_pgvector
from app.mistral_client import embed


async def search_similar(query: str, k: int = 5) -> list[dict]:
    """Renvoie les `k` documents les plus proches de `query`.

    L'opérateur `<=>` de pgvector calcule la distance cosinus : plus elle est
    petite, plus le document est proche de la question. L'index HNSW (voir db.py)
    rend cette recherche rapide même sur des milliers de lignes.
    """
    # embed() attend une liste et renvoie une liste : on déballe le seul vecteur.
    [query_vector] = await embed([query])

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT title, url, content,
                   embedding <=> %s::vector AS distance
            FROM documents
            ORDER BY distance ASC
            LIMIT %s
            """,
            (to_pgvector(query_vector), k),
        )
        rows = cur.fetchall()

    # title/url servent de citation ; content est le passage à donner au LLM
    # comme contexte (étape 2) ; distance = à quel point c'est proche (0 = identique).
    return [
        {"title": r[0], "url": r[1], "content": r[2], "distance": r[3]}
        for r in rows
    ]
