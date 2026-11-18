"use server";

import type { NewAgentDraft } from "@/components/agent-city";
import { parseAgentDraft, parsePlot, type AgentRecord, type Plot } from "@/lib/agent-records";
import { createAgent, deleteAgent, findOwnedAgent, moveAgent, moveHeadquarters, PlotTakenError, resetLayout, updateAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth/session";
import { findHeadquarters } from "@/lib/headquarters";

// Agent CRUD for the city page. Every action re-checks the session and that the agent belongs to the
// caller's own headquarters; IDs and positions from the browser are never trusted on their own.

export type AgentActionResult = { ok: true; agent: AgentRecord } | { ok: false; error: string };
export type DeleteAgentResult = { ok: true } | { ok: false; error: string };
export type MoveHeadquartersResult = { ok: true; position: Plot } | { ok: false; error: string };
export type ResetLayoutResult = { ok: true; headquarters: Plot; agents: AgentRecord[] } | { ok: false; error: string };

const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
const NOT_FOUND = "This agent no longer exists. Refresh the page to see your latest city.";

async function currentHeadquarters() {
  const user = await getCurrentUser();
  return user ? findHeadquarters(user.email) : null;
}
const isDocumentId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{8,64}$/i.test(value);

async function attempt<T extends { ok: boolean }>(fallback: string, run: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PlotTakenError) return { ok: false, error: error.message };
    console.error(error);
    return { ok: false, error: fallback };
  }
}

export async function createAgentAction(draft: NewAgentDraft): Promise<AgentActionResult> {
  return attempt("We couldn't create your agent. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const parsed = parseAgentDraft(draft);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    return { ok: true, agent: await createAgent(hq, parsed.input) };
  });
}

export async function updateAgentAction(documentId: string, draft: NewAgentDraft): Promise<AgentActionResult> {
  return attempt("We couldn't save your changes. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const parsed = parseAgentDraft(draft);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    if (!isDocumentId(documentId) || !(await findOwnedAgent(hq, documentId))) return { ok: false, error: NOT_FOUND };
    return { ok: true, agent: await updateAgent(documentId, parsed.input) };
  });
}

export async function moveAgentAction(documentId: string, position: { x: number; y: number }): Promise<AgentActionResult> {
  return attempt("We couldn't save the new location. The building was moved back.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const plot = parsePlot(position);
    if (!plot) return { ok: false, error: "Drop the building on a plot inside the city." };
    if (!isDocumentId(documentId) || !(await findOwnedAgent(hq, documentId))) return { ok: false, error: NOT_FOUND };
    return { ok: true, agent: await moveAgent(hq, documentId, plot) };
  });
}

export async function deleteAgentAction(documentId: string): Promise<DeleteAgentResult> {
  return attempt("We couldn't delete this agent. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    if (!isDocumentId(documentId) || !(await findOwnedAgent(hq, documentId))) return { ok: false, error: NOT_FOUND };
    await deleteAgent(documentId);
    return { ok: true };
  });
}

export async function moveHeadquartersAction(position: { x: number; y: number }): Promise<MoveHeadquartersResult> {
  return attempt("We couldn't save the new location. Headquarters was moved back.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const plot = parsePlot(position);
    if (!plot) return { ok: false, error: "Drop the building on a plot inside the city." };
    return { ok: true, position: await moveHeadquarters(hq, plot) };
  });
}

export async function resetLayoutAction(): Promise<ResetLayoutResult> {
  return attempt("We couldn't reset the layout. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    return { ok: true, ...(await resetLayout(hq)) };
  });
}
