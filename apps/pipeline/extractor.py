"""
Extractor — Step 2 of the pipeline.

Deterministic Python (no AI). For each unprocessed raw_job, parses:
  - normalized_title (strip suffixes / parens / roman numerals)
  - seniority        (regex on title)
  - location         (regex on raw_description LOCATION: prefix injected by scrapers)
  - country          (existing US-state classifier on the parsed location text)
  - skills           ([] — dropped; matcher works from title + seniority + description excerpt)

Why no AI:
  The previous Claude/Groq/Gemini extractor cost ~1100 tokens per job, which
  capped daily throughput to ~60 jobs on free tiers. The semantic step is the
  matcher; extraction is mechanical. Keeping AI here was wasted budget.

The function signature `run_extractor(supabase, anthropic, batch_size)` is
preserved so main.py still calls it with the anthropic client; the param is
unused.
"""

import re
import logging
from supabase import Client

log = logging.getLogger(__name__)

# ── Location & country detection ──────────────────────────────────────────────
# `classify_us_country` returns "US", "XX", or None. Kept verbatim from the
# previous AI-based extractor — it was already deterministic and proven.

_US_STATE_ABBREVS = (
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS "
    "MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV "
    "WI WY DC PR"
).split()
_US_STATE_NAMES = {
    "alabama","alaska","arizona","arkansas","california","colorado","connecticut",
    "delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa",
    "kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan",
    "minnesota","mississippi","missouri","montana","nebraska","nevada",
    "new hampshire","new jersey","new mexico","new york","north carolina",
    "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
    "south carolina","south dakota","tennessee","texas","utah","vermont","virginia",
    "washington","west virginia","wisconsin","wyoming","district of columbia",
    "puerto rico",
}
_US_PATTERNS = re.compile(
    r"\b(united states|u\.?s\.?a?\.?|remote\s*[-—–]\s*u\.?s\.?|remote\s*-\s*united\s*states)\b",
    re.IGNORECASE,
)
_AMBIGUOUS_PATTERNS = re.compile(
    r"\b(multiple\s+locations|remote\s*[-—–]\s*anywhere|various|worldwide|global)\b",
    re.IGNORECASE,
)
# Two-letter country codes the scraped data commonly mentions. Conservative —
# only adds a hit if the text says "United Kingdom" / "Germany" etc. explicitly.
_COUNTRY_NAMES: dict[str, str] = {
    "united kingdom": "GB", "england": "GB", "scotland": "GB", "wales": "GB",
    "germany": "DE", "france": "FR", "netherlands": "NL", "spain": "ES",
    "italy": "IT", "ireland": "IE", "switzerland": "CH", "austria": "AT",
    "belgium": "BE", "sweden": "SE", "norway": "NO", "finland": "FI",
    "denmark": "DK", "poland": "PL", "portugal": "PT", "czech republic": "CZ",
    "canada": "CA", "mexico": "MX",
    "india": "IN", "japan": "JP", "china": "CN", "singapore": "SG",
    "south korea": "KR", "korea": "KR", "taiwan": "TW", "hong kong": "HK",
    "australia": "AU", "new zealand": "NZ",
    "israel": "IL", "united arab emirates": "AE", "saudi arabia": "SA",
    "brazil": "BR", "argentina": "AR", "chile": "CL",
    "south africa": "ZA",
}


def classify_us_country(location_text: str) -> str | None:
    """
    Returns "US" if clearly US, "XX" if clearly ambiguous, None otherwise.
    Caller falls back to other classifiers (other-country detection) on None.
    """
    if not location_text:
        return None
    text = location_text.strip()
    if _AMBIGUOUS_PATTERNS.search(text):
        return "XX"
    if _US_PATTERNS.search(text):
        return "US"
    text_lower = text.lower()
    if any(state in text_lower for state in _US_STATE_NAMES):
        return "US"
    if re.search(rf",\s*({'|'.join(_US_STATE_ABBREVS)})\b", text):
        return "US"
    return None


def detect_other_country(location_text: str) -> str | None:
    """Match explicit non-US country names. Returns ISO-2 or None."""
    if not location_text:
        return None
    text_lower = location_text.lower()
    for name, code in _COUNTRY_NAMES.items():
        if name in text_lower:
            return code
    return None


# ── Location parsing ──────────────────────────────────────────────────────────

_LOCATION_PREFIX = re.compile(
    r"^\s*LOCATION:\s*([^\n]+)",
    re.IGNORECASE | re.MULTILINE,
)


def extract_location(raw_description: str | None) -> str | None:
    """
    Pull the LOCATION: <text> line that scrapers prepend to raw_description.
    Returns the first match (the prepended line), trimmed. None if absent —
    which happens for old rows scraped before the prefix change.
    """
    if not raw_description:
        return None
    m = _LOCATION_PREFIX.search(raw_description)
    if not m:
        return None
    text = m.group(1).strip()
    # Collapse messy whitespace and strip trailing punctuation
    text = re.sub(r"\s+", " ", text).rstrip(" .,;|")
    return text or None


# ── Seniority detection ──────────────────────────────────────────────────────
# Order matters: lead markers checked first because "Senior Staff Engineer"
# should be lead, not senior. Senior beats entry because "Senior Junior
# Engineer" doesn't exist but the regexes shouldn't surprise us.

_SENIORITY_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("lead",   re.compile(r"\b(Principal|Staff|Distinguished|Fellow|Lead|Head\s+of|Director|Chief|VP|Vice\s+President)\b", re.IGNORECASE)),
    ("senior", re.compile(r"\b(Senior|Sr\.?|Sr\b)\b", re.IGNORECASE)),
    ("entry",  re.compile(r"\b(Junior|Jr\.?|Intern|Internship|Trainee|Graduate|Apprentice|Entry[\s-]?Level|New\s+Grad)\b", re.IGNORECASE)),
]
_ROMAN_LEVEL = {"I": "entry", "II": "mid", "III": "senior", "IV": "lead", "V": "lead"}
_ROMAN_SUFFIX = re.compile(r"\s+(I{1,3}|IV|V)\s*$")


def detect_seniority(title: str) -> str:
    """Return one of entry|mid|senior|lead, defaulting to mid."""
    if not title:
        return "mid"
    for level, pat in _SENIORITY_PATTERNS:
        if pat.search(title):
            return level
    m = _ROMAN_SUFFIX.search(title)
    if m:
        return _ROMAN_LEVEL.get(m.group(1).upper(), "mid")
    return "mid"


# ── Title normalization ──────────────────────────────────────────────────────

_PARENS_TAIL  = re.compile(r"\s*\([^)]*\)\s*$")
_DASH_TAIL    = re.compile(r"\s*[—–\-]\s*(?:remote|hybrid|on[\s-]?site|us|usa|united states|[^—–\-]+(?:,\s*[A-Z]{2})?)\s*$", re.IGNORECASE)
_LEAD_TAGS    = re.compile(r"^\s*\[[^\]]+\]\s*", re.IGNORECASE)  # "[Remote] Senior Engineer"
_TRAILING_LVL = re.compile(r"\s+(I{1,3}|IV|V)\s*$")


def normalize_title(raw_title: str) -> str:
    """Strip location suffixes, brackets, roman-numeral level markers."""
    if not raw_title:
        return ""
    t = raw_title.strip()
    t = _LEAD_TAGS.sub("", t)
    # Strip a trailing parenthetical (Remote), (US), (Hybrid - SF), …
    t = _PARENS_TAIL.sub("", t)
    # Strip a trailing " — San Francisco, CA" / " - Remote" style suffix
    t = _DASH_TAIL.sub("", t)
    # Drop trailing level marker "Engineer III" -> "Engineer"
    t = _TRAILING_LVL.sub("", t)
    return re.sub(r"\s+", " ", t).strip()


# ── Country resolution (location → ISO-2) ─────────────────────────────────────

def detect_country(location_text: str | None, raw_description: str | None) -> str:
    """
    Resolve country in priority order:
      1. US/XX fast-path on the explicit location text
      2. Non-US country name in the location text
      3. US/XX fast-path on the raw description (catches "Remote - US" buried in body)
      4. Default "XX"
    """
    if location_text:
        us = classify_us_country(location_text)
        if us:
            return us
        other = detect_other_country(location_text)
        if other:
            return other
    if raw_description:
        us = classify_us_country(raw_description[:1000])
        if us:
            return us
    return "XX"


# ── Pipeline entry point ─────────────────────────────────────────────────────

def extract_job(raw_job: dict) -> dict:
    """Pure function — parse one raw_job into the extracted_jobs row shape."""
    title       = raw_job.get("raw_title", "") or ""
    description = raw_job.get("raw_description", "") or ""
    location    = extract_location(description)
    return {
        "normalized_title": normalize_title(title) or title,
        "skills":           [],
        "seniority":        detect_seniority(title),
        "location":         location,
        "country":          detect_country(location, description),
    }


def run_extractor(supabase: Client, anthropic=None, batch_size: int = 200) -> int:
    """
    Find raw_jobs that have no extracted_job yet, extract each one
    deterministically. Returns the number of jobs extracted.

    The `anthropic` parameter is accepted for backward compatibility with
    main.py's call signature but is no longer used.
    """
    # Page through raw_jobs in 1000-row batches — Supabase PostgREST silently
    # caps a single .limit() call at 1000 rows regardless of what we ask for,
    # so we use .range() pagination to get past the cap.
    PAGE = 1000
    all_raw: list[dict] = []
    offset = 0
    while len(all_raw) < batch_size:
        result = (
            supabase.table("raw_jobs")
            .select("id, raw_title, company, raw_description, industry")
            .range(offset, offset + PAGE - 1)
            .execute()
        )
        rows = result.data or []
        all_raw.extend(rows)
        if len(rows) < PAGE:
            break
        offset += PAGE
    all_raw = all_raw[:batch_size]
    if not all_raw:
        log.info("No raw jobs found.")
        return 0

    # Filter already-extracted in chunks — PostgREST rejects >~1000-UUID IN
    # lists because of URL length, so chunk to 100.
    CHUNK_SIZE = 100
    raw_ids = [r["id"] for r in all_raw]
    already_done: set[str] = set()
    for i in range(0, len(raw_ids), CHUNK_SIZE):
        chunk = raw_ids[i:i + CHUNK_SIZE]
        extracted_result = (
            supabase.table("extracted_jobs")
            .select("raw_job_id")
            .in_("raw_job_id", chunk)
            .execute()
        )
        for r in (extracted_result.data or []):
            already_done.add(r["raw_job_id"])
    to_process = [r for r in all_raw if r["id"] not in already_done]

    log.info(f"Extracting {len(to_process)} new jobs (skipping {len(already_done)} already done)…")

    # Build all rows up-front (deterministic parsing — no I/O), then batch
    # insert. Per-row inserts on 15K-row backlogs took 30-60 minutes and risked
    # hitting Supabase's HTTP/2 stream cap (~20K streams per connection).
    rows: list[dict] = []
    for raw in to_process:
        fields = extract_job(raw)
        rows.append({
            "raw_job_id":       raw["id"],
            "normalized_title": fields["normalized_title"],
            "skills":           fields["skills"],
            "seniority":        fields["seniority"],
            "location":         fields["location"],
            "country":          fields["country"],
            "industry":         raw.get("industry"),
        })

    INSERT_BATCH = 50
    extracted_count = 0
    total_batches = (len(rows) + INSERT_BATCH - 1) // INSERT_BATCH
    for i in range(0, len(rows), INSERT_BATCH):
        batch = rows[i:i + INSERT_BATCH]
        batch_no = (i // INSERT_BATCH) + 1
        try:
            result = supabase.table("extracted_jobs").insert(batch).execute()
            extracted_count += len(result.data or [])
        except Exception as e:
            log.error(f"Batch insert failed (batch {batch_no}/{total_batches}): {e}")
            # Fall back to per-row inserts for this batch so one bad row
            # doesn't lose the other 49 in the batch.
            for row in batch:
                try:
                    supabase.table("extracted_jobs").insert(row).execute()
                    extracted_count += 1
                except Exception as e2:
                    log.error(f"Row insert failed for {row['raw_job_id']}: {e2}")
        # Progress log every 10 batches (~500 rows)
        if batch_no % 10 == 0 or batch_no == total_batches:
            log.info(f"  extractor progress: {extracted_count} / {len(rows)} ({batch_no}/{total_batches} batches)")

    log.info(f"Extracted {extracted_count} / {len(to_process)} jobs.")
    return extracted_count
