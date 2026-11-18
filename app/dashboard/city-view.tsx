"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle, Bot, Check, Circle, Eraser, ListOrdered, Loader2, MessageSquare, Monitor, Paperclip, Pencil, Plus, RotateCcw,
  SendHorizontal, Square, Trash2, Wrench, X,
} from "lucide-react";
import {
  AddAgentDialog, AgentBuilding, AgentCity, BuildingIcon, HEADQUARTERS_ID, agentDesignInfo, signLabel, themeAccent,
  type Agent, type AgentOffice, type AgentStatus, type CityBuilding, type CityCallout, type CityConfig, type CityPopover, type HeadquartersSpec,
  type NewAgentDraft,
} from "@/components/agent-city";
import { originalLayout, toCityAgent, toDraft, toOffice, toRoad, type AgentRecord, type Plot } from "@/lib/agent-records";
import type { AgentRuntimeConfig } from "@/lib/agent-config";
import type { ArtifactSummary } from "@/lib/artifact-records";
import { HEADQUARTERS_THREAD, type CitySnapshot, type OtherTask, type QueuedTask } from "@/lib/city-live";
import { isQuestion, type AgentRequest, type ComputerSnapshot } from "@/lib/computer-records";
import { isTaskFinished, type StoredMessage } from "@/lib/task-records";
import { UPLOAD_ACCEPT, UPLOAD_MAX_BYTES, formatBytes, uploadArtifactFile, uploadProblem } from "@/lib/upload-records";
import { createAgentAction, deleteAgentAction, moveAgentAction, moveHeadquartersAction, resetLayoutAction, updateAgentAction } from "./agent-actions";
import { AgentConfigDialog } from "./agent-config-dialog";
import { ArtifactCards, ArtifactDialog } from "./artifacts/artifact-ui";
import { Markdown } from "./artifacts/markdown";
import { answerRequestAction } from "./computer-actions";
import { askHeadquartersAction, cancelTaskAction, clearConversationAction, clearTaskProgressAction, loadConversationAction, updateAgentConfigAction } from "./runtime-actions";
import { ComputerChip, ComputerDialog, ComputerPreview, NeedsYouButton, RequestCard } from "./computer/computer-ui";
import type { CityStats } from "@/lib/city-stats";
import { CityStatsCards } from "./city-stats";
import { useCityLive } from "./use-city-live";
import styles from "./city-view.module.css";

// ---------- Display config ----------

const STATUS_LABEL: Record<AgentStatus, string> = { idle: "Idle", working: "Working", waiting: "Needs you", completed: "Completed", failed: "Failed", error: "Error", offline: "Offline" };

export type StepStatus = "pending" | "active" | "done" | "failed";
export type WorkflowStep = { id: string; label: string; status: StepStatus };

/** Pipeline stages shown until headquarters plans a task; then the card shows that plan instead. */
const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: "research", label: "Research", status: "pending" },
  { id: "script", label: "Script", status: "pending" },
  { id: "media", label: "Media", status: "pending" },
  { id: "review", label: "Review", status: "pending" },
  { id: "publish", label: "Publish", status: "pending" },
];

const STEP_LABEL: Record<StepStatus, string> = { pending: "Waiting", active: "In progress", done: "Done", failed: "Failed" };

/** `createdAt` is set once a message is saved; the oldest saved one is the cursor for loading earlier pages. */
type ChatMessage = {
  id: string; role: "user" | "agent"; text: string; pending?: boolean; createdAt?: string | null; artifacts: ArtifactSummary[];
  /** Files the user attached (user messages only). */
  attachments?: ArtifactSummary[];
};
type HeadquartersTask = CitySnapshot["task"];


// An agent keeps its office object while the building itself is unchanged, so live status updates (which
// replace the record) don't redraw buildings; only real appearance or position changes do.
const offices = new Map<string, { key: string; office: AgentOffice }>();
function officeOf(record: AgentRecord) {
  const office = toOffice(record);
  const key = JSON.stringify(office);
  const cached = offices.get(record.documentId);
  if (cached?.key === key) return cached.office;
  offices.set(record.documentId, { key, office });
  return office;
}

/** Applies live agent state, keeping each record whose state did not change. */
function mergeLive(records: AgentRecord[], live: CitySnapshot["agents"]): AgentRecord[] {
  let changed = false;
  const next = records.map((record) => {
    const state = live.find((a) => a.documentId === record.documentId);
    if (!state || (state.status === record.status && state.progress === record.progress && state.activity === record.activity)) return record;
    changed = true;
    return { ...record, status: state.status, progress: state.progress, activity: state.activity };
  });
  return changed ? next : records;
}

type DialogState = { mode: "create" } | { mode: "edit"; agentId: string } | { mode: "ai"; agentId: string } | null;
/** The full-screen computer view: `interactive` gives the user mouse and keyboard; `start` starts an off computer. */
type ComputerView = { interactive: boolean; start: boolean } | null;
/** What the city passes to the popover and chat about the cloud computer. */
type ComputerProps = {
  enabled: boolean;
  computer: ComputerSnapshot | null;
  requests: AgentRequest[];
  onOpen: (view: { interactive: boolean; start: boolean }) => void;
  onOpenForRequest: (request: AgentRequest) => void;
  onAnswered: (requestId: string) => void;
};

// ---------- Page ----------

export function CityView({ headquarters: savedHeadquarters, initialAgents = [], initialTask = null, initialQueue = [], initialOthers = [], loadError = false, computersEnabled = false, initialStats = null }: {
  headquarters: HeadquartersSpec;
  /** Whether the server has a CloudHike cloud computer configured. */
  computersEnabled?: boolean;
  /** Overview numbers (content, posts, audience) with cached platform numbers; the cards refresh them. */
  initialStats?: CityStats | null;
  initialAgents?: AgentRecord[];
  /** The latest headquarters task, for the progress card before the live stream connects. */
  initialTask?: HeadquartersTask;
  /** Headquarters requests waiting behind the current one. */
  initialQueue?: QueuedTask[];
  /** Other headquarters requests in progress alongside the current one. */
  initialOthers?: OtherTask[];
  loadError?: boolean;
}) {
  const [records, setRecords] = useState(initialAgents);
  const [hqPlot, setHqPlot] = useState<Plot>({ x: savedHeadquarters.x, y: savedHeadquarters.y });
  const headquarters = useMemo(() => ({ ...savedHeadquarters, ...hqPlot }), [savedHeadquarters, hqPlot]);
  const [resetting, setResetting] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(HEADQUARTERS_ID);
  const [popoverId, setPopoverId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleting, setDeleting] = useState<AgentRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(loadError ? "We couldn't load your agents. Refresh the page to try again." : null);
  const [fitKey, setFitKey] = useState(0);
  const [hqTask, setHqTask] = useState<HeadquartersTask>(initialTask);
  const [queue, setQueue] = useState<QueuedTask[]>(initialQueue);
  const [others, setOthers] = useState<OtherTask[]>(initialOthers);
  const [threads, setThreads] = useState<Record<string, string>>({});
  const [computer, setComputer] = useState<ComputerSnapshot | null>(null);
  const [requests, setRequests] = useState<AgentRequest[]>([]);
  // Requests the user just answered stay hidden until the live stream catches up.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [computerView, setComputerView] = useState<ComputerView>(null);
  // Saves for the same agent run in order, so a slow earlier move can't overwrite a later one.
  const moves = useRef(new Map<string, Promise<unknown>>());

  const config = useMemo<CityConfig>(() => ({
    buildings: [headquarters, ...records.map(officeOf)],
    links: records.map((record) => toRoad(record, HEADQUARTERS_ID)),
  }), [headquarters, records]);
  const agents = useMemo<Agent[]>(() => records.map(toCityAgent), [records]);

  const selected = config.buildings.find((b) => b.id === selectedId) ?? headquarters;
  const recordOf = useCallback((buildingId: string) => records.find((r) => officeOf(r).id === buildingId), [records]);
  const editing = dialog?.mode === "edit" ? records.find((r) => r.documentId === dialog.agentId) : undefined;
  const configuring = dialog?.mode === "ai" ? records.find((r) => r.documentId === dialog.agentId) : undefined;
  const selectedRecord = selected.agentId ? records.find((r) => r.documentId === selected.agentId) : undefined;

  // When a task starts, every agent that isn't working goes back to a plain "Idle" right away (the server
  // clears the same state, and the live stream then shows only the agents that pick up work).
  const clearIdleStatus = useCallback((except?: string) => {
    setRecords((current) => {
      let changed = false;
      const next = current.map((r) => {
        if (r.documentId === except || r.status === "working" || r.status === "waiting" || (r.status === "idle" && r.progress == null && r.activity == null)) return r;
        changed = true;
        return { ...r, status: "idle" as const, progress: null, activity: null };
      });
      return changed ? next : current;
    });
  }, []);

  // Live building status and headquarters progress from the agent runtime.
  useCityLive(useCallback((snapshot: CitySnapshot) => {
    setRecords((current) => mergeLive(current, snapshot.agents));
    setHqTask(snapshot.task);
    setQueue(snapshot.queue ?? []);
    setOthers(snapshot.others ?? []);
    setThreads((current) => {
      const next = snapshot.threads ?? {};
      const same = Object.keys(next).length === Object.keys(current).length && Object.entries(next).every(([k, v]) => current[k] === v);
      return same ? current : next;
    });
    setComputer(snapshot.computer ?? null);
    setRequests(snapshot.requests ?? []);
  }, []));
  const pendingRequests = useMemo(() => requests.filter((r) => !answered.has(r.documentId)), [requests, answered]);
  const computerProps: ComputerProps = {
    enabled: computersEnabled,
    computer,
    requests: pendingRequests,
    onOpen: setComputerView,
    onOpenForRequest: () => setComputerView({ interactive: true, start: true }),
    onAnswered: (id) => setAnswered((current) => new Set(current).add(id)),
  };
  // A bubble above each building whose agent is waiting for the user; clicking it opens that agent's chat, where the
  // question can be answered. Headquarters' own questions sit above headquarters.
  const callouts = useMemo<CityCallout[]>(() => {
    const byBuilding = new Map<string, AgentRequest[]>();
    for (const request of pendingRequests) {
      const record = request.agentId ? records.find((r) => r.documentId === request.agentId) : undefined;
      if (request.agentId && !record) continue;
      const buildingId = record ? officeOf(record).id : HEADQUARTERS_ID;
      byBuilding.set(buildingId, [...(byBuilding.get(buildingId) ?? []), request]);
    }
    return [...byBuilding].map(([buildingId, list]) => ({
      buildingId,
      text: list[0].title,
      more: list.length - 1,
      label: `${list[0].agentName ?? "Headquarters"} needs you: ${list[0].title}. Open the chat to answer.`,
      onClick: () => { setSelectedId(buildingId); setPopoverId(null); },
    }));
  }, [pendingRequests, records]);

  // Disable "Reset layout" when nothing would move.
  const layoutIsOriginal = useMemo(() => {
    const layout = originalLayout(records);
    return layout.headquarters.x === hqPlot.x && layout.headquarters.y === hqPlot.y
      && records.every((r) => layout.agents[r.documentId].x === r.x && layout.agents[r.documentId].y === r.y);
  }, [records, hqPlot]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function saveAgentConfig(agentId: string, config: AgentRuntimeConfig) {
    const result = await updateAgentConfigAction(agentId, config);
    if (!result.ok) throw new Error(result.error);
    setRecords((current) => current.map((r) => r.documentId === agentId ? { ...result.agent, x: r.x, y: r.y } : r));
    setDialog(null);
  }

  async function cancelHeadquartersTask(taskId: string) {
    const result = await cancelTaskAction(taskId);
    if (!result.ok) setNotice(result.error);
  }

  // Hides a stopped or finished task from the progress card right away; puts it back if saving fails.
  async function clearHeadquartersProgress(taskId: string) {
    const previous = hqTask;
    setHqTask((current) => current?.documentId === taskId ? null : current);
    const result = await clearTaskProgressAction(taskId);
    if (!result.ok) {
      setHqTask((current) => current ?? previous);
      setNotice(result.error);
    }
  }

  async function createAgent(draft: NewAgentDraft) {
    const result = await createAgentAction(draft);
    if (!result.ok) throw new Error(result.error);
    const office = officeOf(result.agent).id;
    setRecords((current) => [...current, result.agent]);
    setSelectedId(office);
    setPopoverId(office);
    setDialog(null);
    setFitKey((k) => k + 1); // frame the grown city so the new building is in view
  }

  async function saveAgent(agentId: string, draft: NewAgentDraft) {
    const result = await updateAgentAction(agentId, draft);
    if (!result.ok) throw new Error(result.error);
    // Keep the position the client already shows; a move may still be saving.
    setRecords((current) => current.map((r) => r.documentId === agentId ? { ...result.agent, x: r.x, y: r.y } : r));
    setDialog(null);
  }

  function moveHeadquarters(position: Plot) {
    const previous = hqPlot;
    setHqPlot(position);
    const rollBack = (message: string) => {
      setHqPlot((current) => current.x === position.x && current.y === position.y ? previous : current);
      setNotice(message);
    };
    const save = (moves.current.get(HEADQUARTERS_ID) ?? Promise.resolve()).then(() => moveHeadquartersAction(position)).then(
      (result) => { if (!result.ok) rollBack(result.error); },
      () => rollBack("We couldn't save the new location. Headquarters was moved back."),
    );
    moves.current.set(HEADQUARTERS_ID, save);
  }

  async function resetLayout() {
    // Let in-flight moves land first so they can't overwrite the reset.
    await Promise.allSettled(moves.current.values());
    const result = await resetLayoutAction();
    if (!result.ok) throw new Error(result.error);
    setHqPlot(result.headquarters);
    setRecords(result.agents);
    setResetting(false);
    setFitKey((k) => k + 1);
  }

  function moveBuilding(buildingId: string, position: { x: number; y: number }) {
    if (buildingId === HEADQUARTERS_ID) return moveHeadquarters(position);
    const record = recordOf(buildingId);
    if (!record) return;
    const id = record.documentId, previous = { x: record.x, y: record.y };
    setRecords((current) => current.map((r) => r.documentId === id ? { ...r, ...position } : r));
    const save = (moves.current.get(id) ?? Promise.resolve()).then(() => moveAgentAction(id, position)).then((result) => {
      if (result.ok) return;
      // Roll back only if the building is still where this failed save put it.
      setRecords((current) => current.map((r) => r.documentId === id && r.x === position.x && r.y === position.y ? { ...r, ...previous } : r));
      setNotice(result.error);
    }, () => {
      setRecords((current) => current.map((r) => r.documentId === id && r.x === position.x && r.y === position.y ? { ...r, ...previous } : r));
      setNotice("We couldn't save the new location. The building was moved back.");
    });
    moves.current.set(id, save);
  }

  async function removeAgent(record: AgentRecord) {
    const result = await deleteAgentAction(record.documentId);
    if (!result.ok) throw new Error(result.error);
    const office = officeOf(record).id;
    setRecords((current) => current.filter((r) => r.documentId !== record.documentId));
    setDeleting(null);
    setPopoverId((id) => id === office ? null : id);
    setSelectedId((id) => id === office ? HEADQUARTERS_ID : id);
  }

  const popoverRecord = popoverId ? recordOf(popoverId) : undefined;
  const popover: CityPopover | null = popoverRecord ? {
    buildingId: popoverId!,
    label: `${popoverRecord.name} details`,
    onClose: () => setPopoverId(null),
    content: <AgentPopoverCard record={popoverRecord} computerProps={computerProps}
      onClose={() => setPopoverId(null)}
      onEdit={() => setDialog({ mode: "edit", agentId: popoverRecord.documentId })}
      onConfigure={() => setDialog({ mode: "ai", agentId: popoverRecord.documentId })}
      onDelete={() => setDeleting(popoverRecord)} />,
  } : popoverId === HEADQUARTERS_ID ? {
    buildingId: HEADQUARTERS_ID,
    label: `${headquarters.name} details`,
    onClose: () => setPopoverId(null),
    content: <HeadquartersPopoverCard building={headquarters} agentCount={records.length} onClose={() => setPopoverId(null)} />,
  } : null;

  return (
    <div className={styles.layout}>
      <div className={styles.primary}>
        <header className={styles.pageHeader}>
          <div className={styles.headingGroup}>
            <h1 className={styles.title}>City</h1>
            <span className={styles.hqChip} title={headquarters.name}>{headquarters.name}</span>
            <span className={styles.countChip}>{records.length} {records.length === 1 ? "agent" : "agents"}</span>
          </div>
          <div className={styles.headerActions}>
            <NeedsYouButton requests={pendingRequests} onAnswered={computerProps.onAnswered} onOpenComputer={computerProps.onOpenForRequest} />
            {computersEnabled && <ComputerChip computer={computer ?? { state: "stopped", agentId: null, agentName: null, activity: null, url: null, pageTitle: null, since: null, error: null }}
              onOpen={() => setComputerView({ interactive: false, start: false })} />}
            <button type="button" className={styles.ghostButton} onClick={() => setResetting(true)} disabled={layoutIsOriginal}
              title={layoutIsOriginal ? "Your city is already in its original layout" : "Move every building back to its original plot"}>
              <RotateCcw size={14} aria-hidden="true" />
              Reset layout
            </button>
            <button type="button" className={styles.primaryButton} onClick={() => setDialog({ mode: "create" })}>
              <Plus size={15} aria-hidden="true" />
              Add agent
            </button>
          </div>
        </header>

        <CityStatsCards initialStats={initialStats} />

        <section aria-label="City map" className={styles.cityFrame}>
          <AgentCity
            config={config}
            agents={agents}
            selectedBuildingId={selected.id}
            onSelectBuilding={(building) => { setSelectedId(building.id); setPopoverId(building.id); }}
            onBuildingMove={moveBuilding}
            onBackgroundClick={() => setPopoverId(null)}
            popover={popover}
            callouts={callouts}
            fitKey={fitKey}
            className={styles.cityCanvas}
          />
          <p className={styles.cityHint}>Drag buildings to rearrange · drag the ground to pan · scroll to zoom</p>
          {notice && (
            <div className={styles.notice} role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{notice}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={14} aria-hidden="true" /></button>
            </div>
          )}
        </section>
      </div>

      <aside className={styles.secondary} aria-label="Selected agent">
        <WorkProgressCard task={hqTask} others={others} queue={queue} onCancel={cancelHeadquartersTask} onClear={clearHeadquartersProgress} />
        <AgentChat key={selected.id} building={selected} record={selectedRecord} hqTask={hqTask} queue={queue} onTaskStart={clearIdleStatus} computerProps={computerProps}
          thread={threads[selected.id === HEADQUARTERS_ID ? HEADQUARTERS_THREAD : selectedRecord?.documentId ?? ""]}
          onConfigure={selectedRecord ? () => setDialog({ mode: "ai", agentId: selectedRecord.documentId }) : undefined} />
      </aside>

      <AddAgentDialog
        key={dialog?.mode === "edit" ? dialog.agentId : "create"}
        open={dialog?.mode === "create" || Boolean(editing)}
        mode={editing ? "edit" : "create"}
        initialValue={editing ? toDraft(editing) : undefined}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        onCreate={(draft) => editing ? saveAgent(editing.documentId, draft) : createAgent(draft)}
      />
      {configuring && (
        <AgentConfigDialog key={configuring.documentId} record={configuring}
          onCancel={() => setDialog(null)} onSave={(config) => saveAgentConfig(configuring.documentId, config)} />
      )}
      {computerView && (
        <ComputerDialog computer={computer ?? { state: "stopped", agentId: null, agentName: null, activity: null, url: null, pageTitle: null, since: null, error: null }}
          requests={pendingRequests} interactive={computerView.interactive} startIfOff={computerView.start}
          onClose={() => setComputerView(null)} onAnswered={computerProps.onAnswered} />
      )}
      {deleting && (
        <ConfirmDialog tone="danger" icon={<Trash2 size={20} />} title={`Delete ${deleting.name}?`}
          description="This permanently removes the agent, its building, and its road from your city. This can’t be undone."
          confirmLabel="Delete agent" pendingLabel="Deleting…"
          onCancel={() => setDeleting(null)} onConfirm={() => removeAgent(deleting)} />
      )}
      {resetting && (
        <ConfirmDialog icon={<RotateCcw size={20} />} title="Reset the city layout?"
          description="Headquarters and the six starter agents go back to their original plots, and agents you added are lined up on the next free plots around headquarters. Names, instructions, and building designs stay the same."
          confirmLabel="Reset layout" pendingLabel="Resetting…"
          onCancel={() => setResetting(false)} onConfirm={resetLayout} />
      )}
    </div>
  );
}

// ---------- Building popover ----------

function AgentPopoverCard({ record, computerProps, onEdit, onConfigure, onDelete, onClose }: {
  record: AgentRecord; computerProps: ComputerProps; onEdit: () => void; onConfigure: () => void; onDelete: () => void; onClose: () => void;
}) {
  const titleId = useId();
  const { computer, enabled } = computerProps;
  const usingComputer = computer?.agentId === record.documentId;
  const hasComputer = enabled && record.tools.includes("computer");
  const needs = computerProps.requests.filter((r) => r.agentId === record.documentId);
  return (
    <div className={styles.popCard} aria-labelledby={titleId}>
      <div className={styles.popHeader}>
        <span className={styles.popIcon} style={{ background: themeAccent[record.theme] }}><BuildingIcon icon={record.icon} size={18} /></span>
        <div className={styles.popTitle}>
          <p id={titleId} className={styles.popName}>{record.name}</p>
          <p className={styles.popMeta}>{agentDesignInfo[record.design].label}</p>
        </div>
        <button type="button" className={styles.popClose} aria-label="Close details" onClick={onClose}><X size={15} aria-hidden="true" /></button>
      </div>
      <div className={styles.popRow}>
        <span className={styles.popKey}>Status</span>
        <span className={styles.statusPill} data-status={record.status}><span className={styles.statusDot} aria-hidden="true" />{STATUS_LABEL[record.status]}</span>
      </div>
      <div className={styles.popProgress}>
        {record.progress !== null ? (
          <>
            <div className={styles.cardHeaderRow}>
              <span className={styles.popKey}>Work progress</span>
              <span className={styles.percent}>{record.progress}%</span>
            </div>
            <div className={styles.progressTrack} role="progressbar" aria-label="Work progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={record.progress}>
              <div className={styles.progressFill} style={{ width: `${record.progress}%` }} />
            </div>
            {record.activity && <p className={styles.popActivity}>{record.activity}</p>}
          </>
        ) : (
          <p className={styles.popEmpty}>No active task right now.</p>
        )}
      </div>
      {needs.map((request) => (
        <RequestCard key={request.documentId} request={request} onAnswered={computerProps.onAnswered} onOpenComputer={computerProps.onOpenForRequest} />
      ))}
      {usingComputer && computer ? (
        <div className={styles.popComputer}>
          <span className={styles.popKey}>Using the cloud computer</span>
          <ComputerPreview computer={computer} agentName={record.name} onExpand={() => computerProps.onOpen({ interactive: false, start: false })} />
        </div>
      ) : hasComputer ? (
        <div className={styles.popRow}>
          <span className={styles.popKey}>Cloud computer</span>
          <button type="button" className={styles.popComputerButton} onClick={() => computerProps.onOpen({ interactive: false, start: false })}
            aria-label={`View the cloud computer${computer?.agentName ? ` (${computer.agentName} is using it)` : ""}`}>
            <Monitor size={14} aria-hidden="true" />
            {computer?.agentName ? `${computer.agentName} is on it` : computer?.state === "running" ? "On · view" : "View"}
          </button>
        </div>
      ) : null}
      <p className={styles.popTask} title={record.instructions}>{record.instructions}</p>
      <div className={styles.popActions}>
        <button type="button" className={`${styles.popEdit} ${styles.popWide}`} onClick={onConfigure}><Bot size={14} aria-hidden="true" />AI settings</button>
        <button type="button" className={styles.popEdit} onClick={onEdit}><Pencil size={14} aria-hidden="true" />Customize</button>
        <button type="button" className={styles.popDelete} onClick={onDelete}><Trash2 size={14} aria-hidden="true" />Delete agent</button>
      </div>
    </div>
  );
}

function HeadquartersPopoverCard({ building, agentCount, onClose }: { building: HeadquartersSpec; agentCount: number; onClose: () => void }) {
  return (
    <div className={styles.popCard}>
      <div className={styles.popHeader}>
        <span className={styles.popIcon} style={{ background: themeAccent[building.theme ?? "gold"] }}><BuildingIcon icon={building.icon} size={18} /></span>
        <div className={styles.popTitle}>
          <p className={styles.popName}>{building.name}</p>
          <p className={styles.popMeta}>Headquarters</p>
        </div>
        <button type="button" className={styles.popClose} aria-label="Close details" onClick={onClose}><X size={15} aria-hidden="true" /></button>
      </div>
      <p className={styles.popTask}>
        The center of your city — drag it to move it, and every road follows. {agentCount ? `${agentCount} ${agentCount === 1 ? "agent is" : "agents are"} connected by road.` : "Add an agent to connect its building here."}
      </p>
    </div>
  );
}

// ---------- Confirmation (delete agent, reset layout) ----------

function ConfirmDialog({ title, description, confirmLabel, pendingLabel, icon, tone = "default", onCancel, onConfirm }: {
  title: string; description: string; confirmLabel: string; pendingLabel: string; icon: ReactNode;
  tone?: "default" | "danger"; onCancel: () => void; onConfirm: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const titleId = useId(), descriptionId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { mounted.current = false; element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  async function confirm() {
    setPending(true); setError(null);
    try {
      await onConfirm();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  return (
    <dialog ref={dialog} className={styles.confirm} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }}>
      <span className={styles.confirmIcon} data-tone={tone} aria-hidden="true">{icon}</span>
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {error && <p role="alert" className={styles.confirmError}>{error}</p>}
      <div className={styles.confirmActions}>
        <button type="button" className={styles.secondaryButton} onClick={onCancel} disabled={pending} autoFocus>Cancel</button>
        <button type="button" className={tone === "danger" ? styles.dangerButton : styles.confirmButton} onClick={confirm} disabled={pending}>
          {pending ? <><Loader2 size={14} className={styles.spin} aria-hidden="true" />{pendingLabel}</> : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

// ---------- Right column ----------

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <Check size={13} aria-hidden="true" />;
  if (status === "active") return <Loader2 size={13} className={styles.spin} aria-hidden="true" />;
  if (status === "failed") return <X size={13} aria-hidden="true" />;
  return <Circle size={7} fill="currentColor" aria-hidden="true" />;
}

/** Steps of the headquarters plan, or the default pipeline when nothing has been planned yet. */
function stepsOf(task: HeadquartersTask): WorkflowStep[] {
  if (!task?.plan?.length) return WORKFLOW_STEPS;
  return task.plan.map((step) => ({ id: step.id, label: signLabel(step.agentName) || step.title, status: step.status }));
}

function WorkProgressCard({ task, others, queue, onCancel, onClear }: {
  task: HeadquartersTask; others: OtherTask[]; queue: QueuedTask[]; onCancel: (taskId: string) => Promise<void>; onClear: (taskId: string) => Promise<void>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const steps = stepsOf(task);
  const running = Boolean(task && !isTaskFinished(task.status));
  const planned = Boolean(task?.plan?.length);
  const done = steps.filter((s) => s.status === "done").length;
  const percent = task ? (task.status === "completed" ? 100 : task.progress) : 0;
  const summary = !task ? "No active task"
    : task.status === "queued" ? "Starting…"
    : running ? (planned ? `${done}/${steps.length} · ${percent}%` : `${percent}%`)
    : task.status === "completed" ? "Completed" : task.status === "cancelled" ? "Cancelled" : "Failed";

  async function cancel() {
    if (!task) return;
    setCancelling(true);
    try { await onCancel(task.documentId); } finally { setCancelling(false); }
  }

  async function remove(id: string) {
    setRemoving(id);
    try { await onCancel(id); } finally { setRemoving(null); }
  }

  return (
    <section className={`${styles.card} ${styles.compactCard}`} aria-labelledby="progress-heading">
      <div className={styles.cardHeaderRow}>
        <h2 id="progress-heading" className={styles.cardTitle}>Current Work Progress</h2>
        <span className={styles.percent} data-status={task?.status}>{summary}</span>
      </div>
      {task && (
        <div className={styles.taskLine}>
          <p className={styles.taskTitle} title={task.title}>{task.title}</p>
          {running && (
            <button type="button" className={styles.taskCancel} onClick={cancel} disabled={cancelling} aria-label="Cancel this task">
              {cancelling ? <Loader2 size={12} className={styles.spin} aria-hidden="true" /> : <Square size={11} aria-hidden="true" />}Stop
            </button>
          )}
          {!running && (
            <button type="button" className={styles.taskCancel} onClick={() => void onClear(task.documentId)} aria-label="Clear this work progress"
              title="Clear the work progress">
              <Eraser size={12} aria-hidden="true" />Clear
            </button>
          )}
        </div>
      )}
      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-label="Task progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={styles.progressFill} style={{ width: `${percent}%` }} />
      </div>
      {task && (running ? task.activity : task.status === "failed" ? task.error : null) && (
        <p className={styles.taskActivity} data-status={task.status}>{running ? task.activity : task.error}</p>
      )}
      <ol className={styles.steps} style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step) => (
          <li key={step.id} className={styles.step} data-status={step.status} title={`${step.label}: ${STEP_LABEL[step.status]}`}>
            <span className={styles.stepMarker}><StepIcon status={step.status} /></span>
            <span className={styles.stepLabel}>{step.label}</span>
            <span className={styles.srOnly}>{STEP_LABEL[step.status]}</span>
          </li>
        ))}
      </ol>
      {others.length > 0 && (
        <div className={styles.queue}>
          <p className={styles.queueHeading}><Loader2 size={13} className={styles.spin} aria-hidden="true" />Also in progress · {others.length}</p>
          <ul className={styles.queueList}>
            {others.map((item) => (
              <li key={item.documentId} className={styles.queueItem}>
                <span className={styles.queueTitle} title={item.activity ? `${item.title} — ${item.activity}` : item.title}>
                  {item.title}{item.activity && <span className={styles.queueActivity}> · {item.activity}</span>}
                </span>
                <button type="button" className={styles.queueRemove} onClick={() => void remove(item.documentId)} disabled={removing === item.documentId}
                  aria-label={`Stop “${item.title}”`} title="Stop this request">
                  {removing === item.documentId ? <Loader2 size={12} className={styles.spin} aria-hidden="true" /> : <Square size={11} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {queue.length > 0 && (
        <div className={styles.queue}>
          <p className={styles.queueHeading}><ListOrdered size={13} aria-hidden="true" />Up next · {queue.length} waiting</p>
          <ol className={styles.queueList}>
            {queue.map((item, i) => (
              <li key={item.documentId} className={styles.queueItem}>
                <span className={styles.queueIndex} aria-hidden="true">{i + 1}</span>
                <span className={styles.queueTitle} title={item.title}>{item.title}</span>
                <button type="button" className={styles.queueRemove} onClick={() => void remove(item.documentId)} disabled={removing === item.documentId}
                  aria-label={`Remove “${item.title}” from the queue`} title="Remove from the queue">
                  {removing === item.documentId ? <Loader2 size={12} className={styles.spin} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

const fromStored = (m: StoredMessage): ChatMessage => ({
  id: m.documentId, role: m.role === "user" ? "user" : "agent", text: m.content, createdAt: m.createdAt, artifacts: m.artifacts ?? [],
  attachments: m.attachments ?? [],
});

/** Puts a freshly loaded newest page under the older pages the reader already scrolled back to. */
function mergeLatest(current: ChatMessage[], latest: ChatMessage[]): ChatMessage[] {
  const first = latest[0]?.createdAt;
  if (!first) return latest.length ? latest : current;
  const ids = new Set(latest.map((m) => m.id));
  return [...current.filter((m) => !m.pending && m.createdAt && m.createdAt < first && !ids.has(m.id)), ...latest];
}

/** Scrolling within this many pixels of the top of the chat loads the previous page. */
const LOAD_OLDER_THRESHOLD = 48;
/** Most files one message can carry (the server enforces the same limit). */
const MAX_ATTACHMENTS = 10;

/** A file being attached to the next message: uploading, ready (saved as an artifact), or failed. */
type Attachment = { key: string; name: string; size: number; state: "uploading" | "ready" | "failed"; artifact?: ArtifactSummary; error?: string };

/** Uploads one file to the media library; it becomes an "upload" artifact every agent can open. */
/** Typed replies that answer an approval request directly. */
const APPROVE_WORDS = /^(yes|y|yep|yeah|ok|okay|sure|approve|approved|go ahead|do it|confirm(ed)?)[.!]*$/i;
const DECLINE_WORDS = /^(no|n|nope|decline|declined|don'?t|do not|stop|cancel)[.!]*$/i;

/** Reads a Server-Sent Events response body, calling `onEvent` for each `data:` frame. */
async function readEvents(response: Response, onEvent: (event: Record<string, unknown>) => void) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
      if (data) onEvent(JSON.parse(data) as Record<string, unknown>);
    }
  }
}

/**
 * Chat with the selected building. An agent office streams a direct reply from that agent; headquarters
 * takes the message as a request, plans it, and delegates it across agents in the background (queued behind a
 * request already running). Pending questions from the agent show here and can be answered with the buttons or
 * by typing; files can be attached, and Clear chat starts a fresh conversation.
 */
function AgentChat({ building, record, hqTask, queue, thread, onTaskStart, onConfigure, computerProps }: {
  computerProps: ComputerProps;
  building: CityBuilding;
  record?: AgentRecord;
  hqTask: HeadquartersTask;
  queue: QueuedTask[];
  /** This chat's current thread signature from the live stream; a change reloads the messages. */
  thread?: string;
  /** Called once a task starts here, with the agent taking it (none for headquarters). */
  onTaskStart: (agentId?: string) => void;
  onConfigure?: () => void;
}) {
  const isHeadquarters = building.id === HEADQUARTERS_ID;
  const target = isHeadquarters ? HEADQUARTERS_ID : record?.documentId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(Boolean(target));
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactSummary | null>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messagesRef = useRef(messages);
  const streamingRef = useRef(false);
  const olderBusy = useRef(false);
  /** Numbers optimistic messages, so each send has its own placeholder IDs. */
  const sends = useRef(0);
  /** Distance from the bottom of the log to keep after prepending an older page; null means stick to the bottom. */
  const keepFromBottom = useRef<number | null>(null);
  const inputId = useId();
  const hqRunning = isHeadquarters && Boolean(hqTask && !isTaskFinished(hqTask.status));
  const busy = streaming || hqRunning;
  const disabled = record ? !record.enabled : false;
  // Questions and sign-in requests from this agent (headquarters shows its whole team's) appear in the chat.
  const chatRequests = computerProps.requests.filter((r) => isHeadquarters || r.agentId === record?.documentId);
  // A question the composer can answer: this agent's own (for headquarters, only when it is the only one).
  const typeable = chatRequests.filter((r) => isQuestion(r.kind) && (r.allowOther || r.kind === "confirm") && (!isHeadquarters || !r.agentId || chatRequests.length === 1));
  const answerTarget = typeable[0] ?? null;
  const uploading = attachments.some((a) => a.state === "uploading");
  const ready = attachments.flatMap((a) => (a.state === "ready" && a.artifact ? [a.artifact] : []));
  const showComputer = computerProps.enabled && (isHeadquarters ? false : Boolean(record?.tools.includes("computer")) || computerProps.computer?.agentId === record?.documentId);
  const onComputer = Boolean(record && computerProps.computer?.agentId === record.documentId);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);

  // Refreshes the newest page (new replies, results posted by headquarters) without dropping older pages already loaded.
  const reload = useCallback(() => {
    if (!target) return Promise.resolve();
    return loadConversationAction(target).then((result) => {
      if (!result.ok) { setError(result.error); return; }
      const latest = result.messages.map(fromStored);
      const keepsOlder = mergeLatest(messagesRef.current, latest).length > latest.length;
      setMessages((current) => mergeLatest(current, latest));
      if (!keepsOlder) setHasMore(result.hasMore);
    }, () => setError("We couldn't load this conversation."));
  }, [target]);

  // Loads the newest page from scratch (first open, or a new conversation was started).
  const loadFresh = useCallback(() => {
    if (!target) return Promise.resolve();
    return loadConversationAction(target).then((result) => {
      if (result.ok) { setMessages(result.messages.map(fromStored)); setHasMore(result.hasMore); }
      else setError(result.error);
    }, () => setError("We couldn't load this conversation."));
  }, [target]);

  useEffect(() => {
    let alive = true;
    if (target) loadConversationAction(target).then((result) => {
      if (!alive) return;
      if (result.ok) { setMessages(result.messages.map(fromStored)); setHasMore(result.hasMore); }
      else setError(result.error);
    }, () => alive && setError("We couldn't load this conversation.")).finally(() => alive && setLoading(false));
    return () => { alive = false; abort.current?.abort(); };
  }, [target]);

  // The live stream reports each chat's current conversation and newest message. A new conversation (a new task
  // or Clear chat) replaces the log; a new message (a headquarters reply, a step result) is merged in.
  const seenThread = useRef(thread);
  useEffect(() => {
    const previous = seenThread.current;
    if (!thread || thread === previous || streamingRef.current) return;
    seenThread.current = thread;
    if (previous && previous.split(":")[0] !== thread.split(":")[0]) void loadFresh();
    else void reload();
  }, [thread, streaming, reload, loadFresh]);

  // Loads the page of messages before the oldest one shown, keeping the reader's place in the log.
  const loadOlder = useCallback(async () => {
    const before = messagesRef.current.find((m) => m.createdAt)?.createdAt;
    if (!target || !before || olderBusy.current) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    try {
      const result = await loadConversationAction(target, before);
      if (!result.ok) { setError(result.error); return; }
      const el = log.current;
      keepFromBottom.current = el ? el.scrollHeight - el.scrollTop : null;
      setMessages((current) => {
        const ids = new Set(current.map((m) => m.id));
        return [...result.messages.map(fromStored).filter((m) => !ids.has(m.id)), ...current];
      });
      setHasMore(result.hasMore);
    } catch {
      setError("We couldn't load earlier messages.");
    } finally {
      olderBusy.current = false;
      setLoadingOlder(false);
    }
  }, [target]);

  // New messages and streamed text keep the log at the bottom; a prepended older page keeps the current view.
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    if (keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
    } else el.scrollTo({ top: el.scrollHeight });
  }, [messages, toolLabel, hqTask?.artifacts?.length, chatRequests.length]);

  function onLogScroll() {
    if (hasMore && !loading && (log.current?.scrollTop ?? Infinity) < LOAD_OLDER_THRESHOLD) void loadOlder();
  }

  // ---------- Attachments ----------

  function addFiles(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setError(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (list.length > room) setError(`You can attach up to ${MAX_ATTACHMENTS} files to one message.`);
    for (const file of list.slice(0, Math.max(0, room))) {
      sends.current += 1;
      const key = `${file.name}-${file.size}-${sends.current}`;
      const problem = uploadProblem(file);
      setAttachments((current) => [...current, { key, name: file.name, size: file.size, state: problem ? "failed" : "uploading", ...(problem ? { error: problem } : {}) }]);
      if (problem) continue;
      uploadArtifactFile<ArtifactSummary>(file).then(
        (artifact) => setAttachments((current) => current.map((a) => (a.key === key ? { ...a, state: "ready", artifact } : a))),
        (reason: unknown) => setAttachments((current) => current.map((a) => (a.key === key ? { ...a, state: "failed", error: reason instanceof Error ? reason.message : "Upload failed." } : a))),
      );
    }
  }

  const removeAttachment = (key: string) => setAttachments((current) => current.filter((a) => a.key !== key));

  // ---------- Sending ----------

  async function sendToHeadquarters(text: string, files: ArtifactSummary[]) {
    const result = await askHeadquartersAction(text, files.map((a) => a.documentId));
    if (!result.ok) { setError(result.error); setDraft(text); return; }
    setMessages((m) => [...m, fromStored(result.message)]);
    setAttachments([]);
    // A queued request starts later; the city is cleared when it actually starts.
    if (result.queuePosition === 0) onTaskStart();
  }

  async function sendToAgent(agentId: string, text: string, files: ArtifactSummary[]) {
    const controller = new AbortController();
    abort.current = controller;
    sends.current += 1;
    const pendingId = `pending-${sends.current}`;
    setStreaming(true);
    streamingRef.current = true;
    setAttachments([]);
    setMessages((m) => [...m, { id: `user-${pendingId}`, role: "user", text: text || "Shared files.", artifacts: [], attachments: files }, { id: pendingId, role: "agent", text: "", pending: true, artifacts: [] }]);
    const update = (fn: (message: ChatMessage) => ChatMessage) => setMessages((m) => m.map((x) => (x.id === pendingId ? fn(x) : x)));
    try {
      const response = await fetch(`/api/agents/${agentId}/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ message: text, attachments: files.map((a) => a.documentId) }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "The agent couldn't reply. Please try again.");
      }
      onTaskStart(agentId);
      await readEvents(response, (event) => {
        if (event.type === "start" && event.message) {
          // The saved user message (with its timestamp) replaces the optimistic one.
          const saved = fromStored(event.message as StoredMessage);
          setMessages((m) => m.map((x) => (x.id === `user-${pendingId}` ? saved : x)));
        } else if (event.type === "delta") { setToolLabel(null); update((m) => ({ ...m, text: m.text + String(event.text ?? "") })); }
        else if (event.type === "tool") setToolLabel(String(event.label ?? "Working"));
        else if (event.type === "artifact" && event.artifact) {
          // Show each deliverable as soon as it is saved, while the agent keeps working.
          const artifact = event.artifact as ArtifactSummary;
          update((m) => ({ ...m, artifacts: [...m.artifacts.filter((a) => a.documentId !== artifact.documentId), artifact] }));
        }
        else if (event.type === "done") {
          const saved = event.message as StoredMessage;
          setMessages((m) => m.map((x) => (x.id === pendingId ? fromStored(saved) : x)));
        } else if (event.type === "error") throw new Error(String(event.message ?? "The agent couldn't finish."));
      });
    } catch (reason) {
      if (controller.signal.aborted) update((m) => ({ ...m, pending: false, text: m.text ? `${m.text}\n\n— stopped` : "Stopped." }));
      else {
        setMessages((m) => m.filter((x) => x.id !== pendingId || x.text || x.artifacts.length));
        setError(reason instanceof Error ? reason.message : "The agent couldn't reply.");
      }
    } finally {
      update((m) => ({ ...m, pending: false }));
      setStreaming(false);
      streamingRef.current = false;
      setToolLabel(null);
      abort.current = null;
    }
  }

  /** Answers the agent's pending question (or approval) with what the user typed; the agent continues by itself. */
  async function answerWithText(request: AgentRequest, text: string) {
    setAnswering(true);
    const answer = request.kind === "confirm" && APPROVE_WORDS.test(text) ? { optionId: "approve" }
      : request.kind === "confirm" && DECLINE_WORDS.test(text) ? { optionId: "decline" }
      : { text };
    const result = await answerRequestAction(request.documentId, answer);
    setAnswering(false);
    if (result.ok) computerProps.onAnswered(request.documentId);
    else { setError(result.error); setDraft(text); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (disabled || uploading || answering) return;
    // While the agent waits on a question, typing answers it (attachments go with a normal message instead).
    if (answerTarget && text && !ready.length) {
      setDraft(""); setError(null);
      void answerWithText(answerTarget, text);
      return;
    }
    if ((!text && !ready.length) || streaming) return;
    setDraft("");
    setError(null);
    if (isHeadquarters) void sendToHeadquarters(text, ready);
    else if (record) void sendToAgent(record.documentId, text, ready);
  }

  async function clearChat() {
    if (!target) return;
    const result = await clearConversationAction(target);
    if (!result.ok) throw new Error(result.error);
    setMessages([]);
    setHasMore(false);
    setError(null);
    setClearing(false);
  }

  const placeholder = disabled ? `${building.name} is turned off`
    : answerTarget ? `Answer: ${answerTarget.title}`
    : isHeadquarters ? (hqRunning ? "Add another request to the queue…" : "Ask headquarters to create something…")
    : `Message ${building.name}…`;
  const canSend = !disabled && !loading && !uploading && !answering && (Boolean(draft.trim()) || ready.length > 0);
  return (
    <section className={`${styles.card} ${styles.chat}`} aria-labelledby="chat-heading" data-dragging={dragging || undefined}
      onDragOver={(e) => { if (!disabled && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDragging(false); if (!disabled) addFiles(e.dataTransfer.files); }}>
      <div className={styles.chatHeader}>
        <span className={styles.chatBuilding}><AgentBuilding building={building} className={styles.chatBuildingSvg} /></span>
        <h2 id="chat-heading" className={styles.chatName} title={building.name}>{building.name}</h2>
        <button type="button" className={styles.chatClear} onClick={() => setClearing(true)} disabled={!target || streaming || loading || messages.length === 0}
          aria-label={`Clear the chat with ${building.name}`} title="Clear chat (saved artifacts and task history are kept)">
          <Eraser size={15} aria-hidden="true" />
        </button>
        {showComputer && (
          <button type="button" className={styles.chatComputer} data-live={onComputer || undefined} onClick={() => computerProps.onOpen({ interactive: false, start: false })}
            aria-label={onComputer ? `${building.name} is using the cloud computer. Watch it` : "View the cloud computer"} title={onComputer ? "Watch the cloud computer" : "Cloud computer"}>
            <Monitor size={15} aria-hidden="true" />
          </button>
        )}
        {onConfigure && (
          <button type="button" className={styles.chatSettings} onClick={onConfigure} aria-label={`AI settings for ${building.name}`} title="AI settings">
            <Wrench size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      <div ref={log} className={styles.chatLog} role="log" aria-live="polite" aria-busy={busy} aria-label={`Conversation with ${building.name}`} onScroll={onLogScroll}>
        {hasMore && !loading && (
          <button type="button" className={styles.chatMore} onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? <><Loader2 size={12} className={styles.spin} aria-hidden="true" />Loading earlier messages…</> : "Load earlier messages"}
          </button>
        )}
        {loading ? (
          <div className={styles.chatEmpty}><Loader2 size={20} className={styles.spin} aria-hidden="true" /><p>Loading conversation…</p></div>
        ) : messages.length === 0 && !busy && !chatRequests.length ? (
          <div className={styles.chatEmpty}>
            <MessageSquare size={22} aria-hidden="true" />
            <p>{isHeadquarters ? "Tell headquarters what to make, e.g. “Create a 60-second video about AI note-taking apps.”" : `Start a conversation with ${building.name}.`}</p>
            <p className={styles.chatHint}>Attach images, videos, or documents with the paperclip or by dropping them here.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={styles.turn} data-role={m.role}>
              {m.role === "user" && m.attachments?.length ? <ArtifactCards artifacts={m.attachments} onOpen={setPreview} /> : null}
              {(m.text || m.pending) && (
                <div className={styles.bubble} data-role={m.role} data-pending={m.pending || undefined}>
                  {m.text
                    ? (m.role === "agent" ? <Markdown>{m.text}</Markdown> : m.text)
                    : <Loader2 size={14} className={styles.spin} aria-label="Thinking" />}
                </div>
              )}
              {m.role === "agent" && <ArtifactCards artifacts={m.artifacts} onOpen={setPreview} />}
            </div>
          ))
        )}
        {streaming && toolLabel && <p className={styles.chatStatus}><Loader2 size={12} className={styles.spin} aria-hidden="true" />{toolLabel}…</p>}
        {hqRunning && hqTask && (
          <>
            <p className={styles.chatStatus}><Loader2 size={12} className={styles.spin} aria-hidden="true" />{hqTask.activity ?? "Working"}…</p>
            <ArtifactCards artifacts={hqTask.artifacts ?? []} onOpen={setPreview} label="Delivered so far" />
          </>
        )}
        {isHeadquarters && queue.length > 0 && (
          <p className={styles.chatStatus}><ListOrdered size={12} aria-hidden="true" />{queue.length === 1 ? "1 request is" : `${queue.length} requests are`} waiting in the queue and will start by themselves.</p>
        )}
        {chatRequests.map((request) => (
          <RequestCard key={request.documentId} request={request} onAnswered={computerProps.onAnswered} onOpenComputer={computerProps.onOpenForRequest} />
        ))}
        {error && <p className={styles.chatError} role="alert">{error}</p>}
      </div>

      {attachments.length > 0 && (
        <ul className={styles.attachments} aria-label="Attached files">
          {attachments.map((a) => (
            <li key={a.key} className={styles.attachment} data-state={a.state} title={a.error ?? `${a.name} · ${formatBytes(a.size)}`}>
              {a.state === "uploading" ? <Loader2 size={12} className={styles.spin} aria-label="Uploading" />
                : a.state === "failed" ? <AlertTriangle size={12} aria-label="Upload failed" /> : <Paperclip size={12} aria-hidden="true" />}
              <span className={styles.attachmentName}>{a.name}</span>
              {a.state === "failed" && <span className={styles.srOnly}>{a.error}</span>}
              <button type="button" onClick={() => removeAttachment(a.key)} aria-label={`Remove ${a.name}`}><X size={12} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <form className={styles.composer} onSubmit={submit}>
        <input ref={fileInput} type="file" multiple accept={UPLOAD_ACCEPT} className={styles.srOnly} tabIndex={-1} aria-hidden="true"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <button type="button" className={styles.attachButton} onClick={() => fileInput.current?.click()} disabled={disabled || loading || attachments.length >= MAX_ATTACHMENTS}
          aria-label="Attach files" title={`Attach images, videos, audio, or documents (up to ${formatBytes(UPLOAD_MAX_BYTES)} each)`}>
          <Paperclip size={16} aria-hidden="true" />
        </button>
        <label htmlFor={inputId} className={styles.srOnly}>{answerTarget ? `Answer ${answerTarget.agentName ?? "headquarters"}: ${answerTarget.title}` : `Message ${building.name}`}</label>
        <input
          id={inputId}
          className={styles.composerInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={8000}
          disabled={disabled || loading}
        />
        {streaming && (
          <button type="button" className={styles.sendButton} data-variant="stop" onClick={() => abort.current?.abort()} aria-label="Stop the reply">
            <Square size={14} aria-hidden="true" />
          </button>
        )}
        {(!streaming || answerTarget) && (
          <button type="submit" className={styles.sendButton} disabled={!canSend || (streaming && !draft.trim())}
            aria-label={answerTarget && draft.trim() && !ready.length ? "Send answer" : isHeadquarters && hqRunning ? "Add to the queue" : "Send message"}>
            {uploading || answering ? <Loader2 size={16} className={styles.spin} aria-hidden="true" /> : <SendHorizontal size={16} aria-hidden="true" />}
          </button>
        )}
      </form>
      {preview && <ArtifactDialog key={preview.documentId} summary={preview} onClose={() => setPreview(null)} />}
      {clearing && (
        <ConfirmDialog icon={<Eraser size={20} />} title={`Clear the chat with ${building.name}?`}
          description={`This starts a fresh conversation, so earlier messages no longer show here or reach ${isHeadquarters ? "headquarters" : building.name}. Saved artifacts, uploaded files, task history, shared memory, and AI settings are kept.`}
          confirmLabel="Clear chat" pendingLabel="Clearing…" onCancel={() => setClearing(false)} onConfirm={clearChat} />
      )}
    </section>
  );
}
