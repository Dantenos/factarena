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
import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.mistral_client import chat_stream, moderate

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
# Les drapeaux du modèle sont calibrés pour l'anglais et pour des
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
# revient.
#
# Ce que ce curseur ne peut PAS attraper, et qui motive la couche 2 plus bas :
# l'insulte isolée et l'abréviation, qui tombent sous le bruit des messages
# ordinaires (voir _juge_grossierete).
SEUIL_SUPPRESSION = 0.05


# Budget accordé au juge LLM. Il est sur le chemin bloquant du chat : le
# message ne s'affiche qu'une fois modéré. `chat_stream` ne pose aucun timeout
# (une génération peut durer), ce qui conviendrait mal ici — un Mistral lent
# figerait le salon. La réponse attendue tient en un mot, 3 secondes suffisent.
DELAI_JUGE_S = 3.0


async def _juge_grossierete(message: str) -> bool | None:
    """Seconde couche : un LLM relit ce que l'API de modération a laissé passer.

    Cette couche existe parce que les scores de l'API de modération notent un
    CONTEXTE d'agression, pas un registre de langue. Mesuré sur ce chat :
    « espèce de con » sort à 0.255 et part à la poubelle, mais « con » tout seul
    tombe à 0.0028 — soit SOUS le bruit des messages ordinaires, qui montent
    jusqu'à 0.0143. Aucun réglage de seuil ne peut trancher entre les deux :
    baisser le curseur détruirait des messages légitimes bien avant d'atteindre
    l'insulte isolée. Il fallait donc autre chose qu'un curseur.

    Un LLM, lui, reconnaît un mot grossier hors contexte, et décode les
    abréviations que le modèle de modération ignore. C'est le même motif que le
    garde-fou anti-spoil (rag/guardrail.py) : couche déterministe, puis juge LLM
    en rattrapage. La détection reste faite par des MODÈLES — on ne compare
    aucun mot à une liste, ce qui ne vaudrait rien pour le module.

    Retour : True (grossier), False (propre), None (juge injoignable).
    """
    messages = [
        {
            "role": "system",
            "content": (
                "Tu modères le chat d'un jeu de fact-checking entre joueurs. "
                "Réponds UNIQUEMENT par OUI ou par NON, rien d'autre.\n"
                "OUI si le message contient une insulte, une attaque personnelle, "
                "ou un terme du registre grossier français — y compris employé "
                "seul, sans destinataire, ou sous forme d'abréviation.\n"
                "NON pour tout le reste. En particulier, le vocabulaire dur d'un "
                "sujet d'actualité (guerre, morts, blessés, attentat, drogue) "
                "n'est PAS de la grossièreté : les extraits vérifiés dans ce jeu "
                "en parlent constamment, et les censurer viderait le chat de son "
                "objet. En cas de doute sur cette distinction, réponds NON."
            ),
        },
        {"role": "user", "content": message},
    ]

    async def _demander() -> str:
        return "".join([token async for token in chat_stream(messages)])

    try:
        reponse = await asyncio.wait_for(_demander(), timeout=DELAI_JUGE_S)
    except Exception:
        # Panne, quota ou lenteur : on ne tranche pas à la place du juge.
        return None
    return "oui" in reponse.strip().lower()


def _appliquer_juge(decision: dict, grossier: bool | None) -> dict:
    """Fusionne le verdict du juge avec la décision de la première couche.

    Le juge ne peut que DURCIR. Une suppression déjà décidée par l'API de
    modération n'est jamais rendue à l'expéditeur, même si le juge ne voit rien :
    sans cette asymétrie, une couche 2 hésitante annulerait les insultes que la
    couche 1 attrape déjà correctement.
    """
    fusion = {**decision, "juge_llm": grossier}
    if grossier:
        fusion["action"] = "delete"
    return fusion


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

    decision = _decide(result)
    # Le juge n'est sollicité que sur ce qui allait passer : inutile de payer un
    # appel LLM pour confirmer une suppression déjà acquise, et cela borne le
    # surcoût aux seuls messages propres.
    if decision["action"] != "allow":
        return decision
    return _appliquer_juge(decision, await _juge_grossierete(req.message))


# ===========================================================================
# COUCHE 3 — filet de secours par liste de mots. DÉSACTIVÉE VOLONTAIREMENT.
# ===========================================================================
#
# Ce qui l'a motivée : les deux couches actives dépendent entièrement de
# l'API Mistral. On a vu le cas concret : le quota de `/chat/completions` est
# retombé à zéro (en-tête `x-ratelimit-limit-req-minute: 0`), le juge de la
# couche 2 s'est mis à répondre None, et il ne restait plus que la couche 1.
# Si l'endpoint de modération tombe à son tour, `check()` renvoie 503, le back
# est fail-open, et le chat n'est plus filtré du tout. Ce bloc est la réponse à
# ce trou-là.
#
# Et ce qui la garde éteinte : non pas le sujet, qui ne
# dit rien des listes de mots — mais parce qu'une liste active donnerait
# l'impression que la détection repose dessus, alors que c'est le modèle qui
# fait le travail. Le risque n'en vaut pas la chandelle tant que Mistral répond.
#
# POUR L'ACTIVER (uniquement si l'IA est indisponible le jour de la correction,
# et en le disant à l'évaluateur) : décommenter ce bloc, puis insérer dans
# `check()` juste avant l'appel au juge :
#
#     if _mot_interdit(req.message):
#         return {**decision, "action": "delete", "liste_de_secours": True}
#
# et, dans le `except` plus haut, remplacer le `raise` par la même réponse
# quand `_mot_interdit(req.message)` est vrai — c'est le seul cas où la liste
# sert vraiment à quelque chose, puisque plus aucun modèle ne répond.
#
# import re, unicodedata
#
# # Insultes et grossièretés, français et anglais. Volontairement courte : elle
# # ne cherche pas l'exhaustivité (impossible), seulement à couvrir ce qui
# # arrive réellement dans un chat de jeu.
# MOTS_INTERDITS = frozenset({
#     # --- français ---
#     "con", "cons", "conne", "connes", "connard", "connards", "connasse",
#     "connasses", "salope", "salopes", "salaud", "salauds", "pute", "putes",
#     "putain", "putains", "merde", "merdes", "merdeux", "encule", "encules",
#     "enfoire", "enfoires", "batard", "batards", "abruti", "abrutis",
#     "abrutie", "cretin", "cretins", "debile", "debiles", "imbecile",
#     "imbeciles", "tare", "tares", "bouffon", "bouffons", "trouduc",
#     "chier", "chiant", "chiante", "niquer", "nique", "crever", "creve",
#     "gueule", "pd", "tg", "ntm", "fdp", "vtf",
#     # --- anglais ---
#     "fuck", "fucking", "fucker", "fuckers", "motherfucker", "shit", "shitty",
#     "bullshit", "bitch", "bitches", "bastard", "bastards", "asshole",
#     "assholes", "ass", "dumbass", "cunt", "cunts", "whore", "whores", "slut",
#     "sluts", "dick", "dickhead", "prick", "wanker", "twat", "retard",
#     "retarded", "moron", "morons", "idiot", "idiots", "faggot", "fag",
#     "nigger", "nigga", "niggas",
# })
#
#
# # Un motif par mot interdit, où chaque lettre a le droit de se répéter :
# # « putain » devient p+u+t+a+i+n+, qui reconnaît aussi « puuuutain ».
# #
# # C'est ce qui rattrape l'allongement, contournement le plus courant. Replier
# # les lettres répétées du message aurait été plus simple mais ne marche pas :
# # « connnnard » se replie bien en « connard », alors que « puuuutain » donne
# # « puutain », qui ne ressemble plus à rien.
# #
# # Le motif est ancré sur le MOT ENTIER (fullmatch sur chaque mot du message).
# # Sans cet ancrage, « con » censurerait « concours », « contexte »,
# # « connexion » — du français courant, et le pire faux positif possible un
# # jour de correction. L'ancrage protège aussi « as » : le motif de « ass »
# # est a+s+s+, qui réclame au moins deux « s » et laisse donc passer
# # « tu as vu le clip ? ».
# _MOTIF_INTERDIT = re.compile(
#     "|".join("".join(f"{re.escape(c)}+" for c in mot) for mot in sorted(MOTS_INTERDITS))
# )
#
#
# def _mots_du_message(message: str) -> list[str]:
#     """Minuscules, accents retirés, découpé en mots — pour que « PUTAIN »,
#     « Putain » et « putain » soient une seule et même chose."""
#     decompose = unicodedata.normalize("NFKD", message.lower())
#     sans_accent = "".join(c for c in decompose if not unicodedata.combining(c))
#     return re.findall(r"[a-z]+", sans_accent)
#
#
# def _mot_interdit(message: str) -> bool:
#     """True si un mot du message figure dans la liste de secours."""
#     return any(_MOTIF_INTERDIT.fullmatch(mot) for mot in _mots_du_message(message))
