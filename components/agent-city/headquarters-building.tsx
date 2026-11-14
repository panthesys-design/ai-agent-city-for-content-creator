'use client';

import { AgentBuilding, type AgentBuildingProps } from './agent-building';
import type { HeadquartersSpec } from './types';

export interface HeadquartersBuildingProps extends Omit<AgentBuildingProps, 'building'> {
  building: HeadquartersSpec;
}
/** Standalone HQ preview. For a city, include the same spec in config.buildings. */
export function HeadquartersBuilding(props: HeadquartersBuildingProps) {
  return <AgentBuilding {...props} />;
}
