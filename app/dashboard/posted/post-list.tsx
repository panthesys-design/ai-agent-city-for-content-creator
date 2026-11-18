"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CalendarDays, FilePen } from "lucide-react";
import type { PostStatus, SocialPost } from "@/lib/connection-records";
import { Notice, PostCard, usePostDialogs, usePosts, type ConnectionInfo } from "./post-ui";
import styles from "./posted.module.css";

// The Post page: drafts agents wrote (to publish or schedule), scheduled posts (soonest first), published posts, and
// ones that didn't publish. Drafts come first because they are what the user acts on.

type Tab = "drafts" | "scheduled" | "published" | "other";
const TABS: { key: Tab; label: string; statuses: PostStatus[]; empty: string }[] = [
  { key: "drafts", label: "Drafts", statuses: ["draft"], empty: "No drafts. Ask an agent to draft posts for you to review, and they show up here." },
  { key: "scheduled", label: "Scheduled", statuses: ["scheduled", "publishing"], empty: "Nothing scheduled. Schedule a draft, or ask an agent to schedule a post." },
  { key: "published", label: "Published", statuses: ["published"], empty: "Nothing published yet." },
  { key: "other", label: "Not published", statuses: ["failed", "cancelled"], empty: "" },
];

const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);

function sorted(tab: Tab, posts: SocialPost[]) {
  const list = [...posts];
  if (tab === "scheduled") return list.sort((a, b) => time(a.publishAt) - time(b.publishAt));
  if (tab === "published") return list.sort((a, b) => time(b.publishedAt ?? b.createdAt) - time(a.publishedAt ?? a.createdAt));
  return list.sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

export function PostList({ initialPosts, connections, schedulingEnabled, error }: {
  initialPosts: SocialPost[]; connections: ConnectionInfo[]; schedulingEnabled: boolean; error: string | null;
}) {
  const state = usePosts(initialPosts);
  const { posts, busy, notice, setNotice, actions } = state;
  const { dialogs, open } = usePostDialogs(state);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, posts.filter((p) => t.statuses.includes(p.status)).length])) as Record<Tab, number>;
  const [tab, setTab] = useState<Tab>(() => (counts.drafts ? "drafts" : counts.scheduled ? "scheduled" : counts.published ? "published" : "drafts"));
  const current = TABS.find((t) => t.key === tab)!;
  const shown = sorted(tab, posts.filter((p) => current.statuses.includes(p.status)));

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.heading}>Post</h1>
          <p className={styles.lead}>Drafts your agents wrote, ready for you to publish or schedule, plus everything scheduled and published on your <Link href="/dashboard/accounts">connected accounts</Link>.</p>
        </div>
        <Link href="/dashboard/calendar" className={styles.button}><CalendarDays size={14} aria-hidden="true" />Calendar</Link>
      </header>
      {error && <p className={styles.alert} role="alert"><AlertTriangle size={15} aria-hidden="true" />{error}</p>}
      {!schedulingEnabled && (
        <p className={styles.hint}>Scheduling is off on this server (it needs CloudHike Jobs and a public APP_PUBLIC_URL). You can still publish drafts right away.</p>
      )}
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div className={styles.tabs} role="tablist" aria-label="Posts">
        {TABS.filter((t) => t.key !== "other" || counts.other).map((t) => (
          <button key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls="post-panel"
            className={styles.tab} onClick={() => setTab(t.key)}>
            {t.label}<span className={styles.tabCount}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div id="post-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {shown.length ? (
          <ul className={styles.grid}>
            {shown.map((post) => (
              <li key={post.documentId}>
                <PostCard post={post} connections={connections} schedulingEnabled={schedulingEnabled} busy={busy} actions={actions}
                  onSchedule={(p) => open.schedule(p)} onEdit={open.edit} onPreview={open.preview} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}><FilePen size={16} aria-hidden="true" />{current.empty}</p>
        )}
      </div>
      {dialogs}
    </section>
  );
}
