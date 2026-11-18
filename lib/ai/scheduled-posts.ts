import { findConnection, syncConnection } from "@/lib/composio/connections";
import { claimPost, hasScheduledPosts, listDuePosts, updatePost, type DuePost } from "@/lib/composio/posts";
import { runPublishingCall } from "@/lib/composio/publishing";
import { getAppTool } from "@/lib/composio/tools";
import { agentCanUse, findResultUrl, toolPolicy } from "@/lib/connection-records";
import { storedResult } from "./app-tools";
import { pausePostSchedule } from "./jobs";

// Publishes posts agents scheduled on connected accounts (schedule_app_tool), called by the CloudHike Jobs schedule.
// Each post runs only if, at publish time, its account is still connected and still allows posting, and (when an agent
// scheduled it) is still shared with that agent. The user approved the post when it was scheduled.

/**
 * Publishes one claimed post (status `publishing`) with its account. Used by the schedule and by "Publish now".
 * A post the user scheduled or published themselves doesn't need the drafting agent to still have access.
 */
export async function publishPost(post: DuePost): Promise<"published" | "failed"> {
  const fail = async (error: string) => { await updatePost(post.documentId, { status: "failed", error }); return "failed" as const; };
  if (!post.connectionId) return fail("The account this was scheduled on was disconnected.");
  const row = await findConnection(post.hqId, post.connectionId);
  if (!row) return fail("The account this was scheduled on was disconnected.");
  const connection = { ...(await syncConnection(post.hqId, row)), composioUserId: row.composioUserId };
  if (connection.status !== "active") return fail(`${connection.toolkitName} is ${connection.status}. Reconnect it on the Accounts page.`);
  if (!post.toolSlug) return fail("This draft isn't prepared for publishing yet.");
  if (post.agentId && !post.userScheduled && !agentCanUse(connection, post.agentId)) return fail(`The agent that scheduled this no longer has access to ${connection.toolkitName}.`);
  const tool = await getAppTool(post.toolSlug);
  if (!tool) return fail(`Composio no longer has the tool ${post.toolSlug}.`);
  const policy = toolPolicy(connection, tool.effect);
  if (!policy.allowed) return fail(policy.reason);

  const result = await runPublishingCall({ ...tool, version: post.toolVersion ?? tool.version }, connection, post.arguments);
  if (!result.successful) return fail(result.error ?? "The app refused the post.");
  await updatePost(post.documentId, {
    status: "published", publishedAt: new Date().toISOString(), url: findResultUrl(result.data), result: storedResult(result.data), error: null,
  });
  return "published";
}

/** Publishes every due post within the time budget, then pauses the schedule when nothing is left. */
export async function publishDuePosts({ budgetMs }: { budgetMs: number }) {
  const started = Date.now();
  const summary = { published: 0, failed: 0, skipped: 0 };
  for (const post of await listDuePosts()) {
    if (Date.now() - started > budgetMs) { summary.skipped++; continue; }
    if (!(await claimPost(post.documentId))) continue;
    try {
      summary[await publishPost(post)]++;
    } catch (error) {
      summary.failed++;
      await updatePost(post.documentId, { status: "failed", error: error instanceof Error ? error.message : "Publishing failed." }).catch(() => undefined);
    }
  }
  if (!(await hasScheduledPosts().catch(() => true))) await pausePostSchedule();
  return summary;
}
