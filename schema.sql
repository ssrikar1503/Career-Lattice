-- ============================================================================
-- Career Pathways Platform — Supabase schema
-- Reconstructed from the codebase (seed_taxonomy.py, extractor.py, matcher.py,
-- scrapers/*, web API routes) — the original schema.sql was delivered in the
-- client handoff bundle and is not in the repository.
--
-- Includes the columns added by migrations 001 (extracted_jobs.country) and
-- 002 (raw_jobs.industry, extracted_jobs.industry), so DO NOT run those
-- migration files after this — they are already incorporated.
--
-- HOW TO RUN (one-time):
--   1. Open your Supabase project → SQL Editor → New query
--   2. Paste this entire file
--   3. Click "Run" — wait for "Success"
--   4. Trigger the "Seed taxonomy data" GitHub Action
--
-- Idempotent: IF NOT EXISTS guards throughout; safe to re-run.
-- ============================================================================

-- ── Taxonomy tables (written by seed_taxonomy.py) ───────────────────────────

CREATE TABLE IF NOT EXISTS industries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  color       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canonical_roles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_id      UUID NOT NULL REFERENCES industries(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  cluster          TEXT,
  seniority        TEXT CHECK (seniority IN ('entry', 'mid', 'senior', 'lead')),
  salary_min       INTEGER,
  salary_max       INTEGER,
  degree_required  TEXT CHECK (degree_required IN ('hs', '2yr', '4yr', 'graduate')),
  skills           TEXT[] NOT NULL DEFAULT '{}',
  certifications   TEXT[] NOT NULL DEFAULT '{}',
  description      TEXT,
  -- US-only cached counters maintained by the matcher + admin decide route
  open_jobs_count  INTEGER NOT NULL DEFAULT 0,
  hiring_companies TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canonical_roles_industry_idx ON canonical_roles (industry_id);
CREATE INDEX IF NOT EXISTS canonical_roles_title_idx    ON canonical_roles (title);

CREATE TABLE IF NOT EXISTS pathways (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_id UUID NOT NULL REFERENCES industries(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  role_ids    UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pathways_industry_idx ON pathways (industry_id);

-- ── Pipeline tables (raw_jobs → extracted_jobs → role_matches) ──────────────

CREATE TABLE IF NOT EXISTS raw_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL,             -- greenhouse | lever | workday
  company         TEXT NOT NULL,
  raw_title       TEXT NOT NULL,
  raw_description TEXT,
  url             TEXT NOT NULL UNIQUE,      -- scrapers upsert on_conflict=url
  industry        TEXT,                      -- migration 002
  scraped_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_jobs_industry_idx ON raw_jobs (industry);
CREATE INDEX IF NOT EXISTS raw_jobs_company_idx  ON raw_jobs (company);

CREATE TABLE IF NOT EXISTS extracted_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_job_id       UUID NOT NULL UNIQUE REFERENCES raw_jobs(id) ON DELETE CASCADE,
  normalized_title TEXT,
  skills           TEXT[] NOT NULL DEFAULT '{}',
  seniority        TEXT CHECK (seniority IN ('entry', 'mid', 'senior', 'lead')),
  location         TEXT,
  country          TEXT,                     -- migration 001: 'US', 'XX', or ISO-2
  industry         TEXT,                     -- migration 002
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extracted_jobs_industry_idx ON extracted_jobs (industry);
CREATE INDEX IF NOT EXISTS extracted_jobs_country_idx  ON extracted_jobs (country);

CREATE TABLE IF NOT EXISTS role_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extracted_job_id  UUID NOT NULL REFERENCES extracted_jobs(id) ON DELETE CASCADE,
  canonical_role_id UUID NOT NULL REFERENCES canonical_roles(id) ON DELETE CASCADE,
  confidence        NUMERIC(3, 2) NOT NULL DEFAULT 0,
  status            TEXT NOT NULL CHECK (status IN ('approved', 'pending', 'rejected')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS role_matches_status_idx    ON role_matches (status);
CREATE INDEX IF NOT EXISTS role_matches_extracted_idx ON role_matches (extracted_job_id);
CREATE INDEX IF NOT EXISTS role_matches_role_idx      ON role_matches (canonical_role_id);

-- Audit log written by the /admin review queue (POST /api/admin/decide)
CREATE TABLE IF NOT EXISTS review_decisions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   UUID NOT NULL REFERENCES role_matches(id) ON DELETE CASCADE,
  decided_by TEXT NOT NULL,
  decision   TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_decisions_match_idx ON review_decisions (match_id);

-- ── Functions ────────────────────────────────────────────────────────────────

-- Called by the matcher and admin decide route on approval of a US job.
CREATE OR REPLACE FUNCTION increment_job_count(role_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE canonical_roles
     SET open_jobs_count = open_jobs_count + 1
   WHERE id = role_id;
$$;

-- ── Row-level security ───────────────────────────────────────────────────────
-- All application access goes through the service-role key (server-side),
-- which bypasses RLS. Enabling RLS with no policies denies everything to the
-- anon/public key — the safest posture for a public project.

ALTER TABLE industries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_roles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pathways         ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_jobs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_matches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_decisions ENABLE ROW LEVEL SECURITY;
