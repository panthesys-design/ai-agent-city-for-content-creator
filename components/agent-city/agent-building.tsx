'use client';

import { useEffect, useId, useRef } from 'react';
import { createBuildingRenderer } from './renderer';
import { headquartersHeight } from './headquarters-geometry';
import type { AgentStatus, CityBuilding } from './types';
import styles from './city.module.css';

export interface BuildingGlyphProps {
  building: CityBuilding;
  selected?: boolean;
  status?: AgentStatus;
  onSelect?: () => void;
}
/** Use inside an SVG. All drawing resources are scoped to this instance. */
export function BuildingGlyph({ building, selected, status, onSelect }: BuildingGlyphProps) {
  const defs = useRef<SVGDefsElement>(null);
  const drawing = useRef<SVGGElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  useEffect(() => {
    const definitions = defs.current, target = drawing.current;
    if (!definitions || !target) return;
    createBuildingRenderer(definitions, id)(target, building);
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
      <circle cx="-25" cy="11" r="3" fill={{ idle: '#8a94a6', working: '#16a085', error: '#e34d64', offline: '#bcc2cd' }[status]} />
      <text x="-16" y="15" fontSize="10" fill="#465164">{status}</text></g>}
  </g>;
}

export interface AgentBuildingProps extends BuildingGlyphProps { className?: string; night?: boolean }
/** Standalone responsive building preview; also works outside the city. */
export function AgentBuilding({ className, night, ...props }: AgentBuildingProps) {
  const top = props.building.type === 'skyscraper' ? Math.ceil(headquartersHeight(props.building)) + 35 : 350;
  return <svg viewBox={`-180 -${top} 360 ${top + 100}`} className={`${styles.preview} ${className || ''}`}
    data-night={night || undefined} role="group" aria-label={`${props.building.name} building preview`}>
    <BuildingGlyph {...props} />
  </svg>;
}
