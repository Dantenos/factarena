*This project has been created as part of the 42 curriculum by slario, alaroque, elanteno, krfranco, oztozdem.*

# FactArena — Live Fake-News Fact-Checking Arena

## Team — start here

The infrastructure is done and it works. `docker compose up --build` brings up the five
services (nginx, frontend, backend, AI service, PostgreSQL+pgvector) and serves the app over
HTTPS at **https://localhost:8443** — nothing to install, nothing to configure by hand. Clone the
repo, copy `.env.example` to `.env`, run the command, and you have a working stack.

So you can start on your own scope right away:

| Scope | Where your code goes | Read first |
|---|---|---|
| Back-end core | `backend/src/<your-module>/` | `docs/ARCHITECTURE.md` §6.1 — how to add a module |
| AI service | `ai-service/app/{rag,llm,moderation}/` | `docs/ARCHITECTURE.md` §5.2 — pgvector is already enabled |
| Front-end | `frontend/src/{pages,components}/` | `frontend/src/pages/Home.tsx` — a working `/api` call |
| DevOps / infra | `docker-compose.yml`, `nginx/` | the comments in those files |

For day-to-day work use the **development** command (hot reload) further down — not the
production one, or you will rebuild the whole image on every saved file.

Two rules that keep us out of trouble: `docker compose up` must always stay the production
path (that is the single command the grader runs), and the browser console must stay clean —
the subject rejects a project on either one. Everything else, we can discuss.

## Description

**FactArena** is a real-time multiplayer fact-checking game about misinformation. Players
join a live room and watch a **compilation of ~10 short viral video clips** play in sequence;
for each clip, competing against each other, they call it **"good news" or "fake news"** in a
server-synchronized vote window, having staked **virtual credits** (no real money, ever). When
the compilation ends, an AI bot **streams** a sourced verdict for each clip (true/false +
confidence + citations). Scoring is an **accuracy race**: whoever correctly judged the most
clips wins the shared pot; players climb a global leaderboard.

**Key design decision:** the verdict of each clip that decides the winners comes from a
**pre-labeled editorial answer key** stored in the database, **not** from the live LLM.
Scoring is deterministic; the RAG/LLM layer only *explains* the pre-known verdict — it never
adjudicates the game. Real-time "sync" is a server-authoritative round state machine
(countdown → lock → reveal) over WebSocket, not frame-accurate video streaming.

Key features:
- Real-time rooms: a viral-clip compilation plays; per-clip good/fake voting with live pot, synchronized vote windows and locked votes (WebSockets)
- AI fact-checking bot: streamed LLM explanations grounded by a RAG vector database
- A standalone "ask a claim → sourced answer" Q&A surface (reuses the RAG engine)
- User accounts (email/password + 42 OAuth), profiles, avatars, friends, online status
- Leaderboard, match history and game statistics
- AI-moderated room chat

## Instructions

### Prerequisites
- Docker & Docker Compose (v2) — nothing else. No local Node.js or Python needed:
  everything (build included) happens inside the containers.
- A `.env` file at the root — copy `.env.example` and fill in the values
  (never commit `.env`, it is git-ignored)

### Run (production — this is what a grader runs)
```bash
git clone <repo-url> ft_transcendence && cd ft_transcendence
cp .env.example .env   # then edit the values
docker compose up --build
```
The application is served by nginx at **https://localhost:8443**. The development certificate is
self-signed, so Chrome shows a warning once: click *Advanced → Proceed*. This is expected.

The first build takes a few minutes (it installs every dependency and builds the SPA).
Once every service reports `healthy`, the stack is ready:

| Check | Expected |
|---|---|
| `https://localhost:8443/` | the SPA loads |
| `https://localhost:8443/api/health` | `{"status":"ok"}` |
| `docker compose ps` | 5 services, all `healthy` |

### Run (development — hot reload, for daily work)
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```
Same URL, same nginx, same TLS — but your local code is mounted into the containers: save a
file and the browser reloads on its own (React), or the API restarts on its own (NestJS).
See `docker-compose.dev.yml` for the details.

> Only nginx publishes a port (8443 on the host, 443 inside). Every other service talks over the private Docker
> network, which is why `docker compose ps` shows no host ports for them — that is intended,
> not a bug.

### Useful commands
```bash
docker compose ps               # health of every service
docker compose logs -f backend  # follow one service's logs
docker compose down             # stop everything (keeps the database)
docker compose down -v          # stop AND wipe the database volume
```

Demo accounts are created automatically when `SEED_DEMO_DATA=true` in your `.env`
(admin, host, player and viewer). Their passwords are the ones you set in `.env` — they
are never committed. Use two different browsers, or a private window, to demonstrate
several players in the same room.

## Team Information

| Login | Role(s) | Responsibilities |
|---|---|---|
| `slario` | DevOps — **PM / Scrum Master** | Docker Compose, nginx and TLS, GitHub Actions CI, meetings, deadlines |
| `alaroque` | **Back-end Core** | NestJS, auth, WebSockets, round state machine, credits, PostgreSQL |
| `elanteno` | **Tech Lead / Architect** — AI (Python) | FastAPI, RAG corpus, LLM streaming, moderation, front/back integration |
| `krfranco` | Front-end UI & Access — **Product Owner** | Product vision, design system, page layouts, Tailwind theme |
| `oztozdem` | Front-end Real-time & UX | Room screen and its components: chat, betting panel, stats bar, reveal |

All members are **Developers**: they write code, review each other's PRs, test and document
their scope.

## Project Management

- **Work breakdown**: one scope per member (DevOps, back-end core, AI service, front-end
  UI, front-end real-time), each with its own long-lived branch — `DevOps/slario_Scynia`,
  `Ana_backend`, `feat/service-ia-rag-llm`, `Krystal_frontend`, `feat/frontend-tr`. The
  branch names in the repository are the actual record of who owned what.
- **Task tracking**: GitHub pull requests. Every merge into `main` went through a PR, which
  is also where disagreements were settled — PR #6 was reverted after it broke the stack on
  the school machines, and the ELK stack was removed by PR after it turned out `podman`
  cannot create containers using the `gelf` log driver.
- **Communication**: Discord, for daily coordination and for warning the owner of a scope
  before touching their files.
- **Code review**: at least one other member reviews a PR before it is merged.

## Technical Stack

| Layer | Technology | Why |
|---|---|---|
| Reverse proxy | nginx | Single HTTPS/WSS entry point required by the subject |
| Frontend | React (Vite) + Tailwind CSS | Imposed framework + valid CSS solution; fast SPA |
| Backend core | NestJS + Prisma | Structured framework for auth, WebSockets, game loop |
| AI microservice | FastAPI (Python) | Independent service, mature Python AI ecosystem |
| Database | PostgreSQL + pgvector | Relational data + vector search for RAG |
| Containers | Docker Compose | One-command deployment (subject requirement) |

### Why these choices

**Two backends instead of one.** The game logic (auth, rooms, credits, WebSocket state
machine) and the AI layer (embeddings, retrieval, LLM streaming) have nothing in common
except the database. Splitting them lets the AI service be written in Python — where the
ecosystem actually lives — while the game keeps NestJS's structure and typing. The front
never talks to the AI service directly: NestJS relays every call, so authentication and
rate limiting stay in one place.

**PostgreSQL with pgvector, not a separate vector database.** Adding a dedicated vector
store would mean a second database to deploy, back up and keep consistent. pgvector keeps
the corpus passages next to the relational data, in one container. The boundary is
logical: Prisma owns the `public` schema, the AI service owns the `rag` schema — Prisma
handles the `vector` type poorly, so it never sees it.

**Mistral as the single AI provider.** One API key covers all three needs: embeddings
(`mistral-embed`, 1024 dimensions), streaming chat, and a model-based moderation endpoint.
The subject requires moderation to be decided by a model, not a word list, and Mistral
exposes exactly that. Being a French company processing data in the EU also keeps the
privacy policy simple.

**Deterministic answer key, never the LLM.** The verdict that decides who wins comes from
a pre-labelled editorial `truthLabel` stored in the database. The RAG/LLM layer only
*explains* a verdict that is already known. Scoring is reproducible, and a model
hallucination can never change a game's outcome.

## Database Schema

Thirteen relational tables managed by Prisma, plus one vector table owned by the AI service.

```
User ──1─N── Bet              one stake per player per round
User ──1─N── ClipVote         one good/fake vote per clip
User ──1─N── Transaction      virtual-credit ledger
User ──N─N── User (Friend)    friendship + online status
User ──1─N── Message          room chat

Room ──1─N── Round            a room chains rounds
Round ──N─N── Claim (via RoundClaim, ordered)
Round ──1─N── Bet / ClipVote
Claim ──1─1── ClaimVerdict    AI explanation — display only
Room ──1─N── RoomPresence     who is connected, by socket
```

Key fields. **Claim** carries `truthLabel` (TRUE/FALSE), the editorial answer key, plus
`mediaRef`, `videoStartS`/`videoEndS`, `sourceUrl` and `sourceKey` (unique, makes imports
idempotent). **Round** moves through `COUNTDOWN → OPEN → LOCKED → REVEALED → FINISHED`.
**Bet** holds the stake and the payout; **ClipVote** holds one `isFake` per claim, unique
per `(user, round, claim)`. **Transaction** records every credit movement with a
`referenceId` that makes payouts idempotent.

Separately, the AI service owns `rag.documents` (`source`, `title`, `url`, `content`,
`chunk_index`, `embedding vector(1024)`) with an HNSW cosine index.

## Features List

| Feature | Member(s) | Description |
|---|---|---|
| Account & authentication | alaroque | Sign-up and sign-in by email and password (bcrypt, salted), plus 42 OAuth; JWT issued for both the REST API and the WebSocket |
| Live rooms | alaroque | Create or join a room, see members appear and leave in real time, presence persisted server-side so a reconnection restores the player |
| Round state machine | alaroque | Server-authoritative `COUNTDOWN → OPEN → LOCKED → REVEALED → FINISHED`, driven by a 250 ms server loop that advances rounds even with no client connected |
| Clip drafting | alaroque, elanteno | The server draws the round's clips itself, balanced at roughly 60 % false and excluding clips already played in that room |
| Good/fake voting | alaroque | One vote per clip while the round is open, one stake per round |
| Accuracy-race scoring | alaroque | Whoever judges the most clips correctly takes the shared pot, split on a tie; settlement is a single atomic PostgreSQL transaction |
| Virtual credit ledger | alaroque | Every debit and payout is journalled with the resulting balance; payouts are idempotent |
| Room chat | oztozdem, alaroque | Send and receive messages in real time |
| AI moderation | elanteno, alaroque | Every message is judged by a model (not a word list) and allowed, flagged or hidden |
| Questionable AI bot | elanteno | `@bot` in the chat returns a sourced answer streamed token by token, and refuses to comment on clips from the round in progress |
| Sourced fact-check corpus | elanteno | 1 559 passages shipped with the repository (published fact-checks plus INSEE, Eurostat and World Bank figures), loaded on first start with their pre-computed vectors so the bot cites sources without any ingestion run. The ingestion scripts can grow it further — our own working index holds 72 000 passages including French Wikipedia. |
| Profile & stats | krfranco, alaroque, elanteno | Profile page with win rate, rounds played and credit balance; display-name editing and avatar upload; match history listing each finished round with its date, room, opponents, stake and net gain |
| Friends | elanteno | Search players by e-mail or display name, add and remove them, see who is online or in a game, and join their room in one click |
| Playable clip corpus | elanteno | 87 clips with a playable video, 72 of them with their reveal explanation, all shipped in the seed |
| Responsive layout | krfranco, elanteno | Every page adapts from 320 px upwards: the multi-column grids stack, the navigation wraps, and the room's chat moves below the video. Verified with no element overflowing the viewport at 320, 390, 768 and 1024 px. |

## Modules

Target: **18 points** (14 required). Game-independent floor: **15 points** (safe even if
the game module and its dependent stats module are both rejected). See `docs/ARCHITECTURE.md`
for the audited rationale and per-module subject references.

| Module | Type | Pts | Member(s) | Status |
|---|---|---|---|---|
| Framework frontend + backend | Major | 2 | krfranco, oztozdem, alaroque | Done |
| Real-time via WebSockets | Major | 2 | alaroque | Done |
| User interaction (chat, profile, friends) | Major | 2 | oztozdem, krfranco, elanteno | Done |
| Standard user management | Major | 2 | alaroque, elanteno | Done |
| Complete RAG system | Major | 2 | elanteno | Done |
| LLM interface (streaming) | Major | 2 | elanteno | Done |
| Web-based game (live fact-check arena) | Major | 2 | alaroque, oztozdem, elanteno | Done — **needs staff validation** |
| ORM (Prisma) | Minor | 1 | alaroque | Done |
| OAuth 2.0 (42) | Minor | 1 | alaroque | Code done — needs the 42 API credentials in `.env` |
| AI content moderation | Minor | 1 | elanteno, alaroque | Done |
| Game statistics & match history | Minor | 1 | alaroque, elanteno | Done |

### How each module is implemented

**Framework front + back.** React with Vite and Tailwind on the front, NestJS with Prisma
on the back — both explicitly accepted by the subject.

**Real-time via WebSockets.** A Socket.IO gateway authenticated by JWT, exposing nine
events (`room:join`, `bet:place`, `clip-vote:submit`, `chat:send`, `ai:chat`…) and
broadcasting round transitions. Presence is stored in the database rather than in memory,
so a reconnection restores the player into their room. Every state message carries the
server clock, which the client uses to correct its own drift — otherwise a player whose
machine runs ten seconds fast would vote in a shifted window.

**User interaction.** Room chat as the core deliverable, with profile and friends
alongside.

**Standard user management.** Profile editing, avatar upload, friends list and online
status — distinct from the basic authentication required by the subject.

**Complete RAG system.** Cosine search over pgvector, answers grounded in the retrieved
passages and always citing their URL. The repository ships 1 559 passages with their
pre-computed vectors, so a freshly cloned installation answers with sources without running
any ingestion; the ingestion scripts grow that corpus further, and our own working index
holds 72 000 passages. The corpus mixes general knowledge (Wikipedia), published fact-checks
(AFP, franceinfo, TF1, dpa) and live official indicators (INSEE, Eurostat, World Bank),
which lets the bot answer national, European and international claims with a dated, sourced
figure.

**LLM interface.** Streaming generation from free user input, with retrieval switched off —
this is what makes it demonstrably distinct from the RAG surface — plus a server-side rate
limiter on top of the provider's own 429 handling.

**AI moderation.** Every chat message goes through Mistral's moderation endpoint; the
policy that turns categories into an action (allow, warn, delete) is ours and is the part
worth explaining.

**Web-based game.** Rounds run live, players compete against each other, rules are written
and the win condition is deterministic because it comes from the editorial answer key.

**ORM, OAuth 2.0, game statistics.** Prisma with six versioned migrations; 42 login in
addition to — never instead of — email and password; wins, losses, ranking and match
history computed from the bet ledger.

## Individual Contributions

Reconstructed from the git history of `main` (`git shortlog -sn origin/main`, and
`git log --author=… --name-only` per scope). Each member should extend their own paragraph
with the parts a diff cannot show.

### `slario` — DevOps, PM
27 commits. Owns `docker-compose.yml`, the nginx configuration and TLS certificates, the
GitHub Actions workflows and the container entrypoints. Built the ELK logging stack
(Elasticsearch, Logstash, Kibana with its certificate generator and security settings),
then removed it once we established that `podman`, which the school machines use, refuses
to *create* a container declaring the `gelf` log driver — the stack could not start at all
during an evaluation. Also solved two problems specific to the 42 machines: the `chown` in
the images failed on the school's filesystem, and port 443 is not available to a student, so
nginx publishes 8443 instead. Reverted PR #6 when it broke the stack for everyone.

### `alaroque` — Back-end core
13 commits, the largest single addition to `backend/`. Wrote almost the whole NestJS
application: Prisma schema and its six migrations, email/password authentication with bcrypt
and the JWT strategy, the 42 OAuth strategy, rooms and their server-side presence, the
round state machine, the betting and clip-vote modules, the accuracy-race settlement as one
atomic transaction, the idempotent credit ledger, the statistics and leaderboard module, the
claims CRUD, the Socket.IO gateway and its ten events, and the backend test suite. Also
wrote the relay that lets the front reach the AI service through NestJS only, so
authentication and rate limiting stay in one place.

### `elanteno` — Tech Lead / Architect, AI service
38 commits, the largest contributor by volume, mostly under `ai-service/app/rag/`. Built the
FastAPI service: the pgvector schema and its HNSW index, embedding through `mistral-embed`,
retrieval, SSE streaming for both the RAG and the free-form LLM surfaces, the moderation
policy on top of Mistral's endpoint, and the rate limiter. Assembled the game's content: the
ingestion pipelines from the Google Fact Check Tools API, INSEE, Eurostat, the World Bank
and Wikipedia, plus the hand-written claim sets, and the curation loop (in-game reporting,
sorting rounds, duration filtering, Theora-to-WebM conversion after Chrome dropped Theora in
v123). Exported the corpus and the pre-computed vector index into the repository so a fresh
clone plays and cites sources without any ingestion run. On the front, wired the pages to the
real API (auth context, HTTP client, room screen, video player), added the friends screen and
the responsive pass.

### `krfranco` — Front-end UI, Product Owner
13 commits. Owns the visual identity: the Tailwind theme and colour tokens in `index.css`,
the shared layout, and the layouts of the home, login, profile and lobby pages. Defined the
component vocabulary (`button-blue-d`, `button-red-l`, the card and panel shapes) that the
rest of the front reuses, which is why later screens could be added without inventing new
styles.

### `oztozdem` — Front-end real-time and UX
8 commits on the feature branch, one merged into `main`. Built the room screen and its
components from the design mock-up: the chat panel with per-author colouring and the
moderation badge, the betting panel, the statistics bar, the clip progress bar, the results
reveal, and the video player. Also wrote `mocks/gameData.ts`, the shared data shapes that
let the room UI be built and reviewed before the WebSocket contract was final.

## Resources

- Project subject: `docs/subject.pdf` (source of truth)
- Architecture & module rationale: `docs/ARCHITECTURE.md`
- AI service roadmap and decisions: `docs/AI.md`
- Game content specification: `docs/CLAIMS.md`

External services and data sources actually used:

- Mistral AI — embeddings (`mistral-embed`), streaming chat, moderation endpoint
- Google Fact Check Tools API — structured ClaimReview data feeding both the RAG corpus and
  the game's answer key
- INSEE (Banque de données macroéconomiques, SDMX) — French national indicators
- Eurostat REST API — French and EU-wide indicators, used for comparative claims
- World Bank (World Development Indicators) — international comparisons
- French Wikipedia — general-knowledge corpus

**AI usage.** AI assistants (Claude Code) were used for scaffolding, boilerplate,
documentation drafts and reviewing data-ingestion edge cases. Every AI-assisted change was
read, understood and tested by the member who committed it, as the subject requires. Where
generated output was wrong it was corrected and the reason recorded in the commit — for
instance, an early verdict-mapping heuristic labelled a demonstrably false claim as true
because the fact-checker's rating was written as prose containing the word "confirmed"; the
mapper now accepts only short verdict labels and discards ambiguous ones.

Each member is responsible for stating, in their own paragraph above, where they used AI and
what they changed afterwards.
