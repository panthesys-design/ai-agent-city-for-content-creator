import type { Agent, HeadquartersSpec, CityConfig } from './types';

export const HEADQUARTERS_ID = 'headquarters';
export const headquarters: HeadquartersSpec = {
  id: HEADQUARTERS_ID,
  name: 'Headquarters',
  type: 'skyscraper',
  x: 290, y: 290,
  style: 'empire', theme: 'gold', height: 2, tint: 'warm',
  icon: 'sparkle', spire: true, trees: true,
};

/** Alternative specs for the same permanent HQ; choose one rather than adding all three. */
export const headquartersPresets = {
  empire: { ...headquarters },
  crown: { ...headquarters, style: 'crown', theme: 'sky', tint: 'blue' },
  twin: { ...headquarters, style: 'twin', theme: 'lavender', tint: 'teal' },
} satisfies Record<'empire' | 'crown' | 'twin', HeadquartersSpec>;

/** A new workspace always starts with one headquarters and no agent offices. */
export const creatorAgents: Agent[] = [];
export const creatorCity: CityConfig = {
  buildings: [headquarters],
  links: [],
};

/** Reuse free plots after deletion; never place a new office over an existing plot. */
export function nextOfficePosition(config: CityConfig): { x: number; y: number } {
  const hq = config.buildings.find(b => b.id === HEADQUARTERS_ID) ?? headquarters;
  for (let ring = 1; ; ring++) {
    for (let row = -ring; row <= ring; row++) {
      for (let col = -ring; col <= ring; col++) {
        if (Math.max(Math.abs(row), Math.abs(col)) !== ring) continue;
        const x = hq.x + col * 290, y = hq.y + row * 290;
        if (!config.buildings.some(b => Math.abs(b.x - x) < 220 && Math.abs(b.y - y) < 220)) return { x, y };
      }
    }
  }
}
