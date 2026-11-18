import type { RoadStyle } from './road';
import type { RoadPoint, RoadRoute } from './road-geometry';

export const buildingThemes = ['lavender', 'mint', 'peach', 'sky', 'rose', 'white'] as const;
export const buildingIcons = ['search', 'doc', 'wave', 'play', 'image', 'rocket', 'sparkle'] as const;
export const roofItems = ['tree', 'units', 'dish', 'solar', 'garden'] as const;
/** Office architectures. `studio` is the glass studio; the others are landmark designs for specific kinds of work. */
export const agentDesigns = ['studio', 'observatory', 'broadcast', 'gallery', 'cinema', 'dispatch'] as const;
export type AgentDesign = typeof agentDesigns[number];
export const agentDesignInfo: Record<AgentDesign, { label: string; description: string }> = {
  studio: { label: 'Glass studio', description: 'Open studio with a visible interior' },
  observatory: { label: 'Observatory lab', description: 'Lab with a rooftop telescope dome' },
  broadcast: { label: 'Broadcast studio', description: 'Equalizer wall, ON AIR tower and mast' },
  gallery: { label: 'Media gallery', description: 'Stacked gallery with art and a camera' },
  cinema: { label: 'Cinema', description: 'Big screen, marquee lights and reels' },
  dispatch: { label: 'Dispatch tower', description: 'Clock tower, calendar wall and rocket' },
};
/** Sign/accent colour for each palette, matching the renderer. */
export const themeAccent: Record<typeof buildingThemes[number] | 'gold', string> = {
  lavender: '#7c4dea', mint: '#12a38a', peach: '#f0703a', sky: '#3b7bf0', rose: '#e04f8f', white: '#2d3340', gold: '#c08a1e',
};
/**
 * `working`/`waiting` describe a running task (`waiting`: the agent needs the user, e.g. to sign in or choose an option);
 * `completed`/`failed` describe the agent's last task; `error`/`offline` describe the agent itself.
 */
export const agentStatuses = ['idle', 'working', 'waiting', 'completed', 'failed', 'error', 'offline'] as const;
export type AgentStatus = typeof agentStatuses[number];
export interface Agent {
  id: string;
  name: string;
  task: string;
  status: AgentStatus;
  /** 0–100 while a task is running; display data only. */
  progress?: number | null;
  /** Short description of the current step, shown with progress. */
  activity?: string | null;
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
  design?: AgentDesign;
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

/** Short building-sign text: drops a trailing "Agent" and keeps the first part of "A/B" names (max 16 characters). */
export function signLabel(name: string): string {
  let label = name.trim().replace(/\s+agent$/i, '') || name.trim();
  if (label.length > 16 && label.includes('/')) label = label.split('/')[0].trim();
  return label.length > 16 ? `${label.slice(0, 15)}…` : label;
}
