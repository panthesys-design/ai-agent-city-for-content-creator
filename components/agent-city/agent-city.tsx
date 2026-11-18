'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BuildingGlyph } from './agent-building';
import { BuildingIcon } from './building-icon';
import { CityIsland, DropTarget, ParkGround, ParkProps, cityBounds, plotsWithin } from './city-ground';
import { headquartersHeight } from './headquarters-geometry';
import { RoadNetwork, type RoadStyle } from './road';
import { isPlotFree, snapToPlot, type RoadPoint } from './road-geometry';
import { project, themeAccent, type Agent, type CityBuilding, type CityConfig } from './types';
import styles from './city.module.css';

export interface CityPopover {
  /** Building the popover is anchored to. */
  buildingId: string;
  content: ReactNode;
  /** Accessible name for the popover region. */
  label: string;
  /** Called on Escape and on a pointer-down outside the city (unless a modal dialog is open). Clicks on the city's own ground are reported through `onBackgroundClick`. */
  onClose: () => void;
}
/**
 * A small speech bubble above a building, e.g. an agent's pending question. It replaces the hover label for that
 * building and stays visible until the host removes it.
 */
export interface CityCallout {
  buildingId: string;
  /** Short text; long text is truncated. */
  text: string;
  /** Visual tone: `question` (default) for something the user should answer, `info` for a neutral note. */
  tone?: 'question' | 'info';
  /** Extra items behind this one, shown as a count (e.g. 2 more questions). */
  more?: number;
  /** Accessible name of the bubble's button; defaults to the text. */
  label?: string;
  onClick?: () => void;
}
export interface AgentCityProps {
  config: CityConfig;
  agents?: Agent[];
  selectedBuildingId?: string | null;
  onSelectBuilding?: (building: CityBuilding) => void;
  /** Called when a building is dropped on a free plot, with that plot's centre. Drops on a taken plot snap back. */
  onBuildingMove?: (id: string, position: { x: number; y: number }) => void;
  /** Limits which buildings can be dragged. Defaults to all buildings while `draggable` is on. */
  canDrag?: (building: CityBuilding) => boolean;
  /** A click (not a drag) on empty ground. */
  onBackgroundClick?: () => void;
  popover?: CityPopover | null;
  /** Speech bubbles above buildings (one per building; extra entries for the same building are ignored). */
  callouts?: CityCallout[];
  /** Floating name/icon label above the building under the pointer (or keyboard focus). */
  showLabels?: boolean;
  /** Island base, parks on empty plots, and environment details. */
  scenery?: boolean;
  /** Change this value to re-frame the camera around the whole city (e.g. after adding a building). */
  fitKey?: string | number;
  night?: boolean;
  roadStyle?: RoadStyle;
  draggable?: boolean;
  className?: string;
}

type Camera = { x: number; y: number; zoom: number };
const FALLBACK_SIZE = { w: 1300, h: 900 };
const C = Math.cos(Math.PI / 6);
const STATUS_TEXT = { idle: 'Idle', working: 'Working', waiting: 'Needs you', completed: 'Completed', failed: 'Failed', error: 'Needs attention', offline: 'Offline' } as const;

/** Rough height above the base (negative SVG units) before a building has been measured. */
function estimatedTop(b: CityBuilding) {
  return b.type === 'skyscraper' ? -(headquartersHeight(b) + 30) : b.type === 'agent' ? -(240 + ((b.floors ?? 1) - 1) * 32) : -320;
}

function fitCamera(buildings: readonly CityBuilding[], size: { w: number; h: number }): Camera {
  if (!buildings.length) return { x: size.w / 2, y: size.h / 3, zoom: .85 };
  const { minX, maxX, minY, maxY } = cityBounds(buildings);
  const corners = [project(minX, minY), project(maxX, minY), project(maxX, maxY), project(minX, maxY)];
  let left = Math.min(...corners.map(c => c.x)), right = Math.max(...corners.map(c => c.x));
  let top = Math.min(...corners.map(c => c.y));
  const bottom = Math.max(...corners.map(c => c.y)) + 40;
  for (const b of buildings) {
    const p = project(b.x, b.y);
    top = Math.min(top, p.y + estimatedTop(b) - 40); // leave room for the floating label
    left = Math.min(left, p.x - 120); right = Math.max(right, p.x + 120);
  }
  const zoom = Math.max(.25, Math.min(1.15, (size.w - 32) / (right - left), (size.h - 32) / (bottom - top)));
  return { x: size.w / 2 - zoom * (left + right) / 2, y: size.h / 2 - zoom * (top + bottom) / 2, zoom };
}

export function AgentCity({
  config, agents = [], selectedBuildingId, onSelectBuilding, onBuildingMove, canDrag, onBackgroundClick, popover, callouts = [],
  showLabels = true, scenery = true, fitKey, night, roadStyle, draggable = true, className,
}: AgentCityProps) {
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const viewport = size ?? FALLBACK_SIZE;
  const [camera, setCamera] = useState<Camera>(() => fitCamera(config.buildings, FALLBACK_SIZE));
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverHeight, setPopoverHeight] = useState<number | null>(null);
  const gesture = useRef<{ id?: string; onBuilding: boolean; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const autoFit = useRef(true);
  const latest = useRef({ buildings: config.buildings, size: viewport });
  useEffect(() => { latest.current = { buildings: config.buildings, size: viewport }; });

  // Track the frame size so one SVG unit is one CSS pixel; HTML labels and popovers then line up exactly.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize(s => s && s.w === width && s.h === height ? s : { w: width, h: height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Frame the whole city until the user moves the camera; `fitKey` re-frames on demand.
  useEffect(() => {
    if (size && autoFit.current) setCamera(fitCamera(latest.current.buildings, size));
  }, [size]);
  useEffect(() => {
    autoFit.current = true;
    setCamera(fitCamera(latest.current.buildings, latest.current.size));
  }, [fitKey]);

  const zoomAt = useCallback((factor: number, at?: { x: number; y: number }) => {
    autoFit.current = false;
    setCamera(c => {
      const zoom = Math.max(.25, Math.min(2.5, c.zoom * factor)), k = zoom / c.zoom;
      const cx = at?.x ?? latest.current.size.w / 2, cy = at?.y ?? latest.current.size.h / 2;
      return { zoom, x: cx - (cx - c.x) * k, y: cy - (cy - c.y) * k };
    });
  }, []);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * .0015), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  // Measure the open popover so side placement can keep it vertically inside the frame.
  const popoverOpen = Boolean(popover);
  useEffect(() => {
    const element = popoverRef.current;
    if (!popoverOpen || !element) return;
    const observer = new ResizeObserver(() => setPopoverHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [popoverOpen, popover?.buildingId]);

  const onClose = popover?.onClose;
  useEffect(() => {
    if (!onClose) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) onClose(); };
    // Pointer-downs inside the city are handled by the gesture code (ground click closes, building click switches).
    const outside = (event: PointerEvent) => {
      const t = event.target as Element | null;
      if (!t || frame.current?.contains(t) || popoverRef.current?.contains(t)) return;
      if (t.closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') || document.querySelector('dialog[open]')) return;
      onClose();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [onClose]);

  const measure = useCallback((id: string, top: number) => setTops(t => t[id] === top ? t : { ...t, [id]: top }), []);

  const target = draft ? snapToPlot(draft) : null;
  const targetFree = target && draft ? isPlotFree(config.buildings, target, draft.id) : false;
  const byId = new Map(config.buildings.map(b => [b.id, b]));
  // The dragged building floats under the pointer; its road already routes to the plot it would land on.
  const floating = (b: CityBuilding) => draft?.id === b.id ? { x: draft.x, y: draft.y } : b;
  const anchored = (b: CityBuilding): RoadPoint => draft?.id === b.id && target ? target : b;
  const cells = target ? [...config.buildings, target] : config.buildings;
  const bounds = scenery && cells.length ? cityBounds(cells) : null;
  const parks = scenery && cells.length ? plotsWithin(cells).filter(c => isPlotFree(config.buildings, c)) : [];
  const toScreen = (p: RoadPoint, lift = 0) => {
    const q = project(p.x, p.y);
    return { x: camera.x + camera.zoom * q.x, y: camera.y + camera.zoom * (q.y + lift) };
  };

  function point(event: { clientX: number; clientY: number }) {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : new DOMPoint();
  }
  function end(cancelled = false) {
    const active = gesture.current;
    if (!active) return;
    if (!cancelled && draft && active.moved && target && targetFree) {
      const original = byId.get(draft.id);
      if (original && (original.x !== target.x || original.y !== target.y)) onBuildingMove?.(draft.id, target);
    }
    if (!cancelled && !active.moved && !active.onBuilding) onBackgroundClick?.();
    suppressClick.current = active.moved;
    gesture.current = null; setDraft(null);
  }

  const items = [
    ...parks.map(at => ({ key: `park-${at.x}-${at.y}`, depth: at.x + at.y, node: <ParkProps at={at} /> })),
    ...config.buildings.map(b => {
      const at = floating(b), p = project(at.x, at.y), dragging = draft?.id === b.id;
      const agent = agents.find(a => a.id === b.agentId);
      return {
        key: b.id, depth: at.x + at.y + (dragging ? 1e6 : 0),
        node: <g data-building-id={b.id} transform={`translate(${p.x} ${p.y})`} className={dragging ? styles.dragging : undefined}
          onPointerEnter={() => setHoveredId(b.id)} onPointerLeave={() => setHoveredId(h => h === b.id ? null : h)}
          onFocus={() => setHoveredId(b.id)} onBlur={() => setHoveredId(h => h === b.id ? null : h)}>
          <g transform={dragging ? 'translate(0 -16)' : undefined}>
            <BuildingGlyph building={b} status={showLabels ? undefined : agent?.status} selected={b.id === selectedBuildingId}
              onMeasure={top => measure(b.id, top)}
              onSelect={onSelectBuilding ? () => { if (!suppressClick.current) onSelectBuilding(b); suppressClick.current = false; } : undefined} />
          </g>
        </g>,
      };
    }),
  ].sort((a, b) => a.depth - b.depth);

  const popoverBuilding = popover ? byId.get(popover.buildingId) : undefined;
  const labelAt = (b: CityBuilding) => toScreen(floating(b), (tops[b.id] ?? estimatedTop(b)) + (draft?.id === b.id ? -16 : 0));
  const calloutFor = new Map<string, CityCallout>();
  for (const c of callouts) if (byId.has(c.buildingId) && !calloutFor.has(c.buildingId) && c.buildingId !== popover?.buildingId) calloutFor.set(c.buildingId, c);

  return <div ref={frame} className={`${styles.city} ${className || ''}`} data-night={night || undefined} data-dragging={draft ? true : undefined}>
    <svg ref={svg} viewBox={`0 0 ${viewport.w} ${viewport.h}`} role="group"
      aria-label="AI creator agent city. Drag the ground to pan, scroll to zoom, select a building for details, drag an agent building to move it."
      onPointerDown={e => {
        if (e.button !== 0) return;
        const id = (e.target as Element).closest('[data-building-id]')?.getAttribute('data-building-id') || undefined;
        const b = id ? byId.get(id) : undefined;
        const movable = Boolean(b && draggable && onBuildingMove && (canDrag?.(b) ?? true));
        const p = point(e);
        gesture.current = { id: movable ? id : undefined, onBuilding: Boolean(id), x: p.x, y: p.y, originX: movable ? b!.x : camera.x, originY: movable ? b!.y : camera.y, moved: false };
        suppressClick.current = false;
      }}
      onPointerMove={e => {
        const active = gesture.current; if (!active) return;
        const p = point(e), dx = p.x - active.x, dy = p.y - active.y;
        if (!active.moved && Math.hypot(dx, dy) < 5) return;
        if (!active.moved) e.currentTarget.setPointerCapture(e.pointerId);
        active.moved = true;
        if (active.id) {
          const wx = dx / camera.zoom / C, wy = dy / camera.zoom / .5;
          setDraft({ id: active.id, x: active.originX + (wx + wy) / 2, y: active.originY + (wy - wx) / 2 });
        } else {
          autoFit.current = false;
          setCamera(c => ({ ...c, x: active.originX + dx, y: active.originY + dy }));
        }
      }} onPointerUp={() => end()} onPointerCancel={() => end(true)} onLostPointerCapture={() => end(true)}>
      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
        {bounds ? <CityIsland bounds={bounds} night={night} /> : <g stroke="#cdd3dc" strokeWidth="1" opacity=".5" pointerEvents="none">
          {Array.from({ length: 11 }, (_, i) => (i - 3) * 145).map(n => {
            const a = project(n, -435), b = project(n, 1015), c = project(-435, n), d = project(1015, n);
            return <g key={n}><path d={`M${a.x},${a.y} L${b.x},${b.y}`} /><path d={`M${c.x},${c.y} L${d.x},${d.y}`} /></g>;
          })}
        </g>}
        {parks.map(at => <ParkGround key={`ground-${at.x}-${at.y}`} at={at} night={night} />)}
        {target && <DropTarget at={target} valid={targetFree} />}
        <RoadNetwork {...roadStyle} night={night} roads={config.links.flatMap(link => {
          const from = byId.get(link.from), to = byId.get(link.to);
          return from && to ? [{ ...link, from: anchored(from), to: anchored(to) }] : [];
        })} />
        {items.map(item => <g key={item.key}>{item.node}</g>)}
      </g>
    </svg>
    {size && <div className={styles.overlay} aria-hidden={showLabels ? undefined : true}>
      {showLabels && config.buildings.filter(b => b.id === (draft?.id ?? hoveredId) && b.id !== popover?.buildingId && !calloutFor.has(b.id)).map(b => {
        const at = labelAt(b), agent = agents.find(a => a.id === b.agentId);
        const theme = 'theme' in b && b.theme ? b.theme : b.type === 'skyscraper' ? 'gold' : 'lavender';
        const icon = 'icon' in b ? b.icon : undefined;
        return <div key={b.id} className={styles.label} aria-hidden="true"
          data-selected={b.id === selectedBuildingId || undefined} data-hq={b.type === 'skyscraper' || undefined}
          style={{ left: at.x, top: at.y, '--accent': themeAccent[theme as keyof typeof themeAccent] ?? themeAccent.lavender } as CSSProperties}>
          <span className={styles.labelIcon}><BuildingIcon icon={icon} size={12} strokeWidth={2.4} /></span>
          <span className={styles.labelName}>{b.name}</span>
          {agent && <span className={styles.labelStatus} data-status={agent.status} title={STATUS_TEXT[agent.status]} />}
        </div>;
      })}
      {popover && popoverBuilding && (() => {
        // Open beside the building (on the roomier side) so the building stays visible; fall back to
        // above/below only when neither side fits the 300px card.
        const at = labelAt(popoverBuilding), base = toScreen(floating(popoverBuilding));
        const half = 110 * camera.zoom, gap = 16, width = 300, margin = 8;
        const roomRight = viewport.w - (base.x + half + gap) - margin, roomLeft = base.x - half - gap - margin;
        const side = roomRight >= width && roomRight >= roomLeft ? 'right' : roomLeft >= width ? 'left' : null;
        if (side) {
          const height = popoverHeight ?? 360, mid = (at.y + base.y) / 2;
          const top = Math.max(margin, Math.min(viewport.h - height - margin, mid - height / 2));
          return <div ref={popoverRef} className={styles.popover} role="dialog" aria-label={popover.label} data-placement={side}
            style={{ left: side === 'right' ? base.x + half + gap : base.x - half - gap - width, top }}
            onPointerDown={e => e.stopPropagation()}>
            {popover.content}
          </div>;
        }
        const above = at.y > 300;
        const left = Math.max(166, Math.min(viewport.w - 166, at.x));
        return <div ref={popoverRef} className={styles.popover} role="dialog" aria-label={popover.label} data-placement={above ? 'above' : 'below'}
          style={{ left, top: above ? at.y - 40 : at.y + 12 }}
          onPointerDown={e => e.stopPropagation()}>
          {popover.content}
        </div>;
      })()}
    </div>}
    {size && calloutFor.size > 0 && <div className={styles.overlay}>
      {[...calloutFor.values()].map(c => {
        const b = byId.get(c.buildingId)!, at = labelAt(b);
        return <button key={c.buildingId} type="button" className={styles.callout} data-tone={c.tone ?? 'question'}
          style={{ left: at.x, top: at.y }} aria-label={c.label ?? c.text} title={c.text}
          onPointerDown={e => e.stopPropagation()} onClick={c.onClick}>
          <span className={styles.calloutMark} aria-hidden="true">{c.tone === 'info' ? 'i' : '?'}</span>
          <span className={styles.calloutText}>{c.text}</span>
          {c.more ? <span className={styles.calloutMore} aria-hidden="true">+{c.more}</span> : null}
        </button>;
      })}
    </div>}
    <div className={styles.controls}>
      <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2)}>−</button>
      <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.2)}>+</button>
      <button type="button" onClick={() => { autoFit.current = true; setCamera(fitCamera(config.buildings, viewport)); }}>Fit city</button>
    </div>
  </div>;
}
