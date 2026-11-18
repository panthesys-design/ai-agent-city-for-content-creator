import type { ReactNode } from 'react';
import { ISO_TRANSFORM } from './road';
import { CITY_PLOT, type RoadPoint } from './road-geometry';
import { project } from './types';

// Environment around the buildings: the city's island base, parks on empty plots, and the drop target.
// Flat shapes are drawn in world units inside ISO_TRANSFORM; upright props (trees, lamps) are projected.

export interface CityBounds { minX: number; maxX: number; minY: number; maxY: number }
const PAD = 108;

/** World-space extent of the island that holds every plot in `cells`, with a street's width of margin. */
export function cityBounds(cells: readonly RoadPoint[], plot = CITY_PLOT): CityBounds {
  const xs = cells.map(c => c.x), ys = cells.map(c => c.y), margin = plot / 2 + 34;
  return { minX: Math.min(...xs) - margin, maxX: Math.max(...xs) + margin, minY: Math.min(...ys) - margin, maxY: Math.max(...ys) + margin };
}

/** Every plot centre inside the bounds of the given buildings (one plot grid, no margin ring). */
export function plotsWithin(cells: readonly RoadPoint[], plot = CITY_PLOT): RoadPoint[] {
  const xs = cells.map(c => c.x), ys = cells.map(c => c.y), out: RoadPoint[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += plot) for (let y = Math.min(...ys); y <= Math.max(...ys); y += plot) out.push({ x, y });
  return out;
}

const THICKNESS = 22;
/** A raised, rounded slab under the whole city. */
export function CityIsland({ bounds, night }: { bounds: CityBounds; night?: boolean }) {
  const { minX, maxX, minY, maxY } = bounds;
  const shape = (fill: string, dy: number, stroke?: string) => <g key={dy} transform={`translate(0 ${dy})`}>
    <rect transform={ISO_TRANSFORM} x={minX} y={minY} width={maxX - minX} height={maxY - minY} rx={46} fill={fill} stroke={stroke} strokeWidth={stroke ? 2 : undefined} />
  </g>;
  // A grassy diorama: lawn on top, a turf lip, then soil down the sides.
  const side = night ? '#3b3228' : '#c7a47a', edge = night ? '#2c251e' : '#a98660', turf = night ? '#2e4a2c' : '#8fc366';
  return <g aria-hidden="true" pointerEvents="none">
    <g transform={`translate(0 ${THICKNESS + 18})`} opacity={night ? .5 : .22} filter="blur(14px)">
      <rect transform={ISO_TRANSFORM} x={minX} y={minY} width={maxX - minX} height={maxY - minY} rx={46} fill="#2c2350" />
    </g>
    {shape(edge, THICKNESS)}
    {Array.from({ length: 8 }, (_, i) => shape(side, THICKNESS - 2 - i * 2))}
    {shape(turf, 5)}{shape(turf, 3)}
    {shape(night ? '#36573a' : '#c4e5a0', 0, night ? '#46704a' : '#dcf2c6')}
  </g>;
}

/** Highlights where a dragged building will land: green when the plot is free, red when it is taken. */
export function DropTarget({ at, valid }: { at: RoadPoint; valid: boolean }) {
  // White on the lawn reads as "free" better than another green.
  const color = valid ? '#13774f' : '#e5484d';
  return <g transform={ISO_TRANSFORM} pointerEvents="none" aria-hidden="true">
    <rect x={at.x - 114} y={at.y - 114} width={228} height={228} rx={32} fill={valid ? '#ffffff' : color} fillOpacity={valid ? .45 : .18} stroke={color} strokeWidth={5} strokeDasharray="16 12" />
  </g>;
}

type ParkVariant = 'grove' | 'fountain' | 'pond';
const VARIANTS: ParkVariant[] = ['grove', 'fountain', 'pond'];
export function parkVariant(at: RoadPoint, plot = CITY_PLOT): ParkVariant {
  const col = Math.round(at.x / plot), row = Math.round(at.y / plot);
  return VARIANTS[(((col * 7 + row * 13) % 3) + 3) % 3];
}

/** Flat part of a park plot: lawn, paths, water. Draw under roads and buildings. */
export function ParkGround({ at, night }: { at: RoadPoint; night?: boolean }) {
  const { x, y } = at, variant = parkVariant(at);
  const lawn = night ? '#3d6640' : '#a9d985', lawnEdge = night ? '#2f5232' : '#8cc366', path = night ? '#5b6474' : '#f4efe4', water = night ? '#3e6b8a' : '#a6dbf3';
  return <g aria-hidden="true" pointerEvents="none">
    <g transform="translate(0 6)"><rect transform={ISO_TRANSFORM} x={x - PAD} y={y - PAD} width={PAD * 2} height={PAD * 2} rx={28} fill={lawnEdge} /></g>
    <g transform={ISO_TRANSFORM}>
      <rect x={x - PAD} y={y - PAD} width={PAD * 2} height={PAD * 2} rx={28} fill={lawn} stroke={night ? '#4f7d52' : '#c4e7a6'} strokeWidth={2} />
      {variant === 'grove' && <path d={`M${x - PAD + 14},${y + 46} C${x - 30},${y + 40} ${x + 20},${y - 50} ${x + PAD - 14},${y - 40}`} stroke={path} strokeWidth={15} fill="none" strokeLinecap="round" />}
      {variant === 'fountain' && <>
        <path d={`M${x - PAD + 12},${y} H${x + PAD - 12} M${x},${y - PAD + 12} V${y + PAD - 12}`} stroke={path} strokeWidth={16} strokeLinecap="round" />
        <circle cx={x} cy={y} r={46} fill={path} />
        <circle cx={x} cy={y} r={32} fill={night ? '#6c7586' : '#dfe3ea'} />
        <circle cx={x} cy={y} r={25} fill={water} />
        {[[-70, -70], [70, -70], [-70, 70], [70, 70]].map(([dx, dy]) => <circle key={`${dx}${dy}`} cx={x + dx} cy={y + dy} r={14} fill={night ? '#6a4b5e' : '#f6c6d6'} stroke={night ? '#4f3b48' : '#e9a8bf'} strokeWidth={2} />)}
      </>}
      {variant === 'pond' && <>
        <path d={`M${x - PAD + 14},${y + 70} Q${x - 10},${y + 74} ${x + 6},${y + PAD - 12}`} stroke={path} strokeWidth={14} fill="none" strokeLinecap="round" />
        <path d={`M${x - 62},${y - 6} C${x - 66},${y - 52} ${x - 6},${y - 70} ${x + 34},${y - 50} C${x + 74},${y - 30} ${x + 62},${y + 28} ${x + 18},${y + 40} C${x - 22},${y + 52} ${x - 58},${y + 34} ${x - 62},${y - 6} Z`}
          fill={water} stroke={night ? '#567f99' : '#86c7e4'} strokeWidth={4} />
        {[[-24, -22, 7], [14, -30, 5], [22, 8, 6]].map(([dx, dy, r]) => <circle key={`${dx}${dy}`} cx={x + dx} cy={y + dy} r={r} fill={night ? '#4f7a46' : '#8fcf6a'} />)}
      </>}
    </g>
  </g>;
}

/** Upright park props (trees, lamps, fountain jet), drawn in depth order with the buildings. */
export function ParkProps({ at }: { at: RoadPoint }) {
  const { x, y } = at, variant = parkVariant(at), items: { x: number; y: number; node: (p: RoadPoint) => ReactNode }[] = [];
  const tree = (dx: number, dy: number, s = 1, cone = false) => items.push({ x: x + dx, y: y + dy, node: p => cone ? <ConeTree at={p} s={s} /> : <RoundTree at={p} s={s} /> });
  const lamp = (dx: number, dy: number) => items.push({ x: x + dx, y: y + dy, node: p => <Lamp at={p} /> });
  if (variant === 'grove') {
    tree(-62, -58, 1.15); tree(-12, -74, .95, true); tree(46, -10, 1.1); tree(-70, 2, .9, true); tree(70, 52, 1.05); tree(-20, 70, .85); tree(16, 34, .8, true); lamp(-40, 30);
  } else if (variant === 'fountain') {
    tree(-80, -40, 1); tree(-40, -84, .95, true); tree(84, 40, 1); tree(40, 84, 1.05, true); lamp(-28, -28); lamp(28, 28);
    items.push({ x, y, node: p => <Fountain at={p} /> });
  } else {
    tree(-80, -78, 1.1); tree(70, -72, .9, true); tree(80, 54, 1.05); tree(-78, 50, .95, true); tree(-6, 84, .8); lamp(-50, 76);
  }
  return <g aria-hidden="true" pointerEvents="none">
    {items.sort((a, b) => a.x + a.y - b.x - b.y).map((item, i) => <g key={i}>{item.node(project(item.x, item.y))}</g>)}
  </g>;
}

function RoundTree({ at, s = 1 }: { at: RoadPoint; s?: number }) {
  const h = 22 * s, cy = at.y - h - 9 * s;
  return <g>
    <ellipse cx={at.x + 3} cy={at.y + 1} rx={15 * s} ry={7 * s} fill="#3f5a1e" opacity={.18} />
    <line x1={at.x} y1={at.y} x2={at.x} y2={at.y - h} stroke="#8b5e3c" strokeWidth={4 * s} strokeLinecap="round" />
    {[[6, 4, 9, '#6fb436'], [-7, 3, 9, '#79bf3e'], [0, -2, 12, '#86cc45'], [-5, -9, 8, '#9bd85a'], [6, -8, 7, '#a9e06b'], [-1, -13, 5.5, '#bfe98a']].map(([dx, dy, r, c], i) =>
      <circle key={i} cx={at.x + (dx as number) * s} cy={cy + (dy as number) * s} r={(r as number) * s} fill={c as string} />)}
  </g>;
}
function ConeTree({ at, s = 1 }: { at: RoadPoint; s?: number }) {
  const r = 9 * s, h = 42 * s;
  return <g>
    <ellipse cx={at.x + 3} cy={at.y + 1} rx={r * 1.3} ry={r * .6} fill="#3f5a1e" opacity={.2} />
    <path d={`M${at.x - r},${at.y} A${r},${r * .5} 0 0 0 ${at.x + r},${at.y} L${at.x},${at.y - h} Z`} fill="#8fcf3a" />
    <path d={`M${at.x + r},${at.y} A${r},${r * .5} 0 0 1 ${at.x + r * .15},${at.y + r * .5} L${at.x},${at.y - h} Z`} fill="#6faa1c" />
  </g>;
}
function Lamp({ at }: { at: RoadPoint }) {
  return <g>
    <ellipse cx={at.x + 2} cy={at.y + 1} rx={5} ry={2.4} fill="#3f4a5c" opacity={.2} />
    <line x1={at.x} y1={at.y} x2={at.x} y2={at.y - 30} stroke="#6b7280" strokeWidth={2.2} strokeLinecap="round" />
    <circle cx={at.x} cy={at.y - 32} r={4} fill="#fff3c4" stroke="#c9a74a" strokeWidth={1.2} />
  </g>;
}
function Fountain({ at }: { at: RoadPoint }) {
  return <g>
    <path d={`M${at.x - 3},${at.y} Q${at.x - 2},${at.y - 22} ${at.x},${at.y - 30} Q${at.x + 2},${at.y - 22} ${at.x + 3},${at.y} Z`} fill="#ffffff" opacity={.9} />
    <path d={`M${at.x},${at.y - 28} Q${at.x - 14},${at.y - 30} ${at.x - 18},${at.y - 6} M${at.x},${at.y - 28} Q${at.x + 14},${at.y - 30} ${at.x + 18},${at.y - 6}`} stroke="#d6f1fb" strokeWidth={2.4} fill="none" strokeLinecap="round" />
    <ellipse cx={at.x} cy={at.y} rx={9} ry={4} fill="#e8f7fd" opacity={.9} />
  </g>;
}
