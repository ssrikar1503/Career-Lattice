import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { IndustryData } from '@/lib/types';
import { getSupabaseAdmin } from '@/lib/supabase';
import OpeningsPageClient, { type OpeningJob } from './OpeningsPageClient';

import amData    from '@/data/additive-manufacturing.json';
import semiData  from '@/data/semiconductors.json';
import spaceData from '@/data/space.json';

const INDUSTRY_MAP: Record<string, IndustryData> = {
  'additive-manufacturing': amData    as IndustryData,
  'semiconductors':         semiData  as IndustryData,
  'space':                  spaceData as IndustryData,
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
    title:       `${role.title} — open jobs | ${data.industry.name}`,
    description: `Live job openings for ${role.title} in ${data.industry.name}.`,
  };
}


/**
 * Server-side fetch of every approved role_match for this canonical role,
 * joined to its raw posting. Empty array on any DB error so the page
 * degrades gracefully to "No openings".
 */
async function fetchOpenings(industrySlug: string, roleTitle: string): Promise<OpeningJob[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  try {
    const { data: industry } = await supabase
      .from('industries')
      .select('id')
      .eq('slug', industrySlug)
      .single();
    if (!industry?.id) return [];

    const { data: roleRow } = await supabase
      .from('canonical_roles')
      .select('id')
      .eq('industry_id', industry.id)
      .ilike('title', roleTitle.trim())
      .maybeSingle();
    if (!roleRow?.id) return [];

    // Page through matches for this role — Supabase silently caps a single
    // select at 1000 rows. Popular roles (NVIDIA semiconductor matches etc.)
    // could plausibly exceed that as the matcher drains the backlog.
    const PAGE = 1000;
    type MatchRow = {
      id: string;
      confidence?: number;
      extracted_jobs?: {
        normalized_title?: string;
        country?: string;
        location?: string;
        raw_jobs?: {
          company?: string;
          url?: string;
          raw_title?: string;
          source?: string;
          scraped_at?: string;
        } | null;
      } | null;
    };
    const matches: MatchRow[] = [];
    let offset = 0;
    while (true) {
      const { data: page } = await supabase
        .from('role_matches')
        .select(`
          id,
          confidence,
          extracted_jobs(
            normalized_title,
            country,
            location,
            raw_jobs(company, url, raw_title, source, scraped_at)
          )
        `)
        .eq('canonical_role_id', roleRow.id)
        .eq('status', 'approved')
        .range(offset, offset + PAGE - 1);
      const rows = (page ?? []) as MatchRow[];
      matches.push(...rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
    }

    const flattened: OpeningJob[] = [];
    for (const m of matches) {
      const ej = m.extracted_jobs;
      const rj = ej?.raw_jobs;
      if (!ej || !rj || !rj.url) continue;
      flattened.push({
        matchId:    m.id,
        title:      rj.raw_title || ej.normalized_title || 'Untitled role',
        company:    rj.company || 'Unknown company',
        location:   ej.location || '',
        country:    (ej.country || 'XX').toUpperCase(),
        url:        rj.url,
        source:     rj.source || 'unknown',
        scrapedAt:  rj.scraped_at || '',
        confidence: typeof m.confidence === 'number' ? m.confidence : null,
      });
    }
    flattened.sort((a, b) => (b.scrapedAt || '').localeCompare(a.scrapedAt || ''));
    return flattened;
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
    <div className="min-h-screen bg-gray-50">
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
          Open jobs — {role.title}
        </h1>
        <OpeningsPageClient openings={openings} roleTitle={role.title} role={role} />
      </main>
    </div>
  );
}
