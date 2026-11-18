import { strapi } from "@/lib/strapi";

// Server-only persistence for long waits on a website (Claude building a video, a cloud render) without holding
// an agent run or a running computer. `wait_for_external` saves an `external-waits` record and ends the run with
// RunParkedError; the task stays "running". A CloudHike Jobs schedule (lib/ai/wait-checker.ts) opens the page every
// few minutes, checks it without a model, turns the computer off again, and resumes the task once it is ready.
// Shapes and pure helpers are in lib/external-wait-records.ts. Strapi collection: `external-waits`.

import type { ExternalWait, WaitOutcome, WaitStatus } from "@/lib/external-wait-records";

export { RunParkedError, clockTime, parkedFrom, waitingActivity, type ExternalWait, type WaitOutcome, type WaitStatus } from "@/lib/external-wait-records";

// ---------- Strapi ----------

type Row = Record<string, unknown>;
const POPULATE = {
  "populate[headquarter][fields][0]": "documentId",
  "populate[agent][fields][0]": "name",
  "populate[task][fields][0]": "documentId",
  "populate[rootTask][fields][0]": "documentId",
};
const connect = (documentId: string) => ({ connect: [documentId] });
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const rel = (v: unknown) => (v && typeof v === "object" && "documentId" in v ? String((v as { documentId: unknown }).documentId) : null);

function waitFrom(row: Row): ExternalWait {
  const agent = row.agent as { name?: unknown } | null | undefined;
  const status = ["waiting", "resuming", "done", "cancelled"].includes(String(row.status)) ? (row.status as WaitStatus) : "waiting";
  const outcome = ["ready", "timeout", "signin"].includes(String(row.outcome)) ? (row.outcome as WaitOutcome) : null;
  return {
    documentId: String(row.documentId),
    status,
    title: String(row.title ?? "the website"),
    url: String(row.url ?? ""),
    readyText: str(row.readyText),
    busyText: str(row.busyText),
    next: String(row.next ?? ""),
    outcome,
    intervalSeconds: typeof row.intervalSeconds === "number" ? row.intervalSeconds : 300,
    nextCheckAt: String(row.nextCheckAt ?? new Date().toISOString()),
    deadlineAt: String(row.deadlineAt ?? new Date().toISOString()),
    lastCheckAt: str(row.lastCheckAt),
    checks: typeof row.checks === "number" ? row.checks : 0,
    lastResult: str(row.lastResult),
    headquartersId: rel(row.headquarter),
    agentId: rel(row.agent),
    agentName: agent && typeof agent.name === "string" ? agent.name : null,
    taskId: rel(row.task),
    rootTaskId: rel(row.rootTask),
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
  };
}

export type NewWait = {
  hqId: string;
  agentId: string | null;
  taskId: string;
  rootTaskId: string | null;
  title: string;
  url: string;
  readyText: string | null;
  busyText: string | null;
  next: string;
  intervalSeconds: number;
  nextCheckAt: string;
  deadlineAt: string;
};

export async function createWait(wait: NewWait): Promise<ExternalWait> {
  const { data } = await strapi<{ data: Row }>(`/external-waits?${new URLSearchParams(POPULATE)}`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        status: "waiting", title: wait.title.slice(0, 160), url: wait.url, readyText: wait.readyText?.slice(0, 200) ?? null,
        busyText: wait.busyText?.slice(0, 200) ?? null, next: wait.next, intervalSeconds: wait.intervalSeconds,
        nextCheckAt: wait.nextCheckAt, deadlineAt: wait.deadlineAt, checks: 0,
        headquarter: connect(wait.hqId), task: connect(wait.taskId),
        ...(wait.agentId ? { agent: connect(wait.agentId) } : {}),
        ...(wait.rootTaskId ? { rootTask: connect(wait.rootTaskId) } : {}),
      },
    }),
  });
  return waitFrom(data);
}

export async function getWait(documentId: string): Promise<ExternalWait | null> {
  try {
    const { data } = await strapi<{ data: Row }>(`/external-waits/${documentId}?${new URLSearchParams(POPULATE)}`);
    return waitFrom(data);
  } catch {
    return null;
  }
}

export type WaitPatch = Partial<{
  status: WaitStatus; outcome: WaitOutcome | null; nextCheckAt: string; lastCheckAt: string; checks: number; lastResult: string | null;
}>;

export async function updateWait(documentId: string, patch: WaitPatch): Promise<void> {
  const data: Row = { ...patch };
  if (typeof patch.lastResult === "string") data.lastResult = patch.lastResult.slice(0, 300);
  await strapi(`/external-waits/${documentId}`, { method: "PUT", body: JSON.stringify({ data }) });
}

async function listWaits(filters: Record<string, string>, pageSize = 50): Promise<ExternalWait[]> {
  const query = new URLSearchParams({ ...POPULATE, ...filters, "sort[0]": "nextCheckAt:asc", "pagination[pageSize]": String(pageSize) });
  const { data } = await strapi<{ data: Row[] }>(`/external-waits?${query}`);
  return data.map(waitFrom);
}

/** Waits whose next check (or deadline) is due, across every headquarters, or one headquarters with `hqId`. */
export function listDueWaits(hqId?: string): Promise<ExternalWait[]> {
  const now = new Date().toISOString();
  return listWaits({
    "filters[status][$eq]": "waiting",
    "filters[$or][0][nextCheckAt][$lte]": now,
    "filters[$or][1][deadlineAt][$lte]": now,
    ...(hqId ? { "filters[headquarter][documentId][$eq]": hqId } : {}),
  }, 25);
}

/** Waits that still hold a task (waiting, or resumed and running), for one headquarters or all. */
export function listActiveWaits(hqId?: string): Promise<ExternalWait[]> {
  return listWaits({
    "filters[status][$in][0]": "waiting",
    "filters[status][$in][1]": "resuming",
    ...(hqId ? { "filters[headquarter][documentId][$eq]": hqId } : {}),
  }, 100);
}

/** How many waits a task has had, so an agent can't wait on the same task forever. */
export async function countTaskWaits(taskId: string): Promise<number> {
  const query = new URLSearchParams({ "filters[task][documentId][$eq]": taskId, "pagination[pageSize]": "1", "pagination[withCount]": "true" });
  const result = await strapi<{ meta?: { pagination?: { total?: number } } }>(`/external-waits?${query}`);
  return result.meta?.pagination?.total ?? 0;
}

/** Cancels the open waits of these tasks. Returns how many were open. */
export async function cancelWaitsForTasks(hqId: string, taskIds: string[]): Promise<number> {
  if (!taskIds.length) return 0;
  const open = (await listActiveWaits(hqId)).filter((w) => (w.taskId && taskIds.includes(w.taskId)) || (w.rootTaskId && taskIds.includes(w.rootTaskId)));
  await Promise.all(open.map((w) => updateWait(w.documentId, { status: "cancelled" })));
  return open.length;
}
