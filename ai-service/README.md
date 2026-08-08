# ai-service — FastAPI (LLM, RAG, modération)

Territoire : Tech Lead IA (Python). Feuille de route détaillée : `docs/AI.md`.

Accessible UNIQUEMENT depuis le backend core (réseau docker interne) : le front
ne parle jamais directement à ce service.

## Endpoints

| Route | Module | Rôle |
|---|---|---|
| `POST /rag/ask` | RAG (major) | question -> réponse sourcée en streaming (SSE), ancrée sur le corpus |
| `POST /llm/chat` | LLM (major) | chat libre en streaming, SANS récupération (distinct du RAG) + rate limit |
| `POST /moderation/check` | Modération (minor) | décision allow / warn / delete par modèle Mistral |
| `GET /health` | — | liveness (le process répond) — utilisé par le healthcheck Docker |
| `GET /ready` | — | readiness : vérifie la base + la taille du corpus |

## Structure

```
app/
├── main.py            # app FastAPI, branche les routers, /health + /ready
├── config.py          # variables d'environnement (clé Mistral, modèles...)
├── mistral_client.py  # unique porte vers Mistral : embed / chat_stream / moderate (+ retry)
├── rate_limit.py      # limiteur de débit maison (fenêtre glissante)
├── db.py              # connexion + table des vecteurs (documents)
├── rag/               # recherche, ingestion (dump + politique), endpoint /rag/ask, démo
├── llm/               # endpoint /llm/chat
└── moderation/        # endpoint /moderation/check
```

## Corpus (RAG)

Voir `app/rag/README.md`. Ingestion :
```bash
docker compose exec ai-service python -m app.rag.ingest             # dump généraliste
docker compose exec ai-service python -m app.rag.ingest_politique   # politique FR (API, à jour)
```

## Démo fact-checking

```bash
docker compose exec ai-service python -m app.rag.demo_factcheck
# ou avec tes propres affirmations :
docker compose exec ai-service python -m app.rag.demo_factcheck "La Ve République date de 1958"
```

## Tests

```bash
docker compose exec ai-service python -m pytest -q
```

Les tests couvrent la logique pure (rate limiter, décision de modération,
découpage, format des vecteurs) et la validation des endpoints (rejet des
entrées invalides). Ils ne font aucun appel réseau : pas besoin de clé Mistral.
