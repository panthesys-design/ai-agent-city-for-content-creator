import { verifyJobSignature, type JobRun } from "@/lib/ai/jobs";
import { settleFailedJob } from "@/lib/ai/task-runner";
import { findTaskByJobRun } from "@/lib/runtime-store";

// CloudHike Jobs posts every finished run here. A run that failed, timed out, or was cancelled before the task
// recorded its own outcome leaves the task running; this marks it failed and frees the agents' buildings.

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyJobSignature(raw, request.headers.get("x-cloudhike-signature"))) {
    return new Response("bad signature", { status: 401 });
  }
  let run: JobRun;
  try {
    run = JSON.parse(raw) as JobRun;
  } catch {
    return new Response("bad body", { status: 400 });
  }
  if (run.status === "succeeded" || typeof run.id !== "string") return new Response("ok");

  const found = await findTaskByJobRun(run.id);
  if (found) {
    const reason = run.status === "cancelled" ? "The background run was cancelled." : `The background run failed: ${run.error ?? "no answer from the agent runner"}`;
    await settleFailedJob(found.headquartersId, found.task, reason);
  }
  return new Response("ok");
}
