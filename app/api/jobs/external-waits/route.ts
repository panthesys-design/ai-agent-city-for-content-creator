import { WAIT_CHECK_TIMEOUT_SECONDS, verifyJobSignature } from "@/lib/ai/jobs";
import { checkDueWaits } from "@/lib/ai/wait-checker";

// Called by the CloudHike Jobs schedule (every 5 minutes by default, WAIT_CHECK_CRON) while agents wait for a
// website (wait_for_external). Checks each due page with the cloud computer, without a model, and resumes the
// tasks that are ready. Only signed requests are accepted. The schedule is paused once nothing waits.

export const maxDuration = 300;

/** Stop starting new checks with this much time left, so the answer reaches CloudHike before it gives up. */
const MARGIN_MS = 40_000;

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyJobSignature(raw, request.headers.get("x-cloudhike-signature"))) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  const summary = await checkDueWaits({ budgetMs: WAIT_CHECK_TIMEOUT_SECONDS * 1000 - MARGIN_MS });
  return Response.json(summary);
}
