"use client";

import { useActionState, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { BrainCircuit, Building2, Check, CircleAlert, Clock, Loader2, Send, ShieldCheck, Trash2, TriangleAlert, User } from "lucide-react";
import { MAX_TURNS_LIMIT, MODEL_SUGGESTIONS, TIMEOUT_LIMIT_SECONDS, reasoningEfforts } from "@/lib/agent-config";
import { DISPLAY_NAME_MAX, type AgentDefaults, type PublishingApproval } from "@/lib/workspace-settings";
import { HeadquartersForm, type Appearance } from "../../headquarters/new/headquarters-form";
import {
  clearMemoryAction, deleteHeadquartersAction, saveHeadquartersAction, saveProfileAction, saveWorkspaceAction, type SettingsState,
} from "./actions";
import styles from "./settings.module.css";

type Props = {
  workspace: {
    timeZone: string | null;
    serverTimeZone: string;
    timeZones: string[];
    agentDefaults: AgentDefaults;
    publishingApproval: PublishingApproval;
    /** Active accounts that can post and still ask before posting (relevant in "auto" mode). */
    accountsAsking: number;
  };
  headquarters: { name: string; nameMax: number; appearance: Appearance };
  profile: { displayName: string | null; signInName: string | null; email: string };
};

const effortLabel = (effort: string) => effort[0].toUpperCase() + effort.slice(1);

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return minutes ? `${minutes} min${rest ? ` ${rest} s` : ""}` : `${rest} s`;
}

// The browser's own time zone, read without a hydration mismatch (the server snapshot is null).
const subscribeNever = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || null;
const noTimeZone = () => null;

/** Saved / error line under a form. `savedAt` as key re-announces repeated saves. */
function FormStatus({ state, pending, saved }: { state: SettingsState; pending: boolean; saved: string }) {
  if (pending) return null;
  if (state.error) {
    return <p role="alert" className={styles.status} data-tone="error"><CircleAlert size={16} aria-hidden="true" />{state.error}</p>;
  }
  if (state.savedAt) {
    return <p role="status" key={state.savedAt} className={styles.status} data-tone="ok"><Check size={16} aria-hidden="true" />{state.message ?? saved}</p>;
  }
  return null;
}

function SaveButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button type="submit" className={styles.primary} disabled={pending}>
      {pending && <Loader2 className={styles.spin} size={15} aria-hidden="true" />}
      {pending ? "Saving…" : children}
    </button>
  );
}

function Card({ icon, title, lead, children, tone }: { icon: ReactNode; title: string; lead: string; children: ReactNode; tone?: "danger" }) {
  const id = useId();
  return (
    <section className={styles.card} aria-labelledby={id} data-tone={tone}>
      <header className={styles.cardHeader}>
        <span className={styles.cardIcon} aria-hidden="true">{icon}</span>
        <div>
          <h3 id={id} className={styles.cardTitle}>{title}</h3>
          <p className={styles.cardLead}>{lead}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function WorkspaceForm({ workspace }: { workspace: Props["workspace"] }) {
  const [state, action, pending] = useActionState(saveWorkspaceAction, {});
  const ids = useId();
  const detected = useSyncExternalStore(subscribeNever, browserTimeZone, noTimeZone);
  const [timeZone, setTimeZone] = useState(workspace.timeZone ?? "");
  const [timeout, setTimeoutSeconds] = useState(workspace.agentDefaults.timeoutSeconds);
  const [approval, setApproval] = useState<PublishingApproval>(workspace.publishingApproval);
  const suggestion = detected && detected !== timeZone && workspace.timeZones.includes(detected) ? detected : null;

  return (
    <form action={action} className={styles.form}>
      <Card icon={<Clock size={18} />} title="Time zone" lead={`Agents treat “today” and “this week” in this zone, and the city shows times in it.`}>
        <div className={styles.field}>
          <label htmlFor={`${ids}-tz`}>Time zone</label>
          <select id={`${ids}-tz`} name="timeZone" required value={timeZone} onChange={(e) => setTimeZone(e.target.value)}
            className={styles.input} aria-describedby={`${ids}-tz-hint`}>
            {!timeZone && <option value="" disabled>Choose a time zone</option>}
            {workspace.timeZones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
          </select>
          <p id={`${ids}-tz-hint`} className={styles.hint}>
            {workspace.timeZone ? null : <>Not set yet: agents use the server&apos;s zone ({workspace.serverTimeZone}). </>}
            {suggestion && (
              <button type="button" className={styles.linkButton} onClick={() => setTimeZone(suggestion)}>
                Use this browser&apos;s zone ({suggestion.replaceAll("_", " ")})
              </button>
            )}
          </p>
        </div>
      </Card>

      <Card icon={<BrainCircuit size={18} />} title="New agent defaults"
        lead="What every new agent starts with. Existing agents keep their own settings; change those from the agent's AI settings.">
        <div className={styles.grid}>
          <div className={styles.field}>
            <label htmlFor={`${ids}-model`}>Model</label>
            <input id={`${ids}-model`} name="model" defaultValue={workspace.agentDefaults.model ?? ""} list={`${ids}-models`}
              placeholder="Server default" autoComplete="off" spellCheck={false} className={styles.input} />
            <datalist id={`${ids}-models`}>{MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${ids}-effort`}>Reasoning effort</label>
            <select id={`${ids}-effort`} name="reasoningEffort" defaultValue={workspace.agentDefaults.reasoningEffort ?? ""} className={styles.input}>
              <option value="">Auto (model default)</option>
              {reasoningEfforts.map((effort) => <option key={effort} value={effort}>{effortLabel(effort)}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${ids}-turns`}>Max turns</label>
            <input id={`${ids}-turns`} name="maxTurns" type="number" required min={1} max={MAX_TURNS_LIMIT} step={1}
              defaultValue={workspace.agentDefaults.maxTurns} className={styles.input} aria-describedby={`${ids}-turns-hint`} />
            <p id={`${ids}-turns-hint`} className={styles.hint}>Model responses per run, 1–{MAX_TURNS_LIMIT}.</p>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${ids}-timeout`}>Time limit (seconds)</label>
            <input id={`${ids}-timeout`} name="timeoutSeconds" type="number" required min={30} max={TIMEOUT_LIMIT_SECONDS} step={30}
              value={timeout} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} className={styles.input} aria-describedby={`${ids}-timeout-hint`} />
            <p id={`${ids}-timeout-hint`} className={styles.hint}>{formatDuration(timeout) || "30"} per run, up to {TIMEOUT_LIMIT_SECONDS / 60} min.</p>
          </div>
        </div>
      </Card>

      <Card icon={<Send size={18} />} title="Publishing approval" lead="Whether agents need your OK before they post or change something on a connected account.">
        <div className={styles.choices} role="radiogroup" aria-label="Publishing approval">
          <label className={styles.choice}>
            <input type="radio" name="publishingApproval" value="ask" checked={approval === "ask"} onChange={() => setApproval("ask")} />
            <span className={styles.choiceText}>
              <strong><ShieldCheck size={16} aria-hidden="true" />Ask before posting</strong>
              <small>Agents send you every post to approve, decline, or change first.</small>
            </span>
          </label>
          <label className={styles.choice}>
            <input type="radio" name="publishingApproval" value="auto" checked={approval === "auto"} onChange={() => setApproval("auto")} />
            <span className={styles.choiceText}>
              <strong><Send size={16} aria-hidden="true" />Auto-publish</strong>
              <small>Agents post without asking, except to accounts set to ask on the Accounts page. Deletions always ask.</small>
            </span>
          </label>
        </div>
        {approval === "auto" && workspace.accountsAsking > 0 && (
          <p className={styles.note}>
            {workspace.accountsAsking} connected {workspace.accountsAsking === 1 ? "account still asks" : "accounts still ask"} before posting.
            Turn off “Ask before posting” for {workspace.accountsAsking === 1 ? "it" : "them"} on the <a href="/dashboard/accounts">Accounts page</a> to auto-publish there.
          </p>
        )}
      </Card>

      <div className={styles.actions}>
        <FormStatus state={state} pending={pending} saved="Workspace settings saved." />
        <SaveButton pending={pending}>Save workspace settings</SaveButton>
      </div>
    </form>
  );
}

function ProfileForm({ profile }: { profile: Props["profile"] }) {
  const [state, action, pending] = useActionState(saveProfileAction, {});
  const ids = useId();
  return (
    <form action={action} className={styles.form}>
      <Card icon={<User size={18} />} title="Profile" lead="How you appear in Creator City.">
        <div className={styles.grid}>
          <div className={styles.field}>
            <label htmlFor={`${ids}-name`}>Display name</label>
            <input id={`${ids}-name`} name="displayName" defaultValue={profile.displayName ?? ""} maxLength={DISPLAY_NAME_MAX}
              placeholder={profile.signInName ?? profile.email.split("@")[0]} autoComplete="name" className={styles.input} aria-describedby={`${ids}-name-hint`} />
            <p id={`${ids}-name-hint`} className={styles.hint}>Leave empty to use the name from your sign-in.</p>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${ids}-email`}>Email</label>
            <input id={`${ids}-email`} type="email" value={profile.email} readOnly className={styles.input} aria-describedby={`${ids}-email-hint`} />
            <p id={`${ids}-email-hint`} className={styles.hint}>Your sign-in email can&apos;t be changed here.</p>
          </div>
        </div>
        <div className={styles.actions}>
          <FormStatus state={state} pending={pending} saved="Profile saved." />
          <SaveButton pending={pending}>Save profile</SaveButton>
        </div>
      </Card>
    </form>
  );
}

/** A danger-zone row whose button opens a native modal dialog with the confirming form. */
function DangerAction({ title, description, button, dialogTitle, children, action, confirmLabel, canConfirm = true }: {
  title: string; description: string; button: string; dialogTitle: string; children: ReactNode; confirmLabel: string; canConfirm?: boolean;
  action: (state: SettingsState, formData: FormData) => Promise<SettingsState>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // A success closes the dialog and shows its result on the row; an error stays in the open dialog.
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(async (previous, formData) => {
    // A redirect (after deleting the headquarters) navigates away and may leave no result.
    const result: SettingsState | undefined = await action(previous, formData);
    if (result && !result.error) dialog.current?.close();
    return result ?? previous;
  }, {});
  const titleId = useId();

  return (
    <div className={styles.dangerRow}>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        <FormStatus state={state.error ? {} : state} pending={pending} saved="" />
      </div>
      <button type="button" className={styles.danger} onClick={() => dialog.current?.showModal()}>
        <Trash2 size={15} aria-hidden="true" />{button}
      </button>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}
        onClick={(e) => { if (e.target === e.currentTarget && !pending) e.currentTarget.close(); }}
        onCancel={(e) => { if (pending) e.preventDefault(); }}>
        <form action={formAction} className={styles.dialogBody}>
          <h3 id={titleId} className={styles.dialogTitle}><TriangleAlert size={18} aria-hidden="true" />{dialogTitle}</h3>
          {children}
          <FormStatus state={state.error ? state : {}} pending={pending} saved="" />
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondary} disabled={pending} onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className={styles.dangerSolid} disabled={pending || !canConfirm}>
              {pending && <Loader2 className={styles.spin} size={15} aria-hidden="true" />}
              {pending ? "Working…" : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function DangerZone({ headquartersName }: { headquartersName: string }) {
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const matches = typed.trim().replace(/\s+/g, " ").toLowerCase() === headquartersName.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    <Card icon={<TriangleAlert size={18} />} title="Danger zone" lead="These can't be undone." tone="danger">
      <DangerAction
        title="Clear shared memory"
        description="Deletes everything agents saved to your headquarters' shared memory. Artifacts, chats, posts, and agents stay."
        button="Clear memory" dialogTitle="Clear shared memory?" confirmLabel="Clear memory" action={clearMemoryAction}>
        <input type="hidden" name="confirm" value="clear" />
        <p className={styles.dialogText}>Agents lose the research, scripts, and notes they saved for each other. They can still read artifacts.</p>
      </DangerAction>
      <DangerAction
        title="Delete headquarters"
        description="Deletes your headquarters and everything in it: agents, chats, tasks, artifacts, memory, posts, and media. Connected accounts are disconnected."
        button="Delete headquarters" dialogTitle={`Delete ${headquartersName}?`} confirmLabel="Delete everything" action={deleteHeadquartersAction}
        canConfirm={matches}>
        <p className={styles.dialogText}>
          Running work is cancelled, connected accounts are disconnected, and the cloud computer is stopped. You stay signed in and can raise a new headquarters.
        </p>
        <div className={styles.field}>
          <label htmlFor={inputId}>Type <strong>{headquartersName}</strong> to confirm</label>
          <input id={inputId} name="confirmName" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={styles.input} />
        </div>
      </DangerAction>
    </Card>
  );
}

export function SettingsView({ workspace, headquarters, profile }: Props) {
  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.lead}>Workspace and account settings for your headquarters.</p>
      </header>

      <section className={styles.section} aria-labelledby="settings-workspace">
        <h2 id="settings-workspace" className={styles.sectionTitle}>Workspace</h2>
        <WorkspaceForm workspace={workspace} />
        <div className={styles.card}>
          <header className={styles.cardHeader}>
            <span className={styles.cardIcon} aria-hidden="true"><Building2 size={18} /></span>
            <div>
              <h3 className={styles.cardTitle}>Headquarters</h3>
              <p className={styles.cardLead}>Name and design of your tower. Changes show in the city right away.</p>
            </div>
          </header>
          <HeadquartersForm mode="edit" suggestedName={headquarters.name} nameMax={headquarters.nameMax}
            initial={headquarters.appearance} action={saveHeadquartersAction} />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="settings-account">
        <h2 id="settings-account" className={styles.sectionTitle}>Account</h2>
        <ProfileForm profile={profile} />
        <DangerZone headquartersName={headquarters.name} />
      </section>
    </div>
  );
}
