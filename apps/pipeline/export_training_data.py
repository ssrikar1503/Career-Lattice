"""
Export the pipeline's accumulated data as fine-tuning training examples.

Every weekly run already stores, permanently (nothing in the pipeline deletes
job rows):

  raw_jobs        - the posting as scraped (title + description)
  extracted_jobs  - the AI extraction output (normalized title, skills,
                    seniority, location, country, industry)
  role_matches    - the AI's canonical-role match + confidence, with a human
                    approved/rejected status from the admin queue

That join IS the training set for a future fine-tuned small model: input is
the raw posting, target is the extraction + match, and the human review
status separates gold labels (approved) from negatives (rejected).

Job postings are public documents; no personal data is stored or exported
(resumes never touch the database).

Usage:
  python export_training_data.py                    # all examples -> training_data.jsonl
  python export_training_data.py --approved-only    # only human-approved matches
  python export_training_data.py --out my.jsonl

Each JSONL line:
  {
    "input":  {"title": ..., "description": ..., "company": ..., "source": ...},
    "target": {"normalized_title": ..., "skills": [...], "seniority": ...,
               "location": ..., "country": ..., "industry": ...,
               "matches": [{"role_title": ..., "confidence": ..., "status": ...}]}
  }
"""

import os
import json
import argparse
import logging

from dotenv import load_dotenv

import db

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)


def fetch_all(table: str, columns: str) -> list[dict]:
    """Fetch a whole table, oldest first.

    Direct Postgres has no per-response row cap, so this is a single query (the
    old Supabase/PostgREST version had to paginate in 1000-row pages). `table`
    and `columns` are fixed literals from the call sites below, never user
    input, so interpolating them is safe."""
    return db.fetchall(f"SELECT {columns} FROM {table} ORDER BY created_at, id")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="training_data.jsonl")
    parser.add_argument("--approved-only", action="store_true",
                        help="keep only examples whose role match a human approved")
    args = parser.parse_args()

    load_dotenv()
    if not os.environ.get("DATABASE_URL"):
        raise SystemExit("DATABASE_URL is required")

    log.info("Fetching canonical roles…")
    roles = {r["id"]: r["title"] for r in fetch_all("canonical_roles", "id, title")}

    log.info("Fetching raw jobs…")
    raw = {r["id"]: r for r in fetch_all(
        "raw_jobs", "id, source, company, raw_title, raw_description")}

    log.info("Fetching extractions…")
    extracted = fetch_all(
        "extracted_jobs",
        "id, raw_job_id, normalized_title, skills, seniority, location, country, industry")

    log.info("Fetching role matches…")
    matches_by_job: dict[str, list[dict]] = {}
    for m in fetch_all("role_matches",
                       "extracted_job_id, canonical_role_id, confidence, status"):
        matches_by_job.setdefault(m["extracted_job_id"], []).append({
            "role_title": roles.get(m["canonical_role_id"], "unknown"),
            "confidence": float(m["confidence"]),
            "status":     m["status"],
        })

    written = skipped = 0
    with open(args.out, "w") as f:
        for ex in extracted:
            job = raw.get(ex["raw_job_id"])
            if not job:
                continue
            match_list = matches_by_job.get(ex["id"], [])
            if args.approved_only:
                match_list = [m for m in match_list if m["status"] == "approved"]
                if not match_list:
                    skipped += 1
                    continue
            f.write(json.dumps({
                "input": {
                    "title":       job["raw_title"],
                    "description": job.get("raw_description") or "",
                    "company":     job["company"],
                    "source":      job["source"],
                },
                "target": {
                    "normalized_title": ex.get("normalized_title"),
                    "skills":           ex.get("skills") or [],
                    "seniority":        ex.get("seniority"),
                    "location":         ex.get("location"),
                    "country":          ex.get("country"),
                    "industry":         ex.get("industry"),
                    "matches":          match_list,
                },
            }) + "\n")
            written += 1

    log.info(f"Wrote {written} examples to {args.out}"
             + (f" ({skipped} skipped without an approved match)" if args.approved_only else ""))


if __name__ == "__main__":
    main()
