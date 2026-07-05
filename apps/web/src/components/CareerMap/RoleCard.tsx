'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { Role } from '@/lib/types';
import type { CardPosition } from '@/lib/map-layout';
import { LAYOUT } from '@/lib/map-layout';
import { CLUSTER_COLORS, formatSalary } from './constants';

// Degree label used in the hover tooltip (compact form).
const DEGREE_TOOLTIP: Record<string, string> = {
  hs:        'High School Diploma',
  '2yr':     "Associate's Degree Recommended",
  '4yr':     'College Degree Required',
  graduate:  'Graduate Degree Required',
  sometimes: 'Degree Sometimes Required',
};

// Halo alpha matches the cell tier intensity so the halo "feels native" to
// the cell — Entry roles get a light halo, Senior roles get a saturated one.
const HALO_ALPHA_BY_SENIORITY: Record<string, string> = {
  senior: 'FF',
  lead:   'FF',
  mid:    'FF',
  entry:  'FF',
};

interface Props {
  role:           Role;
  position:       CardPosition;
  isSelected:     boolean;
  isLastInPath:   boolean;
  isDimmed:       boolean;
  isAdjacent:     boolean;
  isRecommended:  boolean;
  industryColor:  string;
  industrySlug:   string;
  /** Topmost row (Senior/Lead) — no upper arrows, all clicks force 'down'. */
  isTopRow:       boolean;
  /** Bottommost row (Entry) — no lower arrows, all clicks force 'up'. */
  isBottomRow:    boolean;
  /** Worldwide approved-match count — controls the Openings button enabled state. */
  anyCount?:      number;
  onClick:        (id: string, direction: 'up' | 'down') => void;
  onDoubleClick?: (id: string) => void;
  onShowDetails:  (id: string) => void;
}

type ArrowZone = 'up' | 'down' | 'neutral';

/** 6 small arrows fanning out near the bloom. Behavior:
 *  • Straight up (0°) + straight down (180°) are ALWAYS visible during hover.
 *  • When zone === 'up'   → the upper ±45° pair fades in from the center AND
 *    the straight-up arrow nudges slightly OUTWARD to "make room" for them.
 *  • When zone === 'down' → mirror for the lower pair + straight-down arrow.
 *  • zone === 'neutral' (left, right, or deadzone) → only the two straight
 *    arrows show, each at its resting position.
 *  Result: as the cursor enters the upper or lower zone, the 3-arrow cluster
 *  briefly slides outward together, then settles. */
function FourArrows({
  size, zone, hideUp, hideDown,
}: {
  size: number; zone: ArrowZone; hideUp: boolean; hideDown: boolean;
}) {
  type Group = 'up' | 'down';
  type ArrowState = 'hidden' | 'rest' | 'pushed';
  const allArrows: { angle: number; group: Group; alwaysOn: boolean }[] = [
    { angle: -45, group: 'up',   alwaysOn: false },
    { angle:   0, group: 'up',   alwaysOn: true  },
    { angle:  45, group: 'up',   alwaysOn: false },
    { angle: 135, group: 'down', alwaysOn: false },
    { angle: 180, group: 'down', alwaysOn: true  },
    { angle: 225, group: 'down', alwaysOn: false },
  ];
  const arrows = allArrows.filter(a => (a.group === 'up' ? !hideUp : !hideDown));

  // Map (group active?, alwaysOn?) → visual state.
  //   group active = the cursor zone matches this arrow's group.
  //   - active + visible    → 'pushed' (nudged outward, fully opaque)
  //   - inactive + alwaysOn → 'rest' (canonical position, fully opaque)
  //   - inactive + angled   → 'hidden' (shifted inward, opacity 0)
  function stateFor(group: Group, alwaysOn: boolean): ArrowState {
    if (group === zone) return 'pushed';
    if (alwaysOn)       return 'rest';
    return 'hidden';
  }

  // Local y is the INWARD radial direction (canonical arrow points UP = -y).
  //   • Hidden: shifted inward (+4) and invisible.
  //   • Rest:   canonical position (0).
  //   • Pushed: nudged outward (-2) so the 3 arrows of the active group sit
  //             slightly further from the center than at rest.
  const opacityFor   = (s: ArrowState) => (s === 'hidden' ? 0 : 1);
  const translateFor = (s: ArrowState) =>
    s === 'hidden' ? 'translate(0px, 4px)' :
    s === 'pushed' ? 'translate(0px, -2px)' :
                     'translate(0px, 0px)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="white"
      strokeWidth={0.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {arrows.map(({ angle, group, alwaysOn }) => {
        const s = stateFor(group, alwaysOn);
        return (
          // Outer <g>: rotates the arrow to its angular position.
          // Inner <g>: handles the fade + radial slide in the rotated frame.
          <g key={angle} transform={`rotate(${angle} 16 16)`}>
            <g
              style={{
                opacity:    opacityFor(s),
                transform:  translateFor(s),
                transition: 'opacity 220ms ease-out, transform 280ms ease-out',
              }}
            >
              {/* canonical up arrow: stem y=9→5, arrowhead at tip.
                  Base at radius 7 — ~2-unit gap from the inner core.
                  Tip at radius 11. Pushed state (-2) lands tip at radius 13
                  — comfortable distance from the bigger bloom edge (~18). */}
              <line     x1="16" y1="9" x2="16" y2="5" />
              <polyline points="14,7 16,5 18,7" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

export default function RoleCard({
  role, position, isSelected, isLastInPath, isDimmed, isAdjacent, industrySlug,
  isTopRow, isBottomRow,
  anyCount,
  onClick, onDoubleClick, onShowDetails,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const [openingsHover, setOpeningsHover] = useState(false);
  const [zone, setZone] = useState<ArrowZone>('neutral');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const CARD_W = position.w;
  const CARD_H = position.h;
  const { NODE_R, NODE_R_ACTIVE } = LAYOUT;

  const clusterColor = CLUSTER_COLORS[role.cluster];
  const clusterHex   = clusterColor?.light ?? '#6b7280';
  const haloAlpha    = HALO_ALPHA_BY_SENIORITY[role.seniority] ?? 'FF';
  const haloColor    = `${clusterHex}${haloAlpha}`;

  // Last-clicked role OR hovered role gets the big bloom + chevrons + tooltip.
  const showActive    = isLastInPath || (hovered && !isDimmed);
  // Earlier path members — shrink to a small solid cluster-colored dot.
  const isCommitted   = isSelected && !isLastInPath;
  // Adjacent (next-step option) — same circle visual but gets a dark pill label
  // floating below it identifying it as a click target.
  const showPillLabel = isCommitted || isAdjacent;

  const openTooltip = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setHovered(true);
  };
  const closeTooltip = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHovered(false), 120);
    setZone('neutral');
  };

  /** Compute which arrow-zone the cursor is in, relative to the visual center
   *  of the circle (NOT the card's geometric center — cf. map-layout.ts cy).
   *
   *  Up zone:   angle ∈ (−135°, −45°)  — upper quadrant
   *  Down zone: angle ∈ ( 45°, 135°)    — lower quadrant
   *  Otherwise (left, right, or within 5px deadzone) → neutral.
   *
   *  Top-row roles suppress the up zone (no upper arrows ever fan); bottom-row
   *  roles suppress the down zone. */
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.left + CARD_W / 2;
    const cy = rect.top  + 4 + NODE_R;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (Math.hypot(dx, dy) < 5) {
      setZone('neutral');
      return;
    }
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if      (angle > -135 && angle < -45 && !isTopRow)    setZone('up');
    else if (angle >   45 && angle < 135 && !isBottomRow) setZone('down');
    else                                                   setZone('neutral');
  };

  /** Which half of the circle the click landed in. Top/bottom rows force the
   *  only valid direction regardless of click Y; middle rows split by Y. */
  const directionForClick = (clientY: number): 'up' | 'down' => {
    if (isTopRow)    return 'down';
    if (isBottomRow) return 'up';
    if (!containerRef.current) return 'down';
    const rect = containerRef.current.getBoundingClientRect();
    const centerY = rect.top + 4 + NODE_R;
    return clientY < centerY ? 'up' : 'down';
  };

  // Softer dim than before — reference barely fades non-related roles.
  const opacityClass = isDimmed ? 'opacity-60' : 'opacity-100';

  // Committed dot — same size as the resting circle (so X shrinks back to its
  // original dimension when Y is clicked, not smaller).
  const COMMITTED_R = NODE_R;

  return (
    <div
      ref={containerRef}
      className={`absolute ${opacityClass} transition-opacity duration-150`}
      style={{ left: position.x, top: position.y, width: CARD_W, height: CARD_H, zIndex: isSelected ? 20 : hovered ? 30 : 1 }}
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
      onMouseMove={showActive ? handleMouseMove : undefined}
    >
      {/* Hover tooltip — right side of the circle. */}
      {hovered && !isDimmed && (
        <div
          className="absolute z-50 left-full top-1/2 -translate-y-1/2 pl-2 w-60"
          onMouseEnter={openTooltip}
          onMouseLeave={closeTooltip}
        >
          <div
            className="relative bg-white text-gray-900 rounded border border-gray-200 px-3.5 py-3 text-xs"
            style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.18)' }}
          >
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setHovered(false); }}
              aria-label="Close preview"
              className="absolute top-1.5 right-1.5 w-5 h-5 rounded text-gray-400 hover:text-gray-700
                         hover:bg-gray-100 flex items-center justify-center text-base leading-none
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              ×
            </button>

            <p className="font-semibold text-[13px] leading-snug mb-2 pr-5">{role.title}</p>

            <div className="text-[11px] text-gray-700 flex items-center gap-1 mb-1">
              <span className="text-sm leading-none" style={{ color: clusterHex }} aria-hidden="true">♦</span>
              <span>{DEGREE_TOOLTIP[role.degree_required] ?? 'College Degree Required'}</span>
            </div>

            <p className="text-[11px] text-gray-700 mb-3">
              {role.salary_range || `${formatSalary(role.salary_min, role.salary_max)} / year`}
            </p>

            {/* Phase 5 — Details + View Openings, side-by-side. The button
                indicator replaces the amber dot from Phase 4 (button is itself
                the cue that openings exist). */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onShowDetails(role.id); }}
                className="inline-block px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wide text-white
                           hover:opacity-90 transition-opacity
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ backgroundColor: clusterHex }}
              >
                Details
              </button>

              {anyCount && anyCount > 0 ? (
                <Link
                  href={`/${industrySlug}/role/${role.id}/openings`}
                  onClick={e => e.stopPropagation()}
                  onMouseEnter={() => setOpeningsHover(true)}
                  onMouseLeave={() => setOpeningsHover(false)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-[11px] font-semibold
                             uppercase tracking-wide border transition-all duration-200 ease-out
                             hover:-translate-y-0.5
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  style={{
                    borderColor:     clusterHex,
                    backgroundColor: openingsHover ? clusterHex : '#ffffff',
                    color:           openingsHover ? '#ffffff' : clusterHex,
                    boxShadow:       openingsHover ? `0 6px 14px -4px ${clusterHex}66` : 'none',
                  }}
                  title={`${anyCount} live opening${anyCount === 1 ? '' : 's'}`}
                >
                  Openings
                  <span
                    className="inline-block min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-4
                               text-center transition-colors duration-200"
                    style={{
                      backgroundColor: openingsHover ? '#ffffff' : clusterHex,
                      color:           openingsHover ? clusterHex : '#ffffff',
                    }}
                  >
                    {anyCount > 9 ? '9+' : anyCount}
                  </span>
                </Link>
              ) : (
                <span
                  className="inline-block px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wide
                             text-gray-400 border border-gray-200 bg-gray-50 cursor-not-allowed"
                  title="No live openings for this role yet — check back next week"
                  aria-disabled="true"
                >
                  No openings
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={e => { e.stopPropagation(); onClick(role.id, directionForClick(e.clientY)); }}
        onDoubleClick={e => { e.stopPropagation(); onDoubleClick?.(role.id); }}
        aria-pressed={isSelected}
        aria-label={`${role.title}${isSelected ? ' (in path)' : ''}`}
        className="w-full h-full flex flex-col items-center gap-1 px-1 pt-1
                   cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
      >
        {/* Circle area. Three mutually-exclusive looks:
            • showActive   → big solid bloom + 4 outward chevrons (hover or last-in-path)
            • isCommitted  → small solid cluster-colored dot (earlier path members)
            • otherwise    → small white circle with cluster-color outline + tiny ◆ degree marker */}
        <span
          className="relative flex-shrink-0"
          style={{ width: NODE_R * 2, height: NODE_R * 2 }}
          aria-hidden="true"
        >
          {/* Bloomed halo — solid (no transparency) so the inner white core is
              fully covered. Scales 0.2 → 1 with 800ms ease-out. */}
          <span
            className="absolute rounded-full pointer-events-none
                       transition-[transform,opacity] ease-out duration-[800ms]
                       flex items-center justify-center"
            style={{
              width:           NODE_R_ACTIVE * 2,
              height:          NODE_R_ACTIVE * 2,
              top:             '50%',
              left:            '50%',
              transformOrigin: 'center center',
              transform:       `translate(-50%, -50%) scale(${showActive ? 1 : 0.2})`,
              backgroundColor: haloColor,
              opacity:         showActive ? 1 : 0,
              zIndex:          2,
            }}
          >
            <FourArrows
              size={Math.round(NODE_R_ACTIVE * 1.95)}
              zone={zone}
              hideUp={isTopRow}
              hideDown={isBottomRow}
            />
          </span>

          {/* Committed dot (in path but not last) — small solid cluster-colored circle. */}
          {isCommitted && !showActive && (
            <span
              className="absolute rounded-full"
              style={{
                width:  COMMITTED_R * 2,
                height: COMMITTED_R * 2,
                top:    '50%',
                left:   '50%',
                transform: 'translate(-50%, -50%)',
                backgroundColor: clusterHex,
                zIndex: 1,
              }}
            />
          )}

          {/* Inner white core circle. Shown in:
              - resting / adjacent states            (default look)
              - active hover OR last-in-path         (white core inside bloom)
              - hovered committed role                (treated like fresh hover —
                                                       see [[committed-hover-rule]])
              Hidden only when the role is committed AND the bloom isn't active
              — in that case the small cluster-colored "committed dot" takes its
              place. */}
          {(!isCommitted || showActive) && (
            <span
              className="absolute inset-0 rounded-full bg-white"
              style={{
                border: '0.1px solid #374151',
                zIndex: 3,
              }}
            />
          )}

          {/* ◆ degree marker — CSS-rotated square, pixel-centered inside the white
              core. Visible whenever the white inner circle is visible (resting,
              adjacent, hover, last-in-path). Hidden only on committed-non-active
              roles where the white core is replaced by the cluster-colored dot.
              Only roles requiring a 4-year degree or higher get the diamond;
              HS / 2yr / "sometimes" roles render with a plain white core. */}
          {(!isCommitted || showActive) &&
            (role.degree_required === '4yr' || role.degree_required === 'graduate') && (
            <span
              className="absolute pointer-events-none"
              style={{
                top:    '50%',
                left:   '50%',
                width:  NODE_R,
                height: NODE_R,
                transform: 'translate(-50%, -50%) rotate(45deg)',
                backgroundColor: clusterHex,
                zIndex: 5,
              }}
              aria-hidden="true"
            />
          )}

          {/* Phase 5 — amber dot removed. The "View openings" button in the
              hover tooltip is now the hiring indicator. */}
        </span>

        {/* Label area — three modes:
            • showActive   → hidden (tooltip takes over)
            • showPillLabel→ dark gray pill with white title text
            • otherwise    → normal small gray title text */}
        {showActive ? (
          <span
            className="text-[11px] leading-tight text-center px-0.5 line-clamp-2 font-medium
                       transition-opacity ease-out duration-[800ms]"
            style={{ opacity: 0 }}
          >
            {role.title}
          </span>
        ) : showPillLabel ? (
          <span
            className="inline-block max-w-full px-2 py-0.5 rounded text-[10.5px] font-semibold
                       leading-tight text-white text-center bg-gray-700 line-clamp-2"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}
          >
            {role.title}
          </span>
        ) : (
          <span
            className="text-[11px] text-gray-800 leading-tight text-center px-0.5 line-clamp-2 font-medium"
          >
            {role.title}
          </span>
        )}

        {/* Phase 4 — count moved off the card (was crowding the title) into
            the upper-right amber dot + hover tooltip + role detail modal. */}
      </button>
    </div>
  );
}
