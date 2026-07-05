import type { Role } from './types';

const EQUAL_SALARY_TOLERANCE = 1000;

export interface VerticalPos {
  /** Center y of the role's circle on the map. Smaller = higher on screen. */
  y: number;
  /** This role sits at the absolute topmost visual row of the map
   *  (no role has a smaller y). Its upper arrows never render. */
  isMapTop: boolean;
  /** This role sits at the absolute bottommost visual row of the map.
   *  Its lower arrows never render. */
  isMapBottom: boolean;
}

function midpoint(role: Pick<Role, 'salary_min' | 'salary_max'>): number {
  return (role.salary_min + role.salary_max) / 2;
}

/**
 * Direction-aware adjacency filter using visual y-position, not seniority
 * row, so that sub-row stacking within a level (e.g. the bottom card of the
 * senior stack vs. the top card of the senior stack) is respected.
 *
 * Upper-click of X keeps Y when:
 *   • Y's visual row is strictly above X (smaller y), OR
 *   • Y is in the same visual row with a higher salary midpoint, OR
 *   • Y is same-row equal-salary (|Δmid| ≤ $1000) AND X is not at the
 *     absolute top/bottom of the map (horizontals only on interior rows).
 *
 * Lower-click is the mirror.
 */
export function passesDirectionFilter(
  x: Role, y: Role,
  direction: 'up' | 'down',
  xPos: VerticalPos, yPos: VerticalPos,
): boolean {
  if (yPos.y < xPos.y) return direction === 'up';
  if (yPos.y > xPos.y) return direction === 'down';

  const dm = midpoint(y) - midpoint(x);
  if (Math.abs(dm) <= EQUAL_SALARY_TOLERANCE) {
    return !xPos.isMapTop && !xPos.isMapBottom;
  }
  return direction === 'up' ? dm > 0 : dm < 0;
}
