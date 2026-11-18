// Server-only client for CloudHike.dev Cloud Computer (https://cloudhike.dev/docs/computers).
// Each headquarters (one per user) gets its own computer: its id is the CloudHike `userId`, so a computer's files
// and browser sign-ins are never shared between users. COMPUTERS_API_KEY never leaves the server.

const trimSlash = (url: string) => url.replace(/\/$/, "");

export function computersConfig(): { apiUrl: string; apiKey: string; size: "basic" | "medium" | "large" } | null {
  const apiUrl = process.env.COMPUTERS_API_URL;
  const apiKey = process.env.COMPUTERS_API_KEY;
  if (!apiUrl || !apiKey) return null;
  const size = process.env.COMPUTER_SIZE === "medium" || process.env.COMPUTER_SIZE === "large" ? process.env.COMPUTER_SIZE : "basic";
  return { apiUrl: trimSlash(apiUrl), apiKey, size };
}

export const computersEnabled = () => computersConfig() !== null;

export class ComputerApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ComputerApiError"; }
}

export type CloudComputer = {
  id: string;
  userId: string | null;
  state: "creating" | "running" | "stopping" | "stopped" | "archived" | "error";
  error: string | null;
};

async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const config = computersConfig();
  if (!config) throw new ComputerApiError("The cloud computer is not configured. Set COMPUTERS_API_URL and COMPUTERS_API_KEY.", 503);
  const signal = AbortSignal.any([AbortSignal.timeout(init.timeoutMs ?? 120_000), ...(init.signal ? [init.signal] : [])]);
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal,
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) {
    const message = body?.error?.message ?? res.statusText;
    if (res.status === 402) throw new ComputerApiError(`The cloud computer can't start: ${message} (out of credits or past the monthly computer allowance).`, 402);
    if (res.status === 403) throw new ComputerApiError(`The cloud computer can't start: ${message}`, 403);
    throw new ComputerApiError(`Cloud computer request failed (${res.status}): ${message}`, res.status);
  }
  return body as T;
}

/** Creates and starts this headquarters' computer, or starts the one it has. */
export function ensureCloudComputer(headquartersId: string, signal?: AbortSignal) {
  const config = computersConfig();
  return api<CloudComputer>("/computers", { body: { userId: `hq-${headquartersId}`, name: `Creator City ${headquartersId.slice(0, 8)}`, size: config?.size ?? "basic" }, signal });
}

/** The headquarters' computer if it was ever created, without starting it. */
export async function findCloudComputer(headquartersId: string): Promise<CloudComputer | null> {
  const list = await api<CloudComputer[] | { computers?: CloudComputer[]; data?: CloudComputer[] }>(`/computers?userId=${encodeURIComponent(`hq-${headquartersId}`)}`);
  const computers = Array.isArray(list) ? list : list.computers ?? list.data ?? [];
  return computers[0] ?? null;
}

export const getCloudComputer = (id: string) => api<CloudComputer>(`/computers/${id}`);
export const stopCloudComputer = (id: string) => api<CloudComputer>(`/computers/${id}/stop`, { body: {} });
export const disconnectViewers = (id: string) => api<unknown>(`/computers/${id}/disconnect`, { body: {} });

/** A link to the live screen (noVNC), valid for an hour. `viewOnly` lets the user watch without taking over. */
export async function previewLink(id: string, viewOnly: boolean): Promise<{ url: string; expiresIn: number | null }> {
  const result = await api<{ url: string; expiresIn?: number }>(`/computers/${id}/preview`, { body: { viewOnly } });
  return { url: result.url, expiresIn: typeof result.expiresIn === "number" ? result.expiresIn : null };
}

export type ComputerAction =
  | { type: "screenshot" }
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "move"; x: number; y: number }
  | { type: "drag"; x: number; y: number; toX: number; toY: number }
  | { type: "scroll"; x: number; y: number; direction: "up" | "down" | "left" | "right"; amount?: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string; modifiers?: string[] }
  | { type: "hotkey"; keys: string }
  | { type: "exec"; command: string; timeout?: number };

export type ScreenshotResult = { image: string; mime: string; cursor?: { x: number; y: number } };
export type ExecResult = { exitCode: number; output: string };

/** CloudHike runs one exec command for at most this many seconds (it refuses larger timeouts). */
export const EXEC_TIMEOUT_MAX = 120;
/** Commands longer than this are refused by CloudHike, so larger payloads are written in chunks. */
export const EXEC_COMMAND_LIMIT = 10_000;
/** CloudHike returns at most this much exec output. */
export const EXEC_OUTPUT_LIMIT = 100_000;

export function act(id: string, action: { type: "screenshot" }, signal?: AbortSignal): Promise<ScreenshotResult>;
export function act(id: string, action: { type: "exec"; command: string; timeout?: number }, signal?: AbortSignal): Promise<ExecResult>;
export function act(id: string, action: ComputerAction, signal?: AbortSignal): Promise<unknown>;
export function act(id: string, action: ComputerAction, signal?: AbortSignal): Promise<unknown> {
  if (action.type === "exec" && action.command.length > EXEC_COMMAND_LIMIT) {
    return Promise.reject(new ComputerApiError(`Command is too long (${action.command.length} characters; the limit is ${EXEC_COMMAND_LIMIT}).`, 400));
  }
  const timeoutMs = action.type === "exec" ? ((action.timeout ?? 60) + 30) * 1000 : 60_000;
  return api(`/computers/${id}/actions`, { body: action, signal, timeoutMs });
}
