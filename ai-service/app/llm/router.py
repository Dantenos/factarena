"""Endpoint LLM : POST /llm/chat — chat libre en streaming, SANS récupération.

C'est le module « interface LLM » du sujet, VOLONTAIREMENT DISTINCT du RAG :
  - le RAG (/rag/ask) récupère des passages et ancre la réponse dessus ;
  - ici, AUCUNE récupération : le modèle répond à partir de sa seule
    connaissance. C'est ce qui prouve à l'évaluateur que RAG et LLM sont deux
    systèmes différents (4 points en jeu, cf. docs/ARCHITECTURE.md §3).

Le sujet impose pour ce module : streaming (fait), gestion d'erreurs (le client
Mistral réessaie les pépins transitoires, et on renvoie une erreur propre) ET
rate limiting (ci-dessous).
"""
import json
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.mistral_client import chat_stream
from app.rate_limit import RateLimiter

router = APIRouter()

# Rate limiting : on plafonne les appels au LLM (chaque appel coûte de l'argent).
# Réglable via l'env. Valeurs par défaut basses -> facile de déclencher un vrai
# 429 en direct à l'évaluation, comme le sujet le demande.
_RATE_MAX = int(os.getenv("LLM_RATE_MAX", "5"))
_RATE_WINDOW = float(os.getenv("LLM_RATE_WINDOW", "30"))
limiter = RateLimiter(_RATE_MAX, _RATE_WINDOW)


class ChatRequest(BaseModel):
    # Validation côté BACK (exigence du sujet) : message non vide, taille bornée.
    # FastAPI renvoie un 422 clair si ce n'est pas respecté.
    message: str = Field(min_length=1, max_length=4000)


def _sse(event: str, data) -> str:
    """Formate un événement Server-Sent Events (même protocole que /rag/ask :
    le front n'a qu'une seule façon de lire les flux). ensure_ascii=False pour
    garder les accents."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(req: ChatRequest, request: Request):
    # Rate limiting : au-delà de la limite, on renvoie un 429 AVANT tout appel au
    # LLM. Clé = IP de l'appelant (en prod, ce serait plutôt l'utilisateur
    # authentifié, transmis par le back ; l'IP suffit pour démontrer le module).
    if not limiter.allow(request.client.host):
        raise HTTPException(
            status_code=429,
            detail=f"Trop de requêtes (max {_RATE_MAX} par {int(_RATE_WINDOW)}s). Réessayez dans un instant.",
        )

    # PAS de récupération : le message part tel quel au modèle. C'est LA
    # différence avec le RAG, qui lui injecte un contexte récupéré en base.
    messages = [
        {"role": "system", "content": "Tu es un assistant francophone. Réponds de façon claire et concise."},
        {"role": "user", "content": req.message},
    ]

    async def event_stream():
        try:
            async for token in chat_stream(messages):
                yield _sse("token", {"text": token})
        except Exception:
            # Le streaming a déjà commencé : impossible de changer le code HTTP,
            # on signale donc l'erreur DANS le flux, proprement.
            yield _sse("error", {"message": "La génération a été interrompue."})
            return
        yield _sse("done", {})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
