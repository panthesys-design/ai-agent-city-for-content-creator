import { continueQueueAfter, executeTask, taskTimeLimitSeconds } from "@/lib/ai/task-runner";
import { verifyJobSignature } from "@/lib/ai/jobs";

// Called by a CloudHike Jobs worker to run one queued agent task. Only signed requests are accepted, and a task
// runs at most once even if the job is delivered twice (see claimTask).

export const maxDuration = 800;

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyJobSignature(raw, request.headers.get("x-cloudhike-signature"))) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  let taskId: unknown, waitId: unknown;
  try {
    ({ taskId, waitId } = JSON.parse(raw) as { taskId?: unknown; waitId?: unknown });
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }
  const id = /^[a-z0-9]{8,64}$/i;
  if (typeof taskId !== "string" || !id.test(taskId)) return Response.json({ error: "bad task id" }, { status: 400 });
  if (waitId != null && (typeof waitId !== "string" || !id.test(waitId))) return Response.json({ error: "bad wait id" }, { status: 400 });

  // With waitId, the task continues after waiting for a website (see lib/ai/wait-checker.ts).
  const result = await executeTask(taskId, { timeLimitSeconds: taskTimeLimitSeconds(true), waitId: waitId ?? null });
  // A finished headquarters request frees the queue: dispatch the next one.
  if (!result.skipped) await continueQueueAfter(taskId).catch((error: unknown) => console.error("[jobs] couldn't start the next queued task", error));
  // The task's own record holds the outcome; a 2xx tells CloudHike not to retry.
  return Response.json({ taskId: result.taskId, status: result.status, skipped: result.skipped ?? false, waiting: result.waiting ?? false, error: result.error ?? null });
}
