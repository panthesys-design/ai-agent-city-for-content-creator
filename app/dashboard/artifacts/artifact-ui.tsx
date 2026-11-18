"use client";

/* eslint-disable @next/next/no-img-element -- artifact files live on ImageKit/Strapi hosts that vary per deployment, so
   they are shown as plain images rather than through next/image's remote-pattern allowlist. */

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  AudioLines, BookOpen, Check, Clapperboard, Copy, Download, ExternalLink, FileText, FolderOpen, Image as ImageIcon,
  ListOrdered, ListTree, Loader2, PenLine, ScrollText, Send, X, type LucideIcon,
} from "lucide-react";
import {
  artifactCategoryLabels, downloadName, timelineScenes,
  type ArtifactCategory, type ArtifactRecord, type ArtifactSummary, type ArtifactType,
} from "@/lib/artifact-records";
import { getArtifactAction } from "./actions";
import { Markdown } from "./markdown";
import styles from "./artifacts.module.css";

// Shared artifact UI: icons, full previews, copy/download actions, the chat card, and the preview dialog.
// Used by the city chat and the Artifacts page.

const CATEGORY_ICON: Partial<Record<ArtifactCategory, LucideIcon>> = {
  script: ScrollText, research: BookOpen, topics: ListOrdered, outline: ListTree, copy: PenLine, publication: Send,
};
const TYPE_ICON: Record<ArtifactType, LucideIcon> = { document: FileText, image: ImageIcon, audio: AudioLines, video: Clapperboard };

export function ArtifactIcon({ artifact, size = 16 }: { artifact: Pick<ArtifactSummary, "type" | "category">; size?: number }) {
  const Icon = (artifact.type === "document" && CATEGORY_ICON[artifact.category]) || TYPE_ICON[artifact.type];
  return <Icon size={size} aria-hidden="true" />;
}

export const artifactHref = (id: string) => `/dashboard/artifacts?id=${encodeURIComponent(id)}`;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatWhen = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : "");

/** One line under a title: kind · agent · when. */
export function artifactMeta(a: ArtifactSummary, { withDate = true } = {}) {
  return [artifactCategoryLabels[a.category], a.agentName ?? "Headquarters", withDate ? formatWhen(a.createdAt) : ""].filter(Boolean).join(" · ");
}

// ---------- Loading full artifacts ----------

const cache = new Map<string, ArtifactRecord>();
export const forgetArtifact = (id: string) => cache.delete(id);

/** The full artifact (with document text and timeline data), loaded once per page and cached. */
export function useArtifact(id: string | null) {
  const [state, setState] = useState<{ id: string | null; artifact: ArtifactRecord | null; error: string | null }>(
    () => ({ id, artifact: id ? cache.get(id) ?? null : null, error: null }),
  );
  // Reset when the id changes (during render, so a stale preview never shows for the new id).
  if (state.id !== id) setState({ id, artifact: id ? cache.get(id) ?? null : null, error: null });

  useEffect(() => {
    if (!id || cache.has(id)) return;
    let alive = true;
    getArtifactAction(id).then(
      (result) => {
        if (!alive) return;
        if (result.ok) { cache.set(id, result.artifact); setState({ id, artifact: result.artifact, error: null }); }
        else setState({ id, artifact: null, error: result.error });
      },
      () => alive && setState({ id, artifact: null, error: "We couldn't open this artifact. Please try again." }),
    );
    return () => { alive = false; };
  }, [id]);

  const current = state.id === id ? state : { artifact: null, error: null };
  return { artifact: current.artifact, error: current.error, loading: Boolean(id) && !current.artifact && !current.error };
}

// ---------- Full preview ----------

export function ArtifactPreview({ artifact }: { artifact: ArtifactRecord }) {
  if (artifact.type === "image") {
    return (
      <figure className={styles.imagePreview}>
        {artifact.url ? <img src={artifact.url} alt={artifact.content ?? artifact.title} /> : <p className={styles.muted}>The image file is missing.</p>}
        {artifact.content && <figcaption><span className={styles.label}>Prompt</span>{artifact.content}</figcaption>}
      </figure>
    );
  }
  if (artifact.type === "audio") {
    return (
      <div className={styles.audioPreview}>
        <div className={styles.audioPlayer}>
          <span className={styles.audioArt} aria-hidden="true"><AudioLines size={28} /></span>
          {artifact.url ? <audio controls preload="metadata" src={artifact.url} aria-label={`Play ${artifact.title}`} /> : <p className={styles.muted}>The audio file is missing.</p>}
        </div>
        {artifact.content && (
          <section className={styles.transcript} aria-label="Script">
            <span className={styles.label}>Script</span>
            <p>{artifact.content}</p>
          </section>
        )}
      </div>
    );
  }
  if (artifact.type === "video") {
    if (artifact.url && artifact.mimeType?.startsWith("video/")) {
      return <video className={styles.videoPreview} controls preload="metadata" src={artifact.url} aria-label={artifact.title} />;
    }
    const scenes = timelineScenes(artifact.data);
    if (scenes.length) return <Storyboard artifact={artifact} />;
  }
  return artifact.content
    ? <article className={styles.paper}><Markdown variant="document">{artifact.content}</Markdown></article>
    : <p className={styles.muted}>This artifact has no content.</p>;
}

function Storyboard({ artifact }: { artifact: ArtifactRecord }) {
  const scenes = timelineScenes(artifact.data);
  const data = artifact.data ?? {};
  const total = Number(data.totalSeconds) || scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const facts = [
    typeof data.aspectRatio === "string" ? data.aspectRatio : null,
    `${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}`,
    `${scenes.length} scene${scenes.length === 1 ? "" : "s"}`,
    typeof data.music === "string" && data.music ? `Music: ${data.music}` : null,
  ].filter(Boolean);
  return (
    <div className={styles.storyboard}>
      <p className={styles.storyFacts}>{facts.join(" · ")}</p>
      <ol className={styles.scenes}>
        {scenes.map((scene) => (
          <li key={scene.order} className={styles.scene}>
            <div className={styles.sceneThumb}>
              {scene.imageUrl ? <img src={scene.imageUrl} alt={scene.caption ?? `Scene ${scene.order}`} loading="lazy" /> : <span>No visual</span>}
            </div>
            <div className={styles.sceneBody}>
              <p className={styles.sceneHead}>
                <strong>Scene {scene.order}</strong>
                <span>{scene.durationSeconds}s{scene.transition ? ` · ${scene.transition}` : ""}</span>
              </p>
              {scene.caption && <p className={styles.sceneCaption}>{scene.caption}</p>}
              {scene.narration && <p className={styles.sceneNarration}>{scene.narration}</p>}
              {scene.audioUrl && <audio controls preload="none" src={scene.audioUrl} aria-label={`Scene ${scene.order} audio`} />}
            </div>
          </li>
        ))}
      </ol>
      {typeof data.notes === "string" && data.notes && <p className={styles.storyNotes}><span className={styles.label}>Notes</span>{data.notes}</p>}
    </div>
  );
}

// ---------- Actions ----------

/** Copy and download for text; open the original file for media. */
export function ArtifactActions({ artifact }: { artifact: ArtifactRecord }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  const text = artifact.type === "document" || artifact.type === "video" ? artifact.content : null;
  function download() {
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: downloadName(artifact, "md") });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      {text && (
        <>
          <button type="button" className={styles.toolButton} onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => undefined)}>
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className={styles.toolButton} onClick={download}><Download size={14} aria-hidden="true" />Download</button>
        </>
      )}
      {artifact.url && artifact.type !== "document" && (
        <a className={styles.toolButton} href={artifact.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} aria-hidden="true" />Open file
        </a>
      )}
    </>
  );
}

// ---------- Thumbnails ----------

/** True when the artifact's `url` is the video file itself (an upload or rendered export), not a timeline's still image. */
export const isVideoFile = (artifact: Pick<ArtifactSummary, "mimeType" | "url">) =>
  Boolean(artifact.url) && (artifact.mimeType?.startsWith("video/") || /\.(mp4|webm|mov)(\?|#|$)/i.test(artifact.url ?? ""));

/**
 * A still for an image or video artifact. Video files show their first frame (muted, no autoplay), since `<img>`
 * can't render an .mp4; timeline videos keep their image URL.
 */
export function MediaThumb({ artifact }: { artifact: Pick<ArtifactSummary, "mimeType" | "url"> }) {
  if (!artifact.url) return null;
  if (isVideoFile(artifact)) {
    // `#t=0.1` makes browsers (Safari especially) paint a frame instead of a blank box once metadata loads.
    const src = artifact.url.includes("#") ? artifact.url : `${artifact.url}#t=0.1`;
    return <video src={src} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" />;
  }
  return <img src={artifact.url} alt="" loading="lazy" />;
}

// ---------- Chat card ----------

/**
 * A compact preview of an artifact under a chat reply. The main area opens the full preview dialog; audio plays
 * in place. The folder button jumps to the artifact on the Artifacts page.
 */
export function ArtifactCard({ artifact, onOpen }: { artifact: ArtifactSummary; onOpen: (artifact: ArtifactSummary) => void }) {
  const visual = (artifact.type === "image" || artifact.type === "video") && artifact.url;
  return (
    <div className={styles.card} data-type={artifact.type}>
      <button type="button" className={styles.cardMain} onClick={() => onOpen(artifact)} aria-label={`Open ${artifact.title}`}>
        {visual ? (
          <span className={styles.cardMedia}>
            <MediaThumb artifact={artifact} />
            {artifact.type === "video" && <span className={styles.cardBadge}><Clapperboard size={12} aria-hidden="true" />{isVideoFile(artifact) ? "Video" : "Timeline"}</span>}
          </span>
        ) : null}
        <span className={styles.cardBody}>
          <span className={styles.cardHead}>
            <span className={styles.typeIcon} data-type={artifact.type}><ArtifactIcon artifact={artifact} size={15} /></span>
            <span className={styles.cardText}>
              <span className={styles.cardTitle}>{artifact.title}</span>
              <span className={styles.cardMeta}>{artifactMeta(artifact, { withDate: false })}</span>
            </span>
          </span>
          {artifact.type === "document" && (artifact.summary || artifact.excerpt) && (
            <span className={styles.cardExcerpt}>{artifact.summary ?? artifact.excerpt}</span>
          )}
        </span>
      </button>
      {artifact.type === "audio" && artifact.url && (
        <audio className={styles.cardAudio} controls preload="none" src={artifact.url} aria-label={`Play ${artifact.title}`} />
      )}
      <Link href={artifactHref(artifact.documentId)} className={styles.cardLink} aria-label={`Show ${artifact.title} in Artifacts`} title="Show in Artifacts">
        <FolderOpen size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}

/** The artifact cards under one chat reply. */
export function ArtifactCards({ artifacts, onOpen, label }: { artifacts: ArtifactSummary[]; onOpen: (a: ArtifactSummary) => void; label?: string }) {
  if (!artifacts.length) return null;
  return (
    <div className={styles.cards} role="group" aria-label={label ?? `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}`}>
      {label && <p className={styles.cardsLabel}>{label}</p>}
      {artifacts.map((a) => <ArtifactCard key={a.documentId} artifact={a} onOpen={onOpen} />)}
    </div>
  );
}

// ---------- Preview dialog ----------

/** Full preview in a modal, for chat. Escape and the backdrop close it; focus returns to the card. */
export function ArtifactDialog({ summary, onClose }: { summary: ArtifactSummary; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { artifact, error, loading } = useArtifact(summary.documentId);

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.dialogInner}>
        <header className={styles.previewHeader}>
          <span className={styles.typeIcon} data-type={summary.type} data-size="lg"><ArtifactIcon artifact={summary} size={18} /></span>
          <div className={styles.previewTitle}>
            <h2 id={titleId}>{summary.title}</h2>
            <p>{artifactMeta(summary)}</p>
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close preview"><X size={16} aria-hidden="true" /></button>
        </header>
        <div className={styles.previewTools}>
          {artifact && <ArtifactActions artifact={artifact} />}
          <Link href={artifactHref(summary.documentId)} className={styles.toolButton}><FolderOpen size={14} aria-hidden="true" />Open in Artifacts</Link>
        </div>
        <div className={styles.dialogBody}>
          {artifact ? <ArtifactPreview artifact={artifact} />
            : loading ? <p className={styles.loading}><Loader2 size={16} className={styles.spin} aria-hidden="true" />Loading…</p>
            : <p role="alert" className={styles.error}>{error}</p>}
        </div>
      </div>
    </dialog>
  );
}
