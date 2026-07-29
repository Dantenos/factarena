"""Endpoint RAG : POST /rag/ask — question libre -> réponse sourcée en streaming.

C'est la surface Q&A autonome du module RAG (celle qu'on démontre à l'éval).
La chaîne complète :
  question -> recherche des passages les plus proches (search_similar)
           -> on donne ces passages comme CONTEXTE au LLM
           -> le LLM rédige une réponse ANCRÉE sur ce contexte, en streaming
           -> on renvoie d'abord les sources, puis la réponse token par token (SSE)

Ce qui distingue le RAG d'un simple chatbot : le LLM ne répond QUE d'après les
passages fournis. C'est ce qui évite les hallucinations — crucial pour du
fact-checking, où une réponse inventée serait pire que pas de réponse.
"""
import json
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.mistral_client import chat_stream
from app.rag.search import search_similar
from app.rate_limit import RateLimiter

router = APIRouter()

# Nombre de passages récupérés pour servir de contexte au LLM. Réglable via
# l'env (RAG_TOP_K) : plus de passages = réponses plus précises et mieux
# sourcées, mais un contexte plus lourd. 6 est un bon compromis.
TOP_K = int(os.getenv("RAG_TOP_K", "6"))

# Rate limiting : /rag/ask appelle aussi Mistral (embeddings + génération), donc
# ça coûte de l'argent -> on le protège comme /llm/chat. Un peu plus permissif
# que le chat libre (une recherche est un usage plus « normal »). Réglable via l'env.
_RATE_MAX = int(os.getenv("RAG_RATE_MAX", "10"))
_RATE_WINDOW = float(os.getenv("RAG_RATE_WINDOW", "30"))
limiter = RateLimiter(_RATE_MAX, _RATE_WINDOW)


class AskRequest(BaseModel):
    # Validation côté BACK (exigence du sujet) : la question doit être non vide
    # et de taille raisonnable. FastAPI renvoie automatiquement un 422 clair si
    # ce n'est pas respecté — le back ne fait jamais confiance à l'entrée.
    question: str = Field(min_length=3, max_length=1000)


def _build_messages(question: str, passages: list[dict]) -> list[dict]:
    """Construit les messages pour le LLM : une consigne stricte + le contexte.

    On numérote les passages ([1], [2]...) pour que le modèle puisse s'y référer,
    et on lui interdit d'inventer hors de ce contexte.
    """
    contexte = "\n\n".join(
        f"[{i + 1}] {p['title']}\n{p['content']}" for i, p in enumerate(passages)
    )
    systeme = (
        "Tu es un assistant de fact-checking. Réponds à la question EN FRANÇAIS "
        "en t'appuyant UNIQUEMENT sur les passages fournis ci-dessous. "
        "Si les passages ne permettent pas de répondre, dis-le clairement au lieu "
        "d'inventer. Sois concis et factuel."
    )
    return [
        {"role": "system", "content": systeme},
        {"role": "user", "content": f"Passages :\n\n{contexte}\n\nQuestion : {question}"},
    ]


def _sse(event: str, data) -> str:
    """Formate un événement Server-Sent Events.

    ensure_ascii=False : on garde les accents français lisibles dans le flux.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/ask")
async def ask(req: AskRequest, request: Request):
    # Rate limiting : au-delà de la limite, 429 avant tout appel à Mistral.
    if not limiter.allow(request.client.host):
        raise HTTPException(
            status_code=429,
            detail=f"Trop de requêtes (max {_RATE_MAX} par {int(_RATE_WINDOW)}s). Réessayez dans un instant.",
        )

    # 1. Récupération. Si Mistral (embed) ou la base est en panne, ça échoue ICI,
    #    AVANT le streaming : on peut donc renvoyer un vrai code HTTP propre.
    try:
        passages = await search_similar(req.question, k=TOP_K)
    except Exception:
        raise HTTPException(status_code=503, detail="Service RAG indisponible (recherche).")

    messages = _build_messages(req.question, passages)

    async def event_stream():
        # On envoie d'abord les SOURCES : le front peut les afficher tout de
        # suite, avant même que la réponse commence à s'écrire.
        yield _sse("sources", [{"title": p["title"], "url": p["url"]} for p in passages])
        try:
            async for token in chat_stream(messages):
                yield _sse("token", {"text": token})
        except Exception:
            # Le streaming a déjà commencé : impossible de changer le code HTTP
            # maintenant. On signale donc l'erreur DANS le flux, proprement.
            yield _sse("error", {"message": "La génération a été interrompue."})
            return
        yield _sse("done", {})

    # text/event-stream = le type MIME des Server-Sent Events. nginx laisse déjà
    # passer le streaming (configuré à l'étape infra).
    return StreamingResponse(event_stream(), media_type="text/event-stream")
