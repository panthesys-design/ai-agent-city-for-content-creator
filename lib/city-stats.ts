// Client-safe shapes for the City page's overview cards: what agents produced (artifacts), what they published or
// scheduled on connected accounts (social-posts), and the audience of those accounts (followers, views), read from
// each platform through Composio. Server code: lib/stats.ts and lib/composio/audience.ts.

/** Audience numbers of one connected account, as last read from its platform. Null means the platform doesn't say. */
export type AccountStats = {
  followers: number | null;
  views: number | null;
  /** Posts or videos on the account, as the platform counts them. */
  posts: number | null;
  /** The account's handle or channel name, when the platform returned one. */
  handle: string | null;
  /** Why the last read failed (missing permission, expired sign-in); the numbers then are the last good ones. */
  error: string | null;
};

export type AudienceEntry = AccountStats & {
  connectionId: string;
  toolkit: string;
  name: string;
  label: string | null;
  updatedAt: string | null;
};

export type CityStats = {
  content: { total: number; documents: number; images: number; audio: number; video: number };
  posts: { published: number; publishedThisWeek: number; failed: number; scheduled: number; nextAt: string | null; drafts: number };
  /** One entry per active account on a platform that reports audience numbers. */
  audience: AudienceEntry[];
  /** Active accounts on platforms without audience numbers here (LinkedIn profiles, Notion…). */
  otherAccounts: number;
};

export const EMPTY_CITY_STATS: CityStats = {
  content: { total: 0, documents: 0, images: 0, audio: 0, video: 0 },
  posts: { published: 0, publishedThisWeek: 0, failed: 0, scheduled: 0, nextAt: null, drafts: 0 },
  audience: [],
  otherAccounts: 0,
};

/** Sums of the audience entries; null when no account reports that number. */
export function audienceTotals(entries: AudienceEntry[]): { followers: number | null; views: number | null } {
  const sum = (key: "followers" | "views") => {
    const values = entries.map((e) => e[key]).filter((v): v is number => typeof v === "number");
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return { followers: sum("followers"), views: sum("views") };
}

// ---------- Reading platform responses ----------

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
};

/**
 * Adds up every numeric value found under one of `keys` anywhere in a tool result (the first key that occurs wins).
 * A Facebook result lists several Pages, so their followers add up; other platforms return one account.
 */
export function sumKey(data: unknown, keys: readonly string[]): number | null {
  for (const key of keys) {
    let total: number | null = null;
    const visit = (value: unknown, depth: number) => {
      if (depth > 6 || !value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach((v) => visit(v, depth + 1)); return; }
      const record = value as Record<string, unknown>;
      const n = key in record ? toNumber(record[key]) : null;
      if (n !== null) { total = (total ?? 0) + n; return; }
      Object.values(record).forEach((v) => visit(v, depth + 1));
    };
    visit(data, 0);
    if (total !== null) return total;
  }
  return null;
}

/** The first string found under one of `keys`. */
export function findString(data: unknown, keys: readonly string[], depth = 0): string | null {
  if (depth > 6 || !data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const item of data) { const found = findString(item, keys, depth + 1); if (found) return found; }
    return null;
  }
  const record = data as Record<string, unknown>;
  for (const key of keys) if (typeof record[key] === "string" && record[key]) return (record[key] as string).slice(0, 80);
  for (const value of Object.values(record)) { const found = findString(value, keys, depth + 1); if (found) return found; }
  return null;
}

// ---------- Formatting ----------

const compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fullFormat = new Intl.NumberFormat("en");
/** 12.4K, 1.2M; small numbers in full. */
export const compactNumber = (n: number) => (n < 10_000 ? fullFormat.format(n) : compactFormat.format(n));
export const fullNumber = (n: number) => fullFormat.format(n);
