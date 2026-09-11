# AI.md — feuille de route Tech IA (FastAPI + Mistral)

Doc de travail du service IA. Il couvre **mes trois modules** (RAG, interface LLM, modération),
l'ordre dans lequel je les construis, et les décisions techniques prises avant de coder.

La source de vérité reste le sujet officiel remis par l'école. L'archi d'ensemble est dans
`docs/ARCHITECTURE.md` (voir surtout §3 « les trois pièges à points » et §5.2 la frontière
Prisma / vecteurs). Ici je descends au niveau de MA partie.

Choix d'équipe acté : **le fournisseur LLM est Mistral** (API La Plateforme). Raison : ils
couvrent mes trois besoins avec une seule clé — embeddings, chat en streaming, et une API de
modération à base de modèle (pas une wordlist, ce que le sujet exige).

---

## 1. Ce que je dois livrer

Trois modules, 5 points, définis au chapitre IV.4 du sujet :

| Module | Type | Pts | Exigence exacte (sujet IV.4) |
|---|---|---|---|
| RAG complet | Major | 2 | « large dataset », l'utilisateur pose des questions, récupération de contexte + génération de réponse |
| Interface LLM (streaming) | Major | 2 | génération à partir d'une saisie utilisateur, **streaming**, gestion d'erreurs **ET rate limiting** |
| Modération IA | Minor | 1 | auto-modération / auto-suppression / auto-warning |

### Les trois pièges à points (à ne jamais oublier)

1. **RAG et LLM doivent être PROUVÉS distincts.** 4 points en jeu. Si un évaluateur les voit
   comme « la même chose », il fusionne deux majors en un. Il me faut deux surfaces
   visiblement différentes (voir §4, étapes 2 et 3).
2. **Le RAG doit ingérer un large dataset** — des milliers de documents, pas vingt. Ne jamais
   présenter le corpus comme « petit ».
3. **La modération agit par modèle**, pas par liste de mots interdits. Attention, c'est notre
   choix, pas une règle : relu ligne à ligne, le sujet dit seulement « Content moderation AI
   (auto moderation, auto deletion, auto warning, etc.) » et n'interdit nulle part les listes
   de mots. On tient quand même au modèle — c'est le seul angle qui rende le module
   défendable comme un module d'IA. L'API Mistral règle ça.

### Le principe qui protège tout le reste

Le RAG **explique** un verdict déjà connu (le `truthLabel` éditorial stocké en base), il ne
**décide jamais** qui gagne au jeu. Mon `ClaimVerdict` est **display only**. Je ne laisse
jamais l'IA trancher le score : c'est la décision d'archi n°1 de `ARCHITECTURE.md`, et c'est
elle qui neutralise l'attaque « ton IA peut halluciner le résultat ».

---

## 2. Ce que Mistral apporte, module par module

Deux points vérifiés sur la doc Mistral (à re-checker au moment de coder, ça peut bouger) :

- **Embeddings** : le modèle `mistral-embed` sort des vecteurs de **1024 dimensions**.
  Conséquence directe : ma colonne pgvector est `vector(1024)`. Ce chiffre doit correspondre
  EXACTEMENT au modèle, sinon l'insertion échoue.
- **Modération** : Mistral a une **API de modération dédiée** (modèle Ministral 8B), qui
  classe le texte en 9 catégories et sait juger le dernier message dans son contexte
  conversationnel. C'est exactement « auto-modération par modèle » — pas une wordlist.

| Mon besoin | L'API Mistral utilisée |
|---|---|
| RAG — vectoriser le corpus et les questions | Embeddings (`mistral-embed`, 1024 dim) |
| RAG + LLM — générer la réponse | Chat Completions en streaming (SSE) |
| LLM — prouver le rate limit / les erreurs | Le 429 renvoyé par l'API quand je tape trop vite |
| Modération — chat du salon | Moderation API (endpoint conversationnel) |

---

## 3. Décisions techniques prises AVANT de coder

**Le driver base de données devient justifié.** Au stade infra, on avait activé pgvector via
un script SQL (`postgres/init/01-pgvector.sql`) pour éviter d'ajouter un driver Python juste
pour une ligne. Maintenant que je vais **écrire et lire des vecteurs**, ce driver est
légitime : j'ajoute `psycopg` (ou SQLAlchemy) à `requirements.txt`, avec un commentaire qui
explique pourquoi (règle du projet : pas de dépendance non justifiée).

**La table `Document` m'appartient.** Elle est gérée par FastAPI, PAS par Prisma (frontière
de `ARCHITECTURE.md` §5.2 : Prisma gère mal le type `vector`). Schéma cible :

```
Document
  id           serial primary key
  title        text
  url          text          -- sert de citation/source dans les réponses RAG
  content      text          -- le chunk de texte
  chunk_index  int           -- position du chunk dans le document d'origine
  embedding    vector(1024)  -- le vecteur mistral-embed
```

Index de similarité à créer une fois le corpus chargé (sinon la recherche scanne tout) :
```sql
CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops);
```

**Le corpus « large ».** Dataset fact-check public : LIAR, FEVER, ou un sous-ensemble
Wikipédia. À m'assigner tôt — `ARCHITECTURE.md` prévient que la tâche « contenu » est
sous-estimée. Objectif chiffré : `SELECT count(*) FROM documents` doit afficher des milliers
de lignes.

**Deux niveaux de rate limiting.** Le sujet exige que J'implémente un rate limit, pas
seulement que je subisse celui de Mistral. Donc :
- un limiteur côté FastAPI sur mon endpoint LLM (ex. `slowapi`, ou un compteur en mémoire) ;
- **plus** la gestion propre du 429 renvoyé par Mistral.
Je montre les deux à l'évaluation.

**Les secrets dans `.env`.** `LLM_API_KEY` et `LLM_MODEL` existent déjà. À ajouter
probablement : `EMBEDDING_MODEL=mistral-embed`. Je ne commite jamais la vraie clé
(`.env` est gitignoré, `.env.example` porte les clés vides).

**La règle d'or réseau.** Le front ne me parle JAMAIS directement. C'est le back NestJS qui
appelle mes endpoints sur `http://ai-service:8000` (réseau Docker interne). J'expose une API
interne propre, il fait le relais et gère l'auth.

---

## 4. Ordre de construction

> Avancement : TOUTES les étapes du service IA sont FAITES et testées.
> - Étape 0 : client Mistral (embed / chat_stream / moderate) + retry.
> - Étape 1 : corpus — 142K passages généralistes (dump) + ingestion politique
>   ciblée (API Wikipédia, texte à jour, source `wikipedia_fr_politique`).
> - Étape 2 : endpoint `POST /rag/ask` — réponse sourcée en streaming (SSE).
> - Étape 3 : endpoint `POST /llm/chat` — chat libre en streaming SANS retrieval
>   (distinction RAG/LLM), + rate limiting (429) + validation.
> - Étape 4 : endpoint `POST /moderation/check` — décision allow/warn/delete par
>   modèle Mistral (pas de wordlist).
>
> Les 3 modules IA (RAG major, LLM major, modération minor = 5 pts) sont couverts
> côté service.
>
> Durcissement fait : sonde /ready (base + corpus), rate limit aussi sur /rag/ask,
> avertissement au boot si la clé manque, suite pytest (8 tests : logique pure +
> validation des endpoints) lançable via `docker compose exec ai-service python -m pytest`.
> Script de démo : `python -m app.rag.demo_factcheck`.
>
> Reste le branchement depuis le back NestJS (relais vers ces endpoints) et le
> pipeline X-Fact -> table Claim (avec le Back Core).

### Étape 0 — le socle (~0,5 j)
Ajouter le driver DB + le client Mistral à `requirements.txt`. Écrire `app/mistral_client.py`
qui lit la clé depuis `config.py` et expose trois fonctions : `embed(texts)`,
`chat_stream(messages)`, `moderate(messages)`. Tester chacune au `curl` avant d'aller plus
loin. Rien d'autre ne démarre tant que ces trois briques ne répondent pas.

### Étape 1 — ingestion du corpus (RAG, partie 1)
Un script qui : charge le dataset → découpe en chunks → appelle `embed()` → insère dans
`Document`. C'est le « large dataset ». Vérif finale : `SELECT count(*)` = des milliers.
Vit dans `app/rag/`.

### Étape 2 — recherche + génération (RAG, partie 2)
Endpoint `POST /rag/ask` :
```
question -> embed(question) -> recherche pgvector (ORDER BY embedding <-> $1 LIMIT k)
         -> injecter les k chunks comme contexte -> chat_stream()
         -> réponse sourcée (les url des chunks = citations)
```
C'est **ma surface Q&A autonome**, celle que je démontre en direct. Vit dans `app/rag/`.

### Étape 3 — interface LLM en streaming (2e major, DISTINCT)
Endpoint `POST /llm/chat` : saisie libre → `chat_stream()` **sans aucune récupération**.
C'est ici que je prouve la distinction avec le RAG : même modèle, mais retrieval **désactivé**.
J'ajoute le rate limit + la gestion d'erreurs, et je sais déclencher un vrai 429 en live.
Vit dans `app/llm/`.

### Étape 4 — modération (le minor)
Endpoint `POST /moderation/check` : prend un message de chat → appelle la Moderation API de
Mistral → renvoie une décision (OK / warn / delete). Le back l'appelle pour chaque message du
salon. Dépend du chat (module 3, côté Back Core) : à coordonner avec lui. Vit dans
`app/moderation/`.

La décision se prend en **deux couches**, et c'est ce qu'il faut savoir expliquer :

1. La Moderation API, plus notre propre seuil sur les scores (0.05). Les drapeaux du modèle
   sont calibrés pour l'anglais et pour des contenus lourds ; le seuil rattrape les insultes
   francophones que le modèle note sans les lever.
2. Un **juge LLM**, sollicité uniquement quand la couche 1 laisse passer. Il ne peut que
   durcir, jamais assouplir.

Pourquoi la couche 2 est nécessaire : les scores notent un *contexte d'agression*, pas un
registre de langue. Mesuré sur ce chat, « espèce de con » sort à 0.255 et disparaît, mais
« con » employé seul tombe à 0.0028 — sous le bruit des messages ordinaires, qui montent
jusqu'à 0.0143. Aucun réglage de seuil ne sépare les deux : baisser le curseur détruirait des
messages légitimes bien avant d'atteindre l'insulte isolée. Un LLM, lui, reconnaît un mot
grossier hors contexte et décode les abréviations que le modèle de modération ignore.

Dans les deux couches, ce sont des **modèles** qui détectent — on ne compare aucun mot à une
liste. La politique (quel signal mène à quelle action) est la part qui nous revient.

Coût assumé : un appel LLM de plus par message propre, sur le chemin bloquant du chat. Borné
à 3 s, et sans effet si Mistral est injoignable (même politique fail-open que le back).

Même motif que le garde-fou anti-spoil de `rag/guardrail.py` : couche déterministe, puis juge
LLM en rattrapage.

**Une troisième couche existe dans le fichier, entièrement commentée** : une liste de mots
interdits (français + anglais). Elle est écrite parce que les deux couches actives dépendent
toutes les deux de l'API Mistral — on a vu le quota de `/chat/completions` retomber à zéro,
et si l'endpoint de modération tombe aussi, le chat n'est plus filtré du tout. Elle reste
désactivée par choix : le sujet ne l'interdit pas, mais en laisser une active donnerait
l'impression que la détection repose dessus plutôt que sur les modèles.
À n'activer que si l'IA est indisponible le jour de la correction, et en le disant. Le mode
d'emploi est dans le commentaire, en bas de `app/moderation/router.py`.

### Étape 5 — branchement au back
Le back NestJS appelle mes endpoints sur `http://ai-service:8000`. J'expose une API interne
propre ; lui fait le relais vers le front et gère l'authentification. Aucun appel direct
front -> IA.

---

## 5. Où va mon code (rappel de l'arbo)

```
ai-service/
├── app/
│   ├── main.py            # app FastAPI + route /health (déjà là)
│   ├── config.py          # lecture des variables d'env (déjà là)
│   ├── mistral_client.py  # (à créer) embed / chat_stream / moderate
│   ├── rag/               # ingestion du corpus + endpoint /rag/ask
│   ├── llm/               # endpoint /llm/chat (streaming, rate limit)
│   └── moderation/        # endpoint /moderation/check
├── requirements.txt       # + driver DB + client Mistral (à justifier)
└── Dockerfile             # déjà prêt (uvicorn, user non-root)
```

Les trois dossiers `rag/`, `llm/`, `moderation/` existent déjà en squelette (un `__init__.py`
vide + un README d'une ligne). C'est là que je code.

---

## 6. Check-list de démonstration (jour de l'éval)

Ce qui transforme « j'ai codé » en « je marque les points » :

- [ ] `SELECT count(*)` sur le corpus -> des **milliers** de documents.
- [ ] Q&A RAG en direct : une question -> une réponse **avec ses sources**.
- [ ] Interface LLM : saisie libre -> réponse **qui s'affiche token par token**.
- [ ] Preuve de distinction RAG/LLM : montrer le LLM qui tourne **retrieval coupé**.
- [ ] Déclencher un **vrai 429** en live (spammer l'endpoint) -> gestion propre, pas un crash.
- [ ] Modération : envoyer un message toxique -> **auto-action** visible, et expliquer que
      c'est un modèle qui décide, pas une liste de mots.
- [ ] Bot questionnable dans le chat : `@bot` -> réponse **sourcée qui s'affiche en streaming** ;
      et vérifier qu'il **refuse de spoiler** un clip de la manche en cours (protège la décision n°1).
- [ ] Savoir **expliquer** chaque brique (exigence du chapitre I : je livre ce que je
      comprends et j'assume).

---

## 7. Décisions actées

- **Corpus RAG = Wikipédia FR (sous-ensemble)**. Couvre science / histoire / sciences
  humaines / politique, en français. On en ingère ~2000 articles (réglable), vectorisés
  avec mistral-embed. Ingestion : `app/rag/ingest.py`.
- **X-Fact FR = claims du JEU, pas du RAG.** Les fact-checks politiques réels alimenteront la
  table `Claim` de Prisma (clé de réponse `truthLabel`), côté Back Core. Tâche SÉPARÉE, à
  faire après que le RAG marche, **en coordination avec le Back Core**.
- **Table `documents`** (mienne, FastAPI) : `source, title, url, content, chunk_index,
  embedding vector(1024)`. Index HNSW cosinus. Voir `app/db.py`.

## 8. Ce que ces questions sont devenues

- Modèle de chat Mistral et format du streaming : `chat/completions` en SSE, terminé par
  `data: [DONE]`.
- Volume du corpus : 1 653 passages livrés avec le dépôt, vecteurs pré-calculés, chargés au
  premier démarrage si l'index est vide.
- Alimentation de la table `Claim` : finalement pas X-Fact mais l'API Google Fact Check
  Tools, lancée à la main depuis `app.rag.ingest_claimreview`. Le résultat est figé dans
  `editorial-claims.generated.json`, versionné, donc personne n'a besoin de clé Google.

---

## 9. Le bot interrogeable dans le chat

Dans le chat du salon, un joueur interroge l'IA — `@bot` ou `/ask <question>` — et reçoit une
réponse **streamée et sourcée**. Pourquoi c'est malin pour
MOI : ça donne enfin une **surface vivante** à mon module LLM et à mon RAG, au lieu d'un simple
champ de test. Le même chat porte donc deux de mes modules : la **modération** (passive) et
l'**interrogation** (active).

### Ce que ça réutilise (rien de neuf à inventer)
- Question factuelle → mon endpoint **`/rag/ask`** existant : réponse ancrée sur le corpus,
  avec citations (AFP, franceinfo, Wikipédia…). C'est ma surface Q&A, juste déclenchée depuis
  le chat.
- Le back relaie `@bot` vers `ai-service:8000` (jamais le front en direct, cf. règle d'or §3)
  et poste la réponse dans le chat comme un message d'un utilisateur « FactBot ».

### Les deux garde-fous (sinon je casse deux modules)
1. **Le bot n'arbitre JAMAIS la manche en cours** (décision n°1). Si quelqu'un demande « le
   clip 3 est fake ? » pendant le vote, répondre = **divulguer la clé de réponse** et laisser
   l'IA trancher le gain. Interdit. Dès qu'une question porte sur un clip en jeu, le bot refuse
   (« je ne commente pas ça pendant la manche 🤐 »). Le verdict + l'explication sourcée ne
   sortent **qu'à la révélation** (là, le bot PEUT poster l'explication RAG).

   > **⚠️ On a d'abord essayé un seuil SÉMANTIQUE (embeddings) — abandonné.** Mesuré en vrai :
   > mistral-embed tasse les scores dans une bande trop étroite (« pile sur le clip » ~0.78 vs
   > « hors sujet » ~0.71, marge ~0.07). Un seuil global (TAU) fuit ou sur-bloque. Pas de TAU
   > fiable → on change d'approche.

   → **Implémentation retenue = CASCADE (`app/rag/guardrail.py`, branché dans `/rag/ask`) :**
   ```
   is_blocked(question, live_topics, live_claims):
       # Couche 1 — THÉMATIQUE (déterministe, sans API) :
       if is_about_live_topics(question, live_topics): return True
       # Couche 2 — JUGE LLM (« sinon », rattrape les reformulations) :
       return await judged_about_live_clips(question, live_claims)
   ```
   - **Couche 1** : chaque clip déclare ses **mots-thèmes** (entités/sujets, curés avec le
     contenu — cf. `CLAIMS.md`). Matching insensible casse/accents, mot entier ou expression.
     Gratuit, instantané, 100 % explicable. Attrape l'évident.
   - **Couche 2** : pour les reformulations qui esquivent les mots-thèmes, on demande au LLM
     « cette question porte-t-elle sur l'une de ces affirmations ? OUI/NON (OUI en cas de doute) ».
     Bien plus fiable qu'un cosinus. **Testé** : « ce grand rapace qui saisit un nourrisson,
     c'est authentique ? » (sans « aigle » ni « bébé ») → bloqué.
   - Tourne **AVANT** le retrieval (sinon `/rag/ask` retrouverait l'article fact-check du clip
     et répondrait). **Fail-closed** : si le juge LLM tombe (Mistral en panne) → 503, pas de spoil.
   - **Ceinture + bretelles (pas encore branché) :** au retrieval, exclure aussi les docs des
     clips vivants (`WHERE claim_id NOT IN (...)`) — même si les deux couches laissent passer,
     le clip n'est jamais cité.
2. **RAG vs LLM restent démontrablement distincts** (piège n°1). Le `@bot` sourcé = le RAG
   (`/rag/ask`). Je garde `/llm/chat` (retrieval coupé) comme surface séparée pour prouver le
   LLM seul et déclencher un vrai 429. Le chat ne brouille pas les deux : une commande sourcée
   cite toujours, la démo « LLM nu » reste à part.

### Le bonus points
IV.4 exige un **rate limit** sur l'interface LLM. Un bot qu'on peut spammer avec `@bot` en a
besoin de toute façon → mon limiteur FastAPI devient **démontrable dans un usage naturel**
(plusieurs `@bot` d'affilée → 429 géré proprement, un « doucement 😅 » posté dans le chat au
lieu d'un crash).

### Ce que ça me coûte à coder
- **FAIT — le garde-fou en cascade** (`app/rag/guardrail.py` + branchement dans `/rag/ask`,
  8 tests pytest verts), puis **recentré** : il refusait tout ce qui touchait au thème d'un
  clip, donc le bot était muet pendant toute la manche — c'est-à-dire au seul moment où on
  le sollicite. Il ne refuse plus que les **demandes de verdict** : une tournure explicite
  (« le clip 1 est vrai ou faux ? ») attrapée par une expression régulière, ou une question
  qui reprend l'affirmation, tranchée par le juge LLM. Le reste passe, et le bot renseigne
  sur le sujet — c'est le propos du jeu : apprendre à juger, pas se faire juger à sa place.
- **FAIT — l'exclusion au retrieval** : `/rag/ask` accepte `exclure_urls` et écarte les
  articles de fact-check des clips en jeu, avec un `k` élargi pour compenser. Même motif que
  `exclure_url` sur `/second-avis`. Sans ça, une question sur le sujet ramenait le débunk et
  donnait la réponse. Réserve assumée : une autre source du corpus peut couvrir le même fait,
  le risque est réduit, pas annulé.
  Tout le reste (`/rag/ask`, streaming, rate-limit) existait déjà.
- **Le contrat avec le Back Core** : sa requête `@bot` sur `/rag/ask` m'apporte deux listes des
  clips de la manche ouverte — `live_topics` (mots-thèmes, couche 1) et `live_claims` (textes,
  couche 2). Vides hors manche. C'est lui qui tient l'état de la manche ; moi je tranche.
- **Côté Back Core** (pas moi) : détecter `@bot` / `/ask` dans un message, m'appeler avec ces
  deux listes, et poster ma réponse dans le flux WebSocket du chat.
- **Côté contenu / Back Core** : chaque `Claim` a besoin de ses **mots-thèmes** (`themeTags`),
  curés avec le reste de la fiche — cf. `CLAIMS.md`.

---

*Sources Mistral : docs.mistral.ai/capabilities/embeddings (dimension 1024) et
mistral.ai/news/mistral-moderation (API de modération par modèle). Document vivant : je le
mets à jour à chaque décision.*
