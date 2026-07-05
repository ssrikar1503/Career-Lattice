'use client';

import Link from 'next/link';
import type { Role } from '@/lib/types';
import { CLUSTER_COLORS, DEGREE_BADGES, formatSalary } from './constants';

interface Props {
  roles: Role[];
  clusters: string[];
  industrySlug: string;
}

export default function MobileList({ roles, clusters, industrySlug }: Props) {
  const byCluster = clusters.map(cluster => ({
    cluster,
    roles: roles.filter(r => r.cluster === cluster),
  })).filter(g => g.roles.length > 0);

  if (roles.length === 0) {
    return (
      <div className="py-16 text-center text-gray-400">
        <p className="text-lg font-semibold">No roles match your filters</p>
        <p className="text-sm mt-1">Try clearing the filters above</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" role="list" aria-label="Career roles list">
      {byCluster.map(({ cluster, roles: clusterRoles }) => {
        const color = CLUSTER_COLORS[cluster];
        return (
          <section key={cluster} aria-labelledby={`cluster-${cluster}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-2.5 h-2.5 rounded-full ${color?.dot ?? 'bg-gray-400'}`} aria-hidden="true" />
              <h2
                id={`cluster-${cluster}`}
                className="text-sm font-bold text-gray-700 uppercase tracking-wide"
              >
                {cluster}
              </h2>
            </div>

            <div className="flex flex-col gap-2" role="list">
              {clusterRoles.map(role => {
                const badge = DEGREE_BADGES[role.degree_required];
                return (
                  <Link
                    key={role.id}
                    href={`/${industrySlug}/role/${role.id}/openings`}
                    role="listitem"
                    className="block bg-white border border-gray-200 rounded-xl p-4 shadow-sm
                               hover:shadow-md hover:border-gray-300 transition-all duration-150
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={`${role.title} — ${role.seniority} level, ${formatSalary(role.salary_min, role.salary_max)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-gray-400 capitalize">
                            {role.seniority}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-gray-900 leading-snug">{role.title}</p>
                        <p className="text-sm font-semibold text-gray-500 mt-0.5">
                          {formatSalary(role.salary_min, role.salary_max)}
                        </p>
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-1 rounded-full flex-shrink-0 ${badge?.className}`}>
                        {badge?.label}
                      </span>
                    </div>

                    {/* Top 3 skills */}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {role.skills.slice(0, 3).map(skill => (
                        <span key={skill.name}
                          className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                          {skill.name}
                        </span>
                      ))}
                      {role.skills.length > 3 && (
                        <span className="text-[11px] text-gray-400">+{role.skills.length - 3}</span>
                      )}
                    </div>

                    {role.open_jobs_count > 0 && (
                      <p className="text-xs font-semibold text-amber-600 mt-2">
                        {role.open_jobs_count} open job{role.open_jobs_count !== 1 ? 's' : ''}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
