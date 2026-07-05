'use client';

import { useState, useEffect } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
interface RawJob   { company: string; raw_title: string; url: string; source: string; }
interface ExtJob   { normalized_title: string; skills: string[]; seniority: string; location: string; raw_jobs: RawJob; }
interface CanonRole{ id: string; title: string; cluster: string; seniority: string; salary_min: number; salary_max: number; }
interface Match    { id: string; confidence: number; status: string; created_at: string; extracted_jobs: ExtJob; canonical_roles: CanonRole; }

type Bucket = 'pending' | 'approved' | 'rejected';
type Counts = Record<Bucket, number>;

// ── Confidence badge colour ────────────────────────────────────────────────────
// Buckets here match the matcher's ACTUAL routing thresholds in matcher.py:
//   ≥ 0.80 → auto-approved
//   0.35 – 0.80 → queued for human review
//   < 0.35 → auto-rejected
function ConfBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const cls = score >= 0.80 ? 'bg-green-100 text-green-700'
            : score >= 0.35 ? 'bg-yellow-100 text-yellow-700'
            : 'bg-red-100 text-red-700';
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cls}`}>{pct}%</span>;
}

// ── Login form ─────────────────────────────────────────────────────────────────
function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [pw,  setPw]  = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr('');
    const res = await fetch('/api/admin/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password: pw }),
    });
    setLoading(false);
    if (res.ok) {
      onSuccess();
    } else {
      const { error } = await res.json();
      setErr(error ?? 'Incorrect password');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-gray-900 rounded-xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Admin access</h1>
          <p className="text-sm text-gray-500 mt-1">Job match review queue</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="Admin password"
            autoFocus
            className="border border-gray-200 rounded-xl px-4 py-3 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {err && <p className="text-xs text-red-500 text-center">{err}</p>}
          <button
            type="submit"
            disabled={!pw || loading}
            className="bg-gray-900 text-white rounded-xl py-3 text-sm font-semibold
                       hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {loading ? 'Checking…' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          Set <code className="bg-gray-100 px-1 rounded">ADMIN_PASSWORD</code> in your env file
        </p>
      </div>
    </div>
  );
}

// ── Match row ──────────────────────────────────────────────────────────────────
// `bucket` controls which action button(s) appear: each tab shows only the
// transition that actually changes the status — Pending shows both; Approved
// shows only Reject (demote); Rejected shows only Approve (rescue). This
// kills the historical double-click-on-approved bug at the UI surface.
function MatchRow({
  match, bucket, onDecide,
}: { match: Match; bucket: Bucket; onDecide: (id: string, d: 'approved' | 'rejected') => void }) {
  const job  = match.extracted_jobs;
  const raw  = job?.raw_jobs;
  const role = match.canonical_roles;
  const [deciding, setDeciding] = useState(false);

  async function decide(decision: 'approved' | 'rejected') {
    setDeciding(true);
    await onDecide(match.id, decision);
  }

  const showApprove = bucket !== 'approved';
  const showReject  = bucket !== 'rejected';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto] gap-4 items-center
                    p-5 border border-gray-200 rounded-xl bg-white hover:bg-gray-50 transition-colors">

      {/* Raw job */}
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">
          {raw?.source ?? 'scraper'} · {raw?.company}
        </p>
        <p className="text-sm font-bold text-gray-900 truncate">{raw?.raw_title ?? job?.normalized_title}</p>
        <p className="text-xs text-gray-500 mt-0.5 capitalize">{job?.seniority} · {job?.location}</p>
        {job?.skills?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {job.skills.slice(0, 4).map(s => (
              <span key={s} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{s}</span>
            ))}
            {job.skills.length > 4 && <span className="text-[10px] text-gray-400">+{job.skills.length - 4}</span>}
          </div>
        )}
        {raw?.url && (
          <a href={raw.url} target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-blue-500 hover:underline mt-1 inline-block">
            View original posting ↗
          </a>
        )}
      </div>

      {/* Confidence arrow */}
      <div className="flex flex-col items-center gap-1 px-2">
        <ConfBadge score={match.confidence} />
        <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* Proposed canonical role */}
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">
          Proposed canonical role
        </p>
        <p className="text-sm font-bold text-gray-900">{role?.title}</p>
        <p className="text-xs text-gray-500">{role?.cluster} · {role?.seniority}</p>
        {role?.salary_min && (
          <p className="text-xs text-gray-400 mt-0.5">
            ${Math.round(role.salary_min / 1000)}k–${Math.round(role.salary_max / 1000)}k
          </p>
        )}
      </div>

      {/* Approve / Reject — only the actionable transition for this tab */}
      <div className="flex gap-2 flex-shrink-0">
        {showApprove && (
          <button
            onClick={() => decide('approved')}
            disabled={deciding}
            className="px-4 py-2 rounded-xl bg-green-600 text-white text-xs font-bold
                       hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            ✓ Approve
          </button>
        )}
        {showReject && (
          <button
            onClick={() => decide('rejected')}
            disabled={deciding}
            className="px-4 py-2 rounded-xl bg-red-100 text-red-700 text-xs font-bold
                       hover:bg-red-200 disabled:opacity-40 transition-colors"
          >
            ✗ Reject
          </button>
        )}
      </div>
    </div>
  );
}

// ── Pagination controls ────────────────────────────────────────────────────────
function Pagination({
  page, total, limit, onChange,
}: { page: number; total: number; limit: number; onChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  return (
    <div className="mt-6 flex items-center justify-between text-sm text-gray-600">
      <span>
        Showing <span className="font-semibold text-gray-900">{from}–{to}</span> of{' '}
        <span className="font-semibold text-gray-900">{total}</span>
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-semibold
                     hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span className="text-xs text-gray-500">
          Page <span className="font-semibold text-gray-900">{page}</span> of{' '}
          <span className="font-semibold text-gray-900">{totalPages}</span>
        </span>
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-semibold
                     hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Main admin panel ───────────────────────────────────────────────────────────
export default function AdminClient({ isAuthed: initAuthed }: { isAuthed: boolean }) {
  const [authed,  setAuthed]  = useState(initAuthed);
  const [matches, setMatches] = useState<Match[]>([]);
  const [tab,     setTab]     = useState<Bucket>('pending');
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [total,   setTotal]   = useState(0);
  const [counts,  setCounts]  = useState<Counts>({ pending: 0, approved: 0, rejected: 0 });
  const [dbMissing, setDbMissing] = useState(false);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await fetch(`/api/admin/matches?status=${tab}&page=${page}`);
      if (cancelled) return;
      if (res.status === 503) { setDbMissing(true); setLoading(false); return; }
      if (!res.ok) { setError('Failed to load matches'); setLoading(false); return; }
      const { matches: data, total: t, counts: c } = await res.json();
      if (cancelled) return;
      setMatches(data ?? []);
      setTotal(t ?? 0);
      if (c) setCounts(c);
      setError('');
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authed, tab, page]);

  async function handleDecide(matchId: string, decision: 'approved' | 'rejected') {
    // Optimistic update: drop the row from the current view AND adjust the
    // tab badge counts so the UI stays in sync without a refetch round-trip.
    setMatches(prev => prev.filter(m => m.id !== matchId));
    setTotal(t => Math.max(0, t - 1));
    setCounts(prev => ({
      ...prev,
      [tab]:      Math.max(0, prev[tab] - 1),
      [decision]: prev[decision] + 1,
    }));

    await fetch('/api/admin/decide', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ matchId, decision }),
    });
  }

  function changeTab(next: Bucket) {
    if (next === tab) return;
    setError('');
    setPage(1);
    setTab(next);
  }

  async function handleLogout() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    setAuthed(false);
  }

  if (!authed) {
    return <LoginForm onSuccess={() => setAuthed(true)} />;
  }

  const TABS: Bucket[] = ['pending', 'approved', 'rejected'];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Job Match Review Queue</h1>
            <p className="text-xs text-gray-400">
              Review AI-generated matches between scraped jobs and canonical roles
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">

        {/* DB not connected banner */}
        {dbMissing && (
          <div className="mb-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-6">
            <h2 className="text-sm font-bold text-yellow-800 mb-2">Database not connected</h2>
            <p className="text-sm text-yellow-700 leading-relaxed">
              Supabase is not configured yet. After deploying, set these environment variables and re-run the pipeline:
            </p>
            <ul className="mt-3 text-xs font-mono text-yellow-800 space-y-1">
              <li>NEXT_PUBLIC_SUPABASE_URL</li>
              <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
              <li>SUPABASE_SERVICE_ROLE_KEY</li>
            </ul>
            <p className="text-sm text-yellow-700 mt-3">
              Once connected, the ingestion pipeline will populate this queue weekly via GitHub Actions.
            </p>
          </div>
        )}

        {/* Tabs — every tab shows its own count badge from the API response */}
        <div className="flex gap-2 mb-6">
          {TABS.map(t => {
            const active = t === tab;
            return (
              <button
                key={t}
                onClick={() => changeTab(t)}
                className={[
                  'px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-colors flex items-center gap-2',
                  active ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
                ].join(' ')}
              >
                {t}
                <span className={[
                  'px-1.5 py-0.5 rounded-full text-xs',
                  active ? 'bg-white/20' : 'bg-gray-100 text-gray-600',
                ].join(' ')}>
                  {counts[t]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Confidence legend — thresholds match matcher.py's routing rules. */}
        {tab === 'pending' && (
          <div className="flex items-center gap-4 mb-5 text-xs text-gray-500">
            <span className="font-semibold">Confidence:</span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" /> ≥80% auto-approved
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-500" /> 35–80% queued for review
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" /> &lt;35% auto-rejected
            </span>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading matches…</div>
        ) : error ? (
          <div className="text-center py-16 text-red-500">{error}</div>
        ) : matches.length === 0 && !dbMissing ? (
          <div className="text-center py-16">
            <p className="text-lg font-semibold text-gray-900 mb-2">
              No {tab} matches
            </p>
            <p className="text-sm text-gray-400">
              {tab === 'pending'
                ? 'Run the ingestion pipeline to generate new matches.'
                : `No matches have been ${tab} yet.`}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              {matches.map(match => (
                <MatchRow
                  key={match.id}
                  match={match}
                  bucket={tab}
                  onDecide={handleDecide}
                />
              ))}
            </div>
            <Pagination page={page} total={total} limit={20} onChange={setPage} />
          </>
        )}
      </main>
    </div>
  );
}
