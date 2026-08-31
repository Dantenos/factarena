"""Service IA (FastAPI).

Ce service est INTERNE : nginx ne l'expose pas, il est appelé par le backend
NestJS sur le réseau docker privé. Il regroupe les modules IA (RAG, LLM,
modération), chacun dans son sous-dossier (app/rag, app/llm, app/moderation).
"""
import logging

from fastapi import FastAPI, HTTPException

# On importe la config au démarrage : cela déclenche la lecture des variables
# d'environnement (et échouerait tôt si une valeur requise manquait plus tard).
from app.config import settings
from app.db import connect, ensure_schema
from app.rag.router import router as rag_router
from app.llm.router import router as llm_router
from app.moderation.router import router as moderation_router

# Avertissement au démarrage si la clé Mistral manque : le service démarre quand
# même (utile pour le healthcheck et les tests), mais tout appel à Mistral
# échouerait. Un log clair au boot vaut mieux qu'une erreur obscure à la 1re requête.
if not settings.llm_api_key:
    logging.getLogger("uvicorn.error").warning(
        "LLM_API_KEY est vide : les appels Mistral échoueront. Renseigne la clé dans .env."
    )

app = FastAPI(title="FactArena AI Service")


@app.on_event("startup")
def preparer_base() -> None:
    """Crée le schéma vectoriel s'il n'existe pas encore.

    Il n'était créé que par les scripts d'ingestion. Sur une machine qui vient
    de cloner le dépôt, la table n'existait donc pas : la recherche levait une
    exception et /rag/ask répondait 503, ce qui faisait croire à une panne du
    service alors qu'il lui manquait seulement sa base.

    L'index reste vide tant qu'on n'a pas lancé une ingestion, mais une
    recherche sans résultat vaut mieux qu'une erreur.
    """
    try:
        ensure_schema()
    except Exception as erreur:
        # Le service doit démarrer même si Postgres n'est pas encore prêt :
        # le healthcheck et la modération n'ont pas besoin du vectoriel.
        logging.getLogger("uvicorn.error").warning(
            "Schéma vectoriel non créé au démarrage (%s). Il le sera à la première ingestion.",
            erreur,
        )

# Module RAG : les routes vivent sous /rag (ex. POST /rag/ask). Le backend
# appellera http://ai-service:8000/rag/ask.
app.include_router(rag_router, prefix="/rag", tags=["rag"])

# Module LLM (interface libre, distinct du RAG) : routes sous /llm (POST /llm/chat).
app.include_router(llm_router, prefix="/llm", tags=["llm"])

# Module modération : routes sous /moderation (POST /moderation/check). Le back
# l'appelle pour chaque message du chat.
app.include_router(moderation_router, prefix="/moderation", tags=["moderation"])


@app.get("/health")
def health():
    # Sonde de LIVENESS : « le process répond ». C'est celle du healthcheck
    # Docker : volontairement simple, elle ne dépend d'AUCUN service externe
    # (sinon une base momentanément lente ferait redémarrer le conteneur).
    return {"status": "ok"}


@app.get("/ready")
def ready():
    # Sonde de READINESS : « prêt à servir pour de vrai ». Contrairement à
    # /health, elle TOUCHE les dépendances : base joignable + taille du corpus.
    # Renvoie 503 si la base ne répond pas. Utile pour diagnostiquer un service
    # « up mais inutilisable » (corpus vide, base coupée...).
    try:
        with connect() as conn, conn.cursor() as cur:
            # to_regclass renvoie NULL si la table n'existe pas encore (corpus
            # jamais ingéré) : on gère ce cas sans planter. La table vit dans le
            # schéma `rag` (isolé de Prisma) — cf. app/db.py.
            cur.execute("SELECT to_regclass('rag.documents');")
            corpus = 0
            if cur.fetchone()[0] is not None:
                cur.execute("SELECT count(*) FROM documents;")
                corpus = cur.fetchone()[0]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Base de données injoignable : {exc}")
    return {
        "status": "ready",
        "corpus_documents": corpus,
        "llm_key_configuree": bool(settings.llm_api_key),
    }
