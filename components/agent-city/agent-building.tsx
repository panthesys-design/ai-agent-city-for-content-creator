'use client';

import { useEffect, useId, useRef } from 'react';
import { createBuildingRenderer } from './renderer';
import { headquartersHeight } from './headquarters-geometry';
import { signLabel, type AgentStatus, type CityBuilding } from './types';
import styles from './city.module.css';

export interface BuildingGlyphProps {
  building: CityBuilding;
  selected?: boolean;
  status?: AgentStatus;
  onSelect?: () => void;
  /** Receives the drawing's top edge (negative, local SVG units) after each redraw. */
  onMeasure?: (top: number) => void;
}
/** Use inside an SVG. All drawing resources are scoped to this instance. */
export function BuildingGlyph({ building, selected, status, onSelect, onMeasure }: BuildingGlyphProps) {
  const defs = useRef<SVGDefsElement>(null);
  const drawing = useRef<SVGGElement>(null);
  const measure = useRef(onMeasure);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  useEffect(() => { measure.current = onMeasure; });
  useEffect(() => {
    const definitions = defs.current, target = drawing.current;
    if (!definitions || !target) return;
    createBuildingRenderer(definitions, id)(target, { ...building, label: signLabel(building.name) });
    try { measure.current?.(target.getBBox().y); } catch { /* not rendered (e.g. display:none) */ }
    return () => { definitions.replaceChildren(); target.replaceChildren(); };
  }, [building, id]);
  return <g className={`${styles.building} ${selected ? styles.selected : ''}`}>
    <defs ref={defs} />
    <g ref={drawing} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
      aria-label={`${building.name}${status ? `, ${status}` : ''}`} aria-pressed={onSelect ? Boolean(selected) : undefined}
      onClick={onSelect} onKeyDown={event => {
        if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(); }
      }} />
    {status && <g transform="translate(0,28)" pointerEvents="none"><rect x="-37" y="0" width="74" height="22" rx="11" fill="white" />
      <circle cx="-25" cy="11" r="3" fill={{ idle: '#8a94a6', working: '#16a085', waiting: '#f0a020', completed: '#3b7bf0', failed: '#e34d64', error: '#e34d64', offline: '#bcc2cd' }[status]} />
      <text x="-16" y="15" fontSize="10" fill="#465164">{status}</text></g>}
  </g>;
}

export interface AgentBuildingProps extends BuildingGlyphProps { className?: string; night?: boolean }
/** Standalone responsive building preview; also works outside the city. */
export function AgentBuilding({ className, night, ...props }: AgentBuildingProps) {
  const b = props.building;
  // Agent designs top out at ~260 units for one floor (broadcast mast) and gain ~32 per extra floor.
  const top = b.type === 'skyscraper' ? Math.ceil(headquartersHeight(b)) + 35 : b.type === 'agent' ? 280 + ((b.floors ?? 1) - 1) * 32 : 350;
  return <svg viewBox={`-180 -${top} 360 ${top + 100}`} className={`${styles.preview} ${className || ''}`}
    data-night={night || undefined} role="group" aria-label={`${props.building.name} building preview`}>
    <BuildingGlyph {...props} />
  </svg>;
}
