import {
  AGENT_NAME_MAX, AGENT_TASK_MAX, CITY_PLOT, agentDesigns, agentStatuses, buildingIcons, buildingThemes, headquarters,
  nextOfficePosition, roofItems, starterAgents,
  type Agent, type AgentOffice, type AgentStatus, type CityBuilding, type CityLink, type NewAgentDraft,
} from "@/components/agent-city";
import { runtimeConfigFromRow, type AgentRuntimeConfig } from "./agent-config";

// Client-safe shapes and validation for agents saved in Strapi's `agents` collection.
// One record holds the agent and its office: instructions, appearance, and plot position.
// Server-only persistence lives in lib/agents.ts.

export type AgentAppearance = Required<Pick<AgentOffice, "design" | "theme" | "icon" | "floors" | "glass" | "interior" | "roof" | "trees">>;
export type AgentInput = { name: string; instructions: string } & AgentAppearance;
export type AgentRecord = AgentInput & AgentRuntimeConfig & {
  documentId: string;
  status: AgentStatus;
  progress: number | null;
  activity: string | null;
  x: number;
  y: number;
};

/** How far from the origin a plot may be, in plots. Keeps saved layouts within a sane area. */
export const MAX_PLOT_DISTANCE = 12;

const officeId = (documentId: string) => `office-${documentId}`;

/** A saved agent as the `Agent` the city shows status for. */
export function toCityAgent(record: AgentRecord): Agent {
  return { id: record.documentId, name: record.name, task: record.instructions, status: record.status, progress: record.progress, activity: record.activity };
}

/** A saved agent's office building. */
export function toOffice(record: AgentRecord): AgentOffice {
  const { documentId, name, x, y, design, theme, icon, floors, glass, interior, roof, trees } = record;
  return { id: officeId(documentId), agentId: documentId, type: "agent", name, x, y, design, theme, icon, floors, glass, interior, roof: [...roof], trees };
}

/** The street road from an office to headquarters. Derived from positions, so it follows every move. */
export function toRoad(record: AgentRecord, headquartersId: string): CityLink {
  return { id: `road-${record.documentId}`, from: officeId(record.documentId), to: headquartersId, route: "street" };
}

/** The dialog draft for editing a saved agent. */
export function toDraft(record: AgentRecord): NewAgentDraft {
  const { name, instructions, design, theme, icon, floors, glass, interior, roof, trees } = record;
  return { name, task: instructions, appearance: { design, theme, icon, floors, glass, interior, roof: [...roof], trees } };
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback?: T): T | null {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback ?? null;
}

/** Validates a dialog draft at the server boundary. Returns the input, or an error message for the first invalid field. */
export function parseAgentDraft(raw: unknown): { input: AgentInput } | { error: string } {
  const draft = (raw ?? {}) as Partial<NewAgentDraft>;
  const appearance = (draft.appearance ?? {}) as Partial<AgentOffice>;
  const name = typeof draft.name === "string" ? draft.name.trim().replace(/\s+/g, " ") : "";
  const instructions = typeof draft.task === "string" ? draft.task.trim() : "";
  if (!name) return { error: "Give your agent a name." };
  if (name.length > AGENT_NAME_MAX) return { error: `Keep the name to ${AGENT_NAME_MAX} characters or fewer.` };
  if (!instructions) return { error: "Tell your agent what to do." };
  if (instructions.length > AGENT_TASK_MAX) return { error: `Keep the instructions to ${AGENT_TASK_MAX} characters or fewer.` };

  const design = oneOf(agentDesigns, appearance.design);
  const theme = oneOf(buildingThemes, appearance.theme);
  const icon = oneOf(buildingIcons, appearance.icon);
  const glass = oneOf(["full", "front", "none"] as const, appearance.glass, "full");
  const interior = oneOf(["desk", "writer", "voice", "editing", "gallery", "publish"] as const, appearance.interior, "desk");
  const floors = Number(appearance.floors);
  if (!design) return { error: "Choose a building design." };
  if (!theme) return { error: "Choose a building color." };
  if (!icon) return { error: "Choose a sign icon." };
  if (![1, 2, 3, 4].includes(floors)) return { error: "Choose a building height." };
  const roof = Array.isArray(appearance.roof) ? [...new Set(appearance.roof.filter(item => (roofItems as readonly string[]).includes(item)))] : [];

  return {
    input: {
      name, instructions, design, theme, icon, glass: glass!, interior: interior!, roof,
      floors: floors as AgentAppearance["floors"],
      trees: appearance.trees !== false,
    },
  };
}

/** Validates a drop position: a whole plot on the city grid within MAX_PLOT_DISTANCE. */
export function parsePlot(raw: unknown): { x: number; y: number } | null {
  const { x, y } = (raw ?? {}) as { x?: unknown; y?: unknown };
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n % CITY_PLOT === 0 && Math.abs(n) <= MAX_PLOT_DISTANCE * CITY_PLOT;
  return valid(x) && valid(y) ? { x, y } : null;
}

/** Normalises a Strapi agent row, tolerating missing optional fields. */
export function fromStrapi(row: Record<string, unknown>): AgentRecord {
  const parsed = parseAgentDraft({
    name: row.name, task: row.instructions,
    appearance: { design: row.design, theme: row.theme, icon: row.icon, floors: row.floors, glass: row.glass, interior: row.interior, roof: row.roof, trees: row.trees },
  });
  const input: AgentInput = "input" in parsed ? parsed.input : {
    name: String(row.name ?? "Agent"), instructions: String(row.instructions ?? ""), design: "studio", theme: "lavender",
    icon: "sparkle", floors: 1, glass: "full", interior: "desk", roof: [], trees: true,
  };
  const progress = typeof row.progress === "number" ? Math.max(0, Math.min(100, Math.round(row.progress))) : null;
  return {
    ...input,
    ...runtimeConfigFromRow(row, input.name),
    documentId: String(row.documentId),
    status: oneOf(agentStatuses, row.status, "idle")!,
    progress,
    activity: typeof row.activity === "string" && row.activity.trim() ? row.activity.trim() : null,
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
  };
}

export type Plot = { x: number; y: number };

/**
 * The original city layout: headquarters on its preset plot, each starter agent (matched by name, first
 * match wins) on its starter plot, and every other agent on the next free plot in creation order —
 * the same placement new agents get.
 */
export function originalLayout(records: readonly AgentRecord[]): { headquarters: Plot; agents: Record<string, Plot> } {
  const hq: Plot = { x: headquarters.x, y: headquarters.y };
  const agents: Record<string, Plot> = {};
  const buildings: CityBuilding[] = [{ ...headquarters, ...hq }];
  const place = (record: AgentRecord, plot: Plot) => { agents[record.documentId] = plot; buildings.push(toOffice({ ...record, ...plot })); };
  for (const starter of starterAgents) {
    const record = records.find(r => r.name === starter.name && !(r.documentId in agents));
    if (record) place(record, { x: hq.x + starter.plot.col * CITY_PLOT, y: hq.y + starter.plot.row * CITY_PLOT });
  }
  for (const record of records) if (!(record.documentId in agents)) place(record, nextOfficePosition({ buildings, links: [] }));
  return { headquarters: hq, agents };
}
