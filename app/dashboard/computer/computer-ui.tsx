"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft, BellRing, Check, CircleHelp, Download, Eye, File as FileIcon, Folder, FolderOpen, KeyRound, Link2, Loader2, Maximize2, Monitor, MousePointer2,
  PlugZap, Power, RefreshCw, ShieldAlert, ShieldCheck, Trash2, Upload, X,
} from "lucide-react";
import Link from "next/link";
import {
  COMPUTER_WORKSPACE, computerStateLabels, connectStepOf, needsComputer, requestKindLabels, requestLabel,
  type AgentRequest, type ComputerSnapshot,
} from "@/lib/computer-records";
import {
  answerRequestAction, computerScreenAction, deleteComputerFileAction, downloadComputerFileAction, listComputerFilesAction,
  stopComputerAction, uploadComputerFileAction, type ComputerFile,
} from "../computer-actions";
import { featuredApp } from "@/lib/connection-records";
import { approveConnectRequestAction } from "../accounts/actions";
import { useConnectApp } from "../accounts/use-connect-app";
import styles from "./computer.module.css";

// The user's view of the headquarters' cloud computer: a small live preview, a full-screen dialog (watch or take
// control, with a file panel), and the cards agents use to ask the user for something (generative UI).

// ---------- Live screen link ----------

type ScreenResult = { key: string; url: string | null; state: ComputerSnapshot["state"]; error: string | null };

/**
 * A live-screen link for the computer, refreshed before it expires. With `autoStart`, an off computer is started
 * (only when the user explicitly opened it); otherwise an off computer shows as off.
 */
function useScreen({ interactive, running, autoStart }: { interactive: boolean; running: boolean; autoStart: boolean }) {
  const [startToken, setStartToken] = useState(autoStart ? 1 : 0);
  // One link per (mode, start request) while the computer should be shown; a new key fetches a new link.
  const key = running || startToken > 0 ? `${interactive}:${startToken}` : null;
  const [result, setResult] = useState<ScreenResult | null>(null);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const response = await computerScreenAction({ interactive, start: startToken > 0 }).catch(() => ({ ok: false as const, error: "We couldn't reach the computer." }));
      if (!alive) return;
      if (!response.ok) { setResult({ key, url: null, state: "error", error: response.error }); return; }
      setResult({ key, url: response.url, state: response.state, error: null });
      // Links last an hour; ask for a new one a little before.
      if (response.expiresAt) timer = setTimeout(load, Math.max(30_000, response.expiresAt - Date.now() - 120_000));
    };
    void load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [key, interactive, startToken]);

  const start = useCallback(() => setStartToken((n) => n + 1), []);
  const current = key && result?.key === key ? result : null;
  return {
    url: current?.url ?? null,
    state: current?.state ?? (running ? "running" : "stopped"),
    error: current?.error ?? null,
    loading: Boolean(key) && !current,
    start,
  };
}

// ---------- Small preview ----------

export function ComputerPreview({ computer, agentName, onExpand }: {
  computer: ComputerSnapshot;
  /** The agent this preview is shown for; the badge says whether that agent is the one using it. */
  agentName?: string;
  onExpand: () => void;
}) {
  const running = computer.state === "running";
  const screen = useScreen({ interactive: false, running, autoStart: false });
  const busyElsewhere = agentName && computer.agentName && computer.agentName !== agentName;
  return (
    <div className={styles.preview}>
      <div className={styles.previewScreen}>
        {running && screen.url ? (
          <iframe src={screen.url} title={`Live screen of the cloud computer${computer.agentName ? `, used by ${computer.agentName}` : ""}`} className={styles.previewFrame} tabIndex={-1} />
        ) : (
          <div className={styles.previewEmpty}>
            {screen.loading || computer.state === "starting" ? <Loader2 size={18} className={styles.spin} aria-hidden="true" /> : <Monitor size={18} aria-hidden="true" />}
            <span>{computer.state === "starting" ? "Starting…"
              : computer.state === "stopping" ? "Shutting down…"
              : running ? (screen.error ? "Live view unavailable" : "Connecting…")
              : computer.state === "error" ? "Couldn't start"
              : "Off · starts when needed"}</span>
          </div>
        )}
        <button type="button" className={styles.previewExpand} onClick={onExpand} aria-label="Open the computer in full screen">
          <span className={styles.previewExpandIcon}><Maximize2 size={13} aria-hidden="true" /></span>
        </button>
        {running && <span className={styles.liveBadge}><span className={styles.liveDot} aria-hidden="true" />Live</span>}
      </div>
      <p className={styles.previewCaption} title={computer.url ?? undefined}>
        {computer.agentName
          ? <>{busyElsewhere ? `${computer.agentName} is using it` : computer.activity ?? "Using the computer"}{computer.url && <span className={styles.previewUrl}> · {hostOf(computer.url)}</span>}</>
          : running ? "On · nobody is using it" : "The computer starts when an agent needs it and shuts down when it is done."}
      </p>
    </div>
  );
}

const hostOf = (url: string) => { try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; } };

// ---------- Full-screen dialog ----------

export function ComputerDialog({ computer, requests, interactive: initialInteractive, startIfOff, onClose, onAnswered }: {
  computer: ComputerSnapshot;
  /** Pending requests; sign-in, captcha, and manual-action requests are shown above the screen. */
  requests: AgentRequest[];
  interactive: boolean;
  /** Start the computer if it is off (the user asked to open it). */
  startIfOff: boolean;
  onClose: () => void;
  onAnswered: (requestId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const actionRequests = requests.filter((r) => needsComputer(r.kind));
  // A sign-in, captcha, or manual step means the user has to use the screen: open in control.
  const [interactive, setInteractive] = useState(initialInteractive || actionRequests.length > 0);
  const [showFiles, setShowFiles] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = computer.state === "running";
  const screen = useScreen({ interactive, running, autoStart: startIfOff && !running });

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);

  // ...and so does one that arrives while the dialog is open.
  const firstAction = actionRequests[0]?.documentId;
  const [seenAction, setSeenAction] = useState(firstAction);
  if (firstAction !== seenAction) {
    setSeenAction(firstAction);
    if (firstAction) setInteractive(true);
  }

  async function stop() {
    setStopping(true); setError(null);
    const result = await stopComputerAction();
    setStopping(false);
    if (!result.ok) setError(result.error);
  }

  const status = screen.loading && !running ? "Starting" : computerStateLabels[computer.state];
  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className={styles.dialogHeader}>
        <span className={styles.dialogIcon} aria-hidden="true"><Monitor size={17} /></span>
        <div className={styles.dialogTitle}>
          <h2 id={titleId}>Cloud computer</h2>
          <p>
            <span className={styles.stateDot} data-state={screen.loading && !running ? "starting" : computer.state} aria-hidden="true" />
            {status}
            {computer.agentName ? <> · <strong>{computer.agentName}</strong>: {computer.activity ?? "using it"}</> : running ? " · nobody is using it" : null}
          </p>
        </div>
        <div className={styles.dialogTools}>
          <div className={styles.segmented} role="group" aria-label="Screen mode">
            <button type="button" aria-pressed={!interactive} onClick={() => setInteractive(false)} title="Watch without touching the screen"><Eye size={14} aria-hidden="true" />Watch</button>
            <button type="button" aria-pressed={interactive} onClick={() => setInteractive(true)} title="Use the mouse and keyboard, e.g. to sign in"><MousePointer2 size={14} aria-hidden="true" />Take control</button>
          </div>
          <button type="button" className={styles.toolButton} aria-pressed={showFiles} onClick={() => setShowFiles((v) => !v)}><FolderOpen size={14} aria-hidden="true" />Files</button>
          {running && (
            <button type="button" className={styles.toolButton} onClick={stop} disabled={stopping || Boolean(computer.agentName)}
              title={computer.agentName ? `${computer.agentName} is using it` : "Shut the computer down now"}>
              {stopping ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Power size={14} aria-hidden="true" />}Shut down
            </button>
          )}
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close the computer view"><X size={16} aria-hidden="true" /></button>
        </div>
      </header>

      {actionRequests.map((request) => (
        <RequestBanner key={request.documentId} request={request} onAnswered={onAnswered} />
      ))}
      {(error || screen.error) && <p className={styles.dialogError} role="alert">{error ?? screen.error}</p>}

      <div className={styles.dialogBody} data-files={showFiles || undefined}>
        <div className={styles.screen}>
          {screen.url ? (
            <iframe key={screen.url} src={screen.url} title="Cloud computer screen" className={styles.screenFrame} allow="clipboard-read; clipboard-write" />
          ) : (
            <div className={styles.screenEmpty}>
              {screen.loading || computer.state === "starting" ? (
                <><Loader2 size={26} className={styles.spin} aria-hidden="true" /><p>Starting the computer… this takes a few seconds.</p></>
              ) : (
                <>
                  <Monitor size={28} aria-hidden="true" />
                  <p>The computer is off. Agents start it when they need it and shut it down when they finish.</p>
                  <p className={styles.muted}>Start it yourself to sign in to sites ahead of time — agents reuse those sign-ins.</p>
                  <button type="button" className={styles.primary} onClick={screen.start}><Power size={14} aria-hidden="true" />Start computer</button>
                </>
              )}
            </div>
          )}
          {interactive && screen.url && <p className={styles.controlHint}>You are in control. Agents keep waiting while you sign in; your sign-ins stay saved on this computer.</p>}
        </div>
        {showFiles && <FilePanel running={running} />}
      </div>
    </dialog>
  );
}

// ---------- Requests (generative UI) ----------

const KIND_ICON = { login: KeyRound, captcha: ShieldAlert, action: MousePointer2, choice: BellRing, confirm: ShieldCheck, connect: PlugZap } as const;

/** Banner above the screen for a sign-in, captcha, or manual step. */
function RequestBanner({ request, onAnswered }: { request: AgentRequest; onAnswered: (id: string) => void }) {
  const [pending, setPending] = useState<"done" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const Icon = KIND_ICON[request.kind];
  async function answer(kind: "done" | "skip") {
    setPending(kind); setError(null);
    const result = await answerRequestAction(request.documentId, kind === "done" ? { done: true } : { dismiss: true });
    setPending(null);
    if (result.ok) onAnswered(request.documentId); else setError(result.error);
  }
  return (
    <div className={styles.banner} role="status">
      <span className={styles.bannerIcon} aria-hidden="true"><Icon size={16} /></span>
      <div className={styles.bannerText}>
        <strong>{request.agentName ?? "An agent"} needs you: {request.title}</strong>
        <span>{request.message ?? requestKindLabels[request.kind]}{request.kind !== "action" ? " The agent continues by itself once it's done." : ""}</span>
        {error && <span className={styles.errorText}>{error}</span>}
      </div>
      <div className={styles.bannerActions}>
        <button type="button" className={styles.primary} onClick={() => answer("done")} disabled={Boolean(pending)}>
          {pending === "done" ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}I&apos;m done
        </button>
        <button type="button" className={styles.secondary} onClick={() => answer("skip")} disabled={Boolean(pending)}>Skip</button>
      </div>
    </div>
  );
}

/**
 * A request as a card (generative UI), for chat and the "Needs you" popover: a choice shows its options as buttons,
 * an open question a text field, an approval Approve/Decline plus a field to ask for changes; sign-in, captcha, and
 * manual steps open the computer. The agent continues by itself as soon as it is answered.
 */
export function RequestCard({ request, onOpenComputer, onAnswered }: {
  request: AgentRequest;
  onOpenComputer: (request: AgentRequest) => void;
  onAnswered: (id: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const otherId = useId();
  const open = request.kind === "choice" && !request.options.length;
  const Icon = open ? CircleHelp : KIND_ICON[request.kind];

  async function send(answer: Parameters<typeof answerRequestAction>[1], key: string) {
    setPending(key); setError(null);
    const result = await answerRequestAction(request.documentId, answer);
    setPending(null);
    if (result.ok) onAnswered(request.documentId); else setError(result.error);
  }

  function submitOther(event: FormEvent) {
    event.preventDefault();
    if (other.trim()) void send({ text: other.trim() }, "other");
  }

  const spinner = (key: string) => (pending === key ? <Loader2 size={13} className={styles.spin} aria-hidden="true" /> : null);
  const typed = request.allowOther && (
    <form className={styles.otherForm} onSubmit={submitOther}>
      <label htmlFor={otherId} className={styles.srOnly}>{open ? "Your answer" : request.kind === "confirm" ? "Ask for changes" : "Another answer"}</label>
      <input id={otherId} value={other} onChange={(e) => setOther(e.target.value)} maxLength={300} disabled={Boolean(pending)}
        placeholder={open ? "Type your answer…" : request.kind === "confirm" ? "Or ask for changes…" : "Something else…"} />
      <button type="submit" className={styles.secondary} disabled={!other.trim() || Boolean(pending)}>{spinner("other")}Send</button>
    </form>
  );

  return (
    <div className={styles.card} data-kind={request.kind}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element -- Composio's logo CDN, not in next/image's allowlist */}
          {request.kind === "connect" && request.url ? <img src={request.url} alt="" width={18} height={18} /> : <Icon size={15} />}
        </span>
        <div className={styles.cardTitle}>
          <span className={styles.cardEyebrow}>{request.agentName ?? "Headquarters"} · {requestLabel(request)}{request.service && request.kind !== "connect" ? ` · ${request.service}` : ""}</span>
          <strong>{request.title}</strong>
        </div>
      </div>
      {request.message && <p className={styles.cardMessage}>{request.message}</p>}
      {request.kind === "connect" ? (
        <ConnectActions request={request} onAnswered={onAnswered} onDismiss={() => send({ dismiss: true }, "dismiss")} dismissing={pending === "dismiss"} />
      ) : request.kind === "confirm" ? (
        <>
          <div className={styles.cardActions}>
            <button type="button" className={styles.primary} onClick={() => send({ optionId: "approve" }, "approve")} disabled={Boolean(pending)}>
              {spinner("approve") ?? <Check size={13} aria-hidden="true" />}Approve
            </button>
            <button type="button" className={styles.secondary} onClick={() => send({ optionId: "decline" }, "decline")} disabled={Boolean(pending)}>
              {spinner("decline") ?? <X size={13} aria-hidden="true" />}Decline
            </button>
          </div>
          {typed}
        </>
      ) : request.kind === "choice" ? (
        <>
          {request.options.length > 0 && (
            <div className={styles.options} role="group" aria-label={request.title}>
              {request.options.map((option) => (
                <button key={option.id} type="button" className={styles.option} onClick={() => send({ optionId: option.id }, option.id)} disabled={Boolean(pending)}>
                  <span className={styles.optionLabel}>{spinner(option.id)}{option.label}</span>
                  {option.description && <span className={styles.optionDescription}>{option.description}</span>}
                </button>
              ))}
            </div>
          )}
          {typed}
          <button type="button" className={styles.linkButton} onClick={() => send({ dismiss: true }, "dismiss")} disabled={Boolean(pending)}>Dismiss</button>
        </>
      ) : (
        <div className={styles.cardActions}>
          <button type="button" className={styles.primary} onClick={() => onOpenComputer(request)}><Monitor size={14} aria-hidden="true" />Open computer</button>
          <button type="button" className={styles.secondary} onClick={() => send({ done: true }, "done")} disabled={Boolean(pending)}>
            {spinner("done") ?? <Check size={13} aria-hidden="true" />}Done
          </button>
          <button type="button" className={styles.linkButton} onClick={() => send({ dismiss: true }, "dismiss")} disabled={Boolean(pending)}>Skip</button>
        </div>
      )}
      {error && <p className={styles.errorText} role="alert">{error}</p>}
    </div>
  );
}

/**
 * Buttons of a "Connect an app" card (request_connection): connect the app in a sign-in popup, give this agent access to
 * an account that is already connected, or allow posting with it. The agent continues by itself once it can use the app.
 */
function ConnectActions({ request, onAnswered, onDismiss, dismissing }: {
  request: AgentRequest; onAnswered: (id: string) => void; onDismiss: () => void; dismissing: boolean;
}) {
  const step = connectStepOf(request) ?? "connect";
  const toolkit = request.service ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const { connect, pendingToolkit, error: connectError } = useConnectApp(({ status }) => {
    if (status === "active") { setConnected(true); onAnswered(request.documentId); }
    else if (status !== "closed" && status !== "initiated") setError("The app wasn't connected. Try again.");
  });

  async function approve() {
    setBusy(true); setError(null);
    const result = await approveConnectRequestAction(request.documentId);
    setBusy(false);
    if (result.ok) onAnswered(request.documentId); else setError(result.error);
  }

  const app = featuredApp(toolkit)?.name ?? (step === "connect" ? request.title.replace(/^Connect /, "") : "the app");
  return (
    <>
      <div className={styles.cardActions}>
        {connected ? (
          <span className={styles.cardDone}><Check size={14} aria-hidden="true" />Connected. The agent is continuing.</span>
        ) : step === "connect" ? (
          <button type="button" className={styles.primary} disabled={Boolean(pendingToolkit)} onClick={() => connect(toolkit)}>
            {pendingToolkit ? <Loader2 size={13} className={styles.spin} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
            {pendingToolkit ? "Waiting for sign-in…" : `Connect ${app}`}
          </button>
        ) : (
          <button type="button" className={styles.primary} disabled={busy} onClick={approve}>
            {busy ? <Loader2 size={13} className={styles.spin} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
            {step === "grant" ? "Give access" : "Allow posting"}
          </button>
        )}
        <Link href="/dashboard/accounts" className={styles.linkButton}>Manage accounts</Link>
        {!connected && <button type="button" className={styles.linkButton} onClick={onDismiss} disabled={dismissing}>Skip</button>}
      </div>
      {(error || connectError) && <p className={styles.errorText} role="alert">{error ?? connectError}</p>}
    </>
  );
}

/** Header button that counts what agents need from the user and opens them in a popover (by itself for new ones). */
export function NeedsYouButton({ requests, onOpenComputer, onAnswered }: {
  requests: AgentRequest[];
  onOpenComputer: (request: AgentRequest) => void;
  onAnswered: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  // Open as soon as a new request arrives, so the user notices it right away.
  const ids = requests.map((r) => r.documentId).join(",");
  const [known, setKnown] = useState(ids);
  if (ids !== known) {
    const before = new Set(known.split(","));
    setKnown(ids);
    if (requests.some((r) => !before.has(r.documentId))) setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!requests.length) return null;
  return (
    <div className={styles.needsRoot} ref={root}>
      <button type="button" className={styles.needsButton} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <BellRing size={14} aria-hidden="true" />
        <span className={styles.needsLabel}>Needs you</span>
        <span className={styles.needsCount}>{requests.length}</span>
      </button>
      {open && (
        <div id={panelId} className={styles.needsPanel} role="dialog" aria-label="What your agents need from you">
          <p className={styles.needsHeading}>Your agents are waiting for you</p>
          {requests.map((request) => (
            <RequestCard key={request.documentId} request={request} onAnswered={onAnswered}
              onOpenComputer={(r) => { setOpen(false); onOpenComputer(r); }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Header chip showing the computer's state and who is using it; opens the full-screen view. */
export function ComputerChip({ computer, onOpen }: { computer: ComputerSnapshot; onOpen: () => void }) {
  const label = computer.agentName ? `${computer.agentName} · ${computer.activity ?? "using it"}` : computerStateLabels[computer.state];
  return (
    <button type="button" className={styles.chip} onClick={onOpen} title={`Cloud computer: ${label}`} data-state={computer.state}>
      <Monitor size={14} aria-hidden="true" />
      <span className={styles.stateDot} data-state={computer.state} aria-hidden="true" />
      <span className={styles.chipLabel}>Computer<span className={styles.chipDetail}> · {label}</span></span>
    </button>
  );
}

// ---------- Files ----------

const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

function FilePanel({ running }: { running: boolean }) {
  const [path, setPath] = useState(COMPUTER_WORKSPACE);
  const [files, setFiles] = useState<ComputerFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);

  const show = useCallback((result: Awaited<ReturnType<typeof listComputerFilesAction>>) => {
    setBusy(null);
    if (result.ok) { setFiles(result.files); setPath(result.path); setError(null); } else { setFiles(null); setError(result.error); }
  }, []);

  const load = useCallback(async (dir: string) => {
    setBusy("list"); setError(null);
    show(await listComputerFilesAction(dir));
  }, [show]);

  useEffect(() => {
    if (!running) return;
    let alive = true;
    listComputerFilesAction(COMPUTER_WORKSPACE).then((result) => { if (alive) show(result); }, () => { if (alive) setError("We couldn't list the files."); });
    return () => { alive = false; };
  }, [running, show]);

  async function download(file: ComputerFile) {
    setBusy(file.path); setError(null);
    const result = await downloadComputerFileAction(file.path);
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
    const href = URL.createObjectURL(new Blob([bytes]));
    const a = document.createElement("a");
    a.href = href; a.download = result.name; a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function remove(file: ComputerFile) {
    if (!window.confirm(`Delete ${file.name}${file.directory ? " and everything in it" : ""} from the computer?`)) return;
    setBusy(file.path); setError(null);
    const result = await deleteComputerFileAction(file.path);
    setBusy(null);
    if (result.ok) void load(path); else setError(result.error);
  }

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.set("file", file); form.set("path", path);
    setBusy("upload"); setError(null);
    const result = await uploadComputerFileAction(form).catch(() => ({ ok: false as const, error: "The upload failed. Files up to 5 MB are supported." }));
    setBusy(null);
    if (result.ok) void load(path); else setError(result.error);
  }

  const relative = path.slice(COMPUTER_WORKSPACE.length) || "/";
  return (
    <aside className={styles.files} aria-label="Files on the cloud computer">
      <div className={styles.filesHeader}>
        <button type="button" className={styles.iconButton} onClick={() => load(path.replace(/\/[^/]+$/, ""))} disabled={path === COMPUTER_WORKSPACE || !running} aria-label="Up one folder"><ArrowLeft size={14} aria-hidden="true" /></button>
        <span className={styles.filesPath} title={path}>workspace{relative === "/" ? "" : relative}</span>
        <button type="button" className={styles.iconButton} onClick={() => load(path)} disabled={!running || busy === "list"} aria-label="Refresh"><RefreshCw size={14} className={busy === "list" ? styles.spin : undefined} aria-hidden="true" /></button>
        <button type="button" className={styles.iconButton} onClick={() => upload.current?.click()} disabled={!running || Boolean(busy)} aria-label="Upload a file">
          {busy === "upload" ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
        </button>
        <input ref={upload} type="file" hidden onChange={onUpload} />
      </div>
      {!running ? (
        <p className={styles.filesEmpty}>Start the computer to see the files agents keep in their workspace.</p>
      ) : error ? (
        <p className={styles.errorText} role="alert">{error}</p>
      ) : !files ? (
        <p className={styles.filesEmpty}><Loader2 size={14} className={styles.spin} aria-hidden="true" /> Loading…</p>
      ) : files.length === 0 ? (
        <p className={styles.filesEmpty}>No files here yet. Agents save their work in this folder; finished files also appear on the Artifacts page.</p>
      ) : (
        <ul className={styles.fileList}>
          {files.map((file) => (
            <li key={file.path} className={styles.fileRow}>
              {file.directory ? (
                <button type="button" className={styles.fileName} onClick={() => load(file.path)}><Folder size={14} aria-hidden="true" />{file.name}</button>
              ) : (
                <span className={styles.fileName}><FileIcon size={14} aria-hidden="true" />{file.name}<span className={styles.fileSize}>{formatSize(file.size)}</span></span>
              )}
              {!file.directory && (
                <button type="button" className={styles.iconButton} onClick={() => download(file)} disabled={Boolean(busy)} aria-label={`Download ${file.name}`}>
                  {busy === file.path ? <Loader2 size={13} className={styles.spin} aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
                </button>
              )}
              <button type="button" className={styles.iconButton} onClick={() => remove(file)} disabled={Boolean(busy)} aria-label={`Delete ${file.name}`}><Trash2 size={13} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
