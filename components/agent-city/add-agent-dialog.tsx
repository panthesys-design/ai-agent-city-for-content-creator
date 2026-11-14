'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AgentBuilding } from './agent-building';
import { buildingIcons, buildingThemes, roofItems, type AgentOffice } from './types';
import styles from './add-agent-dialog.module.css';

export interface NewAgentDraft {
  name: string;
  task: string;
  appearance: Omit<AgentOffice, 'id' | 'agentId' | 'name' | 'type' | 'x' | 'y'>;
}
export interface AddAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives a validated draft. The caller owns IDs, placement, storage, and closing. */
  onCreate: (draft: NewAgentDraft) => void;
  initialValue?: NewAgentDraft;
  night?: boolean;
}
const defaultAppearance: NewAgentDraft['appearance'] = {
  theme: 'lavender', icon: 'sparkle', floors: 1, glass: 'full',
  interior: 'desk', roof: ['tree', 'units'], trees: true,
};
const palette = { lavender: '#9472cb', mint: '#63bca4', peach: '#efa47c', sky: '#79a8e9', rose: '#d986ac', white: '#d7dce5' };

/** A fresh draft per opening; cancelling never changes the caller's city. */
export function AddAgentDialog(props: AddAgentDialogProps) {
  return props.open ? <AgentDialogContent {...props} /> : null;
}
function AgentDialogContent({ onOpenChange, onCreate, initialValue, night }: AddAgentDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const titleId = useId(), descriptionId = useId(), nameId = useId(), taskId = useId();
  const [name, setName] = useState(initialValue?.name ?? '');
  const [task, setTask] = useState(initialValue?.task ?? '');
  const [appearance, setAppearance] = useState(() => ({ ...defaultAppearance, ...initialValue?.appearance }));
  const [previewNight, setPreviewNight] = useState(night ?? false);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    nameInput.current?.focus();
    return () => { element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  function update(patch: NewAgentDraft['appearance']) { setAppearance(a => ({ ...a, ...patch })); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !task.trim()) return;
    onCreate({ name: name.trim(), task: task.trim(), appearance: { ...appearance, roof: [...(appearance.roof || [])] } });
  }
  const preview: AgentOffice = { ...appearance, id: 'new-agent-preview', type: 'agent', name: name.trim() || 'Your agent', x: 0, y: 0 };
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onOpenChange(false); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onOpenChange(false);
    }}>
    <form onSubmit={submit}>
      <header className={styles.header}>
        <div className={styles.headingIcon} aria-hidden="true">✦</div>
        <div><span className={styles.eyebrow}>GROW YOUR CREATIVE TEAM</span><h2 id={titleId}>A new agent. A new possibility.</h2><p id={descriptionId}>Define their role and build a place they can call home.</p></div>
        <button type="button" className={styles.close} aria-label="Close add agent dialog" onClick={() => onOpenChange(false)}>×</button>
      </header>
      <div className={styles.body}>
        <div className={styles.fields}>
          <section aria-labelledby={`${titleId}-role`}><h3 id={`${titleId}-role`}><span>01</span> Meet your agent</h3>
            <label className={styles.field} htmlFor={nameId}>Agent name <input ref={nameInput} id={nameId} required maxLength={24} placeholder="e.g. Researcher" value={name} onChange={e => setName(e.target.value)} /></label>
            <label className={styles.field} htmlFor={taskId}>What should they do? <textarea id={taskId} required maxLength={2000} rows={3} placeholder="Find credible sources, gather key facts, and prepare a research brief for the script writer." value={task} onChange={e => setTask(e.target.value)} /></label>
            <p className={styles.hint}>Give your agent one clear responsibility. You can refine it later.</p>
          </section>
          <section aria-labelledby={`${titleId}-office`}><h3 id={`${titleId}-office`}><span>02</span> Make it their own</h3>
            <fieldset className={styles.palette}><legend>Building palette</legend><div>{buildingThemes.map(theme => <button key={theme} type="button" aria-label={`${theme} palette`} aria-pressed={appearance.theme === theme}
              style={{ backgroundColor: palette[theme] }} onClick={() => update({ theme })}>{appearance.theme === theme ? '✓' : ''}</button>)}</div></fieldset>
            <div className={styles.two}>
              <label className={styles.field}>Sign icon<select value={appearance.icon} onChange={e => update({ icon: e.target.value as AgentOffice['icon'] })}>{buildingIcons.map(icon => <option key={icon} value={icon}>{({ search: 'Research', doc: 'Document', wave: 'Voice', play: 'Video', image: 'Image', rocket: 'Rocket', sparkle: 'Sparkle' })[icon]}</option>)}</select></label>
              <label className={styles.field}>Interior<select value={appearance.interior} onChange={e => update({ interior: e.target.value as AgentOffice['interior'] })}>{Object.entries({ desk: 'Research desk', writer: 'Writing desk', voice: 'Voice booth', editing: 'Editing suite', gallery: 'Art gallery', publish: 'Publishing desk' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            </div>
            <div className={styles.two}>
              <label className={styles.field}>Floors<select value={appearance.floors} onChange={e => update({ floors: Number(e.target.value) as AgentOffice['floors'] })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} {n === 1 ? 'floor' : 'floors'}</option>)}</select></label>
              <label className={styles.field}>Windows<select value={appearance.glass} onChange={e => update({ glass: e.target.value as AgentOffice['glass'] })}><option value="full">Both sides</option><option value="front">Front only</option><option value="none">Solid walls</option></select></label>
            </div>
            <fieldset className={styles.roof}><legend>On the rooftop</legend><div>{roofItems.map(item => <label key={item}><input type="checkbox" checked={appearance.roof?.includes(item) ?? false}
              onChange={e => update({ roof: e.target.checked ? [...(appearance.roof || []), item] : appearance.roof?.filter(r => r !== item) })} />{({ tree: 'Tree', units: 'AC units', dish: 'Satellite', solar: 'Solar', garden: 'Garden' })[item]}</label>)}</div></fieldset>
            <label className={styles.landscape}><input type="checkbox" checked={appearance.trees !== false} onChange={e => update({ trees: e.target.checked })} /> Add trees and landscaping</label>
          </section>
        </div>
        <aside className={styles.preview} aria-label="Live agent office preview" data-night={previewNight || undefined}>
          <div className={styles.previewTop}><span className={styles.eyebrow}>LIVE PREVIEW</span><button type="button" aria-pressed={previewNight} onClick={() => setPreviewNight(n => !n)}>{previewNight ? '☀ Day' : '☾ Night'}</button></div>
          <div className={styles.model}><AgentBuilding building={preview} night={previewNight} /></div>
          <div className={styles.agentCard}><span className={styles.status}>Ready to join</span><h3>{name.trim() || 'Your next great teammate'}</h3><p>{task.trim() || 'A little space for your next big idea. Your agent’s responsibility will appear here.'}</p></div>
          <p className={styles.previewHint}>Your office updates as you customize.</p>
        </aside>
      </div>
      <footer className={styles.footer}><span>One agent. Their own place in your city.</span><div><button type="button" className={styles.cancel} onClick={() => onOpenChange(false)}>Cancel</button><button type="submit" className={styles.create} disabled={!name.trim() || !task.trim()}>Create agent <span aria-hidden="true">↗</span></button></div></footer>
    </form>
  </dialog>;
}
