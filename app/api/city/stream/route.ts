import { jobsConfig } from "@/lib/ai/env";
import { nudgeHeadquartersQueue, sweepStaleTasks } from "@/lib/ai/task-runner";
import { checkDueWaits } from "@/lib/ai/wait-checker";
import { computersEnabled } from "@/lib/computer/client";
import { STALE_MS, syncComputerState } from "@/lib/computer/computer";
import { computerSnapshot, listPendingRequests } from "@/lib/computer/store";
import { listAgents } from "@/lib/agents";
import { listTaskArtifacts } from "@/lib/artifacts";
import { getCurrentUser } from "@/lib/auth/session";
import { findHeadquarters } from "@/lib/headquarters";
import { headquartersQueue, threadSignatures } from "@/lib/runtime-store";
import { isTaskFinished } from "@/lib/task-records";
import { HEADQUARTERS_THREAD, type CitySnapshot } from "@/lib/city-live";

// Live city status as Server-Sent Events: every agent's status/progress/activity, the current headquarters task
// with its plan and the requests queued behind it, and each chat's current thread. Sends a snapshot whenever
// something changed. The browser's EventSource reconnects on its own.

export const maxDuration = 300;

const POLL_MS = 1500;
const HEARTBEAT_MS = 15_000;
const SWEEP_MS = 60_000;
/** How often to check CloudHike for a computer that stopped itself after idling. */
const COMPUTER_SYNC_MS = 20_000;
/** Close after a while; EventSource reconnects, which re-checks the session. */
const LIFETIME_MS = 4 * 60_000;

export async function GET(request: Request) {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return new Response("Signed out", { status: 401 });
  const hq = await findHeadquarters(sessionUser.email);
  if (!hq) return new Response("No headquarters", { status: 403 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => { if (!closed) { closed = true; try { controller.close(); } catch { /* closed */ } } };
      request.signal.addEventListener("abort", close);
      const write = (chunk: string) => { if (!closed) try { controller.enqueue(encoder.encode(chunk)); } catch { close(); } };

      const started = Date.now();
      let last = "", lastWrite = Date.now(), lastSweep = 0, lastSync = 0;
      const computers = computersEnabled();
      write("retry: 3000\n\n");
      while (!closed && Date.now() - started < LIFETIME_MS) {
        try {
          if (Date.now() - lastSweep > SWEEP_MS) {
            lastSweep = Date.now();
            await sweepStaleTasks(hq);
            // Restarts a headquarters queue left waiting by a crash or a lost job run.
            await nudgeHeadquartersQueue(hq);
            // Without CloudHike Jobs (local development) nothing else checks pages agents wait on: do it while the city is open.
            if (computers && !jobsConfig()) void checkDueWaits({ hqId: hq.documentId, budgetMs: 4 * 60_000 }).catch((e: unknown) => console.error("[city-stream] wait check failed", e));
          }
          if (computers && Date.now() - lastSync > COMPUTER_SYNC_MS) { lastSync = Date.now(); await syncComputerState(hq.documentId).catch(() => undefined); }
          const [agents, { current: task, others, waiting }, computer, requests, threads] = await Promise.all([
            listAgents(hq), headquartersQueue(hq),
            // These collections are optional: without them the city simply shows no computer or requests.
            computers ? computerSnapshot(hq.documentId, STALE_MS).catch(() => null) : null,
            listPendingRequests(hq.documentId).catch(() => []),
            threadSignatures(hq, HEADQUARTERS_THREAD).catch(() => ({})),
          ]);
          // While headquarters works, show what its agents have delivered so far.
          const artifacts = task && !isTaskFinished(task.status) ? await listTaskArtifacts(hq, task.documentId).catch(() => []) : [];
          const snapshot: CitySnapshot = {
            computer, requests,
            agents: agents.map(({ documentId, status, progress, activity }) => ({ documentId, status, progress, activity })),
            task: task && {
              documentId: task.documentId, title: task.title, status: task.status, progress: task.progress, activity: task.activity,
              plan: task.plan, error: task.error, finishedAt: task.finishedAt, conversationId: task.conversationId, artifacts,
            },
            others: others.map(({ documentId, title, progress, activity }) => ({ documentId, title, progress, activity })),
            queue: waiting.map(({ documentId, title, createdAt }) => ({ documentId, title, createdAt })),
            threads,
          };
          const json = JSON.stringify(snapshot);
          if (json !== last) { last = json; lastWrite = Date.now(); write(`data: ${json}\n\n`); }
          else if (Date.now() - lastWrite > HEARTBEAT_MS) { lastWrite = Date.now(); write(": heartbeat\n\n"); }
        } catch (error) {
          console.error("[city-stream]", error);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
