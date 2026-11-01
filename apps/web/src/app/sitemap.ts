import type { MetadataRoute } from 'next';
import type { IndustryData } from '@/lib/types';
import amData    from '@/data/additive-manufacturing.json';
import semiData  from '@/data/semiconductors.json';
import spaceData from '@/data/space.json';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://career-lattice-beta.vercel.app').replace(/\/$/, '');

const INDUSTRIES: Array<{ slug: string; data: IndustryData }> = [
  { slug: 'additive-manufacturing', data: amData    as unknown as IndustryData },
  { slug: 'semiconductors',         data: semiData  as unknown as IndustryData },
  { slug: 'space',                  data: spaceData as unknown as IndustryData },
];

// NOTE: the bare role route /[industry]/role/[id] 404s on this site — only
// /[industry]/role/[id]/openings is a real page — so the sitemap emits home +
// the 3 industry maps + each role's /openings page.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
  ];
  for (const { slug, data } of INDUSTRIES) {
    entries.push({ url: `${SITE}/${slug}`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 });
    for (const role of data.roles) {
      entries.push({ url: `${SITE}/${slug}/role/${role.id}/openings`, lastModified: now, changeFrequency: 'daily', priority: 0.5 });
    }
  }
  return entries;
}
