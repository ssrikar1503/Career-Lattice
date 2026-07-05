export type DegreeLevel = 'hs' | '2yr' | '4yr' | 'graduate' | 'sometimes';
export type SeniorityLevel = 'entry' | 'mid' | 'senior' | 'lead';
export type MatchStatus = 'pending' | 'approved' | 'rejected';

export interface Skill {
  name: string;
  description: string;
}

export interface Industry {
  id: string;
  name: string;
  slug: string;
  description: string;
  color: string; // brand color for UI (hex)
}

export interface Role {
  id: string;
  industry_id: string;
  title: string;
  cluster: string;          // e.g. "Design & Engineering", "Production", "Quality"
  seniority: SeniorityLevel;
  salary_min: number;
  salary_max: number;
  /** Exact salary string from client research, e.g. "$65,000 - $80,000". Optional — falls back to formatSalary(min,max) when absent. */
  salary_range?: string;
  degree_required: DegreeLevel;
  /** Long-form degree expectation, e.g. "Yes — BS Mechanical Eng" or "Sometimes — Associate/cert preferred". Optional. */
  degree_detail?: string;
  /** Typical years of experience, e.g. "0-2 years" or "10+ years". Optional. */
  experience?: string;
  skills: Skill[];
  certifications: string[];
  description: string;
  pathway_ids: string[];
  adjacent_role_ids: string[];  // roles you can move to/from
  open_jobs_count: number;
  hiring_companies: string[];
  // grid position (used by CareerMap to place the node)
  grid_col: number;             // which value-chain column (0-indexed)
  grid_row: number;             // which seniority row (0-indexed)
}

export interface Pathway {
  id: string;
  industry_id: string;
  name: string;
  description: string;
  role_ids: string[];           // ordered: first role → last role
}

// The full data shape loaded from a JSON file (one per industry)
export interface IndustryData {
  industry: Industry;
  clusters: string[];           // ordered list of cluster names (left→right on map)
  seniority_levels: string[];   // ordered list of seniority labels (bottom→top on map)
  roles: Role[];
  pathways: Pathway[];
}

// Agent chat types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];         // role ids referenced in the answer
  timestamp: Date;
}

// Admin review types
export interface RoleMatch {
  id: string;
  extracted_job: {
    normalized_title: string;
    skills: string[];
    seniority: string;
    location: string;
    raw_title: string;
    company: string;
    url: string;
  };
  canonical_role: Role;
  confidence: number;           // 0–1
  status: MatchStatus;
  created_at: string;
}
