import { CITY_PLOT, isPlotFree } from './road-geometry';
import type { Agent, AgentOffice, HeadquartersSpec, CityConfig } from './types';

export const HEADQUARTERS_ID = 'headquarters';
export const headquarters: HeadquartersSpec = {
  id: HEADQUARTERS_ID,
  name: 'Headquarters',
  type: 'skyscraper',
  x: CITY_PLOT, y: CITY_PLOT,
  style: 'empire', theme: 'gold', height: 2, tint: 'warm',
  icon: 'sparkle', spire: true, trees: true,
};

/** Alternative specs for the same permanent HQ; choose one rather than adding all three. */
export const headquartersPresets = {
  empire: { ...headquarters },
  crown: { ...headquarters, style: 'crown', theme: 'sky', tint: 'blue' },
  twin: { ...headquarters, style: 'twin', theme: 'lavender', tint: 'teal' },
} satisfies Record<'empire' | 'crown' | 'twin', HeadquartersSpec>;

/** The appearance an agent's office can be customised with (everything but identity and position). */
export type OfficeAppearance = Omit<AgentOffice, 'id' | 'agentId' | 'name' | 'type' | 'x' | 'y'>;

export interface StarterAgent {
  name: string;
  task: string;
  appearance: Required<Pick<OfficeAppearance, 'design' | 'theme' | 'icon' | 'floors' | 'glass' | 'interior' | 'roof' | 'trees'>>;
  /** Plot offset from headquarters, in plots. Chosen so no starter hides behind (or in front of) the HQ tower. */
  plot: { col: number; row: number };
}

/** The content-creation pipeline a new city starts with, arranged around headquarters in pipeline order. */
export const starterAgents: readonly StarterAgent[] = [
  {
    name: 'Research Agent',
    task: 'Find trending topics and credible sources, gather key facts and data, and hand a concise research brief to the Script Writer.',
    appearance: { design: 'observatory', theme: 'sky', icon: 'search', floors: 1, glass: 'full', interior: 'desk', roof: [], trees: true },
    plot: { col: -1, row: 1 },
  },
  {
    name: 'Script Writer Agent',
    task: 'Turn the research brief into an engaging video script with a strong hook, a clear structure, and a call to action.',
    appearance: { design: 'studio', theme: 'lavender', icon: 'doc', floors: 1, glass: 'full', interior: 'writer', roof: ['tree', 'units'], trees: true },
    plot: { col: -1, row: 0 },
  },
  {
    name: 'Voice Agent',
    task: 'Record a natural, expressive voiceover from the final script that matches the channel’s tone and pacing.',
    appearance: { design: 'broadcast', theme: 'mint', icon: 'wave', floors: 1, glass: 'full', interior: 'voice', roof: [], trees: true },
    plot: { col: 0, row: -1 },
  },
  {
    name: 'Media Agent',
    task: 'Source and generate visuals — B-roll, images, thumbnails, and graphics — that match each scene of the script.',
    appearance: { design: 'gallery', theme: 'peach', icon: 'image', floors: 1, glass: 'full', interior: 'gallery', roof: [], trees: true },
    plot: { col: 1, row: -1 },
  },
  {
    name: 'Video Editor Agent',
    task: 'Assemble the voiceover and media into a polished video with cuts, captions, music, and transitions.',
    appearance: { design: 'cinema', theme: 'rose', icon: 'play', floors: 1, glass: 'full', interior: 'editing', roof: [], trees: true },
    plot: { col: 1, row: 0 },
  },
  {
    name: 'Publishing/Scheduler Agent',
    task: 'Write titles, descriptions, and tags, then schedule and publish each video at the best time for the audience.',
    appearance: { design: 'dispatch', theme: 'white', icon: 'rocket', floors: 1, glass: 'full', interior: 'publish', roof: [], trees: true },
    plot: { col: 0, row: 1 },
  },
];

/** A blank workspace: one headquarters and no agent offices. */
export const creatorAgents: Agent[] = [];
export const creatorCity: CityConfig = {
  buildings: [headquarters],
  links: [],
};

/**
 * First free plot around headquarters, ring by ring. Plots sit on the CITY_PLOT grid so street routing
 * stays aligned. The two plots on the HQ's screen axis in the first two rings are skipped: directly
 * behind, an office would be hidden by the tower; directly in front, it would hide the HQ entrance.
 */
export function nextOfficePosition(config: CityConfig): { x: number; y: number } {
  const hq = config.buildings.find(b => b.id === HEADQUARTERS_ID) ?? headquarters;
  for (let ring = 1; ; ring++) {
    for (let row = -ring; row <= ring; row++) {
      for (let col = -ring; col <= ring; col++) {
        if (Math.max(Math.abs(row), Math.abs(col)) !== ring) continue;
        if (row === col && ring <= 2) continue;
        const position = { x: hq.x + col * CITY_PLOT, y: hq.y + row * CITY_PLOT };
        if (isPlotFree(config.buildings, position)) return position;
      }
    }
  }
}
