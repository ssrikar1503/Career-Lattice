-- Phase 3.6 migration — adds industry tagging so the matcher routes jobs
-- to the correct industry's taxonomy instead of the "first industry wins"
-- behavior that was rejecting ~88% of jobs in Phase 3.
--
-- HOW TO RUN (one-time):
--   1. Open Supabase project → SQL Editor → New query
--   2. Paste this entire file
--   3. Click "Run" — wait for "Success"
--   4. Wait for the next cron, or manually re-trigger the pipeline
--
-- Safe to run multiple times — IF NOT EXISTS / idempotent UPDATEs throughout.

-- ── Add the columns ──────────────────────────────────────────────────────────
ALTER TABLE raw_jobs       ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE extracted_jobs ADD COLUMN IF NOT EXISTS industry TEXT;

CREATE INDEX IF NOT EXISTS raw_jobs_industry_idx       ON raw_jobs       (industry);
CREATE INDEX IF NOT EXISTS extracted_jobs_industry_idx ON extracted_jobs (industry);

-- ── Backfill existing raw_jobs from their company name ───────────────────────
-- Companies are mapped per the canonical list in apps/pipeline/companies.json.
-- Update queries are idempotent — they only touch rows where industry is NULL
-- or mismatched, so re-running is safe.

UPDATE raw_jobs SET industry = 'additive-manufacturing'
 WHERE company IN ('carbon','markforged','xometry','fictiv','seurat','protolabs','hp')
   AND (industry IS NULL OR industry <> 'additive-manufacturing');

UPDATE raw_jobs SET industry = 'semiconductors'
 WHERE company IN ('tenstorrent','intel','nvidia','micron','appliedmaterials')
   AND (industry IS NULL OR industry <> 'semiconductors');

UPDATE raw_jobs SET industry = 'space'
 WHERE company IN ('planetlabs','astranis','rocketlab','andurilindustries',
                   'dawnaerospace','momentus','blueorigin','boeing','leidos')
   AND (industry IS NULL OR industry <> 'space');

-- ── Backfill extracted_jobs from their parent raw_job ────────────────────────
UPDATE extracted_jobs ej
   SET industry = (SELECT industry FROM raw_jobs WHERE id = ej.raw_job_id)
 WHERE ej.industry IS NULL;
