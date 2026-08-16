# backend — NestJS (auth, WebSockets, boucle de jeu)

Territoire : Back-end Core.

## Seed de démonstration

Le seed crée toujours les quatre claims éditoriaux de base. Hors production, il
crée aussi automatiquement un environnement de démonstration idempotent :

- un compte admin ;
- trois comptes utilisateurs ;
- une room prête à jouer ;
- une room avec un round terminé ;
- des claims associés au round ;
- une prédiction gagnante et une perdante ;
- les transactions de mise et de payout ;
- une relation d’amitié et un message de chat.

Identifiants locaux par défaut :

```text
admin@factarena.local / FactArenaAdmin!123
host@factarena.local / FactArenaDemo!123
player@factarena.local / FactArenaDemo!123
viewer@factarena.local / FactArenaDemo!123
```

Pour lancer le seed en développement :

```bash
npx prisma migrate deploy
npx prisma db seed
```

En production, les données de démonstration sont désactivées par défaut. Pour
les activer sur un environnement de test uniquement :

```text
SEED_DEMO_DATA=true
SEED_DEMO_PASSWORD=un-mot-de-passe-de-test
```

Le seed utilise des identifiants fixes et des `upsert`, il peut donc être
relancé sans créer de doublons.

## Import éditorial des claims

La source versionnée est [prisma/data/editorial-claims.json](prisma/data/editorial-claims.json).
Chaque entrée contient obligatoirement :

```json
{
  "sourceKey": "source:stable-id",
  "text": "Une affirmation à vérifier.",
  "truthLabel": "TRUE",
  "category": "science",
  "sourceUrl": "https://example.org/source"
}
```

`truthLabel` est une décision éditoriale explicite ; il n’est jamais déduit par
l’IA. L’import vérifie les champs, impose une source HTTPS, normalise le texte,
rejette les doublons contradictoires et utilise `sourceKey` pour retrouver un
claim existant. Un claim déjà utilisé par une manche ne peut pas être modifié.

Pour importer ou mettre à jour le corpus :

```bash
npm run claims:import
```

Le chemin peut être remplacé avec `CLAIMS_SOURCE_FILE`. La création est
transactionnelle et le résultat indique le nombre de claims créés, mis à jour
ou inchangés. `CLAIMS_IMPORTER_USER_ID` permet d’attribuer les claims à un
utilisateur précis ; sinon `SEED_ADMIN_EMAIL` est utilisé lorsqu’il désigne un
compte `ADMIN` existant.

# FactArena Backend

La documentation ci-dessous decrit l'implementation actuelle du backend et
complete les notes historiques de seed et d'import conservees plus haut.

Backend NestJS du projet FactArena. L'API est exposee sous `/api`, le temps
des manches est pilote par le serveur et PostgreSQL est la source de verite.

## Demarrage rapide

Depuis la racine du depot :

```bash
docker compose up --build
```

Le backend ecoute sur le reseau Docker au port `3000`. En usage complet,
nginx expose l'application en HTTPS. La sonde est `GET /api/health`.

Pour un developpement local :

```bash
cd backend
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

## Architecture et modules

- `auth` : inscription, connexion JWT et OAuth 42 ; rate limit d'authentification.
- `users` : profils, mots de passe et avatars valides par contenu binaire.
- `rooms` : rooms, membres presents et etat courant.
- `rounds` : machine `COUNTDOWN -> OPEN -> LOCKED -> REVEALED -> FINISHED`.
- `predictions` : mise unique par utilisateur et manche.
- `ledger` : solde virtuel, mises, payouts et remboursements idempotents.
- `claims` : corpus editorial et claims associes aux manches.
- `chat` : messages autorises uniquement aux membres de la room.
- `friends` et `stats` : relations, presence, classements et historiques.
- `ai` : RAG, LLM, moderation et verdicts de claims.
- `realtime` : gateway Socket.IO et `GameLoopService` serveur.
- `health` : sonde de disponibilite.

Le code source se trouve dans [src](src), le schema dans [prisma/schema.prisma](prisma/schema.prisma).

## API REST

Toutes les routes ci-dessous sont prefixees par `/api`. Sauf indication
contraire, elles necessitent `Authorization: Bearer <JWT>`.

| Methode | Route | Acces | Fonction |
|---|---|---|---|
| GET | `/health` | public | Sonde `status: ok` |
| POST | `/auth/register` | public, limite par IP | Creer un compte |
| POST | `/auth/login` | public, limite par IP | Obtenir un JWT |
| GET | `/auth/42` | public si OAuth configure | Demarrer OAuth 42 |
| GET | `/auth/42/callback` | public, limite par IP | Callback OAuth 42 |
| GET | `/users/me` | JWT | Profil courant |
| PATCH | `/users/me` | JWT | Modifier le profil |
| PATCH | `/users/me/password` | JWT | Modifier le mot de passe |
| POST | `/users/me/avatar` | JWT | Uploader un avatar |
| GET | `/users/avatars/:filename` | public | Lire un avatar UUID valide |
| GET | `/users/:id` | JWT | Lire un profil |
| GET/POST | `/rooms`, `/rooms/:id/...` | JWT | Rooms, etat, membres, historique |
| POST | `/rounds` | JWT, hote | Creer une manche |
| GET | `/rounds/room/:roomId` | JWT | Lister les manches |
| GET | `/rounds/:id` | JWT | Lire une manche |
| POST | `/rounds/:id/lock` | JWT, hote | Verrouiller apres deadline |
| POST | `/rounds/:id/reveal` | JWT, hote | Reveler et regler |
| POST | `/predictions` | JWT | Placer une mise |
| GET | `/predictions/round/:roundId` | JWT | Predictions visibles selon l'etat |
| GET | `/predictions/round/:roundId/stats` | JWT | Pot et statistiques |
| GET | `/chat/room/:roomId` | JWT, membre | Lire le chat |
| POST | `/chat/send` | JWT, membre | Envoyer un message |
| GET/POST/DELETE | `/friends...` | JWT | Amis et presence |
| GET | `/ledger/balance` | JWT | Solde courant |
| GET | `/ledger/transactions` | JWT | Historique du ledger |
| GET | `/stats/leaderboard` | JWT | Classement |
| GET | `/stats/round-history` | JWT | Historique global |
| GET | `/stats/me...` | JWT | Statistiques courantes |
| GET | `/claims`, `/claims/:id...` | JWT | Lire le corpus |
| POST/PATCH/DELETE | `/claims...` | ADMIN ou SEED | Gerer les claims |
| GET | `/ai/health` | JWT | Etat du service IA |
| POST | `/ai/rag`, `/ai/llm` | JWT | RAG et LLM |
| POST | `/ai/llm/stream` | JWT | LLM en SSE |
| POST | `/ai/moderation` | JWT | Moderer un message |
| GET/POST | `/ai/claims/:claimId/verdict` | JWT | Lire ou generer un verdict |

Les DTO sont valides globalement avec `class-validator`, les identifiants sont
valides comme CUID et les routes d'administration verifient le role JWT.

## WebSocket Socket.IO

Connexion sur `/socket.io` avec un JWT dans `handshake.auth.token` ou dans le
header `Authorization`. `handshake.auth.roomId` permet de restaurer une room.

Commandes client :

| Evenement | Donnees principales |
|---|---|
| `room:join` | `{ roomId }` |
| `room:leave` | `{ roomId }` optionnel |
| `room:state` | `{ roomId }` |
| `prediction:submit` | `{ roomId, roundId, predictedFakeCount, stake }` |
| `round:lock` | `{ roomId, roundId }` |
| `round:reveal` | `{ roomId, roundId }` |
| `chat:send` | `{ roomId, content }` |
| `ai:chat` | `{ prompt }` |

Evenements serveur : `connection:ready`, `room:joined`, `room:reconnected`,
`room:state`, `room:member_joined`, `room:member_left`, `prediction:updated`,
`round:open`, `round:locked`, `round:revealed`, `round:finished`,
`round:verdicts`, `chat:message`, `presence:update`, `ai:sources`,
`ai:token`, `ai:done` et `ai:error`.

Les operations de manche revérifient toujours que `roundId` appartient a
`roomId`. Les transitions et le reglement sont conditionnels en base pour
resister aux appels concurrents.

## Variables d'environnement

Variables principales :

```text
DATABASE_URL=postgresql://user:password@postgres:5432/transcendence
JWT_SECRET=change-me
NODE_ENV=development
FRONTEND_URL=https://localhost
AI_SERVICE_URL=http://ai-service:8000
UPLOAD_DIR=/app/uploads/avatars
```

OAuth 42 : `FORTYTWO_CLIENT_ID`, `FORTYTWO_CLIENT_SECRET` et
`FORTYTWO_CALLBACK_URL`. Le callback doit etre `/api/auth/42/callback` et
utiliser HTTPS en production. Si une variable manque, OAuth est desactive
proprement.

IA : `LLM_API_KEY`, `LLM_MODEL`, `EMBEDDING_MODEL` et `MODERATION_MODEL`.

Seed/import : `SEED_DEMO_DATA`, `SEED_DEMO_PASSWORD`, `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`, `CLAIMS_SOURCE_FILE` et `CLAIMS_IMPORTER_USER_ID`.

Ne jamais commiter les secrets reels. Le fichier [.env.example](../.env.example)
contient les valeurs documentaires.

## Prisma, migrations et seed

Commandes :

```bash
npm run prisma:generate
npm run prisma:migrate       # prisma migrate deploy
npm run prisma:seed          # seed idempotent
npm run prisma:push          # developpement seulement
```

Migrations presentes :

1. `0001_init` : schema initial ;
2. `0002_presence_and_claim_creator` : presence et createur de claim ;
3. `0003_claim_editorial_key` : cle stable du corpus editorial ;
4. `0004_ledger_reference_id` : idempotence du ledger.

Le seed cree toujours les claims editoriaux. Avec `SEED_DEMO_DATA=true`, il
cree aussi les comptes, rooms, manche historique, predictions, transactions,
amis et message de demonstration. Il utilise des `upsert` et peut etre relance.

Import editorial :

```bash
npm run claims:import
```

La source est [prisma/data/editorial-claims.json](prisma/data/editorial-claims.json).
Les claims sont valides, dedoubles par `sourceKey`, limites aux URLs HTTPS et
proteges contre la modification lorsqu'ils sont deja utilises par une manche.

## Comptes de demonstration

Avec `SEED_DEMO_DATA=true` :

```text
admin@factarena.local  / FactArenaAdmin!123
host@factarena.local   / FactArenaDemo!123
player@factarena.local / FactArenaDemo!123
viewer@factarena.local / FactArenaDemo!123
```

Ces mots de passe sont uniquement destines au developpement et doivent etre
remplaces dans tout environnement partage.

## Tests et qualite

```bash
npm test
npm run test:cov
npm run build
```

Le test PostgreSQL du ledger necessite une base accessible et un build deja
compile :

```bash
npm run build
npm run test:ledger:integration
```

Dans Docker :

```bash
docker compose exec -T backend npm run test:ledger:integration
```

Ce test couvre mises concurrentes, solde insuffisant, `balanceAfter`,
remboursement idempotent, double payout et conservation du pot.

## Limites connues et choix de securite

- Le rate limiter est en memoire : il est efficace pour une instance, mais doit
  etre remplace par Redis ou un stockage partage en deploiement multi-instance.
- La presence WebSocket est reconstruite a la reconnexion ; les donnees de
  manche restent persistantes et sont reprises par `GameLoopService` au
  redemarrage.
- La moderation est fail-open en cas de panne IA : le message est autorise avec
  `moderation_status: moderation_unavailable`. Aucun filtre par wordlist n'est
  presente.
- Les avatars sont publics par choix produit, avec nom UUID, validation binaire
  et dimensions limitees. Le nettoyage des fichiers orphelins est manuel :
  `npm run avatars:cleanup`.
- Le service IA depend d'un fournisseur externe ; ses erreurs sont converties
  en statuts HTTP coherents (`429`, `502`, `503`, `504`).
- OAuth 42 n'est disponible que lorsque sa configuration est complete.
- Les JWT durent une heure et il n'existe pas encore de liste de revocation ou
  de refresh token.
- Les remboursements sont exposes au niveau service/ledger pour les workflows
  internes ; aucun endpoint public de remboursement n'est fourni.

Politiques detaillees : [GAME_STATE_POLICY.md](GAME_STATE_POLICY.md),
[LEDGER_POLICY.md](LEDGER_POLICY.md), [AVATAR_UPLOAD_POLICY.md](AVATAR_UPLOAD_POLICY.md)
et [MODERATION_POLICY.md](MODERATION_POLICY.md).
