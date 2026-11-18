import type { Metadata } from "next";
import type { AgentRecord } from "@/lib/agent-records";
import { listAgents } from "@/lib/agents";
import { listRecentTasks } from "@/lib/runtime-store";
import type { TaskRecord } from "@/lib/task-records";
import { requireDashboardAccess } from "../access";
import { PageIntro } from "../page-intro";
import { AgentCards, type AgentRunStats } from "./agent-cards";
import { TaskHistory } from "./task-history";
import styles from "./agents.module.css";

export const metadata: Metadata = { title: "Agents — Creator City" };

/** Per-agent counts over the latest tasks (including headquarters plan steps, which run as child tasks). */
function runStats(tasks: TaskRecord[]): Record<string, AgentRunStats> {
  const stats: Record<string, AgentRunStats> = {};
  for (const task of tasks) {
    if (!task.agentId) continue;
    const s = (stats[task.agentId] ??= { runs: 0, completed: 0, failed: 0, lastRunAt: null });
    s.runs += 1;
    if (task.status === "completed") s.completed += 1;
    if (task.status === "failed") s.failed += 1;
    const at = task.startedAt ?? task.createdAt;
    if (at && (!s.lastRunAt || at > s.lastRunAt)) s.lastRunAt = at;
  }
  return stats;
}

export default async function AgentsPage() {
  const { headquarters } = await requireDashboardAccess();
  let agents: AgentRecord[] = [];
  let activity: TaskRecord[] = [];
  let recent: TaskRecord[] = [];
  let loadError = false;
  try {
    [agents, activity, recent] = await Promise.all([
      listAgents(headquarters),
      listRecentTasks(headquarters, { limit: 25 }),
      listRecentTasks(headquarters, { limit: 100, rootOnly: false }),
    ]);
  } catch (error) {
    console.error(error);
    loadError = true;
  }

  return (
    <div className={styles.page}>
      <PageIntro title="Agents" lead="The AI agents working in your city, what they are doing right now, and everything they have run." />
      {loadError && <p role="alert" className={styles.error}>We couldn&apos;t load your agents. Refresh the page to try again.</p>}

      <section aria-labelledby="agents-heading" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="agents-heading" className={styles.heading}>Your agents</h2>
          <p className={styles.hint}>Change a model, tools, or limits from <em>AI settings</em> on the agent&apos;s building in the City.</p>
        </div>
        <AgentCards agents={agents} stats={runStats(recent)} />
      </section>

      <section aria-labelledby="activity-heading" className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 id="activity-heading" className={styles.heading}>Activity</h2>
          <p className={styles.hint}>Latest requests and runs. Open one to see its plan, tool calls, and output.</p>
        </div>
        {activity.length ? <TaskHistory tasks={activity} /> : <p className={styles.empty}>No runs yet. Ask headquarters or chat with an agent to start one.</p>}
      </section>
    </div>
  );
}
