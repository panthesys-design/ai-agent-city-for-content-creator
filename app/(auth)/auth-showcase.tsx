"use client";

import { useEffect, useState } from "react";
import { FileText, Megaphone, Moon, Mic, Search, Sun, Clapperboard, type LucideIcon } from "lucide-react";
import {
  BuildingGlyph,
  RoadNetwork,
  headquarters,
  project,
  type AgentOffice,
  type CityBuilding,
} from "@/components/agent-city";
import styles from "./auth.module.css";

type Mode = "sign-in" | "sign-up";

// A fixed, decorative scene. It is marketing art, not a workspace: nothing here is saved or dispatched.
const OFFICES: AgentOffice[] = [
  { id: "scout", name: "Trend Scout", type: "agent", x: 290, y: 0, theme: "sky", icon: "search", floors: 2, interior: "desk", roof: ["dish", "units"] },
  { id: "writer", name: "Script Writer", type: "agent", x: 0, y: 290, theme: "lavender", icon: "doc", floors: 3, interior: "writer", roof: ["tree", "solar"] },
  { id: "voice", name: "Voice Studio", type: "agent", x: 580, y: 290, theme: "peach", icon: "wave", floors: 1, interior: "voice", roof: ["units", "tree"] },
  { id: "editor", name: "Edit Bay", type: "agent", x: 290, y: 580, theme: "mint", icon: "play", floors: 2, interior: "editing", roof: ["garden"] },
  { id: "publisher", name: "Launch Pad", type: "agent", x: 580, y: 580, theme: "rose", icon: "rocket", floors: 1, interior: "publish", roof: ["solar", "tree"] },
];
const HQ: CityBuilding = { ...headquarters };
const BUILDINGS: CityBuilding[] = [HQ, ...OFFICES].sort((a, b) => a.x + a.y - b.x - b.y);
const BY_ID = new Map<string, CityBuilding>(BUILDINGS.map(b => [b.id, b]));

const LINKS = [
  { id: "hq-scout", from: HQ.id, to: "scout" },
  { id: "hq-writer", from: HQ.id, to: "writer" },
  { id: "hq-voice", from: HQ.id, to: "voice" },
  { id: "hq-editor", from: HQ.id, to: "editor" },
  { id: "editor-publisher", from: "editor", to: "publisher" },
];
const ROADS = LINKS.map(link => {
  const from = BY_ID.get(link.from)!, to = BY_ID.get(link.to)!;
  return { id: link.id, from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } };
});
// Every road in this scene is a straight line, so a packet path is just the two projected endpoints.
const PACKET_PATHS = ROADS.map(road => {
  const a = project(road.from.x, road.from.y), b = project(road.to.x, road.to.y);
  return { id: road.id, d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)}` };
});
const RISE_ORDER = [HQ.id, "scout", "writer", "voice", "editor", "publisher"];

const ACTIVITY: { agent: string; icon: LucideIcon; tone: string; text: string }[] = [
  { agent: "scout", icon: Search, tone: "#3b82f6", text: "Spotted 12 rising topics in tech" },
  { agent: "writer", icon: FileText, tone: "#7c5ce6", text: "Drafted a 60-second hook + script" },
  { agent: "voice", icon: Mic, tone: "#e8833a", text: "Recorded the voiceover, take 3" },
  { agent: "editor", icon: Clapperboard, tone: "#16a085", text: "Cut B-roll and burned in captions" },
  { agent: "publisher", icon: Megaphone, tone: "#e34d7a", text: "Scheduled the drop for 6:00 PM" },
];

const COPY = {
  "sign-in": {
    eyebrow: "Your city kept the lights on",
    title: "Your creative team never clocks out.",
    body: "Step back into HQ and pick up where your agents left off: research, scripts, voice, edits and publishing.",
  },
  "sign-up": {
    eyebrow: "Plot 001 is ready",
    title: "Break ground on your content city.",
    body: "Start with a headquarters, then hire AI agents for each step of your pipeline, each with an office of its own.",
  },
} as const;

export function AuthShowcase({ mode }: { mode: Mode }) {
  const [night, setNight] = useState(mode === "sign-in");
  const [tick, setTick] = useState(0);
  const copy = COPY[mode];

  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 3200);
    return () => window.clearInterval(timer);
  }, []);

  const feed = [0, 1, 2].map(offset => {
    const index = tick - offset;
    return { key: index, ...ACTIVITY[((index % ACTIVITY.length) + ACTIVITY.length) % ACTIVITY.length] };
  });
  const busy = feed[0].agent;

  return (
    <aside className={styles.showcase} data-night={night || undefined} data-mode={mode}>
      <div className={styles.skyDay} aria-hidden="true" />
      <div className={styles.skyNight} aria-hidden="true" />
      <div className={styles.orb} aria-hidden="true" />

      <div className={styles.showcaseTop}>
        <div className={styles.headline}>
          <span className={styles.eyebrow}><span className={styles.pulse} />{copy.eyebrow}</span>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
        <button
          type="button"
          className={styles.lightSwitch}
          onClick={() => setNight(n => !n)}
          aria-pressed={night}
          aria-label="Night lighting"
          title={night ? "Switch to day" : "Switch to night"}
        >
          <span className={styles.lightKnob}>{night ? <Moon size={14} /> : <Sun size={14} />}</span>
        </button>
      </div>

      <div className={styles.scene} aria-hidden="true">
        <svg viewBox="-440 -200 880 890" preserveAspectRatio="xMidYMid meet">
          <RoadNetwork roads={ROADS} night={night} />
          <g className={styles.packets}>
            {PACKET_PATHS.map((path, i) => (
              <g key={path.id}>
                <circle r="13" className={styles.packetGlow}>
                  <animateMotion dur={`${2.6 + (i % 3) * 0.5}s`} begin={`${i * 0.45}s`} repeatCount="indefinite" path={path.d} />
                </circle>
                <circle r="5" className={styles.packetCore}>
                  <animateMotion dur={`${2.6 + (i % 3) * 0.5}s`} begin={`${i * 0.45}s`} repeatCount="indefinite" path={path.d} />
                </circle>
              </g>
            ))}
          </g>
          {BUILDINGS.map(b => {
            const p = project(b.x, b.y);
            return (
              <g key={b.id} transform={`translate(${p.x} ${p.y})`}>
                <g className={styles.rise} style={{ animationDelay: `${RISE_ORDER.indexOf(b.id) * (mode === "sign-up" ? 220 : 90)}ms` }}>
                  <BuildingGlyph building={b} status={b.id === HQ.id ? undefined : b.id === busy ? "working" : "idle"} />
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      <div className={styles.feed} aria-hidden="true">
        <div className={styles.feedHeader}>
          <span>Live in your city</span>
          <span className={styles.feedLive}><span className={styles.pulse} />Preview</span>
        </div>
        <ul>
          {feed.map((item, i) => {
            const Icon = item.icon;
            return (
              <li key={item.key} className={i === 0 ? styles.feedNew : undefined} style={{ opacity: 1 - i * 0.28 }}>
                <span className={styles.feedIcon} style={{ color: item.tone, background: `${item.tone}1f` }}><Icon size={15} /></span>
                <span className={styles.feedText}>
                  <strong>{BY_ID.get(item.agent)?.name}</strong>
                  {item.text}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
