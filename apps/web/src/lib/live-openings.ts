import { getPool, query } from './db';

/**
 * Live-openings digest for dolphIQ.
 *
 * Aggregates approved role_matches → extracted_jobs → raw_jobs into one
 * compact per-role summary (count, companies, top locations) and renders
 * it as a text block for the chat system prompt. This is what lets the
 * agent answer "how many openings does X have, and where are they?"
 *
 * Fail-soft by design: any error returns '' so chat keeps working on the
 * static taxonomy alone (same graceful degradation as the rest of the app).
 * Cached in-memory for 60s per industry, like /api/jobs/counts.
 */

interface RoleOpenings {
  count: number;
  usCount: number;
  companies: Map<string, number>;
  locations: Map<string, number>;
}

// Scraper noise that isn't a place: "2 additional locations", "Multiple Locations"…
const JUNK_LOCATION = /additional location|multiple location|various|see posting/i;

// Scraper slugs → display names (slugs come from apps/pipeline/companies.json)
const COMPANY_NAMES: Record<string, string> = {
  carbon: 'Carbon', markforged: 'Markforged', xometry: 'Xometry', fictiv: 'Fictiv',
  seurat: 'Seurat', protolabs: 'Protolabs', hp: 'HP',
  tenstorrent: 'Tenstorrent', intel: 'Intel', nvidia: 'NVIDIA', micron: 'Micron',
  appliedmaterials: 'Applied Materials',
  planetlabs: 'Planet Labs', astranis: 'Astranis', rocketlab: 'Rocket Lab',
  andurilindustries: 'Anduril Industries', dawnaerospace: 'Dawn Aerospace',
  momentus: 'Momentus', blueorigin: 'Blue Origin', boeing: 'Boeing', leidos: 'Leidos',
};
const companyName = (slug: string) => COMPANY_NAMES[slug.toLowerCase()] ?? slug;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; block: string }>();

function top(map: Map<string, number>, n: number): string[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/**
 * @param staticRoles the industry's taxonomy roles from the JSON files -
 *   used to translate DB rows back to static role IDs (e.g. "sp-r-01")
 *   so the agent's citations linkify. Titles are the join key: the seeder
 *   does not preserve JSON IDs in the database.
 */
export async function getLiveOpeningsBlock(
  industrySlug: string,
  staticRoles: Array<{ id: string; title: string }>,
): Promise<string> {
  const hit = cache.get(industrySlug);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.block;

  if (!getPool()) return '';

  try {
    const indRows = await query<{ id: string }>(
      `SELECT id FROM industries WHERE slug = $1 LIMIT 1`,
      [industrySlug],
    );
    const industryId = indRows[0]?.id;
    if (!industryId) return '';

    // Every approved match in this industry, joined to its posting's
    // location/company. Direct SQL has no 1000-row cap, so one query
    // returns the full set (and the industry filter is in the JOIN).
    const rows = await query<{
      canonical_role_id: string;
      title: string | null;
      location: string | null;
      country: string | null;
      company: string | null;
    }>(
      `SELECT rm.canonical_role_id, cr.title, ej.location, ej.country, rj.company
         FROM role_matches    rm
         JOIN canonical_roles cr ON cr.id = rm.canonical_role_id
         JOIN extracted_jobs  ej ON ej.id = rm.extracted_job_id
         JOIN raw_jobs        rj ON rj.id = ej.raw_job_id
        WHERE cr.industry_id = $1 AND rm.status = 'approved'`,
      [industryId],
    );
    if (rows.length === 0) return '';

    const titleById = new Map<string, string>();
    const byRole = new Map<string, RoleOpenings>();
    for (const m of rows) {
      titleById.set(m.canonical_role_id, m.title || '');
      let agg = byRole.get(m.canonical_role_id);
      if (!agg) { agg = { count: 0, usCount: 0, companies: new Map(), locations: new Map() }; byRole.set(m.canonical_role_id, agg); }
      agg.count++;
      if (m.country === 'US') agg.usCount++;
      const company = companyName((m.company || '').trim());
      if (company) agg.companies.set(company, (agg.companies.get(company) || 0) + 1);
      const loc = (m.location || '').trim();
      if (loc && loc !== 'XX' && !JUNK_LOCATION.test(loc)) agg.locations.set(loc, (agg.locations.get(loc) || 0) + 1);
    }

    if (byRole.size === 0) return '';

    const staticIdByTitle = new Map(staticRoles.map(r => [r.title.toLowerCase().trim(), r.id]));

    const lines = [...byRole.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([roleId, agg]) => {
        const title = titleById.get(roleId) || '';
        const staticId = staticIdByTitle.get(title.toLowerCase().trim());
        const companies = top(agg.companies, 4).join(', ');
        const locations = top(agg.locations, 3).join('; ');
        const counts = agg.usCount === agg.count
          ? `${agg.count} US opening${agg.count === 1 ? '' : 's'}`
          : `${agg.count} openings (${agg.usCount} US, ${agg.count - agg.usCount} international)`;
        return `${staticId ? `[${staticId}] ` : ''}${title}: ${counts}` +
          (companies ? ` - hiring: ${companies}` : '') +
          (locations ? ` - top locations: ${locations}` : '');
      });

    const block =
      `=== LIVE JOB OPENINGS (refreshed weekly from 21 company job boards; approved matches only) ===\n` +
      `Note: the map's amber badges show US-only counts, so quote the US number when comparing to the map.\n` +
      lines.join('\n');
    cache.set(industrySlug, { at: Date.now(), block });
    return block;
  } catch {
    return '';
  }
}
