import { randomUUID } from "node:crypto";
import { COMPUTER_WORKSPACE } from "@/lib/computer-records";
import { BROWSER_SCRIPT, BROWSER_SCRIPT_VERSION } from "./browser-script";
import {
  ComputerApiError, EXEC_COMMAND_LIMIT, EXEC_TIMEOUT_MAX, act, ensureCloudComputer, findCloudComputer, getCloudComputer, stopCloudComputer,
  type ComputerAction, type ExecResult, type ScreenshotResult,
} from "./client";
import { findSession, getOrCreateSession, updateSession, type SessionPatch } from "./store";

// The lifecycle of a headquarters' cloud computer, shared by all its agents:
//
// - An agent run leases the computer the first time one of its computer tools runs (`acquireComputer`). The lease
//   starts the computer if it is off, installs the browser helper, and marks the agent as the one using it.
// - One agent uses the screen at a time. Others wait for the lease (up to WAIT_MAX_MS), shown in the city as
//   "Waiting for the computer".
// - When the run ends, `releaseComputer` frees the lease and stops the computer (closing Chrome cleanly first so
//   sign-ins are written to disk), unless another run in this server is waiting for it or the user opened it
//   recently. CloudHike also stops a computer by itself after a few idle minutes, as a backstop.
// - A lease without a heartbeat for STALE_MS (a crashed server) is treated as free.

export const STALE_MS = 2 * 60_000;
const WAIT_MAX_MS = 5 * 60_000;
const POLL_MS = 2500;
const START_TIMEOUT_MS = 150_000;
/** If the user opened the computer within this window, a finished agent leaves it running for them. */
const USER_GRACE_MS = 5 * 60_000;

const HELPER_DIR = "/root/.creator-city";
const HELPER = `${HELPER_DIR}/cc_browser.py`;
const HELPER_VERSION_FILE = `${HELPER_DIR}/cc_browser.version`;

export type ComputerOwner = { hqId: string; agentId: string | null; agentName: string; taskId: string | null };

export type ComputerLease = ComputerOwner & { runId: string; sessionId: string; computerId: string };

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
  signal?.addEventListener("abort", onAbort, { once: true });
});

/** Serialises claims per headquarters in this process, so parallel steps can't both take a free computer. */
const claimTails = new Map<string, Promise<unknown>>();
function serialise<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (claimTails.get(key) ?? Promise.resolve()).then(fn, fn);
  claimTails.set(key, next.catch(() => undefined));
  return next;
}

/** Runs in this process that are waiting for or about to use each headquarters' computer. */
const waiters = new Map<string, number>();
const addWaiter = (hq: string, delta: number) => waiters.set(hq, Math.max(0, (waiters.get(hq) ?? 0) + delta));

/** Computers that already have the current helper, so it is checked once per computer per server. */
const helperInstalled = new Map<string, string>();

const fresh = (iso: string | null) => Boolean(iso && Date.now() - Date.parse(iso) < STALE_MS);
const now = () => new Date().toISOString();

async function waitUntilRunning(computerId: string, signal: AbortSignal) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    const computer = await getCloudComputer(computerId);
    if (computer.state === "running") return;
    if (computer.state === "error") throw new Error(`The cloud computer failed to start${computer.error ? `: ${computer.error}` : "."}`);
    if (Date.now() > deadline) throw new Error("The cloud computer took too long to start. Try again in a minute.");
    await sleep(2000, signal);
  }
}

/** Starts the computer (or returns the running one) and waits until it is ready. */
async function startComputer(hqId: string, signal: AbortSignal): Promise<string> {
  const computer = await ensureCloudComputer(hqId, signal);
  if (computer.state !== "running") await waitUntilRunning(computer.id, signal);
  return computer.id;
}

/**
 * Leases the computer for one agent run: waits while another agent uses it, then starts it if needed.
 * `onWait` is called while waiting, with the name of the agent using it.
 */
export async function acquireComputer(owner: ComputerOwner, { signal, onWait }: { signal: AbortSignal; onWait?: (holder: string) => Promise<void> | void }): Promise<ComputerLease> {
  const runId = randomUUID();
  const deadline = Date.now() + WAIT_MAX_MS;
  addWaiter(owner.hqId, 1);
  let sessionId = "";
  try {
    for (;;) {
      signal.throwIfAborted();
      const claim = await serialise(owner.hqId, async () => {
        const session = await getOrCreateSession(owner.hqId);
        if (session.holderRun && session.holderRun !== runId && fresh(session.heartbeatAt)) return { ok: false, busy: session.snapshot.agentName ?? "another agent" } as const;
        await updateSession(session.documentId, {
          holderRun: runId, holderAgent: owner.agentId, holderTask: owner.taskId, holderSince: now(), heartbeatAt: now(),
          activity: session.state === "running" ? "Using the computer" : "Starting the computer", error: null,
          ...(session.state === "running" ? {} : { state: "starting" as const }),
        });
        return { ok: true, sessionId: session.documentId } as const;
      });
      if (claim.ok) {
        // Another server may have claimed it at the same moment; the last write wins, so check before using it.
        const check = await findSession(owner.hqId);
        if (check?.holderRun === runId) { sessionId = claim.sessionId; break; }
        continue;
      }
      if (Date.now() > deadline) throw new Error(`The cloud computer is busy: ${claim.busy} has been using it for a while. Try again later, or finish the task without it.`);
      await onWait?.(claim.busy);
      await sleep(POLL_MS, signal);
    }
  } finally {
    addWaiter(owner.hqId, -1);
  }

  try {
    const computerId = await startComputer(owner.hqId, signal);
    const lease: ComputerLease = { ...owner, runId, sessionId, computerId };
    await installHelper(lease, signal);
    await updateSession(sessionId, { computerId, state: "running", heartbeatAt: now(), activity: "Using the computer" });
    return lease;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The cloud computer could not start.";
    const free = { holderRun: null, holderAgent: null, holderTask: null, holderSince: null, activity: null };
    if (signal.aborted) {
      // The run was stopped while the computer was starting: it may still boot, so stop it instead of leaving it on.
      await updateSession(sessionId, { ...free, error: null }).catch(() => undefined);
      await stopIfIdle(owner.hqId).catch(() => undefined);
    } else {
      await updateSession(sessionId, { ...free, state: "error", error: message.slice(0, 500) }).catch(() => undefined);
    }
    throw error;
  }
}

/** Stops the headquarters' computer when nobody holds it (after an aborted start, where no lease exists yet). */
async function stopIfIdle(hqId: string): Promise<void> {
  if ((waiters.get(hqId) ?? 0) > 0) return;
  const session = await findSession(hqId);
  if (!session || (session.holderRun && fresh(session.heartbeatAt))) return;
  if (session.userActiveAt && Date.now() - Date.parse(session.userActiveAt) < USER_GRACE_MS) return;
  const computer = session.computerId ? { id: session.computerId } : await findCloudComputer(hqId);
  if (!computer) return;
  await stopCloudComputer(computer.id).catch(() => undefined);
  await updateSession(session.documentId, { state: "stopped", activity: null });
}

/** Records what the agent is doing on the computer; also keeps the lease alive. */
export async function touchComputer(lease: ComputerLease, patch: Pick<SessionPatch, "activity" | "url" | "pageTitle"> = {}): Promise<void> {
  await updateSession(lease.sessionId, { heartbeatAt: now(), ...patch }).catch((error: unknown) => {
    console.warn("[computer] couldn't update the session:", error instanceof Error ? error.message : error);
  });
}

/**
 * Ends a run's lease and shuts the computer down, unless another run here is about to use it or the user opened
 * it in the last few minutes. Never throws: a computer left running is stopped by CloudHike when idle.
 */
export async function releaseComputer(lease: ComputerLease, { keepRunning = false } = {}): Promise<void> {
  try {
    const session = await findSession(lease.hqId);
    if (!session || session.holderRun !== lease.runId) return;
    await updateSession(session.documentId, { holderRun: null, holderAgent: null, holderTask: null, holderSince: null, activity: null });
    // keepRunning: a run starts right after this one (a resumed task); CloudHike still stops it if nobody comes.
    if (keepRunning || (waiters.get(lease.hqId) ?? 0) > 0) return;
    if (session.userActiveAt && Date.now() - Date.parse(session.userActiveAt) < USER_GRACE_MS) return;
    await shutdownComputer(lease.hqId, lease.computerId);
  } catch (error) {
    console.warn("[computer] release failed; CloudHike will stop the idle computer:", error instanceof Error ? error.message : error);
  }
}

/** Closes Chrome cleanly (so cookies are flushed to disk) and stops the computer, if nobody holds it. */
export async function shutdownComputer(hqId: string, computerId: string): Promise<void> {
  const session = await findSession(hqId);
  if (!session || (session.holderRun && fresh(session.heartbeatAt))) return;
  await updateSession(session.documentId, { state: "stopping", activity: null });
  try {
    await act(computerId, { type: "exec", command: `python3 ${HELPER} shutdown 2>/dev/null || true`, timeout: 20 }).catch(() => undefined);
    // Re-check: an agent may have claimed it while Chrome was closing.
    const latest = await findSession(hqId);
    if (latest?.holderRun && fresh(latest.heartbeatAt)) {
      await updateSession(session.documentId, { state: "running" });
      return;
    }
    await stopCloudComputer(computerId);
    await updateSession(session.documentId, { state: "stopped" });
  } catch (error) {
    await updateSession(session.documentId, { state: "error", error: error instanceof Error ? error.message.slice(0, 500) : "Stopping failed." }).catch(() => undefined);
    throw error;
  }
}

// ---------- The user's own use ----------

/**
 * Starts the computer for the user (to watch it, sign in ahead of time, or manage files) and opens Chrome with the
 * agents' profile. Marks the user active, so a finishing agent leaves it running for them; CloudHike stops it once
 * nobody uses it. Returns a lease-like handle for file actions; it doesn't take the agents' lease.
 */
export async function openComputerForUser(hqId: string, signal: AbortSignal): Promise<ComputerLease> {
  const session = await getOrCreateSession(hqId);
  if (session.state !== "running") await updateSession(session.documentId, { state: "starting", error: null });
  try {
    const computerId = await startComputer(hqId, signal);
    const lease: ComputerLease = { hqId, agentId: null, agentName: "You", taskId: null, runId: "user", sessionId: session.documentId, computerId };
    await installHelper(lease, signal);
    await updateSession(session.documentId, { computerId, state: "running", userActiveAt: now(), error: null });
    await browserCommand(lease, "tabs", {}, signal).catch(() => undefined); // opens Chrome if it isn't open
    return lease;
  } catch (error) {
    await updateSession(session.documentId, { state: "error", error: error instanceof Error ? error.message.slice(0, 500) : "The computer could not start." }).catch(() => undefined);
    throw error;
  }
}

/** The running computer as a handle for the user's file actions, or null when it is off. */
export async function runningComputer(hqId: string): Promise<ComputerLease | null> {
  const session = await findSession(hqId);
  if (!session?.computerId) return null;
  const computer = await getCloudComputer(session.computerId).catch(() => null);
  if (computer?.state !== "running") return null;
  return { hqId, agentId: null, agentName: "You", taskId: null, runId: "user", sessionId: session.documentId, computerId: session.computerId };
}

export const markUserActive = (sessionId: string) => updateSession(sessionId, { userActiveAt: now() });

/**
 * Brings the saved state in line with CloudHike, which stops idle computers by itself. Called now and then by the
 * live city stream, so a computer that went to sleep doesn't keep showing as on.
 */
export async function syncComputerState(hqId: string): Promise<void> {
  const session = await findSession(hqId);
  if (!session?.computerId || session.state === "stopped") return;
  if (session.holderRun && fresh(session.heartbeatAt)) return;
  const computer = await getCloudComputer(session.computerId).catch(() => null);
  if (!computer) return;
  const state = computer.state === "running" ? "running" : computer.state === "creating" ? "starting" : computer.state === "stopping" ? "stopping" : computer.state === "error" ? "error" : "stopped";
  const patch: SessionPatch = {};
  if (state !== session.state && !(session.state === "starting" && state === "stopped")) patch.state = state;
  if (session.holderRun && !fresh(session.heartbeatAt)) Object.assign(patch, { holderRun: null, holderAgent: null, holderTask: null, holderSince: null, activity: null });
  if (Object.keys(patch).length) await updateSession(session.documentId, patch);
}

// ---------- Actions ----------

const notRunning = (error: unknown) => error instanceof ComputerApiError && (error.status === 409 || /not running|stopped|archived/i.test(error.message));

/** One CloudHike action. If the computer stopped meanwhile (idle timeout), it is started again once. */
export async function computerAction(lease: ComputerLease, action: ComputerAction, signal: AbortSignal): Promise<unknown> {
  try {
    return await act(lease.computerId, action, signal);
  } catch (error) {
    if (!notRunning(error)) throw error;
    lease.computerId = await startComputer(lease.hqId, signal);
    await updateSession(lease.sessionId, { computerId: lease.computerId, state: "running" });
    return act(lease.computerId, action, signal);
  }
}

export const screenshot = (lease: ComputerLease, signal: AbortSignal) => computerAction(lease, { type: "screenshot" }, signal) as Promise<ScreenshotResult>;

/** Runs a shell command. CloudHike allows 1–120 seconds per command; longer values are capped. */
export function exec(lease: ComputerLease, command: string, signal: AbortSignal, timeoutSeconds = 60): Promise<ExecResult> {
  return computerAction(lease, { type: "exec", command, timeout: Math.min(EXEC_TIMEOUT_MAX, Math.max(1, Math.round(timeoutSeconds))) }, signal) as Promise<ExecResult>;
}

/** Single-quotes a value for the shell. */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Base64 characters per write command, leaving room for the rest of the command under the 10,000 limit (a multiple of 4). */
const WRITE_CHUNK = 9000;
/** Chunks sent at once; each is one CloudHike request. */
const PARALLEL = 8;

/** Runs `jobs` with at most `limit` at a time, keeping result order. */
async function pool<T>(count: number, limit: number, job: (index: number) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, count) }, async () => {
    while (next < count) { const i = next++; results[i] = await job(i); }
  }));
  return results;
}
/** Bytes per read command: base64 output stays under CloudHike's 100,000-character output limit. */
const READ_CHUNK = 72_000;

/** Writes bytes to a file on the computer, in chunks small enough for one command each. */
export async function writeComputerFile(lease: ComputerLease, path: string, bytes: Uint8Array, signal: AbortSignal): Promise<void> {
  const b64 = Buffer.from(bytes).toString("base64");
  const tmp = `/tmp/cc-upload-${randomUUID()}`;
  const dir = path.replace(/\/[^/]*$/, "") || "/";
  const chunks = Math.max(1, Math.ceil(b64.length / WRITE_CHUNK));
  // Parts are named so the shell glob sorts them in order (base64 parts of a multiple of 4 concatenate cleanly).
  await pool(chunks, PARALLEL, (i) => expectOk(exec(lease, `printf '%s' '${b64.slice(i * WRITE_CHUNK, (i + 1) * WRITE_CHUNK)}' > ${tmp}.${String(i).padStart(6, "0")}`, signal), "Couldn't write the file"));
  await expectOk(exec(lease, `mkdir -p ${shellQuote(dir)} && cat ${tmp}.* | base64 -d > ${shellQuote(path)}; status=$?; rm -f ${tmp}.*; exit $status`, signal), "Couldn't write the file");
}

/** Reads a file from the computer (up to `maxBytes`). */
export async function readComputerFile(lease: ComputerLease, path: string, signal: AbortSignal, maxBytes = 25 * 1024 * 1024): Promise<Buffer> {
  const size = Number((await expectOk(exec(lease, `stat -c %s ${shellQuote(path)}`, signal), "File not found")).trim());
  if (!Number.isFinite(size)) throw new Error(`Couldn't read ${path}.`);
  if (size > maxBytes) throw new Error(`${path} is ${(size / 1048576).toFixed(1)} MB; the limit is ${(maxBytes / 1048576).toFixed(0)} MB.`);
  const parts = await pool(Math.ceil(size / READ_CHUNK), PARALLEL, async (i) => {
    const script = `import sys,base64;f=open(sys.argv[1],'rb');f.seek(${i * READ_CHUNK});sys.stdout.write(base64.b64encode(f.read(${READ_CHUNK})).decode())`;
    return Buffer.from(await expectOk(exec(lease, `python3 -c ${shellQuote(script)} ${shellQuote(path)}`, signal, 120), "Couldn't read the file"), "base64");
  });
  return Buffer.concat(parts);
}

async function expectOk(result: Promise<ExecResult>, message: string): Promise<string> {
  const { exitCode, output } = await result;
  if (exitCode !== 0) throw new Error(`${message}: ${output.trim().slice(-400) || `exit code ${exitCode}`}`);
  return output;
}

async function installHelper(lease: ComputerLease, signal: AbortSignal) {
  if (helperInstalled.get(lease.computerId) === BROWSER_SCRIPT_VERSION) return;
  const current = await exec(lease, `mkdir -p ${HELPER_DIR} ${COMPUTER_WORKSPACE} && cat ${HELPER_VERSION_FILE} 2>/dev/null`, signal);
  if (current.output.trim() !== BROWSER_SCRIPT_VERSION) {
    await writeComputerFile(lease, HELPER, new TextEncoder().encode(BROWSER_SCRIPT), signal);
    await browserCommand(lease, "setup", {}, signal);
    await expectOk(exec(lease, `printf '%s' ${BROWSER_SCRIPT_VERSION} > ${HELPER_VERSION_FILE}`, signal), "Couldn't install the browser helper");
  }
  helperInstalled.set(lease.computerId, BROWSER_SCRIPT_VERSION);
}

// ---------- Browser ----------

export type BrowserElement = {
  id: number; tag: string; label: string; type?: string; href?: string; value?: string; disabled?: boolean; checked?: boolean; offscreen?: boolean;
};

export type BrowserPage = {
  url: string;
  title: string;
  text?: string;
  textLength?: number;
  offset?: number;
  elements?: BrowserElement[];
  signals?: { loginForm: boolean; captcha: boolean };
  scroll?: { y: number; height: number; viewport: number };
};

/**
 * Browser commands per computer run one after another: they all drive the same Chrome tab, so parallel tool calls
 * (models like to search several things at once) would interrupt each other's page loads. The helper also takes a
 * lock on the computer, which covers other servers.
 */
const browserTails = new Map<string, Promise<unknown>>();

/** The helper stops any command after this long (cc_browser.py HARD_LIMIT); the exec timeout leaves headroom. */
const BROWSER_COMMAND_SECONDS = 75;

export type BrowserQueueOptions = { onQueued?: () => void };

/** Runs one command of the in-computer browser helper (see cc_browser.py) and returns its result. */
export function browserCommand<T = BrowserPage>(lease: ComputerLease, command: string, args: Record<string, unknown>, signal: AbortSignal, options: BrowserQueueOptions = {}): Promise<T> {
  const key = lease.computerId;
  const previous = browserTails.get(key);
  if (previous) options.onQueued?.();
  const run = (previous ?? Promise.resolve()).catch(() => undefined).then(() => {
    signal.throwIfAborted();
    return runBrowserCommand<T>(lease, command, args, signal);
  });
  const tail = run.catch(() => undefined);
  browserTails.set(key, tail);
  void tail.then(() => { if (browserTails.get(key) === tail) browserTails.delete(key); });
  return run;
}

async function runBrowserCommand<T>(lease: ComputerLease, command: string, args: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const encoded = `b64:${Buffer.from(JSON.stringify(args)).toString("base64")}`;
  let argument = encoded;
  if (encoded.length > EXEC_COMMAND_LIMIT - 200) {
    const file = `/tmp/cc-args-${randomUUID()}.json`;
    await writeComputerFile(lease, file, new TextEncoder().encode(encoded), signal);
    argument = `file:${file}`;
  }
  const { output } = await exec(lease, `CC_BROWSER_LIMIT=${BROWSER_COMMAND_SECONDS} python3 ${HELPER} ${command} ${shellQuote(argument)}`, signal, BROWSER_COMMAND_SECONDS + 25);
  const line = output.trim().split("\n").filter(Boolean).at(-1) ?? "";
  let parsed: { ok: boolean; result?: T; error?: string };
  try {
    parsed = JSON.parse(line) as typeof parsed;
  } catch {
    throw new Error(`The browser helper failed: ${output.trim().slice(-400) || "no output"}`);
  }
  if (!parsed.ok) throw new Error(parsed.error ?? "The browser action failed.");
  return parsed.result as T;
}

// ---------- Readiness checks (external waits) ----------

type WaitProbe = { met: boolean; reason: string; page?: { url?: string; title?: string; excerpt?: string } };

export type PageCheck = {
  ready: boolean;
  /** The page asks to sign in (the saved session expired), so nobody can see the result without the user. */
  signin: boolean;
  url: string | null;
  title: string | null;
  excerpt: string | null;
};

/**
 * Checks the current page without a model: ready when `readyText` is on it (if given) and `busyText` is gone (if
 * given). `settleSeconds` gives a freshly opened page time to render, so "busy text is gone" isn't mistaken for a
 * page that simply hasn't loaded yet.
 */
export async function checkPage(lease: ComputerLease, want: { readyText: string | null; busyText: string | null }, signal: AbortSignal, { settleSeconds = 0 } = {}): Promise<PageCheck> {
  let page: WaitProbe["page"] = {};
  let found = true;
  if (want.readyText) {
    const probe = await browserCommand<WaitProbe>(lease, "wait", { text: want.readyText, seconds: Math.max(3, settleSeconds), sinceSeconds: 60, exclude: [] }, signal);
    found = probe.met && probe.reason === "text";
    page = probe.page ?? page;
  } else if (settleSeconds > 0) {
    const probe = await browserCommand<WaitProbe>(lease, "wait", { seconds: settleSeconds, sinceSeconds: 60, exclude: [] }, signal);
    page = probe.page ?? page;
  }
  let gone = true;
  if (found && want.busyText) {
    const probe = await browserCommand<WaitProbe>(lease, "wait", { gone: want.busyText, seconds: 3, sinceSeconds: 60, exclude: [] }, signal);
    gone = probe.met && probe.reason === "gone";
    page = probe.page ?? page;
  }
  const status = await browserCommand<BrowserPage>(lease, "status", {}, signal).catch(() => null);
  const ready = found && gone;
  return {
    ready,
    signin: !ready && Boolean(status?.signals?.loginForm),
    url: status?.url ?? page.url ?? null,
    title: status?.title ?? page.title ?? null,
    excerpt: page.excerpt ?? null,
  };
}
