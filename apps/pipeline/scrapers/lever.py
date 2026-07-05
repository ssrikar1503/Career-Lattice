"""
Lever public postings API scraper.
Used for AM and semi startups that use Lever instead of Greenhouse.
API: https://github.com/lever/postings-api

Company list is loaded from ../companies.json (single source of truth).
"""

import requests
import time
import logging
from datetime import datetime, timezone
from supabase import Client

from companies_loader import grouped_by_industry

log = logging.getLogger(__name__)

# No per-company cap. Deterministic scraper — AI cost is downstream.

BASE_URL = "https://api.lever.co/v0/postings/{company}?mode=json"
HEADERS  = {"User-Agent": "CareerPathwaysPlatform/1.0 (workforce-research)"}

# Batch upserts — see greenhouse.py for rationale.
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


def scrape_company(company_slug: str, supabase: Client, industry: str, dead_slugs: list[str]) -> int:
    url = BASE_URL.format(company=company_slug)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        if resp.status_code == 404:
            log.warning(f"Lever board not found for {company_slug!r}")
            dead_slugs.append(company_slug)
        else:
            log.error(f"HTTP error for {company_slug!r}: {e}")
        return 0
    except requests.RequestException as e:
        log.error(f"Request failed for {company_slug!r}: {e}")
        return 0

    raw = resp.json()
    postings = raw if isinstance(raw, list) else []
    rows: list[dict] = []

    for posting in postings:
        job_url = posting.get("hostedUrl") or posting.get("applyUrl", "")
        if not job_url:
            continue

        # Lever returns description as HTML — store raw, extractor will clean it
        description = posting.get("descriptionPlain", "") or posting.get("description", "")

        # Prepend a structured LOCATION: line so the deterministic extractor can
        # regex it out. Lever puts location under categories.location.
        location = ((posting.get("categories") or {}).get("location") or "").strip()
        body = description[:7800]
        raw_description = f"LOCATION: {location}\n\n{body}" if location else body

        rows.append({
            "source":           "lever",
            "company":          company_slug,
            "raw_title":        posting.get("text", "").strip(),
            "raw_description":  raw_description,
            "url":              job_url,
            "industry":         industry,
            "scraped_at":       datetime.now(timezone.utc).isoformat(),
        })

    inserted = _batch_upsert(supabase, rows, company_slug)
    log.info(f"  {company_slug}: {len(postings)} jobs, {inserted} new")
    return inserted


def run_lever(supabase: Client, industries: list[str] | None = None) -> dict[str, int]:
    totals: dict[str, int] = {}
    dead_slugs: list[str] = []
    by_industry = grouped_by_industry("lever", industries)

    for industry, rows in by_industry.items():
        total = 0
        log.info(f"Scraping Lever for {industry} ({len(rows)} companies)…")
        for row in rows:
            slug = row["slug"]
            n = scrape_company(slug, supabase, industry, dead_slugs)
            total += n
            time.sleep(1)
        totals[industry] = total
        log.info(f"  {industry} total: {total} new jobs")

    if dead_slugs:
        log.warning(
            f"Lever 404 summary — {len(dead_slugs)} slug(s) not found: "
            f"{', '.join(dead_slugs)}. "
            f"These companies appear to have moved off Lever — update companies.json."
        )

    return totals
