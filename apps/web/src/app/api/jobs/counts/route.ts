/**
 * GET /api/jobs/counts?industry=<slug>&country=US
 *
 * Returns live open-job counts and hiring-company lists per canonical role
 * for a given industry, filtered by location.
 *
 * Query params:
 *   industry  (required) - industry slug, e.g. "additive-manufacturing"
 *   country   (optional, default "US") - one of:
 *                "US"           - only US jobs (cached fast path)
 *                "worldwide"    - every approved job regardless of country
 *                "US,GB,CA"     - comma-separated ISO codes
 *
 * Mapping: roles keyed by lowercased title - the website's static JSON IDs
 * are NOT preserved through the seeder, so title is the join key.
 *
 * Fast path (country=US):
 *   Read canonical_roles.open_jobs_count + .hiring_companies directly.
 *   These are kept current by the matcher (Phase 3.2) as a US-only cache.
 *
 * Slow path (country=worldwide or specific list ≠ US):
 *   Live aggregate from role_matches → extracted_jobs → raw_jobs.
 *   Counts and companies are computed at query time.
 *
 * Cache: 60s in-memory per (industry, countryFilter) combo.
 */

import { getPool, query } from '@/lib/db';

interface RoleCount {
  count:     number;
  companies: string[];
}

type CountsByTitle = Record<string, RoleCount>;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: CountsByTitle }>();

function parseCountryParam(raw: string | null): {
  mode: 'us-cached' | 'worldwide' | 'list';
  list: string[];
} {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.toUpperCase() === 'US') {
    return { mode: 'us-cached', list: ['US'] };
  }
  if (trimmed.toLowerCase() === 'worldwide') {
    return { mode: 'worldwide', list: [] };
  }
  // Comma list - uppercase, dedupe, keep only 2-letter codes (or 'XX')
  const list = Array.from(new Set(
    trimmed.split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => /^[A-Z]{2}$/.test(s)),
  ));
  if (list.length === 1 && list[0] === 'US') {
    return { mode: 'us-cached', list: ['US'] };
  }
  return { mode: 'list', list };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const industrySlug = (searchParams.get('industry') ?? '').trim();
  if (!industrySlug) {
    return Response.json({}, { status: 400 });
  }

  const filter = parseCountryParam(searchParams.get('country'));
  const cacheKey = `${industrySlug}::${filter.mode}::${filter.list.join(',')}`;

  // ── Cache hit?
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Response.json(hit.data, { headers: { 'X-Cache': 'HIT' } });
  }

  if (!getPool()) {
    return Response.json({}, { headers: { 'X-Cache': 'BYPASS-NO-DB' } });
  }

  try {
    const industryRows = await query<{ id: string }>(
      `SELECT id FROM industries WHERE slug = $1 LIMIT 1`,
      [industrySlug],
    );
    const industryId = industryRows[0]?.id;
    if (!industryId) {
      return Response.json({});
    }

    const out: CountsByTitle = {};

    if (filter.mode === 'us-cached') {
      // Fast path: use cached US-only counts written by the matcher.
      const roles = await query<{
        title: string | null;
        open_jobs_count: number | null;
        hiring_companies: string[] | null;
      }>(
        `SELECT title, open_jobs_count, hiring_companies
           FROM canonical_roles
          WHERE industry_id = $1`,
        [industryId],
      );

      for (const r of roles) {
        const title = (r.title ?? '').toLowerCase().trim();
        if (!title) continue;
        out[title] = {
          count:     r.open_jobs_count ?? 0,
          companies: r.hiring_companies ?? [],
        };
      }
    } else {
      // Slow path: live aggregation across approved matches, country-filtered.
      // Direct SQL has no 1000-row cap, so one JOIN returns every approved
      // match for the industry; filtering/bucketing happens in memory to
      // preserve the exact prior semantics (country filter, company set).
      const rows = await query<{
        title: string | null;
        country: string | null;
        company: string | null;
      }>(
        `SELECT cr.title, ej.country, rj.company
           FROM role_matches    rm
           JOIN canonical_roles cr ON cr.id = rm.canonical_role_id
           JOIN extracted_jobs  ej ON ej.id = rm.extracted_job_id
           JOIN raw_jobs        rj ON rj.id = ej.raw_job_id
          WHERE cr.industry_id = $1 AND rm.status = 'approved'`,
        [industryId],
      );

      type Bucket = { count: number; companies: Set<string> };
      const byTitle = new Map<string, Bucket>();
      const wantedCountries = filter.mode === 'list' ? new Set(filter.list) : null;

      for (const m of rows) {
        const title = (m.title ?? '').toLowerCase().trim();
        if (!title) continue;
        const country = (m.country || 'XX').toUpperCase();
        if (wantedCountries && !wantedCountries.has(country)) continue;

        const bucket = byTitle.get(title) ?? { count: 0, companies: new Set<string>() };
        bucket.count += 1;
        const company = (m.company || '').trim();
        if (company) bucket.companies.add(company);
        byTitle.set(title, bucket);
      }

      for (const [title, bucket] of byTitle) {
        out[title] = { count: bucket.count, companies: Array.from(bucket.companies) };
      }
    }

    cache.set(cacheKey, { at: Date.now(), data: out });
    return Response.json(out, { headers: { 'X-Cache': 'MISS' } });
  } catch (err) {
    console.warn('[api/jobs/counts] DB error:', (err as Error)?.message);
    return Response.json({}, { headers: { 'X-Cache': 'ERROR' } });
  }
}
