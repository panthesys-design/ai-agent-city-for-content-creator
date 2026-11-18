"use client";

import { useEffect, useState } from "react";
import {
  Clapperboard, FileText, Image as ImageIcon, Mic, Moon, Rocket, Search, Sparkles, Sun, type LucideIcon,
} from "lucide-react";
import {
  BuildingGlyph,
  CITY_PLOT,
  RoadNetwork,
  headquarters,
  project,
  starterAgents,
  streetWaypoints,
  type AgentOffice,
  type AgentStatus,
  type CityBuilding,
  type RoadPoint,
} from "@/components/agent-city";
import styles from "./landing.module.css";

// Decorative marketing scene: the real starter city layout, but nothing here is saved or dispatched.
const IDS = ["research", "script", "voice", "media", "editor", "publish"] as const;
const HQ: CityBuilding = { ...headquarters };
const OFFICES: AgentOffice[] = starterAgents.map((agent, i) => ({
  ...agent.appearance,
  roof: [...agent.appearance.roof],
  id: IDS[i],
  name: agent.name,
  type: "agent",
  x: HQ.x + agent.plot.col * CITY_PLOT,
  y: HQ.y + agent.plot.row * CITY_PLOT,
}));
const BUILDINGS: CityBuilding[] = [HQ, ...OFFICES].sort((a, b) => a.x + a.y - b.x - b.y);
const NAMES = new Map<string, string>([[HQ.id, "Headquarters"], ...OFFICES.map(o => [o.id, o.name] as [string, string])]);

const ROADS = OFFICES.map(office => {
  const from = { x: HQ.x, y: HQ.y }, to = { x: office.x, y: office.y };
  return { id: `hq-${office.id}`, from, to, waypoints: streetWaypoints(from, to) };
});
const toPath = (points: RoadPoint[]) => points
  .map((point, i) => { const p = project(point.x, point.y); return `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`; })
  .join(" ");
const PACKET_PATHS = ROADS.map(road => ({ id: road.id, d: toPath([road.from, ...road.waypoints, road.to]) }));

// Ground plate under every plot, drawn as a projected diamond.
const PAD = 150;
const xs = OFFICES.map(o => o.x).concat(HQ.x), ys = OFFICES.map(o => o.y).concat(HQ.y);
const [minX, maxX, minY, maxY] = [Math.min(...xs) - PAD, Math.max(...xs) + PAD, Math.min(...ys) - PAD, Math.max(...ys) + PAD];
const GROUND = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]
  .map(([x, y]) => { const p = project(x, y); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; })
  .join(" ");

const STEPS: { id: string; icon: LucideIcon; tone: string; text: string }[] = [
  { id: HQ.id, icon: Sparkles, tone: "#c08a1e", text: "Planned 6 steps for “AI gadgets under $50”" },
  { id: "research", icon: Search, tone: "#3b7bf0", text: "Found 12 rising topics and 8 sources" },
  { id: "script", icon: FileText, tone: "#7c4dea", text: "Drafted a 60-second hook and script" },
  { id: "voice", icon: Mic, tone: "#12a38a", text: "Recorded the voiceover, take 3" },
  { id: "media", icon: ImageIcon, tone: "#f0703a", text: "Generated a thumbnail and B-roll" },
  { id: "editor", icon: Clapperboard, tone: "#e04f8f", text: "Cut the video and burned in captions" },
  { id: "publish", icon: Rocket, tone: "#2d3340", text: "Scheduled the drop for 6:00 PM" },
];

function statusFor(id: string, step: number): AgentStatus | undefined {
  if (id === HQ.id) return undefined;
  const index = IDS.indexOf(id as (typeof IDS)[number]) + 1;
  return index === step ? "working" : index < step ? "completed" : "idle";
}

export function HeroCity() {
  const [night, setNight] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 2600);
    return () => window.clearInterval(timer);
  }, []);

  const step = tick % STEPS.length;
  const feed = [0, 1, 2].map(offset => {
    const index = tick - offset;
    return { key: index, ...STEPS[((index % STEPS.length) + STEPS.length) % STEPS.length] };
  }).filter(item => item.key >= 0);

  return (
    <div className={styles.heroVisual} data-night={night || undefined}>
      <div className={styles.skyDay} aria-hidden="true" />
      <div className={styles.skyNight} aria-hidden="true" />
      <div className={styles.orb} aria-hidden="true" />

      <div className={styles.visualTop}>
        <div className={styles.requestChip} aria-hidden="true">
          <span className={styles.requestAvatar}>You</span>
          <span><strong>To HQ:</strong> Make a 60-second video on budget AI gadgets</span>
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
        <svg viewBox="-760 -250 1520 1010" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="landing-ground" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--ground-top)" />
              <stop offset="1" stopColor="var(--ground-bottom)" />
            </linearGradient>
          </defs>
          <polygon points={GROUND} className={styles.groundEdge} transform="translate(0 22)" />
          <polygon points={GROUND} fill="url(#landing-ground)" className={styles.ground} />
          <RoadNetwork roads={ROADS} night={night} />
          <g className={styles.packets}>
            {PACKET_PATHS.map((path, i) => (
              <g key={path.id}>
                <circle r="13" className={styles.packetGlow}>
                  <animateMotion dur={`${3 + (i % 3) * 0.6}s`} begin={`${i * 0.4}s`} repeatCount="indefinite" path={path.d} />
                </circle>
                <circle r="5" className={styles.packetCore}>
                  <animateMotion dur={`${3 + (i % 3) * 0.6}s`} begin={`${i * 0.4}s`} repeatCount="indefinite" path={path.d} />
                </circle>
              </g>
            ))}
          </g>
          {BUILDINGS.map(b => {
            const p = project(b.x, b.y);
            const order = b.id === HQ.id ? 0 : IDS.indexOf(b.id as (typeof IDS)[number]) + 1;
            return (
              <g key={b.id} transform={`translate(${p.x} ${p.y})`}>
                <g className={styles.rise} style={{ animationDelay: `${order * 140}ms` }}>
                  <BuildingGlyph building={b} status={statusFor(b.id, step)} />
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
              <li key={item.key} className={i === 0 ? styles.feedNew : undefined} style={{ opacity: 1 - i * 0.3 }}>
                <span className={styles.feedIcon} style={{ color: item.tone, background: `${item.tone}1f` }}><Icon size={15} /></span>
                <span className={styles.feedText}><strong>{NAMES.get(item.id)}</strong>{item.text}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
