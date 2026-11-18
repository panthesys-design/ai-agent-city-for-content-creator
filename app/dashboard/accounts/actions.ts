"use server";

import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { composioConfigured, composioError } from "@/lib/composio/client";
import {
  findConnection, listConnections, removeConnection, searchCatalog, setConnectionPaused, startConnection, syncConnection, syncedConnections,
  updateConnection,
} from "@/lib/composio/connections";
import { connectStepOf } from "@/lib/computer-records";
import { findOwnedRequest, settleRequest } from "@/lib/computer/store";
import {
  agentCanUse, isToolkitSlug, parseConnectionSettings,
  type AppInfo, type ConnectionRecord,
} from "@/lib/connection-records";
import { findHeadquarters } from "@/lib/headquarters";
import { ensureStrapiUser } from "@/lib/strapi";

// Server actions for the Accounts page and the "Connect" cards agents show in chat. Every action resolves the
// signed-in user's headquarters itself and only touches that headquarters' connections, posts, and requests.

type Fail = { ok: false; error: string };
const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
const NOT_CONFIGURED = "Connected accounts aren't set up on this server yet (COMPOSIO_API_KEY is missing).";
const isDocumentId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{8,64}$/i.test(value);

async function signedIn() {
  const user = await getCurrentUser();
  if (!user) return null;
  const hq = await findHeadquarters(user.email);
  return hq ? { user, hq } : null;
}

async function attempt<T>(fallback: string, run: () => Promise<T | Fail>): Promise<T | Fail> {
  try {
    return await run();
  } catch (error) {
    console.error("[accounts]", error);
    return { ok: false, error: error instanceof Error && error.message ? composioError(error) : fallback };
  }
}

/** Where Composio sends the user back after signing in: this app's origin (NEXT_PUBLIC_APP_URL, else the request's). */
async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Starts connecting an app: returns Composio's hosted sign-in link (OAuth or the app's own form). The browser opens
 * it in a popup; /api/accounts/callback brings the user back. `replaces` reconnects an existing account.
 */
export async function startConnectionAction(toolkit: string, options: { replaces?: string } = {}): Promise<{ ok: true; redirectUrl: string; connectionId: string } | Fail> {
  if (!composioConfigured()) return { ok: false, error: NOT_CONFIGURED };
  if (!isToolkitSlug(toolkit)) return { ok: false, error: "Unknown app." };
  return attempt("We couldn't start connecting this app. Please try again.", async () => {
    const session = await signedIn();
    if (!session) return { ok: false, error: SIGNED_OUT };
    const replaces = options.replaces && isDocumentId(options.replaces) ? await findConnection(session.hq.documentId, options.replaces) : null;
    if (options.replaces && !replaces) return { ok: false, error: "This account was already removed. Refresh the page." };
    if (replaces && replaces.toolkit !== toolkit) return { ok: false, error: "Unknown app." };
    const owner = await ensureStrapiUser(session.user.email);
    const origin = await appOrigin();
    const { connection, redirectUrl } = await startConnection({
      hqId: session.hq.documentId, owner, toolkit, replaces,
      callbackUrl: (rowId) => `${origin}/api/accounts/callback?connection=${encodeURIComponent(rowId)}`,
    });
    return { ok: true, redirectUrl, connectionId: connection.documentId };
  });
}

/** The user's connections, freshly synced with Composio. */
export async function refreshConnectionsAction(): Promise<{ ok: true; connections: ConnectionRecord[] } | Fail> {
  return attempt("We couldn't refresh your accounts.", async () => {
    const session = await signedIn();
    if (!session) return { ok: false, error: SIGNED_OUT };
    return { ok: true, connections: await syncedConnections(session.hq.documentId) };
  });
}

export async function disconnectAction(connectionId: string): Promise<{ ok: true } | Fail> {
  if (!isDocumentId(connectionId)) return { ok: false, error: "This account was already removed." };
  return attempt("We couldn't disconnect this account. Please try again.", async () => {
    const session = await signedIn();
    if (!session) return { ok: false, error: SIGNED_OUT };
    const row = await findConnection(session.hq.documentId, connectionId);
    if (!row) return { ok: true };
    await removeConnection(session.hq.documentId, row);
    return { ok: true };
  });
}

export async function pauseConnectionAction(connectionId: string, paused: boolean): Promise<{ ok: true; connection: ConnectionRecord } | Fail> {
  if (!isDocumentId(connectionId)) return { ok: false, error: "This account was already removed." };
  return attempt("We couldn't update this account. Please try again.", async () => {
    const session = await signedIn();
    if (!session) return { ok: false, error: SIGNED_OUT };
    const connection = await setConnectionPaused(session.hq.documentId, connectionId, paused);
    return connection ? { ok: true, connection } : { ok: false, error: "This account was already removed. Refresh the page." };
  });
}

/** Saves who may use an account and how (read-only or posting, approval), plus its display label. */
export async function updateConnectionSettingsAction(connectionId: string, raw: unknown): Promise<{ ok: true; connection: ConnectionRecord } | Fail> {
  if (!isDocumentId(connectionId)) return { ok: false, error: "This account was already removed." };
  const parsed = parseConnectionSettings(raw);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const labelInput = (raw as { accountLabel?: unknown } | null)?.accountLabel;
  const accountLabel = typeof labelInput === "string" ? labelInput.trim().replace(/\s+/g, " ").slice(0, 80) || null : null;
  return attempt("We couldn't save these settings. Please try again.", async () => {
    const session = await signedIn();
    if (!session) return { ok: false, error: SIGNED_OUT };
    const row = await findConnection(session.hq.documentId, connectionId);
    if (!row) return { ok: false, error: "This account was already removed. Refresh the page." };
    await updateConnection(row.documentId, { ...parsed.settings, accountLabel });
    return { ok: true, connection: { ...row, ...parsed.settings, accountLabel } };
  });
}

/** Any Composio app matching a search (for apps beyond the featured list). */
export async function searchAppsAction(query: string): Promise<{ ok: true; apps: AppInfo[] } | Fail> {
  if (!composioConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const term = typeof query === "string" ? query.trim().slice(0, 60) : "";
  if (term.length < 2) return { ok: true, apps: [] };
  return attempt("We couldn't search apps right now.", async () => {
    if (!(await signedIn())) return { ok: false, error: SIGNED_OUT };
    return { ok: true, apps: await searchCatalog(term) };
  });
}

/**
 * Settles an agent's "give me access" / "allow posting" card: shares the app's account with that agent, or lets it
 * post, then resolves the request so the agent continues. ("Connect" cards resolve once the sign-in completes.)
 */
export async function approveConnectRequestAction(requestId: string): Promise<{ ok: true } | Fail> {
  if (!isDocumentId(requestId)) return { ok: false, error: "This request no longer exists." };
  return attempt("We couldn't update access. Please try again.", async () => {
    const session = await signedIn();
    if (!session) return { ok: false, error: SIGNED_OUT };
    const hqId = session.hq.documentId;
    const request = await findOwnedRequest(hqId, requestId);
    if (!request || request.kind !== "connect") return { ok: false, error: "This request no longer exists." };
    if (request.status !== "pending") return { ok: false, error: "The agent has already moved on." };
    const step = connectStepOf(request);
    const toolkit = request.service ?? "";
    const active = (await listConnections(hqId)).filter((c) => c.toolkit === toolkit && c.status === "active");
    if (!active.length || step === "connect") return { ok: false, error: "Connect the account first." };
    if (step === "grant") {
      if (!request.agentId) return { ok: false, error: "Only an agent can be given access." };
      const target = active[0];
      if (!agentCanUse(target, request.agentId)) {
        await updateConnection(target.documentId, { agentAccess: "selected", allowedAgents: [...new Set([...target.allowedAgents, request.agentId])] });
      }
    } else {
      const usable = active.filter((c) => agentCanUse(c, request.agentId));
      const target = usable[0] ?? active[0];
      await updateConnection(target.documentId, { permission: "publish" });
    }
    await settleRequest(request.documentId, "resolved", { done: true });
    return { ok: true };
  });
}

/** Re-checks one connection after the sign-in popup closes (the callback page may not have loaded). */
export async function checkConnectionAction(connectionId: string): Promise<{ ok: true; connection: ConnectionRecord | null } | Fail> {
  if (!isDocumentId(connectionId)) return { ok: true, connection: null };
  return attempt("We couldn't check this account.", async () => {
    const session = await signedIn();
    if (!session) return { ok: false, error: SIGNED_OUT };
    const row = await findConnection(session.hq.documentId, connectionId);
    return { ok: true, connection: row ? await syncConnection(session.hq.documentId, row) : null };
  });
}
