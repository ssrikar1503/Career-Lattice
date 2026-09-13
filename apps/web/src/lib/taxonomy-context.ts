/**
 * Shared taxonomy context builders.
 *
 * Compresses the role taxonomy into a compact text block that fits in an AI
 * system prompt. Used by both the Rev chat endpoint and the resume analyzer
 * so the two features can never drift apart on how roles are described.
 */
import type { IndustryData } from '@/lib/types';

import amData    from '@/data/additive-manufacturing.json';
import semiData  from '@/data/semiconductors.json';
import spaceData from '@/data/space.json';

export const INDUSTRY_MAP: Record<string, IndustryData> = {
  'additive-manufacturing': amData    as IndustryData,
  'semiconductors':         semiData  as IndustryData,
  'space':                  spaceData as IndustryData,
};

export function buildContext(data: IndustryData): string {
  const roles = data.roles.map(r =>
    `[${r.id}] ${r.title} | ${r.cluster} | ${r.seniority} | ` +
    `$${Math.round(r.salary_min / 1000)}k–$${Math.round(r.salary_max / 1000)}k | ` +
    `${r.degree_required} | Skills: ${r.skills.slice(0, 5).map(s => s.name).join(', ')}`
  ).join('\n');

  const pathways = data.pathways.map(p =>
    `${p.name}: ${p.role_ids.join(' → ')}`
  ).join('\n');

  return `=== ${data.industry.name} (map: ${data.industry.slug}) ===\n${roles}` +
    (pathways ? `\n\n=== ${data.industry.name} Career Pathways ===\n${pathways}` : '');
}

export function buildAllContext(): string {
  return Object.values(INDUSTRY_MAP).map(d => buildContext(d)).join('\n\n');
}

/** All valid role ids per industry slug - used to validate AI output. */
export function validRoleIds(): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const [slug, data] of Object.entries(INDUSTRY_MAP)) {
    out[slug] = new Set(data.roles.map(r => r.id));
  }
  return out;
}
