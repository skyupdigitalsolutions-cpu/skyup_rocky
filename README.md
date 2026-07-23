# Rocky — Skyup Internal AI Agency Operating Assistant

Rocky is Skyup's internal assistant: one conversational interface to understand clients, paid-media and SEO performance, documents, and daily priorities. **V1 reads, analyzes, summarizes, and recommends** — it never takes high-impact external actions (no budget changes, no pausing, no publishing).

Built from the V1 Product Requirements Document. It runs **end-to-end offline with zero API keys** (mock LLM + mock embeddings + seed data), then goes live as you drop real credentials into `.env`.

---

## Stack (adapted to Skyup's infrastructure)

The PRD *suggested* Next.js + Python/FastAPI + Postgres/pgvector. This build instead uses **Skyup's real stack** so your team can own it:

| Layer | Choice |
|---|---|
| Backend | **Node.js 20 + Express** (ESM) |
| Database | **MongoDB Atlas** |
| RAG vectors | **Atlas Vector Search** (with an in-memory cosine fallback for local dev) |
| Frontend | **React 18 + Vite** |
| LLM | Provider abstraction — `mock` \| `anthropic` \| `openai` (swap without code changes) |
| Voice | **Web Speech API** (free, no key) — isolated behind a hook, swappable for Whisper/Piper later |
| Deploy | Docker Compose (API + nginx-served web) for EC2 |

Every PRD requirement is preserved; only the substrate changed. If you want the literal FastAPI/Postgres version, the connectors, orchestrator, and data model are all modular enough to port.

---

## Quick start (local, no API keys)

**Prereqs:** Node 20+, and a MongoDB connection string (Atlas or local `mongod`).

```bash
# 1. Backend
cd server
cp .env.example .env
#   In .env, at minimum set MONGODB_URI, JWT_SECRET, and TOKEN_ENCRYPTION_KEY.
#   Generate the two secrets:
#     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
#     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # TOKEN_ENCRYPTION_KEY
#   Leave LLM_PROVIDER=mock and EMBEDDINGS_PROVIDER=mock for now.
npm install
npm run seed        # loads demo users, clients, connected integrations, metrics, one document
npm run dev         # API on http://localhost:8791

# 2. Frontend (new terminal)
cd client
cp .env.example .env
npm install
npm run dev         # web on http://localhost:5173
```

Open **http://localhost:5173** and sign in with the seeded admin:

```
admin@skyup.test   /   RockyDemo#2026        (full access)
member@skyup.test  /   RockyDemo#2026        (scoped to "Acme Interiors" only — demonstrates isolation)
```

Try: *"How did Acme's Meta campaigns perform last 7 days vs prior 7?"*, *"Which paid campaigns need attention?"*, or generate the **Morning brief** on the Command Center. In mock mode Rocky produces deterministic, **grounded** answers from the seeded snapshots and says what's missing rather than inventing numbers.

---

## Run with Docker (EC2)

```bash
cp server/.env.example server/.env    # fill in values (MONGODB_URI etc.)
docker compose up --build -d
docker compose exec api npm run seed  # optional demo data
# web: http://localhost:8080   (nginx serves the SPA and proxies /api to the api container)
```

---

## Going live (real integrations)

Everything below is optional and independent — wire up one at a time.

**LLM** — set in `server/.env`:
```
LLM_PROVIDER=openai          # or anthropic
OPENAI_API_KEY=sk-...        # gpt-4o-mini by default (cheap)
EMBEDDINGS_PROVIDER=openai   # enables real semantic RAG
```

**Atlas Vector Search** (required for real embeddings) — create a Vector Search index named `rocky_chunk_index` on the `documentchunks` collection:
```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1536, "similarity": "cosine" },
    { "type": "filter", "path": "client" }
  ]
}
```
Without this index the app still works via an in-memory cosine fallback (fine for small local datasets).

**Connectors** (all read-only) — add credentials in `server/.env`, then register each OAuth redirect URL with the provider:

| Connector | Env vars | Redirect URL to register |
|---|---|---|
| Meta Ads | `META_APP_ID`, `META_APP_SECRET` | `${SERVER_PUBLIC_URL}/api/integrations/meta/callback` |
| Google Ads | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID/SECRET` | `${SERVER_PUBLIC_URL}/api/integrations/google-ads/callback` |
| Search Console + GA4 | `GOOGLE_OAUTH_CLIENT_ID/SECRET` | `${SERVER_PUBLIC_URL}/api/integrations/google/callback` |

Once configured, connect from **Integrations → (pick client)**. Set the client's account references (Meta ad-account id, Google Ads customer id, GSC site URL, GA4 property id) on the client, then **Sync now**.

> The OAuth flows, token encryption, sync scheduling, snapshot storage, period comparison, and grounding are all built. The provider-specific **metric-query mapping** (Meta insights fields → snapshot; Google Ads GAQL; GSC `searchAnalytics`; GA4 `runReport`) is marked with `TODO(real)` in each `server/src/connectors/*.js` — that's where you plug in the exact field/report calls. Until then a connected source reports `no_data_yet` and Rocky states the data is unavailable (never fabricates).

---

## Capability status vs the PRD

| PRD capability | Status |
|---|---|
| Auth, RBAC, client-level isolation | ✅ Live (JWT, roles, per-client scoping, defense-in-depth) |
| Client Brain (profiles, docs, RAG) | ✅ Live — pasted/`.txt`/`.md`/`.csv` ingest immediately; **PDF/DOCX text extraction is a TODO hook** (`pdf-parse`/`mammoth`) |
| Rocky Chat (text) + grounding | ✅ Live — client/date context, source + period chips, "what's missing" |
| Rocky Voice | ✅ Live via free Web Speech API (STT + read-aloud), swappable |
| Meta / Google Ads intelligence | ⚙️ OAuth + read-only sync framework live; **metric-query mapping = TODO** per connector |
| SEO intelligence (GSC + GA4) | ⚙️ OAuth live; **query/report mapping = TODO** |
| Morning Agency Brief | ✅ Live — deterministic severity heuristic + LLM summary, cron-scheduled, no fabrication |
| Audit logging | ✅ Live (append-only, admin-viewable) |
| Encrypted token vault | ✅ Live (AES-256-GCM, server-only, never sent to frontend) |
| Background jobs | ✅ Live (node-cron; documented BullMQ swap path) |
| External write actions | ✅ Correctly absent (read-only by design) |

---

## Security notes (PRD §10)

- Auth required on every API route; RBAC + client-scope checked in application logic (never delegated to the LLM).
- OAuth tokens/secrets stored **encrypted at rest** (AES-256-GCM), `select:false`, decrypted only server-side at sync time.
- Secrets come from env only; `.env` is git-ignored. All keys ship as placeholders.
- HTTPS + secure cookies in production (`COOKIE_SECURE=true`); helmet, CORS locked to `CLIENT_ORIGIN`, login rate-limited.
- Disconnect/revoke clears stored credentials.
- Only minimal, grounded context is sent to the LLM — no credentials, no cross-client data.

---

## Project structure

```
rocky/
├── server/                 Express API
│   └── src/
│       ├── config/         env (zod-validated), db, rbac catalogue
│       ├── models/         all PRD §8 entities (Mongoose)
│       ├── middleware/     auth, rbac (client-scope), audit, error
│       ├── lib/            crypto (AES-256-GCM), jwt, storage, logger
│       ├── llm/            provider abstraction (mock/anthropic/openai) + embeddings
│       ├── rag/            chunker, ingest, client-scoped retrieval
│       ├── connectors/     meta, googleAds, searchConsole, ga4 (+ registry, runner)
│       ├── orchestrator/   grounding prompts, context tools, answer pipeline
│       ├── jobs/           morningBrief, syncMetrics, cron scheduler
│       ├── routes/         auth, users, clients, documents, integrations, chat, briefs, insights
│       └── seed/           clearly-marked dev fixtures
└── client/                 React + Vite
    └── src/
        ├── pages/          Login, CommandCenter, RockyChat, Clients, ClientDetail, Integrations, Settings
        ├── components/     Layout, Sidebar, ProtectedRoute, shared UI
        ├── hooks/          useVoice (Web Speech API)
        └── store/          auth context
```

---

## Roadmap (post-V1)

Phase 5 hardening ideas already scaffolded: swap node-cron for BullMQ/Redis; add `pdf-parse`/`mammoth` extractors; implement each connector's live metric query; add refresh-token rotation; move object storage to S3 (driver stub present); add per-client rate limiting and response caching.
