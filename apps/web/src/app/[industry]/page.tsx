import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import IndustryPageClient from '@/components/IndustryPageClient';
import IndustryTabs from '@/components/IndustryTabs';
import type { IndustryData } from '@/lib/types';

import amData    from '@/data/additive-manufacturing.json';
import semiData  from '@/data/semiconductors.json';
import spaceData from '@/data/space.json';

const INDUSTRY_MAP: Record<string, IndustryData> = {
  'additive-manufacturing': amData    as IndustryData,
  'semiconductors':         semiData  as IndustryData,
  'space':                  spaceData as IndustryData,
};

const ALL_INDUSTRIES = [
  { slug: 'additive-manufacturing', name: 'Additive Manufacturing', short: 'AM' },
  { slug: 'semiconductors',         name: 'Semiconductors',         short: 'Semi' },
  { slug: 'space',                  name: 'Space Industry',         short: 'Space' },
];

interface Props {
  params: Promise<{ industry: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { industry } = await params;
  const data = INDUSTRY_MAP[industry];
  if (!data) return { title: 'Not Found' };
  return {
    title:       `${data.industry.name} Career Map`,
    description: data.industry.description,
    openGraph: {
      title:       `${data.industry.name} Career Map`,
      description: data.industry.description,
      type:        'website',
    },
  };
}

export default async function IndustryMapPage({ params }: Props) {
  const { industry: industrySlug } = await params;
  const data = INDUSTRY_MAP[industrySlug];
  if (!data) notFound();

  const { industry } = data;

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* Skip to main content (accessibility) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50
                   focus:bg-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-blue-600
                   focus:font-semibold focus:shadow-lg focus:outline-none focus-visible:ring-2
                   focus-visible:ring-blue-500"
      >
        Skip to main content
      </a>

      {/* Brand header — minimal, single-row.
          When client supplies their own logo we swap the wordmark below. */}
      <header className="bg-white border-b border-gray-200" role="banner">
        <div className="max-w-[1508px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-sm font-bold uppercase tracking-wide text-gray-900 hover:text-gray-700 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            Career Pathways Platform
          </Link>
          <nav aria-label="Switch industry" className="flex items-center gap-1.5">
            {ALL_INDUSTRIES.map(ind => (
              <Link
                key={ind.slug}
                href={`/${ind.slug}`}
                aria-current={ind.slug === industrySlug ? 'page' : undefined}
                className={[
                  'px-3 py-1.5 rounded text-xs font-semibold transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  ind.slug === industrySlug
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                ].join(' ')}
              >
                <span className="hidden sm:inline">{ind.name}</span>
                <span className="sm:hidden">{ind.short}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main id="main-content" className="flex-1 max-w-[1508px] mx-auto w-full px-4 sm:px-6 py-8">

        {/* Page title — matches reference site format "{Industry} Career Map" */}
        <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
          {industry.name} Career Map
        </h1>

        {/* Two-tab nav — About tab opens a modal */}
        <IndustryTabs industryName={industry.name} />

        <IndustryPageClient data={data} />
      </main>

      {/* Minimal footer — matches reference site */}
      <footer className="border-t border-gray-100 bg-white" role="contentinfo">
        <div className="max-w-[1508px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-center gap-3 text-xs text-gray-500">
          <a href="#" className="hover:text-gray-800 transition-colors">Privacy Policy</a>
          <span aria-hidden="true">|</span>
          <a href="#" className="hover:text-gray-800 transition-colors">Terms of Service</a>
        </div>
      </footer>
    </div>
  );
}
