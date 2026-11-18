import type { Metadata } from "next";
import { jobsConfig } from "@/lib/ai/env";
import { listRecentTasks } from "@/lib/runtime-store";
import { requireDashboardAccess } from "../access";
import { loadPosts } from "../posted/load";
import { CalendarView, type WorkItem } from "./calendar-view";

export const metadata: Metadata = { title: "Calendar — Creator City" };

export default async function CalendarPage() {
  const { headquarters } = await requireDashboardAccess();
  const [{ posts, connections, error }, tasks] = await Promise.all([
    loadPosts(headquarters.documentId),
    listRecentTasks(headquarters, { limit: 200, rootOnly: true }).catch(() => []),
  ]);
  // Agent work: headquarters requests (not one-off chats with an agent), on the day they started.
  const work: WorkItem[] = tasks.filter((t) => !t.agentId).map((t) => ({
    id: t.documentId, title: t.title, status: t.status, at: t.startedAt ?? t.createdAt, finishedAt: t.finishedAt, steps: t.plan?.length ?? 0,
  })).filter((w): w is WorkItem => Boolean(w.at));
  return <CalendarView initialPosts={posts} connections={connections} work={work} schedulingEnabled={Boolean(jobsConfig())} error={error} />;
}
