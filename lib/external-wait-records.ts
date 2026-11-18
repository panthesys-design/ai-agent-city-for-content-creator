// Client-safe shapes and helpers for external waits: an agent run paused while a website works for a long time
// (wait_for_external). Strapi CRUD is in lib/ai/external-waits.ts; checks run in lib/ai/wait-checker.ts.
// Strapi collection: `external-waits`, see docs/cloud-computer.md.

export type WaitStatus = "waiting" | "resuming" | "done" | "cancelled";
/** Why a waiting task was resumed: the page showed it was ready, the deadline passed, or the site asked to sign in. */
export type WaitOutcome = "ready" | "timeout" | "signin";

export type ExternalWait = {
  documentId: string;
  status: WaitStatus;
  title: string;
  url: string;
  readyText: string | null;
  busyText: string | null;
  /** What the agent does once it is ready; the resumed run gets this as its instructions. */
  next: string;
  outcome: WaitOutcome | null;
  intervalSeconds: number;
  nextCheckAt: string;
  deadlineAt: string;
  lastCheckAt: string | null;
  checks: number;
  lastResult: string | null;
  headquartersId: string | null;
  agentId: string | null;
  agentName: string | null;
  taskId: string | null;
  rootTaskId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/** Thrown by `wait_for_external` to end the agent run; the runners catch it and leave the task waiting. */
export class RunParkedError extends Error {
  constructor(readonly wait: ExternalWait) {
    super(`Paused while waiting for ${wait.title}.`);
    this.name = "RunParkedError";
  }
}

/** The RunParkedError behind an error, if any (the Agents SDK wraps tool errors in ToolCallError). */
export function parkedFrom(error: unknown): RunParkedError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof RunParkedError) return current;
    const next = current as { error?: unknown; cause?: unknown };
    current = next.error ?? next.cause;
  }
  return null;
}

/** "14:35" in the headquarters' time zone (its saved `timeZone`; the server's own when null or invalid), for activity lines. */
export function clockTime(iso: string, timeZone?: string | null): string {
  const format = (zone?: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone });
  try {
    return format(timeZone || undefined);
  } catch {
    return format();
  }
}

/** The activity line a waiting task and its agent show in the city. */
export const waitingActivity = (wait: Pick<ExternalWait, "title" | "nextCheckAt">, timeZone?: string | null) =>
  `Waiting for ${wait.title} · next check ${clockTime(wait.nextCheckAt, timeZone)}`;

/** Minutes between runs of an "every N minutes" cron (minute field in step syntax, other fields "*"), else null. */
export function cronStepMinutes(cron: string): number | null {
  const step = /^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(cron.trim())?.[1];
  return step && Number(step) > 0 ? Number(step) : null;
}
