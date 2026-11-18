"use client";

import { useState } from "react";
import { Ban, Building2, CheckCircle2, ChevronRight, Clock3, Loader2, XCircle } from "lucide-react";
import type { TaskEvent, TaskRecord, TaskStatus } from "@/lib/task-records";
import { taskEventsAction } from "../runtime-actions";
import styles from "./agents.module.css";

const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });
const when = (iso: string | null, format = time) => (iso ? format.format(new Date(iso)) : "—");

const statusIcon: Record<TaskStatus, typeof Clock3> = {
  queued: Clock3, running: Loader2, completed: CheckCircle2, failed: XCircle, cancelled: Ban,
};

/** Recent tasks; expanding one loads its execution events (tool calls, delegations, outcome). */
export function TaskHistory({ tasks }: { tasks: TaskRecord[] }) {
  return (
    <ul className={styles.tasks}>
      {tasks.map((task) => <TaskItem key={task.documentId} task={task} />)}
    </ul>
  );
}

function TaskItem({ task }: { task: TaskRecord }) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(open: boolean) {
    if (!open || events || loading) return;
    setLoading(true);
    const result = await taskEventsAction(task.documentId).catch(() => null);
    if (result?.ok) setEvents(result.events);
    else setError(result?.error ?? "We couldn't load the task history.");
    setLoading(false);
  }

  const Icon = statusIcon[task.status];
  return (
    <li className={styles.task} data-status={task.status}>
      <span className={styles.marker} aria-hidden="true">
        <Icon size={14} className={task.status === "running" ? styles.spin : undefined} />
      </span>
      <details onToggle={(e) => void toggle(e.currentTarget.open)}>
        <summary>
          <ChevronRight size={14} className={styles.chevron} aria-hidden="true" />
          <span className={styles.taskTitle}>{task.title}</span>
          <span className={styles.taskMeta}>
            {task.agentName ?? <><Building2 size={12} aria-hidden="true" /> Headquarters</>}
            <span aria-hidden="true">·</span>
            <time dateTime={task.createdAt ?? undefined}>{when(task.createdAt)}</time>
          </span>
          <span className={styles.status} data-status={task.status}>{task.status}</span>
        </summary>
        <div className={styles.taskBody}>
          {task.error && <p className={styles.error}>{task.error}</p>}
          {task.plan?.length ? (
            <ol className={styles.plan}>
              {task.plan.map((s) => <li key={s.id} data-status={s.status}><strong>{s.agentName}</strong> — {s.title} <em>({s.status})</em></li>)}
            </ol>
          ) : null}
          {loading && <p className={styles.hint}><Loader2 size={12} className={styles.spin} aria-hidden="true" /> Loading events…</p>}
          {error && <p className={styles.error}>{error}</p>}
          {events && (events.length ? (
            <ol className={styles.events}>
              {events.map((e) => (
                <li key={e.documentId} data-type={e.type}>
                  <time>{when(e.createdAt, clock)}</time>
                  <span className={styles.eventType}>{e.type.replace("_", " ")}</span>
                  <span>{e.agentName ? <strong>{e.agentName}: </strong> : null}{e.summary}</span>
                </li>
              ))}
            </ol>
          ) : <p className={styles.hint}>No events recorded.</p>)}
          {task.output && <pre className={styles.output}>{task.output}</pre>}
        </div>
      </details>
    </li>
  );
}
