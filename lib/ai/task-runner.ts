import { after } from "next/server";
import { clearIdleAgentStates, findOwnedAgent, listAgents, setAgentState } from "@/lib/agents";
import { listTaskArtifacts } from "@/lib/artifacts";
import { getHeadquartersById, type HeadquartersRecord } from "@/lib/headquarters";
import {
  activeHeadquartersTasks, addEvent, addMessage, claimTask, getOrCreateConversation, getTask, getTaskWithHeadquarters, listChildTasks,
  listOpenAgentTasks, listQueuedAgentTasks, listStaleTasks, startFreshConversation, updateTask,
} from "@/lib/runtime-store";
import { cancelOpenRequests } from "@/lib/computer/store";
import { isPlanningRequest, isTaskFinished, type PlanStep, type TaskRecord } from "@/lib/task-records";
import { agentBusyLabel, agentIsFree, holdsAgent } from "./agent-availability";
import { jobsConfig } from "./env";
import { cancelWaitsForTasks, clockTime, getWait, listActiveWaits, parkedFrom, updateWait, waitingActivity, type ExternalWait } from "./external-waits";
import { cancelJobRun, startJobRun } from "./jobs";
import { runHeadquarters } from "./orchestrator";
import { RunCancelledError, describeError, runCityAgent } from "./run-agent";
import { RunClock, withRunClock } from "./run-clock";

// Executes queued tasks, in the background. A task either belongs to headquarters (orchestrated across agents)
// or to one agent. Dispatch uses CloudHike Jobs when configured and the app has a public URL; otherwise the
// task runs in this server process after the response (local development).

const CANCEL_POLL_MS = 3000;

export function taskTimeLimitSeconds(viaJobs: boolean): number {
  const configured = Math.max(60, Number(process.env.TASK_TIMEOUT_SECONDS) || 900);
  const jobs = jobsConfig();
  // Leave the job a margin to record the outcome before the worker gives up on the request.
  return viaJobs && jobs ? Math.min(configured, jobs.timeoutSeconds - 15) : configured;
}

// ---------- Headquarters queue ----------
//
// Headquarters plans one request at a time, but requests can be in progress side by side. A request sent while
// another is still planning is saved as a queued task and waits; the next one (oldest first) starts as soon as no
// request is planning, that is, every running request has handed at least one step to an agent (isPlanningRequest).
// A step whose agent is busy with other work waits for the agent and starts by itself when it is free
// (agent-availability.ts, startWorkForAgent). In jobs mode a dispatched request has a jobRunId; inline, `starting`
// covers the moment between dispatch and claim.

const isHeadquartersRequest = (task: TaskRecord) => !task.agentId && !task.parentId;

const pumping = new Set<string>();
/** Requests this process started inline that haven't been claimed yet. */
const starting = new Set<string>();

/**
 * Starts the next waiting headquarters request when no request is planning. With CloudHike Jobs it only
 * dispatches; inline, it waits for the request it started (so `after()` keeps the work alive). Runs nudge the queue
 * again when they hand out their first step and when they end.
 */
export async function runHeadquartersQueue(hq: HeadquartersRecord): Promise<void> {
  const runs: Promise<unknown>[] = [];
  // One dispatcher per headquarters in this process, so two callers can't both start the same queued task.
  if (!pumping.has(hq.documentId)) {
    pumping.add(hq.documentId);
    try {
      await dispatchNextRequest(hq, runs);
    } finally {
      pumping.delete(hq.documentId);
    }
  }
  await Promise.all(runs);
}

async function dispatchNextRequest(hq: HeadquartersRecord, runs: Promise<unknown>[]): Promise<void> {
  const active = await activeHeadquartersTasks(hq);
  if (active.some((t) => isPlanningRequest(t) || starting.has(t.documentId))) return;
  const next = active.find((t) => t.status === "queued" && !t.jobRunId);
  if (!next) return;
  if (jobsConfig()) {
    try {
      const run = await startJobRun("/api/jobs/agent-task", { taskId: next.documentId });
      await updateTask(next.documentId, { jobRunId: run.id, activity: "Queued" });
      return;
    } catch (error) {
      console.error("[tasks] CloudHike Jobs dispatch failed; running inline instead.", error);
    }
  }
  starting.add(next.documentId);
  runs.push(executeTask(next.documentId, { timeLimitSeconds: taskTimeLimitSeconds(false) })
    .catch((error: unknown) => console.error("[tasks] queued request failed", error))
    .finally(() => { starting.delete(next.documentId); })
    // A request that never handed out a step held the queue until now.
    .then(() => runHeadquartersQueue(hq)));
}

/**
 * Makes sure the headquarters queue moves. Call it during a request (server action or route handler); the queue
 * runs after the response with `after()`, so an inline run (or a jobs dispatch that falls back to one) never holds it.
 */
export async function scheduleHeadquartersQueue(hq: HeadquartersRecord): Promise<void> {
  after(() => runHeadquartersQueue(hq).catch((e) => console.error("[tasks] queue run failed", e)));
}

/**
 * Keeps the queue moving from places outside a normal request lifecycle (a run handing out its first step, the live
 * city stream's periodic sweep, or after a job run ends): restarts a queue left waiting by a crash or a lost run.
 */
export function nudgeHeadquartersQueue(hq: HeadquartersRecord): Promise<void> {
  const run = runHeadquartersQueue(hq).catch((e) => console.error("[tasks] queue run failed", e));
  // Inline, the next task runs for minutes; don't hold the caller. With jobs this only dispatches.
  return jobsConfig() ? run : Promise.resolve();
}

/** After a job run of `taskId` ends, starts the next headquarters request if that run was one. */
export async function continueQueueAfter(taskId: string): Promise<void> {
  const found = await getTaskWithHeadquarters(taskId);
  if (!found || !isHeadquartersRequest(found.task)) return;
  const hq = await getHeadquartersById(found.headquartersId);
  if (hq) await nudgeHeadquartersQueue(hq);
}

// ---------- Work waiting for an agent ----------

/** Agents this process is starting work for, so two callers don't both dispatch. */
const startingFor = new Set<string>();

/**
 * Starts the next piece of work waiting for an agent, if the agent is free: first a task whose website finished
 * while the agent was busy, then the oldest step (or task) queued for it. Call it whenever an agent's run ends,
 * pauses for a website, or a chat with it finishes. Never throws.
 */
export async function startWorkForAgent(hq: HeadquartersRecord, agentId: string): Promise<void> {
  const key = `${hq.documentId}:${agentId}`;
  if (startingFor.has(key)) return;
  startingFor.add(key);
  try {
    for (let guard = 0; guard < 10; guard++) {
      if (!(await agentIsFree(hq.documentId, agentId))) return;
      const ready = (await listActiveWaits(hq.documentId)).find((w) => w.status === "waiting" && w.outcome && w.agentId === agentId);
      if (ready) {
        if (await resumeWaitingTask(ready) !== "cancelled") return;
        continue;
      }
      const next = (await listOpenAgentTasks(hq, agentId)).find((t) => t.status === "queued" && !t.jobRunId);
      if (!next) return;
      const root = next.parentId ? await getTask(next.parentId) : null;
      if (next.parentId && (!root || isTaskFinished(root.status) || root.cancelRequested)) {
        await updateTask(next.documentId, { status: "cancelled", activity: "Cancelled", finishedAt: new Date().toISOString() });
        continue;
      }
      await dispatchAgentTask(next.documentId, null);
      return;
    }
  } catch (error) {
    console.error("[tasks] couldn't start work waiting for an agent", error);
  } finally {
    startingFor.delete(key);
  }
}

/** Starts every agent's waiting work that can start now (a safety net for the periodic sweeps). */
export async function startQueuedAgentWork(hq: HeadquartersRecord): Promise<void> {
  const [queued, waits] = await Promise.all([listQueuedAgentTasks(hq), listActiveWaits(hq.documentId).catch(() => [])]);
  const agents = new Set([...queued.map((t) => t.agentId), ...waits.filter((w) => w.status === "waiting" && w.outcome).map((w) => w.agentId)]);
  for (const agentId of agents) if (agentId) await startWorkForAgent(hq, agentId);
}

/** Runs an agent task now: as a CloudHike job when configured, otherwise in this process. */
async function dispatchAgentTask(taskId: string, waitId: string | null): Promise<void> {
  if (jobsConfig()) {
    try {
      const run = await startJobRun("/api/jobs/agent-task", { taskId, ...(waitId ? { waitId } : {}) });
      await updateTask(taskId, { jobRunId: run.id });
      return;
    } catch (error) {
      console.error("[tasks] CloudHike Jobs dispatch failed; running inline instead.", error);
    }
  }
  void executeTask(taskId, { timeLimitSeconds: taskTimeLimitSeconds(false), waitId }).catch((error: unknown) => console.error("[tasks] agent task failed", error));
}

export type ExecuteResult = {
  taskId: string; status: TaskRecord["status"]; skipped?: boolean; output?: string | null; error?: string | null;
  /** The run paused for a website (wait_for_external) or a step waits for its agent; the task resumes later. */
  waiting?: boolean;
};

/**
 * Runs a queued task to completion. Safe to call twice for the same task: only the first call claims it.
 * Cancellation is requested by setting `cancelRequested` on the task; this run polls for it.
 * `waitId` resumes a task that waited for a website: the agent gets the wait's `next` instructions.
 * An agent task whose agent is busy goes back to waiting for it.
 */
export async function executeTask(taskId: string, { timeLimitSeconds, waitId }: { timeLimitSeconds: number; waitId?: string | null }): Promise<ExecuteResult> {
  const found = await getTaskWithHeadquarters(taskId);
  if (!found) return { taskId, status: "failed", skipped: true, error: "Task not found." };
  const { task } = found;
  const hq = await getHeadquartersById(found.headquartersId);
  if (!hq) return { taskId, status: "failed", skipped: true, error: "Headquarters not found." };
  const claimed = await claimTask(task);
  starting.delete(taskId);
  if (!claimed) return { taskId, status: task.status, skipped: true };
  const wait = waitId ? await getWait(waitId) : null;
  if (task.agentId && !(await holdsAgent(hq.documentId, task.agentId, taskId))) {
    // Another task got the agent first: wait for it again; startWorkForAgent starts this one when the agent is free.
    await updateTask(taskId, { status: "queued", jobRunId: null, activity: `Waiting for ${agentBusyLabel(task.agentName ?? "the agent")}` });
    if (wait) await updateWait(wait.documentId, { status: "waiting", lastResult: "Ready; waiting for the agent to be free." }).catch(() => undefined);
    return { taskId, status: "queued", skipped: true, waiting: true };
  }
  try {
    return await runClaimedTask(hq, task, timeLimitSeconds, wait);
  } finally {
    // The wait is over whatever the run did (finished, failed, or waits again with a new record).
    if (wait) await updateWait(wait.documentId, { status: "done" }).catch(() => undefined);
    // The agent is free again (or only waiting for a website): start work queued for it.
    if (task.agentId) await startWorkForAgent(hq, task.agentId);
  }
}

async function runClaimedTask(hq: HeadquartersRecord, task: TaskRecord, timeLimitSeconds: number, wait: ExternalWait | null): Promise<ExecuteResult> {
  const taskId = task.documentId;
  // A new headquarters request starts from a clean city: only agents that pick up its work show a status.
  if (isHeadquartersRequest(task)) await clearIdleAgentStates(hq).catch((error: unknown) => console.warn("[tasks] couldn't clear agent status:", error));

  const controller = new AbortController();
  const poll = setInterval(async () => {
    try {
      const fresh = await getTask(taskId);
      if (fresh?.cancelRequested) controller.abort(new RunCancelledError());
    } catch { /* keep running; the next poll retries */ }
  }, CANCEL_POLL_MS);
  // Paused while an agent waits for the user, like the agent's own limit.
  const clock = new RunClock(timeLimitSeconds, controller.signal);
  const signal = clock.signal;

  const started = wait ? `${task.agentName ?? "Agent"} continued: ${wait.title} ${wait.outcome === "ready" ? "is ready" : "needs a look"}` : task.agentId ? `${task.agentName ?? "Agent"} started` : task.plan?.length ? "Headquarters continued the plan" : "Headquarters started";
  await addEvent(hq.documentId, taskId, task.agentId, "started", started);
  try {
    let output: string;
    let usage: unknown;
    if (task.agentId) {
      const record = await findOwnedAgent(hq, task.agentId);
      if (!record) throw new Error("This agent no longer exists.");
      const input = wait ? resumeInput(task, wait) : task.input;
      if (task.parentId && !wait) await stepStarted(hq, task, record.name);
      // A step of a headquarters plan (resumed after a wait) keeps working with the team's shared memory.
      ({ output, usage } = await withRunClock(clock, () => runCityAgent({ hq, record, input, taskId, signal, team: Boolean(task.parentId) })));
    } else {
      const agents = await listAgents(hq);
      const result = await withRunClock(clock, () => runHeadquarters({ hq, task, agents, signal }));
      ({ output, usage } = result);
      if (result.waiting) {
        // A step waits for a website or for its busy agent: post what headquarters said so far; the request continues
        // once the step is done.
        await updateTask(taskId, { output, usage, paused: true, activity: "Waiting for a step to finish" });
        await addEvent(hq.documentId, taskId, null, "progress", "Waiting for a step to finish");
        const thread = await replyThread(hq, task);
        if (thread) await addMessage(hq.documentId, thread, "assistant", output, { taskId });
        // A step may have finished while this run was still going: then continue right away.
        await continueIfStepsDone(hq, taskId);
        return { taskId, status: "running", output, waiting: true };
      }
    }
    await updateTask(taskId, { status: "completed", progress: 100, output, usage, activity: "Completed", finishedAt: new Date().toISOString() });
    await addEvent(hq.documentId, taskId, task.agentId, "completed", "Completed");
    const thread = await replyThread(hq, task);
    if (thread) {
      const artifacts = await taskArtifacts(hq, taskId);
      await addMessage(hq.documentId, thread, "assistant", output, { taskId, ...(artifacts.length ? { metadata: { artifacts } } : {}) });
    }
    if (task.parentId) await finishWaitingStep(hq, task, { output });
    return { taskId, status: "completed", output };
  } catch (error) {
    const parked = controller.signal.aborted ? null : parkedFrom(error);
    if (parked) {
      await updateTask(taskId, { activity: waitingActivity(parked.wait, hq.timeZone) }).catch(() => undefined);
      await addEvent(hq.documentId, taskId, task.agentId, "progress", `Waiting for ${parked.wait.title}`).catch(() => undefined);
      const thread = await replyThread(hq, task).catch(() => null);
      if (thread) await addMessage(hq.documentId, thread, "assistant", waitingMessage(parked.wait, hq.timeZone), { taskId }).catch(() => undefined);
      if (task.parentId) await markStepWaiting(task, parked.wait, hq.timeZone).catch(() => undefined);
      return { taskId, status: "running", waiting: true };
    }
    const cancelled = controller.signal.aborted;
    // A waiting request that was stopped is settled by cancelTask already; don't report it twice.
    const latest = cancelled ? await getTask(taskId).catch(() => null) : null;
    if (latest && isTaskFinished(latest.status)) return { taskId, status: latest.status };
    const timedOut = signal.aborted && !cancelled;
    const message = cancelled ? "Cancelled." : timedOut ? `Stopped after the ${timeLimitSeconds}s time limit.` : describeError(error);
    const status = cancelled ? "cancelled" : "failed";
    await updateTask(taskId, { status, error: cancelled ? null : message, activity: cancelled ? "Cancelled" : "Failed", finishedAt: new Date().toISOString() });
    await addEvent(hq.documentId, taskId, task.agentId, status, message).catch(() => undefined);
    await settleChildren(hq, taskId, status).catch(() => undefined);
    const thread = await replyThread(hq, task).catch(() => null);
    if (thread) {
      const artifacts = await taskArtifacts(hq, taskId);
      const saved = artifacts.length ? "\n\nThese were finished before it stopped:" : "";
      await addMessage(hq.documentId, thread, "assistant", (cancelled ? "Stopped. Nothing else will run for this request." : `I couldn't finish this: ${message}`) + saved, {
        taskId, ...(artifacts.length ? { metadata: { artifacts } } : {}),
      }).catch(() => undefined);
    }
    if (!cancelled) console.error(`[tasks] ${taskId} failed`, error);
    if (task.parentId && !cancelled) await finishWaitingStep(hq, task, { error: message }).catch((e: unknown) => console.error("[tasks] couldn't continue the plan", e));
    return { taskId, status, error: message };
  } finally {
    clearInterval(poll);
    clock.dispose();
  }
}

// ---------- Waiting for a website (wait_for_external) ----------

/** The chat message posted when an agent pauses for a website. */
export function waitingMessage(wait: ExternalWait, timeZone?: string | null): string {
  return `⏳ Waiting for ${wait.title}. I check ${wait.url} every few minutes with the cloud computer turned off in between, and continue here by myself when it's ready (until ${clockTime(wait.deadlineAt, timeZone)} at the latest).`;
}

/** The resumed run's instructions: what was waited for, how the wait ended, and what to do now. */
function resumeInput(task: TaskRecord, wait: ExternalWait): string {
  const how = wait.outcome === "ready"
    ? `It is ready now (${wait.readyText ? `“${wait.readyText}” is on the page` : `“${wait.busyText}” is gone`}).`
    : wait.outcome === "signin"
      ? "It may be ready, but the page asks to sign in: call request_user_action with kind \"login\" first."
      : `It wasn't detected as ready before the time limit (${wait.checks} checks${wait.lastResult ? `; last: ${wait.lastResult}` : ""}). Look at the page yourself: if it is done, continue; if it is still working, you may call wait_for_external again; otherwise tell the user what happened.`;
  return [
    `You are continuing earlier work in a new run. You paused while waiting for ${wait.title} at ${wait.url}. ${how}`,
    `Start with browser_open on ${wait.url}. Then: ${wait.next}`,
    `The original task, for context:\n${task.input.slice(0, 4000)}`,
  ].join("\n\n");
}

// Steps that run outside their headquarters run (resumed after a website, or started once their agent was free)
// update the request's plan themselves. Two such steps can finish at the same moment, so each write is checked and
// retried; a headquarters run that is still going merges these changes when it saves its plan (orchestrator.ts).

const isStepOf = (child: TaskRecord) => (s: PlanStep) => s.taskId === child.documentId || Boolean(child.stepId && s.id === child.stepId);

/** Applies `change` to the child's step in its request's plan. Returns the request as read before the write. */
async function updateStep(child: TaskRecord, change: (step: PlanStep) => PlanStep): Promise<TaskRecord | null> {
  if (!child.parentId) return null;
  const matches = isStepOf(child);
  let root: TaskRecord | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    root = await getTask(child.parentId);
    if (!root?.plan?.some(matches)) return root;
    const wanted = root.plan.map((s) => (matches(s) ? change(s) : s));
    await updateTask(root.documentId, { plan: wanted });
    const check = (await getTask(root.documentId))?.plan?.find(matches);
    const mine = wanted.find(matches)!;
    if (check && check.status === mine.status && check.waitingFor === mine.waitingFor) return root;
  }
  return root;
}

/** Marks a headquarters step as waiting when its agent pauses again in a resumed run. */
async function markStepWaiting(child: TaskRecord, wait: ExternalWait, timeZone: string | null | undefined) {
  await updateStep(child, (s) => ({ ...s, status: "active", waitingFor: wait.title, summary: waitingActivity(wait, timeZone) }));
}

/**
 * A step that waited for its busy agent starts in its own run: the agent gets a fresh chat for it (as steps run by
 * headquarters do), and the plan shows it working. It keeps `waitingFor`, since headquarters is not running it.
 */
async function stepStarted(hq: HeadquartersRecord, child: TaskRecord, agentName: string) {
  await startFreshConversation(hq, child.agentId, `Chat with ${agentName}`).catch(() => undefined);
  await updateStep(child, (s) => ({ ...s, waitingFor: `${agentName} to finish it`, summary: `${agentName} is working on it` }));
}

/**
 * A step that ran outside its headquarters run ended: record it in the plan, post it to the agent's chat, and, once
 * no other step waits, put the paused request back in the queue so headquarters finishes it.
 */
async function finishWaitingStep(hq: HeadquartersRecord, child: TaskRecord, result: { output?: string; error?: string }) {
  const ok = result.output !== undefined;
  const summary = ok ? (result.output!.split("\n").find(Boolean) ?? "Done").slice(0, 160) : (result.error ?? "Failed").slice(0, 160);
  const root = await updateStep(child, (s) => ({ ...s, waitingFor: undefined, status: ok ? "done" : "failed", taskId: child.documentId, summary }));
  if (!root || isTaskFinished(root.status) || root.cancelRequested) return;
  if (child.agentId) {
    const conversationId = await getOrCreateConversation(hq, child.agentId, `Chat with ${child.agentName ?? "agent"}`).catch(() => null);
    if (conversationId) {
      const artifacts = await taskArtifacts(hq, child.documentId);
      const text = ok ? result.output! : `I couldn't finish this step: ${result.error}`;
      await addMessage(hq.documentId, conversationId, "assistant", `**Headquarters task: ${child.title}**\n\n${text}`, {
        taskId: child.documentId, ...(artifacts.length ? { metadata: { artifacts } } : {}),
      }).catch(() => undefined);
    }
  }
  await continueIfStepsDone(hq, root.documentId);
}

/**
 * Queues a paused request again once none of its steps waits. Only a paused request (no run going) is queued: a
 * running headquarters run sees the finished step itself. Both sides check after writing, so one of them continues.
 */
async function continueIfStepsDone(hq: HeadquartersRecord, rootId: string) {
  const root = await getTask(rootId);
  if (!root || !root.paused || root.status !== "running" || root.cancelRequested || root.plan?.some((s) => s.waitingFor)) return;
  await updateTask(rootId, { status: "queued", paused: false, jobRunId: null, activity: "Continuing the plan" });
  await nudgeHeadquartersQueue(hq);
}

/**
 * Continues a task that waited for a website (the wait has its `outcome`), in a new run: as a CloudHike job when
 * configured, otherwise in this process. The wait moves to "resuming" so it isn't checked again. If the agent is
 * busy with other work, the wait stays as it is ("busy") and startWorkForAgent resumes it once the agent is free.
 */
export async function resumeWaitingTask(wait: ExternalWait): Promise<"started" | "busy" | "cancelled"> {
  const task = wait.taskId ? await getTask(wait.taskId) : null;
  if (!task || isTaskFinished(task.status) || task.cancelRequested) {
    await updateWait(wait.documentId, { status: "cancelled" });
    return "cancelled";
  }
  if (task.agentId && wait.headquartersId && !(await agentIsFree(wait.headquartersId, task.agentId, task.documentId))) {
    await updateWait(wait.documentId, { lastResult: `${wait.outcome === "ready" ? "Ready" : "Done waiting"}; waiting for ${agentBusyLabel(task.agentName ?? "the agent")}.` }).catch(() => undefined);
    await updateTask(task.documentId, { activity: `${wait.title}: ready, waiting for ${agentBusyLabel(task.agentName ?? "the agent")}` }).catch(() => undefined);
    return "busy";
  }
  await updateWait(wait.documentId, { status: "resuming" });
  await updateTask(task.documentId, { status: "queued", jobRunId: null, activity: wait.outcome === "ready" ? `${wait.title}: ready, continuing` : "Continuing" });
  await dispatchAgentTask(task.documentId, wait.documentId);
  return "started";
}

/**
 * Where a task's reply goes: the chat's current conversation (the user may have cleared it, or a newer request may
 * have started a fresh one, while this task ran). Null for tasks that didn't come from a chat.
 */
async function replyThread(hq: HeadquartersRecord, task: TaskRecord): Promise<string | null> {
  if (!task.conversationId) return null;
  return getOrCreateConversation(hq, task.agentId, task.agentId ? `Chat with ${task.agentName ?? "agent"}` : `${hq.name} headquarters`)
    .catch(() => task.conversationId);
}

/** Artifacts produced by a task and its delegated steps, for the reply's preview cards. Empty if unavailable. */
async function taskArtifacts(hq: HeadquartersRecord, taskId: string) {
  return listTaskArtifacts(hq, taskId).catch((error: unknown) => {
    console.warn("[tasks] couldn't list the task's artifacts:", error instanceof Error ? error.message : error);
    return [];
  });
}

/** Marks child tasks that were still running as failed/cancelled and frees their buildings. */
async function settleChildren(hq: HeadquartersRecord, parentId: string, status: "failed" | "cancelled") {
  for (const child of await listChildTasks(parentId)) {
    if (isTaskFinished(child.status)) continue;
    await updateTask(child.documentId, { status, finishedAt: new Date().toISOString() });
    // A step still waiting for its agent never touched the agent, which may be busy with another request.
    if (child.agentId && child.status === "running") await setAgentState(child.agentId, status === "cancelled" ? { status: "idle", progress: null, activity: "Cancelled" } : { status: "failed", activity: "Stopped" });
  }
}

/**
 * Requests cancellation. A queued task (including one waiting in the headquarters queue) is cancelled at once; a
 * running one stops within a few seconds, and the queue then moves on to the next request.
 */
export async function cancelTask(hq: HeadquartersRecord, task: TaskRecord): Promise<void> {
  if (isTaskFinished(task.status)) return;
  await updateTask(task.documentId, { cancelRequested: true, activity: "Cancelling…" });
  if (task.status === "running") {
    // A task waiting for a website or for a busy agent has no run that could notice the request: settle it here.
    // (If a run is still going, it stops within seconds and sees that the task is already settled.)
    const children = await listChildTasks(task.documentId).catch(() => []);
    await Promise.all(children.filter((c) => !isTaskFinished(c.status)).map((c) => updateTask(c.documentId, { cancelRequested: true }).catch(() => undefined)));
    const open = await cancelWaitsForTasks(hq.documentId, [task.documentId, ...children.map((c) => c.documentId)]).catch(() => 0);
    if (open || task.paused) {
      await settleFailedJob(hq.documentId, { ...task, cancelRequested: true }, "Cancelled while waiting.");
      return;
    }
  }
  if (task.status === "queued") {
    await updateTask(task.documentId, { status: "cancelled", activity: "Cancelled", finishedAt: new Date().toISOString() });
    if (task.jobRunId) await cancelJobRun(task.jobRunId);
    if (task.conversationId && isHeadquartersRequest(task)) {
      const thread = await replyThread(hq, task).catch(() => null);
      if (thread) await addMessage(hq.documentId, thread, "assistant", `Removed from the queue: “${task.title}”.`, { taskId: task.documentId }).catch(() => undefined);
    }
  }
}

/**
 * Fails tasks left running by a crashed or restarted server, so buildings don't show "Working" forever.
 * A task is stale when nothing updated it for longer than the time limit plus a margin. Returns how many it failed.
 */
export async function sweepStaleTasks(hq: HeadquartersRecord): Promise<number> {
  // Tasks waiting for a website don't update while they wait; neither does a request whose steps wait (for a website
  // or for a busy agent), nor a step queued for its agent.
  const waits = await listActiveWaits(hq.documentId).catch(() => []);
  const held = new Set(waits.flatMap((w) => [w.rootTaskId, ...(w.status === "waiting" ? [w.taskId] : [])]).filter((id): id is string => Boolean(id)));
  const stale = (await listStaleTasks(hq, taskTimeLimitSeconds(false) + 120))
    .filter((t) => !held.has(t.documentId) && !t.paused && !(t.status === "queued" && t.agentId && !t.jobRunId));
  for (const task of stale) {
    await updateTask(task.documentId, { status: "failed", error: "The run stopped unexpectedly.", activity: "Failed", finishedAt: new Date().toISOString() });
    if (task.agentId) await setAgentState(task.agentId, { status: "failed", activity: "The run stopped unexpectedly" });
    await cancelOpenRequests(hq.documentId, task.documentId).catch(() => undefined);
  }
  // Safety net: start work waiting for an agent whose run ended without passing it on (a crash, a lost job).
  await startQueuedAgentWork(hq).catch((error: unknown) => console.warn("[tasks] couldn't start queued agent work:", error));
  return stale.length;
}

/** Records the outcome of a CloudHike run that ended without the task finishing (timeout, crash, cancel). */
export async function settleFailedJob(hqId: string, task: TaskRecord, reason: string): Promise<void> {
  const hq = await getHeadquartersById(hqId);
  if (!hq || isTaskFinished(task.status)) return;
  const status = task.cancelRequested ? "cancelled" : "failed";
  await updateTask(task.documentId, { status, error: status === "failed" ? reason : null, activity: status === "failed" ? "Failed" : "Cancelled", finishedAt: new Date().toISOString() });
  await addEvent(hq.documentId, task.documentId, task.agentId, status, reason).catch(() => undefined);
  await settleChildren(hq, task.documentId, status);
  if (task.agentId) await setAgentState(task.agentId, status === "failed" ? { status: "failed", activity: reason.slice(0, 110) } : { status: "idle", progress: null, activity: "Cancelled" });
  const thread = await replyThread(hq, task).catch(() => null);
  if (thread) await addMessage(hq.documentId, thread, "assistant", status === "failed" ? `I couldn't finish this: ${reason}` : "Stopped.", { taskId: task.documentId }).catch(() => undefined);
  // The failed run held the queue; let the next request start.
  if (isHeadquartersRequest(task)) await nudgeHeadquartersQueue(hq);
  else if (task.agentId) await startWorkForAgent(hq, task.agentId);
}
