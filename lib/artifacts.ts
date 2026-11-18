import type { HeadquartersRecord } from "./headquarters";
import { strapi } from "./strapi";
import {
  artifactFromStrapi, excerptOf, toSummary,
  type ArtifactCategory, type ArtifactRecord, type ArtifactSummary, type ArtifactType,
} from "./artifact-records";

// Server-only CRUD for the `artifacts` collection. Every read and delete filters by headquarters, so one city never
// sees another city's deliverables. Agent tools write through `createArtifact` (see lib/ai/artifact-tools.ts).

type Row = Record<string, unknown>;
const connect = (documentId: string) => ({ connect: [documentId] });

/** Strapi's REST maxLimit is 100; the explorer reads up to this many artifacts in pages. */
const LIST_PAGE = 100;
const LIST_MAX = 500;

/** Columns for lists: everything except the full `content` and `data`, which previews load on demand. */
const SUMMARY_FIELDS = ["title", "type", "category", "mimeType", "summary", "url", "createdAt"];

function summaryQuery(extra: Record<string, string>) {
  const query = new URLSearchParams({
    "populate[agent][fields][0]": "name",
    "populate[task][fields][0]": "documentId",
    ...extra,
  });
  SUMMARY_FIELDS.forEach((field, i) => query.set(`fields[${i}]`, field));
  return query;
}

export type NewArtifact = {
  title: string;
  type: ArtifactType;
  category: ArtifactCategory;
  mimeType?: string | null;
  summary?: string | null;
  content?: string | null;
  url?: string | null;
  data?: unknown;
  memoryId?: string | null;
  mediaAssetId?: string | null;
};

export type ArtifactOwner = { hq: string; agent?: string | null; task?: string | null };

/** Saves an artifact and returns its summary (with the agent name the caller already knows). */
export async function createArtifact(owner: ArtifactOwner, artifact: NewArtifact, agentName: string | null = null): Promise<ArtifactSummary> {
  const summary = artifact.summary?.trim() || excerptOf(artifact.content ?? null, 280);
  const { data } = await strapi<{ data: Row }>("/artifacts?populate[task][fields][0]=documentId", {
    method: "POST",
    body: JSON.stringify({
      data: {
        title: artifact.title.slice(0, 160),
        type: artifact.type,
        category: artifact.category,
        mimeType: artifact.mimeType?.slice(0, 120) ?? null,
        summary: summary ? summary.slice(0, 300) : null,
        content: artifact.content ?? null,
        url: artifact.url ?? null,
        data: artifact.data ?? null,
        memoryId: artifact.memoryId ?? null,
        headquarter: connect(owner.hq),
        ...(owner.agent ? { agent: connect(owner.agent) } : {}),
        ...(owner.task ? { task: connect(owner.task) } : {}),
        ...(artifact.mediaAssetId ? { mediaAsset: connect(artifact.mediaAssetId) } : {}),
      },
    }),
  });
  const record = artifactFromStrapi(data);
  return toSummary({ ...record, agentId: owner.agent ?? null, agentName, taskId: owner.task ?? record.taskId });
}

/** This headquarters' artifacts, newest first (summaries only). */
export async function listArtifacts(hq: HeadquartersRecord, { max = LIST_MAX } = {}): Promise<ArtifactSummary[]> {
  const all: ArtifactSummary[] = [];
  for (let page = 1; all.length < max; page++) {
    const query = summaryQuery({
      "filters[headquarter][documentId][$eq]": hq.documentId,
      "sort[0]": "createdAt:desc",
      "sort[1]": "id:desc",
      "pagination[page]": String(page),
      "pagination[pageSize]": String(LIST_PAGE),
    });
    const { data, meta } = await strapi<{ data: Row[]; meta?: { pagination?: { pageCount?: number } } }>(`/artifacts?${query}`);
    all.push(...data.map((row) => toSummary(artifactFromStrapi(row))));
    if (data.length < LIST_PAGE || page >= (meta?.pagination?.pageCount ?? page)) break;
  }
  return all.slice(0, max);
}

/** Artifacts made by a task and by the steps it delegated (headquarters runs), oldest first. */
export async function listTaskArtifacts(hq: HeadquartersRecord, taskId: string): Promise<ArtifactSummary[]> {
  const query = summaryQuery({
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "filters[$or][0][task][documentId][$eq]": taskId,
    "filters[$or][1][task][parent][documentId][$eq]": taskId,
    "sort[0]": "createdAt:asc",
    "pagination[pageSize]": String(LIST_PAGE),
  });
  const { data } = await strapi<{ data: Row[] }>(`/artifacts?${query}`);
  return data.map((row) => toSummary(artifactFromStrapi(row)));
}

/** One artifact with its full content, only within this headquarters. */
export async function findOwnedArtifact(hq: HeadquartersRecord, documentId: string): Promise<ArtifactRecord | null> {
  const query = new URLSearchParams({
    "filters[documentId][$eq]": documentId,
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "populate[agent][fields][0]": "name",
    "populate[task][fields][0]": "documentId",
    "pagination[pageSize]": "1",
  });
  const { data } = await strapi<{ data: Row[] }>(`/artifacts?${query}`);
  return data[0] ? artifactFromStrapi(data[0]) : null;
}

/** Deletes the artifact record. Files stay in the media library (other artifacts or timelines may use them). */
export async function deleteOwnedArtifact(hq: HeadquartersRecord, documentId: string): Promise<boolean> {
  const found = await findOwnedArtifact(hq, documentId);
  if (!found) return false;
  await strapi(`/artifacts/${found.documentId}`, { method: "DELETE" });
  return true;
}

export type ArtifactSearch = {
  /** Words that must each appear in the title, summary, or content (case-insensitive). */
  query?: string | null;
  type?: ArtifactType | null;
  category?: ArtifactCategory | null;
  /** Only artifacts from this task and the steps it delegated. */
  taskId?: string | null;
  limit?: number;
};

/** Finds this headquarters' artifacts for agents (`list_artifacts`), newest first (summaries only). */
export async function searchArtifacts(hq: HeadquartersRecord, search: ArtifactSearch): Promise<ArtifactSummary[]> {
  const extra: Record<string, string> = {
    "filters[headquarter][documentId][$eq]": hq.documentId,
    "sort[0]": "createdAt:desc",
    "sort[1]": "id:desc",
    "pagination[pageSize]": String(Math.max(1, Math.min(50, search.limit ?? 20))),
  };
  if (search.type) extra["filters[type][$eq]"] = search.type;
  if (search.category) extra["filters[category][$eq]"] = search.category;
  if (search.taskId) {
    extra["filters[$or][0][task][documentId][$eq]"] = search.taskId;
    extra["filters[$or][1][task][parent][documentId][$eq]"] = search.taskId;
  }
  const words = (search.query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 5);
  words.forEach((word, i) => {
    ["title", "summary", "content"].forEach((field, j) => { extra[`filters[$and][${i}][$or][${j}][${field}][$containsi]`] = word; });
  });
  const { data } = await strapi<{ data: Row[] }>(`/artifacts?${summaryQuery(extra)}`);
  return data.map((row) => toSummary(artifactFromStrapi(row)));
}
