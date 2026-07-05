"""
Taxonomy Seeder — PHASE_B of deployment.
==========================================
One-time script that uploads the JSON taxonomies (36 AM + ~45 Semi + 38 Space roles)
into the Supabase database so the pipeline has something to match jobs against.

Idempotent: safe to run multiple times. For each industry, it:
  1. Inserts the industry row if missing, else updates it
  2. Deletes existing canonical_roles for that industry
  3. Re-inserts all roles fresh

Note: re-running this resets canonical_roles.open_jobs_count to 0. The next
pipeline run will repopulate counts. For v1 this is acceptable.

We deliberately avoid PostgREST's `upsert` because supabase-py 2.30 + PostgREST 13
return a confusing PGRST125 ("Invalid path") error on conflict-target params.
Explicit select-then-insert/update is more code but works on any version.

Usage (in GitHub Actions):
    Triggered manually via the "Seed taxonomy data" workflow.

Usage (locally):
    cd apps/pipeline
    cp .env.example .env      # then fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
    pip install -r requirements.txt
    python seed_taxonomy.py
"""

import json
import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("seeder")

JSON_DIR   = Path(__file__).parent.parent / "web" / "src" / "data"
JSON_FILES = ["additive-manufacturing.json", "semiconductors.json", "space.json"]


def verify_schema(supabase: Client) -> bool:
    """
    Ensure required tables exist before we try to seed anything.
    Gives a much clearer error than the deep PostgREST stack trace
    if the user forgot to run schema.sql.
    """
    required = ["industries", "canonical_roles"]
    for table in required:
        try:
            supabase.table(table).select("id").limit(1).execute()
        except Exception as e:
            log.error(f"Table '{table}' is not accessible: {e}")
            log.error("")
            log.error("Likely cause: schema.sql has not been run in this Supabase project.")
            log.error("Fix:")
            log.error("  1. Open your Supabase project → SQL Editor")
            log.error("  2. New query → paste the entire contents of /schema.sql")
            log.error("  3. Click 'Run' — wait for 'Success'")
            log.error("  4. Re-run this seeder workflow")
            return False
    log.info(f"Schema verified: all {len(required)} required tables present")
    return True


def upsert_industry(supabase: Client, ind: dict) -> str:
    """
    Insert industry row or update existing one matched by slug.
    Returns the industry UUID (whether newly created or pre-existing).
    """
    row = {
        "name":        ind["name"],
        "slug":        ind["slug"],
        "description": ind["description"],
        "color":       ind["color"],
    }

    existing = (
        supabase.table("industries")
        .select("id")
        .eq("slug", ind["slug"])
        .execute()
    )

    if existing.data:
        industry_id = existing.data[0]["id"]
        (
            supabase.table("industries")
            .update(row)
            .eq("id", industry_id)
            .execute()
        )
        log.info(f"  updated existing industry → uuid {industry_id}")
    else:
        result = supabase.table("industries").insert(row).execute()
        industry_id = result.data[0]["id"]
        log.info(f"  inserted new industry → uuid {industry_id}")

    return industry_id


def replace_canonical_roles(supabase: Client, industry_id: str, roles: list[dict]) -> int:
    """
    Delete all canonical_roles for this industry, then insert fresh ones.
    Returns count inserted.
    """
    # 1. Clear existing
    (
        supabase.table("canonical_roles")
        .delete()
        .eq("industry_id", industry_id)
        .execute()
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
        {
            "industry_id":     industry_id,
            "title":           role["title"],
            "cluster":         role["cluster"],
            "seniority":       role["seniority"],
            "salary_min":      role["salary_min"],
            "salary_max":      role["salary_max"],
            "degree_required": _normalize_degree(role["degree_required"]),
            "skills":          _flatten_skills(role["skills"]),
            "certifications":  role["certifications"],
            "description":     role["description"],
        }
        for role in roles
    ]

    # 3. Bulk insert
    supabase.table("canonical_roles").insert(rows).execute()
    log.info(f"  inserted {len(rows)} canonical_roles")

    return len(rows)


def replace_pathways(supabase: Client, industry_id: str, data: dict) -> int:
    """
    Phase 4 — seed pathways for this industry.

    Translation: each pathway's role_ids in the JSON are static IDs like
    'am-r-01'. The DB stores UUIDs. We translate via the role's title, which
    is the natural cross-reference (titles are unique within an industry).

    Idempotent — clears existing pathways for this industry, then inserts fresh.
    """
    # 1. Clear existing pathways
    supabase.table("pathways").delete().eq("industry_id", industry_id).execute()
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
    db_rows = (
        supabase.table("canonical_roles")
        .select("id, title")
        .eq("industry_id", industry_id)
        .execute()
    )
    title_to_uuid: dict[str, str] = {}
    for r in (db_rows.data or []):
        if r.get("title") and r.get("id"):
            title_to_uuid[r["title"].lower().strip()] = r["id"]

    # 4. Build pathway rows with translated role_ids
    pathway_rows = []
    for pw in pathways:
        translated_uuids: list[str] = []
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
        pathway_rows.append({
            "industry_id": industry_id,
            "name":        pw.get("name", ""),
            "description": pw.get("description", ""),
            "role_ids":    translated_uuids,
        })

    if not pathway_rows:
        log.info("  no pathways translated successfully — none inserted")
        return 0

    supabase.table("pathways").insert(pathway_rows).execute()
    log.info(f"  inserted {len(pathway_rows)} pathways")
    return len(pathway_rows)


def seed_industry(supabase: Client, data: dict) -> int:
    ind = data["industry"]
    log.info(f"Seeding industry: {ind['name']}")
    industry_id = upsert_industry(supabase, ind)
    role_count    = replace_canonical_roles(supabase, industry_id, data["roles"])
    pathway_count = replace_pathways(supabase, industry_id, data)
    log.info(f"  {ind['name']}: {role_count} roles + {pathway_count} pathways seeded")
    return role_count


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        log.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
        log.error("In GitHub Actions: set as repository secrets.")
        log.error("Locally: put them in apps/pipeline/.env")
        return 1

    supabase = create_client(url, key)

    log.info("=" * 50)
    log.info("Career Pathways — Taxonomy Seeder")
    log.info("=" * 50)

    if not verify_schema(supabase):
        return 1

    total_roles = 0
    for filename in JSON_FILES:
        path = JSON_DIR / filename
        if not path.exists():
            log.error(f"File not found: {path}")
            log.error("Are you running this from apps/pipeline/ ?")
            return 1

        with open(path) as f:
            data = json.load(f)

        total_roles += seed_industry(supabase, data)
        log.info("")

    log.info("=" * 50)
    log.info(f"Done. {total_roles} canonical roles seeded across {len(JSON_FILES)} industries.")
    log.info("Next: trigger the 'Weekly ingestion pipeline' workflow in GitHub Actions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
