*This project has been created as part of the 42 curriculum by <login1>, <login2>, <login3>, <login4>, <login5>.*

# FactArena — Live Fake-News Fact-Checking Arena

> TODO before first evaluation: replace every `<login>` and every TODO block.
> The subject requires this README to be complete, honest and written in English.

## Team — start here

The infrastructure is done and it works. `docker compose up --build` brings up the five
services (nginx, frontend, backend, AI service, PostgreSQL+pgvector) and serves the app over
HTTPS at **https://localhost** — nothing to install, nothing to configure by hand. Clone the
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
The application is served by nginx at **https://localhost**. The development certificate is
self-signed, so Chrome shows a warning once: click *Advanced → Proceed*. This is expected.

The first build takes a few minutes (it installs every dependency and builds the SPA).
Once every service reports `healthy`, the stack is ready:

| Check | Expected |
|---|---|
| `https://localhost/` | the SPA loads |
| `https://localhost/api/health` | `{"status":"ok"}` |
| `docker compose ps` | 5 services, all `healthy` |

### Run (development — hot reload, for daily work)
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```
Same URL, same nginx, same TLS — but your local code is mounted into the containers: save a
file and the browser reloads on its own (React), or the API restarts on its own (NestJS).
See `docker-compose.dev.yml` for the details.

> Only nginx publishes a port (443). Every other service talks over the private Docker
> network, which is why `docker compose ps` shows no host ports for them — that is intended,
> not a bug.

### Useful commands
```bash
docker compose ps               # health of every service
docker compose logs -f backend  # follow one service's logs
docker compose down             # stop everything (keeps the database)
docker compose down -v          # stop AND wipe the database volume
```

TODO: keep this section updated (seed data, test accounts).

## Team Information

| Login | Role(s) | Responsibilities |
|---|---|---|
| `<login1>` | DevOps — **PM / Scrum Master** | Docker, nginx/HTTPS, CI, meetings, deadlines |
| `<login2>` | **Back-end Core** | NestJS, auth, WebSockets, round state machine, credits, PostgreSQL |
| `<login3>` | **Tech Lead / Architect** — AI (Python) | FastAPI, RAG corpus, LLM streaming, moderation |
| `<login4>` | Front-end UI & Access — **Product Owner** | Product vision, backlog, React UI, WCAG, legal pages |
| `<login5>` | Front-end Real-time & UX | Room/betting UI, chat integration, live vote tally |

All members are **Developers**: they write code, review each other's PRs, test and document
their scope.

## Project Management

- **Task tracking**: GitHub Issues + Projects board (TODO: link)
- **Communication**: Discord server, weekly sync meeting (TODO: day/time)
- **Workflow**: feature branches `feat/<scope>-<desc>`, PR review by at least one other
  member before merge into `main`

## Technical Stack

| Layer | Technology | Why |
|---|---|---|
| Reverse proxy | nginx | Single HTTPS/WSS entry point required by the subject |
| Frontend | React (Vite) + Tailwind CSS | Imposed framework + valid CSS solution; fast SPA |
| Backend core | NestJS + Prisma | Structured framework for auth, WebSockets, game loop |
| AI microservice | FastAPI (Python) | Independent service, mature Python AI ecosystem |
| Database | PostgreSQL + pgvector | Relational data + vector search for RAG |
| Containers | Docker Compose | One-command deployment (subject requirement) |

TODO: full justification of major technical choices.

## Database Schema

TODO: diagram. Core tables: User, Friendship, Room/Match, Round, Claim (with editorial
`truthLabel` answer key), RoundClaim, Bet + ClipVote (per-clip good/fake), Transaction (credit ledger), ClaimVerdict
(AI explanation, display-only), Stat/Leaderboard, and the FastAPI-managed Document table
(pgvector embeddings). See `docs/ARCHITECTURE.md` for relations.

## Features List

TODO: complete list — feature, description, author(s).

## Modules

Target: **18 points** (14 required). Game-independent floor: **15 points** (safe even if
the game module and its dependent stats module are both rejected). See `docs/ARCHITECTURE.md`
for the audited rationale and per-module subject references.

| Module | Type | Pts | Member(s) | Status |
|---|---|---|---|---|
| Framework frontend + backend | Major | 2 | | Not started |
| Real-time via WebSockets | Major | 2 | | Not started |
| User interaction (chat, profile, friends) | Major | 2 | | Not started |
| Standard user management | Major | 2 | | Not started |
| Complete RAG system | Major | 2 | | Not started |
| LLM interface (streaming) | Major | 2 | | Not started |
| Web-based game (live fact-check arena) | Major | 2 | | Not started — **needs staff validation** |
| ORM (Prisma) | Minor | 1 | | Not started |
| OAuth 2.0 (42) | Minor | 1 | | Not started |
| AI content moderation | Minor | 1 | | Not started |
| Game statistics & match history | Minor | 1 | | Not started (depends on the game module) |

TODO: justification of each choice + how it was implemented + author(s).

## Individual Contributions

TODO: per member — what was built, challenges faced, how they were solved.

## Resources

- Project subject: `docs/subject.pdf` (source of truth)
- Architecture & module rationale: `docs/ARCHITECTURE.md`
- TODO: docs, articles and tutorials actually used
- **AI usage**: AI assistants (Claude Code) were used for scaffolding, boilerplate and
  documentation drafts. Every AI-assisted change was reviewed, understood and tested by the
  member who committed it, in line with the subject's AI instructions. TODO: detail per
  task/part.
