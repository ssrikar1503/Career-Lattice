-- Phase 3.1 migration — adds the country column the new extractor writes to.
--
-- HOW TO RUN (one-time):
--   1. Open Supabase project → SQL Editor → New query
--   2. Paste this file
--   3. Click "Run"
--   4. Re-deploy the pipeline (or wait for next cron — it'll pick up the new column)
--
-- Country values written by the pipeline:
--   'US'  → job is located in the United States (incl. Remote-US, all 50 states + DC)
--   'XX'  → ambiguous (e.g. "Multiple Locations", "Remote — Anywhere", or AI couldn't tell)
--   other 2-letter ISO codes — 'GB', 'DE', 'IN', 'IL', etc.
--
-- Safe to run multiple times: IF NOT EXISTS guards both statements.

ALTER TABLE extracted_jobs
  ADD COLUMN IF NOT EXISTS country TEXT;

CREATE INDEX IF NOT EXISTS extracted_jobs_country_idx
  ON extracted_jobs (country);
