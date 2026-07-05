import { isAdminAuthed } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limit';

/**
 * GET /api/admin/matches?status=<pending|approved|rejected>&page=<n>
 *
 * Returns one page of role_matches in the requested status (default
 * pending), plus per-status counts so the admin UI can show totals on
 * every tab — not just the active one.
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

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return Response.json(
      { error: 'Database not connected. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? 'pending';
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
  const limit  = 20;

  // Fetch the active-tab page AND counts for all three buckets in parallel.
  // Head-only count queries are cheap; doing them every page load keeps the
  // tab badges in sync with the DB without any client-side bookkeeping.
  const [pageRes, pendingHead, approvedHead, rejectedHead] = await Promise.all([
    supabase
      .from('role_matches')
      .select(`
        id,
        confidence,
        status,
        created_at,
        extracted_jobs (
          normalized_title,
          skills,
          seniority,
          location,
          raw_jobs ( company, raw_title, url, source )
        ),
        canonical_roles (
          id,
          title,
          cluster,
          seniority,
          salary_min,
          salary_max
        )
      `, { count: 'exact' })
      .eq('status', status)
      .order('confidence', { ascending: false })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1),
    supabase.from('role_matches').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('role_matches').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('role_matches').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
  ]);

  if (pageRes.error) {
    console.error('[admin/matches]', pageRes.error);
    return Response.json({ error: pageRes.error.message }, { status: 500 });
  }

  return Response.json({
    matches: pageRes.data,
    total:   pageRes.count,
    page,
    limit,
    counts: {
      pending:  pendingHead.count  ?? 0,
      approved: approvedHead.count ?? 0,
      rejected: rejectedHead.count ?? 0,
    },
  });
}
