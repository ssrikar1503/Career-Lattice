# Career Pathways Platform

A multi-industry career-lattice website with an AI guide (**dolphIQ**) and a live job-ingestion pipeline that keeps role data current.

**Live industries:** Additive Manufacturing · Semiconductors · Space Industry
**Stack:** Next.js 16 · TypeScript · Tailwind v4 · Python 3.11 · Supabase Postgres
**Hosting:** Vercel (web) + GitHub Actions cron (pipeline) + Supabase (database)

---

## What this platform is

Two systems that work together but ship independently:

**System A — The public website.** Anyone (student, career changer, workforce advisor) picks an industry, sees every role laid out as an interactive map (clusters × seniority), clicks a role to see who it leads to, builds a multi-role *career path* they can share via URL, and chats with **dolphIQ** — an AI guide named for one of the most intelligent species on Earth — for natural-language help.

**System B — The data ingestion pipeline.** A weekly GitHub Actions cron scrapes Greenhouse and Lever public job boards, uses AI to extract structured fields from each posting, matches each job against the canonical role taxonomy, and surfaces high-confidence matches as "live openings" on the map. Ambiguous matches go to a `/admin` queue for human review.

The two systems communicate only through Supabase — neither requires the other to be up.

---

## Repository structure

```
career_path/
├── apps/
│   ├── web/                    # Next.js website (deploys to Vercel)
│   │   ├── src/
│   │   │   ├── app/            # App Router pages + API routes
│   │   │   ├── components/     # CareerMap, AgentChat, DolphIQIcon, ...
│   │   │   ├── data/           # Taxonomy JSON files (one per industry)
│   │   │   └── lib/            # AI providers, rate limiting, layout engine
│   │   └── package.json
│   └── pipeline/               # Python ingestion pipeline (runs on GHA cron)
│       ├── main.py             # Orchestrator
│       ├── scrapers/           # Greenhouse + Lever scrapers
│       ├── extractor.py        # AI extracts structured fields from raw jobs
│       ├── matcher.py          # Skill+title scoring + AI judgment
│       ├── seed_taxonomy.py    # One-off: load JSON taxonomies into Supabase
│       └── requirements.txt
├── .github/workflows/
│   ├── ingest.yml              # Weekly ingestion pipeline cron (Mondays 10:00 UTC)
│   └── seed.yml                # Manual taxonomy seeder
└── README.md                   # You are here
```

> **Note**: Comprehensive user-experience and developer-onboarding documentation
> (User Manual + Coder Manual + schema reference + stakeholder report) is
> delivered to clients as a separate bundle rather than via this repository.
> Contact the project owner for access.

---

## Quick start (local development)

### Web app

```bash
cd apps/web
npm install
cp .env.example .env.local       # fill in the keys below
npm run dev                       # http://localhost:3000
```

**Required env vars** (`apps/web/.env.local`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for admin operations |
| `ANTHROPIC_API_KEY` | Optional — Claude is tried first if set |
| `GEMINI_API_KEY` | Optional — fallback (or primary if no Claude key) |
| `OPENAI_API_KEY` | Optional — second fallback |
| `ADMIN_PASSWORD` | Password for the `/admin` review queue |

You need at least **one** AI key for dolphIQ to work.

Useful commands:
```bash
npm run build       # MUST pass before committing — full TypeScript + routing check
npm run lint        # ESLint via eslint-config-next
npm start           # Serve a production build locally
```

### Pipeline

```bash
cd apps/pipeline
pip install -r requirements.txt
cp .env.example .env             # fill in SUPABASE_* and at least one AI key

# One-time: load taxonomy from JSON into Supabase
python seed_taxonomy.py

# Run the full pipeline locally
python main.py
python main.py --skip-scrape                       # re-run extract+match only
python main.py --industries semiconductors         # limit to one industry
```

Or trigger the same workflows from GitHub Actions:
- **Seed taxonomy data** (manual)
- **Weekly ingestion pipeline** (cron + manual)

---

## Architecture

### Two sources of taxonomy truth (by design)

Role taxonomies live in **two places** so neither system can break the other:

1. **`apps/web/src/data/*.json`** — the website reads these directly at build/request time. Fast, no DB roundtrip, no cold starts.
2. **Supabase `canonical_roles` table** — seeded from the same JSONs via `seed_taxonomy.py`. The pipeline matches scraped jobs against these rows.

When the pipeline finds a high-confidence match, it writes back `canonical_roles.open_jobs_count` so the website can show "X open openings" amber badges.

**To update a taxonomy**: edit the JSON, re-run the seeder, push to main, Vercel redeploys, next pipeline run uses the new rows.

### Multi-provider AI (`apps/web/src/lib/ai-providers.ts`)

The chat endpoint never calls one specific provider — it goes through `streamWithFallback({ system, messages })` which iterates Claude → Gemini → OpenAI. Each has its own circuit breaker (3 consecutive failures → OPEN for 10 minutes → one trial in HALF-OPEN). Rate-limit and transient errors trigger the next provider; non-retriable errors bubble up.

The fallback chain primes each provider's stream by pulling the first chunk before committing — this catches errors that surface only on the first API call (rate-limit responses from streaming endpoints).

### Career-map layout (`apps/web/src/lib/map-layout.ts`)

The `<CareerMap>` component is purely a renderer. Coordinates come from `computeLayout(roles)` which groups roles by `(grid_col, grid_row)`, stacks roles in the same cell vertically, and returns pixel positions plus canvas dimensions. To add an industry you specify `grid_col` (cluster index) and `grid_row` (seniority tier) per role; layout handles overflow automatically.

### Path Builder

Clicking roles on the map appends them to an ordered `selectedIds[]`. The URL stays in sync (`?path=am-r-01,am-r-05`). "Save & Share" copies the current URL; pasting it anywhere restores the same path.

### Ingestion pipeline state machine

Each scraped job moves through these tables in order:

```
raw_jobs ─[extractor.py]→ extracted_jobs ─[matcher.py]→ role_matches
                                                       │
                                  confidence ≥ 0.80 ──┼─ status='approved' + increment_job_count
                                  0.35 ≤ c < 0.80 ────┼─ status='pending' (admin queue)
                                  c < 0.35 ───────────┴─ status='rejected'
```

The admin `/admin` UI changes `status` between buckets and writes audit rows to `review_decisions`. Approving a pending match calls the `increment_job_count` SQL function so the website's "live openings" count updates immediately.

---

## Deploy

### Web (Vercel)
1. Connect this repo to a Vercel project pointed at `apps/web/`
2. Add all env vars listed above in **Settings → Environment Variables** (apply to **Production** and **Preview**)
3. Vercel auto-deploys on push to `main`

### Pipeline (GitHub Actions)
1. Add repo secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, at least one AI key
2. The weekly cron runs every Monday at 10:00 UTC; you can also trigger manually any time

### Database (Supabase)
1. Create a project, run `schema.sql` in the SQL Editor
2. Run the **"Seed taxonomy data"** GitHub Action once to populate `industries` + `canonical_roles`

---

## Adding a new industry

1. Create `apps/web/src/data/your-industry.json` matching the existing JSON shape (`industry`, `clusters[]`, `seniority_levels[]`, `roles[]`, `pathways[]`)
2. Each role needs `grid_col` (0-indexed cluster column) and `grid_row` (0 = entry, 3 = lead)
3. Import the JSON in `apps/web/src/app/[industry]/page.tsx` and `apps/web/src/app/api/agent/chat/route.ts` (and the OG image route)
4. Add a card to the homepage `INDUSTRIES` array
5. Re-run the seeder to push to Supabase

---

