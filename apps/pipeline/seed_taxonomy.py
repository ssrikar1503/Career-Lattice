"""
Taxonomy Seeder — PHASE_B of deployment.
==========================================
One-time script that uploads the JSON taxonomies (36 AM + ~45 Semi + 38 Space roles)
into the Cloud SQL Postgres database so the pipeline has something to match
jobs against.

Idempotent: safe to run multiple times. For each industry, it:
  1. Inserts the industry row if missing, else updates it
  2. Deletes existing canonical_roles for that industry
  3. Re-inserts all roles fresh

Note: re-running this resets canonical_roles.open_jobs_count to 0. The next
pipeline run will repopulate counts. For v1 this is acceptable.

We keep the explicit select-then-insert/update (instead of a single upsert)
because it is easy to read and makes the "update existing vs insert new"
branch obvious in the logs.

Usage (in GitHub Actions):
    Triggered manually via the "Seed taxonomy data" workflow.

Usage (locally):
    cd apps/pipeline
    cp .env.example .env      # then fill in DATABASE_URL
    pip install -r requirements.txt
    python seed_taxonomy.py
"""

import json
import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

import db

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("seeder")

JSON_DIR   = Path(__file__).parent.parent / "web" / "src" / "data"
JSON_FILES = ["additive-manufacturing.json", "semiconductors.json", "space.json", "nuclear.json"]


def verify_schema(db) -> bool:
    """
    Ensure required tables exist before we try to seed anything.
    Gives a much clearer error than a deep stack trace if the user forgot to
    run schema.sql.
    """
    required = ["industries", "canonical_roles"]
    for table in required:
        try:
            # Table names come from the fixed `required` list above, never user
            # input, so interpolating them into the query is safe.
            db.fetchone(f"SELECT id FROM {table} LIMIT 1")
        except Exception as e:
            log.error(f"Table '{table}' is not accessible: {e}")
            log.error("")
            log.error("Likely cause: schema.sql has not been run on this Postgres database.")
            log.error("Fix:")
            log.error("  1. Connect to the Cloud SQL database (psql or the Cloud SQL Studio)")
            log.error("  2. Paste the entire contents of /schema.sql")
            log.error("  3. Run it — wait for success")
            log.error("  4. Re-run this seeder workflow")
            return False
    log.info(f"Schema verified: all {len(required)} required tables present")
    return True


def upsert_industry(db, ind: dict) -> str:
    """
    Insert industry row or update existing one matched by slug.
    Returns the industry UUID (whether newly created or pre-existing).
    """
    existing = db.fetchone(
        "SELECT id FROM industries WHERE slug = %s",
        (ind["slug"],),
    )

    if existing:
        industry_id = existing["id"]
        db.execute(
            "UPDATE industries SET name = %s, slug = %s, description = %s, color = %s "
            "WHERE id = %s",
            (ind["name"], ind["slug"], ind["description"], ind["color"], industry_id),
        )
        log.info(f"  updated existing industry → uuid {industry_id}")
    else:
        inserted = db.fetchone(
            "INSERT INTO industries (name, slug, description, color) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (ind["name"], ind["slug"], ind["description"], ind["color"]),
        )
        industry_id = inserted["id"]
        log.info(f"  inserted new industry → uuid {industry_id}")

    return industry_id


def replace_canonical_roles(db, industry_id: str, roles: list[dict]) -> int:
    """
    Delete all canonical_roles for this industry, then insert fresh ones.
    Returns count inserted.
    """
    # 1. Clear existing
    db.execute(
        "DELETE FROM canonical_roles WHERE industry_id = %s",
        (industry_id,),
    )
    log.info("  cleared existing canonical_roles for this industry")

    # 2. Build insert rows.
    # Note: the live DB's CHECK constraint may not yet include 'sometimes'.
    # If the user hasn't run the updated schema.sql, we fall back to NULL
    # so the row still inserts cleanly. The JSON keeps 'sometimes' for the UI.
    def _normalize_degree(d):
        return d if d in ('hs', '2yr', '4yr', 'graduate') else None

    # DB stores skills as TEXT[] (canonical_roles.skills). The JSON may now
    # carry skills as [{name, description}, ...] objects — flatten to names
    # for DB ingestion so the matcher (which keys off skill names) is unaffected.
    def _flatten_skills(skills):
        if not skills:
            return []
        first = skills[0]
        if isinstance(first, str):
            return skills
        return [s.get("name", "") for s in skills if s.get("name")]

    rows = [
        (
            industry_id,
            role["title"],
            role["cluster"],
            role["seniority"],
            role["salary_min"],
            role["salary_max"],
            _normalize_degree(role["degree_required"]),
            _flatten_skills(role["skills"]),   # list -> TEXT[] natively
            role["certifications"],            # list -> TEXT[] natively
            role["description"],
        )
        for role in roles
    ]

    # 3. Bulk insert
    db.executemany(
        "INSERT INTO canonical_roles "
        "(industry_id, title, cluster, seniority, salary_min, salary_max, "
        "degree_required, skills, certifications, description) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        rows,
    )
    log.info(f"  inserted {len(rows)} canonical_roles")

    return len(rows)


def replace_pathways(db, industry_id: str, data: dict) -> int:
    """
    Phase 4 — seed pathways for this industry.

    Translation: each pathway's role_ids in the JSON are static IDs like
    'am-r-01'. The DB stores UUIDs. We translate via the role's title, which
    is the natural cross-reference (titles are unique within an industry).

    Idempotent — clears existing pathways for this industry, then inserts fresh.
    """
    # 1. Clear existing pathways
    db.execute("DELETE FROM pathways WHERE industry_id = %s", (industry_id,))
    log.info("  cleared existing pathways for this industry")

    pathways = data.get("pathways", [])
    if not pathways:
        log.info("  no pathways in JSON — skipping")
        return 0

    # 2. Build the JSON-role-id → title map (from the JSON we're seeding)
    json_id_to_title: dict[str, str] = {}
    for role in data.get("roles", []):
        jid = role.get("id")
        title = role.get("title")
        if jid and title:
            json_id_to_title[jid] = title

    # 3. Pull the DB title → UUID map we just inserted
    db_rows = db.fetchall(
        "SELECT id, title FROM canonical_roles WHERE industry_id = %s",
        (industry_id,),
    )
    title_to_uuid: dict[str, str] = {}
    for r in db_rows:
        if r.get("title") and r.get("id"):
            title_to_uuid[r["title"].lower().strip()] = r["id"]

    # 4. Build pathway rows with translated role_ids
    pathway_rows = []
    for pw in pathways:
        translated_uuids: list = []
        for jid in pw.get("role_ids", []):
            title = json_id_to_title.get(jid)
            if not title:
                continue
            uuid_ = title_to_uuid.get(title.lower().strip())
            if uuid_:
                translated_uuids.append(uuid_)
        # Skip pathways whose entire role list dropped (no matches at all)
        if not translated_uuids:
            log.warning(f"  pathway {pw.get('name')!r} has no resolvable roles — skipped")
            continue
        pathway_rows.append((
            industry_id,
            pw.get("name", ""),
            pw.get("description", ""),
            translated_uuids,   # list of UUIDs -> UUID[] column
        ))

    if not pathway_rows:
        log.info("  no pathways translated successfully — none inserted")
        return 0

    db.executemany(
        "INSERT INTO pathways (industry_id, name, description, role_ids) "
        "VALUES (%s, %s, %s, %s::uuid[])",  # explicit cast: role_ids is UUID[]
        pathway_rows,
    )
    log.info(f"  inserted {len(pathway_rows)} pathways")
    return len(pathway_rows)


def seed_industry(db, data: dict) -> int:
    ind = data["industry"]
    log.info(f"Seeding industry: {ind['name']}")
    industry_id = upsert_industry(db, ind)
    role_count    = replace_canonical_roles(db, industry_id, data["roles"])
    pathway_count = replace_pathways(db, industry_id, data)
    log.info(f"  {ind['name']}: {role_count} roles + {pathway_count} pathways seeded")
    return role_count


def main() -> int:
    database_url = os.environ.get("DATABASE_URL")

    if not database_url:
        log.error("Missing DATABASE_URL.")
        log.error("In GitHub Actions: set as a repository secret.")
        log.error("Locally: put it in apps/pipeline/.env")
        return 1

    log.info("=" * 50)
    log.info("Career Pathways — Taxonomy Seeder")
    log.info("=" * 50)

    if not verify_schema(db):
        return 1

    # Optional scope: SEED_INDUSTRIES="nuclear" (space/comma separated slugs)
    # seeds only those industries, leaving every other industry's rows and
    # job counts untouched. Blank = seed all (the original behaviour).
    only = os.environ.get("SEED_INDUSTRIES", "").replace(",", " ").split()
    files = JSON_FILES
    if only:
        files = [f for f in JSON_FILES if f[:-5] in only]
        if not files:
            log.error(f"SEED_INDUSTRIES={only} matched none of {JSON_FILES}")
            return 1
        log.info(f"SEED_INDUSTRIES set -> seeding only: {files}")

    total_roles = 0
    for filename in files:
        path = JSON_DIR / filename
        if not path.exists():
            log.error(f"File not found: {path}")
            log.error("Are you running this from apps/pipeline/ ?")
            return 1

        with open(path) as f:
            data = json.load(f)

        total_roles += seed_industry(db, data)
        log.info("")

    log.info("=" * 50)
    log.info(f"Done. {total_roles} canonical roles seeded across {len(files)} industries.")
    log.info("Next: trigger the 'Weekly ingestion pipeline' workflow in GitHub Actions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
