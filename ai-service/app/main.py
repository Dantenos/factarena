"""Service IA (FastAPI) — squelette.

Pour l'instant : uniquement un endpoint de santé. La logique IA (LLM, RAG,
modération) vivra dans les sous-modules dédiés (voir app/llm, app/rag,
app/moderation). Ce service est INTERNE : nginx ne l'expose pas, il sera
appelé par le backend NestJS sur le réseau docker privé.
"""
from fastapi import FastAPI

# On importe la config au démarrage : cela déclenche la lecture des variables
# d'environnement (et échouerait tôt si une valeur requise manquait plus tard).
from app.config import settings

app = FastAPI(title="FactArena AI Service")


@app.get("/health")
def health():
    # Sonde de santé (utilisée par le healthcheck Docker).
    return {"status": "ok"}
