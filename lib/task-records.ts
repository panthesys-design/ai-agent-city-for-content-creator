import { artifactsFromMetadata, type ArtifactSummary } from "./artifact-records";

// Client-safe shapes for agent work persisted in Strapi: tasks (`agent-tasks`), their execution history
// (`task-events`), and chat threads (`conversations` + `chat-messages`). Server CRUD is in lib/runtime-store.ts.

export const taskStatuses = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const isTaskFinished = (status: TaskStatus) => status === "completed" || status === "failed" || status === "cancelled";

/**
 * A headquarters request that still holds the queue: dispatched but not started yet, or running without having handed
 * any step to an agent (still planning or answering). The next request starts once no request is planning.
 */
export const isPlanningRequest = (task: Pick<TaskRecord, "status" | "jobRunId" | "plan">) =>
  task.status === "queued" ? Boolean(task.jobRunId) : task.status === "running" && !task.plan?.some((s) => s.status !== "pending");

export type PlanStepStatus = "pending" | "active" | "done" | "failed";

/** One step of a headquarters plan: which agent does what, after which other steps. */
export type PlanStep = {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  dependsOn: string[];
  status: PlanStepStatus;
  /** The child task that ran this step. */
  taskId?: string;
  /** Short result summary, shown in progress views. */
  summary?: string;
  /** Set while the step's agent waits for a website (wait_for_external); the step stays "active". */
  waitingFor?: string;
};

export type TaskRecord = {
  documentId: string;
  title: string;
  input: string;
  status: TaskStatus;
  progress: number;
  activity: string | null;
  output: string | null;
  error: string | null;
  plan: PlanStep[] | null;
  stepId: string | null;
  jobRunId: string | null;
  cancelRequested: boolean;
  /** A headquarters request with no run right now: its steps wait (for a website or a busy agent); it is queued again once they finish. */
  paused: boolean;
  /** Set when the user cleared this finished task from the work progress card. */
  progressCleared: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  /** Agent that ran the task; null for a headquarters (orchestrator) task. */
  agentId: string | null;
  agentName: string | null;
  parentId: string | null;
  conversationId: string | null;
};

export const taskEventTypes = ["started", "tool_call", "tool_output", "delegated", "message", "progress", "completed", "failed", "cancelled"] as const;
export type TaskEventType = (typeof taskEventTypes)[number];

export type TaskEvent = {
  documentId: string;
  type: TaskEventType;
  summary: string;
  agentName: string | null;
  createdAt: string | null;
};

export type ChatRole = "user" | "assistant" | "system";
export type StoredMessage = {
  documentId: string;
  role: ChatRole;
  content: string;
  createdAt: string | null;
  taskId: string | null;
  /** Deliverables this reply produced (snapshots saved in the message metadata), shown as preview cards. */
  artifacts: ArtifactSummary[];
  /** Files the user attached to this message (uploads or earlier artifacts), saved in the message metadata. */
  attachments: ArtifactSummary[];
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const rel = (v: unknown) => (v && typeof v === "object" && "documentId" in v ? String((v as { documentId: unknown }).documentId) : null);

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parsePlan(value: unknown): PlanStep[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((s): s is PlanStep => Boolean(s) && typeof s === "object" && typeof (s as PlanStep).id === "string").map((s) => ({
    id: s.id,
    agentId: String(s.agentId ?? ""),
    agentName: String(s.agentName ?? ""),
    title: String(s.title ?? ""),
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [],
    status: oneOf(["pending", "active", "done", "failed"] as const, s.status, "pending"),
    ...(typeof s.taskId === "string" ? { taskId: s.taskId } : {}),
    ...(typeof s.summary === "string" ? { summary: s.summary } : {}),
    ...(typeof s.waitingFor === "string" && s.waitingFor ? { waitingFor: s.waitingFor } : {}),
  }));
}

export function taskFromStrapi(row: Record<string, unknown>): TaskRecord {
  const agent = row.agent as { name?: unknown } | null | undefined;
  return {
    documentId: String(row.documentId),
    title: String(row.title ?? "Task"),
    input: String(row.input ?? ""),
    status: oneOf(taskStatuses, row.status, "queued"),
    progress: typeof row.progress === "number" ? Math.max(0, Math.min(100, row.progress)) : 0,
    activity: str(row.activity),
    output: str(row.output),
    error: str(row.error),
    plan: parsePlan(row.plan),
    stepId: str(row.stepId),
    jobRunId: str(row.jobRunId),
    cancelRequested: row.cancelRequested === true,
    paused: row.paused === true,
    progressCleared: row.progressCleared === true,
    startedAt: str(row.startedAt),
    finishedAt: str(row.finishedAt),
    createdAt: str(row.createdAt),
    agentId: rel(row.agent),
    agentName: agent && typeof agent.name === "string" ? agent.name : null,
    parentId: rel(row.parent),
    conversationId: rel(row.conversation),
  };
}

export function eventFromStrapi(row: Record<string, unknown>): TaskEvent {
  const agent = row.agent as { name?: unknown } | null | undefined;
  return {
    documentId: String(row.documentId),
    type: oneOf(taskEventTypes, row.type, "message"),
    summary: String(row.summary ?? ""),
    agentName: agent && typeof agent.name === "string" ? agent.name : null,
    createdAt: str(row.createdAt),
  };
}

export function messageFromStrapi(row: Record<string, unknown>): StoredMessage {
  return {
    documentId: String(row.documentId),
    role: oneOf(["user", "assistant", "system"] as const, row.role, "assistant"),
    content: String(row.content ?? ""),
    createdAt: str(row.createdAt),
    taskId: rel(row.task),
    artifacts: artifactsFromMetadata(row.metadata),
    attachments: artifactsFromMetadata(row.metadata, "attachments"),
  };
}
