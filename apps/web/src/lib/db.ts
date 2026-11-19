import { Pool, type QueryResultRow } from 'pg';

/**
 * Postgres (Cloud SQL) access layer — replaces the Supabase client.
 *
 * The app connects to Cloud SQL for PostgreSQL with a plain connection
 * string in DATABASE_URL. On Cloud Run the recommended form uses the
 * Cloud SQL connector's unix socket:
 *
 *   postgresql://USER:PASSWORD@/careerlattice?host=/cloudsql/PROJECT:REGION:INSTANCE
 *
 * and over TCP (local dev, proxy) the usual:
 *
 *   postgresql://USER:PASSWORD@HOST:5432/careerlattice
 *
 * Returns null when DATABASE_URL is unset so every caller degrades
 * gracefully (same contract the old getSupabaseAdmin() had — the app
 * renders on the static taxonomy alone before the DB is wired up).
 */

// Reuse a single pool across hot-reloads / lambda invocations.
const globalForPg = globalThis as unknown as { _clPgPool?: Pool | null };

export function getPool(): Pool | null {
  if (globalForPg._clPgPool !== undefined) return globalForPg._clPgPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    globalForPg._clPgPool = null;
    return null;
  }

  const pool = new Pool({
    connectionString,
    max: 5,                       // Cloud Run instances are small; keep it modest
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Cloud SQL public IP requires SSL; the unix-socket form ignores this.
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', err => console.error('[db] idle client error:', err.message));

  globalForPg._clPgPool = pool;
  return pool;
}

/** True when a database connection is configured. */
export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Run a parameterized query and return the rows. Throws if DATABASE_URL is
 * unset — callers that want graceful degradation should guard with getPool()
 * (or isDbConfigured()) first, exactly like the old `if (!supabase) return`.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const pool = getPool();
  if (!pool) throw new Error('DATABASE_URL is not set');
  const res = await pool.query<T>(text, params as never[]);
  return res.rows;
}

/** Convenience: first row or null. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
