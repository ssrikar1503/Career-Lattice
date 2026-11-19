import { isAdminAuthed } from '@/lib/admin-auth';
import { getPool, query, queryOne } from '@/lib/db';
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
 * Company list is APPEND-ONLY on demote - once a company has hired for a
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

  if (!getPool()) {
    return Response.json(
      { error: 'Database not connected' },
      { status: 503 },
    );
  }

  try {
    // Snapshot current state BEFORE the update so we can compute the count delta.
    const existing = await queryOne<{
      status: string | null;
      canonical_role_id: string | null;
      country: string | null;
      company: string | null;
    }>(
      `SELECT rm.status, rm.canonical_role_id, ej.country, rj.company
         FROM role_matches        rm
         LEFT JOIN extracted_jobs ej ON ej.id = rm.extracted_job_id
         LEFT JOIN raw_jobs       rj ON rj.id = ej.raw_job_id
        WHERE rm.id = $1`,
      [matchId],
    );

    if (!existing) {
      return Response.json({ error: 'Match not found' }, { status: 404 });
    }

    const oldStatus = existing.status ?? '';
    const roleId    = existing.canonical_role_id ?? '';
    const country   = (existing.country || '').toUpperCase();
    const company   = (existing.company || '').trim();

    // Apply the status change.
    await query(`UPDATE role_matches SET status = $1 WHERE id = $2`, [decision, matchId]);

    // Always record the human decision - even no-op same-status clicks, since
    // the audit log is a record of human review, not of count changes.
    await query(
      `INSERT INTO review_decisions (match_id, decided_by, decision)
       VALUES ($1, $2, $3)`,
      [matchId, 'admin', decision],
    );

    // Count math - only US jobs feed the cached open_jobs_count column.
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
      await query(`SELECT increment_job_count($1)`, [roleId]);

      if (company) {
        // Append the company only if not already present (atomic, append-only).
        await query(
          `UPDATE canonical_roles
              SET hiring_companies = array_append(hiring_companies, $2)
            WHERE id = $1 AND NOT ($2 = ANY(hiring_companies))`,
          [roleId, company],
        );
      }
    } else {
      // Demotion: approved → pending|rejected. Decrement with a floor of 0.
      await query(
        `UPDATE canonical_roles
            SET open_jobs_count = GREATEST(0, open_jobs_count - 1)
          WHERE id = $1`,
        [roleId],
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
