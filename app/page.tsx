import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, Brain, CalendarDays, Check, FolderOpen, MessageSquareText, MonitorPlay, Plug, ShieldCheck, Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  AgentBuilding,
  HeadquartersBuilding,
  headquartersPresets,
  signLabel,
  starterAgents,
  themeAccent,
  type AgentOffice,
} from "@/components/agent-city";
import { BrandMark } from "@/components/brand-mark";
import { getCurrentUser } from "@/lib/auth/session";
import { HeroCity } from "./_landing/hero-city";
import styles from "./_landing/landing.module.css";

export const metadata: Metadata = {
  title: "Creator City — Your AI content team, as a city",
  description:
    "Hire AI agents for research, scripts, voice, media, editing and publishing. Give headquarters one request and watch your city ship it.",
};

/** The landing page works without auth configured; a valid session only swaps the call to action. */
async function isSignedIn() {
  try {
    return Boolean(await getCurrentUser());
  } catch {
    return false;
  }
}

const STEPS = [
  {
    icon: MessageSquareText,
    title: "Tell headquarters what you need",
    body: "One message: a topic, a format, a deadline. Attach references if you have them.",
  },
  {
    icon: Workflow,
    title: "HQ plans and hands off the work",
    body: "Headquarters breaks the request into steps and routes each one to the right agent, in order.",
  },
  {
    icon: CalendarDays,
    title: "Review, schedule, publish",
    body: "Drafts land in your library and calendar. Nothing goes live until you publish or schedule it.",
  },
];

const FEATURES: { icon: LucideIcon; title: string; body: string; wide?: boolean }[] = [
  {
    icon: MonitorPlay,
    title: "A cloud computer for every city",
    body: "Agents browse, download and edit on their own machine. Watch live, and step in when a site needs you to sign in.",
    wide: true,
  },
  {
    icon: Plug,
    title: "Connected accounts",
    body: "Link YouTube, Instagram, X and more. Choose which agents can use each one.",
  },
  {
    icon: ShieldCheck,
    title: "You approve every post",
    body: "Read-only and approval settings are checked on the server on every call.",
  },
  {
    icon: FolderOpen,
    title: "Artifacts library",
    body: "Scripts, voiceovers, images and cuts saved in one place, ready to attach to the next chat.",
  },
  {
    icon: Brain,
    title: "Shared memory",
    body: "Your tone, audience and past work carry over, so every new task starts informed.",
  },
  {
    icon: CalendarDays,
    title: "Content calendar",
    body: "Drag drafts onto the month, see what is scheduled, and keep a steady posting rhythm.",
    wide: true,
  },
];

const HQ_STYLES = [
  { key: "empire", label: "Empire", body: "Gold art-deco tower with a spire." },
  { key: "crown", label: "Crown", body: "Sky-blue glass with a crowned top." },
  { key: "twin", label: "Twin", body: "Two lavender towers, one skybridge." },
] as const;

export default async function Home() {
  const signedIn = await isSignedIn();
  const primary = signedIn
    ? { href: "/dashboard", label: "Open your city" }
    : { href: "/sign-up", label: "Build your city" };

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <Link href="/" className={styles.brand}>
            <BrandMark />
            <span>Creator City</span>
          </Link>
          <nav className={styles.navLinks} aria-label="Sections">
            <a href="#how-it-works">How it works</a>
            <a href="#agents">Agents</a>
            <a href="#features">Features</a>
          </nav>
          <div className={styles.navActions}>
            {!signedIn && <Link href="/sign-in" className={styles.navSignIn}>Sign in</Link>}
            <Link href={primary.href} className={styles.navCta}>{signedIn ? "Dashboard" : "Get started"}</Link>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}><span className={styles.pulse} />AI agents for creators</span>
            <h1 className={styles.heroTitle}>
              Your content team, <span className={styles.gradientText}>built as a city.</span>
            </h1>
            <p className={styles.heroLead}>
              Hire AI agents for research, scripts, voice, media, editing and publishing. Each one gets an office.
              Send headquarters one request and watch the work move through your city.
            </p>
            <div className={styles.heroActions}>
              <Link href={primary.href} className={styles.primaryButton}>
                {primary.label}<ArrowRight size={17} aria-hidden="true" />
              </Link>
              <a href="#how-it-works" className={styles.secondaryButton}>See how it works</a>
            </div>
            <ul className={styles.heroPoints}>
              <li><Check size={15} aria-hidden="true" />Six starter agents included</li>
              <li><Check size={15} aria-hidden="true" />You approve every post</li>
            </ul>
          </div>
          <HeroCity />
        </section>

        <section id="how-it-works" className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.eyebrow}>How it works</span>
            <h2>One request in. Finished content out.</h2>
            <p>Headquarters is the orchestrator. It plans, assigns and tracks each step, so you only talk to one place.</p>
          </div>
          <ol className={styles.steps}>
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className={styles.step}>
                <span className={styles.stepNumber}>0{i + 1}</span>
                <span className={styles.stepIcon}><Icon size={20} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="agents" className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.eyebrow}>The starter crew</span>
            <h2>Six specialists, ready on day one.</h2>
            <p>Every city opens with a full video pipeline. Rename them, rewrite their instructions, or hire more.</p>
          </div>
          <ul className={styles.agentGrid}>
            {starterAgents.map((agent, i) => {
              const office: AgentOffice = {
                ...agent.appearance,
                roof: [...agent.appearance.roof],
                id: `landing-agent-${i}`,
                name: agent.name,
                type: "agent",
                x: 0,
                y: 0,
              };
              const accent = themeAccent[agent.appearance.theme];
              return (
                <li key={agent.name} className={styles.agentCard} style={{ "--agent-accent": accent } as React.CSSProperties}>
                  <div className={styles.agentPreview} aria-hidden="true">
                    <AgentBuilding building={office} className={styles.agentBuilding} />
                  </div>
                  <div className={styles.agentBody}>
                    <span className={styles.agentStep}>Step {i + 1}</span>
                    <h3>{signLabel(agent.name)}</h3>
                    <p>{agent.task}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section id="features" className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.eyebrow}>Under the hood</span>
            <h2>Real tools, not just chat.</h2>
            <p>Your agents work with a computer, your accounts and your library, and they check with you before anything goes live.</p>
          </div>
          <ul className={styles.bento}>
            {FEATURES.map(({ icon: Icon, title, body, wide }) => (
              <li key={title} className={wide ? `${styles.feature} ${styles.featureWide}` : styles.feature}>
                <span className={styles.featureIcon}><Icon size={20} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className={styles.eyebrow}>Headquarters</span>
            <h2>Pick a skyline to call home.</h2>
            <p>Your headquarters anchors the city. Choose a style when you start, and drag it anywhere later.</p>
          </div>
          <ul className={styles.hqGrid}>
            {HQ_STYLES.map(style => (
              <li key={style.key} className={styles.hqCard}>
                <div className={styles.hqPreview} aria-hidden="true">
                  <HeadquartersBuilding
                    building={{ ...headquartersPresets[style.key], id: `landing-hq-${style.key}` }}
                    className={styles.hqBuilding}
                  />
                </div>
                <h3>{style.label}</h3>
                <p>{style.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.ctaWrap}>
          <div className={styles.cta}>
            <div className={styles.ctaStars} aria-hidden="true" />
            <h2>Plot 001 is ready.</h2>
            <p>Break ground on your headquarters and have your first video in the pipeline today.</p>
            <Link href={primary.href} className={styles.ctaButton}>
              {primary.label}<ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link href="/" className={styles.brand}>
          <BrandMark size={24} />
          <span>Creator City</span>
        </Link>
        <p>Your agents, your city. Built for creators who ship every day.</p>
      </footer>
    </div>
  );
}
