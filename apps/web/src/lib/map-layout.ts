import type { Role, SeniorityLevel } from './types';

/**
 * Map layout constants — sized to match the Critical Materials reference site:
 * compact circular nodes packed densely in tinted columns.
 *
 * Three tiers (Senior / Mid / Entry) — "lead" roles in the data render into
 * the Senior row visually. The four-tier data model is preserved so we can
 * restore it later without re-touching the JSONs.
 */
export const LAYOUT = {
  CARD_W: 100,        // total clickable footprint per role (circle + title)
  CARD_H: 72,         // bumped from 60 for breathing room
  STACK_GAP: 10,      // gap between cards stacked in the same cell (was 6)
  COL_W: 234,         // legacy default — actual width derived per industry below
  ROW_GAP: 36,        // vertical gap between seniority bands (was 24)
  HEADER_H: 56,       // cluster name header height
  LEFT_W: 80,         // seniority label column width
  OUTER_PAD: 0,       // right + bottom padding (kept at 0 so the grid edge meets the page edge cleanly)
  NODE_R: 8,          // default circle node radius (16px diameter)
  NODE_R_ACTIVE: 29,  // halo radius when hovered or selected (diameter ≈ 58px)
} as const;

// Display order — only 3 rows visible (Senior on top, Entry on bottom).
// "lead" still exists in the data model but renders into the Senior row.
export const SENIORITY_DISPLAY_ORDER: SeniorityLevel[] = ['senior', 'mid', 'entry'];

// "lead" maps to the Senior row so legacy data renders cleanly without
// JSON migration. Three-tier visual; four-tier underlying data.
export const SENIORITY_TO_ROW: Record<SeniorityLevel, number> = {
  entry: 0, mid: 1, senior: 2, lead: 2,
};

export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  senior: 'Senior',
  mid:    'Mid',
  entry:  'Entry',
  lead:   'Senior',
};

export interface CardPosition {
  x:  number;
  y:  number;
  cx: number; // center x — used for SVG line endpoints
  cy: number; // center y
  w:  number; // role-card width (may shrink for industries with more columns)
  h:  number; // role-card height
}

export interface LayoutResult {
  positions: Map<string, CardPosition>;
  totalWidth: number;
  totalHeight: number;
  rowStartY: Record<number, number>;
  rowBandHeight: Record<number, number>;
  numCols: number;
  /** Actual column width chosen for this industry — may differ from LAYOUT.COL_W. */
  colW: number;
  /** Actual card width chosen for this industry — may differ from LAYOUT.CARD_W. */
  cardW: number;
}

/**
 * Effective layout row for a role.
 *
 * Three-tier visual: "lead" roles render into the Senior row (row 2) even
 * though they have grid_row=3 in the underlying data. Keeps the data model
 * intact for any future return to four tiers.
 */
function effectiveRow(role: Role): number {
  return role.seniority === 'lead' ? SENIORITY_TO_ROW.senior : role.grid_row;
}

/**
 * Target page-container width that the map must fit inside (in pixels).
 * Page <main> is max-w-[1508px] − 2×24 (sm:px-6) = 1460px usable, but the
 * map targets ~40px less so Space (6 clusters, the widest industry) doesn't
 * sit flush against the page edges — mx-auto on the map div centers it,
 * leaving ~20px breathing room on each side. AM/Semi (5 clusters) are
 * narrower than this anyway and stay centered with more buffer.
 */
const TARGET_TOTAL_WIDTH = 1420;

// Inner sub-grid is capped at 3 × 3 — rows = salary tiers (top = highest),
// up to 3 roles per tier-row.
const MAX_SUB_COLS = 3;
const MAX_SUB_ROWS = 3;

// Column width is sized off the widest industry we render (Space, 6 clusters)
// so AM/Semi (5 clusters) and Space (6 clusters) all use the same per-cell
// dimensions. AM/Semi maps end up narrower than the container and center
// horizontally via the parent's mx-auto.
const REF_NUM_COLS = 6;

function roleSalary(r: Role): number {
  const lo = r.salary_min ?? 0;
  const hi = r.salary_max ?? 0;
  if (lo && hi) return (lo + hi) / 2;
  return lo || hi || 0;
}

/**
 * Lay out a cell's roles into a fixed 3-row × 3-col frame.
 * Returns exactly MAX_SUB_ROWS rows; empty rows are `[]`.
 *
 * Distribution rules ("hourglass" — keep top/bottom heavier, middle thinner,
 * no completely empty row AND no completely empty column when the cell has
 * enough roles to fill three):
 *   - 1 tier (close salaries) → spread salary-desc across all 3 rows so the
 *     bottom row isn't visually starved. Per-count splits:
 *       1 → [1,0,0],  2 → [2,0,0],  3 → [3,0,0],  4 → [2,1,1],
 *       5 → [2,1,2],  6 → [3,1,2],  7 → [3,1,3],  8 → [3,2,3],  9 → [3,3,3]
 *     (6 uses [3,1,2] instead of symmetric [2,2,2] because the latter with
 *     the diamond column rule below leaves col 1 entirely empty.)
 *   - 2 tiers, both with exactly 3 roles (the classic 3+3 split) → adjust to
 *     [3,1,2]: row 0 = full high tier (3 roles), row 1 = highest of low tier
 *     (boundary), row 2 = remaining 2 low-tier roles. Keeps high tier visible
 *     in row 0, fills all rows, and avoids the empty col 1.
 *   - 2 tiers, one row each (asymmetric counts like 2+1 or 1+2 — not 3+3) →
 *     row 0 + row 2, middle stays empty for max separation.
 *   - 2 tiers, 3 rows total (one tier was chunked into 2 rows) → fill all 3
 *     rows top-down in salary-desc order.
 *   - 3 tiers → row 0 / row 1 / row 2 in salary-desc order.
 *
 * Tier discovery:
 *   1. Sort roles salary desc (tie-break: id).
 *   2. Gap-based clustering — adjacent roles join the same cluster if their
 *      salary gap is within tolerance (15% of cell max salary, clamped to
 *      [$10K, $25K]).
 *   3. If chunked row count exceeds 3, merge the adjacent cluster pair with
 *      the smallest gap and retry — until rows ≤ 3.
 */
function layoutCellRoles(rolesInCell: Role[]): Role[][] {
  const empty: Role[][] = Array.from({ length: MAX_SUB_ROWS }, () => []);
  if (rolesInCell.length === 0) return empty;

  const sorted = [...rolesInCell].sort((a, b) => {
    const diff = roleSalary(b) - roleSalary(a);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const maxSal = roleSalary(sorted[0]);
  const threshold = Math.max(10000, Math.min(25000, maxSal * 0.15));

  let clusters: Role[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const gap = roleSalary(sorted[i - 1]) - roleSalary(sorted[i]);
    if (gap > threshold) clusters.push([sorted[i]]);
    else clusters[clusters.length - 1].push(sorted[i]);
  }

  const chunk = (c: Role[]): Role[][] => {
    const out: Role[][] = [];
    for (let i = 0; i < c.length; i += MAX_SUB_COLS) {
      out.push(c.slice(i, i + MAX_SUB_COLS));
    }
    return out;
  };
  const totalRowsFor = (cs: Role[][]) =>
    cs.reduce((s, c) => s + Math.ceil(c.length / MAX_SUB_COLS), 0);

  while (clusters.length > 1 && totalRowsFor(clusters) > MAX_SUB_ROWS) {
    let minGap = Infinity;
    let mergeAt = 0;
    for (let i = 0; i < clusters.length - 1; i++) {
      const lo = roleSalary(clusters[i][clusters[i].length - 1]);
      const hi = roleSalary(clusters[i + 1][0]);
      const gap = lo - hi;
      if (gap < minGap) { minGap = gap; mergeAt = i; }
    }
    clusters = [
      ...clusters.slice(0, mergeAt),
      [...clusters[mergeAt], ...clusters[mergeAt + 1]],
      ...clusters.slice(mergeAt + 2),
    ];
  }

  const out: Role[][] = [[], [], []];

  if (clusters.length === 1) {
    // 1-tier hourglass split (heavier top + bottom, thinner middle)
    const n = sorted.length;
    const hourglass: Record<number, [number, number, number]> = {
      1: [1, 0, 0], 2: [2, 0, 0], 3: [3, 0, 0],
      4: [2, 1, 1], 5: [2, 1, 2], 6: [3, 1, 2],
      7: [3, 1, 3], 8: [3, 2, 3], 9: [3, 3, 3],
    };
    const [a, b, c] = hourglass[Math.min(n, 9)];
    out[0] = sorted.slice(0, a);
    out[1] = sorted.slice(a, a + b);
    out[2] = sorted.slice(a + b, a + b + c);
    return out;
  }

  if (clusters.length === 2) {
    const [hi, lo] = clusters;
    // Classic 3+3 case → [3,1,2] keeps high tier intact at top, drops the
    // highest of the low tier into row 1 as a boundary, fills all rows + cols
    if (hi.length === 3 && lo.length === 3) {
      out[0] = hi.slice(0, 3);
      out[1] = [lo[0]];
      out[2] = lo.slice(1, 3);
      return out;
    }
    const blocks = clusters.map(chunk);
    const totalRows = blocks.reduce((s, b) => s + b.length, 0);
    if (totalRows === 2) {
      // 2 tiers, 1 row each (asymmetric counts) — skip middle for separation
      out[0] = blocks[0][0];
      out[2] = blocks[1][0];
      return out;
    }
    // 2 tiers, 3 rows total (one tier was chunked) — fill top-down
    let idx = 0;
    for (const block of blocks) {
      for (const row of block) {
        if (idx < MAX_SUB_ROWS) out[idx++] = row;
      }
    }
    return out;
  }

  // 3 tiers — fill all 3 rows in salary desc order
  const blocks = clusters.map(chunk);
  let idx = 0;
  for (const block of blocks) {
    for (const row of block) {
      if (idx < MAX_SUB_ROWS) out[idx++] = row;
    }
  }
  return out;
}

/**
 * Maps a role's index within its row to a 3-col-grid column slot.
 * "Symmetric diamond" — partial rows visually balance the cell:
 *   - 1 role  → col 1 (center)
 *   - 2 roles → cols 0 + 2 (edges)
 *   - 3 roles → cols 0, 1, 2 (full)
 */
function columnForIndex(rowLen: number, idxInRow: number): number {
  if (rowLen <= 1) return 1;
  if (rowLen === 2) return idxInRow === 0 ? 0 : 2;
  return idxInRow;
}

export function computeLayout(roles: Role[]): LayoutResult {
  const {
    CARD_W: MAX_CARD_W, STACK_GAP, ROW_GAP,
    HEADER_H, LEFT_W, OUTER_PAD,
  } = LAYOUT;

  // ── Step 1: figure out how many cluster columns we have ──────────────────
  const numCols = Math.max(...roles.map(r => r.grid_col)) + 1;

  // ── Step 2: per-cell salary-tier sub-grid ────────────────────────────────
  const cellGroups = new Map<string, Role[]>();
  roles.forEach(role => {
    const key = `${role.grid_col},${effectiveRow(role)}`;
    if (!cellGroups.has(key)) cellGroups.set(key, []);
    cellGroups.get(key)!.push(role);
  });

  const cellRows = new Map<string, Role[][]>();
  cellGroups.forEach((rolesInCell, key) => {
    cellRows.set(key, layoutCellRoles(rolesInCell));
  });

  // ── Step 3: derive COL_W and CARD_W ──────────────────────────────────────
  // COL_W is sized off REF_NUM_COLS (= 6, the widest industry) so cells are
  // identical across AM/Semi/Space. Every cell always reserves the full
  // MAX_SUB_COLS × MAX_SUB_ROWS frame — empty slots stay visually blank so
  // the 3×3 inner grid is consistent across all cells in the map.
  const COL_W = Math.floor((TARGET_TOTAL_WIDTH - LEFT_W - OUTER_PAD) / REF_NUM_COLS);
  const fitForSubCols = Math.floor((COL_W - (MAX_SUB_COLS - 1) * STACK_GAP) / MAX_SUB_COLS);
  const CARD_W = Math.min(MAX_CARD_W, fitForSubCols);
  // CARD_H = CARD_W → every card is a square, so the 3 × 3 inner grid and
  // the cell itself both come out square (symmetry the eye reads as ordered).
  const CARD_H = CARD_W;

  // ── Step 4: UNIFORM cell height across all cells (always 3 rows tall) ────
  const uniformCellH = MAX_SUB_ROWS * CARD_H + (MAX_SUB_ROWS - 1) * STACK_GAP;
  const rowBandHeight: Record<number, number> = {
    0: uniformCellH,
    1: uniformCellH,
    2: uniformCellH,
  };

  // ── Step 5: Y-start of each band (Senior on top in display order) ────────
  const rowStartY: Record<number, number> = {};
  let currentY = HEADER_H;
  SENIORITY_DISPLAY_ORDER.forEach(seniority => {
    const row = SENIORITY_TO_ROW[seniority];
    rowStartY[row] = currentY;
    currentY += uniformCellH + ROW_GAP;
  });

  // ── Step 6: compute each role's pixel position ───────────────────────────
  // Each cell hosts a fixed 3-col × 3-row inner frame. Roles left-pack into
  // their row (col 0 first, then col 1, then col 2) so col 0 stays aligned
  // vertically across all rows and across cells in the same cluster column.
  // Empty trailing slots leave visible whitespace on the right.
  const fullRowContent = MAX_SUB_COLS * CARD_W + (MAX_SUB_COLS - 1) * STACK_GAP;
  const cellInnerXPad  = (COL_W - fullRowContent) / 2;

  const positions = new Map<string, CardPosition>();
  roles.forEach(role => {
    const row  = effectiveRow(role);
    const key  = `${role.grid_col},${row}`;
    const rows = cellRows.get(key)!;

    let subRow = 0;
    let idxInRow = 0;
    let rowLen = 0;
    for (let i = 0; i < rows.length; i++) {
      const idx = rows[i].findIndex(r => r.id === role.id);
      if (idx >= 0) { subRow = i; idxInRow = idx; rowLen = rows[i].length; break; }
    }
    const subCol = columnForIndex(rowLen, idxInRow);

    const x = LEFT_W + role.grid_col * COL_W + cellInnerXPad + subCol * (CARD_W + STACK_GAP);
    const y = rowStartY[row] + subRow * (CARD_H + STACK_GAP);

    positions.set(role.id, {
      x,
      y,
      cx: x + CARD_W / 2,
      // cy = visual center of the circle, NOT the card's geometric middle.
      // RoleCard's button has `pt-1` (4px) + circle (NODE_R*2 tall) + title BELOW.
      cy: y + 4 + LAYOUT.NODE_R,
      w:  CARD_W,
      h:  CARD_H,
    });
  });

  return {
    positions,
    totalWidth:  LEFT_W + numCols * COL_W + OUTER_PAD,
    totalHeight: currentY + OUTER_PAD,
    rowStartY,
    rowBandHeight,
    numCols,
    colW:  COL_W,
    cardW: CARD_W,
  };
}
