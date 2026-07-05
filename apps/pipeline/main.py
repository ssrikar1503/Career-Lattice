"""
Career Pathways Platform — Ingestion Pipeline
============================================
Orchestrates all 5 steps of the weekly data pipeline:

  Step 1: Scrapers   → raw_jobs table
  Step 2: Extractor  → extracted_jobs table
  Step 3: Matcher    → role_matches table
  Step 4: Routing    → auto-approve / pending / reject by confidence
  Step 5: Aggregation→ canonical_roles job counts updated (done inside matcher)

AI provider strategy:
  Supabase is required. AI providers are optional individually but at least
  ONE of (ANTHROPIC_API_KEY, GEMINI_API_KEY) must be set. Extractor and matcher
  use Claude first when available, fall back to Gemini automatically.

Run manually:   python main.py
Run in CI:      triggered by .github/workflows/ingest.yml (weekly cron)
"""

import os
import sys
import logging
import argparse
from datetime import datetime, timezone
from typing import Optional
from dotenv import load_dotenv
from anthropic import Anthropic
from supabase import create_client, Client

from scrapers.greenhouse import run_greenhouse
from scrapers.lever      import run_lever
from scrapers.workday    import run_workday
from extractor           import run_extractor
from matcher             import run_matcher

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
# Phase 4 — silence per-request HTTP logging from httpx / httpcore so the
# pipeline log stays readable. Every Supabase write used to emit an INFO line,
# burying the actual pipeline progress messages.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger("pipeline")

INDUSTRIES = ["additive-manufacturing", "semiconductors", "space"]


def get_clients() -> tuple[Client, Optional[Anthropic]]:
    """
    Returns (supabase_client, anthropic_client_or_None).

    Required:    SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
    Required:    at least one of ANTHROPIC_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY
    Provider chain at runtime: Claude → Groq → Gemini (each step is optional).
    """
    supabase_url  = os.environ.get("SUPABASE_URL")
    supabase_key  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    groq_key      = os.environ.get("GROQ_API_KEY")
    gemini_key    = os.environ.get("GEMINI_API_KEY")

    # Supabase is hard-required
    missing_required = []
    if not supabase_url: missing_required.append("SUPABASE_URL")
    if not supabase_key: missing_required.append("SUPABASE_SERVICE_ROLE_KEY")

    if missing_required:
        log.error(f"Missing required environment variables: {', '.join(missing_required)}")
        log.error("Add them as GitHub Actions secrets (Settings → Secrets → Actions)")
        sys.exit(1)

    # At least one AI provider must be available
    if not (anthropic_key or groq_key or gemini_key):
        log.error("No AI provider configured. Set ANTHROPIC_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY.")
        log.error("Get a free Groq key at:   https://console.groq.com")
        log.error("Get a free Gemini key at: https://aistudio.google.com/app/apikey")
        sys.exit(1)

    # Log the active provider chain
    chain = []
    if anthropic_key: chain.append("Claude")
    if groq_key:      chain.append("Groq")
    if gemini_key:    chain.append("Gemini")
    log.info(f"AI provider chain: {' → '.join(chain)}")

    anthropic_client = Anthropic(api_key=anthropic_key) if anthropic_key else None

    return (
        create_client(supabase_url, supabase_key),
        anthropic_client,
    )


def run(
    industries: list[str] | None = None,
    skip_scrape: bool = False,
    skip_extract: bool = False,
    skip_match: bool = False,
) -> None:
    target = industries or INDUSTRIES
    start  = datetime.now(timezone.utc)
    log.info(f"Pipeline started at {start.strftime('%Y-%m-%d %H:%M UTC')}")
    log.info(f"Industries: {', '.join(target)}")

    supabase, anthropic = get_clients()

    # ── Step 1: Scrape ────────────────────────────────────────────────────────
    if not skip_scrape:
        log.info("=" * 50)
        log.info("STEP 1 — Scrapers")
        gh_totals = run_greenhouse(supabase, target)
        lv_totals = run_lever(supabase, target)
        wd_totals = run_workday(supabase, target)
        total_new = sum(gh_totals.values()) + sum(lv_totals.values()) + sum(wd_totals.values())
        log.info(f"Scrapers done: {total_new} new raw jobs")
    else:
        log.info("STEP 1 — Skipped (--skip-scrape)")

    # ── Step 2: Extract ───────────────────────────────────────────────────────
    # Deterministic extractor — no AI, no token cost. Process the entire raw_jobs
    # backlog in one run. 25000 is well above the practical company-board total
    # (~13–15K jobs from all ATSes combined).
    if not skip_extract:
        log.info("=" * 50)
        log.info("STEP 2 — Extractor")
        extracted = run_extractor(supabase, anthropic, batch_size=25000)
        log.info(f"Extractor done: {extracted} jobs extracted")
    else:
        log.info("STEP 2 — Skipped (--skip-extract)")

    # ── Step 3+4: Match & Route ───────────────────────────────────────────────
    # Matcher spends one paid AI call per judgment, so the per-industry batch
    # is capped to bound cost per run (MATCHER_BATCH_SIZE env var to override).
    # ~700 jobs/industry ≈ 2,000 judgments/run ≈ $1-2 on Haiku. The backlog
    # drains across weekly runs; the free-tier circuit breaker in
    # provider_state.py still stops the loop cleanly if quotas are exhausted.
    matcher_batch = int(os.environ.get("MATCHER_BATCH_SIZE", "700"))
    if not skip_match:
        log.info("=" * 50)
        log.info("STEP 3+4 — Ontology Matcher + Routing")
        all_stats = {"matched": 0, "pending": 0, "rejected": 0}
        for industry in target:
            stats = run_matcher(supabase, anthropic, industry, batch_size=matcher_batch)
            for k in all_stats:
                all_stats[k] += stats.get(k, 0)
        log.info(f"Matcher done: {all_stats}")
    else:
        log.info("STEP 3+4 — Skipped (--skip-match)")

    elapsed = (datetime.now(timezone.utc) - start).total_seconds()
    log.info("=" * 50)
    log.info(f"Pipeline complete in {elapsed:.0f}s")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Career Pathways ingestion pipeline")
    parser.add_argument("--industries", nargs="+", choices=INDUSTRIES,
                        help="Limit to specific industries")
    parser.add_argument("--skip-scrape",   action="store_true")
    parser.add_argument("--skip-extract",  action="store_true")
    parser.add_argument("--skip-match",    action="store_true")
    args = parser.parse_args()

    run(
        industries=args.industries,
        skip_scrape=args.skip_scrape,
        skip_extract=args.skip_extract,
        skip_match=args.skip_match,
    )
