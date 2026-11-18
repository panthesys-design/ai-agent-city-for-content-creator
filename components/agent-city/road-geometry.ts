export interface RoadPoint { x: number; y: number }
/** `street` follows the gaps between city plots, so a road never crosses another plot. */
export type RoadRoute = 'x-first' | 'y-first' | 'street';

/** Distance between plot centres in world units. Pads are 220 wide, leaving a 70-unit street between plots. */
export const CITY_PLOT = 290;

/**
 * Street route between two plot centres. It leaves through the front of the start plot (+y),
 * follows the street lines halfway between plots, and enters the end plot from its front.
 */
export function streetWaypoints(from: RoadPoint, to: RoadPoint, plot = CITY_PLOT): RoadPoint[] {
  const half = plot / 2, fromStreet = from.y + half, toStreet = to.y + half;
  if (from.y === to.y) return [{ x: from.x, y: fromStreet }, { x: to.x, y: fromStreet }];
  const avenue = from.x > to.x ? from.x - half : from.x + half;
  return [{ x: from.x, y: fromStreet }, { x: avenue, y: fromStreet }, { x: avenue, y: toStreet }, { x: to.x, y: toStreet }];
}

/** Route in world space, before isometric projection. Explicit waypoints override the route. */
export function roadPath(from: RoadPoint, to: RoadPoint, route: RoadRoute = 'x-first', waypoints?: RoadPoint[]): string | null {
  const bends = waypoints ?? (route === 'street' ? streetWaypoints(from, to)
    : [route === 'x-first' ? { x: to.x, y: from.y } : { x: from.x, y: to.y }]);
  const points = [from, ...bends, to];
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const unique = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  if (unique.length < 2) return null;
  return unique.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
}

/** Nearest plot centre for a world position. */
export function snapToPlot(point: RoadPoint, plot = CITY_PLOT): RoadPoint {
  return { x: Math.round(point.x / plot) * plot || 0, y: Math.round(point.y / plot) * plot || 0 };
}

/** True when no other building stands on the plot at `point`. */
export function isPlotFree(buildings: readonly ({ id: string } & RoadPoint)[], point: RoadPoint, ignoreId?: string, plot = CITY_PLOT): boolean {
  return !buildings.some(b => b.id !== ignoreId && Math.abs(b.x - point.x) < plot * .75 && Math.abs(b.y - point.y) < plot * .75);
}
