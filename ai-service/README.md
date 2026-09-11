# ai-service — FastAPI (LLM, RAG, modération)

Territoire : Tech Lead IA (Python).

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

## Les principes à savoir expliquer

### L'IA n'arbitre jamais le jeu

Le verdict qui décide qui gagne est le `truthLabel` stocké en base, recopié
depuis un fact-checkeur identifié. Le RAG explique un verdict déjà connu, il ne
le produit jamais : le score est reproductible, et une hallucination du modèle
ne peut pas changer l'issue d'une manche. C'est ce qui répond à « ton IA peut
se tromper » : elle peut, mais pas sur le résultat.

### RAG et LLM, deux surfaces distinctes

`/rag/ask` cherche dans le corpus et cite ses passages. `/llm/chat` utilise le
même modèle avec la récupération coupée, plus un limiteur de débit maison et la
gestion du 429 du fournisseur. Les deux majors se démontrent séparément ; le
`@bot` du chat passe par `/rag/ask`, la démo « LLM nu » reste à part.

### Le garde-fou anti-spoil du bot (`app/rag/guardrail.py`)

Pendant une manche, répondre à « le clip 1 est vrai ou faux ? » reviendrait à
divulguer la clé de réponse. Le back joint donc à chaque question deux listes,
`live_topics` et `live_claims`, vides hors manche. Le garde-fou tourne AVANT la
récupération, en deux couches :

1. une expression régulière attrape les demandes explicites de verdict,
   sans appel réseau ;
2. sinon, un juge LLM répond OUI/NON à « cette question reprend-elle une de ces
   affirmations ? », ce qui rattrape les reformulations (« ce grand rapace qui
   saisit un nourrisson, c'est authentique ? » est bloqué sans le mot « aigle »).

Fail-closed : si Mistral ne répond pas, 503 plutôt qu'un spoil. En complément,
`/rag/ask` accepte `exclure_urls` et écarte les articles de fact-check des clips
en jeu, sinon une question sur le thème ramenait le débunk.

Pourquoi pas un seuil sur les embeddings : mesuré, mistral-embed tasse les
scores dans une bande trop étroite (0,78 « pile sur le clip » contre 0,71 « hors
sujet »). Aucun seuil global ne tient.

Le garde-fou ne bloque que les demandes de verdict, pas le thème. Une première
version refusait tout ce qui touchait au sujet d'un clip, et le bot était muet
au seul moment où on le sollicite. Le propos du jeu est d'apprendre à juger,
pas de se faire juger à sa place.

### La modération en deux couches (`app/moderation/`)

1. L'API de modération Mistral, avec notre propre seuil de 0,05 sur les scores.
   Les drapeaux du modèle sont calibrés pour l'anglais et les contenus lourds ;
   le seuil rattrape les insultes francophones qu'il note sans les lever.
2. Un juge LLM, sollicité seulement quand la couche 1 laisse passer. Il ne peut
   que durcir, jamais assouplir.

Pourquoi la couche 2 : les scores notent un contexte d'agression, pas un
registre de langue. « espèce de con » sort à 0,255 et disparaît, « con » seul
tombe à 0,0028, sous le bruit des messages ordinaires (jusqu'à 0,0143). Aucun
seuil ne sépare les deux. Coût assumé : un appel LLM par message propre, borné
à 3 s, sans effet si Mistral est injoignable.

Une troisième couche par liste de mots est écrite mais désactivée, en bas de
`app/moderation/router.py`. Elle n'existe que parce que les deux couches actives
dépendent de la même API. À n'activer que si Mistral est indisponible le jour de
la correction, et en le disant : une liste active donnerait l'impression que la
détection repose dessus plutôt que sur les modèles.

### Un schéma `rag` séparé, dans la même base

Prisma gère mal le type `vector`, et son `db push` supprime toute table qu'il ne
connaît pas dans `public`. Les tables IA vivent donc dans un schéma `rag`, que le
service ouvre avec `search_path = rag,public` (`app/db.py`). Les deux mondes se
parlent par URL et par identifiant, jamais par jointure. La colonne d'embedding
est un `vector(1024)` parce que c'est la dimension de `mistral-embed`.

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
