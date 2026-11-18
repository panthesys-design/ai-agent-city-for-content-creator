import { Agent, tool, user, type AgentInputItem } from "@openai/agents";
import { z } from "zod";
import { agentRoleLabels, agentToolInfo } from "@/lib/agent-config";
import type { AgentRecord } from "@/lib/agent-records";
import { listTaskArtifacts } from "@/lib/artifacts";
import type { HeadquartersRecord } from "@/lib/headquarters";
import { addEvent, addMessage, createTask, getOrCreateConversation, getTask, listChildTasks, listMessagePage, startFreshConversation, updateTask } from "@/lib/runtime-store";
import type { PlanStep, TaskRecord } from "@/lib/task-records";
import { reportProgressTool } from "./agent-factory";
import { ARTIFACT_RULES, listArtifactsTool, readArtifactTool } from "./artifact-tools";
import { dateRules, isoDate, resolveTimeZone } from "./clock";
import { askUserTool, confirmActionTool } from "./computer-tools";
import { appsNoteFor, headquartersAppTools } from "./app-tools";
import type { CityRunContext } from "./context";
import { agentBusyLabel, agentIsFree, holdsAgent } from "./agent-availability";
import { orchestratorModel } from "./env";
import { clockTime, parkedFrom, waitingActivity } from "./external-waits";
import { openMemory } from "./memory";
import { CHAT_HISTORY_MESSAGES, RunCancelledError, chatInput, describeError, runCityAgent, streamAgent } from "./run-agent";

// The headquarters is the master agent. It reads shared memory, plans which department agents do what and in
// which order (plan_work), and delegates each step (run_step). Dependencies are enforced in code: a step only
// runs once every step it depends on is done. Independent steps may run in parallel.

const STEP_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RESULT_LIMIT = 6000;
const truncate = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

// task-runner.ts imports this module, so its scheduling functions are loaded lazily here (fire and forget).
const nudgeQueue = (hq: HeadquartersRecord) => {
  void import("./task-runner").then((m) => m.nudgeHeadquartersQueue(hq)).catch((e: unknown) => console.error("[headquarters] queue nudge failed", e));
};
const agentFreed = (hq: HeadquartersRecord, agentId: string) => {
  void import("./task-runner").then((m) => m.startWorkForAgent(hq, agentId)).catch((e: unknown) => console.error("[headquarters] couldn't start queued work", e));
};

/** Serialises plan updates when the model runs several steps in parallel. */
function mutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => undefined);
    return next;
  };
}

function roster(agents: AgentRecord[]) {
  return agents.map((a) => {
    const tools = a.tools.map((t) => agentToolInfo[t].label).join(", ") || "no tools";
    return `- ${a.name}${a.enabled ? "" : " (turned off, do not use)"} — ${agentRoleLabels[a.role]}. ${a.instructions} Tools: ${tools}.`;
  }).join("\n");
}

function instructionsFor(hq: HeadquartersRecord, agents: AgentRecord[]) {
  return `You are the headquarters of "${hq.name}", the orchestrator of a city of AI agents that create content together.

Your agents:
${roster(agents)}

How you work:
1. Greetings and small talk get a short, friendly reply: no memory, no planning, no tools. Don't restart or continue earlier work unless the user asks for it.
2. For a question you can answer yourself (about the city or its agents), answer directly without planning. Search memory only when the question is about past work.
3. For real work that needs your agents, first check shared memory (memory_search) for project context and earlier results. Save important new project context (audience, channel, tone, goals) with memory_save kind "context".
4. Call plan_work with the smallest set of steps that delivers the request. Each step names one agent and the step IDs it depends on. Typical pipeline: Research → Script → (Voice and Media in parallel) → Video Editor → Publisher. Skip steps the request does not need.
5. Run steps with run_step, giving each agent precise, self-contained instructions. A step can only start when its dependencies are done; you may run independent steps together.
6. A step can come back as waiting: its agent paused while a website keeps working for a long time (for example Claude building a video), or the agent is busy with another request and the step is queued for it. Either way the step finishes by itself later. Run other steps that don't depend on it, then end with a short message saying what is in progress; don't run steps that depend on it and don't re-run it. When it is done, you are started again on this request to finish the plan.
7. If a step fails, read the error, then retry it once with better instructions, re-plan around it, or stop and explain. When the user named a specific website, app, or service, the retry must still use it: never switch to another method (for example local ffmpeg editing instead of the named web editor) unless the user agrees through ask_user.
8. Finish with a concise Markdown summary for the user: what was produced, key results, and anything that needs their decision. Every deliverable your agents saved (scripts, topic lists, images, voiceovers, timelines, publishing packages) is shown to the user as an artifact card under your summary and on the Artifacts page, so refer to them by title instead of pasting them or listing raw URLs and memory IDs.

Files and earlier work: files the user attached to the request are listed in it with their artifactId and url. Give the artifactIds and urls to every agent that needs them in run_step, so they open the files with read_artifact. When the request builds on earlier work ("shorten the last video", "use my logo"), find it with list_artifacts and pass its artifactId the same way. Each request starts a fresh conversation, so earlier tasks live on in shared memory and artifacts, not in the chat.

Questions and approvals: agents ask the user themselves when they can't decide (which service or website to use) and before outward-facing actions such as publishing, and the user answers from the city without coming back here. When the request already settles such a question (the platform, whether to publish, a deadline), say so in the step instructions so the agent doesn't ask again. If the request itself is too ambiguous to plan, ask the user with ask_user before planning; use confirm_action before a plan that publishes, posts, sends, or spends anything the user didn't clearly ask for.

Agents with the Cloud computer tool can use real websites and platforms (with the user's saved sign-ins), extract data, run commands, and keep files; give them work that needs live web pages or a service no agent has a tool for. Work on an app that is connected (posting, uploading, reading stats, saving to Notion or Sheets) goes through its connected-app tools, not the computer: say so in the step instructions and give it to an agent with access to that app. Name the deliverable in the step (for example "export the edited video, download it, and save it with file_save"), so the agent finishes with a saved artifact. If an agent needs the user (to sign in or choose a service), it asks and waits by itself, so don't plan around that.

Agents share work through memory, so tell each agent what to read and what to save; ask them to save text deliverables with save_artifact. Never claim work happened that a tool result does not show.`;
}

/**
 * The request plus the headquarters chat that led up to it, so follow-ups like "now make the video shorter" refer
 * to earlier work. The request's own message is dropped (it is the input), and so are requests queued after it;
 * replies saved while it waited in the queue (the previous request's result) are kept.
 */
async function headquartersInput(hq: HeadquartersRecord, task: TaskRecord) {
  if (!task.conversationId) return task.input;
  const page = await listMessagePage(hq, task.conversationId, { limit: CHAT_HISTORY_MESSAGES + 5 }).catch((error: unknown) => {
    console.error("[headquarters] couldn't load chat history; running without it", error);
    return null;
  });
  if (!page) return task.input;
  const queuedLater = (m: { role: string; createdAt: string | null }) => m.role === "user" && Boolean(task.createdAt && m.createdAt && m.createdAt > task.createdAt);
  const earlier = page.messages.filter((m) => m.taskId !== task.documentId && !queuedLater(m));
  const last = earlier.at(-1);
  if (last?.role === "user" && last.content.trim() === task.input.trim()) earlier.pop();
  return chatInput(earlier.slice(-CHAT_HISTORY_MESSAGES), task.input);
}

/** Tells headquarters it is picking up a request whose waiting step has finished. */
function resumeNote(plan: PlanStep[]): string {
  const lines = plan.map((s) => `- ${s.id}: ${s.agentName} — ${s.title} [${s.waitingFor ? "waiting" : s.status}]${s.summary ? ` ${truncate(s.summary, 200)}` : ""}`);
  return [
    "(Resuming this request: a step that waited for a website has finished. The plan so far:",
    ...lines,
    "Don't redo finished steps. If plan_work is needed, list the done steps again unchanged so they keep their results. Run the remaining steps with run_step, then give the final summary.)",
  ].join("\n");
}

export async function runHeadquarters(params: {
  hq: HeadquartersRecord;
  task: TaskRecord;
  agents: AgentRecord[];
  signal: AbortSignal;
}): Promise<{ output: string; usage: unknown; waiting: boolean }> {
  const { hq, task, agents, signal } = params;
  const lock = mutex();
  let plan: PlanStep[] = task.plan ?? [];
  // A request resumed after a waiting step: earlier steps' results feed the steps that depend on them.
  const resuming = plan.length > 0;
  const outputs = new Map<string, string>();
  if (resuming) {
    for (const child of await listChildTasks(task.documentId).catch(() => [])) {
      if (child.stepId && child.status === "completed" && child.output) outputs.set(child.stepId, child.output);
    }
  }

  const progressOf = () => (plan.length ? 8 + Math.round((plan.filter((s) => s.status === "done").length / plan.length) * 87) : 5);
  // Steps that wait (for a website or a busy agent) finish in their own runs and record that in the saved plan.
  // Take those results in before every save and check, so this run neither overwrites nor misses them.
  const syncPlan = async () => {
    const saved = (await getTask(task.documentId).catch(() => null))?.plan;
    if (!saved) return;
    plan = plan.map((s) => {
      if (!s.waitingFor) return s;
      const latest = saved.find((x) => x.id === s.id && x.taskId === s.taskId);
      // Only changes made elsewhere: the step finished, or its own run moved on (started, or waits for something new).
      // A step this run just marked as waiting isn't saved yet; keep that.
      const changedElsewhere = latest && (latest.status === "done" || latest.status === "failed" || (latest.waitingFor && latest.waitingFor !== s.waitingFor));
      return changedElsewhere ? latest : s;
    });
    for (const step of plan) {
      if (step.status !== "done" || !step.taskId || outputs.has(step.id)) continue;
      const output = (await getTask(step.taskId).catch(() => null))?.output;
      if (output) outputs.set(step.id, output);
    }
  };
  const savePlan = async (activity?: string) => {
    await syncPlan();
    await updateTask(task.documentId, { plan, progress: progressOf(), ...(activity ? { activity } : {}) });
  };
  const report: CityRunContext["report"] = async ({ progress, activity }) => {
    await updateTask(task.documentId, { ...(activity ? { activity } : {}), ...(progress !== undefined && !plan.length ? { progress } : {}) });
  };

  const byName = (name: string) => agents.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());

  // Every agent starts its step of this task with a fresh chat (when the step actually starts, since a busy agent may
  // still be finishing another request); when its step ends, the result is posted there, so clicking its building
  // shows what it did for this task and the user can follow up with it directly.
  const threads = new Map<string, Promise<void>>();
  const freshThread = (record: AgentRecord) => {
    let started = threads.get(record.documentId);
    if (!started) {
      started = startFreshConversation(hq, record.documentId, `Chat with ${record.name}`).then(() => undefined, (error: unknown) => {
        console.warn(`[headquarters] couldn't start a fresh chat for ${record.name}:`, error instanceof Error ? error.message : error);
      });
      threads.set(record.documentId, started);
    }
    return started;
  };
  const postToAgentChat = async (record: AgentRecord, step: PlanStep, text: string, childId: string) => {
    try {
      await freshThread(record);
      const conversationId = await getOrCreateConversation(hq, record.documentId, `Chat with ${record.name}`);
      const artifacts = await listTaskArtifacts(hq, childId).catch(() => []);
      await addMessage(hq.documentId, conversationId, "assistant", `**Headquarters task: ${step.title}**\n\n${text}`, {
        taskId: childId, ...(artifacts.length ? { metadata: { artifacts } } : {}),
      });
    } catch (error) {
      console.warn(`[headquarters] couldn't post ${record.name}'s result to its chat:`, error instanceof Error ? error.message : error);
    }
  };

  const planWork = tool({
    name: "plan_work",
    description: "Create or revise the plan: which agent does each step and which steps must finish first. Steps already done keep their results.",
    parameters: z.object({
      steps: z.array(z.object({
        id: z.string().describe('Short unique step ID, lowercase with dashes, e.g. "research".'),
        agent: z.string().describe("Exact agent name from your roster."),
        title: z.string().min(1).max(120).describe("What this step delivers."),
        dependsOn: z.array(z.string()).describe("IDs of earlier steps that must be done first."),
      })).min(1).max(20),
    }),
    execute: async ({ steps }) => lock(async () => {
      const seen = new Set<string>();
      const next: PlanStep[] = [];
      for (const step of steps) {
        if (!STEP_ID.test(step.id)) return `Invalid step id "${step.id}". Use lowercase letters, digits, and dashes.`;
        if (seen.has(step.id)) return `Duplicate step id "${step.id}".`;
        const agent = byName(step.agent);
        if (!agent) return `Unknown agent "${step.agent}". Use an exact name from the roster.`;
        if (!agent.enabled) return `${agent.name} is turned off. Plan without it.`;
        const unknown = step.dependsOn.filter((d) => !seen.has(d));
        if (unknown.length) return `Step "${step.id}" depends on ${unknown.join(", ")}, which must be listed earlier in the plan.`;
        seen.add(step.id);
        const previous = plan.find((p) => p.id === step.id);
        const keep = previous && previous.agentId === agent.documentId && previous.status === "done";
        // A step whose agent is waiting for a website stays as it is: it finishes by itself.
        if (previous?.waitingFor && previous.agentId === agent.documentId) {
          next.push({ ...previous, title: step.title, dependsOn: step.dependsOn });
          continue;
        }
        next.push({
          id: step.id, agentId: agent.documentId, agentName: agent.name, title: step.title, dependsOn: step.dependsOn,
          status: keep ? "done" : "pending", ...(keep && previous.taskId ? { taskId: previous.taskId } : {}), ...(keep && previous.summary ? { summary: previous.summary } : {}),
        });
      }
      plan = next;
      await savePlan(`Planned ${plan.length} step${plan.length === 1 ? "" : "s"}`);
      await addEvent(hq.documentId, task.documentId, null, "progress", `Plan: ${plan.map((s) => `${s.id} (${s.agentName})`).join(" → ")}`, { plan });
      return `Plan saved:\n${plan.map((s) => `- ${s.id}: ${s.agentName} — ${s.title}${s.dependsOn.length ? ` (after ${s.dependsOn.join(", ")})` : ""} [${s.status}]`).join("\n")}`;
    }),
  });

  const runStep = tool({
    name: "run_step",
    description: "Delegate one planned step to its agent and wait for the result. Fails if the step's dependencies are not done yet.",
    parameters: z.object({
      stepId: z.string(),
      instructions: z.string().min(1).max(8000).describe("Self-contained instructions: the goal, constraints, what to read from memory, and what to save."),
    }),
    execute: async ({ stepId, instructions }) => {
      const claim = await lock(async () => {
        await syncPlan();
        const step = plan.find((s) => s.id === stepId);
        if (!step) return { error: `No step "${stepId}" in the plan. Call plan_work first.` };
        if (step.status === "done") return { error: `Step "${stepId}" is already done: ${step.summary ?? ""}` };
        if (step.status === "active") return { error: `Step "${stepId}" is already running.` };
        const waiting = step.dependsOn.filter((d) => plan.find((s) => s.id === d)?.status !== "done");
        if (waiting.length) return { error: `Step "${stepId}" must wait for: ${waiting.join(", ")}. Run those first.` };
        const record = agents.find((a) => a.documentId === step.agentId);
        if (!record) return { error: `The agent for step "${stepId}" no longer exists. Re-plan.` };
        plan = plan.map((s) => (s.id === stepId ? { ...s, status: "active" } : s));
        await savePlan(`${record.name}: ${step.title}`);
        return { step, record };
      });
      if ("error" in claim) return claim.error;
      const { step, record } = claim;

      // Work has been handed out: the next headquarters request in the queue may start planning now.
      nudgeQueue(hq);

      const earlier = step.dependsOn.map((d) => outputs.get(d) ? `## Result of step "${d}"\n${truncate(outputs.get(d)!, 3000)}` : "").filter(Boolean).join("\n\n");
      const input = [
        instructions,
        `Overall request from the user (for context): ${truncate(task.input, 2000)}`,
        earlier && `Results from earlier steps (full details are in shared memory):\n\n${earlier}`,
      ].filter(Boolean).join("\n\n");

      // The child task keeps the full input, so a step that has to wait for its agent can start later on its own.
      const child = await createTask(hq, { title: step.title, input, agentId: record.documentId, parentId: task.documentId, stepId });
      const free = await agentIsFree(hq.documentId, record.documentId);
      if (free) await updateTask(child.documentId, { status: "running", startedAt: new Date().toISOString() });
      // Claim by writing first: another request may have started a step for this agent at the same moment.
      if (!free || !(await holdsAgent(hq.documentId, record.documentId, child.documentId))) {
        if (free) await updateTask(child.documentId, { status: "queued", activity: `Waiting for ${agentBusyLabel(record.name)}` });
        const waitingFor = agentBusyLabel(record.name);
        await lock(async () => {
          plan = plan.map((s) => (s.id === stepId ? { ...s, status: "active", taskId: child.documentId, waitingFor, summary: `Waiting for ${waitingFor}` } : s));
          await savePlan(`${step.title}: waiting for ${waitingFor}`);
        });
        await addEvent(hq.documentId, task.documentId, record.documentId, "delegated", `${record.name} is busy; "${step.title}" starts when it is free`, { stepId, childTaskId: child.documentId });
        return `Step "${stepId}" is queued: ${record.name} is busy with other work, and the step starts by itself as soon as ${record.name} is free. It counts as waiting: don't run it again or run steps that depend on it; run other independent steps if any, then end with a short message saying what is in progress. You will be started again on this request when it is done.`;
      }
      await freshThread(record);
      await addEvent(hq.documentId, task.documentId, record.documentId, "delegated", `${record.name}: ${step.title}`, { stepId, childTaskId: child.documentId });

      try {
        const { output, usage } = await runCityAgent({ hq, record, input, taskId: child.documentId, signal, team: true });
        outputs.set(stepId, output);
        await updateTask(child.documentId, { status: "completed", progress: 100, output, usage, finishedAt: new Date().toISOString(), activity: "Done" });
        await lock(async () => {
          plan = plan.map((s) => (s.id === stepId ? { ...s, status: "done", taskId: child.documentId, summary: truncate(output.split("\n").find(Boolean) ?? "Done", 160) } : s));
          await savePlan(`${record.name} finished: ${step.title}`);
        });
        await postToAgentChat(record, step, output, child.documentId);
        return truncate(output, RESULT_LIMIT);
      } catch (error) {
        const parked = signal.aborted ? null : parkedFrom(error);
        if (parked) {
          // The agent paused for a website; its task stays running and finishes in a later run (see task-runner.ts).
          const activity = waitingActivity(parked.wait, hq.timeZone);
          await updateTask(child.documentId, { activity }).catch(() => undefined);
          await lock(async () => {
            plan = plan.map((s) => (s.id === stepId ? { ...s, status: "active", taskId: child.documentId, waitingFor: parked.wait.title, summary: activity } : s));
            await savePlan(`${record.name}: ${activity}`);
          }).catch(() => undefined);
          await addEvent(hq.documentId, task.documentId, record.documentId, "progress", `${record.name} is waiting for ${parked.wait.title}`).catch(() => undefined);
          await postToAgentChat(record, step, `Waiting for ${parked.wait.title}. I check ${parked.wait.url} every few minutes and continue by myself when it's ready.`, child.documentId);
          return `Step "${stepId}" is waiting: ${record.name} paused while waiting for ${parked.wait.title} (checked every few minutes, until ${clockTime(parked.wait.deadlineAt, hq.timeZone)} at the latest). It finishes by itself, and you will be started again on this request afterwards. Don't run it again or run steps that depend on it; run other independent steps if any, then end with a short message saying what is in progress.`;
        }
        const cancelled = error instanceof RunCancelledError || signal.aborted;
        const message = describeError(error);
        await updateTask(child.documentId, { status: cancelled ? "cancelled" : "failed", error: message, finishedAt: new Date().toISOString() }).catch(() => undefined);
        await lock(async () => {
          plan = plan.map((s) => (s.id === stepId ? { ...s, status: cancelled ? "pending" : "failed", taskId: child.documentId, summary: message } : s));
          await savePlan(cancelled ? "Cancelling…" : `${record.name} failed: ${step.title}`);
        }).catch(() => undefined);
        await postToAgentChat(record, step, cancelled ? "Stopped before finishing." : `I couldn't finish this step: ${message}`, child.documentId);
        if (cancelled) throw new RunCancelledError();
        return `Step "${stepId}" failed: ${message}`;
      } finally {
        // The agent is free again (or waiting for a website): start work queued for it by other requests.
        agentFreed(hq, record.documentId);
      }
    },
  });

  const memory = await openMemory({ hq: hq.documentId, task: task.documentId });
  try {
    const appsNote = await appsNoteFor(hq.documentId, null);
    const orchestrator = new Agent<CityRunContext>({
      name: `${hq.name} Headquarters`,
      instructions: `${instructionsFor(hq, agents)}\n\n${dateRules(new Date(), resolveTimeZone(hq.timeZone))} When you delegate time-sensitive work, write the date into the step instructions (for example "trending topics for ${isoDate(new Date(), resolveTimeZone(hq.timeZone))}") so agents search for the right period.\n\n${ARTIFACT_RULES}${appsNote ? `\n\nPublishing and other app work (posting to Instagram, YouTube, X, LinkedIn, saving to Notion) runs through the user's connected apps. ${appsNote} If a needed app isn't connected, call request_connection yourself before planning; the user connects it from the card.` : ""}`,
      ...(orchestratorModel() ? { model: orchestratorModel() } : {}),
      tools: [planWork, runStep, reportProgressTool, listArtifactsTool, readArtifactTool, askUserTool, confirmActionTool, ...headquartersAppTools, ...memory.tools],
      mcpServers: memory.mcpServers,
    });
    const context: CityRunContext = { hq, taskId: task.documentId, agentId: null, agentName: orchestrator.name, report, signal };
    const maxTurns = Math.min(60, Math.max(20, Number(process.env.ORCHESTRATOR_MAX_TURNS) || 30));
    let input: string | AgentInputItem[] = await headquartersInput(hq, task);
    if (resuming) {
      const note = resumeNote(plan);
      input = typeof input === "string" ? `${input}\n\n${note}` : [...input, user(note)];
    }
    const result = await streamAgent(orchestrator, input, context, { maxTurns, progressFloor: 3 });
    await lock(syncPlan);
    return { ...result, waiting: plan.some((s) => s.waitingFor) };
  } finally {
    await memory.close();
  }
}
