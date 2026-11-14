export interface RoadPoint { x: number; y: number }
export type RoadRoute = 'x-first' | 'y-first';

/** Route in world space, before isometric projection. Explicit waypoints override the elbow. */
export function roadPath(from: RoadPoint, to: RoadPoint, route: RoadRoute = 'x-first', waypoints?: RoadPoint[]): string | null {
  const points = [from, ...(waypoints ?? [route === 'x-first' ? { x: to.x, y: from.y } : { x: from.x, y: to.y }]), to];
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const unique = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  if (unique.length < 2) return null;
  return unique.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
}
