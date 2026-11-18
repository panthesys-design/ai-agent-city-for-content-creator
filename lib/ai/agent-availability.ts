import { listOpenAgentTasks } from "@/lib/runtime-store";
import type { TaskRecord } from "@/lib/task-records";
import { listActiveWaits } from "./external-waits";

// Each agent works on one thing at a time. Several headquarters requests can be in progress at once, so a step
// whose agent is busy waits (the step is "queued for the agent") and starts by itself when the agent is free.
//
// An agent is busy while one of its tasks runs (a plan step, a standalone task, or a chat) or has been dispatched
// to run. A task waiting for a website (wait_for_external) leaves its agent free, and so does a step queued for it.
// Strapi has no transactions, so a run claims the agent by writing first and checking afterwards: of the agent's
// busy tasks, the oldest one holds it, and a newer one that finds itself second steps back.

/** Tasks that occupy the agent now, oldest first. */
async function busyTasks(hqId: string, agentId: string): Promise<TaskRecord[]> {
  const [open, waits] = await Promise.all([listOpenAgentTasks(hqId, agentId), listActiveWaits(hqId).catch(() => [])]);
  const parked = new Set(waits.filter((w) => w.status === "waiting").map((w) => w.taskId));
  return open.filter((t) => !parked.has(t.documentId) && (t.status === "running" || Boolean(t.jobRunId)));
}

/** True when nothing occupies the agent (ignoring `exceptTaskId`). */
export async function agentIsFree(hqId: string, agentId: string, exceptTaskId?: string): Promise<boolean> {
  return (await busyTasks(hqId, agentId)).every((t) => t.documentId === exceptTaskId);
}

/** True when `taskId` (already marked running or dispatched) is the agent's oldest busy task, so it may run. */
export async function holdsAgent(hqId: string, agentId: string, taskId: string): Promise<boolean> {
  const busy = await busyTasks(hqId, agentId);
  return !busy.length || busy[0].documentId === taskId;
}

/** "Waiting for <agent> to be free": the plan step label while a step is queued for its agent. */
export const agentBusyLabel = (agentName: string) => `${agentName} to be free`;
