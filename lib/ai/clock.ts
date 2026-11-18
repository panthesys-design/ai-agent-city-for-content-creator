// The current date for agents. Models only know the world up to their training data and otherwise assume it is
// still that time, so "today's trending topics" became searches for months-old dates. Every agent and
// headquarters gets this note at the top of its instructions, built fresh for each run.
// "Today" is in the headquarters' own time zone (`timeZone` on its record, chosen on the Settings page).

/** Time zone for "today": the headquarters' saved IANA name (such as "Asia/Kolkata"), else the server's own. */
export function resolveTimeZone(configured?: string | null): string {
  if (configured) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: configured });
      return configured;
    } catch { /* invalid name: fall back */ }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** The date as YYYY-MM-DD in the time zone. */
export function isoDate(now: Date, timeZone = resolveTimeZone()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "Monday, 16 November 2026, 10:42 PM (Asia/Kolkata), ISO date 2026-11-16". */
export function describeNow(now = new Date(), timeZone = resolveTimeZone()): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(now);
  return `${day}, ${time} (${timeZone}), ISO date ${isoDate(now, timeZone)}`;
}

/** The instruction block every agent starts with. */
export function dateRules(now = new Date(), timeZone = resolveTimeZone()): string {
  const year = isoDate(now, timeZone).slice(0, 4);
  return [
    `Current date and time: ${describeNow(now, timeZone)}. This is the real date; your training data is older, so never assume an earlier month or year.`,
    `"Today", "now", "latest", "this week", "trending", and "current" mean relative to this date (${year}). For anything time-sensitive, use live sources (web search, the cloud browser) rather than what you remember, and prefer results dated close to today.`,
    "In search queries, don't add a month or year you guessed. Write the query without a date and use the search tool's recency filter (browser_search recency \"day\" or \"week\"), or use exactly the date above. If results are clearly old, say so instead of presenting them as current.",
  ].join("\n");
}

/** Years before the current one named in a query (e.g. "March 2025"), so the tool can flag a stale guess. */
export function staleYearsIn(text: string, now = new Date(), timeZone = resolveTimeZone()): number[] {
  const current = Number(isoDate(now, timeZone).slice(0, 4));
  return [...new Set((text.match(/\b(19|20)\d{2}\b/g) ?? []).map(Number))].filter((y) => y < current && y >= current - 5);
}
