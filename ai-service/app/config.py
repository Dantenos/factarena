"""Chargement de la configuration depuis les variables d'environnement.

POURQUOI ce fichier : on centralise ici la lecture de l'environnement
(pydantic-settings) pour ne JAMAIS coder en dur une URL de base ou une clé
d'API. Les valeurs proviennent du .env, injecté par docker compose.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Base de données partagée (pgvector) — utilisée plus tard par le RAG.
    database_url: str = ""
    # Fournisseur LLM : clé + modèle (renseignés dans .env).
    llm_api_key: str = ""
    llm_model: str = ""

    # extra="ignore" : on n'échoue pas si l'env contient d'autres variables
    # (POSTGRES_*, JWT_SECRET...) qui ne concernent pas ce service.
    model_config = SettingsConfigDict(extra="ignore")


# Instance unique, importée là où on a besoin de la config.
settings = Settings()
