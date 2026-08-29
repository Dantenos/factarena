"""Chargement de la configuration depuis les variables d'environnement.

POURQUOI ce fichier : on centralise ici la lecture de l'environnement
(pydantic-settings) pour ne JAMAIS coder en dur une URL de base ou une clé
d'API. Les valeurs proviennent du .env, injecté par docker compose.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Base de données partagée (pgvector) — utilisée plus tard par le RAG.
    database_url: str = ""

    # --- Mistral (fournisseur LLM choisi par l'équipe) ---
    # La clé d'API : PAS de valeur par défaut, elle DOIT venir du .env (secret).
    llm_api_key: str = ""
    # URL de base de l'API Mistral. En variable pour rester configurable (et
    # pour pouvoir la pointer vers un mock en test), mais avec une valeur par
    # défaut car elle n'a rien de secret.
    mistral_api_base: str = "https://api.mistral.ai/v1"
    # Noms des modèles. Valeurs par défaut fournies (ce ne sont pas des secrets)
    # pour que le service marche « clé en poche » sans avoir à tout remplir.
    # Chacun reste surchargeable depuis le .env.
    llm_model: str = "mistral-small-latest"        # génération de texte (RAG + chat libre)
    embedding_model: str = "mistral-embed"          # vectorisation du corpus (1024 dimensions)
    moderation_model: str = "mistral-moderation-latest"  # modération du chat

    # --- Google Fact Check Tools API (ingestion des fact-checks dans le RAG) ---
    # Clé gratuite (Google Cloud > "Fact Check Tools API"). Secret -> vient du .env.
    google_api_key: str = ""

    # extra="ignore" : on n'échoue pas si l'env contient d'autres variables
    # (POSTGRES_*, JWT_SECRET...) qui ne concernent pas ce service.
    model_config = SettingsConfigDict(extra="ignore")


# Instance unique, importée là où on a besoin de la config.
settings = Settings()
