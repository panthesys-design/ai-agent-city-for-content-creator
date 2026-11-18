import type { HeadquartersRecord } from "./headquarters";
import { strapi } from "./strapi";
import {
  eventFromStrapi, messageFromStrapi, taskFromStrapi,
  type ChatRole, type PlanStep, type StoredMessage, type TaskEvent, type TaskEventType, type TaskRecord, type TaskStatus,
} from "./task-records";

// Server-only persistence for agent work in Strapi: tasks, execution events, conversations, and messages.
// Every read filters by headquarters, so one city never sees another city's work.

type Row = Record<string, unknown>;
type One = { data: Row };
type Many = { data: Row[] };

const connect = (documentId: string) => ({ connect: [documentId] });
const TASK_POPULATE = {
  "populate[agent][fields][0]": "name",
  "populate[parent][fields][0]": "documentId",
  "populate[conversation][fields][0]": "documentId",
};

// ---------- Tasks ----------

export type NewTask = {
  title: string;
  input: string;
  agentId?: string | null;
  parentId?: string | null;
  conversationId?: string | null;
  stepId?: string | null;
};

export async function createTask(hq: HeadquartersRecord, task: NewTask): Promise<TaskRecord> {
  const { data } = await strapi<One>(`/agent-tasks?${new URLSearchParams(TASK_POPULATE)}`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        title: task.title.slice(0, 160),
        input: task.input,
        status: "queued",
        progress: 0,
        stepId: task.stepId ?? null,
        headquarter: connect(hq.documentId),
        ...(task.agentId ? { agent: connect(task.agentId) } : {}),
        ...(task.parentId ? { parent: connect(task.parentId) } : {}),
        ...(task.conversationId ? { conversation: connect(task.conversationId) } : {}),
      },
    }),
  });
  return taskFromStrapi(data);
}

/** A task with its headquarters' documentId, for the background runner (which has no session). */
export async function getTaskWithHeadquarters(documentId: string): Promise<{ task: TaskRecord; headquartersId: string } | null> {
  const query = new URLSearchParams({ ...TASK_POPULATE, "populate[headquarter][fields][0]": "documentId" });
  try {
    const { data } = await strapi<One>(`/agent-tasks/${documentId}?${query}`);
    const hq = data.headquarter as { documentId?: string } | null;
    return hq?.documentId ? { task: taskFromStrapi(data), headquartersId: hq.documentId } : null;
  } catch {
    return null;
  }
}

export async function getTask(documentId: string): Promise<TaskRecord | null> {
  return (await getTaskWithHeadquarters(documentId))?.task ?? null;
}

export async function findOwnedTask(hq: HeadquartersRecord, documentId: string): Promise<TaskRecord | null> {
  const query = new URLSearchParams({
    ...TASK_POPULATE,
    "filters[documentId][$eq]": documentId,
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "pagination[pageSize]": "1",
  });
  const { data } = await strapi<Many>(`/agent-tasks?${query}`);
  return data[0] ? taskFromStrapi(data[0]) : null;
}

export type TaskPatch = Partial<{
  status: TaskStatus; progress: number; activity: string | null; output: string | null; error: string | null;
  plan: PlanStep[]; jobRunId: string | null; cancelRequested: boolean; paused: boolean; progressCleared: boolean; startedAt: string; finishedAt: string; usage: unknown;
}>;

export async function updateTask(documentId: string, patch: TaskPatch): Promise<void> {
  const data: Row = { ...patch };
  if (typeof patch.activity === "string") data.activity = patch.activity.slice(0, 160);
  if (typeof patch.progress === "number") data.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
  await strapi(`/agent-tasks/${documentId}`, { method: "PUT", body: JSON.stringify({ data }) });
}

/**
 * Moves a queued task to running, once. Returns false when it already started or finished, so a job that is
 * delivered twice (CloudHike delivers at least once) never runs the same task twice.
 */
export async function claimTask(task: TaskRecord): Promise<boolean> {
  if (task.status !== "queued") return false;
  const fresh = await getTask(task.documentId);
  if (!fresh || fresh.status !== "queued") return false;
  await updateTask(task.documentId, { status: "running", paused: false, startedAt: new Date().toISOString(), activity: "Starting…", progress: 2 });
  return true;
}

/** Most recent root tasks (headquarters orchestrations and direct agent tasks), newest first. */
export async function listRecentTasks(hq: HeadquartersRecord, { limit = 20, rootOnly = true } = {}): Promise<TaskRecord[]> {
  const query = new URLSearchParams({
    ...TASK_POPULATE,
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "sort[0]": "createdAt:desc",
    "pagination[pageSize]": String(limit),
  });
  if (rootOnly) query.set("filters[parent][id][$null]", "true");
  const { data } = await strapi<Many>(`/agent-tasks?${query}`);
  return data.map(taskFromStrapi);
}

/** Headquarters requests (root orchestration tasks) that are queued or running, oldest first: the queue. */
export async function activeHeadquartersTasks(hq: HeadquartersRecord): Promise<TaskRecord[]> {
  const query = new URLSearchParams({
    ...TASK_POPULATE,
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "filters[agent][id][$null]": "true",
    "filters[parent][id][$null]": "true",
    "filters[status][$in][0]": "queued",
    "filters[status][$in][1]": "running",
    "sort[0]": "createdAt:asc",
    "sort[1]": "id:asc",
    "pagination[pageSize]": "50",
  });
  const { data } = await strapi<Many>(`/agent-tasks?${query}`);
  return data.map(taskFromStrapi);
}

/**
 * The headquarters task to show as "current" and the requests waiting behind it. The current task is the running
 * one, else the next queued one, else the latest finished one (unless the user cleared it from the progress card).
 */
export async function headquartersQueue(hq: HeadquartersRecord): Promise<{ current: TaskRecord | null; others: TaskRecord[]; waiting: TaskRecord[] }> {
  const active = await activeHeadquartersTasks(hq);
  const latest = active.length ? null : await latestHeadquartersTask(hq);
  const current = active.find((t) => t.status === "running") ?? active[0] ?? (latest?.progressCleared ? null : latest);
  const rest = active.filter((t) => t.documentId !== current?.documentId);
  // Requests run side by side once each has handed work to its agents: the other running ones, then the queue.
  return { current, others: rest.filter((t) => t.status === "running"), waiting: rest.filter((t) => t.status === "queued") };
}

/** The latest headquarters orchestration task, running or not. */
export async function latestHeadquartersTask(hq: HeadquartersRecord): Promise<TaskRecord | null> {
  const query = new URLSearchParams({
    ...TASK_POPULATE,
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "filters[agent][id][$null]": "true",
    "filters[parent][id][$null]": "true",
    "sort[0]": "createdAt:desc",
    "pagination[pageSize]": "1",
  });
  const { data } = await strapi<Many>(`/agent-tasks?${query}`);
  return data[0] ? taskFromStrapi(data[0]) : null;
}

/** An agent's tasks that are queued or running (steps, standalone tasks, chats), oldest first. */
export async function listOpenAgentTasks(hq: HeadquartersRecord | string, agentId: string): Promise<TaskRecord[]> {
  const query = new URLSearchParams({
    ...TASK_POPULATE,
    "filters[headquarter][documentId][$eq]": typeof hq === "string" ? hq : hq.documentId,
    "filters[agent][documentId][$eq]": agentId,
    "filters[status][$in][0]": "queued",
    "filters[status][$in][1]": "running",
    "sort[0]": "createdAt:asc",
    "sort[1]": "id:asc",
    "pagination[pageSize]": "50",
  });
  const { data } = await strapi<Many>(`/agent-tasks?${query}`);
  return data.map(taskFromStrapi);
}

/** Agent tasks (mostly plan steps) waiting for their agent to be free: queued and not dispatched, oldest first. */
export async function listQueuedAgentTasks(hq: HeadquartersRecord): Promise<TaskRecord[]> {
  const query = new URLSearchParams({
    ...TASK_POPULATE,
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "filters[agent][id][$notNull]": "true",
    "filters[status][$eq]": "queued",
    "sort[0]": "createdAt:asc",
    "pagination[pageSize]": "50",
  });
  const { data } = await strapi<Many>(`/agent-tasks?${query}`);
  return data.map(taskFromStrapi).filter((t) => !t.jobRunId);
}

export async function listChildTasks(parentId: string): Promise<TaskRecord[]> {
  const query = new URLSearchParams({ ...TASK_POPULATE, "filters[parent][documentId][$eq]": parentId, "sort[0]": "createdAt:asc", "pagination[pageSize]": "100" });
  const { data } = await strapi<Many>(`/agent-tasks?${query}`);
  return data.map(taskFromStrapi);
}

/**
 * Tasks still marked running long after their time limit, e.g. after a server restart. Headquarters requests
 * waiting in the queue are not stale (they are queued without a job run until their turn comes).
 */
export async function listStaleTasks(hq: HeadquartersRecord, olderThanSeconds: number): Promise<TaskRecord[]> {
  const query = new URLSearchParams({
    ...TASK_POPULATE,
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "filters[status][$in][0]": "running",
    "filters[status][$in][1]": "queued",
    "filters[updatedAt][$lt]": new Date(Date.now() - olderThanSeconds * 1000).toISOString(),
    "pagination[pageSize]": "50",
  });
  const { data } = await strapi<Many>(`/agent-tasks?${query}`);
  return data.map(taskFromStrapi).filter((t) => !(t.status === "queued" && !t.jobRunId && !t.agentId && !t.parentId));
}

// ---------- Execution history ----------

export async function addEvent(hqId: string, taskId: string, agentId: string | null, type: TaskEventType, summary: string, data?: unknown): Promise<void> {
  await strapi("/task-events", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type, summary: summary.slice(0, 255), data: data ?? null,
        task: connect(taskId), headquarter: connect(hqId), ...(agentId ? { agent: connect(agentId) } : {}),
      },
    }),
  });
}

/** Events of a task and its delegated child tasks, oldest first. */
export async function listTaskEvents(hq: HeadquartersRecord, taskId: string): Promise<TaskEvent[]> {
  const query = new URLSearchParams({
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "filters[$or][0][task][documentId][$eq]": taskId,
    "filters[$or][1][task][parent][documentId][$eq]": taskId,
    "populate[agent][fields][0]": "name",
    "sort[0]": "createdAt:asc",
    "pagination[pageSize]": "200",
  });
  const { data } = await strapi<Many>(`/task-events?${query}`);
  return data.map(eventFromStrapi);
}

// ---------- Conversations ----------

// An agent (or headquarters) can have several conversations over time: the newest one is the chat the user sees.
// "Clear chat" and a new headquarters task start a new one; older conversations stay in Strapi as task history.

async function newestConversation(hq: HeadquartersRecord, agentId: string | null): Promise<string | null> {
  const query = new URLSearchParams({
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "sort[0]": "createdAt:desc",
    "sort[1]": "id:desc",
    "pagination[pageSize]": "1",
  });
  if (agentId) query.set("filters[agent][documentId][$eq]", agentId);
  else query.set("filters[agent][id][$null]", "true");
  const { data } = await strapi<Many>(`/conversations?${query}`);
  return data[0] ? String(data[0].documentId) : null;
}

async function createConversation(hq: HeadquartersRecord, agentId: string | null, title: string): Promise<string> {
  const created = await strapi<One>("/conversations", {
    method: "POST",
    body: JSON.stringify({ data: { title: title.slice(0, 160), headquarter: connect(hq.documentId), ...(agentId ? { agent: connect(agentId) } : {}) } }),
  });
  return String(created.data.documentId);
}

/** The current chat thread between the city and one agent (or headquarters when agentId is null), created on first use. */
export async function getOrCreateConversation(hq: HeadquartersRecord, agentId: string | null, title: string): Promise<string> {
  return (await newestConversation(hq, agentId)) ?? createConversation(hq, agentId, title);
}

/**
 * Starts a fresh chat thread for an agent (or headquarters), so earlier messages no longer show or reach the model.
 * The current thread is reused when it has no messages yet. Earlier threads, artifacts, and tasks are kept.
 */
export async function startFreshConversation(hq: HeadquartersRecord, agentId: string | null, title: string): Promise<string> {
  const current = await newestConversation(hq, agentId);
  if (current && !(await listMessagePage(hq, current, { limit: 1 })).messages.length) return current;
  return createConversation(hq, agentId, title);
}

/**
 * Signature of every current chat thread: `<conversationId>:<latest message id>` keyed by agent documentId, or
 * `headquartersKey` for headquarters. Chat panels reload when theirs changes.
 */
export async function threadSignatures(hq: HeadquartersRecord, headquartersKey: string): Promise<Record<string, string>> {
  const conversations = await strapi<Many>(`/conversations?${new URLSearchParams({
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "populate[agent][fields][0]": "documentId",
    "sort[0]": "createdAt:desc",
    "sort[1]": "id:desc",
    "pagination[pageSize]": "100",
  })}`);
  const current = new Map<string, string>(); // conversationId → thread key
  for (const row of conversations.data) {
    const agent = row.agent as { documentId?: string } | null | undefined;
    const key = agent?.documentId ?? headquartersKey;
    if (![...current.values()].includes(key)) current.set(String(row.documentId), key);
  }
  if (!current.size) return {};
  const query = new URLSearchParams({
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "populate[conversation][fields][0]": "documentId",
    "fields[0]": "createdAt",
    "sort[0]": "createdAt:desc",
    "sort[1]": "id:desc",
    "pagination[pageSize]": "60",
  });
  [...current.keys()].forEach((id, i) => query.set(`filters[conversation][documentId][$in][${i}]`, id));
  const messages = await strapi<Many>(`/chat-messages?${query}`);
  const latest = new Map<string, string>();
  for (const row of messages.data) {
    const conversation = (row.conversation as { documentId?: string } | null)?.documentId;
    if (conversation && !latest.has(conversation)) latest.set(conversation, String(row.documentId));
  }
  return Object.fromEntries([...current].map(([id, key]) => [key, `${id}:${latest.get(id) ?? ""}`]));
}

/** The latest messages of a conversation, oldest first. */
export async function listMessages(hq: HeadquartersRecord, conversationId: string, limit = 50): Promise<StoredMessage[]> {
  return (await listMessagePage(hq, conversationId, { limit })).messages;
}

/**
 * One page of a conversation, oldest first: the `limit` messages created before `before` (an ISO timestamp, the
 * oldest message the caller already has), or the latest ones without it. `hasMore` says whether older ones exist.
 */
export async function listMessagePage(hq: HeadquartersRecord, conversationId: string, { limit, before }: { limit: number; before?: string | null }): Promise<{ messages: StoredMessage[]; hasMore: boolean }> {
  const query = new URLSearchParams({
    "filters[conversation][documentId][$eq]": conversationId,
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "populate[task][fields][0]": "documentId",
    "sort[0]": "createdAt:desc",
    "sort[1]": "id:desc",
    "pagination[pageSize]": String(limit + 1),
  });
  if (before) query.set("filters[createdAt][$lt]", before);
  const { data } = await strapi<Many>(`/chat-messages?${query}`);
  return { messages: data.slice(0, limit).map(messageFromStrapi).reverse(), hasMore: data.length > limit };
}

export async function addMessage(hqId: string, conversationId: string, role: ChatRole, content: string, extra: { taskId?: string; metadata?: unknown } = {}): Promise<StoredMessage> {
  const { data } = await strapi<One>("/chat-messages", {
    method: "POST",
    body: JSON.stringify({
      data: {
        role, content, metadata: extra.metadata ?? null,
        conversation: connect(conversationId), headquarter: connect(hqId),
        ...(extra.taskId ? { task: connect(extra.taskId) } : {}),
      },
    }),
  });
  return messageFromStrapi(data);
}

/** The task a CloudHike Jobs run was started for (lookup for the signed webhook, which has no session). */
export async function findTaskByJobRun(runId: string): Promise<{ task: TaskRecord; headquartersId: string } | null> {
  const query = new URLSearchParams({ ...TASK_POPULATE, "filters[jobRunId][$eq]": runId, "populate[headquarter][fields][0]": "documentId", "pagination[pageSize]": "1" });
  const { data } = await strapi<Many>(`/agent-tasks?${query}`);
  const hq = data[0]?.headquarter as { documentId?: string } | null | undefined;
  return data[0] && hq?.documentId ? { task: taskFromStrapi(data[0]), headquartersId: hq.documentId } : null;
}
