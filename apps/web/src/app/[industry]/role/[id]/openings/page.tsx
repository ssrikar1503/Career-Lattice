import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { IndustryData } from '@/lib/types';
import { getPool, query } from '@/lib/db';
import OpeningsPageClient, { type OpeningJob } from './OpeningsPageClient';

import amData      from '@/data/additive-manufacturing.json';
import semiData    from '@/data/semiconductors.json';
import spaceData   from '@/data/space.json';
import nuclearData from '@/data/nuclear.json';

const INDUSTRY_MAP: Record<string, IndustryData> = {
  'additive-manufacturing': amData      as IndustryData,
  'semiconductors':         semiData    as IndustryData,
  'space':                  spaceData   as IndustryData,
  'nuclear':                nuclearData as IndustryData,
};

interface Props {
  params: Promise<{ industry: string; id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { industry: slug, id } = await params;
  const data = INDUSTRY_MAP[slug];
  if (!data) return {};
  const role = data.roles.find(r => r.id === id);
  if (!role) return {};
  return {
    title:       `${role.title} - open jobs | ${data.industry.name}`,
    description: `Live job openings for ${role.title} in ${data.industry.name}.`,
  };
}


/**
 * Server-side fetch of every approved role_match for this canonical role,
 * joined to its raw posting. Empty array on any DB error so the page
 * degrades gracefully to "No openings".
 */
async function fetchOpenings(industrySlug: string, roleTitle: string): Promise<OpeningJob[]> {
  if (!getPool()) return [];

  try {
    // Resolve the canonical role by (industry slug, case-insensitive title).
    const roleRows = await query<{ id: string }>(
      `SELECT cr.id
         FROM canonical_roles cr
         JOIN industries i ON i.id = cr.industry_id
        WHERE i.slug = $1 AND cr.title ILIKE $2
        LIMIT 1`,
      [industrySlug, roleTitle.trim()],
    );
    const roleId = roleRows[0]?.id;
    if (!roleId) return [];

    // Every approved match for this role, joined to its posting, newest first.
    // Direct SQL has no 1000-row cap, so one query returns the full set.
    const rows = await query<{
      match_id:         string;
      confidence:       string | number | null;
      normalized_title: string | null;
      country:          string | null;
      location:         string | null;
      company:          string | null;
      url:              string | null;
      raw_title:        string | null;
      source:           string | null;
      scraped_at:       Date | string | null;
    }>(
      `SELECT rm.id AS match_id, rm.confidence,
              ej.normalized_title, ej.country, ej.location,
              rj.company, rj.url, rj.raw_title, rj.source, rj.scraped_at
         FROM role_matches rm
         JOIN extracted_jobs ej ON ej.id = rm.extracted_job_id
         JOIN raw_jobs       rj ON rj.id = ej.raw_job_id
        WHERE rm.canonical_role_id = $1
          AND rm.status = 'approved'
          AND rj.url IS NOT NULL
        ORDER BY rj.scraped_at DESC NULLS LAST`,
      [roleId],
    );

    return rows.map(r => ({
      matchId:    r.match_id,
      title:      r.raw_title || r.normalized_title || 'Untitled role',
      company:    r.company || 'Unknown company',
      location:   r.location || '',
      country:    (r.country || 'XX').toUpperCase(),
      url:        r.url as string,
      source:     r.source || 'unknown',
      scrapedAt:  r.scraped_at ? new Date(r.scraped_at).toISOString() : '',
      confidence: r.confidence != null ? Number(r.confidence) : null,
    }));
  } catch {
    return [];
  }
}


export default async function OpeningsPage({ params }: Props) {
  const { industry: slug, id } = await params;
  const data = INDUSTRY_MAP[slug];
  if (!data) notFound();
  const role = data.roles.find(r => r.id === id);
  if (!role) notFound();

  const openings = await fetchOpenings(slug, role.title);

  return (
    <div className="min-h-screen bg-[#FFFFFF]">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-3">
          <Link
            href={`/${slug}`}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            ← {data.industry.name} map
          </Link>
          <div className="h-4 w-px bg-gray-200" />
          <p className="text-sm font-semibold text-gray-700 truncate">{role.title}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-6">
          Open jobs - {role.title}
        </h1>
        <OpeningsPageClient openings={openings} roleTitle={role.title} role={role} />
      </main>
    </div>
  );
}
