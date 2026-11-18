import { setAgentState } from "@/lib/agents";
import { STALE_MS, acquireComputer, browserCommand, checkPage, releaseComputer, touchComputer } from "@/lib/computer/computer";
import { findSession } from "@/lib/computer/store";
import { getHeadquartersById } from "@/lib/headquarters";
import { getTask, updateTask } from "@/lib/runtime-store";
import { isTaskFinished } from "@/lib/task-records";
import { jobsConfig } from "./env";
import { listActiveWaits, listDueWaits, updateWait, waitingActivity, type ExternalWait, type WaitOutcome } from "./external-waits";
import { pauseWaitSchedule } from "./jobs";
import { resumeWaitingTask, taskTimeLimitSeconds } from "./task-runner";

// Checks the pages agents are waiting on (see wait_for_external in computer-tools.ts). Called by the CloudHike Jobs
// schedule (/api/jobs/external-waits), or by the open city page when Jobs isn't configured. Each due wait gets one
// look without a model: start the computer, open the page, look for the ready text, turn the computer off again.
// A wait that is ready (or past its deadline, or asking to sign in) resumes its task in a new agent run.

/** Time one headquarters' checks need at least: starting the computer plus one page. */
const PER_HEADQUARTERS_MS = 100_000;
/** After a check, the next one is due a little before the interval, so the schedule's tick at that minute takes it. */
const EARLY_MS = 45_000;

export type CheckSummary = { checked: number; resumed: number; skipped: number; waiting: number };

let running = false;

/**
 * Checks every due wait (of one headquarters with `hqId`), within `budgetMs`. Overlapping calls in this process
 * return at once. When nothing waits any more, the CloudHike schedule is paused.
 */
export async function checkDueWaits({ hqId, budgetMs }: { hqId?: string; budgetMs: number }): Promise<CheckSummary> {
  const summary: CheckSummary = { checked: 0, resumed: 0, skipped: 0, waiting: 0 };
  if (running) return summary;
  running = true;
  const deadline = Date.now() + budgetMs;
  try {
    await settleStuckResumes(hqId);
    const byHeadquarters = new Map<string, ExternalWait[]>();
    for (const wait of await listDueWaits(hqId)) {
      if (!wait.headquartersId) continue;
      byHeadquarters.set(wait.headquartersId, [...(byHeadquarters.get(wait.headquartersId) ?? []), wait]);
    }
    for (const [hq, waits] of byHeadquarters) {
      // Waits that need no computer: their task ended, or they ran out of time.
      const open: ExternalWait[] = [];
      for (const wait of waits) {
        const task = wait.taskId ? await getTask(wait.taskId) : null;
        if (!task || isTaskFinished(task.status) || task.cancelRequested) {
          await updateWait(wait.documentId, { status: "cancelled" });
        } else if (wait.outcome) {
          // Already seen ready; its agent was busy. Try again (startWorkForAgent usually gets there first).
          if (await resume(wait, wait.outcome, wait.lastResult ?? "Ready")) summary.resumed++;
        } else if (Date.parse(wait.deadlineAt) <= Date.now()) {
          if (await resume(wait, "timeout", "Not ready before the time limit")) summary.resumed++;
        } else {
          open.push(wait);
        }
      }
      if (!open.length) continue;
      if (deadline - Date.now() < PER_HEADQUARTERS_MS) { summary.skipped += open.length; continue; }
      summary.checked += open.length;
      summary.resumed += await checkHeadquarters(hq, open, deadline);
    }
  } finally {
    running = false;
  }
  const waiting = (await listActiveWaits(hqId).catch(() => [])).filter((w) => w.status === "waiting");
  summary.waiting = waiting.length;
  if (!hqId && !waiting.length && jobsConfig()) await pauseWaitSchedule();
  return summary;
}

/** Checks one headquarters' due waits with one computer start. Returns how many were resumed. */
async function checkHeadquarters(hqId: string, waits: ExternalWait[], deadline: number): Promise<number> {
  // Activity lines show the next check in the headquarters' own time zone.
  const timeZone = (await getHeadquartersById(hqId))?.timeZone ?? null;
  // An agent is using the computer: don't take its tab; the next tick checks again.
  const session = await findSession(hqId).catch(() => null);
  if (session?.holderRun && session.heartbeatAt && Date.now() - Date.parse(session.heartbeatAt) < STALE_MS) {
    await Promise.all(waits.map((w) => updateWait(w.documentId, { lastResult: "The computer was busy; checking again soon." }).catch(() => undefined)));
    return 0;
  }
  const signal = AbortSignal.timeout(Math.max(10_000, deadline - Date.now()));
  const first = waits[0];
  const ready: { wait: ExternalWait; outcome: WaitOutcome; result: string }[] = [];
  let lease;
  try {
    lease = await acquireComputer(
      { hqId, agentId: first.agentId, agentName: `${first.agentName ?? "Agent"} (checking)`, taskId: first.taskId },
      { signal },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The computer could not start.";
    console.warn(`[waits] couldn't start the computer for ${hqId}:`, message);
    await Promise.all(waits.map((w) => notReady(w, `Couldn't check: ${message}`, timeZone)));
    return 0;
  }
  try {
    for (const wait of waits) {
      if (signal.aborted) break;
      try {
        await touchComputer(lease, { activity: `Checking ${wait.title}` });
        await browserCommand(lease, "open", { url: wait.url, maxChars: 100 }, signal);
        const seen = await checkPage(lease, wait, signal, { settleSeconds: 10 });
        await touchComputer(lease, { url: seen.url, pageTitle: seen.title });
        if (seen.ready) ready.push({ wait, outcome: "ready", result: "Ready" });
        else if (seen.signin) ready.push({ wait, outcome: "signin", result: "The page asks to sign in" });
        else await notReady(wait, `Not ready yet${seen.excerpt ? `: ${seen.excerpt.slice(0, 200)}` : ""}`, timeZone);
      } catch (error) {
        await notReady(wait, `Check failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`, timeZone);
      }
    }
  } finally {
    // Leave it on when a resumed task is about to use it; otherwise turn it off until the next check.
    await releaseComputer(lease, { keepRunning: ready.length > 0 });
  }
  let resumed = 0;
  for (const { wait, outcome, result } of ready) if (await resume(wait, outcome, result)) resumed++;
  return resumed;
}

async function notReady(wait: ExternalWait, result: string, timeZone: string | null) {
  const now = Date.now();
  const nextCheckAt = new Date(now + wait.intervalSeconds * 1000 - EARLY_MS).toISOString();
  const checks = wait.checks + 1;
  await updateWait(wait.documentId, { checks, lastCheckAt: new Date(now).toISOString(), nextCheckAt, lastResult: result }).catch(() => undefined);
  const activity = waitingActivity({ title: wait.title, nextCheckAt }, timeZone);
  if (wait.taskId) await updateTask(wait.taskId, { activity }).catch(() => undefined);
  if (wait.agentId) await setAgentState(wait.agentId, { status: "working", activity }).catch(() => undefined);
}

/** Resumes the wait's task. Returns true when a run was started; a busy agent leaves it for later. */
async function resume(wait: ExternalWait, outcome: WaitOutcome, result: string): Promise<boolean> {
  const now = Date.now();
  const checked = { outcome, checks: wait.outcome ? wait.checks : wait.checks + 1, lastCheckAt: new Date(now).toISOString(), lastResult: result };
  await updateWait(wait.documentId, checked);
  try {
    const started = await resumeWaitingTask({ ...wait, ...checked });
    // The agent is busy: it picks this up when it is free; the schedule only retries now and then as a safety net.
    if (started === "busy") await updateWait(wait.documentId, { nextCheckAt: new Date(now + wait.intervalSeconds * 1000 - EARLY_MS).toISOString() });
    return started === "started";
  } catch (error) {
    console.error(`[waits] couldn't resume ${wait.taskId}`, error);
    // Back to waiting, so the next tick tries again.
    await updateWait(wait.documentId, { status: "waiting", lastResult: "Resuming failed; trying again." }).catch(() => undefined);
    return false;
  }
}

/** A resumed run that never reported back (lost job, crashed server) would hold its request forever. */
async function settleStuckResumes(hqId?: string) {
  const limitMs = (taskTimeLimitSeconds(true) + 15 * 60) * 1000;
  const stuck = (await listActiveWaits(hqId).catch(() => [])).filter((w) => w.status === "resuming" && w.updatedAt && Date.now() - Date.parse(w.updatedAt) > limitMs);
  await Promise.all(stuck.map((w) => updateWait(w.documentId, { status: "done", lastResult: "The resumed run didn't report back." }).catch(() => undefined)));
}
