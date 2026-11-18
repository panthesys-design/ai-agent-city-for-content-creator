"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Cpu, Hand, Map as MapIcon, PauseCircle, Wrench } from "lucide-react";
import { AgentBuilding, themeAccent, type AgentStatus } from "@/components/agent-city";
import { agentRoleLabels, agentToolInfo } from "@/lib/agent-config";
import { toOffice, type AgentRecord } from "@/lib/agent-records";
import type { CitySnapshot } from "@/lib/city-live";
import { useCityLive } from "../use-city-live";
import styles from "./agents.module.css";

/** Recent run counts for one agent, computed on the server from its latest tasks. */
export type AgentRunStats = { runs: number; completed: number; failed: number; lastRunAt: string | null };

type LiveState = Pick<AgentRecord, "status" | "progress" | "activity">;

export const statusLabels: Record<AgentStatus, string> = {
  idle: "Idle", working: "Working", waiting: "Needs you", completed: "Done", failed: "Failed", error: "Error", offline: "Offline",
};

const ACTIVE: readonly AgentStatus[] = ["working", "waiting"];
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function ago(iso: string | null): string {
  if (!iso) return "Never";
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "Just now";
}

/** Agent cards with live status from `/api/city/stream`. Refreshes the page data when a run ends so stats and activity catch up. */
export function AgentCards({ agents, stats }: { agents: AgentRecord[]; stats: Record<string, AgentRunStats> }) {
  const router = useRouter();
  const [live, setLive] = useState<Record<string, LiveState>>({});
  const previous = useRef<Record<string, AgentStatus>>(Object.fromEntries(agents.map((a) => [a.documentId, a.status])));

  const onSnapshot = useCallback((snapshot: CitySnapshot) => {
    let finished = false;
    const next: Record<string, LiveState> = {};
    for (const { documentId, status, progress, activity } of snapshot.agents) {
      next[documentId] = { status, progress, activity };
      const before = previous.current[documentId];
      if (before && ACTIVE.includes(before) && !ACTIVE.includes(status)) finished = true;
      previous.current[documentId] = status;
    }
    setLive(next);
    if (finished) router.refresh();
  }, [router]);
  useCityLive(onSnapshot);

  const merged = useMemo(() => agents.map((a) => ({ ...a, ...live[a.documentId] })), [agents, live]);
  const count = (...statuses: AgentStatus[]) => merged.filter((a) => statuses.includes(a.status)).length;
  const summary = [
    { label: "Agents", value: merged.length, icon: Cpu, tone: "neutral" },
    { label: "Working", value: count("working"), icon: Activity, tone: "ok" },
    { label: "Need you", value: count("waiting"), icon: Hand, tone: "warn" },
    { label: "Failed", value: count("failed", "error"), icon: AlertTriangle, tone: "danger" },
  ] as const;

  return (
    <>
      <ul className={styles.summary} aria-label="Agent status summary">
        {summary.map(({ label, value, icon: Icon, tone }) => (
          <li key={label} className={styles.summaryItem} data-tone={tone}>
            <span className={styles.summaryIcon} aria-hidden="true"><Icon size={16} /></span>
            <span className={styles.summaryValue}>{value}</span>
            <span className={styles.summaryLabel}>{label}</span>
          </li>
        ))}
      </ul>

      {merged.length ? (
        <ul className={styles.grid}>
          {merged.map((agent) => <AgentCard key={agent.documentId} agent={agent} stats={stats[agent.documentId]} />)}
        </ul>
      ) : (
        <p className={styles.hint}>No agents yet. Add one from the City.</p>
      )}
    </>
  );
}

function AgentCard({ agent, stats }: { agent: AgentRecord; stats?: AgentRunStats }) {
  // toOffice returns a new object each call; memoise on the drawing fields so live status ticks don't redraw the SVG.
  // (Live updates spread over the server record, so `roof` keeps its array identity.)
  const { documentId, name, x, y, design, theme, icon, floors, glass, interior, roof, trees } = agent;
  const building = useMemo(
    () => toOffice({ documentId, name, x, y, design, theme, icon, floors, glass, interior, roof, trees } as AgentRecord),
    [documentId, name, x, y, design, theme, icon, floors, glass, interior, roof, trees],
  );
  const active = ACTIVE.includes(agent.status);
  const progress = agent.progress ?? null;
  const accent = themeAccent[agent.theme] ?? themeAccent.lavender;
  const titleId = `agent-${documentId}`;

  return (
    <li className={styles.card} data-status={agent.status} data-enabled={agent.enabled || undefined}
      style={{ "--agent-accent": accent } as React.CSSProperties} aria-labelledby={titleId}>
      <div className={styles.stage}>
        <AgentBuilding building={building} className={styles.building} />
        <span className={styles.badge} data-status={agent.status}>
          <span className={styles.dot} aria-hidden="true" />
          {statusLabels[agent.status]}
        </span>
        {!agent.enabled && <span className={styles.offTag}><PauseCircle size={12} aria-hidden="true" /> Disabled</span>}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <h3 id={titleId} className={styles.cardTitle}>{agent.name}</h3>
          <span className={styles.role}>{agentRoleLabels[agent.role]}</span>
        </div>

        <div className={styles.now} aria-live="polite">
          {active ? (
            <>
              <p className={styles.nowText}>{agent.activity ?? (agent.status === "waiting" ? "Waiting for your input" : "Working on a task")}</p>
              <div className={styles.meter} role="progressbar" aria-label={`${agent.name} progress`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined} data-indeterminate={progress === null || undefined}>
                <span style={{ width: progress === null ? undefined : `${progress}%` }} />
              </div>
            </>
          ) : (
            <p className={styles.instructions}>{agent.instructions}</p>
          )}
        </div>

        <ul className={styles.chips} aria-label="Tools">
          {agent.tools.length ? agent.tools.map((t) => <li key={t} title={agentToolInfo[t].description}>{agentToolInfo[t].label}</li>)
            : <li className={styles.chipEmpty}>No tools</li>}
        </ul>

        <dl className={styles.facts}>
          <div><dt><Cpu size={12} aria-hidden="true" /> Model</dt><dd><code>{agent.model ?? "default"}</code></dd></div>
          <div><dt><Wrench size={12} aria-hidden="true" /> Limits</dt><dd>{agent.settings.maxTurns} turns · {agent.settings.timeoutSeconds}s</dd></div>
          <div><dt><CheckCircle2 size={12} aria-hidden="true" /> Recent runs</dt>
            <dd>{stats?.runs ?? 0}{stats?.failed ? <span className={styles.failedCount}> · {stats.failed} failed</span> : null}</dd></div>
          <div><dt><Clock3 size={12} aria-hidden="true" /> Last run</dt><dd>{ago(stats?.lastRunAt ?? null)}</dd></div>
        </dl>
      </div>

      <div className={styles.cardFoot}>
        <Link href="/dashboard" className={styles.footLink}><MapIcon size={14} aria-hidden="true" /> Open in City</Link>
      </div>
    </li>
  );
}
