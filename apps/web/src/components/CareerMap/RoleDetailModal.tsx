'use client';

import Link from 'next/link';
import type { Role } from '@/lib/types';
import Modal from '../Modal';
import { CLUSTER_COLORS, formatSalary } from './constants';

interface Props {
  role:    Role | null;
  /** Worldwide approved-match count — drives the "View live openings" button. */
  anyCount?: number;
  /** Industry slug, for routing to /[industry]/role/[id]/openings. */
  industrySlug?: string;
  onClose: () => void;
}

const DEGREE_LABEL: Record<string, string> = {
  hs:        'High School Diploma',
  '2yr':     "Associate's Degree",
  '4yr':     "Bachelor's Degree",
  graduate:  'Graduate Degree',
  sometimes: 'Sometimes Required',
};

const TIER_LABEL: Record<string, string> = {
  entry:  'Entry-level',
  mid:    'Mid-level',
  senior: 'Senior-level',
  lead:   'Senior-level',
};

/**
 * Role detail modal — Critical Materials reference layout.
 *
 * Sections butt edge-to-edge; visual separation comes from background color
 * only (no inter-section margins, no borders). Vertical order:
 *   1. Colored band   — cluster chip + role title + tier label
 *   2. Two-col area   — description (white) + meta sidebar (cluster tint,
 *                       flush to band top and to the modal's right edge)
 *   3. Skills strip   — single subtle near-white-gray fill, no row stripes
 *   4. Certs + CTA    — white
 */
export default function RoleDetailModal({ role, anyCount, industrySlug, onClose }: Props) {
  if (!role) {
    return <Modal open={false} onClose={onClose}>{null}</Modal>;
  }

  const worldwideCount = anyCount ?? 0;
  const clusterColor = CLUSTER_COLORS[role.cluster];
  const bandHex      = clusterColor?.band ?? '#374151';
  const tintHex      = clusterColor?.tint ?? '#e5e7eb';
  const degreeLabel  = DEGREE_LABEL[role.degree_required] ?? '—';
  const payText      = role.salary_range || `${formatSalary(role.salary_min, role.salary_max)} / year`;
  const tierLabel    = TIER_LABEL[role.seniority] ?? '';

  // Subtle, single near-white-gray for the Skills strip.
  const skillsBgHex = '#eef0f2';

  return (
    <Modal
      open={role !== null}
      onClose={onClose}
      maxWidth="960px"
      ariaLabel={`Details for ${role.title}`}
      noPadding
      closeButtonClass="text-white hover:text-white hover:bg-white/20"
    >
      {/* 1. Colored band — cluster chip on top, role title + tier label below. */}
      <div
        className="rounded-t-lg px-7 pt-5 pb-6 pr-16"
        style={{ backgroundColor: bandHex }}
      >
        <span
          className="inline-block px-2.5 py-1 rounded text-[12px] font-bold uppercase tracking-wider text-white"
          style={{ backgroundColor: 'rgba(0,0,0,0.20)' }}
        >
          {role.cluster}
        </span>
        <h2 className="mt-3 text-3xl font-bold text-white leading-tight">{role.title}</h2>
        {tierLabel && (
          <p className="mt-1.5 text-[12px] font-semibold uppercase tracking-wider text-white/85">
            {tierLabel}
          </p>
        )}
      </div>

      {/* 2. Two-column area — sidebar flush with band top and right edge. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
        <div className="md:col-span-2 px-7 pt-7 pb-8 bg-white">
          {role.description && (
            <p className="text-[15px] text-gray-700 leading-relaxed whitespace-pre-line">
              {role.description}
            </p>
          )}
        </div>

        <aside
          className="md:col-span-1 pl-5 pr-6 pt-7 pb-8 space-y-6"
          style={{ backgroundColor: tintHex }}
        >
          {/* Required Education & Training */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: bandHex }} aria-hidden="true">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                <path d="M6 12v5c3 3 9 3 12 0v-5" />
              </svg>
              <h4 className="text-[12px] font-bold uppercase tracking-wider text-gray-700">
                Required Education &amp; Training
              </h4>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 flex-shrink-0"
                style={{ backgroundColor: bandHex, transform: 'rotate(45deg)' }}
                aria-hidden="true"
              />
              <p className="text-base font-bold text-gray-900">{degreeLabel}</p>
            </div>
            {role.degree_detail && (
              <p className="text-sm text-gray-700 mt-2 leading-relaxed">{role.degree_detail}</p>
            )}
          </div>

          {/* Work Experience */}
          {role.experience && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: bandHex }} aria-hidden="true">
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                </svg>
                <h4 className="text-[12px] font-bold uppercase tracking-wider text-gray-700">
                  Work Experience
                </h4>
              </div>
              <p className="text-base font-bold text-gray-900">{role.experience}</p>
            </div>
          )}

          {/* Pay */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: bandHex }} aria-hidden="true">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              <h4 className="text-[12px] font-bold uppercase tracking-wider text-gray-700">
                Pay
              </h4>
            </div>
            <p className="text-base font-bold text-gray-900">{payText}</p>
          </div>
        </aside>
      </div>

      {/* 3. Skills strip — one single near-white-gray fill, no row stripes. */}
      {role.skills.length > 0 && (
        <div className="px-7 pt-7 pb-8" style={{ backgroundColor: skillsBgHex }}>
          <div className="flex items-center gap-2.5 mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: bandHex }} aria-hidden="true">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            <h3 className="text-[14px] font-bold uppercase tracking-wider text-gray-800">
              Skills &amp; Requirements
            </h3>
          </div>
          <ul className="space-y-2.5 text-[14px] text-gray-800 leading-relaxed">
            {role.skills.map(skill => (
              <li key={skill.name}>
                <span className="font-semibold text-gray-900">{skill.name}</span>
                {skill.description ? <>: {skill.description}</> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 4. Certifications + CTA — white background, last block of the modal. */}
      {(role.certifications.length > 0 || (worldwideCount > 0 && industrySlug)) && (
        <div className="px-7 pt-7 pb-8 bg-white">
          {role.certifications.length > 0 && (
            <div className={worldwideCount > 0 && industrySlug ? 'mb-7' : ''}>
              <h3 className="text-[14px] font-bold uppercase tracking-wider text-gray-800 mb-3">
                Certifications
              </h3>
              <ul className="space-y-2 text-[14px] text-gray-800 leading-relaxed">
                {role.certifications.map(cert => (
                  <li key={cert} className="flex items-start gap-2.5">
                    <span
                      className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: bandHex }}
                      aria-hidden="true"
                    />
                    <span>{cert}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {worldwideCount > 0 && industrySlug && (
            <Link
              href={`/${industrySlug}/role/${role.id}/openings`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                         text-white hover:opacity-90 transition-opacity
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ backgroundColor: bandHex }}
            >
              View {worldwideCount} live opening{worldwideCount === 1 ? '' : 's'} →
            </Link>
          )}
        </div>
      )}
    </Modal>
  );
}
