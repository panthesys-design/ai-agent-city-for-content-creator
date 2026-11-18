import { assistant, run, user, type Agent, type AgentInputItem } from "@openai/agents";
import type { AgentRecord } from "@/lib/agent-records";
import { setAgentState } from "@/lib/agents";
import { cancelOpenRequests } from "@/lib/computer/store";
import type { HeadquartersRecord } from "@/lib/headquarters";
import { addEvent, updateTask } from "@/lib/runtime-store";
import type { StoredMessage } from "@/lib/task-records";
import { buildCityAgent } from "./agent-factory";
import { appsNoteFor } from "./app-tools";
import { withAttachmentNote } from "./artifact-access";
import { releaseRunComputer } from "./computer-tools";
import type { CityRunContext } from "./context";
import { aiProvider, configureAgentProvider } from "./env";
import { parkedFrom, waitingActivity } from "./external-waits";
import { openMemory, type MemoryConnection } from "./memory";
import { RunClock, withRunClock } from "./run-clock";

// Runs one agent with the Agents SDK's built-in loop (model → tool calls → observe → repeat until a final
// answer), streaming events into the city: building status/progress, task progress, and execution history.

export class RunCancelledError extends Error {
  constructor(message = "Cancelled.") { super(message); this.name = "RunCancelledError"; }
}

export type StreamHandlers = {
  onText?: (delta: string) => void;
  onTool?: (label: string) => void;
};

const TOOL_LABELS: Record<string, string> = {
  memory_search: "Searching memory", memory_get: "Reading memory", memory_save: "Saving to memory", memory_update: "Updating memory",
  web_search: "Searching the web", web_search_call: "Searching the web", generate_voiceover: "Recording voiceover",
  generate_image: "Generating an image", build_video_timeline: "Building the video timeline", prepare_publication: "Preparing publication",
  transform_image: "Editing an image", save_artifact: "Saving an artifact", plan_work: "Planning the work", run_step: "Delegating work",
  browser_search: "Searching in the cloud browser", browser_open: "Opening a website", browser_read: "Reading the page", browser_click: "Clicking on the page", browser_do: "Working on the page",
  browser_type: "Filling in the page", browser_select: "Choosing an option", browser_key: "Pressing a key", browser_scroll: "Scrolling the page",
  browser_history: "Navigating", browser_upload: "Uploading a file", browser_wait: "Waiting for the page", wait_for_external: "Pausing until the website is done", browser_tabs: "Switching tabs", browser_extract: "Extracting data", computer_screenshot: "Looking at the screen",
  computer_action: "Using the desktop", terminal_run: "Running a command", files_list: "Listing files", file_read: "Reading a file",
  file_write: "Writing a file", file_download: "Downloading a file", file_save: "Saving a file", request_user_action: "Waiting for you",
  ask_user: "Asking you a question", confirm_action: "Waiting for your approval", list_artifacts: "Looking through artifacts",
  read_artifact: "Reading an artifact", list_connected_apps: "Checking connected apps", find_app_tools: "Looking up app tools",
  run_app_tool: "Using a connected app", schedule_app_tool: "Scheduling a post", save_post_draft: "Saving a draft post", request_connection: "Waiting for you to connect an app",
};
export const toolLabel = (name: string) => TOOL_LABELS[name] ?? `Using ${name.replace(/_/g, " ")}`;

const compact = (value: unknown, n = 200) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

/** How many earlier chat messages a run sees, so the agent can resolve references like "make it shorter". */
export const CHAT_HISTORY_MESSAGES = 20;
const HISTORY_MESSAGE_CHARS = 4000;

/**
 * Builds the model input for a chat turn: the saved conversation (oldest first) followed by the new message.
 * System rows are skipped and very long replies are trimmed so old deliverables don't crowd out the request.
 * Earlier attachments are kept as references (title, artifactId, url) so the agent can still open them.
 */
export function chatInput(history: StoredMessage[], message: string | AgentInputItem): AgentInputItem[] {
  return [
    ...history.filter((m) => m.role !== "system" && (m.content.trim() || m.attachments?.length)).map((m) => {
      const content = compact(m.content, HISTORY_MESSAGE_CHARS);
      return m.role === "user" ? user(withAttachmentNote(content, m.attachments ?? [])) : assistant(content);
    }),
    typeof message === "string" ? user(message) : message,
  ];
}

/** A serial, fire-and-forget queue so history writes keep their order without slowing the agent loop. */
function writeQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    push(write: () => Promise<unknown>) { tail = tail.then(write).catch((e) => console.error("[agent-run] history write failed", e)); },
    drain: () => tail,
  };
}

/**
 * Streams an SDK agent to completion. Tool calls advance progress and are recorded as task events.
 * Used for department agents and the headquarters orchestrator alike.
 */
export async function streamAgent(agent: Agent<CityRunContext>, input: string | AgentInputItem[], context: CityRunContext, options: {
  maxTurns: number; handlers?: StreamHandlers; progressFloor?: number;
}): Promise<{ output: string; usage: { requests: number; inputTokens: number; outputTokens: number } }> {
  configureAgentProvider();
  const history = writeQueue();
  let progress = options.progressFloor ?? 5;
  // Models sometimes invent a tool name (e.g. browser_screenshot for computer_screenshot). Tell the model
  // which tools exist and let it retry, instead of the SDK failing the whole run with a ModelBehaviorError.
  const toolNames = agent.tools.map((t) => t.name).join(", ");
  const result = await run(agent, input, {
    stream: true, context, maxTurns: options.maxTurns, signal: context.signal,
    toolNotFoundBehavior: "return_error_to_model",
    toolErrorFormatter: ({ kind, toolName }) => kind === "tool_not_found"
      ? `Error: there is no tool named ${toolName}; nothing was run. Use one of your tools instead: ${toolNames}.`
      : undefined,
  });

  for await (const event of result) {
    if (event.type === "raw_model_stream_event" && event.data.type === "output_text_delta") {
      options.handlers?.onText?.(event.data.delta);
    } else if (event.type === "run_item_stream_event") {
      if (event.name === "tool_called" && event.item.type === "tool_call_item") {
        const raw = event.item.rawItem as { name?: string; type: string; arguments?: string };
        const name = raw.name ?? raw.type;
        if (name === "report_progress") continue;
        progress = Math.min(90, progress + Math.max(2, (90 - progress) * 0.2));
        options.handlers?.onTool?.(toolLabel(name));
        history.push(() => context.report({ progress, activity: toolLabel(name) }));
        if (context.taskId) history.push(() => addEvent(context.hq.documentId, context.taskId!, context.agentId, "tool_call", `${name} ${compact(raw.arguments ?? "", 180)}`.trim(), { tool: name }));
      } else if (event.name === "tool_output" && event.item.type === "tool_call_output_item" && context.taskId) {
        const output = event.item.output;
        history.push(() => addEvent(context.hq.documentId, context.taskId!, context.agentId, "tool_output", compact(output), null));
      }
    }
  }
  await result.completed;
  await history.drain();
  if (result.error) throw result.error;
  if (context.signal.aborted) throw new RunCancelledError();
  const usage = result.runContext.usage;
  return {
    output: typeof result.finalOutput === "string" ? result.finalOutput : JSON.stringify(result.finalOutput ?? ""),
    usage: { requests: usage.requests, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
  };
}


/**
 * Runs one department agent on a task or chat message: opens shared memory for team work, marks its building Working, streams the
 * run, and leaves the building Completed or Failed (or Idle when cancelled).
 */
export async function runCityAgent(params: {
  hq: HeadquartersRecord;
  record: AgentRecord;
  input: string | AgentInputItem[];
  taskId: string | null;
  signal: AbortSignal;
  handlers?: StreamHandlers;
  /** Receives each artifact the run saves, as soon as it is saved. */
  onArtifact?: CityRunContext["onArtifact"];
  /**
   * True for a step of a headquarters plan, where agents work together: the run gets shared memory and the role
   * playbook. False (the default) for a direct chat or standalone task, which answers the user without memory.
   */
  team?: boolean;
}): Promise<{ output: string; usage: { requests: number; inputTokens: number; outputTokens: number } }> {
  configureAgentProvider();
  const { hq, record, taskId } = params;
  if (!record.enabled) throw new Error(`${record.name} is turned off. Turn it on in its AI settings first.`);

  // The time limit pauses while the agent waits for the user (sign-in, captcha, a question); see run-clock.ts.
  const clock = new RunClock(record.settings.timeoutSeconds, params.signal);
  const signal = clock.signal;
  const report: CityRunContext["report"] = async ({ progress, activity }) => {
    await Promise.all([
      setAgentState(record.documentId, { ...(progress !== undefined ? { progress } : {}), ...(activity ? { activity } : {}) }),
      taskId ? updateTask(taskId, { ...(progress !== undefined ? { progress } : {}), ...(activity ? { activity } : {}) }) : null,
    ]);
  };
  const setStatus: CityRunContext["setStatus"] = (status, activity) => setAgentState(record.documentId, { status, activity });
  await setAgentState(record.documentId, { status: "working", progress: 3, activity: "Getting started" });

  let memory: MemoryConnection | null = null;
  const computer: NonNullable<CityRunContext["computer"]> = { lease: null, startedAt: Date.now() };
  try {
    const team = params.team ?? false;
    if (team && record.tools.includes("memory")) memory = await openMemory({ hq: hq.documentId, agent: record.documentId, ...(taskId ? { task: taskId } : {}) });
    const agent = buildCityAgent(record, hq.name, memory, { team, appsNote: await appsNoteFor(hq.documentId, record.documentId), timeZone: hq.timeZone });
    const context: CityRunContext = { hq, taskId, agentId: record.documentId, agentName: record.name, report, signal, onArtifact: params.onArtifact, computer, setStatus };
    const result = await withRunClock(clock, () => streamAgent(agent, params.input, context, { maxTurns: record.settings.maxTurns, handlers: params.handlers }));
    await setAgentState(record.documentId, { status: "completed", progress: 100, activity: compact(result.output.split("\n")[0] || "Done", 110) });
    return result;
  } catch (error) {
    // wait_for_external ended the run on purpose: the task waits for a website and continues later.
    const parked = parkedFrom(error);
    if (parked && !params.signal.aborted) {
      await setAgentState(record.documentId, { status: "working", activity: waitingActivity(parked.wait, hq.timeZone) }).catch(() => undefined);
      throw parked;
    }
    if (params.signal.aborted) {
      await setAgentState(record.documentId, { status: "idle", progress: null, activity: "Cancelled" }).catch(() => undefined);
      throw new RunCancelledError();
    }
    const timedOut = clock.expired && !params.signal.aborted;
    const message = timedOut ? `Stopped after the ${record.settings.timeoutSeconds}s time limit.` : describeError(error);
    await setAgentState(record.documentId, { status: "failed", activity: compact(message, 110) }).catch(() => undefined);
    throw timedOut ? new Error(message) : error;
  } finally {
    clock.dispose();
    await memory?.close();
    // Shut the cloud computer down (if this run used it) and drop questions nobody answered.
    await releaseRunComputer({ computer });
    if (taskId) await cancelOpenRequests(hq.documentId, taskId).catch(() => undefined);
  }
}

export function describeError(error: unknown): string {
  if (error instanceof RunCancelledError) return "Cancelled.";
  if (error instanceof Error) {
    if (error.name === "MaxTurnsExceededError") return "Stopped: the agent reached its max turns. Raise Max turns in its AI settings or narrow the task.";
    if (/api key|401/i.test(error.message)) {
      return aiProvider() === "anthropic" ? "Anthropic rejected the request. Check ANTHROPIC_API_KEY." : "OpenAI rejected the request. Check OPENAI_API_KEY.";
    }
    return error.message.slice(0, 500);
  }
  return "Something went wrong.";
}
