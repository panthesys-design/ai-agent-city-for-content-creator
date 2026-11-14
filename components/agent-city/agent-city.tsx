'use client';

import { useRef, useState } from 'react';
import { BuildingGlyph } from './agent-building';
import { RoadNetwork, type RoadStyle } from './road';
import { project, type Agent, type CityBuilding, type CityConfig } from './types';
import styles from './city.module.css';

export interface AgentCityProps {
  config: CityConfig;
  agents?: Agent[];
  selectedBuildingId?: string | null;
  onSelectBuilding?: (building: CityBuilding) => void;
  onBuildingMove?: (id: string, position: { x: number; y: number }) => void;
  night?: boolean;
  roadStyle?: RoadStyle;
  draggable?: boolean;
  className?: string;
}
export function AgentCity({ config, agents = [], selectedBuildingId, onSelectBuilding, onBuildingMove, night, roadStyle, draggable = true, className }: AgentCityProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [camera, setCamera] = useState({ x: 650, y: 230, zoom: .85 });
  const [draft, setDraft] = useState<{ id: string; x: number; y: number } | null>(null);
  const gesture = useRef<{ id?: string; x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const buildings = config.buildings.map(b => draft?.id === b.id ? { ...b, x: draft.x, y: draft.y } : b);
  const byId = new Map(buildings.map(b => [b.id, b]));
  function point(event: { clientX: number; clientY: number }) {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : new DOMPoint();
  }
  function end(cancelled = false) {
    const active = gesture.current;
    if (!active) return;
    if (!cancelled && draft && active.moved) onBuildingMove?.(draft.id, { x: draft.x, y: draft.y });
    suppressClick.current = active.moved;
    gesture.current = null; setDraft(null);
  }
  return <div className={`${styles.city} ${className || ''}`} data-night={night || undefined}>
    <svg ref={svg} viewBox="0 0 1300 900" role="group" aria-label="AI creator agent city. Drag the ground to pan. Select a building for details."
      onPointerDown={e => {
        if (e.button !== 0) return;
        const target = (e.target as Element).closest('[data-building-id]');
        const id = target?.getAttribute('data-building-id') || undefined;
        if (id && (!draggable || !onBuildingMove)) return;
        const p = point(e), b = id ? byId.get(id) : undefined;
        gesture.current = { id, x: p.x, y: p.y, originX: b?.x ?? camera.x, originY: b?.y ?? camera.y, moved: false };
        suppressClick.current = false;

      }}
      onPointerMove={e => {
        const active = gesture.current; if (!active) return;
        const p = point(e), dx = p.x - active.x, dy = p.y - active.y;
        if (!active.moved && Math.hypot(dx, dy) < 5) return;
        if (!active.moved) e.currentTarget.setPointerCapture(e.pointerId);
        active.moved = true;
        if (active.id) {
          const wx = dx / camera.zoom / Math.cos(Math.PI / 6), wy = dy / camera.zoom / .5;
          setDraft({ id: active.id, x: active.originX + (wx + wy) / 2, y: active.originY + (wy - wx) / 2 });
        } else setCamera(c => ({ ...c, x: active.originX + dx, y: active.originY + dy }));
      }} onPointerUp={() => end()} onPointerCancel={() => end(true)} onLostPointerCapture={() => end(true)}>
      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
        <g stroke="#cdd3dc" strokeWidth="1" opacity=".5" pointerEvents="none">
          {Array.from({ length: 11 }, (_, i) => (i - 3) * 145).map(n => {
            const a = project(n, -435), b = project(n, 1015), c = project(-435, n), d = project(1015, n);
            return <g key={n}><path d={`M${a.x},${a.y} L${b.x},${b.y}`} /><path d={`M${c.x},${c.y} L${d.x},${d.y}`} /></g>;
          })}
        </g>
        <RoadNetwork {...roadStyle} night={night} roads={config.links.flatMap(link => {
          const from = byId.get(link.from), to = byId.get(link.to);
          return from && to ? [{ ...link, from, to }] : [];
        })} />
        {[...buildings].sort((a, b) => a.x + a.y - b.x - b.y).map(b => {
          const p = project(b.x, b.y), agent = agents.find(a => a.id === b.agentId);
          return <g key={b.id} data-building-id={b.id} transform={`translate(${p.x} ${p.y})`}>
            <BuildingGlyph building={b} status={agent?.status} selected={b.id === selectedBuildingId}
              onSelect={onSelectBuilding ? () => { if (!suppressClick.current) onSelectBuilding(b); suppressClick.current = false; } : undefined} />
          </g>;
        })}
      </g>
    </svg>
    <div className={styles.controls}>
      <button aria-label="Zoom out" onClick={() => setCamera(c => ({ ...c, zoom: Math.max(.25, c.zoom / 1.2) }))}>−</button>
      <button aria-label="Zoom in" onClick={() => setCamera(c => ({ ...c, zoom: Math.min(2.5, c.zoom * 1.2) }))}>+</button>
      <button onClick={() => setCamera({ x: 650, y: 230, zoom: .85 })}>Reset view</button>
    </div>
  </div>;
}
