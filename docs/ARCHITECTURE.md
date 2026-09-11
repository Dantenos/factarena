# Architecture — ft_transcendence · **FactArena**

> **FactArena — arène de fact-check en temps réel sur les fake news.**
> Jeu multijoueur temps réel : une compilation de cinq clips viraux s'enchaîne, on juge
> chaque clip **« good news / fake news »** (crédits virtuels en jeu), puis une IA révèle
> le verdict **sourcé**. Le plus précis rafle le pot.
> Projet de fin de tronc commun 42, équipe de 5.

Ce document est la référence technique de l'équipe. Il explique le **POURQUOI** de chaque
choix, pas seulement le QUOI. La source de vérité reste le sujet officiel remis par l'école : en cas de
contradiction, **c'est le sujet qui gagne**.

> Le plan de modules ci-dessous a été **audité contre le texte exact du sujet**, références
> de lignes à l'appui.

---

## 1. Le concept fusionné (et sa décision-clé)

FactArena fusionne les deux pistes de l'équipe :
- **Piste A** : l'utilisateur soumet un claim, un moteur RAG rend un verdict sourcé.
- **Piste B** : salon live où l'on parie sur le nombre de fake news d'une vidéo.

**Boucle de jeu :**
1. **Auth & lobby** — connexion email+mot de passe (obligatoire) ou 42 OAuth ; le lobby
   montre les salons, les amis + statut en ligne, le solde de crédits et le classement.
2. **Salon** — plusieurs joueurs rejoignent un salon live ; une **compilation de cinq clips
   viraux** (lecteur embarqué) s'enchaîne. L'état de la manche est **synchronisé par le
   serveur** via WebSocket (horloge autoritaire côté serveur).
3. **Mise & vote par clip** — le joueur mise une fois des **crédits virtuels** en entrant,
   puis juge **chaque clip « good news / fake news »** dans une **fenêtre de vote
   synchronisée** ; la distribution des votes du salon évolue en direct ; le chat est actif
   (modéré par IA, et interrogeable — voir `AI.md §9`).
4. **Verrouillage** — le vote de chaque clip gèle à la fin de sa fenêtre (verrou serveur).
5. **Révélation** — le bot IA **streame** un verdict sourcé par clip (LLM sur contexte
   RAG, avec citations + confiance).
6. **Score (déterministe, à somme nulle) — course à la précision** — le joueur qui a **bien
   jugé le plus de clips** remporte le pot ; le règlement des crédits est **une transaction
   PostgreSQL atomique** (pas de double-dépense). Les perdants cèdent leur mise aux gagnants.
7. **Persistance** — historique, stats, classement mis à jour. Manche suivante.

> ### Décision d'architecture n°1 — la vérité de jeu ne vient PAS du LLM
>
> **Le nombre N de claims faux qui décide qui gagne provient d'une « clé de réponse »
> éditoriale pré-étiquetée, stockée en base — jamais de la sortie live du LLM.**
>
> **Pourquoi c'est central :** ça découple l'équité du jeu de la fiabilité du modèle.
> Le RAG/LLM ne fait qu'**expliquer** un verdict déjà connu ; il ne tranche jamais le gain.
> Cette seule décision neutralise d'un coup les deux attaques les plus fortes d'un
> évaluateur : « ta condition de victoire est non-déterministe » (module jeu) et « ton IA
> peut halluciner le résultat » (risque RAG). Le score est reproductible et défendable.

> ### Décision d'architecture n°2 (RÉVISÉE ~août 2026) — lecteur vidéo embarqué, mais synchro sur la FENÊTRE DE VOTE, pas sur l'image
>
> **Pivot Option B.** On réintègre un **lecteur vidéo embarqué** : une compilation de cinq
> clips viraux **s'enchaîne pendant la manche**, et les joueurs jugent chaque clip en direct
> (bouton **« good news » / « fake news »**). Le score est une **course à la précision** — le
> pot va au plus juste, ça reste PvP à somme nulle (cf. module jeu, la défense tient).
>
> **Ce qu'on N'abandonne PAS : la synchro frame-accurate de la vidéo.** La vidéo joue côté
> client ; seule la **fenêtre de vote** est pilotée par le serveur (« clip N, vote ouvert
> jusqu'à T+Δ », identique pour tous). C'est ÇA la synchro temps réel notée (IV.1/IV.6) — le
> pixel de la vidéo, non. Le PvP reste équitable sans le coût du frame-sync.
>
> **Dépendance assumée :** l'embed doit rester une iframe pure, YouTube ou Facebook. Mesuré
> sous Chrome, tout le bruit console part alors sous les domaines de la plateforme et
> `localhost` reste à zéro. On exclut les widgets X, Instagram et TikTok, qui exécutent leur
> JavaScript dans notre origine et nous attribueraient leurs erreurs.

**Les paris se font en crédits virtuels, sans valeur réelle ni cash-out.**
Choix volontaire : cadre scolaire sain, pas de KYC/paiement, et les pages ToS/Privacy le
diront explicitement (lève toute ambiguïté « jeu d'argent »).

---

## 2. Plan de modules — 18 points visés (audité contre le sujet)

Objectif du sujet : **14 points** (Major = 2, Minor = 1). On vise **18** pour absorber un
recalage (le sujet recommande de dépasser 14). Chaque module cite sa sous-section du sujet.

### Majors (7 × 2 = 14 pts)

| # | Module | Réf. sujet | Pourquoi il colle |
|---|---|---|---|
| 1 | Framework front + back | IV.1 (l.472) | React(Vite)+Tailwind & NestJS — frameworks explicitement admis. Risque ~nul. |
| 2 | Temps réel (WebSockets) | IV.1 (l.481) | Cœur du produit : machine à états, votes/pot live, verdict streamé, chat. Couvre connexion/déconnexion propres. |
| 3 | User interaction (chat + profil + amis) | IV.1 (l.486) | **Ancré sur le chat du salon** (envoi/réception) comme livrable porteur ; profil/amis incidents ici. |
| 4 | Gestion utilisateur standard | IV.3 (l.555) | Édition profil, **upload avatar** (+ défaut), amis + **statut en ligne**, page profil. Distinct de l'auth de base. |
| 5 | RAG complet | IV.4 (l.609) | Corpus fact-check sur pgvector ; récupération par claim + citations. Réutilisé en surface Q&A autonome « pose un claim ». |
| 6 | Interface LLM (streaming) | IV.4 (l.614) | Génère l'explication token par token, gestion d'erreurs + **rate limiting**. Surface chatbot à saisie libre distincte. |
| 7 | **Jeu web** (Arène de fact-check) | IV.6 (l.645) | Règles claires, victoire/défaite, matchs live, joueurs les uns contre les autres (vote good/fake par clip, course à la précision à somme nulle). |

### Minors (4 × 1 = 4 pts)

| # | Module | Réf. sujet | Pourquoi il colle |
|---|---|---|---|
| 8 | ORM | IV.1 (l.498) | Prisma sur NestJS+PostgreSQL. Quasi gratuit, sous-tend le schéma clair exigé (III.3). |
| 9 | OAuth 2.0 (42) | IV.3 (l.571) | Login 42 **en plus** de l'email+mot de passe (jamais en remplacement). |
| 10 | Modération IA | IV.4 (l.624) | Chat du salon passé dans une auto-modération par modèle (auto-warn/auto-delete). Dépend du chat (module 3). |
| 11 | Stats de jeu & historique | IV.3 (l.561) | Victoires, défaites, classement, historique des manches, leaderboard. Dépend du jeu (module 7). |

### Marge sur les 14 points exigés

Onze modules pour 18 points, quand le sujet en demande 14. La marge sert à absorber un
imprévu le jour de l'évaluation, pas à compenser un module faible : chacun des onze est
implémenté et démontrable.

Le point d'attention qui en découle, et qui a guidé l'exécution : RAG et interface LLM sont
deux modules majeurs distincts, et ils doivent se **voir** comme tels. D'où deux surfaces
séparées à l'écran — le bot sourcé du salon d'un côté, la génération libre en streaming de
l'autre. Voir §3.

> ATTENTION : **ne pas ajouter de scope** (tournoi, spectateur, AI-opponent, chat avancé) tant que
> ces 18 points ne sont pas **pleinement fonctionnels** : le sujet ne compte que les
> modules complets (module incomplet = 0 point, l.462-465).

---

## 3. Les trois pièges à points (priorités d'exécution)

Le sujet punit sévèrement les modules « à moitié faits ». Trois zones sont critiques :

1. **RAG vs LLM doivent être PROUVÉS distincts** (4 pts en jeu). RAG = récupération +
   ancrage + citations sur des questions libres. LLM = génération streamée à partir d'une
   **saisie utilisateur**, avec rate-limit et gestion d'erreurs, **démontrée retrieval
   désactivé** (déclencher un vrai 429 / une erreur provider en live).
2. **RAG « large dataset » (l.610)** : ingérer **des milliers de documents** (dataset
   fact-check public / sous-ensemble Wikipédia). Ne jamais présenter le corpus comme
   « petit ». Démontrer la surface Q&A autonome, pas seulement le pipeline interne.
3. **Le module jeu (IV.6) est le plus contestable** : durcir son identité — (a) le verdict
   de chaque clip vient d'une clé de réponse pré-étiquetée déterministe ; (b) rendre le PvP
   visible et à somme nulle (distribution des votes adverses, tableau de scores du salon) ;
   (c) écran de **règles écrites** + repli « le plus de bonnes réponses gagne » pour qu'il y
   ait toujours un gagnant ; (d) comptes de test/seed pour démontrer un salon à < 3 humains.

---

## 4. Contraintes éliminatoires → où elles sont traitées

Non négociables : leur non-respect = **projet rejeté**.

| Contrainte (réf. sujet) | Traitée par |
|---|---|
| Front + back + base (l.310) | React / NestJS + FastAPI / PostgreSQL |
| Lancement **une commande** (l.320) | `docker compose up` (§8) |
| Chrome, **zéro** erreur console (l.323) | SPA ciblée Chrome + check avant éval (attention WS reconnect, autoplay, flux interrompu) |
| **Privacy Policy + ToS** réelles, footer (l.327) | Pages dédiées ; ToS précise « crédits virtuels, sans valeur » |
| Multi-user simultané, sans race (l.340) | Salons WS + règlement crédits en **transaction atomique** + verrou serveur |
| CSS framework, responsive, accessible (l.363) | Tailwind, layouts responsives, contrôles de pari au clavier |
| Secrets `.env` gitignoré + `.env.example` (l.368) | Racine (§7) |
| Schéma DB clair + relations (l.371) | Prisma schema (§5) |
| Auth email+mdp **hash+sel** (l.373) | NestJS + Argon2/bcrypt (§6) ; OAuth 42 en plus |
| Validation **front ET back** (l.382) | Zod/react-hook-form (front) + DTO/class-validator (Nest) + Pydantic (FastAPI) |
| **HTTPS/WSS** pour tout trafic entrant (l.385) | nginx termine le TLS, y compris le WebSocket |
| Dépendances de modules respectées (l.443) | Stats→jeu OK ; modération→chat OK ; pas de conflit SSR/ICP |

---

## 5. Architecture globale & base de données

### 5.1 Vue conteneurs

Le navigateur ne parle **qu'à nginx**.

```
              Navigateur (Chrome) ──HTTPS/WSS (443)──▶ nginx (TLS unique, sert le build React)
                                                          │  /api, /socket.io        │ (interne)
                                                          ▼                          ▼
                                                 back-core (NestJS)  ──HTTP interne─▶ back-ai (FastAPI)
                                                 auth, salons, jeu,                   RAG (pgvector),
                                                 crédits, WS, API                     LLM streaming, modération
                                                          │ Prisma                    │ SQLAlchemy/psycopg
                                                          ▼                          ▼
                                                 ┌───────────────────────────────────────────┐
                                                 │      PostgreSQL (+ extension pgvector)      │
                                                 └───────────────────────────────────────────┘
```

**Règle d'or :** le front ne parle **jamais** directement à `back-ai`. Tout passe par
`back-core` (auth centralisée, rate-limit, une seule surface exposée).

### 5.2 Schéma de base (géré par Prisma, sauf vecteurs)

> **Partage de PostgreSQL.** Prisma gère mal le type `vector`. On sépare :
> tables **relationnelles** → Prisma (NestJS), dans le schéma `public` ; tables
> **vectorielles** (corpus + embeddings) → FastAPI (psycopg + `CREATE EXTENSION
> vector`), dans un schéma **dédié `rag`**, même base. Frontière logique par `id`,
> pas de jointure Prisma↔vecteur.
>
> ⚠️ **Pourquoi un schéma `rag` séparé (et pas `public`) :** le `prisma db push`
> du backend gère `public` et veut SUPPRIMER toute table qu'il n'y connaît pas —
> dont `documents`. En isolant les tables IA dans `rag`, Prisma ne les voit plus
> et ne peut pas les détruire. Le service IA se connecte avec `search_path =
> rag,public` (voir `ai-service/app/db.py`).

Entités relationnelles (Prisma) :

```
User ──1─N── Bet             (un joueur mise une fois par manche)
User ──1─N── ClipVote        (un vote good/fake par clip vu)
User ──1─N── Transaction       (journal des crédits virtuels)
User ──N─N── User (Friendship) (amitié + statut en ligne)
User ──1─N── Stat / classement

Room/Match ──1─N── Round        (un salon enchaîne des manches)
Round ──N─N── Claim (via RoundClaim)   (une manche = un lot de N clips)
Round ──1─N── Bet               (les mises de la manche)
RoundClaim ──1─N── ClipVote     (les votes good/fake sur ce clip)
Claim ──1─1── ClaimVerdict      (explication IA — AFFICHAGE seulement)
```

Champs porteurs :
- **Claim** : `id`, `text` / `mediaRef`, **`truthLabel`** (clé de réponse éditoriale :
  TRUE/FALSE — c'est la source de vérité du jeu), `category`, `sourceUrl`.
- **Round** : `id`, `roomId`, `status` (OPEN/LOCKED/REVEALED), `opensAt`, `locksAt`.
  (Plus de `trueFakeCount` : le score n'est plus « combien de faux » mais la précision clip
  par clip — la vérité de chaque clip est le `truthLabel` du `Claim`.)
- **Bet** (le « pari » d'une manche) : `id`, `userId`, `roundId`, `stake`, `correctCount`
  (dérivé des votes), `payout?`, `result` (WIN/LOSS), `createdAt`.
- **ClipVote** (le jugement d'un clip) : `id`, `userId`, `roundClaimId`, `vote` (GOOD/FAKE),
  `isCorrect` (dérivé du `truthLabel` : GOOD ⇔ TRUE), `votedAt`. Fenêtre de vote synchronisée
  par le serveur — un vote hors fenêtre est refusé.
- **ClaimVerdict** : `id`, `claimId`, `verdictText` (LLM), `confidence`, `citations` (JSON,
  issues du RAG). **N'intervient jamais dans le score** — display only.
- **Transaction** : `id`, `userId`, `type` (BET/PAYOUT/BONUS), `amount`, `balanceAfter`.
- **User** : `id`, `email` (unique), `passwordHash`, `displayName`, `avatarUrl`, `role`,
  `virtualBalance`, `createdAt`. *(Le sel est intégré au hash Argon2/bcrypt — pas de
  colonne `salt` séparée.)*

Tables IA (FastAPI, pgvector) :
- **Document** : `id`, `title`, `url`, `content`, `embedding vector(N)`, `chunkIndex` —
  le corpus « large » indexé pour la recherche de similarité (RAG).

### 5.3 Cohérence multi-utilisateur

Le règlement d'une manche (débiter les mises, créditer les gagnants, écrire le journal)
est **une transaction Prisma atomique** avec verrou de ligne. Le verrou de pari à zéro est
**côté serveur** (jamais côté client). Le solde est la conséquence du journal
`Transaction`, jamais recalculé à la main côté front.

---

## 6. Backend cœur — NestJS (modules)

**Découpage CIBLE** (vers quoi on tend — chaque membre crée SES modules ici) :

```
backend/src/
├── auth/            # email+mdp (Argon2), JWT, OAuth 42
├── users/           # profils, avatars, amis, statut en ligne (présence WS)
├── rooms/           # salons/matchs, cycle de vie
├── rounds/          # machine à états manche (fenêtre de vote par clip), compilation de clips
├── predictions/     # mises + votes good/fake par clip, score (course à la précision), résolution
├── ledger/          # crédits virtuels (transactions atomiques, solde)
├── realtime/        # gateway WebSocket (état de manche, votes live, chat, présence)
├── fact-check/      # appelle back-ai (verdict d'affichage + Q&A)
├── moderation/      # relaie le chat vers la modération IA
├── stats/           # historique, classement
├── public-api/      # (option) API publique à clé — non retenue dans les 18 pts
├── prisma/          # service Prisma partagé
└── common/          # DTO, ValidationPipe, guards, filtres
```

Validation : `class-validator` + `ValidationPipe` global. Le back ne fait jamais confiance
au front (dernier rempart).

### 6.1 Structure INITIALISÉE aujourd'hui — où ajouter votre code

Le squelette réellement en place (volontairement minimal) :

```
backend/
├── prisma/
│   └── schema.prisma      # SEULE table pour l'instant : User (voir §5.2 pour la cible)
└── src/
    ├── main.ts            # bootstrap : setGlobalPrefix('api') + ValidationPipe global
    ├── app.module.ts      # module racine : c'est ICI qu'on enregistre chaque nouveau module
    ├── prisma/            # PrismaModule (@Global) + PrismaService partagé
    ├── health/            # GET /api/health (sonde) — exemple de module complet minimal
    └── auth/              # module VIDE (structure seule : module + service + controller)
```

**Comment ajouter une feature** (ex. `users`) :
1. Créer `src/users/` avec `users.module.ts`, `users.service.ts`, `users.controller.ts`
   (le module `health/` sert de modèle de module minimal).
2. Injecter `PrismaService` dans le service (il est `@Global`, pas besoin de le réimporter).
3. Déclarer les routes avec des **DTO validés** (`class-validator`) — la `ValidationPipe`
   globale s'occupe du reste.
4. Ajouter le module dans le tableau `imports` de `app.module.ts`.
5. Ajouter vos tables dans `prisma/schema.prisma`, puis (en dev) `npx prisma db push`.

> **Contrats à respecter** (imposés par nginx / le healthcheck) :
> - `main.ts` garde `app.setGlobalPrefix('api')` (nginx conserve le préfixe `/api`).
> - la route `GET /api/health` doit rester disponible (utilisée par le healthcheck Docker).

---

## 7. Frontend, secrets, sécurité (rappels)

- **Front** React(Vite)+Tailwind, SPA. Pages **Privacy Policy** & **Terms of Service**
  réelles, liées au footer (ToS : crédits virtuels sans valeur). **Zéro erreur console**
  Chrome (surveiller WS reconnect, autoplay, flux LLM interrompu). Responsive + accessible.
- **Secrets** : `.env` gitignoré + `.env.example` commité (structure sans valeurs).
- **Sécurité** : mots de passe hachés+salés, HTTPS/WSS via nginx, validation systématique
  côté serveur, rate-limit sur l'interface LLM, crédits en transactions atomiques.

---

## 8. Déploiement — docker compose (une commande)

`docker compose up` démarre : `nginx` (TLS, sert React, proxy) · `back-core` (NestJS) ·
`back-ai` (FastAPI) · `postgres` (+ pgvector) · build front.
Points clés : `depends_on` + healthchecks (attendre Postgres) ; migrations Prisma +
`CREATE EXTENSION vector` jouées au démarrage ; volume persistant Postgres ; seul le port
443 de nginx exposé.

---

## 9. Décisions prises en cours de route

Ce qui a été arbitré, et pourquoi. Les questions sont fermées ; on garde le raisonnement
parce qu'il explique la forme du projet.

**Le médium d'une manche : lecteur vidéo embarqué** (révisé en août 2026). On est partis de
texte et d'images, on a basculé sur des extraits vidéo qui s'enchaînent, avec un vote fact
ou fake par clip. C'est ce qui rend le jeu lisible en dix secondes pour quelqu'un qui
découvre. Contrepartie assumée : l'embed impose une iframe pure, jamais un widget qui
exécute son JavaScript chez nous (cf. Décision n°2 révisée).

**Un assistant interrogeable dans le chat** (`@bot`). Il donne un vrai foyer au module LLM —
streaming, saisie libre, limitation de débit — et au RAG, qui cite ses passages. Deux
garde-fous encadrent son usage. D'abord il ne tranche jamais un clip de la manche en cours :
il arbitrerait le jeu, ce qui violerait la Décision n°1. Ensuite RAG et LLM restent deux
surfaces séparées à l'écran, sinon les deux majors se lisent comme un seul.

**Le corpus vient de fact-checkeurs identifiés**, via l'API Google Fact Check Tools, pas
d'une sélection maison. Chaque clip garde le lien de l'article qui a rendu son verdict. Le
tri éditorial qui a suivi a écarté les contenus de guerre, les sujets politiques partisans
et tout ce qui demanderait un avertissement.

**Le fournisseur LLM est une API externe**, clé dans `.env`. Un modèle auto-hébergé dans
FastAPI aurait évité la dépendance, mais pas tenu dans les ressources d'une machine d'école.

**On garde les statistiques de jeu** dans le plan de modules.

**La répartition** : RAG et LLM à la personne qui tient le service IA, interaction et
gestion de compte à un seul propriétaire, le reste par périmètre (voir README).

**La reconnexion en cours de manche restaure l'état**, ce qu'exige le sujet ligne 484 sur
la gestion des déconnexions.

---

*Document vivant : toute décision d'archi importante s'y consigne (traçabilité exigée par
le sujet). Concept et plan de modules issus d'une synthèse auditée contre le sujet.*
