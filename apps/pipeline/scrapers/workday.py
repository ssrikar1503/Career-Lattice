"""
Workday public-board scraper.

Used for large employers whose ATS is Workday (Intel, NVIDIA, Micron, Applied
Materials, HP, Blue Origin, Boeing, Leidos, etc.).

API shape:
  POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
  Body: { "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "" }
  Returns: { "total": N, "jobPostings": [ {title, externalPath, locationsText, postedOn, bulletFields} ] }

WHAT WE STORE (v1 trade-off):
  Workday's list endpoint does NOT include the job description — only title,
  location, and a few short bullet fields. Fetching the full description per
  job would mean an extra API call each, multiplied by ~12k jobs per week.
  That blows past GitHub Actions' run-time limit.
  For v1 we store title + locations + bullets as the raw_description. Workday
  titles tend to be self-describing ("Senior SoC Compute/Memory Subsystem
  Architect") so the AI extractor still has enough signal for matching by
  title + seniority.
  If matching quality is poor after the first real cron, the upgrade is to
  do a second detail-fetch per job, capped at the freshest N.

NO PER-COMPANY CAP:
  Scraper is deterministic (no AI cost) so we pull every job each Workday
  board exposes. The matcher's daily AI quota is the real ceiling and is
  enforced by the circuit breaker downstream — not by pre-capping ingestion.

Company list is loaded from ../companies.json (single source of truth).
"""

import requests
import time
import logging
from datetime import datetime, timezone
from supabase import Client

from companies_loader import companies_for

log = logging.getLogger(__name__)

# Workday paginates with a small limit. 20 is the typical default they use.
PAGE_SIZE = 20

# Hard safety cap on pagination — some Workday boards misbehave and keep
# returning a full page forever, looping indefinitely. 500 pages × 20 jobs =
# 10,000 jobs per company is well above the largest legitimate board.
MAX_PAGES = 500

# Batch upserts so big companies (NVIDIA ~2K, Micron ~3K) don't pile up
# thousands of HTTP/2 streams on a single Supabase connection — the pooler
# closes the connection after ~20K streams, which crashed an earlier run.
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

HEADERS = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
    "User-Agent":   "CareerPathwaysPlatform/1.0 (workforce-research)",
}


def _build_api_url(tenant: str, wd: int, site: str) -> str:
    return f"https://{tenant}.wd{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"


def _build_human_url(tenant: str, wd: int, site: str, external_path: str) -> str:
    # The human-facing URL we store on raw_jobs.url so the apply-link works
    return f"https://{tenant}.wd{wd}.myworkdayjobs.com/en-US/{site}{external_path}"


def _build_raw_description(title: str, locations: str, bullets: list[str], posted_on: str) -> str:
    """
    Workday's list endpoint has no description, only short metadata.
    Concatenate what we have into a pseudo-description. The LOCATION: prefix
    matches the format used by greenhouse + lever scrapers so the deterministic
    extractor can read location with a single regex across all three sources.
    """
    parts = []
    if locations:
        parts.append(f"LOCATION: {locations}")
    parts.append(f"Title: {title}")
    if bullets:
        parts.append(f"Tags: {', '.join(bullets)}")
    if posted_on:
        parts.append(f"Posted: {posted_on}")
    return "\n\n".join(parts)


def scrape_company(company: dict, supabase: Client, dead_slugs: list[str]) -> int:
    """Fetch every job for one Workday company, paginating until exhausted."""
    slug   = company["slug"]
    tenant = company.get("tenant")
    wd     = company.get("wd")
    site   = company.get("site")
    if not (tenant and wd and site):
        log.error(f"Workday company {slug!r} missing tenant/wd/site in companies.json")
        return 0

    api_url = _build_api_url(tenant, wd, site)
    inserted = 0
    offset = 0
    seen_total = None
    pages_fetched = 0
    buffer: list[dict] = []

    while True:
        if pages_fetched >= MAX_PAGES:
            log.warning(
                f"  {slug}: hit MAX_PAGES safety cap ({MAX_PAGES}) at offset {offset}. "
                f"Stopping pagination — board may be misbehaving."
            )
            break

        body = {
            "appliedFacets": {},
            "limit":         PAGE_SIZE,
            "offset":        offset,
            "searchText":    "",
        }
        try:
            resp = requests.post(api_url, headers=HEADERS, json=body, timeout=15)
            resp.raise_for_status()
        except requests.exceptions.HTTPError as e:
            status = resp.status_code if resp is not None else "?"
            if status == 404:
                log.warning(f"Workday board not found for {slug!r} ({tenant}/{site})")
                dead_slugs.append(slug)
            elif status == 500:
                # Common when the site name is wrong — Workday tenant exists, path doesn't
                log.warning(f"Workday {slug!r} returned 500 — site path likely incorrect ({site!r})")
                dead_slugs.append(slug)
            else:
                log.error(f"HTTP {status} for {slug!r}: {e}")
            break
        except requests.RequestException as e:
            log.error(f"Workday request failed for {slug!r}: {e}")
            break

        try:
            payload = resp.json()
        except ValueError:
            # 200 OK but body wasn't JSON — anti-bot wall, maintenance page, or
            # the tenant started returning HTML. Treat like a dead slug so the
            # rest of the pipeline keeps running.
            log.warning(
                f"Workday {slug!r} returned non-JSON response "
                f"(status {resp.status_code}, content-type "
                f"{resp.headers.get('content-type', 'unknown')!r}) — "
                f"likely anti-bot wall or board change. Skipping."
            )
            dead_slugs.append(slug)
            break

        postings = payload.get("jobPostings", [])
        if seen_total is None:
            seen_total = payload.get("total", 0)
            log.info(f"  {slug}: {seen_total} total jobs at source — fetching all")
        if not postings:
            break

        for posting in postings:
            external_path = posting.get("externalPath", "")
            title         = (posting.get("title") or "").strip()
            if not external_path or not title:
                continue

            buffer.append({
                "source":          "workday",
                "company":         slug,
                "raw_title":       title,
                "raw_description": _build_raw_description(
                    title,
                    posting.get("locationsText") or "",
                    posting.get("bulletFields") or [],
                    posting.get("postedOn") or "",
                )[:8000],
                "url":             _build_human_url(tenant, wd, site, external_path),
                "industry":        company.get("industry"),
                "scraped_at":      datetime.now(timezone.utc).isoformat(),
            })

        offset += len(postings)
        pages_fetched += 1

        # Flush periodically so a big company doesn't sit on a multi-MB buffer.
        if len(buffer) >= UPSERT_BATCH_SIZE * 4:  # flush every ~200 rows
            inserted += _batch_upsert(supabase, buffer, slug)
            buffer.clear()

        # Termination — we've fetched at least as many as Workday claimed exist
        if seen_total and offset >= seen_total:
            break
        # Partial page = end of list
        if len(postings) < PAGE_SIZE:
            break

        time.sleep(0.5)

    # Flush whatever's left
    if buffer:
        inserted += _batch_upsert(supabase, buffer, slug)

    log.info(f"  {slug}: {inserted} new jobs inserted (pages: {pages_fetched})")
    return inserted


def run_workday(supabase: Client, industries: list[str] | None = None) -> dict[str, int]:
    """Run the Workday scraper for all companies in companies.json with ats=='workday'."""
    totals: dict[str, int] = {}
    dead_slugs: list[str] = []
    rows = companies_for("workday", industries)

    # Group for per-industry logging
    by_industry: dict[str, list[dict]] = {}
    for row in rows:
        by_industry.setdefault(row["industry"], []).append(row)

    for industry, companies in by_industry.items():
        total = 0
        log.info(f"Scraping Workday for {industry} ({len(companies)} companies)…")
        for company in companies:
            try:
                n = scrape_company(company, supabase, dead_slugs)
            except Exception as e:
                # Belt-and-suspenders — never let one company's unexpected crash
                # take down the whole weekly run (extractor + matcher depend on
                # us finishing).
                log.error(
                    f"Workday scraper crashed for {company.get('slug')!r}: {e}",
                    exc_info=True,
                )
                dead_slugs.append(company.get("slug", "?"))
                n = 0
            total += n
            time.sleep(1)  # be polite between companies
        totals[industry] = total
        log.info(f"  {industry} total: {total} new jobs")

    if dead_slugs:
        log.warning(
            f"Workday 404/500 summary — {len(dead_slugs)} board(s) unreachable: "
            f"{', '.join(dead_slugs)}. "
            f"These companies' Workday tenant/site path likely changed — verify and update companies.json."
        )

    return totals
