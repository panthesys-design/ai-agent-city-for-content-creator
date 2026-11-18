import { user, type AgentInputItem } from "@openai/agents";
import { artifactCategoryLabels, artifactTypeLabels, type ArtifactSummary } from "@/lib/artifact-records";
import { findOwnedArtifact } from "@/lib/artifacts";
import type { HeadquartersRecord } from "@/lib/headquarters";
import { imagekitConfig, strapiPublicUrl } from "./env";

// Gives agents access to saved artifacts and the files users attach in chat: references the model can read, and
// image content it can see. Everything is looked up within the caller's headquarters.

/** Most files a user can attach to one message. */
export const MAX_ATTACHMENTS = 10;
const IMAGE_BYTES_MAX = 8 * 1024 * 1024;
const isDocumentId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{8,64}$/i.test(value);

/** The artifacts with these IDs that belong to the headquarters, in the given order (unknown IDs are dropped). */
export async function resolveAttachments(hq: HeadquartersRecord, ids: unknown): Promise<ArtifactSummary[]> {
  if (!Array.isArray(ids)) return [];
  const unique = [...new Set(ids.filter(isDocumentId))].slice(0, MAX_ATTACHMENTS);
  const found = await Promise.all(unique.map((id) => findOwnedArtifact(hq, id).catch(() => null)));
  return found.flatMap((a) => (a ? [{
    documentId: a.documentId, title: a.title, type: a.type, category: a.category, mimeType: a.mimeType, summary: a.summary,
    excerpt: a.excerpt, url: a.url, agentId: a.agentId, agentName: a.agentName, taskId: a.taskId, createdAt: a.createdAt,
  }] : []));
}

/** One line per artifact, for the model: what it is, its ID for `read_artifact`, and its file URL. */
export function describeArtifact(a: ArtifactSummary): string {
  const kind = a.category === "upload" ? `${artifactTypeLabels[a.type].one} (uploaded by the user)` : artifactCategoryLabels[a.category];
  return `- ${kind} “${a.title}” — artifactId: ${a.documentId}${a.mimeType ? `, ${a.mimeType}` : ""}${a.url ? `, url: ${a.url}` : ""}${a.summary ? ` — ${a.summary}` : ""}`;
}

/** The note added to a message that has attachments, so the agent knows they exist and how to read them. */
export function attachmentNote(attachments: ArtifactSummary[]): string {
  if (!attachments.length) return "";
  return `Files attached to this message (call read_artifact with an artifactId to read a document or look at an image; use the url to work with the file in other tools):\n${attachments.map(describeArtifact).join("\n")}`;
}

/** Text of a user message plus the note about its attachments. */
export const withAttachmentNote = (text: string, attachments: ArtifactSummary[]) =>
  [text, attachmentNote(attachments)].filter(Boolean).join("\n\n");

/** Whether the server may fetch this file to show it to the model: only the media library and ImageKit. */
function trustedFileUrl(url: string): boolean {
  try {
    const target = new URL(url);
    const bases = [strapiPublicUrl(), process.env.STRAPI_URL ?? "", imagekitConfig()?.urlEndpoint ?? ""].filter(Boolean);
    return bases.some((base) => {
      const b = new URL(base);
      return target.origin === b.origin && target.pathname.startsWith(b.pathname.replace(/\/$/, "") + "/");
    }) || /^https:\/\/ik\.imagekit\.io\//.test(url);
  } catch {
    return false;
  }
}

/**
 * The image as base64 for the model, or null when it can't be fetched. Fetched by the server because the media
 * library may not be reachable from OpenAI (for example a local Strapi).
 */
export async function imageForModel(url: string | null, signal?: AbortSignal): Promise<{ data: string; mediaType: string } | null> {
  if (!url || !trustedFileUrl(url)) return null;
  try {
    const timeout = AbortSignal.timeout(20_000);
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const mediaType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !/^image\/(png|jpe?g|webp|gif)$/.test(mediaType)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > IMAGE_BYTES_MAX) return null;
    return { data: bytes.toString("base64"), mediaType };
  } catch {
    return null;
  }
}

/** The user's new message for the model: text with the attachment note, plus attached images it can see. */
export async function userTurn(text: string, attachments: ArtifactSummary[], signal?: AbortSignal): Promise<AgentInputItem> {
  const images = attachments.filter((a) => a.type === "image").slice(0, 4);
  const loaded = await Promise.all(images.map((a) => imageForModel(a.url, signal)));
  const parts: Exclude<Parameters<typeof user>[0], string> = loaded.flatMap((img) => (img ? [{ type: "input_image" as const, image: `data:${img.mediaType};base64,${img.data}` }] : []));
  const body = withAttachmentNote(text, attachments);
  return parts.length ? user([{ type: "input_text", text: body }, ...parts]) : user(body);
}
