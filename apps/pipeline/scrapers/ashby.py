"""
Ashby public job-board scraper.

Ashby is the ATS newer startups use (several AI-chip and space companies
have moved there from Greenhouse, e.g. Cerebras). One GET per company:

  https://api.ashbyhq.com/posting-api/job-board/{company}
  Returns: { "jobs": [ {title, descriptionPlain, location,
                        secondaryLocations, jobUrl, isListed, ...} ] }

Company list is loaded from ../companies.json (single source of truth).
Supports the same optional filters as the other scrapers: title_keywords
and locations_include (matched against primary + secondary locations).
"""

import requests
import time
import logging
from datetime import datetime, timezone
from supabase import Client

from companies_loader import grouped_by_industry
from scrapers.filters import title_passes, location_passes

log = logging.getLogger(__name__)

BASE_URL = "https://api.ashbyhq.com/posting-api/job-board/{company}"
HEADERS  = {"User-Agent": "CareerPathwaysPlatform/1.0 (workforce-research)", "Accept": "application/json"}

UPSERT_BATCH_SIZE = 50


def _batch_upsert(supabase: Client, rows: list[dict], company_slug: str) -> int:
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


def _all_locations(posting: dict) -> str:
    """Primary location plus any secondary location names, one string."""
    parts = [posting.get("location") or ""]
    for sec in posting.get("secondaryLocations") or []:
        parts.append(sec.get("location") or "")
    return "; ".join(p for p in parts if p)


def scrape_company(company: dict, supabase: Client, industry: str, dead_slugs: list[str]) -> int:
    company_slug = company["slug"]
    url = BASE_URL.format(company=company_slug)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=(15, 90))
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        if resp.status_code == 404:
            log.warning(f"Ashby board not found for {company_slug!r}")
            dead_slugs.append(company_slug)
        else:
            log.error(f"HTTP error for {company_slug!r}: {e}")
        return 0
    except requests.RequestException as e:
        log.error(f"Request failed for {company_slug!r}: {e}")
        return 0

    try:
        postings = resp.json().get("jobs", [])
    except ValueError:
        log.warning(f"Ashby {company_slug!r} returned non-JSON response. Skipping.")
        dead_slugs.append(company_slug)
        return 0

    rows: list[dict] = []
    for posting in postings:
        if posting.get("isListed") is False:
            continue
        job_url = posting.get("jobUrl") or posting.get("applyUrl", "")
        title   = (posting.get("title") or "").strip()
        if not job_url or not title:
            continue
        if not title_passes(title, company):
            continue
        location = _all_locations(posting)
        if not location_passes(location, company):
            continue

        description = posting.get("descriptionPlain", "") or ""
        body = description[:7800]
        raw_description = f"LOCATION: {location}\n\n{body}" if location else body

        rows.append({
            "source":           "ashby",
            "company":          company_slug,
            "raw_title":        title,
            "raw_description":  raw_description,
            "url":              job_url,
            "industry":         industry,
            "scraped_at":       datetime.now(timezone.utc).isoformat(),
        })

    inserted = _batch_upsert(supabase, rows, company_slug)
    log.info(f"  {company_slug}: {len(postings)} jobs, {inserted} new")
    return inserted


def run_ashby(supabase: Client, industries: list[str] | None = None) -> dict[str, int]:
    totals: dict[str, int] = {}
    dead_slugs: list[str] = []
    by_industry = grouped_by_industry("ashby", industries)

    for industry, rows in by_industry.items():
        total = 0
        log.info(f"Scraping Ashby for {industry} ({len(rows)} companies)…")
        for row in rows:
            n = scrape_company(row, supabase, industry, dead_slugs)
            total += n
            time.sleep(1)
        totals[industry] = total
        log.info(f"  {industry} total: {total} new jobs")

    if dead_slugs:
        log.warning(
            f"Ashby 404 summary — {len(dead_slugs)} slug(s) not found: "
            f"{', '.join(dead_slugs)}. "
            f"These companies appear to have moved off Ashby — update companies.json."
        )

    return totals
