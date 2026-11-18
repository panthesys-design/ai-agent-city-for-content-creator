import { findString, sumKey, type AccountStats, type AudienceEntry } from "@/lib/city-stats";
import { featuredApp } from "@/lib/connection-records";
import { strapi } from "@/lib/strapi";
import { composioConfigured } from "./client";
import { executeAppTool, getAppTool } from "./tools";

// Server-only: audience numbers (followers/subscribers, views, posts) of the user's connected accounts, read from each
// platform with one read-only Composio tool. Results are cached on the `connected-accounts` row (`stats`, `statsAt`)
// for STATS_TTL_MS, so the City page doesn't call every platform on each load.

type Row = Record<string, unknown>;

/** How to read one platform's numbers: the tool, its arguments, and where the numbers sit in the result. */
type AudienceSource = {
  tool: string;
  args: Record<string, unknown>;
  followers: string[];
  views: string[];
  posts: string[];
  handle: string[];
};

/**
 * Platforms whose own API reports audience numbers for the signed-in account. LinkedIn only reports followers for
 * company pages and Threads' profile has no counts, so those accounts are listed without numbers.
 */
export const AUDIENCE_SOURCES: Record<string, AudienceSource> = {
  youtube: {
    tool: "YOUTUBE_GET_CHANNEL_STATISTICS", args: { mine: true, part: "snippet,statistics" },
    followers: ["subscriberCount"], views: ["viewCount"], posts: ["videoCount"], handle: ["customUrl", "title"],
  },
  instagram: {
    tool: "INSTAGRAM_GET_USER_INFO", args: { ig_user_id: "me", fields: "id,username,followers_count,media_count" },
    followers: ["followers_count"], views: [], posts: ["media_count"], handle: ["username"],
  },
  twitter: {
    tool: "TWITTER_USER_LOOKUP_ME", args: { user_fields: ["public_metrics", "username"] },
    followers: ["followers_count"], views: [], posts: ["tweet_count"], handle: ["username"],
  },
  tiktok: {
    tool: "TIKTOK_GET_USER_STATS", args: {},
    followers: ["follower_count"], views: [], posts: ["video_count"], handle: ["display_name", "username"],
  },
  facebook: {
    tool: "FACEBOOK_GET_USER_PAGES", args: { fields: "id,name,followers_count,fan_count", limit: 25 },
    followers: ["followers_count", "fan_count"], views: [], posts: [], handle: ["name"],
  },
};

const STATS_TTL_MS = 30 * 60 * 1000;
/** One slow platform must not hold up the City page. */
const READ_TIMEOUT_MS = 15_000;

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

const platformIdOf = (value: unknown) =>
  value && typeof value === "object" && typeof (value as { platformId?: unknown }).platformId === "string" ? { platformId: (value as { platformId: string }).platformId } : {};

function statsFromRow(value: unknown): AccountStats | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return { followers: num(v.followers), views: num(v.views), posts: num(v.posts), handle: str(v.handle), error: str(v.error) };
}

/** Reads one account's numbers from its platform. Never throws: a failure is kept as `error`. */
async function readStats(toolkit: string, connection: { composioUserId: string; composioAccountId: string }): Promise<AccountStats> {
  const source = AUDIENCE_SOURCES[toolkit];
  const empty: AccountStats = { followers: null, views: null, posts: null, handle: null, error: null };
  try {
    const tool = await getAppTool(source.tool);
    if (!tool) return { ...empty, error: `Composio has no ${source.tool} tool.` };
    if (tool.effect !== "read") return { ...empty, error: `${source.tool} isn't read-only, so it isn't used for stats.` };
    const result = await executeAppTool(tool, connection, source.args, AbortSignal.timeout(READ_TIMEOUT_MS));
    if (!result.successful) return { ...empty, error: (result.error ?? "The platform refused the request.").slice(0, 300) };
    const data = result.data;
    return {
      followers: source.followers.length ? sumKey(data, source.followers) : null,
      views: source.views.length ? sumKey(data, source.views) : null,
      posts: source.posts.length ? sumKey(data, source.posts) : null,
      handle: findString(data, source.handle),
      error: null,
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message.slice(0, 300) : "Couldn't read stats." };
  }
}

/**
 * Audience numbers of a headquarters' active accounts. Cached numbers are returned as they are unless `refresh`; then
 * entries older than 30 minutes (or `force`: all of them) are read again and saved. A failed read keeps the last
 * good numbers and records the error. Also counts active accounts on platforms without numbers.
 */
export async function audienceStats(hqId: string, { refresh = false, force = false } = {}): Promise<{ entries: AudienceEntry[]; otherAccounts: number }> {
  if (!composioConfigured()) return { entries: [], otherAccounts: 0 };
  const query = new URLSearchParams({
    "filters[headquarter][documentId][$eq]": hqId, "filters[status][$eq]": "active", "sort[0]": "createdAt:asc", "pagination[pageSize]": "200",
  });
  const { data } = await strapi<{ data: Row[] }>(`/connected-accounts?${query}`);
  const supported = data.filter((row) => String(row.toolkit) in AUDIENCE_SOURCES);

  const entries = await Promise.all(supported.map(async (row): Promise<AudienceEntry> => {
    const toolkit = String(row.toolkit);
    let stats = statsFromRow(row.stats);
    let updatedAt = str(row.statsAt);
    const stale = !updatedAt || Date.now() - Date.parse(updatedAt) > STATS_TTL_MS;
    if (refresh && (force || stale)) {
      const fresh = await readStats(toolkit, { composioUserId: String(row.composioUserId ?? ""), composioAccountId: String(row.composioAccountId ?? "") });
      // Keep the last good numbers when this read failed.
      stats = fresh.error && stats ? { ...stats, error: fresh.error } : fresh;
      // A failed read is not retried until the cache expires either, so a broken platform isn't called on every load.
      updatedAt = new Date().toISOString();
      const label = str(row.accountLabel) ?? (fresh.handle ? (toolkit === "youtube" || toolkit === "facebook" ? fresh.handle : `@${fresh.handle.replace(/^@/, "")}`) : null);
      await strapi(`/connected-accounts/${String(row.documentId)}`, {
        // Keep the account ID publishing cached in the same field (lib/composio/publishing.ts).
        method: "PUT", body: JSON.stringify({ data: { stats: { ...stats, ...platformIdOf(row.stats) }, statsAt: updatedAt, ...(label && !str(row.accountLabel) ? { accountLabel: label } : {}) } }),
      }).catch((error) => console.warn("[stats] couldn't save account stats:", error instanceof Error ? error.message : error));
      if (label) row.accountLabel = label;
    }
    return {
      connectionId: String(row.documentId), toolkit, name: str(row.toolkitName) ?? featuredApp(toolkit)?.name ?? toolkit,
      label: str(row.accountLabel), updatedAt,
      ...(stats ?? { followers: null, views: null, posts: null, handle: null, error: null }),
    };
  }));
  return { entries, otherAccounts: data.length - supported.length };
}
