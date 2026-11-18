import { roadPath, type RoadPoint, type RoadRoute } from './road-geometry';

export interface RoadStyle {
  /** Asphalt width in world units. The default 42 fits the demo's 290-unit plots. */
  width?: number;
  sidewalkWidth?: number;
  markings?: boolean;
  surfaceColor?: string;
  sidewalkColor?: string;
  markingColor?: string;
}
export interface RoadProps extends RoadStyle {
  from: RoadPoint;
  to: RoadPoint;
  route?: RoadRoute;
  /** World coordinates; pass [] for a direct connection. */
  waypoints?: RoadPoint[];
  night?: boolean;
  className?: string;
}
export interface RoadNetworkProps extends RoadStyle {
  roads: (RoadProps & { id: string })[];
  night?: boolean;
  className?: string;
}

/** World-to-screen isometric matrix for flat ground shapes drawn in world units. */
export const ISO_TRANSFORM = `matrix(${Math.cos(Math.PI / 6)},0.5,${-Math.cos(Math.PI / 6)},0.5,0,0)`;
const finiteWidth = (value: number | undefined, fallback: number, minimum: number) => Number.isFinite(value) ? Math.max(minimum, value!) : fallback;

/** SVG group: mount inside your city's SVG, under the buildings. */
export function Road(props: RoadProps) {
  return <RoadNetwork roads={[{ ...props, id: 'road' }]} className={props.className} />;
}

/** Layer the entire network together so asphalt merges cleanly at junctions. */
export function RoadNetwork({ roads, night = false, className, ...defaults }: RoadNetworkProps) {
  const segments = roads.flatMap(road => {
    const d = roadPath(road.from, road.to, road.route, road.waypoints);
    if (!d) return [];
    const style = { ...defaults, ...road };
    const dark = road.night ?? night;
    return [{
      id: road.id, d,
      width: finiteWidth(style.width, 42, 8),
      sidewalk: finiteWidth(style.sidewalkWidth, 9, 0),
      markings: style.markings ?? true,
      surface: style.surfaceColor ?? (dark ? '#354052' : '#858d98'),
      pavement: style.sidewalkColor ?? (dark ? '#616c7d' : '#e3e5e8'),
      curb: dark ? '#424d60' : '#bcc3cc',
      paint: style.markingColor ?? (dark ? '#d2c59b' : '#fff1bd'),
    }];
  });
  return <g className={className} transform={ISO_TRANSFORM} pointerEvents="none" aria-hidden="true" fill="none" strokeLinejoin="round" strokeLinecap="round">
    {/* Sidewalks and curbs precede all asphalt, including at shared endpoints. */}
    {segments.map(s => <path key={`edge-${s.id}`} d={s.d} stroke={s.curb} strokeWidth={s.width + s.sidewalk * 2 + 3} />)}
    {segments.map(s => <path key={`walk-${s.id}`} d={s.d} stroke={s.pavement} strokeWidth={s.width + s.sidewalk * 2} />)}
    {segments.map(s => <path key={`surface-${s.id}`} d={s.d} stroke={s.surface} strokeWidth={s.width} />)}
    {segments.filter(s => s.markings).map(s => <path key={`line-${s.id}`} d={s.d} stroke={s.paint} strokeWidth="1.6" strokeDasharray="10 11" strokeLinecap="butt" />)}
  </g>;
}
