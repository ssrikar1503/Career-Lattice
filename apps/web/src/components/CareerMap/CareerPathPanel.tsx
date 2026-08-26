'use client';

import type { Role } from '@/lib/types';
import { CLUSTER_COLORS, formatSalary } from './constants';
import { programsFor } from '@/lib/education';

interface Props {
  selectedIds: string[];
  roleById: Map<string, Role>;
  /** Industry slug, used to look up Texas training programs for each step. */
  industrySlug?: string;
}

/**
 * "Your Career Path" panel.
 *
 * Each row is a bullet (cluster color), role title, tier badge, salary on a second line.
 * Education stepping stones: before the first role, and before any role whose
 * degree requirement changes from the previous step, the panel lists the Texas
 * training programs that prepare you for that step (linked, opens in new tab).
 */
export default function CareerPathPanel({
  selectedIds, roleById, industrySlug,
}: Props) {
  const chain = selectedIds
    .map(id => roleById.get(id))
    .filter((r): r is Role => Boolean(r));

  return (
    <section
      className="mt-6 rounded-lg border border-gray-200 bg-white px-5 py-4"
      aria-label="Your career path"
    >
      <div className="flex items-center gap-2 mb-3">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
             className="text-gray-700" aria-hidden="true">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        <h2 className="text-sm font-semibold text-gray-900">Your Career Path:</h2>
      </div>

      {chain.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          Start by selecting one or more jobs on the career map.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" role="list">
          {chain.map((role, i) => {
            const clusterColor = CLUSTER_COLORS[role.cluster] ?? CLUSTER_COLORS['Design & Engineering'];
            const tierLabel = role.seniority.charAt(0).toUpperCase() + role.seniority.slice(1);
            // Education stepping stones: first step always; later steps only
            // when the degree requirement changes from the previous role.
            const showPrograms = i === 0 || chain[i - 1].degree_required !== role.degree_required;
            const programs = showPrograms ? programsFor(industrySlug, role.degree_required).slice(0, 3) : [];
            return (
              <li key={role.id} className="flex flex-col gap-1.5">
                {programs.length > 0 && (
                  <ul className="ml-1 pl-3 border-l-2 border-[#e8ddcf] flex flex-col gap-1 mb-1" role="list"
                      aria-label={`Training programs that prepare you for ${role.title}`}>
                    {programs.map(p => (
                      <li key={p.url + p.program} className="text-[12px] leading-snug">
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-600 hover:text-[#500000] underline decoration-[#B7791F] underline-offset-2
                                     focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B7791F] rounded"
                        >
                          <span className="font-semibold">{p.institution}</span> | {p.program}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-start gap-2.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${clusterColor?.dot ?? 'bg-gray-400'}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">{role.title}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {tierLabel}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {role.salary_range || `${formatSalary(role.salary_min, role.salary_max)} / year`}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
