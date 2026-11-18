import type { Metadata } from "next";
import { listAgents } from "@/lib/agents";
import { composioConfigured, composioError } from "@/lib/composio/client";
import { featuredCatalog, syncedConnections } from "@/lib/composio/connections";
import { FEATURED_APPS, type AppInfo, type ConnectionRecord } from "@/lib/connection-records";
import { requireDashboardAccess } from "../access";
import { AccountsView } from "./accounts-view";

export const metadata: Metadata = { title: "Accounts — Creator City" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; status?: string }> }) {
  const { headquarters } = await requireDashboardAccess();
  const params = await searchParams;
  const agents = (await listAgents(headquarters)).map((a) => ({ id: a.documentId, name: a.name }));

  let apps: AppInfo[] = FEATURED_APPS.map((a) => ({ slug: a.slug, name: a.name, logo: null, category: a.category, blurb: a.blurb, connect: "managed" }));
  let connections: ConnectionRecord[] = [];
  let loadError: string | null = null;
  if (composioConfigured()) {
    const [catalog, synced] = await Promise.allSettled([featuredCatalog(), syncedConnections(headquarters.documentId)]);
    if (catalog.status === "fulfilled") apps = catalog.value;
    else loadError = composioError(catalog.reason);
    if (synced.status === "fulfilled") connections = synced.value;
    else loadError = synced.reason instanceof Error ? synced.reason.message : "We couldn't load your accounts.";
  }

  return (
    <AccountsView
      configured={composioConfigured()}
      initialApps={apps}
      initialConnections={connections}
      agents={agents}
      loadError={loadError}
      returned={params.connected ? { toolkit: params.connected, status: params.status ?? "failed" } : null}
    />
  );
}
