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

from companies_loader import grouped_by_industry
from scrapers.filters import title_passes
from scrapers.raw_jobs_upsert import batch_upsert as _batch_upsert

log = logging.getLogger(__name__)

# No per-company cap. The scraper is deterministic (no AI cost) so we pull
# every job the board exposes. The matcher's daily AI quota is the real cap,
# enforced by the circuit breaker downstream.

BASE_URL = "https://boards-api.greenhouse.io/v1/boards/{company}/jobs"
HEADERS  = {"User-Agent": "CareerPathwaysPlatform/1.0 (workforce-research)"}

# Batch upserts so one big company (~2K jobs) doesn't open thousands of
# connections. See scrapers/raw_jobs_upsert.py for the shared ON CONFLICT (url)
# DO NOTHING implementation.
UPSERT_BATCH_SIZE = 50


def scrape_company(company: dict, db, industry: str, dead_slugs: list[str]) -> int:
    """Fetch all jobs for a Greenhouse company and upsert to raw_jobs.

    `dead_slugs` is a shared list the caller passes in; we append to it when
    we get a 404 so the orchestrator can summarise dead boards at the end
    of the run (the 404 summary required by Phase 2.3).
    """
    company_slug = company["slug"]
    url = BASE_URL.format(company=company_slug)
    try:
        # 90s read timeout: giant boards (SpaceX ~2,800 jobs with full descriptions)
        # return multi-MB payloads that a 15s timeout cut off mid-download.
        resp = requests.get(url, headers=HEADERS, timeout=(15, 90))
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
        if not title_passes(job.get("title", ""), company):
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

    inserted = _batch_upsert(db, rows, company_slug)
    log.info(f"  {company_slug}: {len(jobs)} jobs fetched, {inserted} new")
    return inserted


def run_greenhouse(db, industries: list[str] | None = None) -> dict[str, int]:
    """Run the Greenhouse scraper for all companies in companies.json."""
    totals: dict[str, int] = {}
    dead_slugs: list[str] = []
    by_industry = grouped_by_industry("greenhouse", industries)

    for industry, rows in by_industry.items():
        total = 0
        log.info(f"Scraping Greenhouse for {industry} ({len(rows)} companies)…")
        for row in rows:
            n = scrape_company(row, db, industry, dead_slugs)
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
