import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { artifactCategories, artifactCategoryLabels, artifactTypes, documentCategories, type ArtifactSummary } from "@/lib/artifact-records";
import { createArtifact, findOwnedArtifact, searchArtifacts, type NewArtifact } from "@/lib/artifacts";
import { describeArtifact, imageForModel } from "./artifact-access";
import type { CityRunContext } from "./context";
import { saveMemory, type MemoryKind } from "./memory";
import { contextOf, scopeOf } from "./tool-context";

// Artifacts are the deliverables a user keeps: they appear on the Artifacts page and as previews in chat.
// Media tools (images, voiceovers, timelines, publishing packages) record theirs through `recordArtifact`;
// text deliverables (scripts, topic lists, research briefs…) are saved with the `save_artifact` tool below.

/**
 * Saves an artifact for the current run and tells live chat about it. Never fails the tool that produced the
 * file: if the `artifacts` collection is missing or forbidden, the deliverable is still in memory and the media
 * library, so this logs a warning and returns null.
 */
export async function recordArtifact(context: CityRunContext, artifact: NewArtifact): Promise<ArtifactSummary | null> {
  try {
    const saved = await createArtifact(
      { hq: context.hq.documentId, agent: context.agentId, task: context.taskId },
      artifact,
      context.agentId ? context.agentName : null,
    );
    context.onArtifact?.(saved);
    return saved;
  } catch (error) {
    console.warn("[artifacts] Could not record the artifact:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Which memory kind a document category is shared as, so the next agent in the pipeline finds it. */
const MEMORY_KIND: Record<(typeof documentCategories)[number], MemoryKind> = {
  script: "script", research: "research", topics: "research", outline: "script", copy: "note", other: "note",
};

export const saveArtifactTool = tool({
  name: "save_artifact",
  description:
    "Save a finished text deliverable for the user: a script, topic or idea list, research brief, outline, captions, or post copy. "
    + "It appears on the user's Artifacts page and as a document preview in chat, and is also saved to shared memory for other agents "
    + "(so you don't need memory_save for it). Write the content in Markdown with headings and lists. Returns artifactId and memoryId.",
  parameters: z.object({
    title: z.string().min(1).max(160).describe('Specific name, e.g. "Script: 60s video on AI note-taking apps".'),
    category: z.enum(documentCategories).describe(
      Object.entries(artifactCategoryLabels).filter(([k]) => (documentCategories as readonly string[]).includes(k)).map(([k, v]) => `${k} = ${v}`).join(", "),
    ),
    content: z.string().min(1).max(60_000).describe("The complete deliverable in Markdown."),
    summary: z.string().max(300).nullable().describe("One sentence describing it, shown on the artifact card."),
  }),
  execute: async ({ title, category, content, summary }, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    await context.report({ activity: `Saving “${title}”` });
    const memoryId = await saveMemory(scopeOf(context), { kind: MEMORY_KIND[category], title, content, tags: ["artifact", category] })
      .catch((error: unknown) => {
        console.warn("[artifacts] Could not save the document to memory:", error instanceof Error ? error.message : error);
        return null;
      });
    const saved = await recordArtifact(context, { title, type: "document", category, mimeType: "text/markdown", summary, content, memoryId });
    if (!saved && !memoryId) return "Saving failed. Put the full deliverable in your final answer instead.";
    return JSON.stringify({ artifactId: saved?.documentId ?? null, memoryId, shownToUser: Boolean(saved) });
  },
});

// ---------- Reading artifacts ----------

/** Rule shared by every agent and headquarters: saved work and uploads are there to be reused. */
export const ARTIFACT_RULES = [
  "Saved artifacts (earlier deliverables of any agent, and files the user uploaded) stay available across tasks and chats. When a request refers to earlier work or a file (\"the script\", \"my logo\", \"last week's thumbnail\"), find it with list_artifacts and open it with read_artifact instead of asking the user to paste it or redoing it.",
  "Files the user attaches to a message are listed with their artifactId and url; read them with read_artifact. Pass an image's url to tools that take an image (for example transform_image's sourceImageUrl).",
].join("\n");

const ARTIFACT_TEXT_MAX = 20_000;

export const listArtifactsTool = tool({
  name: "list_artifacts",
  description: "Find saved artifacts of this city, newest first: deliverables from any agent (scripts, research, images, voiceovers, timelines, publishing packages) and files the user uploaded. Returns one line each with its artifactId and url.",
  parameters: z.object({
    query: z.string().max(120).nullable().describe("Words to look for in the title, summary, or text. Null lists the latest."),
    type: z.enum(artifactTypes).nullable(),
    category: z.enum(artifactCategories).nullable().describe('"upload" = files the user uploaded.'),
    currentTaskOnly: z.boolean().nullable().describe("Only artifacts made for the current task."),
    limit: z.number().int().min(1).max(50).nullable(),
  }),
  execute: async ({ query, type, category, currentTaskOnly, limit }, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    const found = await searchArtifacts(context.hq, { query, type, category, limit: limit ?? 20, taskId: currentTaskOnly ? context.taskId : null });
    if (!found.length) return query || type || category ? "No artifacts match. Try fewer words or no filters." : "This city has no saved artifacts yet.";
    return `${found.length} artifact${found.length === 1 ? "" : "s"}:\n${found.map((a) => `${describeArtifact(a)}${a.agentName ? ` (by ${a.agentName})` : ""}${a.createdAt ? ` · ${a.createdAt.slice(0, 10)}` : ""}`).join("\n")}`;
  },
});

export const readArtifactTool = tool({
  name: "read_artifact",
  description: "Open one saved or uploaded artifact by its artifactId: the full text of a document, the details of an image, audio, or video (images are shown to you), and its file URL.",
  parameters: z.object({
    artifactId: z.string().min(8).max(64),
    offset: z.number().int().min(0).nullable().describe("Character offset for long documents."),
  }),
  execute: async ({ artifactId, offset }, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    const artifact = /^[a-z0-9]+$/i.test(artifactId) ? await findOwnedArtifact(context.hq, artifactId) : null;
    if (!artifact) return `No artifact "${artifactId}" in this city. Use list_artifacts to find the right ID.`;
    await context.report({ activity: `Reading “${artifact.title.slice(0, 60)}”` });
    const start = offset ?? 0;
    const text = artifact.content ?? "";
    const slice = text.slice(start, start + ARTIFACT_TEXT_MAX);
    const lines = [
      describeArtifact(artifact),
      artifact.agentName ? `Made by ${artifact.agentName}` : artifact.category === "upload" ? "Uploaded by the user" : null,
      artifact.data && Object.keys(artifact.data).length ? `Data: ${JSON.stringify(artifact.data).slice(0, 4000)}` : null,
      slice ? `\nContent (characters ${start}–${start + slice.length} of ${text.length}${start + slice.length < text.length ? `; call again with offset ${start + slice.length} for more` : ""}):\n${slice}` : null,
    ].filter(Boolean).join("\n");
    if (artifact.type !== "image") return lines;
    const image = await imageForModel(artifact.url, context.signal);
    return image
      ? [{ type: "text" as const, text: lines }, { type: "image" as const, image: { data: image.data, mediaType: image.mediaType }, detail: "auto" as const }]
      : `${lines}\n(The image itself couldn't be loaded; use its url.)`;
  },
});
