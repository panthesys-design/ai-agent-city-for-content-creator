"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle, AudioLines, ChevronRight, Clapperboard, FileText, Folder, FolderOpen, Image as ImageIcon, LayoutGrid, Library,
  List, Loader2, Play, Search, Trash2, Upload, X, type LucideIcon,
} from "lucide-react";
import { themeAccent } from "@/components/agent-city";
import type { AgentRecord } from "@/lib/agent-records";
import {
  artifactCategoryLabels, artifactTypeLabels, artifactTypes,
  type ArtifactSummary, type ArtifactType,
} from "@/lib/artifact-records";
import { UPLOAD_ACCEPT, UPLOAD_MAX_BYTES, formatBytes, uploadArtifactFile, uploadProblem } from "@/lib/upload-records";
import { deleteArtifactAction } from "./actions";
import { ArtifactActions, ArtifactIcon, ArtifactPreview, MediaThumb, artifactMeta, forgetArtifact, formatWhen, useArtifact } from "./artifact-ui";
import styles from "./artifacts.module.css";

export type ExplorerAgent = Pick<AgentRecord, "documentId" | "name" | "theme">;

type FolderKey = "all" | `type:${ArtifactType}` | `agent:${string}`;
export type View = "grid" | "list";
type Sort = "newest" | "oldest" | "name";

const HQ_FOLDER = "agent:hq";
const TYPE_FOLDER_ICON: Record<ArtifactType, LucideIcon> = { document: FileText, image: ImageIcon, audio: AudioLines, video: Clapperboard };

function inFolder(a: ArtifactSummary, folder: FolderKey) {
  if (folder === "all") return true;
  if (folder.startsWith("type:")) return a.type === folder.slice(5);
  return folder === HQ_FOLDER ? !a.agentId : a.agentId === folder.slice(6);
}

function parseFolder(value: string | null, agents: ExplorerAgent[]): FolderKey {
  if (!value) return "all";
  if (value.startsWith("type:") && (artifactTypes as readonly string[]).includes(value.slice(5))) return value as FolderKey;
  if (value === HQ_FOLDER || (value.startsWith("agent:") && agents.some((a) => a.documentId === value.slice(6)))) return value as FolderKey;
  return "all";
}

/**
 * File-explorer view of a headquarters' artifacts: a folder tree (by type and by agent), a grid or list of files,
 * and a preview pane. `?id=` selects an artifact (chat cards link here) and `?folder=` opens a folder.
 */
export function ArtifactExplorer({ artifacts, agents, initialId, initialFolder, initialView, loadError }: {
  artifacts: ArtifactSummary[];
  agents: ExplorerAgent[];
  initialId: string | null;
  initialFolder: string | null;
  initialView: View;
  loadError: string | null;
}) {
  const [items, setItems] = useState(artifacts);
  const [folder, setFolder] = useState<FolderKey>(() => parseFolder(initialFolder, agents));
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(initialView);
  const [sort, setSort] = useState<Sort>("newest");
  const searchId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ArtifactSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Keep the address shareable: the open folder, layout, and selected file.
  useEffect(() => {
    const params = new URLSearchParams();
    if (folder !== "all") params.set("folder", folder);
    if (view === "list") params.set("view", "list");
    if (selectedId) params.set("id", selectedId);
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [folder, view, selectedId]);

  const counts = useMemo(() => {
    const map = new Map<string, number>([["all", items.length]]);
    for (const a of items) {
      map.set(`type:${a.type}`, (map.get(`type:${a.type}`) ?? 0) + 1);
      const agentKey = a.agentId ? `agent:${a.agentId}` : HQ_FOLDER;
      map.set(agentKey, (map.get(agentKey) ?? 0) + 1);
    }
    return map;
  }, [items]);

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = items.filter((a) => inFolder(a, folder) && words.every((w) =>
      [a.title, a.summary, a.excerpt, a.agentName, artifactCategoryLabels[a.category]].some((field) => field?.toLowerCase().includes(w))));
    if (sort === "name") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "oldest") return [...list].reverse();
    return list;
  }, [items, folder, query, sort]);

  const agentFolders = useMemo(() => {
    const known = agents.map((a) => ({ key: `agent:${a.documentId}` as FolderKey, label: a.name, color: themeAccent[a.theme] }));
    // Artifacts from agents that were deleted since, or from headquarters itself.
    const orphaned = new Map<string, string>();
    for (const a of items) if (a.agentId && !agents.some((x) => x.documentId === a.agentId)) orphaned.set(a.agentId, a.agentName ?? "Removed agent");
    return [
      ...known,
      ...[...orphaned].map(([id, name]) => ({ key: `agent:${id}` as FolderKey, label: name, color: "var(--faint)" })),
      ...(counts.get(HQ_FOLDER) ? [{ key: HQ_FOLDER as FolderKey, label: "Headquarters", color: "var(--accent)" }] : []),
    ];
  }, [agents, items, counts]);

  const folderLabel = folder === "all" ? "All files"
    : folder.startsWith("type:") ? artifactTypeLabels[folder.slice(5) as ArtifactType].many
    : agentFolders.find((f) => f.key === folder)?.label ?? "Agent";

  const selected = selectedId ? items.find((a) => a.documentId === selectedId) ?? null : null;
  const openFolder = (key: FolderKey) => { setFolder(key); setQuery(""); };
  const closePreview = useCallback(() => setSelectedId(null), []);

  async function remove(id: string) {
    const result = await deleteArtifactAction(id);
    if (!result.ok) throw new Error(result.error);
    forgetArtifact(id);
    setItems((current) => current.filter((a) => a.documentId !== id));
    setSelectedId((current) => (current === id ? null : current));
  }

  function askDelete(artifact: ArtifactSummary) {
    setPendingDelete(artifact);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true); setDeleteError(null);
    try {
      await remove(pendingDelete.documentId);
      setPendingDelete(null);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "We couldn't delete this artifact.");
    } finally {
      setDeleting(false);
    }
  }

  // Uploads go through the same route as chat attachments, so they land in the media library as "upload" artifacts.
  function uploadFiles(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setUploadErrors([]);
    const ok = list.filter((file) => {
      const problem = uploadProblem(file);
      if (problem) setUploadErrors((e) => [...e, `${file.name}: ${problem}`]);
      return !problem;
    });
    if (!ok.length) return;
    // Show the new files: leave agent or other-type folders and clear the search.
    if (folder.startsWith("agent:")) setFolder("all");
    setQuery("");
    setUploading((n) => n + ok.length);
    for (const file of ok) {
      uploadArtifactFile<ArtifactSummary>(file).then(
        (artifact) => {
          setItems((current) => [artifact, ...current.filter((a) => a.documentId !== artifact.documentId)]);
          if (ok.length === 1) setSelectedId(artifact.documentId);
        },
        (reason: unknown) => setUploadErrors((e) => [...e, reason instanceof Error ? reason.message : `We couldn't upload ${file.name}.`]),
      ).finally(() => setUploading((n) => n - 1));
    }
  }

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  function onDragOver(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }
  function onDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  }
  function onDrop(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    uploadFiles(event.dataTransfer.files);
  }

  return (
    <div className={styles.explorer} data-preview={selectedId ? "open" : undefined}>
      <header className={styles.explorerHeader}>
        <div>
          <h1 className={styles.pageTitle}>Artifacts</h1>
          <p className={styles.pageLead}>Everything your agents have made and the files you upload: scripts, research, images, voiceovers, videos, and documents.</p>
        </div>
        <button type="button" className={styles.uploadButton} onClick={() => fileInput.current?.click()} disabled={Boolean(loadError) && !items.length}
          title={`Images, videos, audio, PDFs, text, or Office documents (up to ${formatBytes(UPLOAD_MAX_BYTES)} each)`}>
          {uploading ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
          {uploading ? `Uploading ${uploading}…` : "Upload"}
        </button>
        <input ref={fileInput} type="file" multiple accept={UPLOAD_ACCEPT} className={styles.srOnly} tabIndex={-1} aria-hidden="true"
          onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }} />
      </header>

      {loadError && <p role="alert" className={styles.banner}><AlertTriangle size={15} aria-hidden="true" />{loadError}</p>}
      {uploadErrors.length > 0 && (
        <div role="alert" className={styles.banner}>
          <AlertTriangle size={15} aria-hidden="true" />
          <span className={styles.bannerText}>{uploadErrors.map((e, i) => <span key={i}>{e}</span>)}</span>
          <button type="button" className={styles.iconButton} onClick={() => setUploadErrors([])} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      <div className={styles.window}>
        <nav className={styles.tree} aria-label="Folders">
          <p className={styles.treeHeading}>Library</p>
          <ul>
            <TreeItem icon={Library} label="All files" count={counts.get("all") ?? 0} active={folder === "all"} onClick={() => openFolder("all")} />
            {artifactTypes.map((type) => (
              <TreeItem key={type} icon={TYPE_FOLDER_ICON[type]} label={artifactTypeLabels[type].many} count={counts.get(`type:${type}`) ?? 0}
                active={folder === `type:${type}`} onClick={() => openFolder(`type:${type}`)} dataType={type} />
            ))}
          </ul>
          {agentFolders.length > 0 && (
            <>
              <p className={styles.treeHeading}>Agents</p>
              <ul>
                {agentFolders.map((f) => (
                  <TreeItem key={f.key} icon={folder === f.key ? FolderOpen : Folder} color={f.color} label={f.label}
                    count={counts.get(f.key) ?? 0} active={folder === f.key} onClick={() => openFolder(f.key)} />
                ))}
              </ul>
            </>
          )}
        </nav>

        <section className={styles.files} aria-label={folderLabel} data-dragging={dragging ? "true" : undefined}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
          <div className={styles.toolbar}>
            <p className={styles.crumbs}>
              <button type="button" onClick={() => openFolder("all")}>Artifacts</button>
              <ChevronRight size={14} aria-hidden="true" />
              {folder.startsWith("agent:") && <><span>Agents</span><ChevronRight size={14} aria-hidden="true" /></>}
              <strong aria-current="location">{folderLabel}</strong>
            </p>
            <div className={styles.toolbarControls}>
              <label htmlFor={searchId} className={styles.search}>
                <Search size={14} aria-hidden="true" />
                <span className={styles.srOnly}>Search artifacts</span>
                <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" autoComplete="off" />
              </label>
              <label className={styles.srOnly} htmlFor={`${searchId}-sort`}>Sort by</label>
              <select id={`${searchId}-sort`} className={styles.sort} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name</option>
              </select>
              <div className={styles.segmented} role="group" aria-label="Layout">
                <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} title="Grid"><LayoutGrid size={15} aria-hidden="true" /><span className={styles.srOnly}>Grid</span></button>
                <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} title="List"><List size={15} aria-hidden="true" /><span className={styles.srOnly}>List</span></button>
              </div>
            </div>
          </div>

          {pendingDelete && (
            <div className={styles.deleteBar} role="alertdialog" aria-label="Confirm delete">
              <span className={styles.deleteText}>
                Delete <strong>“{pendingDelete.title}”</strong>? It is removed from Artifacts; files stay in the media library.
                {deleteError && <span className={styles.error}>{deleteError}</span>}
              </span>
              <button type="button" className={styles.toolButton} onClick={() => setPendingDelete(null)} disabled={deleting}>Cancel</button>
              <button type="button" className={styles.dangerButton} onClick={confirmDelete} disabled={deleting} autoFocus>
                {deleting ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}Delete
              </button>
            </div>
          )}

          <div className={styles.fileArea}>
            {dragging && <div className={styles.dropOverlay} aria-hidden="true"><Upload size={26} />Drop files to upload</div>}
            {visible.length === 0 ? (
              <EmptyState total={items.length} searching={Boolean(query.trim())} failed={Boolean(loadError)} onUpload={() => fileInput.current?.click()} />
            ) : view === "grid" ? (
              <ul className={styles.grid}>
                {visible.map((a) => (
                  <li key={a.documentId} className={styles.tileItem}>
                    <button type="button" className={styles.tile} aria-current={a.documentId === selectedId ? "true" : undefined} onClick={() => setSelectedId(a.documentId)}>
                      <Thumb artifact={a} />
                      <span className={styles.tileName} title={a.title}>{a.title}</span>
                      <span className={styles.tileMeta}>{artifactMeta(a, { withDate: false })}</span>
                    </button>
                    <button type="button" className={styles.tileDelete} onClick={() => askDelete(a)} aria-label={`Delete ${a.title}`} title="Delete">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <table className={styles.table}>
                <thead><tr><th>Name</th><th>Kind</th><th>Agent</th><th>Created</th><th><span className={styles.srOnly}>Actions</span></th></tr></thead>
                <tbody>
                  {visible.map((a) => (
                    <tr key={a.documentId} aria-current={a.documentId === selectedId ? "true" : undefined}>
                      <td>
                        <button type="button" className={styles.rowButton} onClick={() => setSelectedId(a.documentId)}>
                          <span className={styles.typeIcon} data-type={a.type}><ArtifactIcon artifact={a} size={14} /></span>
                          <span className={styles.rowTitle}>{a.title}</span>
                        </button>
                      </td>
                      <td>{artifactCategoryLabels[a.category]}</td>
                      <td>{a.agentName ?? "Headquarters"}</td>
                      <td suppressHydrationWarning>{formatWhen(a.createdAt)}</td>
                      <td className={styles.rowActions}>
                        <button type="button" className={styles.iconButton} onClick={() => askDelete(a)} aria-label={`Delete ${a.title}`} title="Delete">
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className={styles.statusBar} aria-live="polite">
            {visible.length} {visible.length === 1 ? "item" : "items"}{query.trim() ? ` matching “${query.trim()}”` : ""}
            {uploading > 0 ? ` · uploading ${uploading} ${uploading === 1 ? "file" : "files"}…` : " · drop files here to upload"}
          </p>
        </section>

        {selectedId && <PreviewPane key={selectedId} id={selectedId} summary={selected} onClose={closePreview} onDelete={remove} />}
      </div>
    </div>
  );
}

function TreeItem({ icon: Icon, label, count, active, onClick, color, dataType }: {
  icon: LucideIcon; label: string; count: number; active: boolean; onClick: () => void; color?: string; dataType?: ArtifactType;
}) {
  return (
    <li>
      <button type="button" className={styles.treeItem} aria-current={active ? "true" : undefined} onClick={onClick}>
        <span className={styles.treeIcon} data-type={dataType} style={color ? { color } : undefined}><Icon size={16} aria-hidden="true" /></span>
        <span className={styles.treeLabel}>{label}</span>
        <span className={styles.treeCount}>{count}</span>
      </button>
    </li>
  );
}

function Thumb({ artifact }: { artifact: ArtifactSummary }) {
  if ((artifact.type === "image" || artifact.type === "video") && artifact.url) {
    return (
      <span className={styles.thumb} data-type={artifact.type}>
        <MediaThumb artifact={artifact} />
        {artifact.type === "video" && <span className={styles.playBadge}><Play size={14} fill="currentColor" aria-hidden="true" /></span>}
      </span>
    );
  }
  if (artifact.type === "document") {
    return (
      <span className={styles.thumb} data-type="document">
        <span className={styles.docPage}>
          <span className={styles.docTitle}>{artifact.title}</span>
          <span className={styles.docText}>{artifact.excerpt ?? artifact.summary ?? ""}</span>
        </span>
      </span>
    );
  }
  return (
    <span className={styles.thumb} data-type={artifact.type}>
      <span className={styles.thumbIcon}><ArtifactIcon artifact={artifact} size={30} /></span>
      {artifact.type === "audio" && <span className={styles.wave} aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ height: `${20 + ((i * 37) % 60)}%` }} />)}</span>}
    </span>
  );
}

function EmptyState({ total, searching, failed, onUpload }: { total: number; searching: boolean; failed: boolean; onUpload: () => void }) {
  if (failed && !total) return <div className={styles.empty}><FolderOpen size={28} aria-hidden="true" /><p>Artifacts can&apos;t be shown until the problem above is fixed.</p></div>;
  if (searching) return <div className={styles.empty}><Search size={26} aria-hidden="true" /><p>No artifacts match your search.</p></div>;
  if (total) return <div className={styles.empty}><Folder size={28} aria-hidden="true" /><p>This folder is empty.</p></div>;
  return (
    <div className={styles.empty}>
      <FolderOpen size={30} aria-hidden="true" />
      <p><strong>No artifacts yet</strong></p>
      <p>Ask headquarters or chat with an agent. Scripts, topic lists, research briefs, images, voiceovers, and video timelines they make are saved here. You can also upload your own files.</p>
      <span className={styles.emptyActions}>
        <button type="button" className={styles.toolButton} onClick={onUpload}><Upload size={14} aria-hidden="true" />Upload files</button>
        <Link href="/dashboard" className={styles.emptyLink}>Go to the City</Link>
      </span>
    </div>
  );
}

/** Side pane on wide screens; a full-screen sheet on narrow ones. */
function PreviewPane({ id, summary, onClose, onDelete }: {
  id: string; summary: ArtifactSummary | null; onClose: () => void; onDelete: (id: string) => Promise<void>;
}) {
  const { artifact, error, loading } = useArtifact(id);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const titleId = useId();
  const pane = useRef<HTMLElement>(null);
  const shown = artifact ?? summary;

  useEffect(() => { pane.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function confirmDelete() {
    setDeleting(true); setDeleteError(null);
    try { await onDelete(id); } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "We couldn't delete this artifact.");
      setDeleting(false);
    }
  }

  return (
    <aside ref={pane} tabIndex={-1} className={styles.preview} aria-labelledby={titleId}>
      <header className={styles.previewHeader}>
        {shown && <span className={styles.typeIcon} data-type={shown.type} data-size="lg"><ArtifactIcon artifact={shown} size={18} /></span>}
        <div className={styles.previewTitle}>
          <h2 id={titleId}>{shown?.title ?? "Artifact"}</h2>
          {shown && <p suppressHydrationWarning>{artifactMeta(shown)}</p>}
        </div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close preview"><X size={16} aria-hidden="true" /></button>
      </header>

      {artifact && (
        <div className={styles.previewTools}>
          <ArtifactActions artifact={artifact} />
          {confirming ? (
            <span className={styles.confirmRow}>
              <span>Delete this artifact?</span>
              <button type="button" className={styles.toolButton} onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
              <button type="button" className={styles.dangerButton} onClick={confirmDelete} disabled={deleting}>
                {deleting ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}Delete
              </button>
            </span>
          ) : (
            <button type="button" className={`${styles.toolButton} ${styles.toolDanger}`} onClick={() => setConfirming(true)}>
              <Trash2 size={14} aria-hidden="true" />Delete
            </button>
          )}
        </div>
      )}
      {deleteError && <p role="alert" className={styles.error}>{deleteError}</p>}
      {confirming && !deleteError && <p className={styles.muted}>It is removed from Artifacts. Files stay in the media library and agents keep the shared memory.</p>}

      <div className={styles.previewBody}>
        {artifact ? <ArtifactPreview artifact={artifact} />
          : loading ? <p className={styles.loading}><Loader2 size={16} className={styles.spin} aria-hidden="true" />Loading…</p>
          : <p role="alert" className={styles.error}>{error}</p>}
      </div>
    </aside>
  );
}
