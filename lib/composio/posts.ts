import { postFromStrapi, type PostStatus, type SocialPost } from "@/lib/connection-records";
import { strapi } from "@/lib/strapi";

// Server-only persistence for `social-posts`: posts agents drafted, scheduled, or published through connected
// accounts. Reads for the UI always filter by headquarters; the scheduled-post runner reads due posts across
// headquarters and carries each post's own headquarters and connection forward.

type Row = Record<string, unknown>;
type One = { data: Row };
type Many = { data: Row[] };

const POPULATE = {
  "populate[agent][fields][0]": "name",
  "populate[connectedAccount][fields][0]": "accountLabel",
  "populate[connectedAccount][fields][1]": "toolkitName",
  "populate[artifact][fields][0]": "documentId",
};

export type NewPost = {
  hqId: string; connectionId: string | null; agentId: string | null; taskId: string | null; artifactId?: string | null;
  toolkit: string; toolSlug: string | null; toolVersion: string | null; arguments: Record<string, unknown> | null;
  title: string; summary: string | null; content?: string | null; media?: string[];
  status: PostStatus; publishAt?: string | null; publishedAt?: string | null;
  url?: string | null; result?: unknown; error?: string | null;
};

export async function createPost(post: NewPost): Promise<SocialPost> {
  const { data } = await strapi<One>(`/social-posts?${new URLSearchParams(POPULATE)}`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        toolkit: post.toolkit, toolSlug: post.toolSlug || null, toolVersion: post.toolVersion, arguments: post.arguments,
        title: post.title.slice(0, 200), summary: post.summary?.slice(0, 4000) ?? null, content: post.content?.slice(0, 20000) ?? null,
        media: post.media ?? [], status: post.status,
        publishAt: post.publishAt ?? null, publishedAt: post.publishedAt ?? null, url: post.url ?? null,
        result: post.result ?? null, error: post.error?.slice(0, 2000) ?? null,
        headquarter: { connect: [post.hqId] },
        ...(post.connectionId ? { connectedAccount: { connect: [post.connectionId] } } : {}),
        ...(post.agentId ? { agent: { connect: [post.agentId] } } : {}),
        ...(post.taskId ? { task: { connect: [post.taskId] } } : {}),
        ...(post.artifactId ? { artifact: { connect: [post.artifactId] } } : {}),
      },
    }),
  });
  return postFromStrapi(data);
}

export type PostPatch = Partial<{
  status: PostStatus; publishAt: string | null; publishedAt: string | null; url: string | null; result: unknown; error: string | null;
  userScheduled: boolean; title: string; content: string | null; summary: string | null; media: string[];
  toolSlug: string | null; toolVersion: string | null; arguments: Record<string, unknown> | null; connectionId: string | null;
}>;

export async function updatePost(documentId: string, patch: PostPatch): Promise<void> {
  const { connectionId, ...rest } = patch;
  const data: Row = { ...rest };
  if (typeof patch.error === "string") data.error = patch.error.slice(0, 2000);
  if (typeof patch.title === "string") data.title = patch.title.slice(0, 200);
  if ("connectionId" in patch) data.connectedAccount = connectionId ? { set: [connectionId] } : { set: [] };
  await strapi(`/social-posts/${documentId}`, { method: "PUT", body: JSON.stringify({ data }) });
}

export async function deletePost(documentId: string): Promise<void> {
  await strapi(`/social-posts/${documentId}`, { method: "DELETE" });
}

export async function listPosts(hqId: string, { limit = 300 } = {}): Promise<SocialPost[]> {
  const query = new URLSearchParams({
    ...POPULATE, "filters[headquarter][documentId][$eq]": hqId, "sort[0]": "createdAt:desc", "pagination[pageSize]": String(limit),
  });
  const { data } = await strapi<Many>(`/social-posts?${query}`);
  return data.map(postFromStrapi);
}

export async function findOwnedPost(hqId: string, documentId: string): Promise<SocialPost | null> {
  return (await findPostForPublishing(hqId, documentId))?.post ?? null;
}

/** A post with what publishing needs: its headquarters, connection, agent, tool, and arguments. */
export type DuePost = {
  documentId: string; hqId: string; connectionId: string | null; agentId: string | null; userScheduled: boolean;
  toolkit: string; toolSlug: string; toolVersion: string | null; arguments: Record<string, unknown>; title: string;
};

const rel = (v: unknown) => (v && typeof v === "object" && "documentId" in v ? String((v as { documentId: unknown }).documentId) : null);

function dueFrom(row: Row, hqId: string): DuePost {
  return {
    documentId: String(row.documentId), hqId, connectionId: rel(row.connectedAccount), agentId: rel(row.agent), userScheduled: row.userScheduled === true,
    toolkit: String(row.toolkit ?? ""), toolSlug: String(row.toolSlug ?? ""), toolVersion: typeof row.toolVersion === "string" ? row.toolVersion : null,
    arguments: row.arguments && typeof row.arguments === "object" ? row.arguments as Record<string, unknown> : {}, title: String(row.title ?? "Post"),
  };
}

/** One of this headquarters' posts, with both its display shape and what publishing it needs. */
export async function findPostForPublishing(hqId: string, documentId: string): Promise<{ post: SocialPost; due: DuePost } | null> {
  const query = new URLSearchParams({
    ...POPULATE, "populate[connectedAccount][fields][2]": "documentId", "populate[agent][fields][1]": "documentId",
    "filters[headquarter][documentId][$eq]": hqId, "filters[documentId][$eq]": documentId, "pagination[pageSize]": "1",
  });
  const { data } = await strapi<Many>(`/social-posts?${query}`);
  return data[0] ? { post: postFromStrapi(data[0]), due: dueFrom(data[0], hqId) } : null;
}

/** Scheduled posts whose time has come, oldest first. */
export async function listDuePosts(now = new Date(), limit = 25): Promise<DuePost[]> {
  const query = new URLSearchParams({
    "filters[status][$eq]": "scheduled",
    "filters[publishAt][$lte]": now.toISOString(),
    "populate[headquarter][fields][0]": "documentId",
    "populate[connectedAccount][fields][0]": "documentId",
    "populate[agent][fields][0]": "documentId",
    "sort[0]": "publishAt:asc",
    "pagination[pageSize]": String(limit),
  });
  const { data } = await strapi<Many>(`/social-posts?${query}`);
  return data.flatMap((row) => {
    const hqId = rel(row.headquarter);
    return hqId ? [dueFrom(row, hqId)] : [];
  });
}

/** Whether any post is still waiting for its time (so the publishing schedule must stay on). */
export async function hasScheduledPosts(): Promise<boolean> {
  const query = new URLSearchParams({ "filters[status][$eq]": "scheduled", "pagination[pageSize]": "1", "fields[0]": "documentId" });
  const { data } = await strapi<Many>(`/social-posts?${query}`);
  return data.length > 0;
}

/**
 * Moves a post from `from` (scheduled, or draft for "Publish now") to publishing, once, so two overlapping runs or
 * double clicks never publish it twice. Strapi has no conditional update, so the re-read narrows the race to the
 * moment between read and write; the runner itself never overlaps (CloudHike runs the schedule one at a time).
 */
export async function claimPost(documentId: string, from: PostStatus = "scheduled"): Promise<boolean> {
  const query = new URLSearchParams({ "filters[documentId][$eq]": documentId, "filters[status][$eq]": from, "pagination[pageSize]": "1", "fields[0]": "documentId" });
  const { data } = await strapi<Many>(`/social-posts?${query}`);
  if (!data.length) return false;
  await updatePost(documentId, { status: "publishing" });
  return true;
}
