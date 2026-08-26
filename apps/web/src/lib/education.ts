import educationPrograms from '@/data/education-programs.json';

export interface EducationProgram {
  institution: string;
  program:     string;
  url:         string;
}

/** Texas programs for a role's education tier. "sometimes" pulls from both
 *  the 2yr and 4yr lists since the requirement varies by employer. */
export function programsFor(industrySlug: string | undefined, degree: string): EducationProgram[] {
  if (!industrySlug) return [];
  const industry = (educationPrograms as unknown as Record<string, Record<string, EducationProgram[]>>)[industrySlug];
  if (!industry) return [];
  if (degree === 'sometimes') {
    return [...(industry['2yr'] ?? []).slice(0, 2), ...(industry['4yr'] ?? []).slice(0, 2)];
  }
  return industry[degree] ?? [];
}
