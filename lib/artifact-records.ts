// Client-safe shapes for artifacts: the deliverables agents produce (scripts, topic lists, research briefs, images,
// voiceovers, video timelines, publishing packages). Stored in Strapi's `artifacts` collection; server CRUD is in
// lib/artifacts.ts. Chat messages carry `ArtifactSummary` snapshots in their metadata so replies can show previews.

export const artifactTypes = ["document", "image", "audio", "video"] as const;
export type ArtifactType = (typeof artifactTypes)[number];

export const artifactCategories = [
  "script", "research", "topics", "outline", "copy", "publication", "timeline", "image", "voiceover", "upload", "other",
] as const;
export type ArtifactCategory = (typeof artifactCategories)[number];

/** Categories an agent may choose for a text deliverable with `save_artifact`. */
export const documentCategories = ["script", "research", "topics", "outline", "copy", "other"] as const satisfies readonly ArtifactCategory[];

export const artifactTypeLabels: Record<ArtifactType, { one: string; many: string }> = {
  document: { one: "Document", many: "Documents" },
  image: { one: "Image", many: "Images" },
  audio: { one: "Audio", many: "Audio" },
  video: { one: "Video", many: "Video" },
};

export const artifactCategoryLabels: Record<ArtifactCategory, string> = {
  script: "Script", research: "Research brief", topics: "Topic list", outline: "Outline", copy: "Copy",
  publication: "Publishing package", timeline: "Video timeline", image: "Image", voiceover: "Voiceover", upload: "Upload", other: "Document",
};

/** What lists, chat cards, and the explorer grid need. `excerpt` is the start of the text content. */
export type ArtifactSummary = {
  documentId: string;
  title: string;
  type: ArtifactType;
  category: ArtifactCategory;
  mimeType: string | null;
  summary: string | null;
  excerpt: string | null;
  url: string | null;
  agentId: string | null;
  agentName: string | null;
  taskId: string | null;
  createdAt: string | null;
};

/** A full artifact for previews: the complete text and structured data (timeline scenes, publishing fields…). */
export type ArtifactRecord = ArtifactSummary & {
  content: string | null;
  data: Record<string, unknown> | null;
};

/** One scene of a video timeline artifact (`data.scenes`). */
export type TimelineScene = {
  order: number;
  narration: string;
  audioUrl: string | null;
  imageUrl: string | null;
  durationSeconds: number;
  caption: string | null;
  transition: string | null;
};

const EXCERPT_CHARS = 280;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const rel = (v: unknown) => (v && typeof v === "object" && "documentId" in v ? String((v as { documentId: unknown }).documentId) : null);

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Plain-text start of a Markdown document, for cards and tiles. */
export function excerptOf(content: string | null, n = EXCERPT_CHARS): string | null {
  if (!content) return null;
  const text = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[#>\-*+\s|]+/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

/** Only http(s) URLs are ever rendered as image/audio sources or links. */
export const safeUrl = (value: unknown): string | null => (typeof value === "string" && /^https?:\/\/\S+$/i.test(value) ? value : null);

export function artifactFromStrapi(row: Record<string, unknown>): ArtifactRecord {
  const agent = row.agent as { name?: unknown } | null | undefined;
  const content = typeof row.content === "string" ? row.content : null;
  const data = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : null;
  return {
    documentId: String(row.documentId),
    title: String(row.title ?? "Untitled"),
    type: oneOf(artifactTypes, row.type, "document"),
    category: oneOf(artifactCategories, row.category, "other"),
    mimeType: str(row.mimeType),
    summary: str(row.summary),
    excerpt: excerptOf(content),
    url: safeUrl(row.url),
    agentId: rel(row.agent),
    agentName: agent && typeof agent.name === "string" ? agent.name : null,
    taskId: rel(row.task),
    createdAt: str(row.createdAt),
    content,
    data,
  };
}

export function toSummary(record: ArtifactRecord): ArtifactSummary {
  return {
    documentId: record.documentId, title: record.title, type: record.type, category: record.category, mimeType: record.mimeType,
    summary: record.summary, excerpt: record.excerpt, url: record.url, agentId: record.agentId, agentName: record.agentName,
    taskId: record.taskId, createdAt: record.createdAt,
  };
}

/**
 * Reads artifact snapshots saved in a chat message's metadata, dropping anything malformed. `artifacts` holds what a
 * reply produced; `attachments` holds the files the user attached to their message.
 */
export function artifactsFromMetadata(metadata: unknown, key: "artifacts" | "attachments" = "artifacts"): ArtifactSummary[] {
  const list = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>)[key] : null;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): ArtifactSummary[] => {
    if (!item || typeof item !== "object" || typeof (item as { documentId?: unknown }).documentId !== "string") return [];
    const a = item as Record<string, unknown>;
    return [{
      documentId: String(a.documentId),
      title: String(a.title ?? "Untitled"),
      type: oneOf(artifactTypes, a.type, "document"),
      category: oneOf(artifactCategories, a.category, "other"),
      mimeType: str(a.mimeType),
      summary: str(a.summary),
      excerpt: str(a.excerpt),
      url: safeUrl(a.url),
      agentId: str(a.agentId),
      agentName: str(a.agentName),
      taskId: str(a.taskId),
      createdAt: str(a.createdAt),
    }];
  });
}

/** Scenes of a timeline artifact, sorted, with unsafe URLs removed. */
export function timelineScenes(data: Record<string, unknown> | null): TimelineScene[] {
  const scenes = data?.scenes;
  if (!Array.isArray(scenes)) return [];
  return scenes.flatMap((s): TimelineScene[] => {
    if (!s || typeof s !== "object") return [];
    const scene = s as Record<string, unknown>;
    return [{
      order: Number(scene.order) || 0,
      narration: String(scene.narration ?? ""),
      audioUrl: safeUrl(scene.audioUrl),
      imageUrl: safeUrl(scene.imageUrl),
      durationSeconds: Number(scene.durationSeconds) || 0,
      caption: str(scene.caption),
      transition: str(scene.transition),
    }];
  }).sort((a, b) => a.order - b.order);
}

/** File name used when downloading a document artifact. */
export function downloadName(artifact: Pick<ArtifactSummary, "title">, extension: string) {
  const base = artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "artifact";
  return `${base}.${extension}`;
}
