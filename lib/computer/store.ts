import {
  computerFromStrapi, requestFromStrapi,
  type AgentRequest, type ComputerSnapshot, type ComputerState, type RequestKind, type RequestOption, type RequestResponse,
} from "@/lib/computer-records";
import { strapi } from "@/lib/strapi";

// Server-only persistence in Strapi for the cloud computer: `computer-sessions` (one per headquarters: state and
// which agent holds it) and `agent-requests` (what agents need from the user). Every query filters by headquarters.

type Row = Record<string, unknown>;
type One = { data: Row };
type Many = { data: Row[] };

const connect = (documentId: string) => ({ connect: [documentId] });

// ---------- Computer session ----------

export type SessionRow = {
  documentId: string;
  computerId: string | null;
  state: ComputerState;
  holderRun: string | null;
  holderAgentId: string | null;
  heartbeatAt: string | null;
  userActiveAt: string | null;
  snapshot: ComputerSnapshot;
};

const SESSION_POPULATE = { "populate[holderAgent][fields][0]": "name", "populate[holderTask][fields][0]": "documentId" };

function sessionFrom(row: Row): SessionRow {
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const agent = row.holderAgent as { documentId?: string } | null | undefined;
  return {
    documentId: String(row.documentId),
    computerId: str(row.computerId),
    state: computerFromStrapi(row).state,
    holderRun: str(row.holderRun),
    holderAgentId: agent?.documentId ?? null,
    heartbeatAt: str(row.heartbeatAt),
    userActiveAt: str(row.userActiveAt),
    snapshot: computerFromStrapi(row),
  };
}

export async function findSession(hqId: string): Promise<SessionRow | null> {
  const query = new URLSearchParams({ ...SESSION_POPULATE, "filters[headquarter][documentId][$eq]": hqId, "sort[0]": "createdAt:asc", "pagination[pageSize]": "1" });
  const { data } = await strapi<Many>(`/computer-sessions?${query}`);
  return data[0] ? sessionFrom(data[0]) : null;
}

/** The headquarters' session record, created on first use. */
export async function getOrCreateSession(hqId: string): Promise<SessionRow> {
  const existing = await findSession(hqId);
  if (existing) return existing;
  const { data } = await strapi<One>(`/computer-sessions?${new URLSearchParams(SESSION_POPULATE)}`, {
    method: "POST", body: JSON.stringify({ data: { state: "stopped", headquarter: connect(hqId) } }),
  });
  return sessionFrom(data);
}

export type SessionPatch = Partial<{
  computerId: string | null; state: ComputerState; holderRun: string | null; holderAgent: string | null; holderTask: string | null;
  holderSince: string | null; heartbeatAt: string | null; userActiveAt: string | null; activity: string | null; url: string | null;
  pageTitle: string | null; error: string | null;
}>;

export async function updateSession(documentId: string, patch: SessionPatch): Promise<void> {
  const data: Row = { ...patch };
  if ("holderAgent" in patch) data.holderAgent = patch.holderAgent ? { set: [patch.holderAgent] } : { set: [] };
  if ("holderTask" in patch) data.holderTask = patch.holderTask ? { set: [patch.holderTask] } : { set: [] };
  if (typeof patch.activity === "string") data.activity = patch.activity.slice(0, 160);
  if (typeof patch.pageTitle === "string") data.pageTitle = patch.pageTitle.slice(0, 200);
  if (typeof patch.url === "string") data.url = patch.url.slice(0, 2000);
  await strapi(`/computer-sessions/${documentId}`, { method: "PUT", body: JSON.stringify({ data }) });
}

/** What the city shows; a stale holder (no heartbeat for a while) is shown as nobody. */
export async function computerSnapshot(hqId: string, staleAfterMs: number): Promise<ComputerSnapshot | null> {
  const session = await findSession(hqId);
  if (!session) return null;
  const stale = session.holderRun && (!session.heartbeatAt || Date.now() - Date.parse(session.heartbeatAt) > staleAfterMs);
  return stale ? { ...session.snapshot, agentId: null, agentName: null, activity: null } : session.snapshot;
}

// ---------- Agent requests ----------

const REQUEST_POPULATE = { "populate[agent][fields][0]": "name", "populate[task][fields][0]": "documentId" };

export type NewRequest = {
  kind: RequestKind;
  title: string;
  message?: string | null;
  url?: string | null;
  service?: string | null;
  capability?: string | null;
  options?: RequestOption[];
  allowOther?: boolean;
  agentId?: string | null;
  taskId?: string | null;
  expiresAt: string;
};

export async function createRequest(hqId: string, request: NewRequest): Promise<AgentRequest> {
  const { data } = await strapi<One>(`/agent-requests?${new URLSearchParams(REQUEST_POPULATE)}`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        kind: request.kind, status: "pending", title: request.title.slice(0, 160), message: request.message ?? null,
        url: request.url ?? null, service: request.service?.slice(0, 80) ?? null, capability: request.capability?.slice(0, 80) ?? null,
        options: request.options ?? null, allowOther: request.allowOther ?? false, expiresAt: request.expiresAt,
        headquarter: connect(hqId),
        ...(request.agentId ? { agent: connect(request.agentId) } : {}),
        ...(request.taskId ? { task: connect(request.taskId) } : {}),
      },
    }),
  });
  return requestFromStrapi(data);
}

export async function getRequest(documentId: string): Promise<AgentRequest | null> {
  try {
    const { data } = await strapi<One>(`/agent-requests/${documentId}?${new URLSearchParams(REQUEST_POPULATE)}`);
    return requestFromStrapi(data);
  } catch {
    return null;
  }
}

/** The request if it belongs to the headquarters. */
export async function findOwnedRequest(hqId: string, documentId: string): Promise<AgentRequest | null> {
  const query = new URLSearchParams({
    ...REQUEST_POPULATE, "filters[documentId][$eq]": documentId, "filters[headquarter][documentId][$eq]": hqId, "pagination[pageSize]": "1",
  });
  const { data } = await strapi<Many>(`/agent-requests?${query}`);
  return data[0] ? requestFromStrapi(data[0]) : null;
}

/** Requests still waiting for the user, oldest first. */
export async function listPendingRequests(hqId: string): Promise<AgentRequest[]> {
  const query = new URLSearchParams({
    ...REQUEST_POPULATE,
    "filters[headquarter][documentId][$eq]": hqId,
    "filters[status][$eq]": "pending",
    "filters[expiresAt][$gt]": new Date().toISOString(),
    "sort[0]": "createdAt:asc",
    "pagination[pageSize]": "20",
  });
  const { data } = await strapi<Many>(`/agent-requests?${query}`);
  return data.map(requestFromStrapi);
}

export async function settleRequest(documentId: string, status: "resolved" | "cancelled" | "expired", response: RequestResponse | null = null): Promise<void> {
  await strapi(`/agent-requests/${documentId}`, {
    method: "PUT", body: JSON.stringify({ data: { status, response, resolvedAt: new Date().toISOString() } }),
  });
}

/** The choice the user made last time for this capability (e.g. which voice service), if any. */
export async function rememberedChoice(hqId: string, capability: string): Promise<AgentRequest | null> {
  const query = new URLSearchParams({
    ...REQUEST_POPULATE,
    "filters[headquarter][documentId][$eq]": hqId,
    "filters[kind][$eq]": "choice",
    "filters[status][$eq]": "resolved",
    "filters[capability][$eq]": capability,
    "sort[0]": "resolvedAt:desc",
    "pagination[pageSize]": "1",
  });
  const { data } = await strapi<Many>(`/agent-requests?${query}`);
  return data[0] ? requestFromStrapi(data[0]) : null;
}

/** Cancels requests a finished or stopped run left open, so they disappear from the city. */
export async function cancelOpenRequests(hqId: string, taskId: string): Promise<void> {
  const query = new URLSearchParams({
    "filters[headquarter][documentId][$eq]": hqId, "filters[task][documentId][$eq]": taskId, "filters[status][$eq]": "pending", "pagination[pageSize]": "20",
  });
  const { data } = await strapi<Many>(`/agent-requests?${query}`);
  await Promise.all(data.map((row) => settleRequest(String(row.documentId), "cancelled")));
}
