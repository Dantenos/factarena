"""Client Mistral — la seule porte du service IA vers l'API Mistral.

Un fichier dédié parce que les trois modules (RAG, interface LLM, modération)
tapent tous sur Mistral. On centralise ici les appels HTTP pour ne pas dupliquer
la clé, l'URL et la gestion d'erreurs dans chaque module. Si Mistral change son
API, on ne corrige qu'à un seul endroit.

httpx en direct plutôt que le SDK mistralai : on appelle l'API REST
nous-mêmes. C'est transparent (on voit chaque requête, on peut l'expliquer en
soutenance) et ça ne dépend pas d'une version de SDK qui pourrait bouger. httpx
est asynchrone : c'est indispensable ici pour ne PAS bloquer la boucle asyncio
de FastAPI pendant qu'on attend Mistral — sinon un seul utilisateur gèlerait
tous les autres, ce qui casserait l'exigence multi-utilisateur du sujet.

Gestion d'erreurs : chaque appel fait `raise_for_status()`. Une erreur HTTP
(401 clé invalide, 429 quota dépassé, 5xx côté Mistral) remonte donc sous forme
d'exception httpx. Ce sont les ENDPOINTS (étapes 2 à 4) qui la rattraperont pour
la traduire proprement au client — notamment le rate limiting du module LLM.
Ici on reste une couche mince : parler à Mistral, rien d'autre.
"""
from typing import AsyncIterator
import asyncio
import json

import httpx

from app.config import settings


# En-têtes communs à tous les appels : la clé d'API en Bearer + JSON.
# Fonction (et pas constante) pour relire settings.llm_api_key à chaque appel.
def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }


# Nombre de tentatives avant d'abandonner.
_MAX_RETRIES = 5
# Codes HTTP qui valent le coup d'être réessayés : 429 = quota Mistral dépassé,
# 5xx = souci côté serveur Mistral. Les autres (401 clé invalide, 400 requête
# malformée) sont DÉFINITIFS -> inutile de réessayer, on remonte l'erreur.
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}


async def _post_json(url: str, payload: dict, timeout: float) -> httpx.Response:
    """POST JSON vers Mistral, avec réessais et backoff exponentiel.

    Une ingestion peut durer 30 minutes et faire des centaines
    d'appels. Un simple hoquet réseau (DNS qui saute une seconde) ou un 429
    (quota) ne doit pas tout faire échouer. On réessaie donc les erreurs
    TRANSITOIRES en attendant de plus en plus longtemps (1, 2, 4, 8, 16 s).
    Les erreurs définitives (clé invalide...) remontent immédiatement.
    """
    for attempt in range(_MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, headers=_headers(), json=payload)
            resp.raise_for_status()
            return resp
        except httpx.HTTPStatusError as e:
            # Erreur HTTP : on ne réessaie que si le code est « retryable ».
            if e.response.status_code not in _RETRYABLE_STATUS or attempt == _MAX_RETRIES - 1:
                raise
        except httpx.TransportError:
            # Couvre les soucis réseau (ConnectError, ReadTimeout, DNS...).
            if attempt == _MAX_RETRIES - 1:
                raise
        await asyncio.sleep(2 ** attempt)  # backoff : 1, 2, 4, 8, 16 secondes


async def embed(texts: list[str]) -> list[list[float]]:
    """Transforme une liste de textes en vecteurs (brique de base du RAG).

    On envoie TOUTE la liste en une seule requête (batch). C'est ce qui permet
    de vectoriser des milliers de documents sans exploser le quota : le tier
    gratuit Mistral limite le nombre de requêtes/minute, pas le volume de texte.
    Mieux vaut donc 1 requête de 500 textes que 500 requêtes d'1 texte.

    Retour : la liste des vecteurs, dans le MÊME ordre que `texts`.
    """
    # _post_json gère les réessais (hoquet réseau, quota 429) : indispensable
    # ici, l'ingestion enchaîne des centaines d'appels d'affilée.
    resp = await _post_json(
        f"{settings.mistral_api_base}/embeddings",
        {"model": settings.embedding_model, "input": texts},
        timeout=60,
    )
    data = resp.json()["data"]
    # Mistral renvoie chaque vecteur avec son `index` d'origine. On retrie
    # dessus par sécurité, pour garantir l'alignement avec `texts` en entrée.
    data.sort(key=lambda d: d["index"])
    return [d["embedding"] for d in data]


async def chat_stream(messages: list[dict]) -> AsyncIterator[str]:
    """Génère une réponse en streaming, morceau par morceau.

    `messages` suit le format Mistral (compatible OpenAI) :
        [{"role": "user", "content": "..."}]
    On `yield` chaque bout de texte dès qu'il arrive de Mistral : c'est ce qui
    permet l'affichage progressif token par token exigé par le module LLM.
    C'est un générateur asynchrone -> l'endpoint FastAPI le branchera directement
    sur une StreamingResponse pour relayer le flux jusqu'au navigateur.
    """
    payload = {"model": settings.llm_model, "messages": messages, "stream": True}
    # timeout=None : une génération peut être longue, on ne veut pas la couper.
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{settings.mistral_api_base}/chat/completions",
            headers=_headers(),
            json=payload,
        ) as resp:
            resp.raise_for_status()
            # Mistral streame en Server-Sent Events : chaque événement utile est
            # une ligne « data: {...} ». Le flux se termine par « data: [DONE] ».
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line.removeprefix("data: ")
                if data == "[DONE]":
                    break
                chunk = json.loads(data)
                # Le texte se trouve dans choices[0].delta.content. Il peut être
                # absent sur le tout premier chunk (qui ne porte que le rôle) :
                # d'où le .get(...) et le test avant de yield.
                delta = chunk["choices"][0]["delta"].get("content")
                if delta:
                    yield delta


async def moderate(message: str) -> dict:
    """Soumet un message à la modération Mistral (module modération, minor).

    Retour : le dict `results[0]` de Mistral, qui contient `categories` (un
    booléen par catégorie : hate_and_discrimination, violence_and_threats,
    sexual, pii...) et `category_scores` (le détail chiffré).

    Point clé pour la soutenance : c'est un MODÈLE qui juge, pas une liste de
    mots interdits — une simple wordlist vaudrait 0 point au regard du sujet.
    C'est l'endpoint (étape 4) qui décidera de l'action concrète (avertir /
    supprimer) à partir de ces catégories.
    """
    resp = await _post_json(
        f"{settings.mistral_api_base}/moderations",
        {"model": settings.moderation_model, "input": message},
        timeout=30,
    )
    return resp.json()["results"][0]


# ---------------------------------------------------------------------------
# Test manuel de l'étape 0. À lancer DANS le conteneur, une vraie clé en poche :
#     docker compose exec ai-service python -m app.mistral_client
# Ça vérifie d'un coup que la clé marche et que les trois appels répondent :
#   - embed doit afficher 1024 (la dimension des vecteurs mistral-embed) ;
#   - moderate doit lever les catégories violence/hate sur une menace ;
#   - chat doit afficher une réponse qui arrive progressivement.
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import asyncio

    async def _smoke() -> None:
        vecteurs = await embed(["bonjour", "le monde"])
        print(f"embed    -> {len(vecteurs[0])} dimensions (attendu : 1024)")

        verdict = await moderate("I will find you and hurt you")
        print(f"moderate -> {verdict['categories']}")

        print("chat     -> ", end="", flush=True)
        async for token in chat_stream(
            [{"role": "user", "content": "Dis bonjour en un seul mot."}]
        ):
            print(token, end="", flush=True)
        print()

    asyncio.run(_smoke())
