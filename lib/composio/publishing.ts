import { imagekitConfig } from "@/lib/ai/env";
import { isImageKitUrl, signImageKitUrl, transformedUrl } from "@/lib/ai/imagekit-url";
import { strapi } from "@/lib/strapi";
import { executeAppTool, getAppTool, type AppTool, type ExecuteResult } from "./tools";

// Server-only fixes that make app tools publish reliably, applied to every run, draft, and scheduled post:
//
// - Own account IDs: some tools need the connected account's own platform ID (Instagram's `ig_user_id`). The server
//   looks it up once with a read-only tool, caches it on the connection row (`stats.platformId`), and fills it in, so
//   agents never guess it.
// - Follow-up steps: Instagram publishes in two steps (create a media container, then publish it). Containers expire
//   after 24 hours, so a draft stores the first call and publishing runs the second with the new container's ID.
// - Required inputs are checked before anything is sent, so a bad call fails while the agent can still fix it.

type Connection = { documentId: string; toolkit: string; composioUserId: string; composioAccountId: string };

/** Tools that need the account's own ID, and how to read it. */
const OWN_ID: Record<string, { param: string; tool: string; args: Record<string, unknown> }> = {
  instagram: { param: "ig_user_id", tool: "INSTAGRAM_GET_USER_INFO", args: { ig_user_id: "me", fields: "id,username" } },
};

/** The second step of two-step publishing tools: which tool runs next, and with what. */
const FOLLOW_UP: Record<string, (args: Record<string, unknown>, containerId: string) => { tool: string; args: Record<string, unknown> }> = {
  INSTAGRAM_POST_IG_USER_MEDIA: (args, creationId) => ({
    tool: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", args: { ig_user_id: args.ig_user_id ?? "me", creation_id: creationId, max_wait_seconds: 90 },
  }),
  INSTAGRAM_CREATE_MEDIA_CONTAINER: (args, creationId) => ({
    tool: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", args: { ig_user_id: args.ig_user_id ?? "me", creation_id: creationId, max_wait_seconds: 90 },
  }),
};

/** The final step of a two-step flow can't be prepared ahead: it needs a container made minutes before. */
export const NEEDS_FRESH_CONTAINER: Record<string, string> = {
  INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH: "INSTAGRAM_POST_IG_USER_MEDIA",
  INSTAGRAM_CREATE_POST: "INSTAGRAM_POST_IG_USER_MEDIA",
};

export const hasFollowUp = (slug: string) => slug in FOLLOW_UP;

/** A string or numeric ID under one of `keys`, searched a few levels deep. */
function findId(data: unknown, keys: string[], depth = 0): string | null {
  if (depth > 5 || !data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if ((typeof value === "string" && /^[\w-]{3,}$/.test(value)) || (typeof value === "number" && Number.isFinite(value))) return String(value);
  }
  for (const value of Object.values(record)) {
    const found = findId(value, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The connected account's own platform ID, from the row's cache or read once from the platform. */
async function ownAccountId(connection: Connection): Promise<string | null> {
  const source = OWN_ID[connection.toolkit];
  if (!source) return null;
  const { data: row } = await strapi<{ data: { stats?: Record<string, unknown> | null } }>(`/connected-accounts/${connection.documentId}?fields[0]=stats`)
    .catch(() => ({ data: { stats: null } }));
  const cached = row?.stats && typeof row.stats.platformId === "string" ? row.stats.platformId : null;
  if (cached) return cached;
  const tool = await getAppTool(source.tool);
  if (!tool || tool.effect !== "read") return null;
  const result = await executeAppTool(tool, connection, source.args, AbortSignal.timeout(15_000));
  const id = result.successful ? findId(result.data, ["id", "user_id"]) : null;
  if (id) {
    await strapi(`/connected-accounts/${connection.documentId}`, {
      method: "PUT", body: JSON.stringify({ data: { stats: { ...(row?.stats ?? {}), platformId: id } } }),
    }).catch(() => undefined);
  }
  return id;
}

/** Top-level required inputs the arguments don't have. */
export function missingRequired(tool: AppTool, args: Record<string, unknown>): string[] {
  const required = Array.isArray(tool.input.required) ? (tool.input.required as unknown[]).filter((k): k is string => typeof k === "string") : [];
  return required.filter((key) => args[key] === undefined || args[key] === null || args[key] === "");
}

/**
 * Completes arguments before they are stored or sent: fills the account's own ID where the tool takes it (and the
 * agent left it empty or used "me"), then checks required inputs. Returns the arguments or what's still missing.
 */
export async function completeArgs(tool: AppTool, connection: Connection, args: Record<string, unknown>): Promise<{ args: Record<string, unknown> } | { error: string }> {
  const next = { ...args };
  const source = OWN_ID[connection.toolkit];
  const properties = (tool.input.properties ?? {}) as Record<string, unknown>;
  if (source && source.param in properties && (next[source.param] === undefined || next[source.param] === null || next[source.param] === "" || next[source.param] === "me")) {
    const id = await ownAccountId(connection);
    if (id) next[source.param] = id;
    else if (next[source.param] !== "me") return { error: `Couldn't look up this ${connection.toolkit} account's ID (${source.param}). The account may need to be a Business or Creator account; reconnect it on the Accounts page.` };
  }
  const missing = missingRequired(tool, next);
  if (missing.length) return { error: `${tool.slug} is missing required input${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Add ${missing.length === 1 ? "it" : "them"} to arguments_json and call again.` };
  return { args: next };
}

const INSTAGRAM_MEDIA_TOOLS = new Set(["INSTAGRAM_POST_IG_USER_MEDIA", "INSTAGRAM_CREATE_MEDIA_CONTAINER"]);

/**
 * Instagram only accepts JPEG images, but ImageKit serves the best format the client accepts (often WebP). Our
 * ImageKit images get `f-jpg` so Meta always receives a JPEG, signed when the account restricts unsigned URLs.
 */
function jpegUrl(url: unknown): unknown {
  const config = imagekitConfig();
  if (typeof url !== "string" || !config || !isImageKitUrl(url, config.urlEndpoint) || /[?&:]?f-jpg\b/.test(url)) return url;
  const jpeg = transformedUrl(url, "f-jpg");
  return config.privateKey ? signImageKitUrl(jpeg, config.urlEndpoint, config.privateKey, 48 * 3600) : jpeg;
}

/** Platform-specific fixes applied right before a call is sent (never stored, so they aren't applied twice). */
function encodeForTool(slug: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!INSTAGRAM_MEDIA_TOOLS.has(slug)) return args;
  const next: Record<string, unknown> = { ...args };
  if ("image_url" in next) next.image_url = jpegUrl(next.image_url);
  if ("cover_url" in next) next.cover_url = jpegUrl(next.cover_url);
  // Composio's docs for this tool: "Use HTML URL encoding for hashtags (# becomes %23)" in the caption.
  if (slug === "INSTAGRAM_POST_IG_USER_MEDIA" && typeof next.caption === "string" && !next.caption.includes("%23")) {
    next.caption = next.caption.replace(/#/g, "%23");
  }
  return next;
}

/**
 * Runs a stored publishing call (a draft or scheduled post): completes the arguments, runs the tool, then its
 * follow-up step when it has one (Instagram: publish the container just made). The result is the last step's.
 */
export async function runPublishingCall(tool: AppTool, connection: Connection, args: Record<string, unknown>, signal?: AbortSignal): Promise<ExecuteResult> {
  const completed = await completeArgs(tool, connection, args);
  if ("error" in completed) return { successful: false, data: null, error: completed.error };
  const first = await executeAppTool(tool, connection, encodeForTool(tool.slug, completed.args), signal);
  const followUp = FOLLOW_UP[tool.slug];
  if (!first.successful || !followUp) return first;

  const containerId = findId(first.data, ["id", "creation_id", "container_id"]);
  if (!containerId) return { successful: false, data: first.data, error: `${tool.slug} didn't return a container ID to publish.` };
  const next = followUp(completed.args, containerId);
  const nextTool = await getAppTool(next.tool);
  if (!nextTool) return { successful: false, data: first.data, error: `Composio has no ${next.tool} tool to finish publishing.` };
  const second = await executeAppTool(nextTool, connection, next.args, signal);
  return second.successful ? second : { ...second, error: `The media was uploaded but not published: ${second.error ?? "unknown error"}` };
}

/** Prepares arguments for a direct run (run_app_tool): completed and encoded, no follow-up (the agent runs each step). */
export async function directCallArgs(tool: AppTool, connection: Connection, args: Record<string, unknown>): Promise<{ args: Record<string, unknown> } | { error: string }> {
  const completed = await completeArgs(tool, connection, args);
  return "error" in completed ? completed : { args: encodeForTool(tool.slug, completed.args) };
}
