# Origine de ce dépôt

Ce dépôt part du code de **FactArena**, réalisé dans le cadre du cursus 42
(projet `ft_transcendence`) par **slario, alaroque, elanteno, krfranco et oztozdem**.

L'historique git complet a été conservé volontairement : les commits gardent leurs
auteurs d'origine, et le `.mailmap` regroupe les identités multiples. `git shortlog -sn`
donne la répartition réelle du travail sur le projet d'école.

| | |
|---|---|
| Révision de départ | `5d8b760` — *Merge pull request #23 from Ana-debug* |
| Branche | `main` |
| Date de la reprise | 14 septembre 2026 |
| Dépôt d'origine | `Dantenos/ft_transcendence` (privé) |

## Remotes

Le remote `ft_transcendence` pointe vers le dépôt d'école **en lecture seule** :
son URL de push est volontairement invalide (`NO_PUSH_depot_ecole`), pour qu'un
`git push` ne puisse jamais envoyer le travail de ce projet-ci dans le dépôt évalué.

Les 16 branches du projet d'école ont été récupérées sous `ft_transcendence/*`.
Deux méritent d'être connues :

- `ft_transcendence/DataAnalytics/Scynia_slario` — module Data & Analytics
  (graphiques, export PDF/CSV), 18 suites de tests backend, et une refonte du
  moteur de jeu avec minuteur serveur. Six tests y échouaient au 14/09/2026,
  par mocks Prisma incomplets et non par défaut du code.
- `ft_transcendence/Krystal_visualModif` — les visuels (GIF et PNG) de l'interface.

## Ce qui est repris tel quel, et ce qui reste à reprendre

Le code hérité vise un jeu multijoueur de fact-checking à cinq clips. Un projet de
fact-checking plus complet gardera sans doute les fondations et repensera le reste.

**Solide, à garder** — la séparation IA / vérité de référence (le verdict vient d'une clé
de réponse éditoriale en base, jamais du modèle), le service RAG (pgvector, index HNSW,
corpus livré avec ses vecteurs pré-calculés), la modération par modèle en deux couches,
le grand livre de crédits (débit atomique conditionnel, idempotence par `referenceId`),
et l'architecture à deux services derrière un nginx unique en HTTPS.

**À revoir** — le `README.md` décrit le projet d'école et ses modules 42 : il devra être
réécrit. Plusieurs de ses affirmations sur la machine à états ne correspondaient déjà plus
au code (`openIfDue`, `lockIfDue`, `lockIfEveryoneVoted` n'ont aucun appelant, et l'état
`LOCKED` est inatteignable, `locksAt` étant fixé à l'an 2099 par `prepare()`).
L'endpoint LLM (`/api/ai/llm`, `/api/ai/llm/stream`) fonctionne de bout en bout mais
n'est appelé par aucune page du front, et son flux émet `done` deux fois.

## Démarrage

```bash
cp .env.example .env   # puis renseigner les valeurs
docker compose up --build
```

L'application est servie par nginx sur **https://localhost:8443** (certificat
auto-signé en développement). Le `.env` est ignoré par git (`*.env`) : il ne doit
jamais être commité.
