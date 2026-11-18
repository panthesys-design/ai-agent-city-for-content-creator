"use client";

/* eslint-disable @next/next/no-img-element -- post media lives on ImageKit/Strapi hosts that vary per deployment. */

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, Clock, ExternalLink, Eye, FilePen, FolderOpen, ImagePlus, Link2, Loader2, Pencil,
  RefreshCw, Save, Send, Sparkles, Trash2, Undo2, X, XCircle,
} from "lucide-react";
import {
  MIN_SCHEDULE_LEAD_MS, draftReadiness, featuredApp, postStatusLabels, scheduleTimeProblem,
  type ConnectionRecord, type DraftReadiness, type PostStatus, type SocialPost,
} from "@/lib/connection-records";
import { UPLOAD_MAX_BYTES, extensionOf, formatBytes, uploadArtifactFile, uploadProblem } from "@/lib/upload-records";
import {
  deleteDraftAction, prepareDraftAction, publishNowAction, schedulePostAction, unschedulePostAction, updateDraftAction,
} from "./actions";
import styles from "./posted.module.css";

// Shared UI for posts (the Post and Calendar pages): the posts state with its actions, a post card with the actions its
// state allows, and the schedule / edit / detail dialogs. A draft is "ready" once an agent prepared it for a connected
// account (picked the app's publishing tool); then the user publishes or schedules it here.

export type ConnectionInfo = Pick<ConnectionRecord, "documentId" | "toolkit" | "toolkitName" | "status" | "permission">;

export const appName = (toolkit: string) => featuredApp(toolkit)?.name ?? toolkit;
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const formatWhen = (iso: string | null) => (iso ? longDate.format(new Date(iso)) : "");
export const STATUS_ICON: Record<PostStatus, typeof Send> = {
  draft: FilePen, scheduled: CalendarClock, publishing: Loader2, published: CheckCircle2, failed: XCircle, cancelled: XCircle,
};

const READINESS_TEXT: Record<DraftReadiness, string> = {
  ready: "Ready to publish",
  prepare: "Needs preparing for the connected account",
  connect: "Account not connected",
  posting: "Account is read-only",
};

/** `YYYY-MM-DDTHH:mm` in local time, for `<input type="datetime-local">`. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A sensible default time for scheduling: the suggestion if it's still ahead, else 9:00 on `day` or the next hour. */
export function defaultScheduleTime(post: Pick<SocialPost, "publishAt">, day?: Date): Date {
  const earliest = Date.now() + MIN_SCHEDULE_LEAD_MS + 60_000;
  const suggested = post.publishAt ? new Date(post.publishAt) : null;
  if (day) {
    const at = new Date(day);
    if (suggested) at.setHours(suggested.getHours(), suggested.getMinutes(), 0, 0); else at.setHours(9, 0, 0, 0);
    if (at.getTime() >= earliest) return at;
    const nextHour = new Date(earliest); nextHour.setMinutes(0, 0, 0); nextHour.setHours(nextHour.getHours() + 1);
    return nextHour.toDateString() === at.toDateString() ? nextHour : at;
  }
  if (suggested && suggested.getTime() >= earliest) return suggested;
  const next = new Date(earliest); next.setMinutes(0, 0, 0); next.setHours(next.getHours() + 1);
  return next;
}

// ---------- State and actions ----------

export function usePosts(initial: SocialPost[]) {
  const [posts, setPosts] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const replace = useCallback((post: SocialPost) => setPosts((list) => list.map((p) => (p.documentId === post.documentId ? post : p))), []);

  const run = useCallback(async (key: string, task: () => Promise<{ ok: boolean; error?: string }>, ok?: string) => {
    setBusy(key);
    try {
      const result = await task();
      if (!result.ok) setNotice({ tone: "error", text: result.error ?? "Something went wrong." });
      else if (ok) setNotice({ tone: "ok", text: ok });
      return result.ok;
    } finally {
      setBusy(null);
    }
  }, []);

  const actions = {
    publishNow: (post: SocialPost) => {
      if (!window.confirm(`Publish “${post.title}” to ${appName(post.toolkit)} now?`)) return Promise.resolve(false);
      return run(`publish:${post.documentId}`, async () => {
        const r = await publishNowAction(post.documentId);
        if (r.ok) replace(r.post);
        return r;
      }, `Published to ${appName(post.toolkit)}.`);
    },
    schedule: (post: SocialPost, iso: string) => run(`schedule:${post.documentId}`, async () => {
      const r = await schedulePostAction(post.documentId, iso);
      if (r.ok) replace(r.post);
      return r;
    }, `Scheduled for ${formatWhen(iso)}.`),
    unschedule: (post: SocialPost) => run(`unschedule:${post.documentId}`, async () => {
      const r = await unschedulePostAction(post.documentId);
      if (r.ok) replace(r.post);
      return r;
    }, "Moved back to drafts."),
    save: (post: SocialPost, input: { title: string; content: string; media: string[] }) => run(`edit:${post.documentId}`, async () => {
      const r = await updateDraftAction(post.documentId, input);
      if (r.ok) replace(r.post);
      return r;
    }, "Draft saved."),
    remove: (post: SocialPost) => {
      if (!window.confirm(`Delete the draft “${post.title}”?`)) return Promise.resolve(false);
      return run(`delete:${post.documentId}`, async () => {
        const r = await deleteDraftAction(post.documentId);
        if (r.ok) setPosts((list) => list.filter((p) => p.documentId !== post.documentId));
        return r;
      }, "Draft deleted.");
    },
    prepare: (post: SocialPost) => run(`prepare:${post.documentId}`, async () => prepareDraftAction(post.documentId),
      "Asked headquarters to prepare it. It shows as ready here once an agent is done (refresh to see it)."),
  };
  return { posts, setPosts, busy, notice, setNotice, actions };
}

export type PostActions = ReturnType<typeof usePosts>["actions"];

export function Notice({ notice, onClose }: { notice: { tone: "ok" | "error"; text: string } | null; onClose: () => void }) {
  return (
    <div aria-live="polite" className={styles.live}>
      {notice && (
        <p className={styles.notice} data-tone={notice.tone} role={notice.tone === "error" ? "alert" : undefined}>
          {notice.tone === "error" ? <AlertTriangle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
          <span>{notice.text}</span>
          <button type="button" className={styles.noticeClose} onClick={onClose} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
        </p>
      )}
    </div>
  );
}

// ---------- Card ----------

const isVideo = (url: string) => /\.(mp4|webm|mov)(\?|#|$)/i.test(url);

/** One image or video, filling its box. Videos show their first frame. */
function MediaThumb({ url, alt = "" }: { url: string; alt?: string }) {
  return isVideo(url)
    ? <video src={`${url}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" />
    : <img src={url} alt={alt} loading="lazy" />;
}

/** A round badge with the app's initial, so a card says where it goes at a glance. */
function AppBadge({ toolkit, size = 32 }: { toolkit: string; size?: number }) {
  const name = appName(toolkit);
  return <span className={styles.appBadge} data-app={toolkit} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

function StatusChip({ status }: { status: PostStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={styles.chip} data-status={status}>
      <Icon size={12} className={status === "publishing" ? styles.spin : undefined} aria-hidden="true" />{postStatusLabels[status]}
    </span>
  );
}

function whenText(post: SocialPost): string | null {
  if (post.status === "scheduled" || post.status === "publishing") return post.publishAt ? `Publishes ${formatWhen(post.publishAt)}` : null;
  if (post.status === "draft") return post.publishAt ? `Suggested ${formatWhen(post.publishAt)}` : post.createdAt ? `Created ${formatWhen(post.createdAt)}` : null;
  const at = post.publishedAt ?? post.publishAt ?? post.createdAt;
  return at ? `${post.status === "published" ? "Published" : "Updated"} ${formatWhen(at)}` : null;
}

/** One post as a card: where it goes, a cover preview of its media and text, and the actions its state allows. */
export function PostCard({ post, connections, schedulingEnabled, busy, actions, onSchedule, onEdit, onPreview }: {
  post: SocialPost; connections: ConnectionInfo[]; schedulingEnabled: boolean; busy: string | null; actions: PostActions;
  onSchedule: (post: SocialPost) => void; onEdit: (post: SocialPost) => void; onPreview?: (post: SocialPost) => void;
}) {
  const editable = post.status === "draft" || post.status === "failed";
  const readiness = editable ? draftReadiness(post, connections) : null;
  const spin = (key: string) => busy === `${key}:${post.documentId}`;
  const any = busy?.endsWith(post.documentId) ?? false;
  const scheduleTitle = schedulingEnabled ? undefined : "Scheduling needs CloudHike Jobs on the server; publish now instead.";
  const text = post.content ?? post.summary;
  const when = whenText(post);

  const preview = (
    <>
      {post.media.length > 0 && (
        <span className={styles.cover}>
          <MediaThumb url={post.media[0]} />
          {isVideo(post.media[0]) && <span className={styles.coverTag}>Video</span>}
          {post.media.length > 1 && <span className={styles.coverCount}>+{post.media.length - 1}</span>}
        </span>
      )}
      <span className={styles.cardText}>
        <span className={styles.title}>{post.title}</span>
        {text && <span className={styles.summary}>{text}</span>}
      </span>
    </>
  );

  return (
    <article className={styles.card} data-status={post.status}>
      <header className={styles.cardHead}>
        <AppBadge toolkit={post.toolkit} />
        <span className={styles.cardWho}>
          <strong>{appName(post.toolkit)}</strong>
          <span>{post.accountLabel ?? (post.agentName ? `by ${post.agentName}` : "No account yet")}</span>
        </span>
        <StatusChip status={post.status} />
      </header>

      {onPreview ? (
        <button type="button" className={styles.cardPreview} onClick={() => onPreview(post)} aria-label={`Preview ${post.title}`}>{preview}</button>
      ) : (
        <div className={styles.cardPreview}>{preview}</div>
      )}

      <div className={styles.cardInfo}>
        {when && <p className={styles.meta}><Clock size={12} aria-hidden="true" />{when}{post.agentName && post.accountLabel ? ` · by ${post.agentName}` : ""}</p>}
        {readiness && readiness !== "ready" && (
          <p className={styles.readiness} data-readiness={readiness}>
            <Sparkles size={13} aria-hidden="true" />{READINESS_TEXT[readiness]}
          </p>
        )}
        {post.error && post.status !== "published" && <p className={styles.error}>{post.error}</p>}
      </div>

      <footer className={styles.cardActions}>
        <div className={styles.cardMain}>
          {readiness === "ready" && (
            <>
              <button type="button" className={styles.primary} onClick={() => onSchedule(post)} disabled={any || !schedulingEnabled} title={scheduleTitle}>
                {spin("schedule") ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <CalendarClock size={14} aria-hidden="true" />}Schedule
              </button>
              <button type="button" className={styles.button} onClick={() => actions.publishNow(post)} disabled={any}>
                {spin("publish") ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}Publish
              </button>
            </>
          )}
          {readiness === "prepare" && (
            <button type="button" className={styles.primary} onClick={() => actions.prepare(post)} disabled={any} title="Headquarters asks an agent with access to pick the app's publishing tool">
              {spin("prepare") ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}Prepare
            </button>
          )}
          {(readiness === "connect" || readiness === "posting") && (
            <Link className={styles.primary} href="/dashboard/accounts"><Link2 size={14} aria-hidden="true" />{readiness === "connect" ? `Connect ${appName(post.toolkit)}` : "Allow posting"}</Link>
          )}
          {post.status === "scheduled" && (
            <>
              <button type="button" className={styles.button} onClick={() => onSchedule(post)} disabled={any || !schedulingEnabled} title={scheduleTitle}>
                <CalendarClock size={14} aria-hidden="true" />Reschedule
              </button>
              <button type="button" className={styles.button} onClick={() => actions.publishNow(post)} disabled={any}>
                {spin("publish") ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}Publish now
              </button>
            </>
          )}
          {post.url && <a className={styles.button} href={post.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />View</a>}
        </div>
        <div className={styles.cardTools}>
          {post.status === "scheduled" && (
            <button type="button" className={styles.iconButton} onClick={() => actions.unschedule(post)} disabled={any} aria-label="Unschedule" title="Move back to drafts">
              {spin("unschedule") ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : <Undo2 size={15} aria-hidden="true" />}
            </button>
          )}
          {post.artifactId && (
            <Link className={styles.iconButton} href={`/dashboard/artifacts?id=${encodeURIComponent(post.artifactId)}`} aria-label="Open the source artifact" title="Open the source artifact">
              <FolderOpen size={15} aria-hidden="true" />
            </Link>
          )}
          {post.status === "draft" && (
            <button type="button" className={styles.iconButton} onClick={() => onEdit(post)} disabled={any} aria-label={`Edit ${post.title}`} title="Edit">
              <Pencil size={15} aria-hidden="true" />
            </button>
          )}
          {(post.status === "draft" || post.status === "failed" || post.status === "cancelled") && (
            <button type="button" className={styles.iconButton} data-danger onClick={() => actions.remove(post)} disabled={any} aria-label={`Delete ${post.title}`} title="Delete">
              {spin("delete") ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

/** How the post reads on the app: account header, full text, and its media laid out like a feed post. */
export function PostPreview({ toolkit, accountLabel, title, content, media, when }: {
  toolkit: string; accountLabel: string | null; title: string; content: string; media: string[]; when?: string | null;
}) {
  const shown = media.slice(0, 4);
  return (
    <div className={styles.preview}>
      <div className={styles.previewHead}>
        <AppBadge toolkit={toolkit} size={38} />
        <span className={styles.cardWho}>
          <strong>{accountLabel ?? "Your account"}</strong>
          <span>{appName(toolkit)}{when ? ` · ${when}` : ""}</span>
        </span>
      </div>
      {title && <p className={styles.previewTitle}>{title}</p>}
      {content ? <p className={styles.previewText}>{content}</p> : <p className={styles.previewEmpty}>Your post text shows here.</p>}
      {shown.length > 0 && (
        <div className={styles.previewMedia} data-count={shown.length}>
          {shown.map((url, i) => {
            const more = i === 3 && media.length > 4 ? <span className={styles.previewMore}>+{media.length - 4}</span> : null;
            return isVideo(url) ? (
              <div key={`${url}-${i}`} className={styles.previewItem}><video src={url} controls playsInline preload="metadata" />{more}</div>
            ) : (
              <a key={`${url}-${i}`} href={url} target="_blank" rel="noopener noreferrer" className={styles.previewItem} aria-label={`Open image ${i + 1}`}>
                <img src={url} alt="" loading="lazy" />{more}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Dialogs ----------

/** A native modal: Escape and the backdrop close it, and focus returns to what opened it. */
export function Modal({ title, onClose, children, wide = false, size }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean; size?: "xl";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return (
    <dialog ref={dialog} className={styles.dialog} data-wide={wide || undefined} data-size={size} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.dialogInner}>
        <header className={styles.dialogHeader}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function ScheduleDialog({ post, initial, busy, onSchedule, onClose }: {
  post: SocialPost; initial: Date; busy: boolean; onSchedule: (iso: string) => Promise<boolean>; onClose: () => void;
}) {
  const [value, setValue] = useState(toLocalInput(initial));
  // The earliest allowed time, fixed when the dialog opens (the server checks the real minimum again).
  const [min] = useState(() => toLocalInput(new Date(Date.now() + MIN_SCHEDULE_LEAD_MS)));
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const date = new Date(value);
    const iso = Number.isNaN(date.getTime()) ? "" : date.toISOString();
    const problem = scheduleTimeProblem(iso);
    if (problem) { setError(problem); return; }
    if (await onSchedule(iso)) onClose();
  }

  return (
    <Modal title={post.status === "scheduled" ? "Reschedule post" : "Schedule post"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className={styles.dialogBody}>
          <p className={styles.dialogLead}><strong>{post.title}</strong> · {appName(post.toolkit)}{post.accountLabel ? ` (${post.accountLabel})` : ""}</p>
          <label className={styles.field} htmlFor={inputId}>
            <span>Publish on</span>
            <input id={inputId} type="datetime-local" value={value} min={min}
              onChange={(e) => { setValue(e.target.value); setError(null); }} required />
            <small>Your time zone: {zone}. It publishes automatically within a few minutes of this time.</small>
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
        <footer className={styles.dialogFooter}>
          <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <CalendarClock size={14} aria-hidden="true" />}
            {post.status === "scheduled" ? "Reschedule" : "Schedule"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

const MAX_MEDIA = 10;
const MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov";

/** Uploads one file to the media library through /api/uploads and returns its https URL. */
async function uploadMedia(file: File): Promise<string> {
  const problem = uploadProblem(file);
  if (problem) throw new Error(`${file.name}: ${problem}`);
  const ext = extensionOf(file.name);
  if (!/^(png|jpe?g|webp|gif|mp4|webm|mov)$/.test(ext)) throw new Error(`${file.name}: use an image (PNG, JPG, WebP, GIF) or a video (MP4, WebM, MOV).`);
  const artifact = await uploadArtifactFile<{ url?: string | null }>(file);
  if (!artifact.url) throw new Error(`We couldn't upload ${file.name}.`);
  return artifact.url;
}

export type DraftInput = { title: string; content: string; media: string[] };

export function EditDraftDialog({ post, busy, onSave, onClose }: {
  post: SocialPost; busy: boolean; onSave: (input: DraftInput) => Promise<boolean>; onClose: () => void;
}) {
  const [title, setTitle] = useState(post.title);
  const [content, setContent] = useState(post.content ?? post.summary ?? "");
  const [media, setMedia] = useState<string[]>(post.media);
  // Which slot is uploading: an index when replacing, "add" when adding.
  const [uploading, setUploading] = useState<number | "add" | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const target = useRef<number | "add">("add");
  const titleId = useId();
  const textId = useId();
  const urlId = useId();

  const mediaChanged = media.join("\n") !== post.media.join("\n");
  const changedText = content.trim() !== (post.content ?? "").trim();
  const needsPrepare = Boolean(post.toolSlug) && (changedText || mediaChanged);

  function pick(slot: number | "add") {
    target.current = slot;
    setMediaError(null);
    fileInput.current?.click();
  }

  async function onFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (!list.length) return;
    const slot = target.current;
    setUploading(slot);
    setMediaError(null);
    try {
      if (slot === "add") {
        const room = MAX_MEDIA - media.length;
        if (room <= 0) throw new Error(`A post can have up to ${MAX_MEDIA} images or videos.`);
        for (const file of list.slice(0, room)) {
          const url = await uploadMedia(file);
          setMedia((current) => [...current, url].slice(0, MAX_MEDIA));
        }
        if (list.length > room) setMediaError(`Only ${room} more fit; a post can have up to ${MAX_MEDIA}.`);
      } else {
        const url = await uploadMedia(list[0]);
        setMedia((current) => current.map((u, i) => (i === slot ? url : u)));
      }
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setUploading(null);
    }
  }

  function addUrl() {
    const url = urlDraft.trim();
    if (!/^https:\/\/\S+$/.test(url)) { setMediaError("Paste an https:// link to an image or video."); return; }
    if (media.length >= MAX_MEDIA) { setMediaError(`A post can have up to ${MAX_MEDIA} images or videos.`); return; }
    setMedia((current) => [...current, url]);
    setUrlDraft("");
    setMediaError(null);
  }

  const move = (from: number, to: number) => setMedia((current) => {
    if (to < 0 || to >= current.length) return current;
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (uploading !== null) return;
    if (await onSave({ title, content, media })) onClose();
  }

  return (
    <Modal title="Edit draft" onClose={onClose} size="xl">
      <form onSubmit={submit}>
        <div className={styles.editor}>
          <div className={styles.editorForm}>
            <p className={styles.dialogLead}>
              <AppBadge toolkit={post.toolkit} size={22} /> {appName(post.toolkit)}{post.accountLabel ? ` · ${post.accountLabel}` : ""}
              {post.agentName ? ` · written by ${post.agentName}` : ""}
            </p>
            <label className={styles.field} htmlFor={titleId}>
              <span>Title</span>
              <input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
              <small>For your reference; most apps only publish the text and media.</small>
            </label>
            <label className={styles.field} htmlFor={textId}>
              <span>Post text</span>
              <textarea id={textId} value={content} onChange={(e) => setContent(e.target.value)} rows={9} maxLength={20000} required />
              <small>{content.length.toLocaleString()} characters</small>
            </label>

            <fieldset className={styles.mediaField}>
              <legend>Images &amp; video <small>{media.length}/{MAX_MEDIA}</small></legend>
              <input ref={fileInput} type="file" accept={MEDIA_ACCEPT} multiple hidden onChange={(e) => onFiles(e.target.files)} />
              {media.length > 0 && (
                <ul className={styles.mediaGrid}>
                  {media.map((url, i) => (
                    <li key={`${url}-${i}`} className={styles.mediaTile}>
                      <span className={styles.mediaFrame}>
                        <MediaThumb url={url} alt={`Media ${i + 1}`} />
                        {i === 0 && <span className={styles.coverTag}>Cover</span>}
                        {uploading === i && <span className={styles.mediaBusy}><Loader2 size={18} className={styles.spin} aria-hidden="true" /></span>}
                      </span>
                      <span className={styles.mediaTools}>
                        <button type="button" className={styles.miniButton} onClick={() => pick(i)} disabled={uploading !== null} title="Replace with another file">
                          <RefreshCw size={12} aria-hidden="true" />Replace
                        </button>
                        <button type="button" className={styles.miniIcon} onClick={() => move(i, i - 1)} disabled={i === 0 || uploading !== null} aria-label={`Move media ${i + 1} earlier`} title="Move earlier">
                          <ArrowLeft size={12} aria-hidden="true" />
                        </button>
                        <button type="button" className={styles.miniIcon} onClick={() => move(i, i + 1)} disabled={i === media.length - 1 || uploading !== null} aria-label={`Move media ${i + 1} later`} title="Move later">
                          <ArrowRight size={12} aria-hidden="true" />
                        </button>
                        <button type="button" className={styles.miniIcon} data-danger onClick={() => setMedia((c) => c.filter((_, j) => j !== i))} disabled={uploading !== null} aria-label={`Remove media ${i + 1}`} title="Remove">
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {media.length < MAX_MEDIA && (
                <button type="button" className={styles.dropzone} onClick={() => pick("add")} disabled={uploading !== null}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); target.current = "add"; void onFiles(e.dataTransfer.files); }}>
                  {uploading === "add" ? <Loader2 size={18} className={styles.spin} aria-hidden="true" /> : <ImagePlus size={18} aria-hidden="true" />}
                  <span>
                    <strong>{uploading === "add" ? "Uploading…" : media.length ? "Add more images or video" : "Upload an image or video"}</strong>
                    <small>Click or drop files · PNG, JPG, WebP, GIF, MP4, WebM, MOV · up to {formatBytes(UPLOAD_MAX_BYTES)}</small>
                  </span>
                </button>
              )}
              <div className={styles.urlRow}>
                <label htmlFor={urlId} className={styles.srOnly}>Image or video link</label>
                <input id={urlId} type="url" placeholder="…or paste an https:// image link" value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }} />
                <button type="button" className={styles.button} onClick={addUrl} disabled={!urlDraft.trim() || media.length >= MAX_MEDIA}>Add</button>
              </div>
              {mediaError && <p className={styles.error} role="alert">{mediaError}</p>}
            </fieldset>

            {needsPrepare && <p className={styles.readiness} data-readiness="prepare"><Sparkles size={13} aria-hidden="true" />Changing the text or media means an agent has to prepare the draft again before it can publish.</p>}
          </div>

          <aside className={styles.editorPreview} aria-label="Preview">
            <p className={styles.previewLabel}><Eye size={13} aria-hidden="true" />Preview</p>
            <PostPreview toolkit={post.toolkit} accountLabel={post.accountLabel} title={title} content={content} media={media}
              when={post.publishAt ? formatWhen(post.publishAt) : null} />
          </aside>
        </div>
        <footer className={styles.dialogFooter}>
          <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={busy || uploading !== null}>
            {busy ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}Save changes
          </button>
        </footer>
      </form>
    </Modal>
  );
}

/** A read-only look at a post as it appears on the app, with its status and a shortcut to edit drafts. */
export function PreviewDialog({ post, onEdit, onClose }: { post: SocialPost; onEdit: (post: SocialPost) => void; onClose: () => void }) {
  const when = whenText(post);
  return (
    <Modal title={post.title} onClose={onClose} wide>
      <div className={styles.dialogBody}>
        <p className={styles.dialogLead}>
          <StatusChip status={post.status} />{when ? ` ${when}` : ""}{post.agentName ? ` · by ${post.agentName}` : ""}
        </p>
        <PostPreview toolkit={post.toolkit} accountLabel={post.accountLabel} title="" content={post.content ?? post.summary ?? ""} media={post.media}
          when={post.publishedAt ? formatWhen(post.publishedAt) : post.publishAt ? formatWhen(post.publishAt) : null} />
        {post.error && post.status !== "published" && <p className={styles.error}>{post.error}</p>}
      </div>
      <footer className={styles.dialogFooter}>
        {post.url && <a className={styles.button} href={post.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />View on {appName(post.toolkit)}</a>}
        {post.status === "draft" && (
          <button type="button" className={styles.primary} onClick={() => { onClose(); onEdit(post); }}><Pencil size={14} aria-hidden="true" />Edit</button>
        )}
        {post.status !== "draft" && <button type="button" className={styles.button} onClick={onClose}>Close</button>}
      </footer>
    </Modal>
  );
}

/**
 * The schedule, edit, and preview dialogs for a list of posts, driven by callbacks the cards call. Pages render this
 * once and pass `open.schedule` / `open.edit` / `open.preview` to their cards.
 */
export function usePostDialogs(state: ReturnType<typeof usePosts>) {
  const [scheduling, setScheduling] = useState<{ post: SocialPost; day?: Date } | null>(null);
  const [editing, setEditing] = useState<SocialPost | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const { posts, busy, actions } = state;
  // Look the previewed post up by id so the dialog reflects saves and status changes.
  const previewed = previewing ? posts.find((p) => p.documentId === previewing) ?? null : null;
  const dialogs = (
    <>
      {scheduling && (
        <ScheduleDialog post={scheduling.post} busy={busy === `schedule:${scheduling.post.documentId}`}
          initial={scheduling.post.status === "scheduled" && !scheduling.day && scheduling.post.publishAt ? new Date(scheduling.post.publishAt) : defaultScheduleTime(scheduling.post, scheduling.day)}
          onSchedule={(iso) => actions.schedule(scheduling.post, iso)} onClose={() => setScheduling(null)} />
      )}
      {editing && (
        <EditDraftDialog post={editing} busy={busy === `edit:${editing.documentId}`}
          onSave={(input) => actions.save(editing, input)} onClose={() => setEditing(null)} />
      )}
      {previewed && <PreviewDialog post={previewed} onEdit={(p) => setEditing(p)} onClose={() => setPreviewing(null)} />}
    </>
  );
  return {
    dialogs,
    open: {
      schedule: (post: SocialPost, day?: Date) => setScheduling({ post, day }),
      edit: (post: SocialPost) => setEditing(post),
      preview: (post: SocialPost) => setPreviewing(post.documentId),
    },
  };
}
