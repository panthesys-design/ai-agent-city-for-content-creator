"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, FileText, Loader2, RefreshCw, Send, UsersRound, type LucideIcon } from "lucide-react";
import { audienceTotals, compactNumber, fullNumber, type AudienceEntry, type CityStats } from "@/lib/city-stats";
import { refreshCityStatsAction } from "./stats-actions";
import styles from "./city-view.module.css";

// The City page's overview cards: content agents created, posts published and scheduled on connected accounts, and
// the followers/subscribers of those accounts. Shows the server's numbers at once, then asks for
// fresh ones (platform numbers are cached for 30 minutes on the server), every few minutes, and when the tab returns.

const REFRESH_MS = 5 * 60 * 1000;
const when = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ago = (iso: string | null) => {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
};
const plural = (n: number, word: string) => `${fullNumber(n)} ${word}${n === 1 ? "" : "s"}`;

type Card = {
  key: string; label: string; icon: LucideIcon; href: string;
  value: number | null; detail: string; title?: string; warning?: string | null;
};

const accountName = (e: AudienceEntry) => (e.label ? `${e.name} ${e.label}` : e.name);

function cardsFor(stats: CityStats): Card[] {
  const { content, posts, audience, otherAccounts } = stats;
  const totals = audienceTotals(audience);
  const failing = audience.filter((e) => e.error);
  const warning = failing.length ? `Couldn't update ${failing.map((e) => e.name).join(", ")}: ${failing[0].error}` : null;
  const updated = audience.map((e) => e.updatedAt).filter(Boolean).sort().at(-1) ?? null;
  const byPlatform = (key: "followers") =>
    audience.filter((e) => e[key] !== null).map((e) => `${e.name} ${compactNumber(e[key]!)}`).join(" · ");
  const fullList = (key: "followers") =>
    audience.filter((e) => e[key] !== null).map((e) => `${accountName(e)}: ${fullNumber(e[key]!)}${e.posts !== null ? ` (${plural(e.posts, "post")})` : ""}`).join("\n");

  const contentParts = [
    content.documents && plural(content.documents, "doc"), content.images && plural(content.images, "image"),
    content.audio && `${fullNumber(content.audio)} audio`, content.video && plural(content.video, "video"),
  ].filter(Boolean) as string[];

  const noAccounts = !audience.length;
  const followersDetail = noAccounts
    ? otherAccounts ? "No follower numbers from these apps" : "Connect an account to see followers"
    : byPlatform("followers") || "Not reported yet";

  return [
    {
      key: "content", label: "Content Created", icon: FileText, href: "/dashboard/artifacts", value: content.total,
      detail: contentParts.length ? contentParts.join(" · ") : "Scripts, images, and audio agents make",
    },
    {
      key: "published", label: "Posts Published", icon: Send, href: "/dashboard/posted", value: posts.published,
      detail: posts.published ? [`${fullNumber(posts.publishedThisWeek)} this week`, posts.failed ? `${fullNumber(posts.failed)} failed` : ""].filter(Boolean).join(" · ") : posts.failed ? `${fullNumber(posts.failed)} failed` : "Nothing posted yet",
    },
    {
      key: "scheduled", label: "Scheduled Posts", icon: CalendarClock, href: "/dashboard/posted", value: posts.scheduled,
      detail: [posts.nextAt ? `Next: ${when.format(new Date(posts.nextAt))}` : "Nothing scheduled", posts.drafts ? plural(posts.drafts, "draft") : ""].filter(Boolean).join(" · "),
    },
    {
      key: "followers", label: "Followers & Subscribers", icon: UsersRound, href: "/dashboard/accounts", value: totals.followers,
      detail: followersDetail, warning,
      title: [fullList("followers"), updated ? `Updated ${ago(updated)}` : ""].filter(Boolean).join("\n") || undefined,
    },
  ];
}

export function CityStatsCards({ initialStats }: { initialStats: CityStats | null }) {
  const [stats, setStats] = useState<CityStats | null>(initialStats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async (force = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const result = await refreshCityStatsAction({ force }).catch(() => null);
    inFlight.current = false;
    setLoading(false);
    if (result?.ok) { setStats(result.stats); setError(null); }
    else setError(result?.error ?? "We couldn't refresh the numbers.");
  }, []);

  useEffect(() => {
    // Defer the first refresh so the page paints first; stale platform numbers can take a few seconds.
    const first = setTimeout(() => void refresh(), 300);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  const cards = stats ? cardsFor(stats) : null;
  return (
    <section aria-label="Overview" className={styles.statsWrap}>
      <div className={styles.stats} aria-busy={loading}>
        {(cards ?? PLACEHOLDERS).map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.key} href={card.href} className={styles.statCard} title={card.title}>
              <span className={styles.statIcon}><Icon size={16} aria-hidden="true" /></span>
              <span className={styles.statText}>
                <span className={styles.statLabel}>{card.label}</span>
                <span className={styles.statValue}>
                  {card.value === null ? "—" : <span title={fullNumber(card.value)}>{compactNumber(card.value)}</span>}
                  {card.warning && <span className={styles.statWarning} role="img" aria-label={card.warning} title={card.warning}><AlertTriangle size={13} aria-hidden="true" /></span>}
                </span>
                <span className={styles.statDetail}>{card.detail}</span>
              </span>
            </Link>
          );
        })}
      </div>
      <div className={styles.statsFoot}>
        {error && <span role="alert" className={styles.statsError}>{error}</span>}
        <button type="button" className={styles.statsRefresh} onClick={() => refresh(true)} disabled={loading} aria-label="Refresh numbers from your connected accounts">
          {loading ? <Loader2 size={12} className={styles.spin} aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />}
          {loading ? "Updating…" : "Refresh"}
        </button>
      </div>
    </section>
  );
}

const PLACEHOLDERS: Card[] = [
  { key: "content", label: "Content Created", icon: FileText, href: "/dashboard/artifacts", value: null, detail: "Loading…" },
  { key: "published", label: "Posts Published", icon: Send, href: "/dashboard/posted", value: null, detail: "Loading…" },
  { key: "scheduled", label: "Scheduled Posts", icon: CalendarClock, href: "/dashboard/posted", value: null, detail: "Loading…" },
  { key: "followers", label: "Followers & Subscribers", icon: UsersRound, href: "/dashboard/accounts", value: null, detail: "Loading…" },
];
