"""Tests du service IA.

À lancer dans le conteneur :
    docker compose exec ai-service python -m pytest -q

Deux familles :
  1. Tests UNITAIRES de la logique pure (rate limiter, décision de modération,
     découpage, format des vecteurs) : rapides, sans réseau ni base.
  2. Tests de VALIDATION des endpoints : on vérifie que les entrées invalides
     sont rejetées (422). Ces cas n'appellent JAMAIS Mistral — la validation
     Pydantic rejette avant d'entrer dans le handler — donc les tests tournent
     sans clé API ni réseau.
"""
from fastapi.testclient import TestClient

from app.db import to_pgvector
from app.main import app
from app.moderation.router import _decide
from app.rag.chunking import chunk_text
from app.rate_limit import RateLimiter


# --- 1. Logique pure -------------------------------------------------------

def test_rate_limiter_bloque_apres_la_limite():
    rl = RateLimiter(max_requests=2, window_seconds=100)
    assert rl.allow("ip-a") is True    # 1er appel : ok
    assert rl.allow("ip-a") is True    # 2e appel : ok
    assert rl.allow("ip-a") is False   # 3e : dépasse la limite
    assert rl.allow("ip-b") is True    # autre clé : compteur indépendant


def test_moderation_decide_les_trois_cas():
    assert _decide({"categories": {}})["action"] == "allow"
    assert _decide({"categories": {"violence_and_threats": True}})["action"] == "delete"
    assert _decide({"categories": {"financial": True}})["action"] == "warn"


def test_chunk_text():
    # Texte court -> un seul passage.
    assert chunk_text("Bonjour.") == ["Bonjour."]
    # Deux gros paragraphes qui dépassent la taille -> deux passages.
    texte = "\n".join(["a" * 500, "b" * 500])
    assert len(chunk_text(texte, size=800)) == 2


def test_to_pgvector():
    # Format texte attendu par pgvector : '[a,b]' à 6 décimales.
    assert to_pgvector([1.0, 2.5]) == "[1.000000,2.500000]"


# --- 2. Validation des endpoints (sans appeler Mistral) --------------------

client = TestClient(app)


def test_rag_ask_rejette_entree_invalide():
    assert client.post("/rag/ask", json={"question": "ab"}).status_code == 422  # trop court
    assert client.post("/rag/ask", json={}).status_code == 422                  # champ manquant


def test_llm_chat_rejette_message_vide():
    assert client.post("/llm/chat", json={"message": ""}).status_code == 422


def test_moderation_rejette_message_vide():
    assert client.post("/moderation/check", json={"message": ""}).status_code == 422


def test_health_repond():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
