-- ============================================================================
-- Career Lattice — Cloud SQL for PostgreSQL schema
--
-- GCP-native variant of schema.sql. Identical tables, indexes and the
-- increment_job_count() function, with ONE deliberate difference:
--   * NO row-level security. Supabase used RLS deny-all because every client
--     shared one Postgres role and the service key bypassed RLS. On Cloud SQL
--     the app connects as its own dedicated role, so enabling RLS with no
--     policies would lock the app out. Access is instead controlled by the
--     database GRANTs on the application user.
--
-- No pgvector / vector columns are used by this schema.
--
-- HOW TO RUN (one-time), e.g. from Cloud Shell against the Cloud SQL instance:
--   psql "$DATABASE_URL" -f schema.cloudsql.sql
-- Then run the seed + ingest pipeline to populate it (or restore a pg_dump
-- from the old Supabase database).
--
-- Idempotent: IF NOT EXISTS guards throughout; safe to re-run.
-- ============================================================================

-- gen_random_uuid() is built in on PostgreSQL 13+ (Cloud SQL default). If you
-- run an older engine, uncomment:
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  source          TEXT NOT NULL,
  company         TEXT NOT NULL,
  raw_title       TEXT NOT NULL,
  raw_description TEXT,
  url             TEXT NOT NULL UNIQUE,      -- scrapers upsert on_conflict=url
  industry        TEXT,
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
  country          TEXT,
  industry         TEXT,
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

-- ── Application role grants ──────────────────────────────────────────────────
-- Create a dedicated least-privilege role for the app + pipeline, e.g.:
--   CREATE ROLE careerlattice_app LOGIN PASSWORD '...';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO careerlattice_app;
--   GRANT USAGE ON SCHEMA public TO careerlattice_app;
--   GRANT EXECUTE ON FUNCTION increment_job_count(UUID) TO careerlattice_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO careerlattice_app;
