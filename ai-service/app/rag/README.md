# Module RAG — récupération augmentée

Récupération augmentée (RAG) : corpus indexé dans pgvector, recherche de
similarité, réponses sourcées (module IA « RAG »).

## Corpus choisi

**Wikipédia FR (sous-ensemble)** comme corpus que l'IA fouille pour ancrer ses
explications. Il couvre nos domaines (science, histoire, sciences humaines,
politique), en français. On en ingère quelques milliers d'articles : assez pour
un « large dataset » sans re-vectoriser tout Wikipédia.

> X-Fact (fact-checks politiques réels en français) n'est **pas** dans ce corpus :
> il alimentera les claims du JEU (table `Claim` de Prisma, côté Back Core). C'est
> une tâche séparée, à faire en coordination avec le Back Core.

## Les sources du corpus

La table `documents` a une colonne `source` qui distingue les corpus :

- **`wikipedia_fr`** — sous-ensemble généraliste du dump Wikipédia (`ingest.py`).
  Couvre tous les domaines, mais daté (snapshot 2023). Pour EXPLIQUER des faits.
- **`wikipedia_fr_politique` / `_histoire` / `_religion` / `_sciences`** —
  articles thématiques via l'API Wikipédia (`ingest_themes.py`), texte **à jour**.
  Chaque thème cible sa catégorie-portail (Politique française + Cinquième
  République, Histoire, Religions et croyances, Sciences). Une `source` par thème.
- **`eurostat`** — indicateurs chiffrés officiels (chômage, dette, déficit,
  inflation, croissance...) récupérés en **données structurées** via l'API
  Eurostat (`ingest_eurostat.py`). Pour CONTREDIRE un chiffre avec une source.
- **`data_gouv`** — quelques indicateurs curés à la main (`ingest_indicateurs.py`),
  dont certains marqués « à vérifier ».

Toutes cohabitent : `/rag/ask` cherche dans l'ensemble. Les sources chiffrées
permettent de contredire une affirmation numérique avec une valeur officielle.

> Choix de méthode : on ne SCRAPE PAS de HTML pour les chiffres (extraire un
> nombre depuis de la prose est trop faillible, et un faux chiffre dans un
> corpus de fact-check est pire que rien). On lit des données structurées
> (API Eurostat) ou on cure à la main avec la source.

## Fichiers

- `ingest.py` — ingestion généraliste (dump Wikipédia FR en streaming).
- `ingest_politique.py` — ingestion ciblée politique FR (API Wikipédia).
- `chunking.py` — découpage en passages, partagé par les deux.
- `search.py` — recherche par similarité (le « R » de RAG). Réutilisé par
  l'endpoint `/rag/ask`.

Le schéma de la table `documents` et la connexion sont dans `app/db.py`.

## Lancer l'ingestion

L'ingestion appelle Mistral (embeddings) : la clé doit être dans `.env`.

```bash
# Corpus généraliste (dump). Défaut 2000 articles, réglable via RAG_MAX_ARTICLES.
docker compose exec ai-service python -m app.rag.ingest

# Corpus thématique (API Wikipédia, à jour) : politique, histoire, religion,
# sciences. Défaut 1000 articles PAR THÈME, réglable via RAG_MAX_ARTICLES.
docker compose exec ai-service python -m app.rag.ingest_themes

# Indicateurs chiffrés officiels (Eurostat + curation).
docker compose exec ai-service python -m app.rag.ingest_eurostat
docker compose exec ai-service python -m app.rag.ingest_indicateurs
```

Les deux sont REPRENABLES (sautent les titres déjà en base) : une coupure au
milieu ne fait pas tout recommencer, on relance et ça continue.

Réglages possibles (variables d'environnement) :
- `RAG_MAX_ARTICLES` — nombre d'articles à ingérer (défaut 2000).
- `RAG_WIKI_CONFIG` — snapshot HuggingFace (défaut `20231101.fr`). Si ce snapshot
  n'existe plus, en choisir un valide sur la page du dataset `wikimedia/wikipedia`.

Vérifier après coup :
```bash
docker compose exec postgres psql -U transcendence -d transcendence \
  -c "SELECT count(*) FROM documents;"
```

## Note de débit

Le tier gratuit Mistral limite le nombre de requêtes/minute. L'ingestion
vectorise par paquets de 200 pour tenir, mais reste lente sur le gratuit. Pour
un chargement rapide, ajouter une carte (le coût reste de l'ordre de quelques
centimes pour ce volume).
