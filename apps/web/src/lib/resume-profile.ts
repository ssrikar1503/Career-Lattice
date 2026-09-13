/**
 * Client-side bridge between the Resume Analyzer and Rev.
 *
 * After a resume analysis, the profile (never the resume text) is kept in
 * module memory so Rev can ground its answers in the user's real background.
 * Nothing here is persisted: a page refresh clears it, keeping the
 * "analyzed in memory, never stored" promise intact.
 */

export interface ResumeProfile {
  current_title:    string;
  years_experience: number;
  education_level:  string;
  summary:          string;
  best_industry:    string;
  top_matches:      Array<{ role_id: string; title: string; confidence: number }>;
  gap_skills:       string[];   // gaps of the top match
}

let profile: ResumeProfile | null = null;

export function setResumeProfile(p: ResumeProfile): void {
  profile = p;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rev:resume-profile'));
  }
}

export function getResumeProfile(): ResumeProfile | null {
  return profile;
}

/** Ask the Rev chat panel to open, optionally pre-filling a question. */
export function openRevChat(prefill?: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rev:open', { detail: { prefill } }));
  }
}
