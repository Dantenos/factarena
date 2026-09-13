*This project has been created as part of the 42 curriculum by slario, alaroque, elanteno, krfranco, oztozdem.*

# FactArena: Live Fake-News Fact-Checking Arena

## Description

FactArena is a multiplayer game about misinformation. Players join a room, stake virtual
credits (never real money), then watch five short viral clips one after another. For each
clip they answer "fact" or "fake". The host drives the playlist, so everyone is on the same
clip at the same time. Whoever judges the most clips correctly takes the pot, and a global
leaderboard tracks accuracy across games.

One decision shaped the whole project: the verdict that decides who wins is a pre-labelled
answer key stored in the database, taken from a published fact-check. It never comes from
the LLM. The AI explains a verdict that is already known; it does not judge the game. That
is what keeps scoring deterministic and what makes the AI modules honest to demonstrate.

Key features:
- Multiplayer fact-checking rooms where players watch the same clips, place virtual-credit bets and vote fact or fake in real time
- Accounts with email/password or 42 OAuth login, JWT authentication, editable profiles, avatar uploads and protected REST/WebSocket access
- Player progression with virtual credits, experience points, levels, achievements, leaderboard rankings, match history and statistics
- Friend search and requests, accepted friendships, online/in-game presence and one-click access to a friend's room
- Real-time room chat with model-based moderation, allowing, warning or hiding messages according to the moderation result
- Two AI-assisted services: a cited RAG assistant grounded in the fact-check corpus and a streaming free-form LLM chat surface
- A curated, source-traceable clip corpus with editorial truth labels, reveal explanations and the ability to report a problematic clip
- Responsive browser UI with embedded external videos, live presence, betting, voting, progress and results views

## Instructions

### Prerequisites
- Docker & Docker Compose (v2). Everything (build included) happens inside the containers.
- The latest stable version of Google Chrome (v153).

### Run
```bash
git clone <repo-url> ft_transcendence && cd ft_transcendence
cp .env.example .env   # then edit the values
docker compose up --build # or make
```
The application is served by nginx at **https://localhost:8443**. The development certificate is
self-signed, so Chrome shows a warning: click *Advanced → Proceed*. This is expected.

The first build takes a few minutes (it installs every dependency and builds the SPA).
Once every service reports `healthy`, the stack is ready:

| Check | Expected |
|---|---|
| `https://localhost:8443/` | the SPA loads |
| `https://localhost:8443/api/health` | `{"status":"ok"}` |
| `docker compose ps` | 5 services, all `healthy` |

### Run (development, with hot reload)
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```
Same URL, same nginx, same TLS, but the local code is mounted into the containers: saving a
file reloads the browser (React) or restarts the API (NestJS).
See `docker-compose.dev.yml` for the details.

> Only nginx publishes a port (8443 on the host, 443 inside). Every other service talks over the private Docker
> network, which is why `docker compose ps` shows no host ports for them; that is intended,
> not a bug.

### Useful commands
```bash
docker compose ps               # health of every service
docker compose logs -f backend  # follow one service's logs
docker compose down             # stop everything (keeps the database)
docker compose down -v          # stop AND wipe the database volume
```

## Team Information

| Login | Role(s) | Responsibilities |
|---|---|---|
| `slario` | DevOps, **PM / Scrum Master** | Docker Compose, nginx and TLS, GitHub Actions CI, meetings, deadlines |
| `alaroque` | **Back-end Core** | NestJS, auth, WebSockets, round state machine, credits, PostgreSQL |
| `elanteno` | **Tech Lead / Architect**, AI (Python) | FastAPI, RAG corpus, LLM streaming, moderation, front/back integration |
| `krfranco` | Front-end UI & Access, **Product Owner** | Product vision, design system, page layouts, Tailwind theme |
| `oztozdem` | Front-end Real-time & UX | Room screen and its components: chat, betting panel, stats bar, reveal |

All members are **Developers**: they write code, review each other's PRs, test and document
their scope.

## Project Management

- **Work breakdown**: one scope per member (DevOps, back-end core, AI service, front-end
  UI, front-end real-time), each with its own long-lived branch, such as `DevOps/slario_Scynia`,
  `Ana_backend`, `feat/service-ia-rag-llm`, `Krystal_frontend`, `feat/frontend-tr`. The
  branch names in the repository are the actual record of who owned what.
- **Task tracking**: GitHub pull requests. Every merge into `main` went through a PR, which
  is also where disagreements were settled; PR #6 was reverted after it broke the stack on
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
| Database | PostgreSQL + pgvector | Reliable relational storage for users, rooms, games and credits, combined with vector search for the RAG corpus in the same database |
| Containers | Docker Compose | One-command deployment (subject requirement) |

### Why these choices

**Two backends instead of one.** The game logic (auth, rooms, credits, WebSocket state
machine) and the AI layer (embeddings, retrieval, LLM streaming) have nothing in common
except the database. Splitting them lets the AI service be written in Python, where the
ecosystem actually lives, while the game keeps NestJS's structure and typing. The front
never talks to the AI service directly: NestJS relays every call, so authentication and
rate limiting stay in one place.

**PostgreSQL with pgvector, not a separate vector database.** Adding a dedicated vector
store would mean a second database to deploy, back up and keep consistent. pgvector keeps
the corpus passages next to the relational data, in one container. The boundary is
logical: Prisma owns the `public` schema, the AI service owns the `rag` schema; Prisma
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

**Embedded video, with the vote window synchronised rather than the picture.** A round is
a playlist of viral clips played in the platform's official iframe (YouTube or Facebook);
we host no video. The server only decides when each clip's vote opens and closes, the same
instant for every player, and that is the real-time part fairness depends on. Syncing the
frames themselves would cost a lot and prove nothing. The embed has to stay a pure iframe:
widgets from X, Instagram or TikTok run their JavaScript inside our origin and would charge
their console errors to us.

**Verdicts come from identified fact-checkers, never from us.** Every clip stores the
verdict published by AFP, Snopes, franceinfo or another signatory of the ClaimReview
standard, together with the article's URL. We never qualify a named person's words
ourselves: the fact-checker carries the editorial responsibility, and every verdict stays
traceable to a dated source. Ambiguous ratings are dropped rather than interpreted. The
rules the ingestion scripts follow are in `ai-service/app/rag/README.md`.

**An external LLM API rather than a self-hosted model.** One key in `.env`. A model served
from the FastAPI container would have removed the dependency, but would not fit in the
resources of a school machine.

## Database Schema

Fifteen relational models are managed by Prisma, plus one vector table owned by the AI service.

```
User ──1─N── Bet                  one stake per player per round
User ──1─N── ClipVote             one vote per player, round and claim
User ──1─N── Transaction           virtual-credit ledger
User ──1─N── Message               room chat messages
User ──1─N── AchievementUnlock     unlocked achievements
User ──1─N── ClipReport            reports submitted by a player
User ──N─N── User (via Friend)     friendship requests and friendships

Room ──1─N── Round                 a room chains rounds
Room ──1─N── Message               messages belong to a room
Round ──1─N── Bet                  one bet per player in a round
Round ──1─N── ClipVote             votes submitted during a round
Round ──N─N── Claim                via RoundClaim, with playback order
Claim ──1─N── ClipVote             votes refer to the judged claim
Claim ──1─N── ClipReport            reports refer to a claim
Claim ──1─1── ClaimVerdict         AI explanation, display only
Room ──1─N── RoomPresence           connected socket presence
```

The 15 Prisma models are `User`, `AchievementUnlock`, `Friend`, `Message`,
`RoomPresence`, `Room`, `Round`, `Claim`, `RoundClaim`, `ClipReport`, `ClaimVerdict`,
`Bet`, `ClipVote` and `Transaction`. In addition to the relationships shown above:

- `AchievementUnlock` records achievements earned by a user.
- `ClipReport` records a user's report for a claim or clip.
- `Friend` represents a directed friendship request and stores either `PENDING` or
  `ACCEPTED` status.
- `RoomPresence` stores the socket, user, room and last-seen timestamp used for
  connection presence and reconnection handling.

Key fields. **Claim** carries `truthLabel` (TRUE/FALSE), the editorial answer key, plus
`mediaRef`, `videoEndS`, `sourceUrl` and `sourceKey` (unique, makes imports
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
| Round state machine | alaroque, elanteno | Server-authoritative `COUNTDOWN → OPEN → LOCKED → REVEALED → FINISHED`, driven by a 250 ms server loop that advances rounds even with no client connected. A round also locks early as soon as every player who staked has judged every clip, so nobody waits out the timer once the game is over. |
| Clip drafting | alaroque, elanteno | The server draws the round's clips itself, balanced at roughly 60 % false and excluding clips already played in that room |
| Good/fake voting | alaroque, elanteno | One vote per clip while the round is open, and one stake per round chosen from the room screen before judging |
| Accuracy-race scoring | alaroque | Whoever judges the most clips correctly takes the shared pot, split on a tie; settlement is a single atomic PostgreSQL transaction |
| Virtual credit ledger | alaroque | Every debit and payout is journalled with the resulting balance; payouts are idempotent |
| Room chat | oztozdem, alaroque | Send and receive messages in real time |
| AI moderation | elanteno, alaroque | Every message is judged by a model (not a word list) and allowed, flagged or hidden |
| Questionable AI bot | elanteno | `@bot` in the chat returns a sourced answer streamed token by token, and refuses to comment on clips from the round in progress |
| Sourced fact-check corpus | elanteno | 1 653 passages shipped with the repository, loaded on first start with their pre-computed vectors so the bot cites sources without any ingestion run: the ClaimReview records of published fact-checks, the full text of the 24 articles that established the verdict of the playable clips, and figures from INSEE, Eurostat and the World Bank. The ingestion scripts can grow it further. |
| Profile & stats | krfranco, alaroque, elanteno | Profile page with win rate, rounds played and credit balance; display-name editing and avatar upload; match history listing each finished round with its date, room, opponents, stake and net gain |
| Friends | elanteno | Search players by e-mail or display name, add and remove them, see who is online or in a game, and join their room in one click |
| Playable clip corpus | elanteno | 54 hand-curated clips with a playable video, 45 of them with their reveal explanation, all shipped in the seed. Clips whose video did not match the claim were reviewed in-game and dropped, as were war footage, partisan political content, and any subject requiring a content warning. |
| Responsive layout | krfranco, elanteno | Every page adapts from 320 px upwards: the multi-column grids stack, the navigation wraps, and the room's chat moves below the video. Verified with no element overflowing the viewport at 320, 390, 768 and 1024 px. |

## Modules

Thirteen modules, **22 points**, for the 14 the subject requires. Each one is explained below.

| Module | Type | Pts | Member(s) | Status |
|---|---|---|---|---|
| Framework frontend + backend | Major | 2 | krfranco, oztozdem, alaroque, slario | Done |
| Real-time via WebSockets | Major | 2 | alaroque | Done |
| User interaction (chat, profile, friends) | Major | 2 | oztozdem, krfranco, elanteno | Done |
| Standard user management | Major | 2 | alaroque, elanteno | Done |
| Complete RAG system | Major | 2 | elanteno | Done |
| LLM interface (streaming) | Major | 2 | elanteno | Done |
| Web-based game (live fact-check arena) | Major | 2 | alaroque, oztozdem, elanteno, slario | Done |
| Multiplayer game (more than two players) | Major | 2 | alaroque, oztozdem, elanteno, slario | Done |
| Backend as microservices | Major | 2 | alaroque, elanteno | Done |
| ORM (Prisma) | Minor | 1 | alaroque | Done |
| OAuth 2.0 (42) | Minor | 1 | alaroque, elanteno | Done |
| AI content moderation | Minor | 1 | elanteno, alaroque | Done |
| Game statistics & match history | Minor | 1 | alaroque, slario, elanteno | Done |

### Module choices and justification

The modules were selected to cover the subject's required points while matching the
project's actual architecture and features. The table below gives the justification for
each choice and explains how it was implemented.

| Module | Why we chose it | How it was implemented |
|---|---|---|
| Framework frontend + backend | To build a structured full-stack application with the frameworks required or accepted by the subject. | React/Vite and Tailwind CSS power the frontend; NestJS and Prisma power the backend. |
| Real-time via WebSockets | Real-time synchronization is essential for a shared multiplayer round. | A JWT-authenticated Socket.IO gateway broadcasts room presence, bets, votes, chat messages and round transitions. |
| User interaction | To provide meaningful interaction beyond a static game interface. | Players use room chat, profiles, friends, presence indicators and live game controls. |
| Standard user management | To provide a complete user area rather than authentication alone. | The application supports profile editing, avatar uploads, display names, friends and online/in-game status. |
| Complete RAG system | The fact-checking topic requires answers grounded in reliable, traceable sources. | The AI service embeds documents, searches them with pgvector, generates grounded answers and returns citations. |
| LLM interface (streaming) | To demonstrate direct model interaction separately from the grounded RAG assistant. | Free-form questions are sent to Mistral and streamed back token by token through the backend and WebSocket layer. |
| Web-based game | A browser game is the project's central deliverable and demonstrates the required game mechanics. | Rooms, clips, betting, voting, server-side round progression, reveals and deterministic scoring are implemented in NestJS and React. |
| Multiplayer game (more than two players) | To prove that the game works fairly for several participants simultaneously, not only for two players. | Rooms support three or more players; the server synchronizes the round state and clock, validates each action and settles the pot atomically. |
| Backend as microservices | Separating game logic from AI responsibilities keeps services loosely coupled and independently maintainable. | NestJS handles authentication, game logic, WebSockets and persistence; FastAPI handles RAG, embeddings, LLM calls and moderation. They communicate through internal HTTP APIs. |
| ORM (Prisma) | To model relational game data safely and make migrations and transactions reproducible. | Prisma manages the PostgreSQL schema, migrations, typed queries and atomic settlement transactions. |
| OAuth 2.0 (42) | To offer an authentication method integrated with the 42 ecosystem in addition to local accounts. | Passport 42 handles the OAuth flow; the callback links or creates the user and issues the same JWT used by the application. |
| AI content moderation | The subject requires moderation based on a model rather than a static banned-word list. | Every chat message is sent to Mistral's moderation endpoint, then the backend applies the project's allow, warn or hide policy. |
| Game statistics & match history | Persistent statistics make the game meaningful beyond a single round and demonstrate relational queries. | The backend calculates wins, losses, rankings, accuracy, balances, experience and match history from bets, votes and transactions. |

### Detailed implementation notes

**Framework front + back.** React with Vite and Tailwind on the front, NestJS with Prisma
on the back, both explicitly accepted by the subject.

**Real-time via WebSockets.** A Socket.IO gateway authenticated by JWT, exposing nine
events (`room:join`, `bet:place`, `clip-vote:submit`, `chat:send`, `ai:chat`…) and
broadcasting round transitions. Presence is stored in the database rather than in memory,
so a reconnection restores the player into their room. Every state message carries the
server clock, which the client uses to correct its own drift; otherwise a player whose
machine runs ten seconds fast would vote in a shifted window.

**User interaction.** Room chat as the core deliverable, with profile and friends
alongside.

**Standard user management.** Profile editing, avatar upload, friends list and online
status, distinct from the basic authentication required by the subject.

**Complete RAG system.** Cosine search over pgvector, answers grounded in the retrieved
passages and citing their URL. The repository ships 1 653 passages with their pre-computed
vectors, so a freshly cloned installation answers with sources without running any ingestion.
The corpus mixes published fact-checks (AFP, Snopes, franceinfo, dpa…), including their
ClaimReview records and the full article text for the clips in play, with live official
indicators from INSEE, Eurostat and the World Bank.

When no retrieved passage covers the question, the assistant answers from its own knowledge
and says so, and the interface then shows no citation: the vector search always returns its
six nearest neighbours, relevant or not, and displaying unrelated sources under an answer
would suggest they support it.

**LLM interface.** Streaming generation from free user input, with retrieval switched off;
this is what makes it demonstrably distinct from the RAG surface, plus a server-side rate
limiter on top of the provider's own 429 handling.

**AI moderation.** Every chat message goes through Mistral's moderation endpoint; the
policy that turns categories into an action (allow, warn, delete) is ours and is the part
worth explaining.

**Web-based game.** The subject asks for four things and we can point at each. Players play
against each other: everyone in the room judges the same clip and only the most accurate
player takes the pot. Matches are live: the host moves the playlist forward, the server holds
the round state, and every client follows over WebSocket. The rules are explicit on screen,
and the win condition is deterministic, since it comes from the editorial answer key rather
than from a model. It is 2D, in the browser, with no plugin.

What makes it a Major rather than a UI is the server-side round machine: drawing a balanced
set of clips, a betting window, per-clip votes that are refused out of turn, an early lock
when everyone has voted, then a settlement that pays the pot in one atomic transaction.

**Multiplayer game (more than two players).** A room supports three or more players at the
same time. Everyone sees the same clip and the same round state, while each player submits
their own bet and votes independently. The server-authoritative state machine, server clock,
turn validation and atomic settlement provide fair gameplay and consistent results for all
participants. The module can be demonstrated directly on the website by opening a room with
multiple browser sessions and playing a complete round together.

**Backend as microservices.** The backend is split into two loosely coupled services with
clear responsibilities and HTTP interfaces. NestJS owns authentication, users, rooms,
game state, WebSockets, credits and persistence. FastAPI owns RAG retrieval, embeddings,
LLM streaming and AI moderation. NestJS is the authenticated gateway used by the frontend
and relays AI requests to FastAPI over internal HTTP; the frontend never calls the AI service
directly. Docker Compose runs the services independently, while nginx provides the single
HTTPS/WSS entry point.

**ORM (Prisma).** Prisma defines and generates the typed client for the PostgreSQL
schema. The backend uses Prisma migrations for reproducible database changes, typed
queries for users, rooms, rounds, bets, votes and credits, and interactive transactions
for the atomic end-of-round settlement.

**OAuth 2.0 (42).** Passport 42 handles the authorization flow and the callback validates
the provider response before linking or creating the local account. OAuth login is offered
in addition to, and never instead of, email/password authentication, and both methods issue
the same JWT used by the REST API and WebSocket gateway.

**Game statistics and match history.** The statistics service derives wins, losses,
accuracy, rankings, balances, experience and levels from persisted bets, votes and
transactions. The profile and statistics pages expose the player's finished rounds,
opponents, stakes, gains and progression, while the leaderboard aggregates results across
players.

## Individual Contributions

What follows can be checked against the git history. `git shortlog -sn origin/main` gives
the commit count per person; branch names and reverted pull requests prove the team work.
We stopped writing counts here because they went stale every week.

**`slario`, DevOps, PM.** Owns `docker-compose.yml`, nginx and its TLS
certificates, the container entrypoints and the GitHub Actions workflows. Built the complete
ELK logging stack over two weeks, including Logstash, index retention, automatic certificate
generation and SSL between every component, then removed it by pull request once we established
that `podman`, which the school machines run, refuses to even *create* a container declaring
the `gelf` log driver: the stack could not have started during an evaluation. Also fixed two
problems specific to the 42 machines, in three successive attempts: the `chown` in the images
fails on the school filesystem, and port 443 is privileged, so nginx publishes 8443. She also
implemented the **Advanced analytics dashboard with data visualization** module in a separate
branch. Because of time constraints, that branch was not merged into the final project and the
dashboard is not part of the delivered application.

**`alaroque`, Back-end core.** Wrote essentially the whole NestJS application:
database schema and migrations, email/password authentication, 42 OAuth, the
server-authoritative game loop and the JWT-authenticated Socket.IO gateway, rooms and
presence, the betting module with server-side stake and balance validation, the atomic
settlement, the credit ledger, statistics and leaderboard, and the relay that keeps every AI
call behind NestJS so authentication and rate limiting stay in one place. Two commits are
explicit security-hardening passes after review. Also the person who merged most pull
requests into `main`. She also handled a substantial part of the project's debugging,
including investigating integration issues, fixing runtime errors and resolving problems
found during testing and code review.

**`elanteno`, Tech Lead / Architect, AI.** Built the FastAPI service: pgvector
schema and HNSW index, embeddings, retrieval, SSE streaming for the RAG and free-form LLM
surfaces, the moderation policy on top of Mistral, and the rate limiter. Assembled and
curated the game's content from the Google Fact Check Tools API, INSEE, Eurostat, the World
Bank and Wikipedia. Three problems shaped that work: Chrome dropped Theora in v123, silently
breaking every Wikimedia `.ogv` clip; Facebook embeds render `/videos/` but not `/posts/`;
and the corpus lived only in a local database, so a fresh clone had nothing to play; it is
now exported to the repository with its pre-computed vectors. On the front, wired the pages
to the real API and added the friends screen, the match history, the OAuth callback and the
responsive pass.

**`krfranco`, Front-end UI, Product Owner.** Owns the visual identity: the
Tailwind theme and colour tokens, the shared layout, and the home, login, profile and lobby
pages. Defined the component vocabulary, including the button, card and panel classes, that every
screen added later reuses, which is why the friends page, the match history and the OAuth
callback needed no new styles. The visual pass was delivered before the API existed, with the
buttons left to be wired with the back-end.

**`oztozdem`, Front-end real-time and UX.** Built the room screen and its components from
the design mock-up: the chat panel with its per-author colouring and moderation badge, the
statistics bar, the results reveal and the video player. Also wrote `mocks/gameData.ts`, the
shared data shapes, which let the room UI be built and reviewed before the WebSocket contract
was settled.

That choice came at a price worth explaining. His branch `feat/frontend-tr` lived for weeks
and had to absorb `main` over and over, so `git shortlog` credits him with a single commit:
the merge squashed the rest. Two of his components, the betting panel and the clip progress
bar, were dropped when the round became server-driven and are no longer rendered. The lesson
we took from it is that a front-end branch should merge on the day the contract it depends on
is settled, not weeks later.

## Resources

- Project subject: the PDF handed out by the school
- React:
  - https://fr.react.dev/learn
  - https://openclassrooms.com/fr/courses/7008001-debutez-avec-react
  - https://www.youtube.com/watch?v=hhe6Xb4Em5U&list=PLjwdMgw5TTLUEOKPg5Z5TgwAOeWkjGL69
- Tailwind CSS:
  - https://tailwindcss.com/docs/installation/using-vite
- NestJS:
  - https://docs.nestjs.com/
  - https://openclassrooms.com/fr/courses/8972111-construisez-un-backend-avec-node-js-et-nestjs
  - https://www.youtube.com/watch?v=BHBn1RYBbNg&list=PLFlURPbtyOqgn2iC-iREQUXg25gX_XCOY
- Prisma:
  - https://www.prisma.io/docs
- PostgreSQL:
  - https://www.postgresql.org/docs/
- pgvector:
  - https://www.databricks.com/fr/blog/what-is-pgvector
- Socket.IO:
  - https://socket.io/docs/v4/
  - https://www.youtube.com/watch?v=vQjiN8Qgs3c&list=PL4cUxeGkcC9i4V-_ZVwLmOusj8YAUhj_9
- FastAPI:
  - https://fastapi.tiangolo.com/tutorial/
- OAuth 2.0:
  - https://developer.auth0.com/resources/guides
- TypeScript:
  - https://openclassrooms.com/fr/courses/8039116-decouvrez-typescript
  - https://www.typescriptlang.org/fr/docs/handbook/typescript-from-scratch.html
  - https://www.youtube.com/watch?v=ffCIANfx_-0&list=PLjwdMgw5TTLX1tQ1qDNHTsy_lrkCt4VW3
- Python:
  - https://www.youtube.com/watch?v=psaDHhZ0cPs&list=PLMS9Cy4Enq5JmIZtKE5OHJCI3jZfpASbR

External services and data sources actually used:

- Mistral AI: embeddings (`mistral-embed`), streaming chat, moderation endpoint
- Google Fact Check Tools API: structured ClaimReview data feeding both the RAG corpus and
  the game's answer key
- INSEE (Banque de données macroéconomiques, SDMX): French national indicators
- Eurostat REST API: French and EU-wide indicators, used for comparative claims
- World Bank (World Development Indicators): international comparisons
- French Wikipedia: general-knowledge corpus

**AI usage.** We used AI (Claude Code) to help simplify and explain concepts that, even after reading documentation and consulting peers, still seemed unclear or overly complex at first glance (for example, how Websocket works). No critical logic or core implementation was copied from AI-generated outputs.
