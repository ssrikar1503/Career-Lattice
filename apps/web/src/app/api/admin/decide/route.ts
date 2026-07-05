import { isAdminAuthed } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { checkRateLimit, getClientIp, LIMITS } from '@/lib/rate-limit';

/**
 * POST /api/admin/decide  { matchId, decision: 'approved' | 'rejected' }
 *
 * Transition-aware: compares the match's CURRENT status to the requested
 * decision and only touches the cached US count when the (was-approved →
 * will-be-approved) bit actually flips. Same-status clicks are no-ops on
 * the count, eliminating the historical double-count bug.
 *
 * Count rules (only applied when extracted_jobs.country = 'US'):
 *   • pending/rejected → approved   →  open_jobs_count += 1, append company
 *   • approved → pending/rejected   →  open_jobs_count -= 1 (clamped at 0)
 *   • same status → no count change (still writes the audit row)
 *
 * Company list is APPEND-ONLY on demote — once a company has hired for a
 * role we leave it in hiring_companies even if the specific match is
 * demoted. The worldwide view live-queries role_matches anyway; only the
 * US-cached fast path consumes this list, and stale entries there are
 * harmless (one extra name in a hover tooltip).
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthed())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rl = checkRateLimit(`admin:${getClientIp(request)}`, LIMITS.admin);
  if (!rl.allowed) {
    return Response.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { matchId, decision } = await request.json().catch(() => ({}));

  if (!matchId || !['approved', 'rejected'].includes(decision)) {
    return Response.json({ error: 'Invalid matchId or decision' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return Response.json(
      { error: 'Database not connected' },
      { status: 503 },
    );
  }

  // Snapshot current state BEFORE the update so we can compute the count delta.
  const { data: existing } = await supabase
    .from('role_matches')
    .select('status, canonical_role_id, extracted_jobs(country, raw_jobs(company))')
    .eq('id', matchId)
    .single();

  if (!existing) {
    return Response.json({ error: 'Match not found' }, { status: 404 });
  }

  const oldStatus = (existing as { status?: string }).status ?? '';
  const roleId    = (existing as { canonical_role_id?: string }).canonical_role_id ?? '';
  const ej = ((existing as unknown) as {
    extracted_jobs?: { country?: string; raw_jobs?: { company?: string } } | null;
  }).extracted_jobs;
  const country = (ej?.country || '').toUpperCase();
  const company = (ej?.raw_jobs?.company || '').trim();

  // Apply the status change.
  const { error: matchErr } = await supabase
    .from('role_matches')
    .update({ status: decision })
    .eq('id', matchId);

  if (matchErr) {
    return Response.json({ error: matchErr.message }, { status: 500 });
  }

  // Always record the human decision — even no-op same-status clicks, since
  // the audit log is a record of human review, not of count changes.
  await supabase.from('review_decisions').insert({
    match_id:   matchId,
    decided_by: 'admin',
    decision,
  });

  // Count math — only US jobs feed the cached open_jobs_count column.
  // Worldwide view live-aggregates from role_matches and is unaffected.
  if (!roleId || country !== 'US') {
    return Response.json({ ok: true });
  }

  const wasApproved    = oldStatus === 'approved';
  const willBeApproved = decision  === 'approved';

  // Same approval bit → no count change. Kills the historical double-count
  // bug when an admin re-clicks Approve on an already-approved row.
  if (wasApproved === willBeApproved) {
    return Response.json({ ok: true });
  }

  if (willBeApproved) {
    // Promotion: pending|rejected → approved
    await supabase.rpc('increment_job_count', { role_id: roleId });

    if (company) {
      const { data: roleRow } = await supabase
        .from('canonical_roles')
        .select('hiring_companies')
        .eq('id', roleId)
        .single();
      const current: string[] = roleRow?.hiring_companies || [];
      if (!current.includes(company)) {
        await supabase
          .from('canonical_roles')
          .update({ hiring_companies: [...current, company] })
          .eq('id', roleId);
      }
    }
  } else {
    // Demotion: approved → pending|rejected. No decrement RPC exists, so
    // read-modify-write the count with a floor of 0.
    const { data: roleRow } = await supabase
      .from('canonical_roles')
      .select('open_jobs_count')
      .eq('id', roleId)
      .single();
    const nextCount = Math.max(0, (roleRow?.open_jobs_count ?? 0) - 1);
    await supabase
      .from('canonical_roles')
      .update({ open_jobs_count: nextCount })
      .eq('id', roleId);
  }

  return Response.json({ ok: true });
}
