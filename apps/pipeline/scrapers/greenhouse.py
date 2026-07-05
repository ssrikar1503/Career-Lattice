"""
Greenhouse public API scraper.
Pulls job postings from companies that use Greenhouse ATS.
API docs: https://developers.greenhouse.io/job-board.html

Company list is loaded from ../companies.json (single source of truth).
"""

import requests
import time
import logging
from datetime import datetime, timezone
from supabase import Client

from companies_loader import grouped_by_industry

log = logging.getLogger(__name__)

# No per-company cap. The scraper is deterministic (no AI cost) so we pull
# every job the board exposes. The matcher's daily AI quota is the real cap,
# enforced by the circuit breaker downstream.

BASE_URL = "https://boards-api.greenhouse.io/v1/boards/{company}/jobs"
HEADERS  = {"User-Agent": "CareerPathwaysPlatform/1.0 (workforce-research)"}

# Batch upserts to Supabase so one big company (~2K jobs) doesn't pile up 2K
# HTTP/2 streams on one connection. Supabase's pooler closes the connection
# after ~20K streams; per-job upserts hit that limit during a full-scale run.
UPSERT_BATCH_SIZE = 50


def _batch_upsert(supabase: Client, rows: list[dict], company_slug: str) -> int:
    """Upsert rows into raw_jobs in batches of UPSERT_BATCH_SIZE. Returns the
    number of brand-new rows inserted (ignore_duplicates returns empty data
    for URL conflicts, so this naturally excludes already-known jobs)."""
    if not rows:
        return 0
    inserted = 0
    for i in range(0, len(rows), UPSERT_BATCH_SIZE):
        batch = rows[i:i + UPSERT_BATCH_SIZE]
        try:
            result = (
                supabase.table("raw_jobs")
                .upsert(batch, on_conflict="url", ignore_duplicates=True)
                .execute()
            )
            inserted += len(result.data or [])
        except Exception as e:
            log.error(f"Batch upsert failed for {company_slug} (rows {i}-{i+len(batch)}): {e}")
    return inserted


def scrape_company(company_slug: str, supabase: Client, industry: str, dead_slugs: list[str]) -> int:
    """Fetch all jobs for a Greenhouse company and upsert to raw_jobs.

    `dead_slugs` is a shared list the caller passes in; we append to it when
    we get a 404 so the orchestrator can summarise dead boards at the end
    of the run (the 404 summary required by Phase 2.3).
    """
    url = BASE_URL.format(company=company_slug)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        if resp.status_code == 404:
            log.warning(f"Greenhouse board not found for {company_slug!r}")
            dead_slugs.append(company_slug)
        else:
            log.error(f"HTTP error for {company_slug!r}: {e}")
        return 0
    except requests.RequestException as e:
        log.error(f"Request failed for {company_slug!r}: {e}")
        return 0

    jobs = resp.json().get("jobs", [])
    rows: list[dict] = []

    for job in jobs:
        job_url = job.get("absolute_url") or job.get("url", "")
        if not job_url:
            continue

        # Prepend a structured LOCATION: line so the deterministic extractor can
        # regex it out instead of trying to find location buried in HTML body.
        location = ((job.get("location") or {}).get("name") or "").strip()
        content = job.get("content", "")[:7800]
        raw_description = f"LOCATION: {location}\n\n{content}" if location else content

        rows.append({
            "source":           "greenhouse",
            "company":          company_slug,
            "raw_title":        job.get("title", "").strip(),
            "raw_description":  raw_description,
            "url":              job_url,
            "industry":         industry,
            "scraped_at":       datetime.now(timezone.utc).isoformat(),
        })

    inserted = _batch_upsert(supabase, rows, company_slug)
    log.info(f"  {company_slug}: {len(jobs)} jobs fetched, {inserted} new")
    return inserted


def run_greenhouse(supabase: Client, industries: list[str] | None = None) -> dict[str, int]:
    """Run the Greenhouse scraper for all companies in companies.json."""
    totals: dict[str, int] = {}
    dead_slugs: list[str] = []
    by_industry = grouped_by_industry("greenhouse", industries)

    for industry, rows in by_industry.items():
        total = 0
        log.info(f"Scraping Greenhouse for {industry} ({len(rows)} companies)…")
        for row in rows:
            slug = row["slug"]
            n = scrape_company(slug, supabase, industry, dead_slugs)
            total += n
            time.sleep(1)  # be polite to the API
        totals[industry] = total
        log.info(f"  {industry} total: {total} new jobs")

    if dead_slugs:
        log.warning(
            f"Greenhouse 404 summary — {len(dead_slugs)} slug(s) not found: "
            f"{', '.join(dead_slugs)}. "
            f"These companies appear to have moved off Greenhouse — update companies.json."
        )

    return totals
