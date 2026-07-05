"""
companies.json loader.

Single source of truth for which companies the pipeline scrapes.
All three scrapers (greenhouse, lever, workday) call into this module instead
of carrying their own hard-coded lists.

To add a new company: edit companies.json. No Python edits required.
"""

import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# companies.json sits in the pipeline root, next to main.py
COMPANIES_FILE = Path(__file__).parent / "companies.json"


def _load_all() -> list[dict]:
    """Read companies.json once per call. Cheap — the file is < 5 KB."""
    try:
        with open(COMPANIES_FILE) as f:
            data = json.load(f)
        return data.get("companies", [])
    except FileNotFoundError:
        log.error(f"companies.json not found at {COMPANIES_FILE}")
        return []
    except json.JSONDecodeError as e:
        log.error(f"companies.json is malformed: {e}")
        return []


def companies_for(ats: str, industries: list[str] | None = None) -> list[dict]:
    """
    Return all companies for a given ATS, optionally filtered by industries.

      companies_for("greenhouse")
      companies_for("workday", ["semiconductors", "space"])
    """
    rows = [c for c in _load_all() if c.get("ats") == ats]
    if industries is not None:
        wanted = set(industries)
        rows = [c for c in rows if c.get("industry") in wanted]
    return rows


def grouped_by_industry(ats: str, industries: list[str] | None = None) -> dict[str, list[dict]]:
    """
    Convenience: same as companies_for() but returned as { industry: [companies] }.
    Used by the scrapers that want to log per-industry totals.
    """
    out: dict[str, list[dict]] = {}
    for c in companies_for(ats, industries):
        out.setdefault(c["industry"], []).append(c)
    return out
