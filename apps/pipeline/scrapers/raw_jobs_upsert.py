"""
Shared raw_jobs upsert used by all four scrapers (greenhouse, lever, ashby,
workday).

Replaces the old Supabase `.upsert(batch, on_conflict="url",
ignore_duplicates=True)` call with a direct Postgres
`INSERT ... ON CONFLICT (url) DO NOTHING`. Rows that collide on the unique
`url` are skipped, so the returned count is the number of brand-new rows
inserted — exactly what `ignore_duplicates=True` used to report via
`len(result.data)`.

Batching is kept (UPSERT_BATCH_SIZE) to bound per-batch transaction size; each
batch is atomic (executemany in one transaction) and a failed batch is logged
and skipped so the rest of the company's jobs still load.
"""

import logging

log = logging.getLogger(__name__)

UPSERT_BATCH_SIZE = 50

_INSERT_SQL = (
    "INSERT INTO raw_jobs "
    "(source, company, raw_title, raw_description, url, industry, scraped_at) "
    "VALUES (%s, %s, %s, %s, %s, %s, %s) "
    "ON CONFLICT (url) DO NOTHING"
)


def _row_params(row: dict) -> tuple:
    return (
        row["source"], row["company"], row["raw_title"], row["raw_description"],
        row["url"], row["industry"], row["scraped_at"],
    )


def batch_upsert(db, rows: list[dict], company_slug: str, batch_size: int = UPSERT_BATCH_SIZE) -> int:
    """Insert rows into raw_jobs in batches, skipping URL conflicts. Returns the
    number of brand-new rows inserted."""
    if not rows:
        return 0
    inserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        try:
            inserted += db.executemany(_INSERT_SQL, [_row_params(r) for r in batch])
        except Exception as e:
            log.error(f"Batch upsert failed for {company_slug} (rows {i}-{i+len(batch)}): {e}")
    return inserted
