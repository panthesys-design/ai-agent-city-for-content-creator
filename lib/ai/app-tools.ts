import { tool, type RunContext, type Tool } from "@openai/agents";
import { z } from "zod";
import { composioConfigured } from "@/lib/composio/client";
import { activeConnections, appDetails, findConnection, listConnections, syncConnection } from "@/lib/composio/connections";
import { createPost, findPostForPublishing, updatePost } from "@/lib/composio/posts";
import { NEEDS_FRESH_CONTAINER, completeArgs, directCallArgs, hasFollowUp } from "@/lib/composio/publishing";
import { compactSchema, executeAppTool, getAppTool, searchAppTools, type AppTool } from "@/lib/composio/tools";
import {
  agentCanUse, featuredApp, findResultUrl, isToolkitSlug, parseMedia, toolPolicy,
  type ConnectionRecord,
} from "@/lib/connection-records";
import { CONFIRM_OPTIONS } from "@/lib/computer-records";
import { publishingApprovalFrom } from "@/lib/workspace-settings";
import type { CityRunContext } from "./context";
import { jobsConfig } from "./env";
import { ensurePostSchedule } from "./jobs";
import { contextOf } from "./tool-context";
import { askUser } from "./user-requests";

// Agent tools for the user's connected accounts (Composio). Agents discover what is connected, search one app's
// tools, and run or schedule them. Every call re-checks, on the server, that the account is connected, that this
// agent was given access on the Accounts page, and that the account allows the action; posting asks the user first
// when the account requires approval. When an app is missing, request_connection shows a "Connect" card (generative
// UI) in chat and above the building, and the agent continues by itself once the user has connected it.

type Connection = ConnectionRecord & { composioUserId: string };

const RESULT_LIMIT = 6000;
const compact = (value: unknown, n = RESULT_LIMIT) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > n ? `${text.slice(0, n - 1)}… (truncated)` : text;
};
/** A tool result small enough to keep on the post record: the data itself, or a truncated text of it. */
export const storedResult = (data: unknown) => {
  const text = JSON.stringify(data ?? null);
  return text.length <= 4000 ? data ?? null : { truncated: text.slice(0, 4000) };
};
const appName = (toolkit: string, connection?: Pick<ConnectionRecord, "toolkitName"> | null) => connection?.toolkitName ?? featuredApp(toolkit)?.name ?? toolkit;

export const APP_RULES = [
  "Connected apps: the user connects external accounts (Instagram, YouTube, X, LinkedIn, Notion, Google Sheets…) on the Accounts page and chooses which agents may use each one.",
  "- When a task involves one of these apps (publishing or scheduling a post, reading channel stats, saving to Notion), call list_connected_apps first.",
  "- A connected app is the preferred way to work with that app. If find_app_tools has a tool for the action, use run_app_tool or schedule_app_tool rather than the app's website on the cloud computer; use the website only when no app tool does it, the app tool failed, or the user asked for the website.",
  "- If the app you need isn't connected, or you don't have access, or it is read-only and you need to post, call request_connection. It shows the user a Connect card and waits; once it returns connected, continue the task. Never ask the user for passwords or tokens, and never tell them to paste credentials in chat.",
  "- To act, call find_app_tools with the app and what you want to do, pick the matching tool, then call run_app_tool with arguments that follow its input schema exactly. Use public https URLs of artifacts (images, video) for media inputs.",
  "- Publishing is outward-facing: post exactly what the user approved. run_app_tool asks the user for approval itself when the account requires it, so don't ask twice. If the user declines, don't post.",
  "- Drafts: when the user asks for posts to review, for drafts, or for content to publish \"later\" without a fixed time, save each post with save_post_draft instead of publishing. It appears on the user's Post page and calendar, where they schedule or publish it. When the app is connected, prepare it: find the publishing tool and pass tool_slug and arguments_json, so the user can publish it with one click. When asked to prepare an existing draft, pass its draft_id.",
  "- Instagram publishes in two steps. To publish now, run INSTAGRAM_POST_IG_USER_MEDIA (image_url or video_url, caption), then INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH with the returned id as creation_id. For a draft or a scheduled post, prepare only INSTAGRAM_POST_IG_USER_MEDIA; the publish step runs automatically. ig_user_id is filled in for you.",
  "- To publish later, use schedule_app_tool with an ISO 8601 time including the timezone offset. Prefer an app's own scheduling input (for example a publish time on a video upload) when its tool has one.",
  "- Report what was posted with its link when the tool returned one. If a tool fails, say what failed; don't claim it was posted.",
].join("\n");

/** Active connections the agent can see: usable ones, plus connected ones it lacks access to (headquarters sees all). */
async function connectionsFor(context: CityRunContext): Promise<{ usable: Connection[]; locked: Connection[] }> {
  const all = await activeConnections(context.hq.documentId);
  if (!context.agentId) return { usable: [], locked: all };
  return { usable: all.filter((c) => agentCanUse(c, context.agentId)), locked: all.filter((c) => !agentCanUse(c, context.agentId)) };
}

/** A short summary of the agent's apps for its instructions, so it knows up front what it can use and what's missing. */
export async function appsNoteFor(hqId: string, agentId: string | null): Promise<string | null> {
  if (!composioConfigured()) return null;
  try {
    const all = await activeConnections(hqId);
    const line = (c: Connection) => `${c.toolkitName} (${c.toolkit}${c.accountLabel ? `, ${c.accountLabel}` : ""}${c.permission === "read" ? ", read-only" : ""})`;
    if (!agentId) {
      if (!all.length) return "Connected apps: none yet. If the request needs an app (publishing to a platform, saving to Notion), call request_connection before planning that step.";
      return `Connected apps: ${all.map((c) => `${line(c)} — ${c.agentAccess === "all" ? "all agents" : "selected agents only"}`).join("; ")}. Give app steps to an agent that has access to the app (agents check their own access).`;
    }
    const usable = all.filter((c) => agentCanUse(c, agentId));
    const locked = all.filter((c) => !agentCanUse(c, agentId));
    return [
      `Your connected apps: ${usable.length ? usable.map(line).join("; ") : "none"}.`,
      locked.length ? `Connected but not shared with you: ${locked.map((c) => c.toolkitName).join(", ")} (use request_connection to ask for access).` : null,
    ].filter(Boolean).join(" ");
  } catch {
    return null;
  }
}

function pickConnection(usable: Connection[], toolkit: string, accountId: string | null): Connection | { error: string } {
  const matching = usable.filter((c) => c.toolkit === toolkit);
  if (accountId) {
    const chosen = matching.find((c) => c.documentId === accountId);
    return chosen ?? { error: `account_id ${accountId} isn't one of your ${appName(toolkit)} accounts. Call list_connected_apps.` };
  }
  return matching[0] ?? { error: `${appName(toolkit)} isn't connected for you. Call request_connection with app "${toolkit}" so the user can connect it.` };
}

async function resolveTool(context: CityRunContext, slug: string, accountId: string | null): Promise<{ tool: AppTool; connection: Connection } | { error: string }> {
  if (!composioConfigured()) return { error: "Connected apps aren't set up on this server (COMPOSIO_API_KEY is missing)." };
  if (!context.agentId) return { error: "Headquarters doesn't run app tools itself. Give this to an agent that has access to the app." };
  const appTool = await getAppTool(slug.trim().toUpperCase());
  if (!appTool) return { error: `There is no tool named ${slug}. Call find_app_tools to search for the right one.` };
  const { usable } = await connectionsFor(context);
  const connection = pickConnection(usable, appTool.toolkit, accountId);
  if ("error" in connection) return connection;
  return { tool: appTool, connection };
}

function parseArgs(json: string): Record<string, unknown> | { error: string } {
  try {
    const value = JSON.parse(json || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "arguments_json must be a JSON object." };
    return value as Record<string, unknown>;
  } catch {
    return { error: "arguments_json is not valid JSON. Fix it and call again." };
  }
}

/** Asks the user before posting or changing something, when the account requires it. Returns null when approved. */
async function approve(context: CityRunContext, appTool: AppTool, connection: Connection, args: Record<string, unknown>, summary: string, when: string | null): Promise<string | null> {
  const policy = toolPolicy(connection, appTool.effect, publishingApprovalFrom(context.hq.publishingApproval));
  if (!policy.allowed) return `${policy.reason} Use request_connection with app "${connection.toolkit}" to ask for posting access.`;
  if (!policy.approval) return null;
  const preview = compact(args, 1500);
  const result = await askUser(context, {
    kind: "confirm",
    title: `${when ? "Schedule" : appTool.effect === "destructive" ? "Delete with" : "Publish to"} ${connection.toolkitName}${connection.accountLabel ? ` (${connection.accountLabel})` : ""}?`,
    message: `${summary}${when ? `\n\nWhen: ${when}` : ""}\n\n${appTool.name} · ${preview}`,
    service: connection.toolkitName, options: CONFIRM_OPTIONS, allowOther: true,
  });
  const response = result.response;
  if (result.status === "resolved" && response?.optionId === "approve") return null;
  if (result.status === "resolved" && response?.optionId === "other" && response.text) {
    return `The user didn't approve yet and asked for changes: "${response.text}". Make the changes and try again.`;
  }
  return result.status === "expired" ? "The user didn't answer in time; nothing was posted." : "The user declined; nothing was posted.";
}

export const listConnectedAppsTool = tool({
  name: "list_connected_apps",
  description: "List the external accounts you can use (Instagram, YouTube, X, LinkedIn, Notion…), with each one's account_id and whether it can post.",
  parameters: z.object({}),
  execute: async (_args, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    if (!composioConfigured()) return "Connected apps aren't set up on this server (COMPOSIO_API_KEY is missing).";
    const { usable, locked } = await connectionsFor(context);
    const row = (c: Connection) => ({
      account_id: c.documentId, app: c.toolkit, name: c.toolkitName, account: c.accountLabel,
      can_post: c.permission === "publish", asks_before_posting: c.requireApproval || publishingApprovalFrom(context.hq.publishingApproval) === "ask",
    });
    return JSON.stringify({
      ...(context.agentId ? { usable: usable.map(row) } : {}),
      [context.agentId ? "connected_without_your_access" : "connected"]: locked.map((c) => ({ app: c.toolkit, name: c.toolkitName, account: c.accountLabel })),
      note: "Apps not listed aren't connected. Use request_connection to ask the user to connect one or to give you access.",
    });
  },
});

export const findAppToolsTool = tool({
  name: "find_app_tools",
  description: "Search one connected app's tools for what you want to do (e.g. app \"linkedin\", query \"create a post with an image\"). Returns tool slugs, what each does, whether it posts/changes things, and its input schema.",
  parameters: z.object({
    app: z.string().min(2).max(60).describe('App slug from list_connected_apps, e.g. "instagram", "youtube", "twitter", "notion".'),
    query: z.string().max(120).nullable().describe('What you want to do in 2–4 words, e.g. "create post", "upload video", "channel statistics"; null lists the app\'s main tools.'),
  }),
  execute: async ({ app, query }, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    if (!composioConfigured()) return "Connected apps aren't set up on this server (COMPOSIO_API_KEY is missing).";
    const toolkit = app.trim().toLowerCase();
    if (!isToolkitSlug(toolkit)) return "app must be an app slug such as \"instagram\".";
    const { usable } = await connectionsFor(context);
    if (context.agentId && !usable.some((c) => c.toolkit === toolkit)) {
      return `${appName(toolkit)} isn't connected for you. Call request_connection with app "${toolkit}" first.`;
    }
    const tools = await searchAppTools(toolkit, query?.trim() || null);
    if (!tools.length) return `No ${appName(toolkit)} tools matched "${query}". Try other words.`;
    let budget = 14000;
    const out = tools.map((t, i) => {
      const entry: Record<string, unknown> = { tool_slug: t.slug, does: t.description.slice(0, 400), effect: t.effect };
      // The best matches get their full inputs; the rest just a line, to keep the answer small.
      if (i < 4) {
        const schema = JSON.stringify(compactSchema(t.input));
        if (schema.length < budget) { entry.input_schema = JSON.parse(schema); budget -= schema.length; }
      }
      return entry;
    });
    return JSON.stringify({ app: toolkit, tools: out, next: "Call run_app_tool with tool_slug and arguments_json matching input_schema. For a tool listed without its schema, search again with a narrower query." });
  },
});

export const runAppToolTool = tool({
  name: "run_app_tool",
  description: "Run one tool of a connected app (from find_app_tools) as the user's account: publish a post, upload, read stats, write a Notion page. Posting may ask the user for approval first.",
  parameters: z.object({
    tool_slug: z.string().min(3).max(160).describe("Exact tool slug from find_app_tools, e.g. LINKEDIN_CREATE_LINKED_IN_POST."),
    arguments_json: z.string().max(20000).describe("The tool's arguments as a JSON object string, following its input_schema."),
    account_id: z.string().max(64).nullable().describe("account_id from list_connected_apps when the user has more than one account for this app; else null."),
    summary: z.string().min(1).max(600).describe("One or two sentences for the user: what this does, e.g. the post text and where it goes."),
  }),
  execute: async ({ tool_slug, arguments_json, account_id, summary }, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    const args = parseArgs(arguments_json);
    if ("error" in args) return args.error as string;
    const resolved = await resolveTool(context, tool_slug, account_id);
    if ("error" in resolved) return resolved.error;
    const { tool: appTool, connection } = resolved;
    const ready = await directCallArgs(appTool, connection, args);
    if ("error" in ready) return ready.error;
    const callArgs = ready.args;

    const refusal = await approve(context, appTool, connection, callArgs, summary, null);
    if (refusal) return refusal;
    await context.report({ activity: `${appTool.effect === "read" ? "Reading" : "Publishing to"} ${connection.toolkitName}` });
    const result = await executeAppTool(appTool, connection, callArgs, context.signal);
    const url = result.successful ? findResultUrl(result.data) : null;

    // Posts and other changes on publishing apps are recorded for the Posted page, including failures.
    if (appTool.effect !== "read" && featuredApp(connection.toolkit)?.publishes !== false) {
      await createPost({
        hqId: context.hq.documentId, connectionId: connection.documentId, agentId: context.agentId, taskId: context.taskId,
        toolkit: connection.toolkit, toolSlug: appTool.slug, toolVersion: appTool.version, arguments: args,
        title: summary.split(/\n|(?<=\.)\s/)[0].slice(0, 200), summary,
        status: result.successful ? "published" : "failed", publishedAt: result.successful ? new Date().toISOString() : null,
        url, result: result.successful ? storedResult(result.data) : null,
        error: result.error,
      }).catch((e) => { console.warn("[apps] couldn't record the post:", e instanceof Error ? e.message : e); });
    }
    if (!result.successful) return `${appTool.slug} failed: ${result.error ?? "unknown error"}. Nothing was posted. Check the arguments against the input schema, or tell the user what went wrong.`;
    return compact({ successful: true, ...(url ? { url } : {}), data: result.data });
  },
}) as unknown as Tool<CityRunContext>;

export const scheduleAppToolTool = tool({
  name: "schedule_app_tool",
  description: "Schedule one tool of a connected app to run later, e.g. publish a post at a set time. The user may be asked to approve it now.",
  parameters: z.object({
    tool_slug: z.string().min(3).max(160),
    arguments_json: z.string().max(20000).describe("The tool's arguments as a JSON object string, following its input_schema."),
    account_id: z.string().max(64).nullable(),
    publish_at: z.string().describe("ISO 8601 date-time with timezone offset, e.g. 2026-11-20T09:00:00+05:30. At least 5 minutes from now."),
    title: z.string().min(1).max(200).describe("Short name for the Posted page, e.g. \"LinkedIn: launch announcement\"."),
    summary: z.string().min(1).max(600).describe("What will be posted, for the user."),
  }),
  execute: async ({ tool_slug, arguments_json, account_id, publish_at, title, summary }, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    const at = Date.parse(publish_at);
    if (Number.isNaN(at)) return "publish_at is not a valid ISO 8601 date-time. Fix it and call again.";
    if (at < Date.now() + 4 * 60_000) return "publish_at must be at least 5 minutes from now. To publish now, use run_app_tool.";
    if (at > Date.now() + 366 * 24 * 3600_000) return "publish_at must be within a year.";
    if (!jobsConfig()) {
      return "Scheduling needs CloudHike Jobs (JOBS_API_URL, JOBS_API_KEY, and a public APP_PUBLIC_URL), which this server doesn't have. Use the app's own scheduling input if its tool has one, publish now with the user's OK, or tell the user.";
    }
    const args = parseArgs(arguments_json);
    if ("error" in args) return args.error as string;
    const resolved = await resolveTool(context, tool_slug, account_id);
    if ("error" in resolved) return resolved.error;
    const { tool: appTool, connection } = resolved;
    if (appTool.effect === "read") return "Only posts and other changes can be scheduled; run read-only tools now with run_app_tool.";
    if (NEEDS_FRESH_CONTAINER[appTool.slug]) return `${appTool.slug} needs a container made right before publishing. Schedule ${NEEDS_FRESH_CONTAINER[appTool.slug]} instead (image_url or video_url plus caption); publishing it runs the publish step automatically.`;
    const completedArgs = await completeArgs(appTool, connection, args);
    if ("error" in completedArgs) return completedArgs.error;
    const when = new Date(at).toISOString();
    const refusal = await approve(context, appTool, connection, completedArgs.args, summary, when);
    if (refusal) return refusal;
    const post = await createPost({
      hqId: context.hq.documentId, connectionId: connection.documentId, agentId: context.agentId, taskId: context.taskId,
      toolkit: connection.toolkit, toolSlug: appTool.slug, toolVersion: appTool.version, arguments: completedArgs.args,
      title, summary, status: "scheduled", publishAt: when,
    });
    try {
      await ensurePostSchedule();
    } catch (error) {
      return `Saved the post for ${when}, but CloudHike Jobs refused the publishing schedule (${error instanceof Error ? error.message : error}). Tell the user it may not publish on time.`;
    }
    return JSON.stringify({ scheduled: true, postId: post.documentId, publishAt: when, app: connection.toolkit, note: "It appears on the Posted page and publishes automatically." });
  },
}) as unknown as Tool<CityRunContext>;

export const savePostDraftTool = tool({
  name: "save_post_draft",
  description: "Save a post as a draft on the user's Post page and calendar, for them to review and schedule or publish later. Nothing is published. Pass tool_slug and arguments_json (from find_app_tools) when the app is connected, so the user can publish it with one click.",
  parameters: z.object({
    draft_id: z.string().max(64).nullable().describe("A draft to update (when the user asked to prepare or change one), else null for a new draft."),
    app: z.string().min(2).max(60).describe('App slug, e.g. "instagram", "youtube", "twitter", "linkedin".'),
    title: z.string().min(1).max(200).describe('Short name shown on the Post page, e.g. "Launch teaser".'),
    content: z.string().min(1).max(20000).describe("The post text exactly as it will appear: caption, tweet, or description with hashtags."),
    media_urls: z.array(z.string().max(2048)).max(10).describe("https URLs of the images or videos that go with it (artifact URLs); empty for text only."),
    suggested_time: z.string().nullable().describe("Best time to publish, ISO 8601 with timezone offset; null if none."),
    tool_slug: z.string().max(160).nullable().describe("The tool that publishes it (from find_app_tools); null when the app isn't connected yet."),
    arguments_json: z.string().max(20000).nullable().describe("That tool's arguments as a JSON object string, with this exact content and media."),
    account_id: z.string().max(64).nullable().describe("account_id from list_connected_apps when there are several accounts for this app."),
  }),
  execute: async (input, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    const toolkit = input.app.trim().toLowerCase();
    if (!isToolkitSlug(toolkit)) return "app must be an app slug such as \"instagram\".";
    const media = parseMedia(input.media_urls);
    if (media.length < input.media_urls.length) return "media_urls must be public https URLs. Fix them and call again.";
    const suggested = input.suggested_time && !Number.isNaN(Date.parse(input.suggested_time)) ? new Date(input.suggested_time).toISOString() : null;
    if (input.suggested_time && !suggested) return "suggested_time is not a valid ISO 8601 date-time. Fix it or pass null.";

    // A prepared draft gets the same checks as publishing, except approval: the user approves by scheduling it.
    let prepared: { toolSlug: string; toolVersion: string | null; arguments: Record<string, unknown>; connectionId: string } | null = null;
    if (input.tool_slug) {
      const args = parseArgs(input.arguments_json ?? "{}");
      if ("error" in args) return args.error as string;
      const resolved = await resolveTool(context, input.tool_slug, input.account_id);
      if ("error" in resolved) return resolved.error;
      if (resolved.tool.toolkit !== toolkit) return `${resolved.tool.slug} belongs to ${resolved.tool.toolkit}, not ${toolkit}.`;
      if (resolved.tool.effect === "read") return `${resolved.tool.slug} only reads; pick the tool that publishes the post.`;
      const policy = toolPolicy(resolved.connection, resolved.tool.effect);
      if (!policy.allowed) return `${policy.reason} Save the draft without tool_slug, or use request_connection to ask for posting access.`;
      if (NEEDS_FRESH_CONTAINER[resolved.tool.slug]) {
        return `${resolved.tool.slug} publishes a container made right before it, so it can't be prepared ahead. Prepare the draft with ${NEEDS_FRESH_CONTAINER[resolved.tool.slug]} (image_url or video_url plus caption); publishing the draft runs the publish step automatically.`;
      }
      const completed = await completeArgs(resolved.tool, resolved.connection, args);
      if ("error" in completed) return completed.error;
      prepared = { toolSlug: resolved.tool.slug, toolVersion: resolved.tool.version, arguments: completed.args, connectionId: resolved.connection.documentId };
    }

    const fields = {
      title: input.title, content: input.content, summary: input.content.slice(0, 600), media, publishAt: suggested,
      toolSlug: prepared?.toolSlug ?? null, toolVersion: prepared?.toolVersion ?? null, arguments: prepared?.arguments ?? null,
      connectionId: prepared?.connectionId ?? null,
    };
    let draftId: string;
    if (input.draft_id) {
      const existing = await findPostForPublishing(context.hq.documentId, input.draft_id);
      if (!existing) return `There is no draft ${input.draft_id}. Pass draft_id null to save a new one.`;
      if (existing.post.status !== "draft") return `That post is ${existing.post.status}, not a draft, so it can't be changed.`;
      if (existing.post.toolkit !== toolkit) return `That draft is for ${existing.post.toolkit}, not ${toolkit}.`;
      await updatePost(existing.post.documentId, fields);
      draftId = existing.post.documentId;
    } else {
      const created = await createPost({
        hqId: context.hq.documentId, agentId: context.agentId, taskId: context.taskId, toolkit, status: "draft",
        ...fields, toolSlug: fields.toolSlug, connectionId: fields.connectionId,
      });
      draftId = created.documentId;
    }
    return JSON.stringify({
      draft_id: draftId, prepared: Boolean(prepared),
      note: prepared
        ? `Saved as a draft on the Post page and calendar. The user can publish or schedule it with one click; nothing was posted.${prepared && hasFollowUp(prepared.toolSlug) ? " Publishing it also runs the platform's final publish step." : ""}`
        : `Saved as a draft on the Post page and calendar; nothing was posted. It still needs preparing${toolkit ? ` once ${appName(toolkit)} is connected` : ""}.`,
    });
  },
}) as unknown as Tool<CityRunContext>;

/** What the user still has to do before this agent can use the app: connect it, share it, or allow posting. */
async function missingStep(context: CityRunContext, toolkit: string, needsPublish: boolean): Promise<"connect" | "grant" | "publish" | null> {
  const rows = await listConnections(context.hq.documentId);
  const mine = rows.filter((c) => c.toolkit === toolkit);
  // Pick up a sign-in that just finished even if the callback page didn't load.
  for (const row of mine.filter((c) => c.status === "initiated")) {
    const full = await findConnection(context.hq.documentId, row.documentId);
    if (full) Object.assign(row, await syncConnection(context.hq.documentId, full).catch(() => row));
  }
  const active = mine.filter((c) => c.status === "active");
  if (!active.length) return "connect";
  if (!context.agentId) return null;
  const usable = active.filter((c) => agentCanUse(c, context.agentId));
  if (!usable.length) return "grant";
  if (needsPublish && !usable.some((c) => c.permission === "publish")) return "publish";
  return null;
}

export const requestConnectionTool = tool({
  name: "request_connection",
  description: "Ask the user to connect an app you need (or to give you access, or to allow posting). Shows a Connect card in chat and waits until the user has done it.",
  parameters: z.object({
    app: z.string().min(2).max(60).describe('App slug, e.g. "instagram", "youtube", "twitter" (X), "linkedin", "notion", "googlesheets".'),
    reason: z.string().min(1).max(300).describe("Why you need it, in one sentence for the user, e.g. \"to publish your reel to Instagram\"."),
    needs_posting: z.boolean().describe("True when you need to post or change things, not only read."),
  }),
  execute: async ({ app, reason, needs_posting }, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    if (!composioConfigured()) return "Connected apps aren't set up on this server (COMPOSIO_API_KEY is missing). Tell the user.";
    const toolkit = app.trim().toLowerCase();
    if (!isToolkitSlug(toolkit)) return "app must be an app slug such as \"instagram\".";
    const step = await missingStep(context, toolkit, needs_posting);
    const details = await appDetails(toolkit);
    if (!details) return `There is no app called "${toolkit}". Use the app's slug, e.g. "twitter" for X.`;
    if (!step) return `${details.name} is already connected and you can use it. Continue with find_app_tools.`;

    const who = context.agentName;
    const title = step === "connect" ? `Connect ${details.name}` : step === "grant" ? `Give ${who} access to ${details.name}` : `Allow ${who} to post on ${details.name}`;
    const result = await askUser(context, {
      kind: "connect", title, message: reason.charAt(0).toUpperCase() + reason.slice(1),
      service: toolkit, capability: step, url: details.logo,
    }, { detect: async () => (await missingStep(context, toolkit, needs_posting)) === null });
    if (result.status === "resolved" && (await missingStep(context, toolkit, needs_posting)) === null) {
      return `${details.name} is connected and ready. Continue: call find_app_tools for app "${toolkit}".`;
    }
    if (result.status === "expired") return `The user didn't connect ${details.name} in time. Tell them it's needed and that they can connect it on the Accounts page, then stop this part.`;
    return `The user skipped connecting ${details.name}. Don't use it; tell them what you couldn't do and that they can connect it on the Accounts page.`;
  },
});

/** Tools every agent gets (access is decided per account on the Accounts page). */
export const appTools: Tool<CityRunContext>[] = [
  listConnectedAppsTool as unknown as Tool<CityRunContext>, findAppToolsTool as unknown as Tool<CityRunContext>,
  runAppToolTool, scheduleAppToolTool, savePostDraftTool, requestConnectionTool as unknown as Tool<CityRunContext>,
];

/** Headquarters sees what is connected and can ask for a connection; agents do the app work. */
export const headquartersAppTools: Tool<CityRunContext>[] = [
  listConnectedAppsTool as unknown as Tool<CityRunContext>, requestConnectionTool as unknown as Tool<CityRunContext>,
];
