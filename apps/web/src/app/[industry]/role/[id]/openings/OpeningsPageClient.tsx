'use client';

import { useMemo, useState } from 'react';
import type { Role } from '@/lib/types';
import RoleDetailModal from '@/components/CareerMap/RoleDetailModal';

/**
 * Phase 5 — Openings page client.
 * Renders the country dropdown + filtered job list, plus a "Role details"
 * button that opens the same modal that appears on the map. All filtering
 * happens in the browser because per-role job counts are small.
 */

export interface OpeningJob {
  matchId:    string;
  title:      string;
  company:    string;
  location:   string;
  country:    string;      // ISO-2 like "US", "GB", or "XX" for ambiguous
  url:        string;
  source:     string;      // "greenhouse" | "lever" | "workday"
  scrapedAt:  string;
  confidence: number | null;
}

interface Props {
  openings:  OpeningJob[];
  roleTitle: string;
  role:      Role;
}

// Display label for each ISO-2 we know about. Anything else falls back to the
// raw code so the dropdown stays honest about what's in the data.
const COUNTRY_LABEL: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  IE: 'Ireland',
  IN: 'India',
  IL: 'Israel',
  DE: 'Germany',
  FR: 'France',
  NL: 'Netherlands',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  JP: 'Japan',
  CN: 'China',
  KR: 'South Korea',
  XX: 'Multiple / Remote',
};

// Source label and color so the user sees which ATS the job came from.
const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  greenhouse: { label: 'Greenhouse', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  lever:      { label: 'Lever',      cls: 'bg-violet-50  text-violet-700  ring-violet-100' },
  workday:    { label: 'Workday',    cls: 'bg-blue-50    text-blue-700    ring-blue-100' },
};


export default function OpeningsPageClient({ openings, roleTitle, role }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Build the country options dynamically — only show countries that actually
  // have postings for this role. Sorted with US first, then alpha.
  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of openings) {
      counts.set(o.country, (counts.get(o.country) ?? 0) + 1);
    }
    const list = Array.from(counts.entries()).map(([code, count]) => ({
      code,
      label: COUNTRY_LABEL[code] ?? code,
      count,
    }));
    // US first if present, then alphabetical
    list.sort((a, b) => {
      if (a.code === 'US') return -1;
      if (b.code === 'US') return 1;
      return a.label.localeCompare(b.label);
    });
    return list;
  }, [openings]);

  // Default country: 'all' if there are postings in more than one country,
  // otherwise pick the only one available.
  const [country, setCountry] = useState<string>(() => {
    if (countryOptions.length === 1) return countryOptions[0].code;
    return 'all';
  });

  const filtered = useMemo(() => {
    if (country === 'all') return openings;
    return openings.filter(o => o.country === country);
  }, [openings, country]);

  // Shared role-details button — same UX on full state and empty state
  const roleDetailsButton = (
    <button
      type="button"
      onClick={() => setDetailsOpen(true)}
      className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide
                 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700
                 hover:bg-gray-50 transition-colors
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      Role details
    </button>
  );

  // Empty state — no openings at all for this role yet
  if (openings.length === 0) {
    return (
      <>
        <div className="flex justify-end mb-3">{roleDetailsButton}</div>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-sm">
          <p className="text-gray-700 font-semibold mb-1">
            No openings found for {roleTitle} yet.
          </p>
          <p className="text-sm text-gray-500 leading-relaxed max-w-md mx-auto">
            Our pipeline runs weekly. New matches will appear here as companies post
            jobs and the AI approves the matches.
          </p>
        </div>
        <RoleDetailModal role={detailsOpen ? role : null} onClose={() => setDetailsOpen(false)} />
      </>
    );
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <p className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{filtered.length}</span>
          {' '}of {openings.length} live opening{openings.length === 1 ? '' : 's'} shown
        </p>
        <div className="flex items-center gap-3">
          {countryOptions.length > 1 && (
            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <span className="font-semibold uppercase tracking-wide">Country:</span>
              <select
                value={country}
                onChange={e => setCountry(e.target.value)}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Filter openings by country"
              >
                <option value="all">All countries ({openings.length})</option>
                {countryOptions.map(opt => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label} ({opt.count})
                  </option>
                ))}
              </select>
            </label>
          )}
          {roleDetailsButton}
        </div>
      </div>

      {/* Empty after filter */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No openings match the selected country filter. Try{' '}
          <button
            type="button"
            onClick={() => setCountry('all')}
            className="underline font-semibold hover:text-amber-700
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
          >
            All countries
          </button>
          .
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map(job => {
            const badge = SOURCE_BADGE[job.source];
            return (
              <li
                key={job.matchId}
                className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5 shadow-sm
                           hover:border-gray-300 transition-colors"
              >
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {job.company}
                      </span>
                      {badge && (
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ring-1 ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <p className="text-[15px] font-semibold text-gray-900 leading-snug mb-1.5">
                      {job.title}
                    </p>
                    <p className="text-sm text-gray-600 flex items-center gap-1.5">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                           className="flex-shrink-0 opacity-70" aria-hidden="true">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span>
                        {job.location ? `${job.location} · ` : ''}
                        {COUNTRY_LABEL[job.country] ?? job.country}
                      </span>
                    </p>
                  </div>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 inline-flex items-center justify-center gap-1.5
                               px-4 py-2 rounded-lg text-sm font-semibold text-white
                               bg-gray-900 hover:bg-gray-700 transition-colors
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
                  >
                    Apply at source
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M7 17L17 7" />
                      <path d="M7 7h10v10" />
                    </svg>
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <RoleDetailModal role={detailsOpen ? role : null} onClose={() => setDetailsOpen(false)} />
    </div>
  );
}
