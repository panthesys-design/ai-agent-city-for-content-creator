import { CITY_PLOT, HEADQUARTERS_ID, headquarters, isPlotFree, nextOfficePosition, starterAgents, type HeadquartersSpec } from "@/components/agent-city";
import { defaultRuntimeConfig, starterRoles, type AgentRuntimeConfig } from "./agent-config";
import { fromStrapi, originalLayout, toOffice, type AgentInput, type AgentRecord, type Plot } from "./agent-records";
import { headquartersPosition, type HeadquartersRecord } from "./headquarters";
import { agentDefaultsFrom } from "./workspace-settings";
import { strapi } from "./strapi";

// Server-only persistence for agents in Strapi's `agents` collection (singular API ID `agent`).
// Every agent belongs to one headquarters; callers must pass the signed-in user's own headquarters.

type Rows = { data: Record<string, unknown>[] };

/** The headquarters as a building on its current plot, for occupancy checks. */
const hqBuilding = (hq: HeadquartersRecord): HeadquartersSpec => ({ ...headquarters, id: HEADQUARTERS_ID, ...headquartersPosition(hq) });

/** All agents in a headquarters' city, oldest first. */
export async function listAgents(hq: HeadquartersRecord): Promise<AgentRecord[]> {
  const query = new URLSearchParams({
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "sort[0]": "createdAt:asc",
    "pagination[pageSize]": "200",
  });
  const { data } = await strapi<Rows>(`/agents?${query}`);
  return data.map(fromStrapi);
}

/** The agent with this document ID if it belongs to the headquarters, otherwise null. */
export async function findOwnedAgent(hq: HeadquartersRecord, documentId: string): Promise<AgentRecord | null> {
  const query = new URLSearchParams({
    "filters[documentId][$eq]": documentId,
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "pagination[pageSize]": "1",
  });
  const { data } = await strapi<Rows>(`/agents?${query}`);
  return data[0] ? fromStrapi(data[0]) : null;
}

async function insertAgent(hq: HeadquartersRecord, input: AgentInput, position: { x: number; y: number }, runtime: AgentRuntimeConfig): Promise<AgentRecord> {
  const { data } = await strapi<{ data: Record<string, unknown> }>("/agents", {
    method: "POST",
    body: JSON.stringify({ data: { ...input, ...runtime, ...position, status: "idle", headquarter: { connect: [hq.documentId] } } }),
  });
  return fromStrapi(data);
}

const setSeeded = (hq: HeadquartersRecord, agentsSeeded: boolean) =>
  strapi(`/headquarters/${hq.documentId}`, { method: "PUT", body: JSON.stringify({ data: { agentsSeeded } }) });

/**
 * Gives a new city its six starter agents, once. The headquarters is flagged first, so a user who later
 * deletes every agent never gets the starters back. Only starters whose name is missing are created and
 * plots already in use are skipped, so a repeated or interrupted run never duplicates buildings. If a run
 * fails partway, the flag is cleared so the next visit fills in the rest.
 */
export async function ensureStarterAgents(hq: HeadquartersRecord): Promise<AgentRecord[]> {
  if (hq.agentsSeeded) return listAgents(hq);
  await setSeeded(hq, true);
  const agents = await listAgents(hq);
  try {
    for (const starter of starterAgents) {
      if (agents.some(a => a.name === starter.name)) continue;
      const center = headquartersPosition(hq);
      const preferred = { x: center.x + starter.plot.col * CITY_PLOT, y: center.y + starter.plot.row * CITY_PLOT };
      const buildings = [hqBuilding(hq), ...agents.map(toOffice)];
      const position = isPlotFree(buildings, preferred) ? preferred : nextOfficePosition({ buildings, links: [] });
      agents.push(await insertAgent(hq, { name: starter.name, instructions: starter.task, ...starter.appearance, roof: [...starter.appearance.roof] }, position,
        defaultRuntimeConfig(starterRoles[starter.name] ?? "custom", agentDefaultsFrom(hq.agentDefaults))));
    }
  } catch (error) {
    await setSeeded(hq, false).catch(() => undefined);
    throw error;
  }
  return agents;
}

/** Saves a new agent on the first free plot around headquarters. */
export async function createAgent(hq: HeadquartersRecord, input: AgentInput): Promise<AgentRecord> {
  const existing = await listAgents(hq);
  const position = nextOfficePosition({ buildings: [hqBuilding(hq), ...existing.map(toOffice)], links: [] });
  return insertAgent(hq, input, position, defaultRuntimeConfig("custom", agentDefaultsFrom(hq.agentDefaults)));
}

/** Saves an agent's AI configuration: role, model, tools, and execution settings. */
export async function updateAgentRuntime(documentId: string, config: AgentRuntimeConfig): Promise<AgentRecord> {
  const { data } = await strapi<{ data: Record<string, unknown> }>(`/agents/${documentId}`, { method: "PUT", body: JSON.stringify({ data: config }) });
  return fromStrapi(data);
}

export type AgentLiveState = Pick<AgentRecord, "status" | "progress" | "activity">;

/** Updates what the city shows for an agent: status badge, progress, and current activity. */
export async function setAgentState(documentId: string, state: Partial<AgentLiveState>): Promise<void> {
  const data: Record<string, unknown> = { ...state };
  if (typeof state.activity === "string") data.activity = state.activity.slice(0, 120);
  if (typeof state.progress === "number") data.progress = Math.max(0, Math.min(100, Math.round(state.progress)));
  await strapi(`/agents/${documentId}`, { method: "PUT", body: JSON.stringify({ data }) });
}

/** The state an agent shows when it isn't working: a plain "Idle" with no progress or activity line. */
export const IDLE_STATE: AgentLiveState = { status: "idle", progress: null, activity: null };

/**
 * Clears leftover status (completed, failed, old activity) from every agent that isn't working, so when a new
 * task starts only agents doing work show a status. Agents still working on another run are left alone.
 */
export async function clearIdleAgentStates(hq: HeadquartersRecord, { except }: { except?: string } = {}): Promise<void> {
  const stale = (await listAgents(hq)).filter((a) =>
    a.documentId !== except && a.status !== "working" && a.status !== "waiting" && (a.status !== "idle" || a.progress != null || a.activity != null));
  await Promise.all(stale.map((a) => setAgentState(a.documentId, IDLE_STATE)));
}

export async function updateAgent(documentId: string, input: AgentInput): Promise<AgentRecord> {
  const { data } = await strapi<{ data: Record<string, unknown> }>(`/agents/${documentId}`, { method: "PUT", body: JSON.stringify({ data: input }) });
  return fromStrapi(data);
}

/** Moves an agent's office to a plot. Throws when the plot is headquarters' or another office's. */
export async function moveAgent(hq: HeadquartersRecord, documentId: string, position: { x: number; y: number }): Promise<AgentRecord> {
  const others = (await listAgents(hq)).filter(a => a.documentId !== documentId).map(toOffice);
  if (!isPlotFree([hqBuilding(hq), ...others], position)) throw new PlotTakenError();
  const { data } = await strapi<{ data: Record<string, unknown> }>(`/agents/${documentId}`, { method: "PUT", body: JSON.stringify({ data: position }) });
  return fromStrapi(data);
}

/** Moves the headquarters to a plot. Throws when an office stands there. Roads follow automatically. */
export async function moveHeadquarters(hq: HeadquartersRecord, position: Plot): Promise<Plot> {
  const offices = (await listAgents(hq)).map(toOffice);
  if (!isPlotFree(offices, position)) throw new PlotTakenError();
  await strapi(`/headquarters/${hq.documentId}`, { method: "PUT", body: JSON.stringify({ data: position }) });
  return position;
}

/** Puts headquarters and every agent back on the original layout (see `originalLayout`). Appearance is untouched. */
export async function resetLayout(hq: HeadquartersRecord): Promise<{ headquarters: Plot; agents: AgentRecord[] }> {
  const agents = await listAgents(hq);
  const layout = originalLayout(agents);
  // Clearing x/y returns headquarters to its preset plot.
  await strapi(`/headquarters/${hq.documentId}`, { method: "PUT", body: JSON.stringify({ data: { x: null, y: null } }) });
  const moved = await Promise.all(agents.map(async agent => {
    const plot = layout.agents[agent.documentId];
    if (agent.x === plot.x && agent.y === plot.y) return agent;
    const { data } = await strapi<{ data: Record<string, unknown> }>(`/agents/${agent.documentId}`, { method: "PUT", body: JSON.stringify({ data: plot }) });
    return fromStrapi(data);
  }));
  return { headquarters: layout.headquarters, agents: moved };
}

export async function deleteAgent(documentId: string): Promise<void> {
  await strapi(`/agents/${documentId}`, { method: "DELETE" });
}

export class PlotTakenError extends Error {
  constructor() { super("That plot is already taken."); }
}
