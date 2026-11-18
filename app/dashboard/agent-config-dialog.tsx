"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  AudioLines, Bot, Brain, CalendarClock, Check, Clapperboard, Cpu, Film, Globe, ImagePlus, Loader2, MonitorCog, Palette,
  PenLine, Send, Sparkles, Telescope, WandSparkles, X, type LucideIcon,
} from "lucide-react";
import {
  MAX_TURNS_LIMIT, MODEL_SUGGESTIONS, TIMEOUT_LIMIT_SECONDS, agentRoleLabels, agentRoles, agentToolInfo, agentToolKeys, reasoningEfforts, roleDefaultTools,
  type AgentRole, type AgentRuntimeConfig, type AgentToolKey, type ReasoningEffort,
} from "@/lib/agent-config";
import type { AgentRecord } from "@/lib/agent-records";
import styles from "./agent-config-dialog.module.css";

const roleIcons: Record<AgentRole, LucideIcon> = {
  research: Telescope, script: PenLine, voice: AudioLines, media: Palette, editor: Film, publisher: Send, custom: Sparkles,
};

/** Icon and tint for each tool tile. The tint only colours the icon chip; selection uses the accent colour. */
const toolLook: Record<AgentToolKey, { icon: LucideIcon; tone: string }> = {
  memory: { icon: Brain, tone: "#8b5cf6" },
  web_search: { icon: Globe, tone: "#0ea5e9" },
  computer: { icon: MonitorCog, tone: "#64748b" },
  voiceover: { icon: AudioLines, tone: "#f97316" },
  image: { icon: ImagePlus, tone: "#ec4899" },
  image_edit: { icon: WandSparkles, tone: "#d946ef" },
  video_timeline: { icon: Clapperboard, tone: "#ef4444" },
  publish_schedule: { icon: CalendarClock, tone: "#10b981" },
};

const effortLabel = (effort: ReasoningEffort | null) => (effort ? effort[0].toUpperCase() + effort.slice(1) : "Auto");

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return Number.isInteger(minutes) ? `${minutes} min` : `${Math.floor(minutes)}m ${seconds % 60}s`;
  return `${(minutes / 60).toFixed(minutes % 60 ? 1 : 0)} h`;
}

/**
 * Edits an agent's AI configuration: role, model, tools, and execution settings. Name, instructions, and the
 * building are edited in AddAgentDialog ("Customize"). `onSave` may reject with a message; the draft is kept.
 */
export function AgentConfigDialog({ record, onCancel, onSave }: {
  record: AgentRecord;
  onCancel: () => void;
  onSave: (config: AgentRuntimeConfig) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const titleId = useId(), modelList = useId(), turnsId = useId(), timeId = useId();
  const [draft, setDraft] = useState<AgentRuntimeConfig>(() => ({
    role: record.role, model: record.model, tools: [...record.tools], settings: { ...record.settings }, enabled: record.enabled,
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { mounted.current = false; element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);

  const toggleTool = (key: AgentToolKey, on: boolean) =>
    setDraft((d) => ({ ...d, tools: on ? [...new Set([...d.tools, key])] : d.tools.filter((t) => t !== key) }));
  const setSetting = <K extends keyof AgentRuntimeConfig["settings"]>(key: K, value: AgentRuntimeConfig["settings"][K]) =>
    setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  const setRole = (role: AgentRole) =>
    setDraft((d) => ({ ...d, role, tools: d.role === role ? d.tools : [...roleDefaultTools[role]] }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError(null);
    try {
      await onSave(draft);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Something went wrong. Please try again.");
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  const cancel = () => { if (!pending) onCancel(); };
  const fill = (value: number, min: number, max: number) => ({ "--fill": `${((value - min) / (max - min)) * 100}%` }) as CSSProperties;

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); cancel(); }}>
      <form onSubmit={submit} className={styles.form}>
        <header className={styles.header}>
          <span className={styles.avatar} data-on={draft.enabled} aria-hidden="true"><Bot size={20} /></span>
          <div className={styles.heading}>
            <h2 id={titleId}>AI settings</h2>
            <p>{record.name}</p>
          </div>
          <label className={styles.power} title="When off, it can’t be chatted with or receive work from headquarters.">
            <input type="checkbox" role="switch" checked={draft.enabled}
              onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))} />
            <span className={styles.track} aria-hidden="true"><span /></span>
            <span className={styles.powerLabel}>{draft.enabled ? "Active" : "Paused"}</span>
          </label>
          <button type="button" className={styles.close} onClick={cancel} disabled={pending} aria-label="Close"><X size={16} /></button>
        </header>

        <div className={styles.body}>
          {!draft.enabled && (
            <p className={styles.notice}>Paused agents can’t be chatted with or receive work from headquarters.</p>
          )}

          <fieldset className={styles.section}>
            <legend>Role</legend>
            <div className={styles.chips}>
              {agentRoles.map((role) => {
                const Icon = roleIcons[role];
                return (
                  <label key={role} className={styles.chip}>
                    <input type="radio" name="role" value={role} checked={draft.role === role} onChange={() => setRole(role)} />
                    <Icon size={14} aria-hidden="true" />{agentRoleLabels[role]}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className={styles.section}>
            <span className={styles.legend}>Model</span>
            <span className={styles.model}>
              <Cpu size={15} aria-hidden="true" />
              <input list={modelList} value={draft.model ?? ""} placeholder="Server default" autoComplete="off" spellCheck={false}
                onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value.trim() || null }))} />
            </span>
            <datalist id={modelList}>{MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
          </label>

          <fieldset className={styles.section}>
            <legend>Tools <span className={styles.count}>{draft.tools.length} of {agentToolKeys.length}</span></legend>
            <div className={styles.tools}>
              {agentToolKeys.map((key) => {
                const { icon: Icon, tone } = toolLook[key];
                return (
                  <label key={key} className={styles.tool} style={{ "--tone": tone } as CSSProperties}>
                    <input type="checkbox" checked={draft.tools.includes(key)} onChange={(e) => toggleTool(key, e.target.checked)} />
                    <span className={styles.toolIcon} aria-hidden="true"><Icon size={18} /></span>
                    <span className={styles.toolText}>
                      <strong>{agentToolInfo[key].label}</strong>
                      <small title={agentToolInfo[key].description}>{agentToolInfo[key].description}</small>
                    </span>
                    <span className={styles.tick} aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className={styles.section}>
            <legend>Limits</legend>
            <div className={styles.sliders}>
              <div className={styles.slider}>
                <span className={styles.sliderHead}>
                  <label htmlFor={turnsId}>Max turns</label>
                  <output htmlFor={turnsId}>{draft.settings.maxTurns}</output>
                </span>
                <input id={turnsId} type="range" min={1} max={MAX_TURNS_LIMIT} value={draft.settings.maxTurns}
                  style={fill(draft.settings.maxTurns, 1, MAX_TURNS_LIMIT)} onChange={(e) => setSetting("maxTurns", Number(e.target.value))} />
              </div>
              <div className={styles.slider}>
                <span className={styles.sliderHead}>
                  <label htmlFor={timeId}>Time limit</label>
                  <output htmlFor={timeId}>{formatDuration(draft.settings.timeoutSeconds)}</output>
                </span>
                <input id={timeId} type="range" min={30} max={TIMEOUT_LIMIT_SECONDS} step={30} value={draft.settings.timeoutSeconds}
                  aria-valuetext={formatDuration(draft.settings.timeoutSeconds)}
                  style={fill(draft.settings.timeoutSeconds, 30, TIMEOUT_LIMIT_SECONDS)} onChange={(e) => setSetting("timeoutSeconds", Number(e.target.value))} />
              </div>
            </div>
          </fieldset>

          <fieldset className={styles.section}>
            <legend>Reasoning</legend>
            <div className={styles.segmented}>
              {[null, ...reasoningEfforts].map((effort, index) => (
                <label key={effort ?? "auto"} className={styles.segment}>
                  <input type="radio" name="reasoning" checked={draft.settings.reasoningEffort === effort}
                    onChange={() => setSetting("reasoningEffort", effort)} />
                  {effort && <span className={styles.bars} data-level={index - 1} aria-hidden="true"><i /><i /><i /><i /></span>}
                  {effortLabel(effort)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <footer className={styles.footer}>
          {error ? <p role="alert" className={styles.error}>{error}</p> : (
            <p className={styles.summary}>{draft.model ?? "Default model"} · {draft.tools.length} {draft.tools.length === 1 ? "tool" : "tools"}</p>
          )}
          <button type="button" className={styles.secondary} onClick={cancel} disabled={pending}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={pending}>
            {pending ? <><Loader2 size={14} className={styles.spin} aria-hidden="true" />Saving…</> : "Save"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
