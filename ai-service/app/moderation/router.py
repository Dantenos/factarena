"""Endpoint modération : POST /moderation/check — décide quoi faire d'un message.

C'est le module « modération IA » du sujet (minor). Le principe qui rapporte les
points : c'est un MODÈLE qui détecte le contenu problématique (l'API de
modération Mistral), PAS une liste de mots interdits — une wordlist vaudrait 0.

Rôle de cet endpoint : le back NestJS l'appelle pour chaque message du chat du
salon. On renvoie une DÉCISION claire (allow / warn / delete) que le back n'a
plus qu'à appliquer. La détection vient de Mistral ; la POLITIQUE (quelle
catégorie mène à quelle action) est décidée ici, et c'est ça qu'on explique en
soutenance.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.mistral_client import moderate

router = APIRouter()

# Catégories jugées GRAVES -> on supprime le message directement.
# Les autres catégories levées (santé, finance, droit, pii...) sont moins
# frontales dans un chat de jeu : on se contente d'un avertissement.
# On compare par sous-ensemble : robuste si Mistral ajoute/renomme des catégories
# (on ne casse pas, on traite juste les nouvelles comme « à avertir »).
SEVERE_CATEGORIES = {
    "hate_and_discrimination",
    "violence_and_threats",
    "sexual",
    "dangerous_and_criminal_content",
    "selfharm",
}


class ModerationRequest(BaseModel):
    # Validation back (exigence du sujet) : message non vide, taille bornée.
    message: str = Field(min_length=1, max_length=4000)


def _decide(result: dict) -> dict:
    """Traduit le verdict Mistral en action concrète.

    - aucune catégorie levée        -> allow  (message laissé passer)
    - au moins une catégorie GRAVE  -> delete (message supprimé)
    - d'autres catégories levées    -> warn   (utilisateur averti)
    """
    categories = result.get("categories", {})
    flagged = [name for name, hit in categories.items() if hit]

    if not flagged:
        action = "allow"
    elif any(name in SEVERE_CATEGORIES for name in flagged):
        action = "delete"
    else:
        action = "warn"

    return {
        "action": action,
        "flagged": flagged,                          # catégories levées (traçabilité)
        "scores": result.get("category_scores", {}),  # détail chiffré (transparence)
    }


@router.post("/check")
async def check(req: ModerationRequest):
    try:
        result = await moderate(req.message)
    except Exception:
        # Si Mistral est injoignable, on ne tranche pas à sa place : on renvoie
        # une erreur, et c'est le back qui décide de sa politique de repli
        # (laisser passer ou bloquer par défaut).
        raise HTTPException(status_code=503, detail="Service de modération indisponible.")
    return _decide(result)
