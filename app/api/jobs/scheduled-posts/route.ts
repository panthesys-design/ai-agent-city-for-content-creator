import { POST_PUBLISH_TIMEOUT_SECONDS, verifyJobSignature } from "@/lib/ai/jobs";
import { publishDuePosts } from "@/lib/ai/scheduled-posts";

// Called by the CloudHike Jobs schedule (every 5 minutes by default, POST_PUBLISH_CRON) while posts that agents
// scheduled on connected accounts are waiting. Publishes the due ones. Only signed requests are accepted; the
// schedule is paused once nothing is scheduled.

export const maxDuration = 300;

const MARGIN_MS = 40_000;

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyJobSignature(raw, request.headers.get("x-cloudhike-signature"))) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  const summary = await publishDuePosts({ budgetMs: POST_PUBLISH_TIMEOUT_SECONDS * 1000 - MARGIN_MS });
  return Response.json(summary);
}
