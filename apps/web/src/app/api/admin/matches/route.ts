import { isAdminAuthed } from '@/lib/admin-auth';
import { getPool, query } from '@/lib/db';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limit';

/**
 * GET /api/admin/matches?status=<pending|approved|rejected>&page=<n>
 *
 * Returns one page of role_matches in the requested status (default
 * pending), plus per-status counts so the admin UI can show totals on
 * every tab - not just the active one.
 *
 * Page size is 20. Pagination is 1-indexed in the query string and
 * 0-indexed for the Supabase .range() call.
 */
export async function GET(request: Request) {
  if (!(await isAdminAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rl = checkRateLimit(`admin:${getClientIp(request)}`, LIMITS.admin);
  if (!rl.allowed) {
    return Response.json({ error: 'Too many requests, slow down' }, { status: 429 });
  }

  if (!getPool()) {
    return Response.json(
      { error: 'Database not connected. Set DATABASE_URL.' },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? 'pending';
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
  const limit  = 20;

  try {
    type Row = {
      id: string;
      confidence: string | number | null;
      status: string;
      created_at: Date | string;
      normalized_title: string | null;
      ej_skills: string[] | null;
      ej_seniority: string | null;
      location: string | null;
      company: string | null;
      raw_title: string | null;
      url: string | null;
      source: string | null;
      cr_id: string | null;
      cr_title: string | null;
      cr_cluster: string | null;
      cr_seniority: string | null;
      salary_min: number | null;
      salary_max: number | null;
    };

    // Active-tab page (joined to its posting + canonical role) AND the
    // per-status totals, in two queries. FKs guarantee the joined rows exist.
    const [rows, countRows] = await Promise.all([
      query<Row>(
        `SELECT rm.id, rm.confidence, rm.status, rm.created_at,
                ej.normalized_title,
                ej.skills     AS ej_skills,
                ej.seniority  AS ej_seniority,
                ej.location,
                rj.company, rj.raw_title, rj.url, rj.source,
                cr.id         AS cr_id,
                cr.title      AS cr_title,
                cr.cluster    AS cr_cluster,
                cr.seniority  AS cr_seniority,
                cr.salary_min, cr.salary_max
           FROM role_matches         rm
           LEFT JOIN extracted_jobs  ej ON ej.id = rm.extracted_job_id
           LEFT JOIN raw_jobs        rj ON rj.id = ej.raw_job_id
           LEFT JOIN canonical_roles cr ON cr.id = rm.canonical_role_id
          WHERE rm.status = $1
          ORDER BY rm.confidence DESC, rm.created_at DESC
          LIMIT $2 OFFSET $3`,
        [status, limit, (page - 1) * limit],
      ),
      query<{ status: string; n: number }>(
        `SELECT status, COUNT(*)::int AS n
           FROM role_matches
          WHERE status IN ('pending', 'approved', 'rejected')
          GROUP BY status`,
      ),
    ]);

    const counts: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const c of countRows) counts[c.status] = c.n;

    // Reshape flat rows into the nested shape the admin UI expects (the same
    // structure Supabase's embedded selects returned).
    const matches = rows.map(r => ({
      id:         r.id,
      confidence: r.confidence != null ? Number(r.confidence) : null,
      status:     r.status,
      created_at: r.created_at,
      extracted_jobs: {
        normalized_title: r.normalized_title,
        skills:           r.ej_skills ?? [],
        seniority:        r.ej_seniority,
        location:         r.location,
        raw_jobs: {
          company:   r.company,
          raw_title: r.raw_title,
          url:       r.url,
          source:    r.source,
        },
      },
      canonical_roles: {
        id:         r.cr_id,
        title:      r.cr_title,
        cluster:    r.cr_cluster,
        seniority:  r.cr_seniority,
        salary_min: r.salary_min,
        salary_max: r.salary_max,
      },
    }));

    return Response.json({
      matches,
      total: counts[status] ?? 0,
      page,
      limit,
      counts: {
        pending:  counts.pending  ?? 0,
        approved: counts.approved ?? 0,
        rejected: counts.rejected ?? 0,
      },
    });
  } catch (err) {
    console.error('[admin/matches]', err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
