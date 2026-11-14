import type { RoadStyle } from './road';
import type { RoadPoint, RoadRoute } from './road-geometry';

export const buildingThemes = ['lavender', 'mint', 'peach', 'sky', 'rose', 'white'] as const;
export const buildingIcons = ['search', 'doc', 'wave', 'play', 'image', 'rocket', 'sparkle'] as const;
export const roofItems = ['tree', 'units', 'dish', 'solar', 'garden'] as const;
export type AgentStatus = 'idle' | 'working' | 'error' | 'offline';
export interface Agent {
  id: string;
  name: string;
  task: string;
  status: AgentStatus;
}
interface BuildingBase {
  id: string;
  name: string;
  x: number;
  y: number;
  agentId?: string;
}
export interface AgentOffice extends BuildingBase {
  type: 'agent';
  theme?: typeof buildingThemes[number];
  icon?: typeof buildingIcons[number];
  floors?: 1 | 2 | 3 | 4;
  glass?: 'full' | 'front' | 'none';
  interior?: 'desk' | 'writer' | 'voice' | 'editing' | 'gallery' | 'publish';
  roof?: (typeof roofItems[number])[];
  trees?: boolean;
}
export interface CampusBuilding extends BuildingBase {
  type: 'tower' | 'stepped' | 'office';
  accent?: string;
  glass?: 'blue' | 'teal' | 'warm' | 'clear';
  extras?: { type: string; [key: string]: string | number | boolean }[];
}
export const headquartersStyles = ['empire', 'crown', 'twin'] as const;
export const headquartersThemes = [...buildingThemes, 'gold'] as const;
export const headquartersTints = ['blue', 'teal', 'warm', 'clear'] as const;
export interface HeadquartersSpec extends BuildingBase {
  type: 'skyscraper';
  style?: typeof headquartersStyles[number];
  theme?: typeof headquartersThemes[number];
  height?: 1 | 2 | 3 | 4 | 5;
  tint?: typeof headquartersTints[number];
  icon?: typeof buildingIcons[number];
  spire?: boolean;
  trees?: boolean;
}
export type CityBuilding = AgentOffice | CampusBuilding | HeadquartersSpec;
/** Links reference building IDs and represent visual roads, not task execution. */
export interface CityLink extends RoadStyle {
  id: string;
  from: string;
  to: string;
  route?: RoadRoute;
  waypoints?: RoadPoint[];
}
export interface CityConfig { buildings: CityBuilding[]; links: CityLink[] }
export const project = (x: number, y: number) => ({ x: (x - y) * Math.cos(Math.PI / 6), y: (x + y) * .5 });
