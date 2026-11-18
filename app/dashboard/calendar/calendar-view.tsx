"use client";

import Link from "next/link";
import { useMemo, useState, type DragEvent } from "react";
import {
  AlertTriangle, Bot, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, GripVertical, List, Plus,
} from "lucide-react";
import { draftReadiness, postDate, postStatusLabels, type SocialPost } from "@/lib/connection-records";
import type { TaskStatus } from "@/lib/task-records";
import {
  Modal, Notice, PostCard, STATUS_ICON, appName, formatWhen, usePostDialogs, usePosts, type ConnectionInfo,
} from "../posted/post-ui";
import styles from "./calendar.module.css";

// The Calendar: a month grid (or agenda list) of posts — scheduled, published, failed, and drafts at their suggested
// time — and headquarters' work. Drafts sit in a tray; dragging one (or a scheduled post) onto a day opens the
// schedule dialog for that day, and every item opens with the same actions as on the Post page.

export type WorkItem = { id: string; title: string; status: TaskStatus; at: string; finishedAt: string | null; steps: number };

type Show = { posts: boolean; drafts: boolean; work: boolean };
type Entry = { kind: "post"; post: SocialPost; at: Date } | { kind: "work"; work: WorkItem; at: Date };

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthTitle = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayTitle = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const WORK_LABEL: Record<TaskStatus, string> = { queued: "Queued", running: "Running", completed: "Done", failed: "Failed", cancelled: "Cancelled" };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** The 42 days (6 weeks, Monday first) shown for a month. */
function monthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function CalendarView({ initialPosts, connections, work, schedulingEnabled, error }: {
  initialPosts: SocialPost[]; connections: ConnectionInfo[]; work: WorkItem[]; schedulingEnabled: boolean; error: string | null;
}) {
  const state = usePosts(initialPosts);
  const { posts, busy, notice, setNotice, actions } = state;
  const { dialogs, open } = usePostDialogs(state);
  const [view, setView] = useState<"month" | "agenda">("month");
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState<Date | null>(null);
  const [opened, setOpened] = useState<{ kind: "post"; id: string } | { kind: "work"; work: WorkItem } | null>(null);
  const [show, setShow] = useState<Show>({ posts: true, drafts: true, work: true });
  const [dropDay, setDropDay] = useState<string | null>(null);
  const today = useMemo(() => startOfDay(new Date()), []);

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    const add = (entry: Entry) => map.set(dayKey(entry.at), [...(map.get(dayKey(entry.at)) ?? []), entry]);
    for (const post of posts) {
      if (post.status === "draft" ? !show.drafts : !show.posts) continue;
      const iso = postDate(post);
      if (iso) add({ kind: "post", post, at: new Date(iso) });
    }
    if (show.work) for (const w of work) add({ kind: "work", work: w, at: new Date(w.at) });
    for (const list of map.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
    return map;
  }, [posts, work, show]);

  const drafts = posts.filter((p) => p.status === "draft" || p.status === "failed")
    .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));
  const readyDrafts = drafts.filter((p) => draftReadiness(p, connections) === "ready");
  const openedPost = opened?.kind === "post" ? posts.find((p) => p.documentId === opened.id) ?? null : null;

  // ---------- Drag and drop ----------
  function onDragStart(event: DragEvent, post: SocialPost) {
    event.dataTransfer.setData("text/x-creator-post", post.documentId);
    event.dataTransfer.effectAllowed = "move";
  }
  function canDropOn(day: Date) { return day.getTime() >= today.getTime(); }
  function onDrop(event: DragEvent, day: Date) {
    event.preventDefault();
    setDropDay(null);
    const id = event.dataTransfer.getData("text/x-creator-post");
    const post = posts.find((p) => p.documentId === id);
    if (!post || !canDropOn(day)) return;
    scheduleOn(post, day);
  }
  function scheduleOn(post: SocialPost, day?: Date) {
    if (!schedulingEnabled) { setNotice({ tone: "error", text: "Scheduling is off on this server (it needs CloudHike Jobs). Publish the draft from the Post page instead." }); return; }
    if (post.status !== "scheduled") {
      const readiness = draftReadiness(post, connections);
      if (readiness !== "ready") {
        setNotice({ tone: "error", text: readiness === "prepare" ? `“${post.title}” isn't prepared yet. Use “Prepare with agent” first.` : `Connect ${appName(post.toolkit)} with posting allowed before scheduling “${post.title}”.` });
        return;
      }
    }
    open.schedule(post, day);
  }

  // ---------- Rendering helpers ----------
  const chip = (entry: Entry) => {
    if (entry.kind === "work") {
      const w = entry.work;
      return (
        <button key={`w:${w.id}`} type="button" className={styles.chip} data-kind="work" data-status={w.status}
          onClick={(e) => { e.stopPropagation(); setOpened({ kind: "work", work: w }); }}
          aria-label={`Agent work: ${w.title}, ${WORK_LABEL[w.status]}, ${timeOnly.format(entry.at)}`}>
          <Bot size={11} aria-hidden="true" /><span className={styles.chipTime}>{timeOnly.format(entry.at)}</span><span className={styles.chipText}>{w.title}</span>
        </button>
      );
    }
    const p = entry.post;
    const Icon = STATUS_ICON[p.status];
    const draggable = p.status === "scheduled" || p.status === "draft";
    return (
      <button key={p.documentId} type="button" className={styles.chip} data-kind="post" data-status={p.status} draggable={draggable}
        onDragStart={draggable ? (e) => onDragStart(e, p) : undefined}
        onClick={(e) => { e.stopPropagation(); setOpened({ kind: "post", id: p.documentId }); }}
        aria-label={`${postStatusLabels[p.status]}${p.status === "draft" ? " (suggested time)" : ""}: ${p.title} on ${appName(p.toolkit)}, ${timeOnly.format(entry.at)}`}>
        <Icon size={11} aria-hidden="true" /><span className={styles.chipTime}>{timeOnly.format(entry.at)}</span>
        <span className={styles.chipText}>{appName(p.toolkit)} · {p.title}</span>
      </button>
    );
  };

  const days = monthDays(month);
  const selectedEntries = selected ? byDay.get(dayKey(selected)) ?? [] : [];

  // Agenda: from today on (posts and work), grouped by day.
  const agenda = useMemo(() => [...byDay.entries()]
    .map(([, entries]) => ({ day: startOfDay(entries[0].at), entries }))
    .filter(({ day }) => day.getTime() >= today.getTime())
    .sort((a, b) => a.day.getTime() - b.day.getTime()), [byDay, today]);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.heading}>Calendar</h1>
          <p className={styles.lead}>Scheduled and published posts, drafts waiting for a time, and your agents&apos; work. Drag a draft onto a day to schedule it.</p>
        </div>
        <Link href="/dashboard/posted" className={styles.button}><List size={14} aria-hidden="true" />All posts</Link>
      </header>
      {error && <p className={styles.alert} role="alert"><AlertTriangle size={15} aria-hidden="true" />{error}</p>}
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div className={styles.toolbar}>
        <div className={styles.nav}>
          <button type="button" className={styles.iconButton} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" disabled={view === "agenda"}><ChevronLeft size={16} aria-hidden="true" /></button>
          <button type="button" className={styles.button} onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(today); }}>Today</button>
          <button type="button" className={styles.iconButton} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" disabled={view === "agenda"}><ChevronRight size={16} aria-hidden="true" /></button>
          <h2 className={styles.month} aria-live="polite">{view === "month" ? monthTitle.format(month) : "Upcoming"}</h2>
        </div>
        <div className={styles.filters} role="group" aria-label="Show on the calendar">
          {([["posts", "Posts"], ["drafts", "Drafts"], ["work", "Agent work"]] as const).map(([key, label]) => (
            <label key={key} className={styles.filter} data-kind={key}>
              <input type="checkbox" checked={show[key]} onChange={(e) => setShow((s) => ({ ...s, [key]: e.target.checked }))} />{label}
            </label>
          ))}
        </div>
        <div className={styles.segmented} role="group" aria-label="View">
          <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}><CalendarDays size={14} aria-hidden="true" />Month</button>
          <button type="button" aria-pressed={view === "agenda"} onClick={() => setView("agenda")}><List size={14} aria-hidden="true" />Agenda</button>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.main}>
          {view === "month" ? (
            <div className={styles.grid} role="grid" aria-label={monthTitle.format(month)}>
              <div className={styles.weekdays} role="row">
                {DAY_NAMES.map((d) => <span key={d} role="columnheader">{d}</span>)}
              </div>
              {Array.from({ length: 6 }, (_, week) => (
                <div key={week} className={styles.week} role="row">
                  {days.slice(week * 7, week * 7 + 7).map((day) => {
                    const key = dayKey(day);
                    const entries = byDay.get(key) ?? [];
                    const outside = day.getMonth() !== month.getMonth();
                    const isToday = key === dayKey(today);
                    const past = day.getTime() < today.getTime();
                    return (
                      <div key={key} role="gridcell" className={styles.day} data-outside={outside || undefined} data-today={isToday || undefined}
                        data-past={past || undefined} data-selected={selected && dayKey(selected) === key ? true : undefined} data-drop={dropDay === key || undefined}
                        onDragOver={(e) => { if (canDropOn(day)) { e.preventDefault(); setDropDay(key); } }}
                        onDragLeave={() => setDropDay((d) => (d === key ? null : d))}
                        onDrop={(e) => onDrop(e, day)}>
                        <button type="button" className={styles.dayNumber} onClick={() => setSelected(day)}
                          aria-label={`${dayTitle.format(day)}${entries.length ? `, ${entries.length} item${entries.length === 1 ? "" : "s"}` : ""}`}>
                          {day.getDate()}
                        </button>
                        <div className={styles.chips}>
                          {entries.slice(0, 3).map(chip)}
                          {entries.length > 3 && <button type="button" className={styles.more} onClick={() => setSelected(day)}>+{entries.length - 3} more</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.agenda}>
              {agenda.length ? agenda.map(({ day, entries }) => (
                <section key={dayKey(day)} className={styles.agendaDay} aria-label={dayTitle.format(day)}>
                  <h3>{dayKey(day) === dayKey(today) ? "Today" : dayTitle.format(day)}</h3>
                  <div className={styles.agendaItems}>{entries.map(chip)}</div>
                </section>
              )) : <p className={styles.empty}>Nothing coming up. Schedule a draft, or ask an agent to plan your posts.</p>}
            </div>
          )}

          {selected && view === "month" && (
            <section className={styles.dayPanel} aria-label={dayTitle.format(selected)}>
              <header>
                <h3>{dayTitle.format(selected)}</h3>
                <button type="button" className={styles.linkButton} onClick={() => setSelected(null)}>Close</button>
              </header>
              {selectedEntries.length ? <div className={styles.agendaItems}>{selectedEntries.map(chip)}</div> : <p className={styles.muted}>Nothing on this day.</p>}
              {selected.getTime() >= today.getTime() && readyDrafts.length > 0 && schedulingEnabled && (
                <div className={styles.quickSchedule}>
                  <p className={styles.muted}>Schedule a draft on this day:</p>
                  {readyDrafts.slice(0, 6).map((p) => (
                    <button key={p.documentId} type="button" className={styles.button} onClick={() => scheduleOn(p, selected)}>
                      <Plus size={13} aria-hidden="true" />{appName(p.toolkit)} · {p.title}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className={styles.tray} aria-label="Drafts">
          <h2 className={styles.trayTitle}>Drafts <span className={styles.count}>{drafts.length}</span></h2>
          {drafts.length ? (
            <ul className={styles.trayList}>
              {drafts.map((p) => {
                const readiness = draftReadiness(p, connections);
                return (
                  <li key={p.documentId} className={styles.trayItem} draggable onDragStart={(e) => onDragStart(e, p)} data-ready={readiness === "ready" || undefined}>
                    <GripVertical size={14} className={styles.grip} aria-hidden="true" />
                    <button type="button" className={styles.trayText} onClick={() => setOpened({ kind: "post", id: p.documentId })}>
                      <strong>{p.title}</strong>
                      <span>{appName(p.toolkit)} · {p.status === "failed" ? "Failed, retry" : readiness === "ready" ? "Ready" : readiness === "prepare" ? "Needs preparing" : "Not connected"}{p.publishAt ? ` · suggested ${formatWhen(p.publishAt)}` : ""}</span>
                    </button>
                    {readiness === "ready" && (
                      <button type="button" className={styles.iconButton} onClick={() => scheduleOn(p)} aria-label={`Schedule ${p.title}`} title="Schedule" disabled={!schedulingEnabled}>
                        <CalendarClock size={14} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : <p className={styles.muted}>No drafts. Ask an agent to draft posts, and they wait here to be scheduled.</p>}
          {!schedulingEnabled && <p className={styles.hint}>Scheduling needs CloudHike Jobs on the server. You can still publish drafts now.</p>}
        </aside>
      </div>

      {openedPost && (
        <Modal title={postStatusLabels[openedPost.status] === "Draft" ? "Draft post" : `${postStatusLabels[openedPost.status]} post`} onClose={() => setOpened(null)} wide>
          <div className={styles.dialogBody}>
            <PostCard post={openedPost} connections={connections} schedulingEnabled={schedulingEnabled} busy={busy} actions={actions}
              onSchedule={(p) => scheduleOn(p)} onEdit={open.edit} />
          </div>
        </Modal>
      )}
      {opened?.kind === "work" && (
        <Modal title="Agent work" onClose={() => setOpened(null)}>
          <div className={styles.dialogBody}>
            <p className={styles.workTitle}>{opened.work.title}</p>
            <p className={styles.muted}>
              {WORK_LABEL[opened.work.status]} · started {formatWhen(opened.work.at)}
              {opened.work.finishedAt ? ` · finished ${formatWhen(opened.work.finishedAt)}` : ""}
              {opened.work.steps ? ` · ${opened.work.steps} step${opened.work.steps === 1 ? "" : "s"}` : ""}
            </p>
            <p><Link className={styles.button} href="/dashboard/artifacts">See what agents made</Link></p>
          </div>
        </Modal>
      )}
      {dialogs}
    </section>
  );
}
