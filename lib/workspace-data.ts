import { cancelJobRun } from "./ai/jobs";
import { composioConfigured } from "./composio/client";
import { listConnections, removeConnection } from "./composio/connections";
import { computersEnabled, findCloudComputer, stopCloudComputer } from "./computer/client";
import type { HeadquartersRecord } from "./headquarters";
import { strapi } from "./strapi";

// Server-only "danger zone" operations from the Settings page. Both are scoped to one headquarters: every query
// filters by its documentId, and callers must pass the signed-in user's own record.

type Row = { id: number; documentId: string };
const PAGE = 100;
const PARALLEL = 6;

/** Runs `fn` on every item, a few at a time. */
async function inBatches<T>(items: T[], fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += PARALLEL) await Promise.all(items.slice(i, i + PARALLEL).map(fn));
}

/** Deletes every row of a collection that belongs to the headquarters. Returns how many were deleted. */
async function deleteAll(collection: string, hqId: string, extra: Record<string, string> = {}, before?: (rows: Record<string, unknown>[]) => Promise<void>): Promise<number> {
  let deleted = 0;
  // Always read the first page: each pass deletes what it read, so the next first page is the next batch.
  for (let pass = 0; pass < 500; pass++) {
    const query = new URLSearchParams({
      "filters[headquarter][documentId][$eq]": hqId,
      "fields[0]": "documentId",
      "pagination[pageSize]": String(PAGE),
      ...extra,
    });
    const { data } = await strapi<{ data: (Row & Record<string, unknown>)[] }>(`/${collection}?${query}`);
    if (!data.length) break;
    await before?.(data);
    await inBatches(data, (row) => strapi(`/${collection}/${row.documentId}`, { method: "DELETE" }));
    deleted += data.length;
    if (data.length < PAGE) break;
  }
  return deleted;
}

/** Clears the headquarters' shared memory (Strapi `memories`). Artifacts, chats, agents, and tasks are untouched. */
export async function clearSharedMemory(hq: HeadquartersRecord): Promise<number> {
  return deleteAll("memories", hq.documentId);
}

/** Stops queued and running work so nothing writes to the headquarters while it is being deleted. */
async function stopAllWork(hqId: string) {
  const query = new URLSearchParams({
    "filters[headquarter][documentId][$eq]": hqId,
    "filters[status][$in][0]": "queued",
    "filters[status][$in][1]": "running",
    "fields[0]": "documentId",
    "fields[1]": "jobRunId",
    "pagination[pageSize]": "200",
  });
  const { data } = await strapi<{ data: (Row & { jobRunId?: string | null })[] }>(`/agent-tasks?${query}`);
  await inBatches(data, async (task) => {
    await strapi(`/agent-tasks/${task.documentId}`, {
      method: "PUT",
      body: JSON.stringify({ data: { cancelRequested: true, status: "cancelled", activity: "Cancelled", finishedAt: new Date().toISOString() } }),
    }).catch(() => undefined);
    if (task.jobRunId) await cancelJobRun(task.jobRunId).catch(() => undefined);
  });
}

/** A connected account couldn't be disconnected, so deleting the headquarters stopped before removing any data. */
export class AccountDisconnectError extends Error {
  constructor(cause: unknown) {
    super(`Couldn't disconnect a connected account: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** Removes the media-library files behind the headquarters' media assets (best effort; another record may hold one). */
async function deleteAssetFiles(rows: Record<string, unknown>[]) {
  const ids = rows.map((r) => (r.file as { id?: number } | null)?.id).filter((id): id is number => typeof id === "number");
  await inBatches(ids, (id) => strapi(`/upload/files/${id}`, { method: "DELETE" }).catch(() => undefined));
}

/**
 * Deletes the headquarters and everything in it: work is cancelled, connected accounts are disconnected (their
 * tokens revoked in Composio), the cloud computer is stopped, and every record that belongs to it is removed. Accounts
 * are disconnected first and a failure stops the deletion, so the user can retry without leaving live tokens behind.
 * The user's own profile and sign-in are kept; they land on onboarding to raise a new headquarters.
 */
export async function deleteHeadquartersAndData(hq: HeadquartersRecord): Promise<void> {
  const hqId = hq.documentId;
  await stopAllWork(hqId);

  if (composioConfigured()) {
    try {
      for (const connection of await listConnections(hqId)) await removeConnection(hqId, connection);
    } catch (error) {
      throw new AccountDisconnectError(error);
    }
  }

  if (computersEnabled()) {
    try {
      const computer = await findCloudComputer(hqId);
      if (computer && (computer.state === "running" || computer.state === "creating")) await stopCloudComputer(computer.id);
    } catch (error) {
      console.warn("[settings] couldn't stop the cloud computer; CloudHike stops idle computers:", error instanceof Error ? error.message : error);
    }
  }

  // Children before the records they point to.
  for (const collection of ["task-events", "chat-messages", "agent-requests", "external-waits", "social-posts", "artifacts", "memories"]) {
    await deleteAll(collection, hqId);
  }
  await deleteAll("media-assets", hqId, { "populate[file][fields][0]": "id" }, deleteAssetFiles);
  for (const collection of ["conversations", "agent-tasks", "computer-sessions", "connected-accounts", "agents"]) {
    await deleteAll(collection, hqId);
  }
  await strapi(`/headquarters/${encodeURIComponent(hqId)}`, { method: "DELETE" });
}
