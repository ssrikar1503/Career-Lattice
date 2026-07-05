import type { Role, IndustryData, SeniorityLevel } from './types';

// ── Skill gap between two roles ────────────────────────────────────────────────
export function computeSkillGap(from: Role, to: Role) {
  const fromSet = new Set(from.skills.map(s => s.name.toLowerCase()));
  return {
    toGain:   to.skills.filter(s => !fromSet.has(s.name.toLowerCase())),
    youBring: to.skills.filter(s =>  fromSet.has(s.name.toLowerCase())),
  };
}

// ── Whether moving to a role is up / lateral / down in seniority ───────────────
const SENIORITY_RANK: Record<SeniorityLevel, number> = {
  entry: 0, mid: 1, senior: 2, lead: 3,
};
export function getSeniorityDelta(from: Role, to: Role): 'up' | 'lateral' | 'down' {
  const diff = SENIORITY_RANK[to.seniority] - SENIORITY_RANK[from.seniority];
  return diff > 0 ? 'up' : diff < 0 ? 'down' : 'lateral';
}

// ── Does a role match active filters? ─────────────────────────────────────────
export function roleMatchesFilter(
  role: Role,
  query: string,
  degree: string,
  cluster: string,
): boolean {
  if (degree && degree !== 'all' && role.degree_required !== degree) return false;
  if (cluster && cluster !== 'all' && role.cluster !== cluster) return false;
  if (query) {
    const q = query.toLowerCase();
    const inTitle  = role.title.toLowerCase().includes(q);
    const inSkill  = role.skills.some(s => s.name.toLowerCase().includes(q));
    const inCluster = role.cluster.toLowerCase().includes(q);
    const inDesc   = role.description.toLowerCase().includes(q);
    if (!inTitle && !inSkill && !inCluster && !inDesc) return false;
  }
  return true;
}

// ── Wizard: pick 3-5 roles most relevant to the user's answers ─────────────────
export function getRecommendedRoles(
  data: IndustryData,
  answers: { persona: string; education: string; goal: string },
): string[] {
  const { persona, education, goal } = answers;

  const degreeRank: Record<string, number> = { hs: 0, '2yr': 1, '4yr': 2, graduate: 3 };
  const userRank = degreeRank[education] ?? 0;

  const scored = data.roles.map(role => {
    let score = 0;
    // 'sometimes' = flexible: count it as accessible to anyone (rank 0)
    const roleRank = role.degree_required === 'sometimes'
      ? 0
      : (degreeRank[role.degree_required] ?? 0);

    // Education fit — prefer roles the user is qualified for
    if (roleRank <= userRank) score += 3;
    if (roleRank === userRank) score += 2;
    // 'Sometimes required' roles get a small bonus — they're entry points for non-traditional backgrounds
    if (role.degree_required === 'sometimes') score += 1;

    // Persona
    if (persona === 'student' && role.seniority === 'entry') score += 4;
    if (persona === 'growing' && (role.seniority === 'mid' || role.seniority === 'senior')) score += 4;
    if (persona === 'changer') {
      // Roles with many adjacent connections = most flexible entry
      score += Math.min(role.adjacent_role_ids.length, 4);
    }
    if (persona === 'advisor') score += 1; // show variety

    // Goal
    if (goal === 'salary' && role.salary_max >= 100000) score += 3;
    if (goal === 'stability' && role.pathway_ids.length >= 2) score += 3;
    if (goal === 'leadership' && (role.seniority === 'senior' || role.seniority === 'lead')) score += 3;
    if (goal === 'technical' && role.skills.length >= 6) score += 3;

    return { id: role.id, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => r.id);
}
