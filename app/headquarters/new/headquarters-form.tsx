"use client";

import { useActionState, useDeferredValue, useId, useMemo, useState } from "react";
import {
  ArrowRight, AudioLines, Check, CircleAlert, FileText, Image as ImageIcon, Loader2, Moon, Play, Rocket, Search, Sparkles, Sun,
  type LucideIcon,
} from "lucide-react";
import {
  buildingIcons, headquarters, headquartersStyles, headquartersThemes, headquartersTints, HeadquartersBuilding,
  type HeadquartersSpec,
} from "@/components/agent-city";
import type { HeadquartersInput } from "@/lib/headquarters";
import { createHeadquartersAction, type HeadquartersFormState } from "./actions";
import styles from "./headquarters.module.css";

export type Appearance = Omit<HeadquartersInput, "name">;
type Style = Appearance["style"];

const DESIGNS: Record<Style, { label: string; description: string }> = {
  empire: { label: "Empire", description: "Stepped art-deco tiers rising to a classic needle." },
  crown: { label: "Crown", description: "A sleek glass shaft topped with a glowing crown." },
  twin: { label: "Twin", description: "Two towers joined by a sky bridge." },
};
// Swatches mirror the renderer's palette accents and glass gradients.
const THEMES: Record<Appearance["theme"], { label: string; color: string }> = {
  lavender: { label: "Lavender", color: "#7c4dea" },
  mint: { label: "Mint", color: "#12a38a" },
  peach: { label: "Peach", color: "#f0703a" },
  sky: { label: "Sky", color: "#3b7bf0" },
  rose: { label: "Rose", color: "#e04f8f" },
  white: { label: "White", color: "#d9dce1" },
  gold: { label: "Gold", color: "#c08a1e" },
};
const TINTS: Record<Appearance["tint"], { label: string; gradient: string }> = {
  blue: { label: "Blue", gradient: "linear-gradient(135deg, #7aa2d6, #dbe8f8)" },
  teal: { label: "Teal", gradient: "linear-gradient(135deg, #68bab4, #d6f1ef)" },
  warm: { label: "Warm", gradient: "linear-gradient(135deg, #e0b27a, #fbecd6)" },
  clear: { label: "Clear", gradient: "linear-gradient(135deg, #aab3bc, #e3e7eb)" },
};
const ICONS: Record<Appearance["icon"], { label: string; Icon: LucideIcon }> = {
  sparkle: { label: "Sparkle", Icon: Sparkles },
  rocket: { label: "Rocket", Icon: Rocket },
  play: { label: "Video", Icon: Play },
  wave: { label: "Voice", Icon: AudioLines },
  image: { label: "Image", Icon: ImageIcon },
  doc: { label: "Writing", Icon: FileText },
  search: { label: "Research", Icon: Search },
};
const HEIGHTS = [1, 2, 3, 4, 5] as const;

const DEFAULT_APPEARANCE: Appearance = {
  style: headquarters.style ?? "empire",
  theme: headquarters.theme ?? "gold",
  height: headquarters.height ?? 2,
  tint: headquarters.tint ?? "warm",
  icon: headquarters.icon ?? "sparkle",
  spire: headquarters.spire ?? true,
  trees: headquarters.trees ?? true,
};

type FormProps = {
  /** The name field's starting value: a suggestion when creating, the saved name when editing. */
  suggestedName: string;
  nameMax: number;
} & (
  | { mode?: "create" }
  /** Settings page: edit a saved headquarters with `action` (it parses with `parseHeadquartersForm` too). */
  | { mode: "edit"; initial: Appearance; action: (state: HeadquartersFormState, formData: FormData) => Promise<HeadquartersFormState> }
);

/**
 * The headquarters designer: name, design, colors, icon, and finishing touches with a live preview. Onboarding uses
 * it to create the headquarters (and records the browser's time zone); the Settings page reuses it with `mode="edit"`.
 */
export function HeadquartersForm(props: FormProps) {
  const { suggestedName, nameMax } = props;
  const editing = props.mode === "edit";
  const [state, formAction, pending] = useActionState<HeadquartersFormState, FormData>(editing ? props.action : createHeadquartersAction, {});
  const [name, setName] = useState(suggestedName);
  const [appearance, setAppearance] = useState<Appearance>(editing ? props.initial : DEFAULT_APPEARANCE);
  const [night, setNight] = useState(false);
  const ids = useId();
  const update = (patch: Partial<Appearance>) => setAppearance(current => ({ ...current, ...patch }));

  // Typing shouldn't block on four SVG redraws; the sign label catches up a moment later.
  const signName = useDeferredValue(name.trim() || "Your HQ");
  const preview = useMemo<HeadquartersSpec>(
    () => ({ ...headquarters, ...appearance, id: "hq-preview", name: signName }),
    [appearance, signName],
  );
  const designOptions = useMemo(
    () => headquartersStyles.map(style => ({ ...preview, id: `hq-design-${style}`, style })),
    [preview],
  );
  const canSubmit = name.trim().length > 0 && !pending;

  return (
    <form action={formAction} className={styles.layout} data-embedded={editing || undefined}>
      <div className={styles.fields}>
        {!editing && (
          <div className={styles.intro}>
            <span className={styles.kicker}>Welcome to Creator City</span>
            <h1 className={styles.title}>Raise your <span className={styles.titleAccent}>headquarters</span></h1>
            <p className={styles.subtitle}>
              Every city starts with one tower. Design the home base where your AI agents will gather, plan, and ship.
            </p>
          </div>
        )}
        {/* New workspaces start in the browser's time zone; Settings changes it later. Set by ref, so SSR stays stable. */}
        {!editing && (
          <input type="hidden" name="timeZone" ref={el => { if (el) el.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; }} />
        )}

        <section className={styles.section} aria-labelledby={`${ids}-name-heading`}>
          <h2 id={`${ids}-name-heading`} className={styles.sectionTitle}><span>01</span> Name it</h2>
          <div className={styles.field}>
            <label htmlFor={`${ids}-name`}>Headquarters name</label>
            <input id={`${ids}-name`} name="name" type="text" required maxLength={nameMax} autoComplete="off"
              value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Creator HQ"
              aria-describedby={`${ids}-name-hint`} className={styles.input} />
            <p id={`${ids}-name-hint`} className={styles.hint}>
              Shown on your building&apos;s sign (first 16 characters). {name.length}/{nameMax}
            </p>
          </div>
        </section>

        <fieldset className={styles.section}>
          <legend className={styles.sectionTitle}><span>02</span> Choose a design</legend>
          <div className={styles.designGrid}>
            {designOptions.map(spec => {
              const style = spec.style as Style;
              return (
                <label key={style} className={styles.designCard}>
                  <input type="radio" name="style" value={style} checked={appearance.style === style}
                    onChange={() => update({ style })} className={styles.srOnly} />
                  <span className={styles.designModel} aria-hidden="true">
                    <HeadquartersBuilding building={spec} night={night} />
                  </span>
                  <span className={styles.designText}>
                    <strong>{DESIGNS[style].label}</strong>
                    <span>{DESIGNS[style].description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className={styles.section}>
          <legend className={styles.sectionTitle}><span>03</span> Pick your colors</legend>
          <p className={styles.groupLabel} id={`${ids}-theme`}>Building color</p>
          <div className={styles.swatches} role="radiogroup" aria-labelledby={`${ids}-theme`}>
            {headquartersThemes.map(theme => (
              <label key={theme} className={styles.swatch} title={THEMES[theme].label}>
                <input type="radio" name="theme" value={theme} checked={appearance.theme === theme}
                  onChange={() => update({ theme })} className={styles.srOnly} />
                <span className={styles.swatchDot} style={{ background: THEMES[theme].color }} aria-hidden="true" />
                <span className={styles.swatchLabel}>{THEMES[theme].label}</span>
              </label>
            ))}
          </div>
          <p className={styles.groupLabel} id={`${ids}-tint`}>Glass tint</p>
          <div className={styles.chips} role="radiogroup" aria-labelledby={`${ids}-tint`}>
            {headquartersTints.map(tint => (
              <label key={tint} className={styles.chip}>
                <input type="radio" name="tint" value={tint} checked={appearance.tint === tint}
                  onChange={() => update({ tint })} className={styles.srOnly} />
                <span className={styles.tintDot} style={{ background: TINTS[tint].gradient }} aria-hidden="true" />
                {TINTS[tint].label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.section}>
          <legend className={styles.sectionTitle}><span>04</span> Choose an icon</legend>
          <div className={styles.iconGrid}>
            {buildingIcons.map(icon => {
              const { label, Icon } = ICONS[icon];
              return (
                <label key={icon} className={styles.iconOption}>
                  <input type="radio" name="icon" value={icon} checked={appearance.icon === icon}
                    onChange={() => update({ icon })} className={styles.srOnly} />
                  <Icon size={20} aria-hidden="true" />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className={styles.section}>
          <legend className={styles.sectionTitle}><span>05</span> Finishing touches</legend>
          <p className={styles.groupLabel} id={`${ids}-height`}>Tower height</p>
          <div className={styles.segmented} role="radiogroup" aria-labelledby={`${ids}-height`}>
            {HEIGHTS.map(height => (
              <label key={height}>
                <input type="radio" name="height" value={height} checked={appearance.height === height}
                  onChange={() => update({ height })} className={styles.srOnly} />
                <span>{height}</span>
              </label>
            ))}
          </div>
          <div className={styles.toggles}>
            <label className={styles.toggle}>
              <input type="checkbox" name="spire" checked={appearance.spire} onChange={e => update({ spire: e.target.checked })} />
              <span className={styles.toggleTrack} aria-hidden="true" />
              <span><strong>Spire</strong><small>A needle on top of the tower</small></span>
            </label>
            <label className={styles.toggle}>
              <input type="checkbox" name="trees" checked={appearance.trees} onChange={e => update({ trees: e.target.checked })} />
              <span className={styles.toggleTrack} aria-hidden="true" />
              <span><strong>Landscaping</strong><small>Trees and hedges around the plaza</small></span>
            </label>
          </div>
        </fieldset>
      </div>

      <aside className={styles.preview} data-night={night || undefined} aria-label="Live headquarters preview">
        <div className={styles.sky} aria-hidden="true" />
        <div className={styles.previewTop}>
          <span className={styles.previewBadge}><span className={styles.pulse} aria-hidden="true" />Live preview</span>
          <button type="button" className={styles.nightToggle} aria-pressed={night} onClick={() => setNight(n => !n)}>
            {night ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            {night ? "Day" : "Night"}
          </button>
        </div>
        <div className={styles.previewModel}>
          <HeadquartersBuilding building={preview} night={night} />
        </div>
        <div className={styles.previewCard}>
          <p className={styles.previewName}>{name.trim() || "Your headquarters"}</p>
          <p className={styles.previewMeta}>
            {DESIGNS[appearance.style].label} · {THEMES[appearance.theme].label} · Height {appearance.height}
          </p>

          {state.error && (
            <p role="alert" className={styles.error}>
              <CircleAlert size={17} aria-hidden="true" />
              {state.error}
            </p>
          )}
          {editing && state.savedAt && !pending && (
            <p role="status" className={styles.saved} key={state.savedAt}>
              <Check size={17} aria-hidden="true" />
              Headquarters saved.
            </p>
          )}

          <button type="submit" className={styles.submit} disabled={!canSubmit}>
            {pending ? (
              <><Loader2 className={styles.spin} size={18} aria-hidden="true" />{editing ? "Saving…" : "Raising your tower…"}</>
            ) : editing ? (
              <>Save headquarters</>
            ) : (
              <>Create Headquarters<ArrowRight className={styles.submitArrow} size={18} aria-hidden="true" /></>
            )}
          </button>
        </div>
      </aside>
    </form>
  );
}
