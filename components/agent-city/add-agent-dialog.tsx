'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AgentBuilding } from './agent-building';
import { BuildingIcon, buildingIconLabels } from './building-icon';
import {
  agentDesignInfo, agentDesigns, buildingIcons, buildingThemes, roofItems, themeAccent, type AgentOffice,
} from './types';
import styles from './add-agent-dialog.module.css';

export const AGENT_NAME_MAX = 32;
export const AGENT_TASK_MAX = 2000;

export interface NewAgentDraft {
  name: string;
  task: string;
  appearance: Omit<AgentOffice, 'id' | 'agentId' | 'name' | 'type' | 'x' | 'y'>;
}
export interface AddAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Receives a validated draft. The caller owns IDs, placement, storage, and closing.
   * Return a promise to show a pending state; a rejection keeps the dialog open with the draft and shows its message.
   */
  onCreate: (draft: NewAgentDraft) => void | Promise<void>;
  initialValue?: NewAgentDraft;
  /** `edit` relabels the dialog for changing an existing agent. */
  mode?: 'create' | 'edit';
  night?: boolean;
}
const defaultAppearance: NewAgentDraft['appearance'] = {
  design: 'studio', theme: 'lavender', icon: 'sparkle', floors: 1, glass: 'full',
  interior: 'desk', roof: ['tree', 'units'], trees: true,
};
const palette = { lavender: '#9472cb', mint: '#63bca4', peach: '#efa47c', sky: '#79a8e9', rose: '#d986ac', white: '#d7dce5' };
const interiors = { desk: 'Research desk', writer: 'Writing desk', voice: 'Voice booth', editing: 'Editing suite', gallery: 'Art gallery', publish: 'Publishing desk' };
const roofLabels = { tree: 'Tree', units: 'AC units', dish: 'Satellite', solar: 'Solar', garden: 'Garden' };

/** A fresh draft per opening; cancelling never changes the caller's city. */
export function AddAgentDialog(props: AddAgentDialogProps) {
  return props.open ? <AgentDialogContent {...props} /> : null;
}
function AgentDialogContent({ onOpenChange, onCreate, initialValue, night, mode = 'create' }: AddAgentDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const titleId = useId(), descriptionId = useId(), nameId = useId(), taskId = useId(), errorId = useId();
  const [name, setName] = useState(initialValue?.name ?? '');
  const [task, setTask] = useState(initialValue?.task ?? '');
  const [appearance, setAppearance] = useState(() => ({ ...defaultAppearance, ...initialValue?.appearance }));
  const [previewNight, setPreviewNight] = useState(night ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = mode === 'edit';
  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    nameInput.current?.focus();
    return () => { mounted.current = false; element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  function update(patch: NewAgentDraft['appearance']) { setAppearance(a => ({ ...a, ...patch })); }
  function dismiss() { if (!pending) onOpenChange(false); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !name.trim() || !task.trim()) return;
    setPending(true); setError(null);
    try {
      await onCreate({ name: name.trim().replace(/\s+/g, ' '), task: task.trim(), appearance: { ...appearance, roof: [...(appearance.roof || [])] } });
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error && reason.message ? reason.message : 'Something went wrong. Please try again.');
    } finally {
      if (mounted.current) setPending(false);
    }
  }
  const design = appearance.design ?? 'studio';
  const label = name.trim() || 'Agent';
  const preview: AgentOffice = { ...appearance, id: 'new-agent-preview', type: 'agent', name: label, x: 0, y: 0 };
  const { theme, icon } = appearance;
  const designCards = useMemo(() => agentDesigns.map(d => ({ design: d, building: {
    id: `design-${d}`, type: 'agent', name: label, x: 0, y: 0, design: d, theme, icon, floors: 1, trees: false, interior: 'desk', roof: [],
  } satisfies AgentOffice })), [label, theme, icon]);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending || undefined}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss();
    }}>
    <form className={styles.form} onSubmit={submit}>
      <header className={styles.header}>
        <div className={styles.headingIcon} aria-hidden="true">✦</div>
        <div>
          <span className={styles.eyebrow}>{editing ? 'CUSTOMIZE YOUR AGENT' : 'GROW YOUR CREATIVE TEAM'}</span>
          <h2 id={titleId}>{editing ? `Edit ${initialValue?.name || 'agent'}` : 'A new agent. A new possibility.'}</h2>
          <p id={descriptionId}>{editing ? 'Update their instructions or redesign their building. Their spot in the city stays the same.' : 'Define their role and build a place they can call home.'}</p>
        </div>
        <button type="button" className={styles.close} aria-label="Close dialog" onClick={dismiss} disabled={pending}>×</button>
      </header>
      <div className={styles.body}>
        <div className={styles.fields}>
          <section aria-labelledby={`${titleId}-role`}><h3 id={`${titleId}-role`}><span>01</span> Meet your agent</h3>
            <label className={styles.field} htmlFor={nameId}>Agent name <input ref={nameInput} id={nameId} required maxLength={AGENT_NAME_MAX} placeholder="e.g. Thumbnail Designer" value={name} onChange={e => setName(e.target.value)} /></label>
            <label className={styles.field} htmlFor={taskId}>Agent instructions <textarea id={taskId} required maxLength={AGENT_TASK_MAX} rows={3} placeholder="Find credible sources, gather key facts, and prepare a research brief for the script writer." value={task} onChange={e => setTask(e.target.value)} /></label>
            <p className={styles.hint}>Give your agent one clear responsibility. You can refine it later.</p>
          </section>
          <section aria-labelledby={`${titleId}-design`}><h3 id={`${titleId}-design`}><span>02</span> Choose a building</h3>
            <div className={styles.designs} role="radiogroup" aria-labelledby={`${titleId}-design`}>
              {designCards.map(({ design: d, building }) => <button key={d} type="button" role="radio" aria-checked={design === d} className={styles.design} onClick={() => update({ design: d })}>
                <span className={styles.designArt}><AgentBuilding building={building} /></span>
                <span className={styles.designName}>{agentDesignInfo[d].label}</span>
                <span className={styles.designDescription}>{agentDesignInfo[d].description}</span>
              </button>)}
            </div>
          </section>
          <section aria-labelledby={`${titleId}-office`}><h3 id={`${titleId}-office`}><span>03</span> Make it their own</h3>
            <fieldset className={styles.palette}><legend>Building color</legend><div>{buildingThemes.map(theme => <button key={theme} type="button" aria-label={`${theme} palette`} aria-pressed={appearance.theme === theme}
              style={{ backgroundColor: palette[theme] }} onClick={() => update({ theme })}>{appearance.theme === theme ? '✓' : ''}</button>)}</div></fieldset>
            <fieldset className={styles.icons}><legend>Sign icon</legend><div>{buildingIcons.map(icon => <button key={icon} type="button" aria-label={buildingIconLabels[icon]} title={buildingIconLabels[icon]} aria-pressed={appearance.icon === icon}
              style={appearance.icon === icon ? { backgroundColor: themeAccent[appearance.theme ?? 'lavender'] } : undefined} onClick={() => update({ icon })}><BuildingIcon icon={icon} size={15} /></button>)}</div></fieldset>
            <fieldset className={styles.segmented}><legend>Height</legend><div>{([1, 2, 3, 4] as const).map(n => <button key={n} type="button" aria-pressed={appearance.floors === n} onClick={() => update({ floors: n })}>{n} {n === 1 ? 'floor' : 'floors'}</button>)}</div></fieldset>
            {design === 'studio' && <>
              <div className={styles.two}>
                <label className={styles.field}>Interior<select value={appearance.interior} onChange={e => update({ interior: e.target.value as AgentOffice['interior'] })}>{Object.entries(interiors).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
                <label className={styles.field}>Windows<select value={appearance.glass} onChange={e => update({ glass: e.target.value as AgentOffice['glass'] })}><option value="full">Both sides</option><option value="front">Front only</option><option value="none">Solid walls</option></select></label>
              </div>
              <fieldset className={styles.roof}><legend>On the rooftop</legend><div>{roofItems.map(item => <label key={item}><input type="checkbox" checked={appearance.roof?.includes(item) ?? false}
                onChange={e => update({ roof: e.target.checked ? [...(appearance.roof || []), item] : appearance.roof?.filter(r => r !== item) })} />{roofLabels[item]}</label>)}</div></fieldset>
            </>}
            <label className={styles.landscape}><input type="checkbox" checked={appearance.trees !== false} onChange={e => update({ trees: e.target.checked })} /> Add trees and landscaping</label>
          </section>
        </div>
        <aside className={styles.preview} aria-label="Live building preview" data-night={previewNight || undefined}>
          <div className={styles.previewTop}><span className={styles.eyebrow}>LIVE PREVIEW</span><button type="button" aria-pressed={previewNight} onClick={() => setPreviewNight(n => !n)}>{previewNight ? '☀ Day' : '☾ Night'}</button></div>
          <div className={styles.model}><AgentBuilding building={preview} night={previewNight} /></div>
          <div className={styles.agentCard}>
            <span className={styles.status}>{editing ? 'Saved in your city' : 'Ready to join'} · {agentDesignInfo[design].label}</span>
            <h3>{name.trim() || 'Your next great teammate'}</h3>
            <p>{task.trim() || 'A little space for your next big idea. Your agent’s instructions will appear here.'}</p>
          </div>
        </aside>
      </div>
      <footer className={styles.footer}>
        {error ? <p id={errorId} role="alert" className={styles.error}>{error}</p> : <span>{editing ? 'Changes apply to this agent’s building only.' : 'One agent. Their own place in your city, connected to headquarters.'}</span>}
        <div>
          <button type="button" className={styles.cancel} onClick={dismiss} disabled={pending}>Cancel</button>
          <button type="submit" className={styles.create} disabled={pending || !name.trim() || !task.trim()} aria-describedby={error ? errorId : undefined}>
            {pending ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : <>Create agent <span aria-hidden="true">↗</span></>}
          </button>
        </div>
      </footer>
    </form>
  </dialog>;
}
