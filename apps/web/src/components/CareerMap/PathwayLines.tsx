'use client';

import type { Role, Pathway } from '@/lib/types';
import type { CardPosition } from '@/lib/map-layout';

interface Props {
  roles: Role[];
  pathways: Pathway[];
  positions: Map<string, CardPosition>;
  highlightedPathwayIds: Set<string>;
  hasSelection: boolean;
  width: number;
  height: number;
  industryColor: string;
}

// Smooth cubic bezier between two center points.
// For horizontal moves: S-curve using midpoint control points.
// For vertical moves: straight-ish curve.
function makePath(a: CardPosition, b: CardPosition): string {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  // Control points: pulled horizontally toward the midpoint
  const cp1x = a.cx + dx * 0.55;
  const cp1y = a.cy + dy * 0.05;
  const cp2x = b.cx - dx * 0.55;
  const cp2y = b.cy - dy * 0.05;
  return `M ${a.cx} ${a.cy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${b.cx} ${b.cy}`;
}

export default function PathwayLines({
  roles, pathways, positions, highlightedPathwayIds, hasSelection, width, height, industryColor,
}: Props) {
  void roles; // accept the prop but currently unused — kept for API stability with future pathway labels

  const lines: Array<{
    id: string;
    path: string;
    isHighlighted: boolean;
    color: string;
  }> = [];

  pathways.forEach(pathway => {
    const isHighlighted = highlightedPathwayIds.has(pathway.id);

    // Draw lines between each consecutive pair of roles in the pathway
    for (let i = 0; i < pathway.role_ids.length - 1; i++) {
      const fromId = pathway.role_ids[i];
      const toId = pathway.role_ids[i + 1];
      const from = positions.get(fromId);
      const to = positions.get(toId);
      if (!from || !to) continue;

      lines.push({
        id: `${pathway.id}-${i}`,
        path: makePath(from, to),
        isHighlighted,
        color: industryColor,
      });
    }
  });

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={height}
      style={{ zIndex: 2 }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M 0 0 L 6 3 L 0 6 Z" fill={industryColor} opacity="0.6" />
        </marker>
        <marker
          id="arrowhead-faint"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M 0 0 L 6 3 L 0 6 Z" fill="#94a3b8" opacity="0.3" />
        </marker>
      </defs>

      {lines.map(line => {
        const highlighted = line.isHighlighted;
        // Lines are hidden by default (matches the Critical Materials reference
        // which only draws connecting edges once a role is selected/hovered).
        // Only highlighted pathways show, and only when something is selected.
        const visible = hasSelection && highlighted;

        return (
          <path
            key={line.id}
            d={line.path}
            fill="none"
            stroke={line.color}
            strokeWidth={visible ? 2.5 : 1.5}
            strokeOpacity={visible ? 0.75 : 0}
            markerEnd={visible ? 'url(#arrowhead)' : undefined}
            style={{ transition: 'stroke-opacity 200ms, stroke-width 200ms' }}
          />
        );
      })}
    </svg>
  );
}
