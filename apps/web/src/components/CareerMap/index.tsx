'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { IndustryData } from '@/lib/types';
import {
  computeLayout, LAYOUT, SENIORITY_DISPLAY_ORDER,
  SENIORITY_LABELS, SENIORITY_TO_ROW,
} from '@/lib/map-layout';
import { roleMatchesFilter } from '@/lib/role-utils';
import { passesDirectionFilter, type VerticalPos } from '@/lib/role-direction';
import { CLUSTER_COLORS } from './constants';
import FilterBar from './FilterBar';
import HiringFilter from './HiringFilter';
import MobileList from './MobileList';
import RoleCard from './RoleCard';
import PathwayLines from './PathwayLines';
import PathChain from './PathChain';
import CareerPathPanel from './CareerPathPanel';
import SaveShareModal from './SaveShareModal';
import ErrorModal from './ErrorModal';
import RoleDetailModal from './RoleDetailModal';

interface Props {
  data: IndustryData;
}

/** Map keyed by lowercased role title → live count + hiring company list. */
type LiveCounts = Record<string, { count: number; companies: string[] }>;

export default function CareerMap({ data }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  const { roles, pathways, clusters, industry } = data;

  const roleById = useMemo(() => new Map(roles.map(r => [r.id, r])), [roles]);

  // Path chain — hydrated from ?path=am-r-01,am-r-05 on first render.
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const raw = searchParams.get('path');
    if (!raw) {
      const single = searchParams.get('role');
      return single && roleById.has(single) ? [single] : [];
    }
    return raw.split(',').map(s => s.trim()).filter(id => roleById.has(id));
  });
  const [searchQuery,    setSearchQuery]    = useState('');
  const [showOnlyHiring, setShowOnlyHiring] = useState(false);
  const [saveOpen,       setSaveOpen]       = useState(false);
  const [errorOpen,      setErrorOpen]      = useState(false);
  const [detailRoleId,   setDetailRoleId]   = useState<string | null>(null);
  // Direction of the most recent click on the last role's circle.
  //   'up'   → diverge (edges fan OUT to higher / same-row-higher adjacents)
  //   'down' → converge (edges flow IN from lower / same-row-lower adjacents)
  // Equal-salary same-row adjacents (midpoints within $1000) show in both
  // modes — but only when the source role sits in a middle seniority row.
  const [lastClickDirection, setLastClickDirection] = useState<'up' | 'down' | null>(null);
  // Phase 5 — worldwide counts drive the Openings button on every role card
  // AND the modal's hiring CTA. Default-worldwide means we don't need a
  // separate US-cached fetch anymore — country filtering lives on the
  // /openings page where the user picks a specific country if they want.
  const [anyCounts, setAnyCounts] = useState<LiveCounts>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/jobs/counts?industry=${encodeURIComponent(industry.slug)}&country=worldwide`)
      .then(r => (r.ok ? r.json() : {}))
      .then((data: LiveCounts) => {
        if (!cancelled) setAnyCounts(data || {});
      })
      .catch(() => { /* silent — UI just shows "No openings" buttons */ });
    return () => { cancelled = true; };
  }, [industry.slug]);

  const getAnyCount = useCallback(
    (title: string) => anyCounts[title.toLowerCase().trim()]?.count ?? 0,
    [anyCounts],
  );

  // Keep the path in sync with the URL after mount. The initializer above only
  // runs once, so anything that rewrites ?path= later — dolphIQ applying a
  // recommended path, or browser back/forward on a shared link — must be
  // mirrored here. The string-compare guard makes the map's own syncUrl()
  // round-trip a no-op, so user clicks don't loop through this effect.
  useEffect(() => {
    const raw = searchParams.get('path');
    const ids = raw !== null
      ? raw.split(',').map(s => s.trim()).filter(id => roleById.has(id))
      : (() => {
          const single = searchParams.get('role');
          return single && roleById.has(single) ? [single] : [];
        })();
    setSelectedIds(prev => {
      if (prev.join(',') === ids.join(',')) return prev;
      setLastClickDirection(null);
      return ids;
    });
  }, [searchParams, roleById]);

  // Set of role IDs that should be dimmed (half-opacity) when the "Show only
  // hiring" filter is on — roles whose worldwide open-jobs count is zero.
  // Dim instead of hide so the map layout stays stable: gaps in the grid
  // would be more disorienting than a faded card. Empty set when toggle off.
  const dimmedByHiringFilter = useMemo(() => {
    if (!showOnlyHiring) return new Set<string>();
    return new Set(roles.filter(r => getAnyCount(r.title) === 0).map(r => r.id));
  }, [showOnlyHiring, roles, getAnyCount]);

  // Counts shown next to the filter label — "Show only hiring (84/158)".
  // Uses worldwide counts that the map already fetched.
  const hiringCount = useMemo(
    () => roles.filter(r => getAnyCount(r.title) > 0).length,
    [roles, getAnyCount],
  );

  const layout = useMemo(() => computeLayout(roles), [roles]);
  const { positions, totalWidth, totalHeight, rowStartY, rowBandHeight, colW: COL_W } = layout;

  // Global vertical extents — used to decide which role circles are at the
  // absolute top / bottom of the map. Only those suppress one direction of
  // arrows; every other role (even other "Senior" or "Entry" stack rows)
  // gets both up and down arrows.
  const verticalPosById = useMemo(() => {
    let topY = Infinity;
    let bottomY = -Infinity;
    for (const p of positions.values()) {
      if (p.cy < topY)    topY    = p.cy;
      if (p.cy > bottomY) bottomY = p.cy;
    }
    const m = new Map<string, VerticalPos>();
    for (const [id, p] of positions.entries()) {
      m.set(id, { y: p.cy, isMapTop: p.cy === topY, isMapBottom: p.cy === bottomY });
    }
    return m;
  }, [positions]);

  const filteredIds = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return new Set(
      roles
        .filter(r => roleMatchesFilter(r, searchQuery.trim(), 'all', 'all'))
        .map(r => r.id),
    );
  }, [roles, searchQuery]);

  /** Adjacency map { roleId → next-step role IDs } sourced from role.adjacent_role_ids
   *  and symmetrized — if X lists Y as an adjacent, Y also gets X. The curated
   *  JSONs (Semi entirely, half of Space) only encode one direction of each
   *  pairing, so without mirroring those columns' senior cells would never
   *  converge to their mid/entry counterparts even though the relationship is
   *  semantically symmetric. Mirroring makes "X→Y" and "Y→X" always agree. */
  const adjacencyById = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of roles) {
      if (!m.has(r.id)) m.set(r.id, new Set());
      for (const adj of r.adjacent_role_ids) {
        m.get(r.id)!.add(adj);
        if (!m.has(adj)) m.set(adj, new Set());
        m.get(adj)!.add(r.id);
      }
    }
    const out = new Map<string, string[]>();
    for (const [id, set] of m) out.set(id, Array.from(set));
    return out;
  }, [roles]);

  /** Constrained click model:
   *    - empty path     → any role can be clicked (starts a fresh path)
   *    - non-empty path → only the LAST role's adjacency (minus the path itself)
   *                       can be clicked to extend.  Off-list roles are not
   *                       single-clickable; only double-tap resets.
   *
   *  Direction filter: when lastClickDirection is set, the adjacency is
   *  further pruned to only the diverge/converge subset for that direction. */
  const possibleNextIds = useMemo(() => {
    if (selectedIds.length === 0) return new Set<string>();
    const lastId   = selectedIds[selectedIds.length - 1];
    const lastRole = roleById.get(lastId);
    const lastPos  = verticalPosById.get(lastId);
    if (!lastRole || !lastPos) return new Set<string>();
    const inPath = new Set(selectedIds);
    const adjIds = (adjacencyById.get(lastId) ?? []).filter(id => !inPath.has(id));
    if (!lastClickDirection) return new Set(adjIds);
    return new Set(
      adjIds.filter(id => {
        const y    = roleById.get(id);
        const yPos = verticalPosById.get(id);
        if (!y || !yPos) return false;
        return passesDirectionFilter(lastRole, y, lastClickDirection, lastPos, yPos);
      }),
    );
  }, [selectedIds, adjacencyById, roleById, verticalPosById, lastClickDirection]);

  const highlightedPathwayIds = useMemo(() => {
    const set = new Set<string>();
    selectedIds.forEach(id => {
      roleById.get(id)?.pathway_ids.forEach(pid => set.add(pid));
    });
    return set;
  }, [selectedIds, roleById]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function getVisibility(roleId: string): 'selected' | 'adjacent' | 'normal' | 'dimmed' {
    const filteredOut    = filteredIds !== null && !filteredIds.has(roleId);
    const dimmedByHiring = dimmedByHiringFilter.has(roleId);
    if (filteredOut)    return 'dimmed';
    if (dimmedByHiring) return 'dimmed';
    if (selectedIdSet.has(roleId)) return 'selected';
    if (selectedIds.length > 0 && possibleNextIds.has(roleId)) return 'adjacent';
    if (selectedIds.length > 0) return 'dimmed';
    return 'normal';
  }

  const syncUrl = useCallback((ids: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('role');
    if (ids.length > 0) params.set('path', ids.join(','));
    else params.delete('path');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, router, pathname]);

  /** Single-click — only manages the path; never wipes it accidentally:
   *    • path empty                                   → start path with this role
   *    • role is in current possible-next (adjacent) → append to path
   *    • role already in the path                     → truncate path to end here
   *    • off-list                                     → no-op (protect the path)
   *  Every click also records the clicked half (up/down) so the next round of
   *  possible-next adjacents are pruned by the diverge/converge filter. */
  const handleRoleClick = useCallback((id: string, direction: 'up' | 'down') => {
    setLastClickDirection(direction);
    if (selectedIds.length === 0) {
      const next = [id];
      setSelectedIds(next);
      syncUrl(next);
      return;
    }
    if (selectedIdSet.has(id)) {
      // Already in path → truncate to this role; its adjacency fan re-appears.
      const idx = selectedIds.indexOf(id);
      const next = selectedIds.slice(0, idx + 1);
      setSelectedIds(next);
      syncUrl(next);
      return;
    }
    if (possibleNextIds.has(id)) {
      const next = [...selectedIds, id];
      setSelectedIds(next);
      syncUrl(next);
      return;
    }
    // Off-list → no-op. Use double-tap to clear if you want to start over.
  }, [selectedIds, selectedIdSet, possibleNextIds, syncUrl]);

  /** Double-click anywhere — clears the entire path. */
  const handleRoleDoubleClick = useCallback(() => {
    setSelectedIds([]);
    setLastClickDirection(null);
    syncUrl([]);
  }, [syncUrl]);

  const handleClearPath = useCallback(() => {
    setSelectedIds([]);
    setLastClickDirection(null);
    syncUrl([]);
  }, [syncUrl]);

  // Save & Share opens the modal (Phase J4)
  const handleShare = useCallback(() => {
    setSaveOpen(true);
  }, []);

  // Esc clears the entire path
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.length > 0) handleClearPath();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClearPath, selectedIds.length]);

  // COL_W is destructured from the layout result above (per-industry dynamic value);
  // the remaining constants are global from LAYOUT.
  const { HEADER_H, LEFT_W, OUTER_PAD, ROW_GAP } = LAYOUT;

  const selectedLabel = selectedIds.length === 1
    ? '1 Job Selected'
    : `${selectedIds.length} Jobs Selected`;

  return (
    <div id="career-map" className="flex flex-col gap-4">

      {/* Intro + instructions block (reference layout: heading + 3-step list on left, search on right) */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 mb-1.5">
            Paths to new career opportunities in the {industry.name} industry.
          </p>
          <ol className="text-sm text-gray-700 space-y-0.5 leading-relaxed">
            <li>(1) Click jobs that interest you and follow the lines that appear to see where they can take you.</li>
            <li>(2) Click the next job to build entire chains of career paths across as many jobs as you&apos;d like!</li>
            <li>(3) Click &quot;Clear Map&quot; to start over.</li>
          </ol>
        </div>
        <div className="md:flex-shrink-0 md:w-[400px] flex flex-col gap-2 items-end">
          <FilterBar searchQuery={searchQuery} onSearch={setSearchQuery} />
          <HiringFilter
            checked={showOnlyHiring}
            onChange={setShowOnlyHiring}
            hiringCount={hiringCount}
            totalCount={roles.length}
          />
        </div>
      </div>

      {/* Control row: learning-paths anchor (left) · jobs-selected counter (center) · CLEAR MAP (right) */}
      <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
        <a
          href="#learning-paths"
          onClick={e => {
            e.preventDefault();
            document.getElementById('learning-paths')?.scrollIntoView({
              behavior: 'smooth',
              block:    'start',
            });
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-300 bg-white
                     text-gray-700 hover:bg-gray-50 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          See related learning paths below
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </a>
        <span className="font-semibold text-gray-700" aria-live="polite">
          {selectedLabel}
        </span>
        <button
          type="button"
          onClick={handleClearPath}
          disabled={selectedIds.length === 0}
          className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-900 disabled:opacity-40
                     disabled:cursor-not-allowed transition-colors uppercase font-semibold tracking-wide text-xs
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          Clear Map
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <polyline points="3 4 3 10 9 10" />
          </svg>
        </button>
      </div>

      {/* MOBILE: list view */}
      <div className="md:hidden">
        <MobileList
          roles={(filteredIds ? roles.filter(r => filteredIds.has(r.id)) : roles)
                  .filter(r => !dimmedByHiringFilter.has(r.id))}
          clusters={clusters}
          industrySlug={industry.slug}
        />
      </div>

      {/* DESKTOP: interactive map canvas (no outer scroll wrapper — the
          layout engine sizes COL_W to fit the page container exactly). */}
      <div className="hidden md:block">
        <div
          className="relative mx-auto bg-gray-50/40"
          style={{ width: totalWidth, height: totalHeight, userSelect: 'none' }}
          role="region"
          aria-label={`${industry.name} career pathway map`}
          onDoubleClick={handleRoleDoubleClick}
        >
            {/* Per-tier tints: each column's hue, darkest at Senior (top) and
                progressively lighter going down. Continuous bands — no white
                gap between tiers; the visual separation is the horizontal
                divider lines drawn further down. */}
            {clusters.map((cluster, i) => {
              const color = CLUSTER_COLORS[cluster];
              if (!color) return null;
              // Vertical span for each tier band, with continuous fill
              // (each band extends half-way into the gap above and below).
              const midRow    = SENIORITY_TO_ROW.mid;
              const entryRow  = SENIORITY_TO_ROW.entry;

              const seniorTop    = HEADER_H;
              const seniorBottom = rowStartY[midRow] - ROW_GAP / 2;
              const midTop       = seniorBottom;
              const midBottom    = rowStartY[entryRow] - ROW_GAP / 2;
              const entryTop     = midBottom;
              const entryBottom  = totalHeight - OUTER_PAD;

              // Alpha hex per tier — change these three to tune the gradient.
              // 'FF' = fully opaque, '00' = invisible.
              const tints = [
                { key: 'senior', top: seniorTop, height: seniorBottom - seniorTop, alpha: 'BF' }, // ~75% darkest
                { key: 'mid',    top: midTop,    height: midBottom - midTop,       alpha: '80' }, // ~50% medium
                { key: 'entry',  top: entryTop,  height: entryBottom - entryTop,   alpha: '40' }, // ~25% lightest
              ];

              return tints.map(t => (
                <div
                  key={`tint-${cluster}-${t.key}`}
                  className="absolute"
                  style={{
                    left:   LEFT_W + i * COL_W,
                    top:    t.top,
                    width:  COL_W,
                    height: t.height,
                    backgroundColor: `${color.band}${t.alpha}`,
                  }}
                />
              ));
            })}

            {/* Cluster headers — solid colored band, uppercase white text */}
            <div
              className="absolute top-0 flex"
              style={{ left: LEFT_W, height: HEADER_H, width: totalWidth - LEFT_W - OUTER_PAD }}
            >
              {clusters.map(cluster => {
                const color = CLUSTER_COLORS[cluster];
                return (
                  <div
                    key={cluster}
                    className="flex items-center justify-center px-2"
                    style={{ width: COL_W, backgroundColor: color?.band ?? '#6b7280' }}
                  >
                    <span className="text-[13px] font-bold uppercase text-white text-center leading-tight tracking-wide">
                      {cluster}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Seniority row labels */}
            {SENIORITY_DISPLAY_ORDER.map(seniority => {
              const row = SENIORITY_TO_ROW[seniority];
              const y   = rowStartY[row];
              const h   = rowBandHeight[row];
              return (
                <div
                  key={seniority}
                  className="absolute flex items-center justify-end pr-3"
                  style={{ left: 0, top: y, width: LEFT_W - 8, height: h }}
                >
                  <span className="text-[12px] font-semibold text-gray-700 tracking-wide text-right leading-tight">
                    {SENIORITY_LABELS[seniority]}
                  </span>
                </div>
              );
            })}

            {/* Vertical column dividers — soft black line between columns. */}
            {clusters.map((_, i) => {
              if (i === 0) return null;
              return (
                <div
                  key={`col-divider-${i}`}
                  className="absolute bg-black/8"
                  style={{
                    left:   LEFT_W + i * COL_W - 0.5,
                    top:    HEADER_H,
                    width:  1,
                    height: totalHeight - HEADER_H - OUTER_PAD,
                  }}
                />
              );
            })}

            {/* Vertical gutter divider — separates the "Senior/Mid/Entry"
                row labels (left side) from the role cells. */}
            <div
              className="absolute bg-black/15"
              style={{
                left:   LEFT_W - 0.5,
                top:    HEADER_H,
                width:  1,
                height: totalHeight - HEADER_H - OUTER_PAD,
              }}
            />

            {/* Horizontal tier dividers — between Senior/Mid and Mid/Entry. */}
            {(['mid', 'entry'] as const).map(seniority => {
              const row = SENIORITY_TO_ROW[seniority];
              const y   = rowStartY[row] - ROW_GAP / 2;
              return (
                <div
                  key={`row-divider-${seniority}`}
                  className="absolute bg-black/15"
                  style={{
                    left:   0,
                    top:    y - 0.5,
                    width:  totalWidth - OUTER_PAD,
                    height: 1,
                  }}
                />
              );
            })}

            {/* 6-edge polygon outer border — fully closes the top-left notch.
                Outer perimeter: top (above cluster header), right, bottom, left
                (beside role cells). Inner L: top of row-label gutter (edge 5)
                and left of column-header strip (edge 6) meet at (LEFT_W, HEADER_H)
                to close the notch.                                              */}
            {/* edge 1 — outer top */}
            <div className="absolute bg-black/40"
                 style={{ left: LEFT_W,  top: 0, width: (totalWidth - OUTER_PAD) - LEFT_W, height: 1 }} />
            {/* edge 2 — outer right */}
            <div className="absolute bg-black/40"
                 style={{ left: totalWidth - OUTER_PAD - 0.5, top: 0, width: 1, height: totalHeight - OUTER_PAD }} />
            {/* edge 3 — outer bottom */}
            <div className="absolute bg-black/40"
                 style={{ left: 0, top: totalHeight - OUTER_PAD - 0.5, width: totalWidth - OUTER_PAD, height: 1 }} />
            {/* edge 4 — outer left */}
            <div className="absolute bg-black/40"
                 style={{ left: 0, top: HEADER_H, width: 1, height: (totalHeight - OUTER_PAD) - HEADER_H }} />
            {/* edge 5 — inner horizontal (top of row-label gutter) */}
            <div className="absolute bg-black/40"
                 style={{ left: 0, top: HEADER_H - 0.5, width: LEFT_W, height: 1 }} />
            {/* edge 6 — inner vertical (left of column-header strip) */}
            <div className="absolute bg-black/40"
                 style={{ left: LEFT_W - 0.5, top: 0, width: 1, height: HEADER_H }} />

            {/* SVG pathway lines (curated learning pathways — empty for Semi after the
                84-role reference migration; the curated pathways are AM/Space only). */}
            <PathwayLines
              roles={roles}
              pathways={pathways}
              positions={positions}
              highlightedPathwayIds={highlightedPathwayIds}
              hasSelection={selectedIds.length > 0}
              width={totalWidth}
              height={totalHeight}
              industryColor={industry.color}
            />

            {/* Animated "roads" between path roles + fan to possible next steps.
                Targets are the already direction-filtered possibleNextIds so
                the fan animation matches the highlighted-role set exactly. */}
            <PathChain
              selectedPath={selectedIds}
              targetIds={possibleNextIds}
              positions={positions}
              direction={lastClickDirection}
              width={totalWidth}
              height={totalHeight}
            />

            {/* Role cards */}
            {roles.map(role => {
              const pos = positions.get(role.id);
              if (!pos) return null;
              const vis = getVisibility(role.id);
              const lastId = selectedIds[selectedIds.length - 1];
              const vPos = verticalPosById.get(role.id);
              return (
                <RoleCard
                  key={role.id}
                  role={role}
                  position={pos}
                  isSelected={vis === 'selected'}
                  isLastInPath={role.id === lastId}
                  isDimmed={vis === 'dimmed'}
                  isAdjacent={vis === 'adjacent'}
                  isRecommended={false}
                  industryColor={industry.color}
                  industrySlug={industry.slug}
                  isTopRow={vPos?.isMapTop ?? false}
                  isBottomRow={vPos?.isMapBottom ?? false}
                  anyCount={getAnyCount(role.title)}
                  onClick={handleRoleClick}
                  onDoubleClick={handleRoleDoubleClick}
                  onShowDetails={setDetailRoleId}
                />
              );
            })}
        </div>

        {/* Single-line degree legend + clear-map echo (matches reference) */}
        <div className="mt-2 flex items-center justify-between text-xs text-gray-600 px-1">
          <span className="flex items-center gap-1.5">
            <span className="text-base leading-none" aria-hidden="true">♦</span>
            4-year College Degree is Typically Required
          </span>
          <button
            type="button"
            onClick={handleClearPath}
            disabled={selectedIds.length === 0}
            className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-900 disabled:opacity-40
                       disabled:cursor-not-allowed transition-colors uppercase font-semibold tracking-wide
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
          >
            Clear Map
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 10 9 10" />
            </svg>
          </button>
        </div>

        {/* Save & Share CTA bar — matches reference site styling */}
        <div className="mt-6 border-t border-gray-200 pt-5 flex items-center justify-end gap-3 flex-wrap">
          <span className="text-sm italic text-gray-600">
            Build a Career Path with the map, then <span aria-hidden="true">→</span>
          </span>
          <button
            type="button"
            onClick={handleShare}
            disabled={selectedIds.length === 0}
            className="px-6 py-2.5 rounded text-sm font-semibold text-white transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1f6f7a]"
            style={{ backgroundColor: '#1f6f7a' }}
          >
            Save it &amp; Share it here
          </button>
        </div>

        {/* Your Career Path panel — simplified display only (Phase J5) */}
        <CareerPathPanel
          selectedIds={selectedIds}
          roleById={roleById}
        />

        {/* Learning paths anchor — Phase J4 will populate; placeholder for "See related learning paths below" link */}
        <div id="learning-paths" className="mt-12 pt-8 border-t border-gray-100">
          <p className="text-xs text-gray-400 italic">
            Related learning paths will be added in a future update.
          </p>
        </div>
      </div>

      {/* Modals (Phase J4 + J6) — controlled by state above */}
      <SaveShareModal open={saveOpen}  onClose={() => setSaveOpen(false)} />
      <ErrorModal     open={errorOpen} onClose={() => setErrorOpen(false)} />
      <RoleDetailModal
        role={detailRoleId ? roleById.get(detailRoleId) ?? null : null}
        anyCount={detailRoleId ? getAnyCount(roleById.get(detailRoleId)?.title ?? '') : 0}
        industrySlug={industry.slug}
        onClose={() => setDetailRoleId(null)}
      />
    </div>
  );
}
