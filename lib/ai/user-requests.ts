import type { AgentRequest } from "@/lib/computer-records";
import { createRequest, getRequest, settleRequest, type NewRequest } from "@/lib/computer/store";
import type { CityRunContext } from "./context";
import { pauseRunClocks } from "./run-clock";

// An agent asking its user for something mid-run: sign in on the cloud computer, solve a captcha, or pick an
// option. The request is saved to Strapi (so the city shows it at once, from any server), the building shows
// "Needs you", and the tool waits until the user answers. Time spent waiting doesn't count against the run's
// time limit. The run continues automatically as soon as the request is resolved.

const POLL_MS = 2000;
const DETECT_MS = 5000;
const HEARTBEAT_MS = 30_000;

/** How long an agent waits for the user before giving up (COMPUTER_USER_WAIT_SECONDS, default 10 minutes). */
export function userWaitSeconds(): number {
  return Math.min(3600, Math.max(60, Number(process.env.COMPUTER_USER_WAIT_SECONDS) || 600));
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener("abort", onAbort, { once: true });
});

export type AskOptions = {
  /** Checked every few seconds; returning true resolves the request without the user clicking Done. */
  detect?: () => Promise<boolean>;
  /** Called every 30 seconds while waiting, e.g. to keep a computer lease alive. */
  onTick?: () => Promise<void>;
};

/** Saves a request for the user and waits for the answer. Returns the settled request. */
export async function askUser(context: CityRunContext, request: Omit<NewRequest, "expiresAt" | "agentId" | "taskId">, options: AskOptions = {}): Promise<AgentRequest> {
  const expiresAt = new Date(Date.now() + userWaitSeconds() * 1000).toISOString();
  const saved = await createRequest(context.hq.documentId, { ...request, expiresAt, agentId: context.agentId, taskId: context.taskId });
  const resume = pauseRunClocks();
  await context.setStatus?.("waiting", `Needs you: ${request.title}`).catch(() => undefined);
  try {
    return await waitFor(context, saved, options);
  } finally {
    resume();
    if (!context.signal.aborted) await context.setStatus?.("working", "Continuing the task").catch(() => undefined);
  }
}

async function waitFor(context: CityRunContext, request: AgentRequest, { detect, onTick }: AskOptions): Promise<AgentRequest> {
  const deadline = Date.parse(request.expiresAt ?? "") || Date.now() + userWaitSeconds() * 1000;
  let lastDetect = Date.now(), lastTick = Date.now();
  try {
    for (;;) {
      await sleep(POLL_MS, context.signal);
      const latest = await getRequest(request.documentId);
      if (!latest) return { ...request, status: "cancelled" };
      if (latest.status !== "pending") return latest;
      if (Date.now() > deadline) {
        await settleRequest(request.documentId, "expired");
        return { ...latest, status: "expired" };
      }
      if (detect && Date.now() - lastDetect > DETECT_MS) {
        lastDetect = Date.now();
        if (await detect().catch(() => false)) {
          const response = { done: true, detected: true };
          await settleRequest(request.documentId, "resolved", response);
          return { ...latest, status: "resolved", response };
        }
      }
      if (Date.now() - lastTick > HEARTBEAT_MS) {
        lastTick = Date.now();
        // Keeps the task fresh, so the stale-task sweep doesn't fail it while the user is busy.
        await Promise.all([onTick?.(), context.report({})]).catch(() => undefined);
      }
    }
  } catch (error) {
    await settleRequest(request.documentId, "cancelled").catch(() => undefined);
    throw error;
  }
}
