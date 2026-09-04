# ONBOARDING — FactArena (ft_transcendence)

Bienvenue. Ce document est fait pour que vous puissiez commencer à coder aujourd'hui, sans
avoir à me poser trois questions avant de lancer le projet. Lisez-le en entier une fois,
ensuite vous n'y reviendrez que pour les sections « où est quoi » et « à trancher ».

Deux autres documents comptent :
- Le sujet officiel remis par l'école. **C'est lui qui gagne** en cas de contradiction.
- `docs/ARCHITECTURE.md` — le doc technique : le concept, le plan des 18 points, les
  décisions d'archi. Celui-ci (ONBOARDING) explique **comment ça tourne** ; l'autre explique
  **pourquoi on a choisi ça**.

---

## 1. Lancer le projet

Il vous faut Docker et Docker Compose v2. **Rien d'autre** : pas besoin de Node ni de Python
en local, tout se construit dans les conteneurs.

```bash
git clone <url> ft_transcendence && cd ft_transcendence
cp .env.example .env      # puis remplissez les valeurs
docker compose up --build
```

Le site est sur **https://localhost**. Le certificat est auto-signé, donc Chrome affiche un
avertissement une fois : cliquez sur « Paramètres avancés » puis « Continuer ». C'est normal.

Le premier build prend quelques minutes (il installe toutes les dépendances et compile le
front). Quand c'est prêt, vérifiez :

| Vérification | Attendu |
|---|---|
| `https://localhost/` | le site s'affiche |
| `https://localhost/api/health` | `{"status":"ok"}` |
| `docker compose ps` | 5 services, tous `healthy` |

Commandes utiles :
```bash
docker compose ps               # état de santé de chaque service
docker compose logs -f backend  # suivre les logs d'UN service
docker compose down             # tout arrêter (la base est conservée)
docker compose down -v          # tout arrêter ET effacer la base
```

---

## 2. L'architecture

```
                          ┌─────────────────────────┐
                          │   NAVIGATEUR (Chrome)   │
                          └────────────┬────────────┘
                                       │
                          HTTPS + WSS  │  port 443
                        (chiffré, seul │  port ouvert
                        point d'entrée)│  sur la machine
                                       ▼
╔══════════════════════════════════════════════════════════════════════════╗
║  RÉSEAU DOCKER PRIVÉ « factarena »   (invisible depuis l'extérieur)       ║
║                                                                          ║
║                          ┌──────────────────┐                            ║
║                          │      NGINX       │  ← le seul à publier       ║
║                          │  reverse proxy   │    un port (443)           ║
║                          │  termine le TLS  │                            ║
║                          └────────┬─────────┘                            ║
║                                   │                                      ║
║            ┌──────────────────────┼──────────────────────┐               ║
║            │                      │                      │               ║
║      « / » │           « /api/ »  │      « /socket.io/ » │               ║
║            ▼                      ▼                      ▼               ║
║   ┌────────────────┐      ┌──────────────────────────────────┐           ║
║   │   FRONTEND     │      │           BACKEND                │           ║
║   │  React + Vite  │      │           NestJS                 │           ║
║   │   port 4173    │      │           port 3000              │           ║
║   │                │      │  auth, salons, jeu, crédits, WS  │           ║
║   └────────────────┘      └────────┬──────────────┬──────────┘           ║
║                                    │              │                      ║
║                            Prisma  │              │  HTTP interne        ║
║                                    │              │  (non chiffré, OK)   ║
║                                    │              ▼                      ║
║                                    │     ┌──────────────────┐            ║
║                                    │     │   AI-SERVICE     │            ║
║                                    │     │    FastAPI       │            ║
║                                    │     │    port 8000     │            ║
║                                    │     │ RAG · LLM · modé │            ║
║                                    │     └────────┬─────────┘            ║
║                                    │              │                      ║
║                                    │              │ psycopg (plus tard)  ║
║                                    ▼              ▼                      ║
║                          ┌────────────────────────────────┐              ║
║                          │   POSTGRESQL  +  pgvector      │              ║
║                          │          port 5432             │              ║
║                          │                                │              ║
║                          │  tables relationnelles (Prisma)│              ║
║                          │  + table vectorielle (FastAPI) │              ║
║                          └───────────────┬────────────────┘              ║
║                                          │                               ║
╚══════════════════════════════════════════┼═══════════════════════════════╝
                                           ▼
                                  ┌─────────────────┐
                                  │  postgres_data  │  volume : les données
                                  │  (volume Docker)│  survivent au down
                                  └─────────────────┘
```

### Ce que le schéma raconte, flèche par flèche

**Le navigateur ne parle QU'À nginx.** C'est la règle d'or. Il n'a aucun moyen d'atteindre le
back, le front ou l'IA directement : ils ne publient aucun port sur la machine. Si vous
faites `docker compose ps`, vous verrez que seul nginx a un `0.0.0.0:443->443`. Les autres
affichent juste `3000/tcp` ou `8000/tcp` — ça veut dire « ce port existe, mais seulement à
l'intérieur du réseau Docker ». C'est voulu, pas un bug.

**Pourquoi un seul point d'entrée :** le sujet impose que tout ce qui vient d'un navigateur
soit en HTTPS. Avec un seul point d'entrée, on chiffre à un seul endroit. Si chaque service
était exposé, il faudrait un certificat par service et on aurait quatre fois plus de chances
de se planter.

**nginx est un aiguilleur.** Il regarde le début de l'URL et décide :

| L'URL commence par | Il envoie vers | Pourquoi |
|---|---|---|
| `/api/` | backend:3000 | toutes les routes de l'API |
| `/socket.io/` | backend:3000 | le temps réel (WebSocket) |
| tout le reste | frontend:4173 | le site React |

Il garde le préfixe `/api` en le transmettant : c'est pour ça que `main.ts` déclare
`setGlobalPrefix('api')`. Les deux doivent rester d'accord, sinon plus rien ne répond.

**Le trafic à l'intérieur n'est pas chiffré, et c'est normal.** Entre nginx et le back, ou
entre le back et la base, on est en simple HTTP. Le sujet l'autorise explicitement : il
n'exige le chiffrement que pour ce qui vient de l'extérieur. Le réseau Docker est privé,
personne d'autre ne peut l'écouter.

**Le front ne parle JAMAIS au service IA.** Regardez bien : il n'y a aucune flèche entre eux.
Tout passe par le back. C'est un choix, pas un oubli :
- l'authentification se vérifie à un seul endroit ;
- on peut limiter le nombre d'appels au LLM (il coûte de l'argent) ;
- on n'expose qu'une seule API au monde extérieur.

Si un jour vous avez besoin d'une info de l'IA côté front, vous ajoutez une route dans le
back qui va la chercher. Pas de raccourci.

**Les deux flèches vers Postgres.** C'est la seule bizarrerie du schéma, et il faut savoir
l'expliquer en soutenance. **Une seule base**, mais deux services qui écrivent dedans, chacun
sur ses propres tables :
- le **back (Prisma)** gère les tables classiques : User, Room, Round, Prediction,
  Transaction…
- le **service IA** gérera la table des vecteurs (le corpus du RAG).

Pourquoi séparer ? Parce que Prisma gère mal le type `vector`. Donc on trace une frontière :
Prisma ne touche pas aux vecteurs, FastAPI ne touche pas aux tables relationnelles. Ils se
parlent par `id`, jamais par jointure SQL.

**Le volume `postgres_data`.** Les données vivent en dehors des conteneurs.
`docker compose down` détruit les conteneurs mais garde la base. Seul `docker compose down -v`
efface tout (le `-v` = volumes). Retenez cette différence, ça évite les mauvaises surprises.

### L'ordre de démarrage (ce que font les healthchecks)

```
   postgres ──(healthy ?)──▶ backend ──┐
        └────(healthy ?)──▶ ai-service │
                                       ├──(healthy ?)──▶ nginx
                            frontend ──┘
```

Chaque service est sondé toutes les 10 secondes. Un service n'attend pas que le précédent
soit *lancé*, mais qu'il **réponde vraiment**. Concrètement : le back ne démarre pas tant que
Postgres ne répond pas (sinon Prisma planterait), et nginx ne démarre pas tant que le front
et le back ne répondent pas (sinon il proxifierait vers le vide).

C'est exactement ce qui était cassé quand j'ai récupéré le projet : les sondes interrogeaient
`localhost`, qui part en IPv6, alors que les services écoutent en IPv4. Elles échouaient
toutes, donc nginx n'a jamais démarré. Une adresse mal choisie, et toute la stack reste par
terre — d'où le pavé de commentaires dans `docker-compose.yml`.

Au passage : les lignes `GET /health 200 OK` qui défilent toutes les 10 secondes dans les
logs, **c'est ça**. C'est normal, ce n'est pas une boucle d'erreur.

### Ce que ça donne quand vous ouvrez le site

```
1. vous tapez https://localhost
2. nginx déchiffre, voit « / », renvoie le site React
3. React s'affiche, et appelle /api/health
4. nginx voit « /api/ », transmet au back
5. le back répond {"status":"ok"}
6. la page affiche « État de l'API : ok »
```

Si cette ligne s'affiche, c'est que **toute la chaîne fonctionne** : TLS, aiguillage, front,
back. C'est le rôle de `Home.tsx` — un test de bout en bout déguisé en page d'accueil.

---

## 3. Le mode dev — à lire avant de commencer à coder

Il y a deux façons de lancer le projet, et il ne faut pas les confondre.

**La prod :**
```bash
docker compose up --build
```
C'est la vraie appli, celle que l'évaluateur lancera le jour de la soutenance. Le code est
figé à l'intérieur de l'image Docker.

**Le dev (celui que vous allez utiliser tous les jours) :**
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```
Là, votre dossier est branché en direct dans le conteneur. Vous sauvegardez un fichier, la
page se recharge toute seule (React) ou l'API redémarre toute seule (NestJS). Instantané.

**Pourquoi vous devez utiliser le dev :** si vous bossez en mode prod, à chaque ligne que vous
changez il faut refaire un `--build` complet et attendre plusieurs minutes pour voir le
résultat. Vous allez perdre vos journées. Le mode dev existe uniquement pour ça.

Dans les deux cas le site est au même endroit : `https://localhost`. Même nginx, même
certificat, même tout. Ce que vous testez en dev, c'est ce qui tournera en prod.

### Pourquoi un fichier séparé `docker-compose.dev.yml` ?

Parce que Docker a un piège : tout fichier qui s'appelle `docker-compose.override.yml`, il le
charge **automatiquement**, sans qu'on lui demande. Si j'avais appelé le fichier comme ça,
l'évaluateur qui tape `docker compose up` lancerait notre mode dev sans le savoir — donc pas
la vraie appli, et un serveur de dev qui cause dans la console du navigateur. Sauf que le
sujet exige que la commande unique lance la vraie appli, et zéro erreur dans la console. Deux
motifs de rejet d'un coup.

Avec le nom `.dev.yml`, Docker l'ignore par défaut. `docker compose up` reste la prod, et le
dev devient un choix explicite (c'est pour ça qu'il faut taper les deux `-f`). J'ai testé les
deux cas pour être sûr.

**La règle : ne renommez jamais ce fichier, et ne touchez pas à `docker compose up`.** C'est
notre filet de sécurité pour la soutenance.

### Comment ça marche concrètement

**Les deux `-f`, c'est un empilement.** Docker lit les deux fichiers dans l'ordre et les
fusionne. Le deuxième ne remplace pas le premier : il vient par-dessus, et ne modifie que ce
qu'il mentionne. C'est pour ça que `docker-compose.dev.yml` est si court : il ne parle que de
`frontend` et `backend`. Postgres, nginx et le service IA tournent exactement pareil dans les
deux modes. On ne duplique rien.

**Le code : on branche votre dossier dans le conteneur.** Normalement le code est *copié*
dans l'image au build. Une photo, figée. Vous modifiez un fichier chez vous ? L'image s'en
fiche, elle a sa copie. D'où le rebuild. En dev, cette ligne :
```yaml
volumes:
  - ./frontend:/app
```
dit à Docker : « le dossier `/app` du conteneur, c'est en fait mon dossier `./frontend` sur
mon disque ». Plus de copie, c'est le même dossier des deux côtés.

**La ligne bizarre `- /app/node_modules`.** Elle surprend tout le monde mais elle est
indispensable. La ligne du dessus recouvre **tout** `/app` avec votre dossier local — y
compris `node_modules`, que vous n'avez pas forcément en local (il est installé dans l'image
au build). Sans elle, `node_modules` disparaît et le conteneur meurt sur `vite: not found`.
Cette ligne dit : « sauf `node_modules`, celui-là tu gardes celui de l'image ». Côté back
c'est encore plus critique : c'est là-dedans que vit le client Prisma généré au build.

**On change juste la commande de démarrage.** Le front passe de `vite preview` (qui sert un
build figé) à `vite dev` (qui surveille les fichiers). Le back lance `nest start --watch`. Et
comme le CLI de Nest est une devDependency, on remet `NODE_ENV=development`, sinon il n'est
pas chargé et rien ne démarre.

**Le rechargement auto passe par nginx.** C'est la partie la moins évidente. Pour recharger
votre page, Vite ouvre un **WebSocket** entre le navigateur et lui. Sauf que le navigateur ne
connaît pas Vite : il ne connaît que nginx, en HTTPS sur le 443. Vite, par défaut, dirait au
navigateur « connecte-toi sur le port 4173 » — un port interne à Docker, injoignable depuis
le navigateur. Le WebSocket échouerait en boucle et remplirait la console d'erreurs. Donc
deux réglages : dans `vite.config.ts` on dit à Vite « dis au navigateur de passer par `wss://`
sur le 443 », et dans `nginx.conf` on autorise nginx à laisser passer les WebSockets vers le
front. **Ces deux réglages ne servent qu'en dev** : en prod `vite preview` n'ouvre aucun
WebSocket, ils ne changent rien. On n'a pris aucun risque sur la note.

**Et la base ?** Elle ne bouge pas entre les deux modes — même Postgres, même volume, mêmes
données. Vous ne perdez rien en passant de dev à prod.

**Si vous ne retenez qu'une chose :** en dev on branche votre dossier en direct et on lance
des serveurs qui surveillent les fichiers. Tout le reste (nginx, TLS, la base, l'URL) est
identique à la prod. C'est pour ça que ce qui marche chez vous marchera à la soutenance.

**Bonus :** si le défilement des logs vous saoule, lancez avec `-d`
(`docker compose up -d`) et regardez juste votre service avec `docker compose logs -f backend`.

---

## 4. Où est quoi

Légende : **fonctionnel** = ça tourne, n'y touchez pas sans raison.
**squelette** = structure posée, vide exprès, c'est votre travail.

### Racine

| Fichier | Rôle |
|---|---|
| `docker-compose.yml` | **Le cœur.** Les 5 services, l'ordre de démarrage, le réseau, le volume. |
| `docker-compose.dev.yml` | La surcouche dev (voir §3). |
| `.env` | Vos vraies valeurs. **Ignoré par git, ne le commitez jamais.** |
| `.env.example` | Le modèle sans les secrets. Suivi par git (exigé par le sujet). |
| `.gitignore` | Empêche de commiter `.env`, `node_modules`, `dist`, les certificats. |
| `README.md` | La vitrine, **en anglais** (le sujet l'exige). |

| `docs/ARCHITECTURE.md` | Le doc technique : concept, plan des 18 points, décisions. |
| `docs/ONBOARDING.md` | Ce fichier. |
| `DEMARRAGE_GITHUB.md` | Notice de lancement du repo. À supprimer une fois fait. |
| `setup_ft_transcendence.sh` | Le script qui a généré le squelette. Outillage, pas du livrable. |
| `CLAUDE.md`, `.claude/` | Config de l'assistant IA (règles, agents). |

### `postgres/`
- `init/01-pgvector.sql` — **fonctionnel.** Une ligne utile (`CREATE EXTENSION vector`),
  jouée automatiquement au premier démarrage pour activer la recherche vectorielle du RAG.
  Attention : jouée uniquement sur une base **vide**. Si vous avez un vieux volume,
  l'extension sera absente (le fichier explique comment rattraper).

### `nginx/` — le point d'entrée unique
- `Dockerfile` — **fonctionnel.** Build de l'image + génération du certificat auto-signé.
- `nginx.conf` — **fonctionnel.** TLS, redirection HTTP→HTTPS, aiguillage des URL.
- `README.md` — note du service.

### `backend/` — NestJS
**Fonctionnel :**
- `src/main.ts` — préfixe global `/api`, validation globale des entrées, écoute `0.0.0.0:3000`.
- `src/app.module.ts` — module racine. **C'est ici qu'on branche chaque nouveau module.**
- `src/health/` — la route `GET /api/health`. **Votre modèle de module minimal complet.**
- `src/prisma/` — la connexion PostgreSQL, dispo partout (`@Global`).
- `prisma/schema.prisma` — le schéma. **Une seule table pour l'instant : `User`.**
- `Dockerfile` — build multi-étapes, applique `prisma db push` au démarrage.
- `package.json` / `package-lock.json` — dépendances, versions verrouillées (`npm ci`).
- `nest-cli.json`, `tsconfig*.json`, `.dockerignore` — config de build.

**Squelette :**
- `src/auth/` — **vide.** C'est là que va l'inscription/connexion email+mot de passe (hash
  Argon2), les JWT, et l'OAuth 42 **en plus** (jamais à la place).

`dist/` = code compilé, `node_modules/` = dépendances : générés, pas à commiter.

### `ai-service/` — FastAPI
**Fonctionnel :**
- `app/main.py` — l'app FastAPI. Pour l'instant **juste `/health`**. La base de départ.
- `app/config.py` — lit les variables d'env proprement (URL base, clé LLM).
- `Dockerfile`, `requirements.txt`, `.dockerignore` — build (utilisateur non-root, uvicorn).

**Squelette :**
- `app/rag/`, `app/llm/`, `app/moderation/` — trois dossiers vides avec un README d'une ligne.
  Ce sont les **trois modules IA à construire**.

### `frontend/` — React + Vite + Tailwind
**Fonctionnel :**
- `index.html` — page hôte (avec favicon, pour éviter un 404 console).
- `src/main.tsx` — démarre React + le routeur.
- `src/App.tsx` — les routes (`/`, `/login`, `/profile`, `/room`, `/privacy`, `/terms`).
- `src/components/Layout.tsx` — gabarit commun (nav + footer partout).
- `src/components/Footer.tsx` — **important** : les liens Privacy/Terms, exigés partout.
- `src/pages/Home.tsx` — **la seule page avec du contenu** : elle appelle `/api/health`.
- `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.css`, `tsconfig*.json`,
  `Dockerfile` — config de build et de style.

**Squelette :**
- `src/pages/Login.tsx`, `Profile.tsx`, `Room.tsx` — juste un `<h1>`.
- `src/pages/Privacy.tsx`, `Terms.tsx` — **juste un titre. Le sujet exige du contenu RÉEL,
  sinon rejet.** À compléter en priorité, c'est du texte, ça coûte une heure.

**En résumé :** l'infra (docker, nginx, TLS, base, healthchecks) est complète et testée. Le
code applicatif est un squelette qui tourne — juste assez pour démarrer, naviguer et prouver
que la plomberie marche. Tout ce qui est vide l'est exprès : c'est votre travail.

---

## 5. Qui fait quoi

| Rôle | Périmètre |
|---|---|
| DevOps & PM | Gestion de projet, infra Docker, nginx/HTTPS, CI, déploiement |
| Back-end Core | NestJS, auth, WebSockets, boucle de jeu, crédits, PostgreSQL |
| Tech Lead IA (Python) | FastAPI, intégration LLM, pipeline RAG, modération |
| Front-end UI & Access | Interface, design system, accessibilité WCAG, pages légales |
| Front-end Temps réel & UX | Salon/paris, animations, intégration du chat live |

Tout le monde est **développeur** : on code, on relit les PR des autres, on teste et on
documente son périmètre. Le sujet vérifie que **tous les membres commitent** et que le
travail est **réparti** — donc chacun commite sur son territoire dès le premier jour.

---

## 6. Le planning

| Semaine | Objectif | Détail |
|---|---|---|
| 1 | **Environnement lançable en une commande** | Docker compose 5 services, init de chaque service. **Fait.** |
| 2 | Connexion sécurisée fonctionnelle | Auth email+mot de passe (hash+sel) — **obligatoire, à faire en premier**. OAuth 42 en plus. Interface LLM de base (streaming). Pages login/inscription. |
| 3 | Dimension sociale active | Profils + système d'amis. Base vectorielle + indexation RAG. Page profil et liste d'amis. |
| 4 | Communication directe et modérée | WebSockets pour les salons. Modération NLP auto. Interface chat temps réel. |
| 5 | Mécanique de pari opérationnelle | Boucle de jeu (timer, scores). Finalisation RAG (contexte + explication sourcée). Interface de paris. |
| 6 | Écosystème de bout en bout | Connexion back core ↔ back IA. Affichage dynamique des résultats. |
| 7 | Application sécurisée | Audit sécurité, HTTPS. **Pages légales avec contenu réel.** |
| 8 | Prêt pour la soutenance | Tests intensifs, correction des erreurs console, optimisation Docker, README complet. |

---

## 7. Ce qui reste à faire côté infra

**Au fil de l'eau :**
- **Les migrations Prisma.** Aujourd'hui on fait `prisma db push` au démarrage, ce qui suffit
  au stade squelette. Dès que le schéma se remplit, il faudra passer à de vraies migrations
  versionnées.
- **L'image du service IA va grossir.** Les dépendances Python de l'IA sont lourdes : il
  faudra optimiser l'image quand elles arriveront.
- **Chaque nouvelle feature peut casser un build.** C'est le DevOps qui répare, mais
  prévenez-le au lieu de le laisser découvrir.
- **La conf nginx va grossir** : routes WebSocket du chat et du jeu, taille max des uploads
  (déjà relevée à 10 Mo pour les avatars), timeouts pour les réponses LLM qui peuvent être
  lentes.
- **La persistance.** La base doit survivre à un `docker compose down`. Les avatars uploadés
  aussi — il faudra un volume dédié quand l'upload arrivera.

**Vers la fin :**
- **La check-list éliminatoire, à re-vérifier après chaque grosse fusion** : `.env` jamais
  commité, une seule commande de lancement, HTTPS/WSS partout, zéro erreur console, pages
  légales avec du vrai contenu.
- **La répétition générale** : clone frais sur une machine 42 neutre, chrono en main,
  `docker compose up --build`, tout doit passer du premier coup. **C'est LE test qui compte.**

---

## 8. À trancher — divergences entre le planning et l'architecture

Le doc de vision de l'équipe et `docs/ARCHITECTURE.md` **ne disent pas la même chose** sur
trois points. Il faut trancher en réunion, parce que deux de ces points touchent des
contraintes éliminatoires.

**1. L'authentification — le point le plus grave.** Le doc de vision dit « il se connecte en
un clic via l'API 42 (OAuth2) ». Le sujet est formel : *« At minimum: email and password
authentication with proper security (hashed passwords, salted) »*, et *« Additional
authentication methods (OAuth, 2FA, etc.) can be implemented via modules »*. Autrement dit
l'email+mot de passe est **obligatoire** et l'OAuth 42 vient **en plus**, jamais à la place.
Un projet sans email+mot de passe est **rejeté**. La semaine 2 doit donc livrer
email+mot de passe d'abord, OAuth ensuite.

**2. La vidéo.** Le doc de vision parle d'« une courte vidéo lancée simultanément » et d'un
« lecteur vidéo synchronisé » (semaine 5). `ARCHITECTURE.md` a explicitement **abandonné la
synchro vidéo image par image** (décision n°2 : coûteux, fragile, source d'erreurs console) au
profit d'une machine à états pilotée par le serveur. L'équipe a même **décidé** que le médium
du MVP serait **texte/image**, la vidéo n'arrivant qu'après les 18 points fonctionnels. Il
faut choisir : soit on met à jour le doc de vision, soit on rouvre la décision — mais on ne
peut pas coder les deux.

**3. L'adversaire IA (semaine 7).** Il ne fait pas partie des 11 modules du plan à 18 points,
et `ARCHITECTURE.md` dit de **ne pas ajouter de scope** tant que ces 18 points ne sont pas
pleinement fonctionnels — parce qu'un module incomplet vaut **zéro point**. À reporter, sauf
décision contraire assumée.

---

*Document vivant. Si vous vous posez une question qui n'est pas ici, la réponse est
probablement dans `docs/ARCHITECTURE.md` — et si elle n'y est pas, posez-la, et on l'ajoute.*
