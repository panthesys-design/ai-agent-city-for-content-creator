import type { Metadata } from "next";
import type { AgentRecord } from "@/lib/agent-records";
import { ensureStarterAgents } from "@/lib/agents";
import type { CitySnapshot } from "@/lib/city-live";
import type { CityStats } from "@/lib/city-stats";
import { cityStats } from "@/lib/stats";
import { computersEnabled } from "@/lib/computer/client";
import { headquartersQueue } from "@/lib/runtime-store";
import { toHeadquartersSpec } from "@/lib/headquarters";
import { requireDashboardAccess } from "./access";
import { CityView } from "./city-view";

export const metadata: Metadata = { title: "City — Creator City" };

export default async function CityPage() {
  const { headquarters } = await requireDashboardAccess();
  let agents: AgentRecord[] = [];
  let task: CitySnapshot["task"] = null;
  let queue: CitySnapshot["queue"] = [];
  let others: CitySnapshot["others"] = [];
  let loadError = false;
  try {
    // A new city gets its six starter agents on first visit; afterwards this only reads.
    agents = await ensureStarterAgents(headquarters);
  } catch (error) {
    console.error(error);
    loadError = true;
  }
  try {
    const { current, others: running, waiting } = await headquartersQueue(headquarters);
    task = current;
    others = running.map(({ documentId, title, progress, activity }) => ({ documentId, title, progress, activity }));
    queue = waiting.map(({ documentId, title, createdAt }) => ({ documentId, title, createdAt }));
  } catch (error) {
    // Agent tasks are optional for drawing the city; the live stream retries.
    console.error(error);
  }
  // Counts plus cached platform numbers; the cards fetch fresh platform numbers after the page renders.
  const stats: CityStats | null = await cityStats(headquarters).catch((error: unknown) => { console.error(error); return null; });
  return <CityView initialStats={stats} headquarters={toHeadquartersSpec(headquarters)} initialAgents={agents} initialTask={task} initialQueue={queue} initialOthers={others} loadError={loadError} computersEnabled={computersEnabled()} />;
}
