/**
 * GET /api/jobs/counts?industry=<slug>&country=US
 *
 * Returns live open-job counts and hiring-company lists per canonical role
 * for a given industry, filtered by location.
 *
 * Query params:
 *   industry  (required) — industry slug, e.g. "additive-manufacturing"
 *   country   (optional, default "US") — one of:
 *                "US"           — only US jobs (cached fast path)
 *                "worldwide"    — every approved job regardless of country
 *                "US,GB,CA"     — comma-separated ISO codes
 *
 * Mapping: roles keyed by lowercased title — the website's static JSON IDs
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

import { getSupabaseAdmin } from '@/lib/supabase';

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
  // Comma list — uppercase, dedupe, keep only 2-letter codes (or 'XX')
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

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return Response.json({}, { headers: { 'X-Cache': 'BYPASS-NO-DB' } });
  }

  try {
    const { data: industry } = await supabase
      .from('industries')
      .select('id')
      .eq('slug', industrySlug)
      .single();

    if (!industry?.id) {
      return Response.json({});
    }

    const out: CountsByTitle = {};

    if (filter.mode === 'us-cached') {
      // Fast path: use cached US-only counts written by the matcher.
      const { data: roles } = await supabase
        .from('canonical_roles')
        .select('title, open_jobs_count, hiring_companies')
        .eq('industry_id', industry.id);

      for (const r of roles ?? []) {
        const title = (r.title ?? '').toLowerCase().trim();
        if (!title) continue;
        out[title] = {
          count:     r.open_jobs_count ?? 0,
          companies: r.hiring_companies ?? [],
        };
      }
    } else {
      // Slow path: live aggregation across role_matches with country filter.
      const { data: roles } = await supabase
        .from('canonical_roles')
        .select('id, title')
        .eq('industry_id', industry.id);

      const idToTitle = new Map<string, string>();
      for (const r of roles ?? []) {
        if (r.title) idToTitle.set(r.id, r.title.toLowerCase().trim());
      }
      if (idToTitle.size === 0) {
        return Response.json({});
      }

      // Page through role_matches — Supabase PostgREST silently caps a
      // single .limit() / unbounded select at 1000 rows. With matches growing
      // past 1000 across an industry, the worldwide count would be wrong
      // without pagination.
      const PAGE = 1000;
      const matches: Array<{
        canonical_role_id: string;
        extracted_jobs?: { country?: string; raw_jobs?: { company?: string } } | null;
      }> = [];
      const roleIdList = Array.from(idToTitle.keys());
      let offset = 0;
      while (true) {
        const { data: page } = await supabase
          .from('role_matches')
          .select('canonical_role_id, extracted_jobs(country, raw_jobs(company))')
          .eq('status', 'approved')
          .in('canonical_role_id', roleIdList)
          .range(offset, offset + PAGE - 1);
        const rows = (page ?? []) as typeof matches;
        matches.push(...rows);
        if (rows.length < PAGE) break;
        offset += PAGE;
      }

      // Aggregate
      type Bucket = { count: number; companies: Set<string> };
      const byRoleId = new Map<string, Bucket>();
      const wantedCountries = filter.mode === 'list' ? new Set(filter.list) : null;

      for (const m of matches) {
        const ej = m.extracted_jobs;
        const country = (ej?.country || 'XX').toUpperCase();
        if (wantedCountries && !wantedCountries.has(country)) continue;

        const bucket = byRoleId.get(m.canonical_role_id)
          ?? { count: 0, companies: new Set<string>() };
        bucket.count += 1;
        const company = (ej?.raw_jobs?.company || '').trim();
        if (company) bucket.companies.add(company);
        byRoleId.set(m.canonical_role_id, bucket);
      }

      for (const [roleId, bucket] of byRoleId) {
        const title = idToTitle.get(roleId);
        if (!title) continue;
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
