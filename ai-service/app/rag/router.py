"""Endpoint RAG : POST /rag/ask — question libre -> réponse sourcée en streaming.

C'est la surface Q&A autonome du module RAG (celle qu'on démontre à l'éval).
La chaîne complète :
  question -> recherche des passages les plus proches (search_similar)
           -> on donne ces passages comme CONTEXTE au LLM
           -> le LLM rédige une réponse ANCRÉE sur ce contexte, en streaming
           -> on renvoie d'abord les sources, puis la réponse token par token (SSE)

Ce qui distingue le RAG d'un simple chatbot : le LLM ne répond QUE d'après les
passages fournis. C'est ce qui évite les hallucinations — crucial pour du
fact-checking, où une réponse inventée serait pire que pas de réponse.
"""
import json
import os

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.mistral_client import chat_stream
from app.rag.guardrail import is_blocked
from app.rag.search import search_similar
from app.rate_limit import RateLimiter

router = APIRouter()

# Nombre de passages récupérés pour servir de contexte au LLM. Réglable via
# l'env (RAG_TOP_K) : plus de passages = réponses plus précises et mieux
# sourcées, mais un contexte plus lourd. 6 est un bon compromis.
TOP_K = int(os.getenv("RAG_TOP_K", "6"))

# Rate limiting : /rag/ask appelle aussi Mistral (embeddings + génération), donc
# ça coûte de l'argent -> on le protège comme /llm/chat. Un peu plus permissif
# que le chat libre (une recherche est un usage plus « normal »). Réglable via l'env.
_RATE_MAX = int(os.getenv("RAG_RATE_MAX", "10"))
_RATE_WINDOW = float(os.getenv("RAG_RATE_WINDOW", "30"))
limiter = RateLimiter(_RATE_MAX, _RATE_WINDOW)


class AskRequest(BaseModel):
    # Validation côté BACK (exigence du sujet) : la question doit être non vide
    # et de taille raisonnable. FastAPI renvoie automatiquement un 422 clair si
    # ce n'est pas respecté — le back ne fait jamais confiance à l'entrée.
    question: str = Field(min_length=3, max_length=1000)

    # Contexte de la manche EN COURS, fourni par le Back Core (lui seul tient
    # l'état de la partie). Sert au garde-fou anti-spoil (cf. guardrail.py).
    # Absents/vides hors manche -> le bot répond librement.
    #   - live_topics : les MOTS-THÈMES des clips en jeu (couche 1, thématique) ;
    #   - live_claims : les TEXTES des affirmations en jeu (couche 2, juge LLM).
    # Bornés (une manche ~10 clips) pour ne pas gonfler la requête.
    live_topics: list[str] = Field(default_factory=list, max_length=100)

    # URLs des articles qui ont établi le verdict des clips EN JEU, à écarter de
    # la recherche. Sans ça, demander « est-ce qu'on a déjà teinté la Seine ? »
    # pendant la manche remonte l'article de fact-check du clip, et la réponse
    # donne la solution. Même principe que `exclure_url` sur /second-avis.
    exclure_urls: list[str] = Field(default_factory=list, max_length=30)
    live_claims: list[str] = Field(default_factory=list, max_length=20)


def _build_messages(question: str, passages: list[dict]) -> list[dict]:
    """Construit les messages pour le LLM : une consigne stricte + le contexte.

    On numérote les passages ([1], [2]...) pour que le modèle puisse s'y référer,
    et on lui interdit d'inventer hors de ce contexte.
    """
    contexte = "\n\n".join(
        f"[{i + 1}] {p['title']}\n{p['content']}" for i, p in enumerate(passages)
    )
    # Le corpus ne contient que des fact-checks et des indicateurs officiels : il
    # ne sait pas ce qu'est un orage. Une consigne strictement ancrée faisait donc
    # refuser toute question de culture générale, ce qui rendait le bot inutile
    # pour ce qu'on lui demande le plus souvent. Il répond maintenant de ses
    # propres connaissances quand les passages ne suffisent pas — mais il doit le
    # DIRE, pour qu'on ne prenne pas une réponse non sourcée pour une réponse
    # vérifiée. C'est cette phrase que le front détecte pour masquer les
    # citations, qui n'auraient alors aucun rapport.
    systeme = (
        "Tu es un assistant de fact-checking. Réponds EN FRANÇAIS, de façon concise "
        "et factuelle.\n"
        "Quand les passages fournis couvrent la question, appuie-toi dessus et "
        "renvoie-y explicitement.\n"
        "Quand ils ne la couvrent pas — c'est fréquent, le corpus ne contient que "
        "des vérifications et des statistiques — réponds quand même à partir de tes "
        "propres connaissances, mais commence par « Sans source dans mon corpus : » "
        "afin qu'on sache que cette réponse-là n'est pas vérifiée.\n"
        "N'invente jamais de source ni de citation."
    )
    return [
        {"role": "system", "content": systeme},
        {"role": "user", "content": f"Passages :\n\n{contexte}\n\nQuestion : {question}"},
    ]


def _sse(event: str, data) -> str:
    """Formate un événement Server-Sent Events.

    ensure_ascii=False : on garde les accents français lisibles dans le flux.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _message_erreur(erreur: Exception) -> str:
    """Traduit un échec de génération en une phrase affichable dans le chat.

    Le 429 mérite d'être distingué : c'est le seul cas où le joueur peut agir
    (attendre, ou prévenir l'équipe). On ne promet pas de retour rapide — quand
    la limite du plan tombe à zéro, attendre ne sert à rien.
    """
    if isinstance(erreur, httpx.HTTPStatusError) and erreur.response.status_code == 429:
        return "L'assistant a atteint la limite d'appels de l'IA. Il ne peut pas répondre pour le moment."
    return "La génération a été interrompue."


# Message renvoyé quand le garde-fou bloque (question à propos d'un clip vivant).
# Un refus sec rendait le bot inutile pendant une manche, c'est-à-dire au seul
# moment où on le sollicite. Il ne tranche toujours pas le clip — ce serait
# donner la réponse — mais il propose la méthode, ce qui est le propos du jeu :
# apprendre à juger plutôt que se faire juger à sa place.
_REFUS = (
    "Je ne me prononce pas sur un clip de la manche en cours — ce serait te "
    "donner la réponse. En revanche je peux t'aider à la trouver : demande-moi "
    "comment reconnaître une vidéo générée par IA, un montage, ou une image "
    "authentique sortie de son contexte."
)


def _refusal_stream():
    """Sert le refus dans le MÊME format SSE qu'une réponse normale.

    Le front n'a donc RIEN de spécial à gérer : sources vides + un message +
    done, exactement comme une réponse du bot (mais sans citation). C'est un
    générateur synchrone (aucun await) — StreamingResponse l'accepte tel quel.
    """
    yield _sse("sources", [])
    yield _sse("token", {"text": _REFUS})
    yield _sse("done", {})


class SecondAvisRequest(BaseModel):
    # Le texte de l'affirmation. On ne reçoit JAMAIS le truthLabel : tout
    # l'intérêt est que le modèle se prononce sans connaître la réponse.
    claim: str = Field(min_length=10, max_length=1000)

    # URL de l'article de fact-check dont la claim est issue, à EXCLURE de la
    # recherche. Sans cette exclusion, l'avis n'a aucune valeur : le corpus
    # contient l'article lui-même, et le modèle se contente d'y lire le verdict
    # (« explicitement jugée Vrai dans le passage [1] »). En l'écartant, il doit
    # raisonner sur d'autres sources — exactement ce que fait un joueur.
    exclure_url: str | None = Field(default=None, max_length=500)


CONSIGNE_SECOND_AVIS = (
    "Tu donnes ton avis sur une affirmation, comme le ferait un joueur attentif. "
    "Appuie-toi UNIQUEMENT sur les passages fournis. Si tu n'as pas d'élément, "
    "dis-le franchement plutôt que d'inventer.\n"
    "Réponds exactement ainsi :\n"
    "AVIS: VRAI | FAUX | INCERTAIN\n"
    "POURQUOI: <une seule phrase>"
)


@router.post("/second-avis")
async def second_avis(req: SecondAvisRequest, request: Request):
    """L'IA se prononce sur une affirmation SANS connaître la clé de réponse.

    Ce que fait cet endpoint : à la révélation, on affiche le verdict éditorial —
    celui qui décide du score — puis, à côté, ce que l'IA aurait répondu. Quand
    elle se trompe, ça ne coûte rien au jeu (le score ne dépend pas d'elle) et
    ça montre honnêtement les limites d'une IA face au fact-checking. C'est un
    argument solide en évaluation, et c'est exactement le rôle que la décision
    d'architecture n°1 lui assigne : commenter, jamais arbitrer.

    Le modèle ne reçoit que l'affirmation et les passages du corpus. Il ignore
    le truthLabel, sinon son « avis » n'aurait aucune valeur.
    """
    if not limiter.allow(request.client.host):
        raise HTTPException(status_code=429, detail="Trop de requêtes.")

    try:
        # On demande plus de passages que nécessaire : certains seront écartés.
        passages = await search_similar(req.claim, k=TOP_K + 4)
    except Exception:
        raise HTTPException(status_code=503, detail="Service RAG indisponible (recherche).")

    if req.exclure_url:
        cible = req.exclure_url.rstrip("/")
        passages = [p for p in passages if (p.get("url") or "").rstrip("/") != cible]
    passages = passages[:TOP_K]

    contexte = "\n\n".join(f"[{i + 1}] {p['content']}" for i, p in enumerate(passages))
    messages = [
        {"role": "system", "content": CONSIGNE_SECOND_AVIS},
        {"role": "user", "content": f"Passages :\n\n{contexte}\n\nAffirmation : « {req.claim} »"},
    ]

    try:
        morceaux = [m async for m in chat_stream(messages)]
    except Exception:
        raise HTTPException(status_code=503, detail="Service LLM indisponible.")
    texte = "".join(morceaux).strip()

    # On extrait l'avis pour que le back n'ait pas à analyser du texte libre.
    avis = "INCERTAIN"
    for candidat in ("VRAI", "FAUX", "INCERTAIN"):
        if f"AVIS: {candidat}" in texte.upper():
            avis = candidat
            break
    pourquoi = texte.split("POURQUOI:", 1)[-1].strip() if "POURQUOI:" in texte else texte

    return {
        "avis": avis,
        "pourquoi": pourquoi,
        "citations": [{"title": p["title"], "url": p["url"]} for p in passages],
    }


@router.post("/ask")
async def ask(req: AskRequest, request: Request):
    # Rate limiting : au-delà de la limite, 429 avant tout appel à Mistral.
    if not limiter.allow(request.client.host):
        raise HTTPException(
            status_code=429,
            detail=f"Trop de requêtes (max {_RATE_MAX} par {int(_RATE_WINDOW)}s). Réessayez dans un instant.",
        )

    # 0. Garde-fou anti-spoil, AVANT toute récupération (cf. ai-service/README.md).
    #    Cascade : couche 1 thématique (mots-thèmes, déterministe, sans API) ;
    #    « sinon » couche 2 juge LLM (rattrape les reformulations). On ne l'exécute
    #    que s'il y a une manche à protéger (hors manche -> les listes sont vides).
    if req.live_topics or req.live_claims:
        try:
            blocked = await is_blocked(req.question, req.live_topics, req.live_claims)
        except Exception:
            # Fail-closed : si le juge LLM ne peut pas trancher (Mistral en panne),
            # on refuse plutôt que de risquer un spoil. La couche 1, elle, ne tombe
            # jamais en panne (pur Python).
            raise HTTPException(status_code=503, detail="Garde-fou indisponible, réessayez.")
        if blocked:
            return StreamingResponse(_refusal_stream(), media_type="text/event-stream")

    # 1. Récupération. Si Mistral (embed) ou la base est en panne, ça échoue ICI,
    #    AVANT le streaming : on peut donc renvoyer un vrai code HTTP propre.
    #    On demande plus de passages que nécessaire quand il y en a à écarter.
    marge = TOP_K + 4 if req.exclure_urls else TOP_K
    try:
        passages = await search_similar(req.question, k=marge)
    except Exception:
        raise HTTPException(status_code=503, detail="Service RAG indisponible (recherche).")

    if req.exclure_urls:
        interdits = {u.rstrip("/") for u in req.exclure_urls}
        passages = [p for p in passages if (p.get("url") or "").rstrip("/") not in interdits]
    passages = passages[:TOP_K]

    # Manche en cours : le bot renseigne sur le sujet mais ne se prononce jamais
    # sur l'authenticité d'une vidéo précise — ce serait donner la réponse.
    en_manche = bool(req.live_claims or req.live_topics)
    messages = _build_messages(req.question, passages)
    if en_manche and messages and messages[0].get("role") == "system":
        messages[0] = {
            **messages[0],
            "content": messages[0]["content"]
            + "\n\nUne partie est en cours. Explique le sujet, le contexte et les "
            "techniques de vérification, mais ne dis JAMAIS si une vidéo précise "
            "est authentique ou truquée, même si les passages le laissent penser.",
        }

    async def event_stream():
        # On envoie d'abord les SOURCES : le front peut les afficher tout de
        # suite, avant même que la réponse commence à s'écrire.
        # Un article long donne plusieurs passages : sans dédoublonnage on
        # affichait quatre fois le même lien sous la réponse.
        vues: set[str] = set()
        sources = []
        for p in passages:
            if p["url"] in vues:
                continue
            vues.add(p["url"])
            sources.append({"title": p["title"], "url": p["url"]})
        yield _sse("sources", sources)
        try:
            async for token in chat_stream(messages):
                yield _sse("token", {"text": token})
        except Exception as erreur:
            # Le streaming a déjà commencé : impossible de changer le code HTTP
            # maintenant. On signale donc l'erreur DANS le flux, proprement.
            yield _sse("error", {"message": _message_erreur(erreur)})
            return
        yield _sse("done", {})

    # text/event-stream = le type MIME des Server-Sent Events. nginx laisse déjà
    # passer le streaming (configuré à l'étape infra).
    return StreamingResponse(event_stream(), media_type="text/event-stream")
