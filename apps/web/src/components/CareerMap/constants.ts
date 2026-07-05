/**
 * Cluster → color mapping. Each industry has its own palette chosen for
 * psychological tone — palette is keyed by cluster name (names are unique
 * across the three industries, so no collision).
 *
 *   AM    → industrial blueprint  : deep blue → cyan → emerald → lime → amber
 *           (trust, precision, quality, value of craft)
 *   Semi  → electric silicon      : violet → electric blue → cyan → teal → magenta
 *           (innovation, energy, advanced tech)
 *   Space → cosmic frontier sunset: indigo → violet → fuchsia → sky → rocket
 *           orange → rose (ambition, exploration, thrust, urgency)
 */
export const CLUSTER_COLORS: Record<string, {
  dot:   string;     // tailwind bg class for the indicator bullet
  ring:  string;     // tailwind ring class for selected card border
  light: string;     // hex used for SVG line color
  band:  string;     // hex for the column header solid band
  tint:  string;     // hex (with alpha) for the cell background tint
}> = {
  // ── Additive Manufacturing — industrial blueprint ──────────────────────
  'Design & Engineering':              { dot: 'bg-[#1d4ed8]', ring: 'ring-[#1d4ed8]', light: '#1d4ed8', band: '#1d4ed8', tint: '#1d4ed814' },
  'Materials & Process Development':   { dot: 'bg-[#0891b2]', ring: 'ring-[#0891b2]', light: '#0891b2', band: '#0891b2', tint: '#0891b214' },
  'Machine Operation & Production':    { dot: 'bg-[#059669]', ring: 'ring-[#059669]', light: '#059669', band: '#059669', tint: '#05966914' },
  'Post-Processing & Quality':         { dot: 'bg-[#65a30d]', ring: 'ring-[#65a30d]', light: '#65a30d', band: '#65a30d', tint: '#65a30d14' },
  'Business, Sales & Supply Chain':    { dot: 'bg-[#d97706]', ring: 'ring-[#d97706]', light: '#d97706', band: '#d97706', tint: '#d9770614' },

  // ── Semiconductors — electric silicon ──────────────────────────────────
  'Research, Design & Engineering':                  { dot: 'bg-[#7c3aed]', ring: 'ring-[#7c3aed]', light: '#7c3aed', band: '#7c3aed', tint: '#7c3aed14' },
  'Wafer Fabrication':                               { dot: 'bg-[#2563eb]', ring: 'ring-[#2563eb]', light: '#2563eb', band: '#2563eb', tint: '#2563eb14' },
  'Assembly, Packaging & Testing':                   { dot: 'bg-[#06b6d4]', ring: 'ring-[#06b6d4]', light: '#06b6d4', band: '#06b6d4', tint: '#06b6d414' },
  'Facilities & Equipment Maintenance':              { dot: 'bg-[#0d9488]', ring: 'ring-[#0d9488]', light: '#0d9488', band: '#0d9488', tint: '#0d948814' },
  'Supply Chain, Logistics & Business Operations':   { dot: 'bg-[#db2777]', ring: 'ring-[#db2777]', light: '#db2777', band: '#db2777', tint: '#db277714' },

  // ── Space Industry — cosmic frontier sunset ────────────────────────────
  'Spacecraft Design & Engineering':     { dot: 'bg-[#4338ca]', ring: 'ring-[#4338ca]', light: '#4338ca', band: '#4338ca', tint: '#4338ca14' },
  'Propulsion & Systems':                { dot: 'bg-[#7c3aed]', ring: 'ring-[#7c3aed]', light: '#7c3aed', band: '#7c3aed', tint: '#7c3aed14' },
  'Manufacturing & Assembly (AIT)':      { dot: 'bg-[#c026d3]', ring: 'ring-[#c026d3]', light: '#c026d3', band: '#c026d3', tint: '#c026d314' },
  'Mission Operations & Ground Systems': { dot: 'bg-[#0284c7]', ring: 'ring-[#0284c7]', light: '#0284c7', band: '#0284c7', tint: '#0284c714' },
  'Launch & Test Operations':            { dot: 'bg-[#ea580c]', ring: 'ring-[#ea580c]', light: '#ea580c', band: '#ea580c', tint: '#ea580c14' },
  'Business, Policy & Supply Chain':     { dot: 'bg-[#dc2626]', ring: 'ring-[#dc2626]', light: '#dc2626', band: '#dc2626', tint: '#dc262614' },
};

export const DEGREE_BADGES: Record<string, { label: string; className: string }> = {
  hs:        { label: 'HS',     className: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' },
  '2yr':     { label: '2yr',    className: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200' },
  '4yr':     { label: '4yr',    className: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
  graduate:  { label: 'Grad',   className: 'bg-purple-50 text-purple-700 ring-1 ring-purple-200' },
  sometimes: { label: 'Some',   className: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200' },
};

export function formatSalary(min: number, max: number): string {
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  return `${k(min)}–${k(max)}`;
}
