"""
Database access layer — Cloud SQL for PostgreSQL via psycopg (v3).
==================================================================
Replaces the old Supabase Python client. Everything reads a single
connection string from the DATABASE_URL environment variable (a standard
libpq / psycopg connection string), e.g.

    postgresql://user:pass@host:5432/careerlattice

or the Cloud SQL Unix-socket form used from Cloud Run / GitHub Actions with
the Cloud SQL Auth proxy:

    postgresql://user:pass@/careerlattice?host=/cloudsql/PROJECT:REGION:INSTANCE

Design notes
------------
* `get_conn()` opens a fresh psycopg.Connection (one per call). Connections are
  cheap here and a fresh connection recovers cleanly from a dropped socket,
  which is what the matcher's transient-error retry loop relies on.
* `row_factory=dict_row` so every query returns dict rows — call sites keep
  using `row["column"]` exactly like they did with the Supabase client.
* `autocommit=True` by default: each helper call is its own committed
  statement, mirroring the one-HTTP-request-per-call behaviour of the old
  client. `executemany()` instead runs the whole sequence in one transaction
  (all-or-nothing) so a failed batch rolls back and the caller can fall back
  to per-row inserts.
* Array columns (TEXT[]): pass Python lists directly — psycopg adapts
  list <-> text[] natively. (UUID[] columns need an explicit `%s::uuid[]`
  cast at the call site.)
* Always use parameterized queries (`%s`) — never string-interpolate values.
"""

import os

import psycopg
from psycopg.rows import dict_row


def _dsn() -> str:
    """Read DATABASE_URL at call time (so load_dotenv() can run first)."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL is not set. Point it at the Cloud SQL Postgres "
            "database, e.g. postgresql://user:pass@host:5432/careerlattice"
        )
    return dsn


def get_conn(autocommit: bool = True) -> psycopg.Connection:
    """
    Open a new psycopg (v3) connection to DATABASE_URL with dict rows.

    autocommit=True (default) is fine for the pipeline's single-statement
    helpers. Pass autocommit=False when you need an explicit transaction
    (see `executemany`). The returned connection is a normal context manager:
    `with get_conn() as conn: ...` commits (or rolls back on error) and closes
    it at the end of the block.
    """
    return psycopg.connect(_dsn(), row_factory=dict_row, autocommit=autocommit)


def fetchall(sql: str, params=None) -> list[dict]:
    """Run a SELECT and return all rows as a list of dicts."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def fetchone(sql: str, params=None) -> dict | None:
    """Run a query and return the first row as a dict, or None.

    Works for `INSERT ... RETURNING` / `SELECT fn(...)` as well as plain
    SELECTs.
    """
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()


def execute(sql: str, params=None) -> int:
    """Run a single write (INSERT/UPDATE/DELETE/SELECT fn()) and return the
    number of rows affected (cur.rowcount)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount


def executemany(sql: str, params_seq) -> int:
    """Run `sql` once per parameter tuple inside a SINGLE transaction
    (all-or-nothing) and return the total rows affected.

    Used for batch inserts/upserts. If any row raises, the whole batch is
    rolled back and the exception propagates so the caller can fall back to
    per-row inserts. With `ON CONFLICT ... DO NOTHING`, skipped (conflicting)
    rows are not counted in the returned total — so the return value is the
    number of brand-new rows, matching the old upsert's inserted-row count.
    """
    params_seq = list(params_seq)
    if not params_seq:
        return 0
    conn = get_conn(autocommit=False)
    try:
        with conn.cursor() as cur:
            cur.executemany(sql, params_seq)
            affected = cur.rowcount
        conn.commit()
        return affected
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
