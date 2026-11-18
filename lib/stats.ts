import { audienceStats } from "./composio/audience";
import type { CityStats } from "./city-stats";
import type { HeadquartersRecord } from "./headquarters";
import { strapi } from "./strapi";

// Server-only numbers for the City page's overview cards. Counts come from Strapi (every query filtered by the
// headquarters) and audience numbers from the connected platforms (lib/composio/audience.ts, cached).

/** How many rows match, without loading them. */
async function count(collection: string, filters: Record<string, string>): Promise<number> {
  const query = new URLSearchParams({ ...filters, "pagination[pageSize]": "1", "fields[0]": "documentId" });
  const { meta } = await strapi<{ meta?: { pagination?: { total?: number } } }>(`/${collection}?${query}`);
  return meta?.pagination?.total ?? 0;
}

async function nextScheduled(hqId: string): Promise<string | null> {
  const query = new URLSearchParams({
    "filters[headquarter][documentId][$eq]": hqId, "filters[status][$eq]": "scheduled",
    "sort[0]": "publishAt:asc", "pagination[pageSize]": "1", "fields[0]": "publishAt",
  });
  const { data } = await strapi<{ data: { publishAt?: string | null }[] }>(`/social-posts?${query}`);
  return data[0]?.publishAt ?? null;
}

/**
 * The overview numbers. `refreshAudience` re-reads stale platform numbers (slow: one call per account), so the page
 * renders with cached numbers and the browser asks for fresh ones afterwards.
 */
export async function cityStats(hq: HeadquartersRecord, { refreshAudience = false, force = false } = {}): Promise<CityStats> {
  const hqFilter = { "filters[headquarter][documentId][$eq]": hq.documentId };
  // Content agents created: every artifact except files the user uploaded.
  const made = { ...hqFilter, "filters[category][$ne]": "upload" };
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const [documents, images, audio, video, published, publishedThisWeek, failed, scheduled, nextAt, audience, drafts] = await Promise.all([
    count("artifacts", { ...made, "filters[type][$eq]": "document" }),
    count("artifacts", { ...made, "filters[type][$eq]": "image" }),
    count("artifacts", { ...made, "filters[type][$eq]": "audio" }),
    count("artifacts", { ...made, "filters[type][$eq]": "video" }),
    count("social-posts", { ...hqFilter, "filters[status][$eq]": "published" }).catch(() => 0),
    count("social-posts", { ...hqFilter, "filters[status][$eq]": "published", "filters[publishedAt][$gte]": weekAgo }).catch(() => 0),
    count("social-posts", { ...hqFilter, "filters[status][$eq]": "failed" }).catch(() => 0),
    count("social-posts", { ...hqFilter, "filters[status][$in][0]": "scheduled", "filters[status][$in][1]": "publishing" }).catch(() => 0),
    nextScheduled(hq.documentId).catch(() => null),
    audienceStats(hq.documentId, { refresh: refreshAudience, force }).catch((error) => {
      console.warn("[stats] couldn't load audience numbers:", error instanceof Error ? error.message : error);
      return { entries: [], otherAccounts: 0 };
    }),
    count("social-posts", { ...hqFilter, "filters[status][$eq]": "draft" }).catch(() => 0),
  ]);
  return {
    content: { total: documents + images + audio + video, documents, images, audio, video },
    posts: { published, publishedThisWeek, failed, scheduled, nextAt, drafts },
    audience: audience.entries,
    otherAccounts: audience.otherAccounts,
  };
}
