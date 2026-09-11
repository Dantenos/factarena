"""Garde-fou anti-spoil du bot de chat (`@bot`) — cascade thématique + juge LLM.

Ce fichier existe pour une raison (cf. `docs/AI.md §9` et la décision d'archi n°1) :
si quelqu'un demande « la vidéo de l'aigle, elle est vraie ? » PENDANT que ce clip
est dans la manche en cours, répondre reviendrait à **divulguer la clé de réponse**
du jeu — interdit, l'équité du jeu ne doit jamais dépendre du modèle.

Pas de seuil sémantique sur les embeddings : mesuré, mistral-embed tasse
les scores dans une bande trop étroite (« pile sur le clip » ~0.78 vs « hors sujet »
~0.71, marge ~0.07). Un seuil global (TAU) fuit ou sur-bloque. On l'abandonne.

À la place, DEUX COUCHES (on bloque si l'une des deux dit « oui ») :
  1. **Thématique** (déterministe, sans API) : chaque clip déclare ses mots-thèmes
     (entités/sujets, curés avec le contenu) ; si la question en touche un, refus.
  2. **Juge LLM** (« sinon ») : pour les reformulations que les mots-thèmes ratent,
     on demande au modèle « cette question porte-t-elle sur l'une de ces
     affirmations ? OUI/NON ». Bien plus fiable qu'un cosinus, et ça reste ma partie.

Ce module rend un booléen « bloqué / pas bloqué ». C'est l'endpoint qui, à partir
de là, renvoie le refus ou la vraie réponse RAG. Il tourne AVANT le retrieval.
"""
import re
import unicodedata


def _normalize(text: str) -> str:
    """Minuscule + suppression des accents, pour un matching robuste.

    « Aigle » == « aigle », « bébé » == « bebe ». Décomposition NFD puis on retire
    les marques d'accent (catégorie Unicode Mn).
    """
    text = text.lower()
    text = unicodedata.normalize("NFD", text)
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


# ---------------------------------------------------------------------------
# Couche 1 — thématique (déterministe, aucune API).
# ---------------------------------------------------------------------------
def is_about_live_topics(question: str, live_topics: list[str]) -> bool:
    """La question touche-t-elle un mot-thème d'un clip de la manche en cours ?

    `live_topics` = l'union des mots-thèmes des clips en jeu, fournie par le
    Back Core (curés avec le contenu — cf. `CLAIMS.md`). Matching insensible à la
    casse et aux accents : un mot-thème d'UN mot est cherché en **mot entier**
    (« art » ne matche pas « carte ») ; un mot-thème **multi-mots** est cherché en
    sous-chaîne. Déterministe, aucun appel réseau.
    """
    if not live_topics:
        return False
    q = _normalize(question)
    for topic in live_topics:
        t = _normalize(topic).strip()
        if not t:
            continue
        if " " in t:
            if t in q:  # expression multi-mots -> sous-chaîne
                return True
        elif re.search(rf"\b{re.escape(t)}\b", q):  # mot simple -> mot entier
            return True
    return False


# ---------------------------------------------------------------------------
# Couche 2 — juge LLM (« sinon » : rattrape ce que la couche thématique rate).
# ---------------------------------------------------------------------------
async def judged_about_live_clips(question: str, live_claims: list[str]) -> bool:
    """Demande au LLM si la question porte sur l'une des affirmations de la manche.

    Il ne s'agit PAS de savoir si la question effleure le thème d'un clip — on veut
    justement que le bot renseigne dessus — mais si elle en réclame le VERDICT. Un
    filtre plus large refusait tout pendant une manche, y compris « comment
    reconnaît-on une vidéo générée par IA ? », et rendait le bot inutile au seul
    moment où on le sollicite. `live_claims` = les textes des affirmations en jeu.
    """
    # Import local : garde ce module utilisable hors conteneur pour tester la
    # couche 1 (le juge LLM, lui, a besoin de la clé Mistral).
    from app.mistral_client import chat_stream

    bloc = "\n".join(f"- {c}" for c in live_claims)
    messages = [
        {
            "role": "system",
            "content": (
                "Tu es un filtre anti-spoil pour un jeu de fact-checking. On te donne "
                "les affirmations d'une manche EN COURS. Réponds UNIQUEMENT par OUI ou "
                "par NON, rien d'autre.\n"
                "OUI seulement si la question demande le VERDICT de l'une de ces "
                "affirmations : si elle est vraie, fausse, authentique, truquée, ou si "
                "elle reprend l'affirmation pour la faire confirmer ou infirmer.\n"
                "NON pour tout le reste, y compris quand la question porte sur le même "
                "thème : demander des connaissances générales, du contexte historique, "
                "ou comment vérifier ce genre de vidéo n'est PAS un spoil — c'est même "
                "le but du jeu. En cas de doute sur cette distinction, réponds NON."
            ),
        },
        {
            "role": "user",
            "content": f"Affirmations de la manche :\n{bloc}\n\nQuestion : {question}",
        },
    ]
    parts = [token async for token in chat_stream(messages)]
    return "oui" in _normalize("".join(parts))


# ---------------------------------------------------------------------------
# Tournures qui réclament explicitement le verdict d'un clip en jeu, sans le
# citer. On les attrape avant le juge LLM, qui ne peut pas les reconnaître :
# la question ne ressemble à aucune des affirmations qu'on lui soumet.
_DEMANDE_DE_VERDICT = re.compile(
    r"\b(clip|vid[ée]o|extrait|affirmation|manche)\b[^?]{0,80}"
    r"\b(vrai|faux|authentique|truqu\w*|fake|r[ée]ponse|verdict|r[ée]el\w*)\b"
    r"|\b(vrai|faux|authentique|truqu\w*|fake|r[ée]ponse|verdict)\b[^?]{0,80}"
    r"\b(clip|vid[ée]o|extrait|affirmation|manche)\b",
    re.IGNORECASE,
)


# La décision finale : couche 1 OU couche 2.
# ---------------------------------------------------------------------------
async def is_blocked(
    question: str,
    live_topics: list[str],
    live_claims: list[str],
) -> bool:
    """True -> le bot doit refuser (spoil possible). False -> feu vert pour le RAG.

    Cascade : d'abord la couche thématique (gratuite, instantanée) ; si elle ne
    bloque pas, le juge LLM tranche. Hors manche (rien à protéger) -> False.
    """
    # La couche 1 thématique ne refuse PLUS à elle seule : toucher au sujet d'un
    # clip est justement ce qu'on veut autoriser. Elle sert en amont, où elle
    # déclenche l'exclusion des articles de fact-check.
    if not live_claims:
        return False
    # Demande de verdict formulée en désignant le clip plutôt qu'en reprenant
    # l'affirmation (« le clip 1 est vrai ou faux ? »). Le juge ne la voyait pas
    # passer : rien dans la question ne ressemble aux affirmations qu'on lui
    # donne. Déterministe, donc gratuit et sans faux négatif sur cette tournure.
    if _DEMANDE_DE_VERDICT.search(question):
        return True
    return await judged_about_live_clips(question, live_claims)


# ---------------------------------------------------------------------------
# Test manuel de la COUCHE 1 (aucune clé requise — pur Python) :
#     python3 ai-service/app/rag/guardrail.py
# (La couche 2, le juge LLM, se teste dans le conteneur avec la vraie clé.)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    live = ["aigle", "bébé", "combat", "guerre", "Arma", "chanteuse", "Sahel"]
    questions = [
        "l'aigle qui attrape le bébé c'est réel ?",        # touche « aigle », « bébé »
        "est-ce que le combat de nuit est authentique ?",  # touche « combat »
        "c'est quoi la capitale de l'Australie ?",         # aucun thème
        "comment fonctionne un moteur de recherche ?",     # aucun thème
    ]
    for q in questions:
        flag = "REFUS" if is_about_live_topics(q, live) else "ok"
        print(f"  [{flag:5}] «{q}»")
