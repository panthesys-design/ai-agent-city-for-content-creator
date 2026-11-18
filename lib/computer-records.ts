// Client-safe shapes for the cloud computer (CloudHike.dev) that agents use, and for the requests agents send the
// user while they work (sign in, solve a captcha, choose a service). Server code lives in lib/computer/.
//
// Strapi collections: `computer-sessions` (one per headquarters) and `agent-requests`. See docs/cloud-computer.md.

export const computerStates = ["stopped", "starting", "running", "stopping", "error"] as const;
export type ComputerState = (typeof computerStates)[number];

/** What the city shows about the headquarters' computer: its state and the agent using it right now. */
export type ComputerSnapshot = {
  state: ComputerState;
  /** Agent using the computer now; null when nobody is. */
  agentId: string | null;
  agentName: string | null;
  activity: string | null;
  /** Page the cloud browser is showing, as last reported by an agent. */
  url: string | null;
  pageTitle: string | null;
  since: string | null;
  error: string | null;
};

export const IDLE_COMPUTER: ComputerSnapshot = {
  state: "stopped", agentId: null, agentName: null, activity: null, url: null, pageTitle: null, since: null, error: null,
};

export const computerStateLabels: Record<ComputerState, string> = {
  stopped: "Off", starting: "Starting", running: "On", stopping: "Shutting down", error: "Error",
};

export const requestKinds = ["login", "captcha", "action", "choice", "confirm", "connect"] as const;
export type RequestKind = (typeof requestKinds)[number];
export const requestStatuses = ["pending", "resolved", "cancelled", "expired"] as const;
export type RequestStatus = (typeof requestStatuses)[number];

export const requestKindLabels: Record<RequestKind, string> = {
  login: "Sign in needed", captcha: "Captcha to solve", action: "Action needed", choice: "Choose an option", confirm: "Approval needed",
  connect: "Connect an app",
};

export type RequestOption = { id: string; label: string; description?: string };

/** The user's answer to a request. */
export type RequestResponse = {
  /** For a choice: the chosen option ID, or "other" with `text`. */
  optionId?: string;
  text?: string;
  /** For login/captcha/action: whether the user finished it or the browser showed it was done. */
  done?: boolean;
  detected?: boolean;
};

export type AgentRequest = {
  documentId: string;
  kind: RequestKind;
  status: RequestStatus;
  title: string;
  message: string | null;
  url: string | null;
  service: string | null;
  capability: string | null;
  options: RequestOption[];
  allowOther: boolean;
  response: RequestResponse | null;
  agentId: string | null;
  agentName: string | null;
  taskId: string | null;
  createdAt: string | null;
  expiresAt: string | null;
};

/** Requests that need the user's eyes on the cloud computer (sign-in, captcha, manual step). */
export const needsComputer = (kind: RequestKind) => kind === "login" || kind === "captcha" || kind === "action";

/** Requests the user answers in the app (buttons or a typed answer) rather than on the cloud computer. */
export const isQuestion = (kind: RequestKind) => kind === "choice" || kind === "confirm";

/**
 * A `connect` request (request_connection) names a Composio app in `service`, its logo in `url`, and in `capability`
 * what the user still has to do: connect the app, give this agent access to it, or allow posting with it.
 */
export type ConnectStep = "connect" | "grant" | "publish";
export const connectStepOf = (request: Pick<AgentRequest, "kind" | "capability">): ConnectStep | null =>
  request.kind !== "connect" ? null : request.capability === "grant" || request.capability === "publish" ? request.capability : "connect";

/** Option IDs of an approval request (`confirm_action`). */
export const CONFIRM_OPTIONS: RequestOption[] = [
  { id: "approve", label: "Approve" },
  { id: "decline", label: "Decline" },
];

/** Short label for a request: an open question (a choice without options) reads as a question. */
export const requestLabel = (request: Pick<AgentRequest, "kind" | "options">) =>
  request.kind === "choice" && !request.options.length ? "Question" : requestKindLabels[request.kind];

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const rel = (v: unknown) => (v && typeof v === "object" && "documentId" in v ? String((v as { documentId: unknown }).documentId) : null);

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseOptions(value: unknown): RequestOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((o) => {
    if (!o || typeof o !== "object") return [];
    const { id, label, description } = o as Record<string, unknown>;
    if (typeof id !== "string" || typeof label !== "string" || !id || !label) return [];
    return [{ id: id.slice(0, 64), label: label.slice(0, 80), ...(typeof description === "string" && description ? { description: description.slice(0, 200) } : {}) }];
  }).slice(0, 8);
}

function parseResponse(value: unknown): RequestResponse | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return {
    ...(typeof v.optionId === "string" ? { optionId: v.optionId } : {}),
    ...(typeof v.text === "string" ? { text: v.text } : {}),
    ...(typeof v.done === "boolean" ? { done: v.done } : {}),
    ...(typeof v.detected === "boolean" ? { detected: v.detected } : {}),
  };
}

export function requestFromStrapi(row: Record<string, unknown>): AgentRequest {
  const agent = row.agent as { name?: unknown } | null | undefined;
  return {
    documentId: String(row.documentId),
    kind: oneOf(requestKinds, row.kind, "action"),
    status: oneOf(requestStatuses, row.status, "pending"),
    title: String(row.title ?? "Your agent needs you"),
    message: str(row.message),
    url: str(row.url),
    service: str(row.service),
    capability: str(row.capability),
    options: parseOptions(row.options),
    allowOther: row.allowOther === true,
    response: parseResponse(row.response),
    agentId: rel(row.agent),
    agentName: agent && typeof agent.name === "string" ? agent.name : null,
    taskId: rel(row.task),
    createdAt: str(row.createdAt),
    expiresAt: str(row.expiresAt),
  };
}

export function computerFromStrapi(row: Record<string, unknown> | null | undefined): ComputerSnapshot {
  if (!row) return IDLE_COMPUTER;
  const agent = row.holderAgent as { name?: unknown } | null | undefined;
  return {
    state: oneOf(computerStates, row.state, "stopped"),
    agentId: str(row.holderRun) ? rel(row.holderAgent) : null,
    agentName: str(row.holderRun) && agent && typeof agent.name === "string" ? agent.name : null,
    activity: str(row.activity),
    url: str(row.url),
    pageTitle: str(row.pageTitle),
    since: str(row.holderSince),
    error: str(row.error),
  };
}

/** Normalises a capability name ("Voice generation" → "voice_generation") so remembered choices match. */
export const capabilityKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80);

/** Workspace folder on the cloud computer where agents keep files. */
export const COMPUTER_WORKSPACE = "/root/creator-city";
