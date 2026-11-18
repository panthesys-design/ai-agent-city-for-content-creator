import { createHmac, timingSafeEqual } from "node:crypto";
import { cronStepMinutes } from "@/lib/external-wait-records";
import { jobsConfig } from "./env";

// CloudHike.dev background jobs (https://cloudhike.dev/docs/md/jobs). Long agent runs are started as a job
// that calls back into this app; the worker waits up to 5 minutes (Free) or 60 (Pro) for the answer.

export type JobRun = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error?: string | null;
  response?: { status: number; body: unknown; truncated: boolean } | null;
};

export async function startJobRun(path: string, body: unknown): Promise<JobRun> {
  const config = jobsConfig();
  if (!config) throw new Error("CloudHike Jobs is not configured.");
  const res = await fetch(`${config.apiUrl}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.apiKey },
    body: JSON.stringify({
      url: `${config.appUrl}${path}`,
      method: "POST",
      body,
      timeoutSeconds: config.timeoutSeconds,
      // An agent run is not safe to repeat (it spends tokens and writes memory), so never retry automatically.
      retries: 0,
      callbackUrl: `${config.appUrl}/api/jobs/webhook`,
    }),
  });
  if (!res.ok) throw new Error(`CloudHike Jobs refused the run (${res.status}): ${await res.text().catch(() => "")}`.slice(0, 300));
  return (await res.json()) as JobRun;
}

export async function cancelJobRun(id: string): Promise<void> {
  const config = jobsConfig();
  if (!config) return;
  await fetch(`${config.apiUrl}/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "x-api-key": config.apiKey } }).catch(() => undefined);
}

// ---------- Recurring schedule for external waits ----------
//
// One CloudHike Jobs schedule calls /api/jobs/external-waits every few minutes (WAIT_CHECK_CRON, default every
// 5 minutes; CloudHike Free allows every 15 at most). It is created or resumed when an agent starts waiting and
// paused once nothing waits, so it costs no runs while idle.

const WAIT_SCHEDULE_NAME = "Creator City: check external waits";
const WAIT_CHECK_PATH = "/api/jobs/external-waits";
/** The checker's own budget is a bit lower (see wait-checker.ts), so it answers before CloudHike gives up. */
export const WAIT_CHECK_TIMEOUT_SECONDS = 290;

export const waitCheckCron = () => process.env.WAIT_CHECK_CRON?.trim() || "*/5 * * * *";

/** Seconds between checks of one wait: N minutes for an "every N minutes" cron (step syntax), else 5 minutes. */
export const waitCheckIntervalSeconds = () => (cronStepMinutes(waitCheckCron()) ?? 5) * 60;

type Schedule = { id: string; name: string; cron: string; url: string; enabled: boolean; nextRunAt?: string | null; lastError?: string | null };

const scheduleIds = new Map<string, string>();

async function jobsApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const config = jobsConfig();
  if (!config) throw new Error("CloudHike Jobs is not configured.");
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", "x-api-key": config.apiKey },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CloudHike Jobs ${init.method ?? "GET"} ${path} failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return (await res.json().catch(() => null)) as T;
}

async function findSchedule(name: string): Promise<Schedule | null> {
  const id = scheduleIds.get(name);
  if (id) {
    const known = await jobsApi<Schedule>(`/schedules/${encodeURIComponent(id)}`).catch(() => null);
    if (known) return known;
    scheduleIds.delete(name);
  }
  const list = await jobsApi<Schedule[] | { schedules?: Schedule[]; data?: Schedule[] }>("/schedules");
  const schedules = Array.isArray(list) ? list : list?.schedules ?? list?.data ?? [];
  const found = schedules.find((s) => s.name === name) ?? null;
  if (found) scheduleIds.set(name, found.id);
  return found;
}

/**
 * Makes sure a named schedule exists and is on, with the current URL and cron. Throws when CloudHike refuses it (for
 * example a cron more frequent than the plan allows), so callers don't rely on checks that never run.
 */
async function ensureSchedule(spec: { name: string; path: string; cron: string; timeoutSeconds: number }): Promise<Schedule> {
  const config = jobsConfig();
  if (!config) throw new Error("CloudHike Jobs is not configured.");
  const want = {
    name: spec.name, cron: spec.cron, timezone: "UTC", url: `${config.appUrl}${spec.path}`, method: "POST",
    timeoutSeconds: spec.timeoutSeconds,
    // A check is cheap to skip (the next one comes in a few minutes) and not worth running twice.
    retries: 0, callbackUrl: null,
  };
  const existing = await findSchedule(spec.name);
  if (!existing) {
    const created = await jobsApi<Schedule>("/schedules", { body: want });
    scheduleIds.set(spec.name, created.id);
    return created;
  }
  if (existing.enabled && existing.cron === want.cron && existing.url === want.url) return existing;
  return jobsApi<Schedule>(`/schedules/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: { ...want, enabled: true } });
}

/** Pauses a named schedule (nothing left for it to do). Never throws. */
async function pauseSchedule(name: string): Promise<void> {
  try {
    const existing = await findSchedule(name);
    if (existing?.enabled) await jobsApi(`/schedules/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: { enabled: false } });
  } catch (error) {
    console.warn(`[jobs] couldn't pause "${name}":`, error instanceof Error ? error.message : error);
  }
}

/** Makes sure the wait-check schedule exists and is on. Throws when CloudHike refuses it. */
export const ensureWaitSchedule = () =>
  ensureSchedule({ name: WAIT_SCHEDULE_NAME, path: WAIT_CHECK_PATH, cron: waitCheckCron(), timeoutSeconds: WAIT_CHECK_TIMEOUT_SECONDS });

/** Pauses the wait-check schedule (nothing is waiting). Never throws. */
export const pauseWaitSchedule = () => pauseSchedule(WAIT_SCHEDULE_NAME);

// ---------- Recurring schedule for scheduled posts ----------
//
// A second schedule calls /api/jobs/scheduled-posts (POST_PUBLISH_CRON, default every 5 minutes) while any post an
// agent scheduled on a connected account is waiting for its time, and is paused once none is.

const POST_SCHEDULE_NAME = "Creator City: publish scheduled posts";
export const POST_PUBLISH_TIMEOUT_SECONDS = 290;
export const postPublishCron = () => process.env.POST_PUBLISH_CRON?.trim() || "*/5 * * * *";

export const ensurePostSchedule = () =>
  ensureSchedule({ name: POST_SCHEDULE_NAME, path: "/api/jobs/scheduled-posts", cron: postPublishCron(), timeoutSeconds: POST_PUBLISH_TIMEOUT_SECONDS });
export const pausePostSchedule = () => pauseSchedule(POST_SCHEDULE_NAME);

/** Verifies `x-cloudhike-signature` (`t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`) and rejects stale timestamps. */
export function verifyJobSignature(rawBody: string, header: string | null): boolean {
  const key = process.env.JOBS_API_KEY;
  if (!key || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !parts.v1) return false;
  const expected = createHmac("sha256", key).update(`${t}.${rawBody}`).digest("hex");
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}
