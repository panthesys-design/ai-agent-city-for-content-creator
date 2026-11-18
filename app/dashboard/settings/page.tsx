import type { Metadata } from "next";
import { HEADQUARTERS_NAME_MAX } from "@/lib/headquarters";
import { composioConfigured } from "@/lib/composio/client";
import { listConnections } from "@/lib/composio/connections";
import { agentDefaultsFrom, publishingApprovalFrom, timeZoneFrom } from "@/lib/workspace-settings";
import { requireDashboardAccess } from "../access";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings — Creator City" };

/** Every IANA zone this runtime knows, plus the saved one in case the list lacks it. */
function timeZoneOptions(saved: string | null): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set(["UTC", ...zones, ...(saved ? [saved] : [])])].sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
}

export default async function SettingsPage() {
  const { user, headquarters: hq } = await requireDashboardAccess();
  const timeZone = timeZoneFrom(hq.timeZone);
  // In "auto" mode, accounts that still ask before posting keep asking; the page says how many.
  const connections = composioConfigured() ? await listConnections(hq.documentId).catch(() => []) : [];

  return (
    <SettingsView
      workspace={{
        timeZone,
        serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        timeZones: timeZoneOptions(timeZone),
        agentDefaults: agentDefaultsFrom(hq.agentDefaults),
        publishingApproval: publishingApprovalFrom(hq.publishingApproval),
        accountsAsking: connections.filter((c) => c.status === "active" && c.permission === "publish" && c.requireApproval).length,
      }}
      headquarters={{
        name: hq.name,
        nameMax: HEADQUARTERS_NAME_MAX,
        appearance: { style: hq.style, theme: hq.theme, height: hq.height, tint: hq.tint, icon: hq.icon, spire: hq.spire, trees: hq.trees },
      }}
      profile={{ displayName: hq.displayName ?? null, signInName: user.name ?? null, email: user.email }}
    />
  );
}
