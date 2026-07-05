'use client';

import type { Role } from '@/lib/types';
import { CLUSTER_COLORS, formatSalary } from './constants';

interface Props {
  selectedIds: string[];
  roleById: Map<string, Role>;
}

/**
 * Simplified "Your Career Path" panel — matches the Critical Materials reference site.
 *
 * Each row is a bullet (cluster color), role title, tier badge, salary on a second line.
 * No step numbers, no remove buttons, no cluster name text — the visual chain is the map
 * itself. Click-to-truncate (Phase J9) replaces the explicit remove button.
 *
 * Save & Share + Clear actions live in the map's chrome above the panel (Phase J2), not here.
 */
export default function CareerPathPanel({
  selectedIds, roleById,
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
          {chain.map(role => {
            const clusterColor = CLUSTER_COLORS[role.cluster] ?? CLUSTER_COLORS['Design & Engineering'];
            const tierLabel = role.seniority.charAt(0).toUpperCase() + role.seniority.slice(1);
            return (
              <li
                key={role.id}
                className="flex items-start gap-2.5"
              >
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
