"use server";

import { ensurePostSchedule } from "@/lib/ai/jobs";
import { jobsConfig } from "@/lib/ai/env";
import { publishPost } from "@/lib/ai/scheduled-posts";
import { getCurrentUser } from "@/lib/auth/session";
import { findConnection } from "@/lib/composio/connections";
import { claimPost, deletePost, findPostForPublishing, updatePost } from "@/lib/composio/posts";
import { getAppTool } from "@/lib/composio/tools";
import { featuredApp, parseMedia, scheduleTimeProblem, toolPolicy, type SocialPost } from "@/lib/connection-records";
import { findHeadquarters } from "@/lib/headquarters";
import { askHeadquartersAction } from "../runtime-actions";

// Server actions for the Post and Calendar pages: publish a draft now, schedule or reschedule it, move it back to
// drafts, edit or delete it, and ask headquarters to prepare one. Every action resolves the signed-in user's
// headquarters and only touches its posts; publishing re-checks the account and its permission on the server.

type Fail = { ok: false; error: string };
type PostResult = { ok: true; post: SocialPost } | Fail;
const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
const GONE = "This post no longer exists. Refresh the page.";
const isDocumentId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{8,64}$/i.test(value);
/** Posts the user can publish or (re)schedule: drafts, scheduled posts, and ones that failed. */
const RETRYABLE = new Set(["draft", "scheduled", "failed"]);
const appName = (toolkit: string) => featuredApp(toolkit)?.name ?? toolkit;

async function headquartersId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user ? (await findHeadquarters(user.email))?.documentId ?? null : null;
}

async function attempt(fallback: string, run: (hqId: string) => Promise<PostResult | { ok: true } | Fail>) {
  try {
    const hqId = await headquartersId();
    if (!hqId) return { ok: false as const, error: SIGNED_OUT };
    return await run(hqId);
  } catch (error) {
    console.error("[posts]", error);
    return { ok: false as const, error: error instanceof Error && error.message ? error.message.slice(0, 300) : fallback };
  }
}

async function reload(hqId: string, id: string): Promise<PostResult> {
  const found = await findPostForPublishing(hqId, id);
  return found ? { ok: true, post: found.post } : { ok: false, error: GONE };
}

/** A prepared post can publish: its account is connected and allows posting, and its tool posts. */
async function publishable(hqId: string, due: { toolkit: string; toolSlug: string; connectionId: string | null }): Promise<string | null> {
  if (!due.toolSlug || !due.connectionId) return "This draft isn't prepared yet. Ask an agent to prepare it first.";
  const connection = await findConnection(hqId, due.connectionId);
  if (!connection) return `The ${appName(due.toolkit)} account for this draft was disconnected. Connect it again and prepare the draft again.`;
  if (connection.status !== "active") return `${connection.toolkitName} is ${connection.status}. Reconnect it on the Accounts page.`;
  const tool = await getAppTool(due.toolSlug);
  if (!tool) return `Composio no longer has the tool ${due.toolSlug}. Prepare the draft again.`;
  const policy = toolPolicy(connection, tool.effect);
  return policy.allowed ? null : policy.reason;
}

/** Publishes a draft (or a scheduled post) right away. */
export async function publishNowAction(postId: string): Promise<PostResult> {
  if (!isDocumentId(postId)) return { ok: false, error: GONE };
  return attempt("We couldn't publish this post.", async (hqId) => {
    const found = await findPostForPublishing(hqId, postId);
    if (!found) return { ok: false, error: GONE };
    const { post, due } = found;
    if (!RETRYABLE.has(post.status)) return { ok: false, error: `This post is ${post.status}.` };
    const problem = await publishable(hqId, due);
    if (problem) return { ok: false, error: problem };
    if (!(await claimPost(postId, post.status))) return { ok: false, error: "This post is already being published." };
    await updatePost(postId, { userScheduled: true });
    const outcome = await publishPost({ ...due, userScheduled: true });
    const result = await reload(hqId, postId);
    if (outcome === "failed" && result.ok) {
      // Keep it where the user can fix and retry it; the error stays on the post.
      await updatePost(postId, { status: "draft" }).catch(() => undefined);
      return { ok: false, error: result.post.error ?? "The app refused the post." };
    }
    return result;
  }) as Promise<PostResult>;
}

/** Schedules a draft, or moves a scheduled post to a new time. */
export async function schedulePostAction(postId: string, publishAt: string): Promise<PostResult> {
  if (!isDocumentId(postId)) return { ok: false, error: GONE };
  const problem = scheduleTimeProblem(publishAt);
  if (problem) return { ok: false, error: problem };
  if (!jobsConfig()) {
    return { ok: false, error: "Scheduling needs CloudHike Jobs (JOBS_API_URL, JOBS_API_KEY, and a public APP_PUBLIC_URL) on this server. Publish now instead, or set those up." };
  }
  return attempt("We couldn't schedule this post.", async (hqId) => {
    const found = await findPostForPublishing(hqId, postId);
    if (!found) return { ok: false, error: GONE };
    const { post, due } = found;
    if (!RETRYABLE.has(post.status)) return { ok: false, error: `This post is ${post.status} and can't be scheduled.` };
    const blocked = await publishable(hqId, due);
    if (blocked) return { ok: false, error: blocked };
    const when = new Date(publishAt).toISOString();
    await updatePost(postId, { status: "scheduled", publishAt: when, userScheduled: true, error: null });
    try {
      await ensurePostSchedule();
    } catch (error) {
      await updatePost(postId, { status: post.status, publishAt: post.publishAt }).catch(() => undefined);
      return { ok: false, error: `CloudHike Jobs refused the publishing schedule: ${error instanceof Error ? error.message : error}` };
    }
    return reload(hqId, postId);
  }) as Promise<PostResult>;
}

/** Takes a scheduled post off the schedule and keeps it as a draft (its time stays as the suggestion). */
export async function unschedulePostAction(postId: string): Promise<PostResult> {
  if (!isDocumentId(postId)) return { ok: false, error: GONE };
  return attempt("We couldn't unschedule this post.", async (hqId) => {
    const found = await findPostForPublishing(hqId, postId);
    if (!found) return { ok: false, error: GONE };
    if (found.post.status !== "scheduled") return { ok: false, error: "This post is no longer scheduled." };
    await updatePost(postId, { status: "draft" });
    return reload(hqId, postId);
  }) as Promise<PostResult>;
}

/**
 * Edits a draft's title, text, and media. A prepared draft carries the text and media inside its tool arguments, so
 * changing either clears the preparation; an agent prepares it again with the new content.
 */
export async function updateDraftAction(postId: string, input: { title?: unknown; content?: unknown; media?: unknown }): Promise<PostResult> {
  if (!isDocumentId(postId)) return { ok: false, error: GONE };
  const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ").slice(0, 200) : "";
  const content = typeof input.content === "string" ? input.content.trim().slice(0, 20000) : "";
  const media = input.media === undefined ? null : parseMedia(input.media);
  if (!title) return { ok: false, error: "Give the draft a title." };
  if (!content) return { ok: false, error: "Write the post text." };
  return attempt("We couldn't save this draft.", async (hqId) => {
    const found = await findPostForPublishing(hqId, postId);
    if (!found) return { ok: false, error: GONE };
    if (found.post.status !== "draft") return { ok: false, error: "Only drafts can be edited." };
    const textChanged = content !== (found.post.content ?? "");
    const mediaChanged = media !== null && media.join("\n") !== found.post.media.join("\n");
    await updatePost(postId, {
      title, content, summary: content.slice(0, 600),
      ...(mediaChanged ? { media: media! } : {}),
      ...((textChanged || mediaChanged) && found.post.toolSlug ? { toolSlug: null, toolVersion: null, arguments: null, connectionId: null } : {}),
    });
    return reload(hqId, postId);
  }) as Promise<PostResult>;
}

export async function deleteDraftAction(postId: string): Promise<{ ok: true } | Fail> {
  if (!isDocumentId(postId)) return { ok: true };
  return attempt("We couldn't delete this draft.", async (hqId) => {
    const found = await findPostForPublishing(hqId, postId);
    if (!found) return { ok: true };
    if (!["draft", "failed", "cancelled"].includes(found.post.status)) return { ok: false, error: "Unschedule this post before deleting it." };
    await deletePost(postId);
    return { ok: true };
  });
}

/** Asks headquarters to prepare a draft for its connected account (pick the app's tool and arguments). */
export async function prepareDraftAction(postId: string): Promise<{ ok: true; queued: boolean } | Fail> {
  if (!isDocumentId(postId)) return { ok: false, error: GONE };
  const hqId = await headquartersId().catch(() => null);
  if (!hqId) return { ok: false, error: SIGNED_OUT };
  const found = await findPostForPublishing(hqId, postId).catch(() => null);
  if (!found) return { ok: false, error: GONE };
  const { post } = found;
  if (post.status !== "draft") return { ok: false, error: "Only drafts can be prepared." };
  const app = appName(post.toolkit);
  const result = await askHeadquartersAction([
    `Prepare my draft post "${post.title}" (draft_id ${post.documentId}) for publishing on ${app}.`,
    `An agent with access to ${app} should use find_app_tools to pick the tool that publishes it, then call save_post_draft with draft_id ${post.documentId}, app "${post.toolkit}", the same title, text, and media, plus tool_slug and arguments_json.`,
    "Keep the text exactly as written. Don't publish or schedule it; I'll do that from the Post page.",
    `Text:\n${post.content ?? post.summary ?? post.title}`,
    post.media.length ? `Media:\n${post.media.join("\n")}` : "",
  ].filter(Boolean).join("\n\n"));
  return result.ok ? { ok: true, queued: result.queuePosition > 0 } : result;
}
