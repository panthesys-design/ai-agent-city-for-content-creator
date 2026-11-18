import {
  FEATURED_APPS, connectionFromStrapi, featuredApp, statusFromComposio,
  type AppInfo, type ConnectionRecord, type ConnectionStatus,
} from "@/lib/connection-records";
import { strapi } from "@/lib/strapi";
import { composio, composioError, composioUserIdFor } from "./client";

// Server-only: the user's connected accounts. Composio holds the tokens; Strapi's `connected-accounts` keeps each
// account's Composio ID, status, and access settings. Every query filters by headquarters (one per user), and every
// row also records its owner and the Composio user ID it was connected for.

type Row = Record<string, unknown>;
type One = { data: Row };
type Many = { data: Row[] };

/** Connections that never finished signing in are dropped after this long. */
const STALE_INITIATED_MS = 60 * 60 * 1000;

// ---------- Catalog ----------

type ToolkitMeta = { slug: string; name: string; meta?: { logo?: string; description?: string; categories?: { name?: string }[] }; composioManagedAuthSchemes?: string[]; noAuth?: boolean };

let catalogCache: { at: number; apps: AppInfo[] } | null = null;
const CATALOG_TTL_MS = 30 * 60 * 1000;

async function authConfigsByToolkit(): Promise<Map<string, { id: string; managed: boolean }[]>> {
  const map = new Map<string, { id: string; managed: boolean }[]>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const list = await composio().authConfigs.list({ limit: 100, ...(cursor ? { cursor } : {}) });
    for (const item of list.items) {
      if (item.status !== "ENABLED" || !item.toolkit?.slug) continue;
      map.set(item.toolkit.slug, [...(map.get(item.toolkit.slug) ?? []), { id: item.id, managed: Boolean(item.isComposioManaged) }]);
    }
    cursor = list.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return map;
}

function appInfo(toolkit: ToolkitMeta, configs: Map<string, { id: string; managed: boolean }[]>): AppInfo {
  const featured = featuredApp(toolkit.slug);
  const own = configs.get(toolkit.slug) ?? [];
  return {
    slug: toolkit.slug,
    name: featured?.name ?? toolkit.name,
    logo: toolkit.meta?.logo ?? null,
    category: featured?.category ?? null,
    blurb: featured?.blurb ?? (toolkit.meta?.description ?? "").slice(0, 160),
    connect: toolkit.noAuth ? "none" : own.some((c) => !c.managed) ? "configured" : toolkit.composioManagedAuthSchemes?.length || own.length ? "managed" : "setup",
  };
}

/** The featured apps with logos and whether each can be connected right away. Cached for 30 minutes. */
export async function featuredCatalog(): Promise<AppInfo[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.apps;
  const [toolkits, configs] = await Promise.all([
    composio().toolkits.getMany(FEATURED_APPS.map((a) => a.slug)) as Promise<unknown> as Promise<ToolkitMeta[]>,
    authConfigsByToolkit(),
  ]);
  const bySlug = new Map(toolkits.map((t) => [t.slug, t]));
  const apps = FEATURED_APPS.map((a) => appInfo(bySlug.get(a.slug) ?? { slug: a.slug, name: a.name }, configs));
  catalogCache = { at: Date.now(), apps };
  return apps;
}

let allToolkitsCache: { at: number; toolkits: Promise<ToolkitMeta[]> } | null = null;
const ALL_TOOLKITS_TTL_MS = 6 * 60 * 60 * 1000;

/** Every Composio toolkit (Composio's list has no text search), fetched page by page and cached for 6 hours. */
function allToolkits(): Promise<ToolkitMeta[]> {
  if (allToolkitsCache && Date.now() - allToolkitsCache.at < ALL_TOOLKITS_TTL_MS) return allToolkitsCache.toolkits;
  const toolkits = (async () => {
    const all: ToolkitMeta[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await composio().toolkits.get({ sortBy: "usage", limit: 500, ...(cursor ? { cursor } : {}) }) as unknown;
      const items = (Array.isArray(result) ? result : (result as { items?: unknown[] })?.items ?? []) as ToolkitMeta[];
      all.push(...items.filter((t) => t?.slug));
      cursor = Array.isArray(result) ? undefined : (result as { nextCursor?: string | null })?.nextCursor ?? undefined;
      if (!cursor || !items.length) break;
    }
    return all;
  })();
  allToolkitsCache = { at: Date.now(), toolkits };
  toolkits.catch(() => { allToolkitsCache = null; });
  return toolkits;
}

/** Composio apps matching a search by name, slug, or description (most used first), for "Search all apps". */
export async function searchCatalog(search: string): Promise<AppInfo[]> {
  const term = search.trim().toLowerCase();
  const [toolkits, configs] = await Promise.all([allToolkits(), authConfigsByToolkit()]);
  const score = (t: ToolkitMeta) => {
    const name = t.name.toLowerCase();
    if (t.slug === term || name === term) return 0;
    if (name.startsWith(term) || t.slug.startsWith(term)) return 1;
    if (name.includes(term) || t.slug.includes(term.replace(/\s+/g, ""))) return 2;
    return (t.meta?.description ?? "").toLowerCase().includes(term) ? 3 : -1;
  };
  return toolkits
    .map((t, i) => ({ t, s: score(t), i }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, 24)
    .map(({ t }) => appInfo(t, configs));
}

/** One app's details (name, logo), for apps found outside the featured list. */
export async function appDetails(slug: string): Promise<AppInfo | null> {
  const featured = (await featuredCatalog().catch(() => [])).find((a) => a.slug === slug);
  if (featured) return featured;
  try {
    const [toolkit, configs] = await Promise.all([composio().toolkits.get(slug) as Promise<unknown> as Promise<ToolkitMeta>, authConfigsByToolkit()]);
    return toolkit?.slug ? appInfo(toolkit, configs) : null;
  } catch {
    return null;
  }
}

/**
 * The auth config to connect a toolkit with: the project's own (custom OAuth app) when there is one, else Composio's
 * managed one, created on first use. Throws a setup message for apps Composio can't sign in to by itself (X, TikTok…).
 */
async function authConfigFor(toolkit: string): Promise<string> {
  const own = (await authConfigsByToolkit()).get(toolkit) ?? [];
  const chosen = own.find((c) => !c.managed) ?? own[0];
  if (chosen) return chosen.id;
  const details = await composio().toolkits.get(toolkit) as unknown as ToolkitMeta;
  if (!details?.composioManagedAuthSchemes?.length) {
    throw new Error(`${featuredApp(toolkit)?.name ?? details?.name ?? toolkit} needs its own developer app. Create an auth config for it in the Composio dashboard (Auth Configs → ${toolkit}), then connect again.`);
  }
  const created = await composio().authConfigs.create(toolkit, { type: "use_composio_managed_auth" } as never);
  catalogCache = null;
  return (created as { id: string }).id;
}

// ---------- Rows ----------

const HQ = (hqId: string) => ({ "filters[headquarter][documentId][$eq]": hqId });

export async function listConnections(hqId: string): Promise<ConnectionRecord[]> {
  const query = new URLSearchParams({ ...HQ(hqId), "sort[0]": "createdAt:asc", "pagination[pageSize]": "200" });
  const { data } = await strapi<Many>(`/connected-accounts?${query}`);
  return data.map(connectionFromStrapi);
}

export async function findConnection(hqId: string, documentId: string): Promise<(ConnectionRecord & { composioUserId: string; replacesId: string | null }) | null> {
  const query = new URLSearchParams({ ...HQ(hqId), "filters[documentId][$eq]": documentId, "pagination[pageSize]": "1" });
  const { data } = await strapi<Many>(`/connected-accounts?${query}`);
  return data[0] ? withPrivate(data[0]) : null;
}

const withPrivate = (row: Row) => ({
  ...connectionFromStrapi(row),
  composioUserId: String(row.composioUserId ?? ""),
  replacesId: typeof row.replacesId === "string" && row.replacesId ? row.replacesId : null,
});

/** Active connections with what a tool call needs (the Composio user and account IDs). */
export async function activeConnections(hqId: string): Promise<(ConnectionRecord & { composioUserId: string })[]> {
  const query = new URLSearchParams({ ...HQ(hqId), "filters[status][$eq]": "active", "sort[0]": "createdAt:asc", "pagination[pageSize]": "200" });
  const { data } = await strapi<Many>(`/connected-accounts?${query}`);
  return data.map(withPrivate);
}

export type ConnectionPatch = Partial<{
  status: ConnectionStatus; statusReason: string | null; accountLabel: string | null; permission: ConnectionRecord["permission"];
  agentAccess: ConnectionRecord["agentAccess"]; allowedAgents: string[]; requireApproval: boolean; connectedAt: string; lastSyncedAt: string;
  replacesId: string | null;
}>;

export async function updateConnection(documentId: string, patch: ConnectionPatch): Promise<void> {
  const data: Row = { ...patch };
  if (typeof patch.statusReason === "string") data.statusReason = patch.statusReason.slice(0, 1000);
  if (typeof patch.accountLabel === "string") data.accountLabel = patch.accountLabel.slice(0, 160);
  await strapi(`/connected-accounts/${documentId}`, { method: "PUT", body: JSON.stringify({ data }) });
}

// ---------- Connecting ----------

/**
 * Starts connecting a toolkit for the signed-in user: creates the Composio connection link and a row waiting for the
 * sign-in. `replaces` is a connection being reconnected; it keeps its settings and is removed once the new one works.
 */
export async function startConnection(params: {
  hqId: string; owner: { documentId: string }; toolkit: string; callbackUrl: (rowId: string) => string; replaces?: ConnectionRecord | null;
}): Promise<{ connection: ConnectionRecord; redirectUrl: string }> {
  const { hqId, owner, toolkit, replaces } = params;
  const userId = composioUserIdFor(owner.documentId);
  const [app, authConfigId] = await Promise.all([appDetails(toolkit), authConfigFor(toolkit)]);
  // Create the row first so the sign-in callback can name it; the Composio account ID is filled in right after.
  const placeholder = `pending-${crypto.randomUUID()}`;
  const { data } = await strapi<One>("/connected-accounts", {
    method: "POST",
    body: JSON.stringify({
      data: {
        toolkit, toolkitName: app?.name ?? toolkit, logo: app?.logo ?? null, composioAccountId: placeholder, composioUserId: userId, authConfigId,
        status: "initiated", headquarter: { connect: [hqId] }, owner: { connect: [owner.documentId] },
        ...(replaces ? {
          replacesId: replaces.documentId, accountLabel: replaces.accountLabel, permission: replaces.permission,
          agentAccess: replaces.agentAccess, allowedAgents: replaces.allowedAgents, requireApproval: replaces.requireApproval,
        } : {}),
      },
    }),
  });
  const rowId = String(data.documentId);
  try {
    const request = await composio().connectedAccounts.link(userId, authConfigId, { callbackUrl: params.callbackUrl(rowId), allowMultiple: true });
    if (!request.redirectUrl) throw new Error("Composio didn't return a sign-in link for this app.");
    await strapi(`/connected-accounts/${rowId}`, { method: "PUT", body: JSON.stringify({ data: { composioAccountId: request.id } }) });
    return { connection: connectionFromStrapi({ ...data, composioAccountId: request.id }), redirectUrl: request.redirectUrl };
  } catch (error) {
    await strapi(`/connected-accounts/${rowId}`, { method: "DELETE" }).catch(() => undefined);
    throw new Error(composioError(error));
  }
}

/**
 * Brings one row in line with Composio (after the sign-in callback, on page load, and while an agent waits for it).
 * A reconnection that became active removes the account it replaced.
 */
export async function syncConnection(hqId: string, row: ConnectionRecord & { composioUserId: string; replacesId: string | null }): Promise<ConnectionRecord> {
  if (row.composioAccountId.startsWith("pending-")) {
    const stale = Date.now() - Date.parse(row.createdAt ?? "") > STALE_INITIATED_MS;
    if (stale) await removeConnectionRow(row.documentId);
    return row;
  }
  let status: ConnectionStatus;
  let reason: string | null = null;
  try {
    const account = await composio().connectedAccounts.get(row.composioAccountId) as unknown as { status?: string; statusReason?: string | null; isDisabled?: boolean };
    status = statusFromComposio(account.status, account.isDisabled);
    reason = account.statusReason ?? null;
  } catch (error) {
    if (/404|not found/i.test(error instanceof Error ? error.message : "")) status = "revoked";
    else return row; // Composio unreachable: keep what we know.
  }
  if (status === "initiated" && Date.now() - Date.parse(row.createdAt ?? "") > STALE_INITIATED_MS) {
    await removeConnection(hqId, row).catch(() => undefined);
    return { ...row, status: "failed" };
  }
  const now = new Date().toISOString();
  if (status !== row.status || reason !== row.statusReason) {
    await updateConnection(row.documentId, {
      status, statusReason: reason, lastSyncedAt: now, ...(status === "active" && !row.connectedAt ? { connectedAt: now } : {}),
    });
  }
  if (status === "active" && row.replacesId) {
    const old = await findConnection(hqId, row.replacesId);
    if (old) await removeConnection(hqId, old).catch((e) => console.warn("[accounts] couldn't remove the replaced account:", composioError(e)));
    await updateConnection(row.documentId, { replacesId: null });
  }
  return { ...row, status, statusReason: reason, connectedAt: row.connectedAt ?? (status === "active" ? now : null) };
}

/** All of a headquarters' connections, synced with Composio. */
export async function syncedConnections(hqId: string): Promise<ConnectionRecord[]> {
  const query = new URLSearchParams({ ...HQ(hqId), "sort[0]": "createdAt:asc", "pagination[pageSize]": "200" });
  const { data } = await strapi<Many>(`/connected-accounts?${query}`);
  const synced = await Promise.all(data.map((row) => syncConnection(hqId, withPrivate(row)).catch(() => connectionFromStrapi(row))));
  // Rows removed while syncing (abandoned sign-ins, replaced accounts) disappear from the list.
  const kept = new Set((await listConnections(hqId)).map((c) => c.documentId));
  return synced.filter((c) => kept.has(c.documentId));
}

async function removeConnectionRow(documentId: string) {
  await strapi(`/connected-accounts/${documentId}`, { method: "DELETE" }).catch(() => undefined);
}

/** Disconnects: deletes the account in Composio (revoking its tokens there) and removes the row. */
export async function removeConnection(hqId: string, row: Pick<ConnectionRecord, "documentId" | "composioAccountId">): Promise<void> {
  const owned = await findConnection(hqId, row.documentId);
  if (!owned) return;
  if (!owned.composioAccountId.startsWith("pending-")) {
    try {
      await composio().connectedAccounts.delete(owned.composioAccountId);
    } catch (error) {
      if (!/404|not found/i.test(error instanceof Error ? error.message : "")) throw new Error(composioError(error));
    }
  }
  await removeConnectionRow(owned.documentId);
}

/** Pauses or resumes an account in Composio (tokens kept), so no agent can use it meanwhile. */
export async function setConnectionPaused(hqId: string, documentId: string, paused: boolean): Promise<ConnectionRecord | null> {
  const row = await findConnection(hqId, documentId);
  if (!row || row.composioAccountId.startsWith("pending-")) return null;
  await composio().connectedAccounts.update(row.composioAccountId, { enabled: !paused });
  return syncConnection(hqId, row);
}
