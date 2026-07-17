# ============================================================
# back-ai (FastAPI) — service IA : RAG (pgvector), LLM streaming, modération.
# NOTE : code Python / requirements.txt pas encore créés — gabarit prêt à
# l'emploi une fois le service FastAPI initialisé.
# ============================================================
FROM python:3.12-slim
WORKDIR /app

# Cache : on installe les dépendances AVANT de copier le code, pour ne pas
# tout réinstaller à chaque changement de source.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Utilisateur non-root (sécurité) + propriété des fichiers : le service RAG
# peut avoir besoin d'écrire sous /app (index vectoriel local, cache de
# modèle...). Sans le chown, appuser ne pourrait pas écrire (fichiers root).
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
# uvicorn sert l'app FastAPI. Au démarrage, l'app doit activer pgvector
# (CREATE EXTENSION IF NOT EXISTS vector) et charger/indexer le corpus RAG.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
