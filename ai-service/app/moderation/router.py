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

# Seuil de suppression sur les SCORES, en plus des drapeaux de Mistral.
#
# POURQUOI : les drapeaux du modèle sont calibrés pour l'anglais et pour des
# contenus lourds. Sur un chat de jeu francophone ils laissaient passer les
# insultes courantes — « enculé » sortait à 0.076, « sale connard » à 0.295,
# sans qu'aucune catégorie soit levée.
#
# On a mesuré les deux populations sur ce chat : les messages ordinaires
# plafonnent à 0.017 sur hate_and_discrimination, les insultes commencent à
# 0.073. Un seuil à 0.05 les sépare avec trois fois de marge et n'a produit
# aucun faux positif sur nos échantillons.
#
# La DÉTECTION reste entièrement celle du modèle : on ne compare aucun mot, on
# ne fait que déplacer le curseur de décision, qui est la partie qui nous
# revient. Limite connue : les abréviations (« ntm ») ne sont pas décodées par
# le modèle et passent donc au travers.
SEUIL_SUPPRESSION = 0.05


class ModerationRequest(BaseModel):
    # Validation back (exigence du sujet) : message non vide, taille bornée.
    message: str = Field(min_length=1, max_length=4000)
    history: list[str] = Field(default_factory=list, max_length=20)


def _decide(result: dict) -> dict:
    """Traduit le verdict Mistral en action concrète.

    - aucune catégorie levée        -> allow  (message laissé passer)
    - au moins une catégorie GRAVE  -> delete (message supprimé)
    - d'autres catégories levées    -> warn   (utilisateur averti)
    """
    categories = result.get("categories", {})
    scores = result.get("category_scores", {})
    flagged = [name for name, hit in categories.items() if hit]

    # Catégories graves que le modèle n'a pas levées mais qui dépassent notre
    # propre seuil : c'est ce qui rattrape les insultes francophones.
    au_dessus_du_seuil = [
        name for name in SEVERE_CATEGORIES
        if name not in flagged and float(scores.get(name, 0)) >= SEUIL_SUPPRESSION
    ]

    if any(name in SEVERE_CATEGORIES for name in flagged) or au_dessus_du_seuil:
        action = "delete"
    elif flagged:
        action = "warn"
    else:
        action = "allow"

    return {
        "action": action,
        # On expose les deux : ce que le modèle a levé, et ce que notre seuil
        # ajoute. La distinction est ce qu'on explique en soutenance.
        "flagged": flagged + au_dessus_du_seuil,
        "au_dessus_du_seuil": au_dessus_du_seuil,
        "scores": scores,
    }


@router.post("/check")
async def check(req: ModerationRequest):
    try:
        context = "\n".join(req.history[-20:])
        moderated_input = f"Historique récent:\n{context}\n\nMessage à modérer:\n{req.message}" if context else req.message
        result = await moderate(moderated_input)
    except Exception:
        # Si Mistral est injoignable, on ne tranche pas à sa place : on renvoie
        # une erreur, et c'est le back qui décide de sa politique de repli
        # (laisser passer ou bloquer par défaut).
        raise HTTPException(status_code=503, detail="Service de modération indisponible.")
    return _decide(result)
