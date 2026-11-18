"use client";

/* eslint-disable @next/next/no-img-element -- app logos come from Composio's logo CDN, shown as plain images rather than
   through next/image's remote-pattern allowlist. */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle, Check, CirclePause, CirclePlay, Link2, Loader2, PlugZap, RefreshCw, Search, Settings2, ShieldCheck, Trash2, Unplug, X,
} from "lucide-react";
import {
  appCategories, appCategoryLabels, connectionStatusLabels,
  type AppCategory, type AppInfo, type ConnectionRecord,
} from "@/lib/connection-records";
import {
  disconnectAction, pauseConnectionAction, refreshConnectionsAction, searchAppsAction, updateConnectionSettingsAction,
} from "./actions";
import { useConnectApp, type ConnectOutcome } from "./use-connect-app";
import styles from "./accounts.module.css";

type AgentOption = { id: string; name: string };
type Filter = "all" | AppCategory;

export function AppLogo({ name, logo, size = 36 }: { name: string; logo: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.logo} style={{ width: size, height: size }} aria-hidden="true">
      {logo && !failed ? <img src={logo} alt="" width={size - 10} height={size - 10} onError={() => setFailed(true)} /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

function accessSummary(c: ConnectionRecord, agents: AgentOption[]) {
  const who = c.agentAccess === "all" ? "All agents"
    : c.allowedAgents.length === 1 ? agents.find((a) => a.id === c.allowedAgents[0])?.name ?? "1 agent" : `${c.allowedAgents.length} agents`;
  const what = c.permission === "read" ? "Read-only" : c.requireApproval ? "Can post · asks you first" : "Can post without asking";
  return `${who} · ${what}`;
}

export function AccountsView({ configured, initialApps, initialConnections, agents, loadError, returned }: {
  configured: boolean;
  initialApps: AppInfo[];
  initialConnections: ConnectionRecord[];
  agents: AgentOption[];
  loadError: string | null;
  returned: { toolkit: string; status: string } | null;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AppInfo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [managing, setManaging] = useState<ConnectionRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const searchId = useId();

  const appName = useCallback((slug: string) => initialApps.find((a) => a.slug === slug)?.name ?? connections.find((c) => c.toolkit === slug)?.toolkitName ?? slug, [initialApps, connections]);

  const refresh = useCallback(async () => {
    const result = await refreshConnectionsAction();
    if (result.ok) setConnections(result.connections);
    else setNotice({ tone: "error", text: result.error });
  }, []);

  const onConnected = useCallback(async ({ toolkit, status }: ConnectOutcome) => {
    await refresh();
    if (status === "active") setNotice({ tone: "ok", text: `${appName(toolkit)} is connected. Your agents can use it now.` });
    else if (status !== "closed" && status !== "initiated") setNotice({ tone: "error", text: `${appName(toolkit)} wasn't connected (${status}). Try again.` });
  }, [refresh, appName]);
  const { connect, pendingToolkit, error: connectError, clearError } = useConnectApp(onConnected);

  // Coming back from a sign-in that opened in this tab (popup blocked).
  const [shownReturn, setShownReturn] = useState(false);
  if (returned && !shownReturn) {
    setShownReturn(true);
    setNotice(returned.status === "active"
      ? { tone: "ok", text: `${appName(returned.toolkit)} is connected. Your agents can use it now.` }
      : { tone: "error", text: `${appName(returned.toolkit)} wasn't connected. Try again.` });
  }
  useEffect(() => {
    if (returned) window.history.replaceState(null, "", "/dashboard/accounts");
  }, [returned]);

  useEffect(() => {
    if (!notice || notice.tone === "error") return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const shownError = connectError ?? (notice?.tone === "error" ? notice.text : null);

  const activeBySlug = useMemo(() => {
    const map = new Map<string, ConnectionRecord[]>();
    for (const c of connections) map.set(c.toolkit, [...(map.get(c.toolkit) ?? []), c]);
    return map;
  }, [connections]);

  const term = query.trim().toLowerCase();
  const shownApps = useMemo(() => {
    const base = results ?? initialApps;
    return base.filter((a) => (results || filter === "all" || a.category === filter)
      && (results || !term || a.name.toLowerCase().includes(term) || a.slug.includes(term) || a.blurb.toLowerCase().includes(term)));
  }, [results, initialApps, filter, term]);

  async function searchAll(event?: FormEvent) {
    event?.preventDefault();
    if (term.length < 2) { setResults(null); return; }
    setSearching(true);
    const result = await searchAppsAction(term);
    setSearching(false);
    if (result.ok) setResults(result.apps);
    else setNotice({ tone: "error", text: result.error });
  }

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    try { await task(); } finally { setBusy(null); }
  }

  const visibleConnections = connections.filter((c) => c.status !== "initiated" || c.toolkit === pendingToolkit);

  if (!configured) {
    return (
      <section className={styles.page}>
        <Header />
        <div className={styles.setup} role="status">
          <PlugZap size={20} aria-hidden="true" />
          <div>
            <strong>Connected accounts aren&apos;t set up yet</strong>
            <p>Add a Composio API key as <code>COMPOSIO_API_KEY</code> in <code>.env.local</code> and restart the server. See docs/accounts.md.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <Header onRefresh={() => run("refresh", refresh)} refreshing={busy === "refresh"} />
      <div aria-live="polite" className={styles.live}>
        {notice?.tone === "ok" && <p className={styles.notice} data-tone="ok"><Check size={15} aria-hidden="true" />{notice.text}</p>}
      </div>
      {(shownError || loadError) && (
        <p className={styles.notice} data-tone="error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />{shownError ?? loadError}
          {shownError && <button type="button" className={styles.noticeClose} onClick={() => { clearError(); setNotice(null); }} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>}
        </p>
      )}

      <section aria-labelledby="connected-heading" className={styles.section}>
        <h2 id="connected-heading" className={styles.sectionTitle}>Connected <span className={styles.count}>{visibleConnections.filter((c) => c.status === "active").length}</span></h2>
        {visibleConnections.length ? (
          <ul className={styles.connections}>
            {visibleConnections.map((c) => {
              const app = initialApps.find((a) => a.slug === c.toolkit);
              const broken = c.status !== "active" && c.status !== "initiated" && c.status !== "disabled";
              return (
                <li key={c.documentId} className={styles.connection} data-status={c.status}>
                  <AppLogo name={c.toolkitName} logo={c.logo ?? app?.logo ?? null} />
                  <div className={styles.connectionText}>
                    <p className={styles.connectionName}>
                      {c.toolkitName}{c.accountLabel && <span className={styles.accountLabel}>{c.accountLabel}</span>}
                    </p>
                    <p className={styles.connectionMeta}>
                      <span className={styles.status} data-status={c.status}>{connectionStatusLabels[c.status]}</span>
                      {c.status === "active" && <span>{accessSummary(c, agents)}</span>}
                      {broken && c.statusReason && <span>{c.statusReason}</span>}
                    </p>
                  </div>
                  <div className={styles.connectionActions}>
                    {(broken || c.status === "initiated") && (
                      <button type="button" className={styles.primary} disabled={Boolean(pendingToolkit)} onClick={() => connect(c.toolkit, { replaces: c.documentId })}>
                        {pendingToolkit === c.toolkit ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}Reconnect
                      </button>
                    )}
                    {c.status === "active" && (
                      <button type="button" className={styles.secondary} onClick={() => setManaging(c)}><Settings2 size={14} aria-hidden="true" />Manage</button>
                    )}
                    {(c.status === "active" || c.status === "disabled") && (
                      <button type="button" className={styles.iconButton} disabled={busy === `pause:${c.documentId}`}
                        aria-label={c.status === "disabled" ? `Resume ${c.toolkitName}` : `Pause ${c.toolkitName}`} title={c.status === "disabled" ? "Resume: agents can use it again" : "Pause: no agent can use it until resumed"}
                        onClick={() => run(`pause:${c.documentId}`, async () => {
                          const result = await pauseConnectionAction(c.documentId, c.status !== "disabled");
                          if (result.ok) setConnections((list) => list.map((x) => (x.documentId === c.documentId ? result.connection : x)));
                          else setNotice({ tone: "error", text: result.error });
                        })}>
                        {busy === `pause:${c.documentId}` ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : c.status === "disabled" ? <CirclePlay size={15} aria-hidden="true" /> : <CirclePause size={15} aria-hidden="true" />}
                      </button>
                    )}
                    {c.status === "active" && (
                      <button type="button" className={styles.iconButton} disabled={Boolean(pendingToolkit)} aria-label={`Reconnect ${c.toolkitName}`} title="Reconnect: sign in again, keeping these settings"
                        onClick={() => connect(c.toolkit, { replaces: c.documentId })}>
                        <RefreshCw size={15} aria-hidden="true" />
                      </button>
                    )}
                    <button type="button" className={styles.iconButton} data-danger disabled={busy === `remove:${c.documentId}`} aria-label={`Disconnect ${c.toolkitName}`} title="Disconnect"
                      onClick={() => {
                        if (!window.confirm(`Disconnect ${c.toolkitName}${c.accountLabel ? ` (${c.accountLabel})` : ""}? Agents lose access and scheduled posts on it will fail.`)) return;
                        void run(`remove:${c.documentId}`, async () => {
                          const result = await disconnectAction(c.documentId);
                          if (result.ok) {
                            setConnections((list) => list.filter((x) => x.documentId !== c.documentId));
                            setNotice({ tone: "ok", text: `${c.toolkitName} was disconnected.` });
                          } else setNotice({ tone: "error", text: result.error });
                        });
                      }}>
                      {busy === `remove:${c.documentId}` ? <Loader2 size={15} className={styles.spin} aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.empty}><Unplug size={16} aria-hidden="true" />No accounts yet. Connect one below and your agents can publish, schedule, and read stats with it.</p>
        )}
      </section>

      <section aria-labelledby="apps-heading" className={styles.section}>
        <div className={styles.appsHead}>
          <h2 id="apps-heading" className={styles.sectionTitle}>Add an account</h2>
          <form className={styles.search} role="search" onSubmit={searchAll}>
            <label htmlFor={searchId} className={styles.srOnly}>Search apps</label>
            <Search size={15} aria-hidden="true" />
            <input id={searchId} value={query} placeholder="Search apps…" maxLength={60}
              onChange={(e) => { setQuery(e.target.value); if (results) setResults(null); }} />
            {term.length >= 2 && (
              <button type="submit" className={styles.searchButton} disabled={searching}>
                {searching ? <Loader2 size={13} className={styles.spin} aria-hidden="true" /> : null}Search all apps
              </button>
            )}
          </form>
        </div>
        {!results && (
          <div className={styles.filters} role="group" aria-label="Filter apps">
            {(["all", ...appCategories] as Filter[]).filter((f) => f === "all" || initialApps.some((a) => a.category === f)).map((f) => (
              <button key={f} type="button" className={styles.filter} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : appCategoryLabels[f]}
              </button>
            ))}
          </div>
        )}
        {results && <p className={styles.resultsNote}>{results.length ? `Apps on Composio matching “${query.trim()}”` : `No apps match “${query.trim()}”.`} <button type="button" className={styles.linkButton} onClick={() => setResults(null)}>Back to featured apps</button></p>}
        {!results && term && !shownApps.length && <p className={styles.resultsNote}>No featured app matches. Press Enter to search every app on Composio.</p>}
        <ul className={styles.grid}>
          {shownApps.map((app) => {
            const mine = activeBySlug.get(app.slug)?.filter((c) => c.status === "active") ?? [];
            const pending = pendingToolkit === app.slug;
            return (
              <li key={app.slug} className={styles.app}>
                <div className={styles.appHead}>
                  <AppLogo name={app.name} logo={app.logo} size={40} />
                  <div className={styles.appTitle}>
                    <strong>{app.name}</strong>
                    {mine.length > 0 && <span className={styles.connectedTag}><Check size={12} aria-hidden="true" />Connected</span>}
                    {!mine.length && app.connect === "setup" && <span className={styles.setupTag} title="This app needs your own developer app in Composio before it can be connected">Needs setup</span>}
                  </div>
                </div>
                <p className={styles.appBlurb}>{app.blurb || "Connect to let your agents use it."}</p>
                <button type="button" className={mine.length ? styles.secondary : styles.primary} disabled={Boolean(pendingToolkit) || app.connect === "none"}
                  onClick={() => connect(app.slug)} aria-label={mine.length ? `Connect another ${app.name} account` : `Connect ${app.name}`}>
                  {pending ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
                  {pending ? "Waiting for sign-in…" : app.connect === "none" ? "No sign-in needed" : mine.length ? "Add another" : "Connect"}
                </button>
              </li>
            );
          })}
        </ul>
        <p className={styles.footnote}><ShieldCheck size={14} aria-hidden="true" />Sign-in happens on each app&apos;s own page through Composio. Creator City never sees your passwords, and tokens are stored by Composio, not in this app.</p>
      </section>

      {managing && (
        <ManageDialog connection={managing} agents={agents} onClose={() => setManaging(null)}
          onSaved={(updated) => { setConnections((list) => list.map((x) => (x.documentId === updated.documentId ? updated : x))); setManaging(null); setNotice({ tone: "ok", text: `${updated.toolkitName} settings saved.` }); }} />
      )}
    </section>
  );
}

function Header({ onRefresh, refreshing }: { onRefresh?: () => void; refreshing?: boolean }) {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>Accounts</h1>
        <p className={styles.lead}>Connect the social and work accounts your agents publish to, schedule on, and read from. You choose which agents may use each one.</p>
      </div>
      {onRefresh && (
        <button type="button" className={styles.secondary} onClick={onRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 size={14} className={styles.spin} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}Refresh
        </button>
      )}
    </header>
  );
}

/** Access settings for one account: label, which agents, and whether they may post (and ask first). */
function ManageDialog({ connection, agents, onClose, onSaved }: {
  connection: ConnectionRecord; agents: AgentOption[]; onClose: () => void; onSaved: (c: ConnectionRecord) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [label, setLabel] = useState(connection.accountLabel ?? "");
  const [permission, setPermission] = useState(connection.permission);
  const [requireApproval, setRequireApproval] = useState(connection.requireApproval);
  const [agentAccess, setAgentAccess] = useState(connection.agentAccess);
  const [allowed, setAllowed] = useState<string[]>(connection.allowedAgents);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(null);
    const result = await updateConnectionSettingsAction(connection.documentId, { accountLabel: label, permission, requireApproval, agentAccess, allowedAgents: allowed });
    setSaving(false);
    if (result.ok) onSaved(result.connection); else setError(result.error);
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className={styles.dialogInner} onSubmit={save}>
        <header className={styles.dialogHeader}>
          <AppLogo name={connection.toolkitName} logo={connection.logo} />
          <h2 id={titleId}>{connection.toolkitName} access</h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>
        </header>
        <div className={styles.dialogBody}>
          <label className={styles.field}>
            <span>Account name</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. @yourbrand or Company page" />
            <small>Helps you and your agents tell accounts apart.</small>
          </label>

          <fieldset className={styles.fieldset}>
            <legend>What agents may do</legend>
            <label className={styles.radio}><input type="radio" name="permission" checked={permission === "publish"} onChange={() => setPermission("publish")} />
              <span><strong>Read and post</strong><small>Publish, schedule, upload, and reply.</small></span></label>
            <label className={styles.radio}><input type="radio" name="permission" checked={permission === "read"} onChange={() => setPermission("read")} />
              <span><strong>Read only</strong><small>Stats, comments, and content, but no posting or changes.</small></span></label>
            {permission === "publish" && (
              <label className={styles.check}><input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
                <span><strong>Ask me before posting</strong><small>Agents show you each post to approve. Deleting always asks.</small></span></label>
            )}
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend>Which agents may use it</legend>
            <label className={styles.radio}><input type="radio" name="access" checked={agentAccess === "all"} onChange={() => setAgentAccess("all")} />
              <span><strong>All agents</strong><small>Including agents you add later.</small></span></label>
            <label className={styles.radio}><input type="radio" name="access" checked={agentAccess === "selected"} onChange={() => setAgentAccess("selected")} />
              <span><strong>Only these agents</strong></span></label>
            {agentAccess === "selected" && (
              <div className={styles.agentList}>
                {agents.length ? agents.map((a) => (
                  <label key={a.id} className={styles.check}>
                    <input type="checkbox" checked={allowed.includes(a.id)}
                      onChange={(e) => setAllowed((list) => (e.target.checked ? [...list, a.id] : list.filter((id) => id !== a.id)))} />
                    <span>{a.name}</span>
                  </label>
                )) : <p className={styles.muted}>You have no agents yet.</p>}
              </div>
            )}
          </fieldset>
          {error && <p className={styles.errorText} role="alert">{error}</p>}
        </div>
        <footer className={styles.dialogFooter}>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={saving}>{saving && <Loader2 size={14} className={styles.spin} aria-hidden="true" />}Save</button>
        </footer>
      </form>
    </dialog>
  );
}
