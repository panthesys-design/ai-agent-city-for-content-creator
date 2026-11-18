import { tool, type RunContext } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";
import { createPost } from "@/lib/composio/posts";
import { recordArtifact } from "./artifact-tools";
import { ttsModel } from "./env";
import { uploadToMediaLibrary } from "./media-library";
import { saveMemory } from "./memory";
import type { CityRunContext } from "./context";
import { contextOf, scopeOf, slug } from "./tool-context";

// Production tools for the content pipeline (image tools live in image-tools.ts). Generated files go to Strapi's media library and every result is
// saved to the headquarters' shared memory, so the next agent in the pipeline can find it.

let client: OpenAI | null = null;
const openai = () => (client ??= new OpenAI());

const voices = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"] as const;
const TTS_LIMIT = 4096;

export const voiceoverTool = tool({
  name: "generate_voiceover",
  description: `Narrate a script as an MP3 voiceover (max ${TTS_LIMIT} characters per call; split longer scripts into parts). Saves the audio to memory and returns its URL.`,
  parameters: z.object({
    title: z.string().min(1).max(120).describe("Name of the voiceover, e.g. the video title plus the part number."),
    script: z.string().min(1).max(TTS_LIMIT).describe("Exactly the words to speak."),
    voice: z.enum(voices).describe("Voice to use."),
    direction: z.string().max(500).nullable().describe("Delivery notes: tone, pacing, emotion."),
  }),
  execute: async ({ title, script, voice, direction }, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    await context.report({ activity: `Recording “${title}”` });
    const speech = await openai().audio.speech.create(
      { model: ttsModel(), voice, input: script, response_format: "mp3", ...(direction ? { instructions: direction } : {}) },
      { signal: context.signal },
    );
    const { url } = await uploadToMediaLibrary(await speech.arrayBuffer(), `${slug(title)}.mp3`, "audio/mpeg", { caption: title, signal: context.signal });
    const memoryId = await saveMemory(scopeOf(context), {
      kind: "voice", title: `Voiceover: ${title}`, content: script, data: { audioUrl: url, voice, direction, characters: script.length }, tags: ["voiceover"],
    });
    const artifact = await recordArtifact(context, {
      title: `Voiceover: ${title}`, type: "audio", category: "voiceover", mimeType: "audio/mpeg", url, memoryId,
      summary: `${voice} voice · ${script.length.toLocaleString("en")} characters${direction ? ` · ${direction}` : ""}`,
      content: script, data: { voice, direction, characters: script.length },
    });
    return JSON.stringify({ audioUrl: url, memoryId, artifactId: artifact?.documentId ?? null });
  },
});

export const videoTimelineTool = tool({
  name: "build_video_timeline",
  description: "Assemble voiceover and media into an edit timeline (scenes, timing, captions, transitions, music) and save it as the video plan for rendering and publishing.",
  parameters: z.object({
    title: z.string().min(1).max(160),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
    scenes: z.array(z.object({
      order: z.number().int().min(1),
      narration: z.string().max(2000),
      audioUrl: z.string().max(2048).nullable().describe("https URL of the scene's audio."),
      imageUrl: z.string().max(2048).nullable().describe("https URL of the scene's image."),
      durationSeconds: z.number().min(0.5).max(600),
      caption: z.string().max(200).nullable(),
      transition: z.enum(["cut", "fade", "slide", "zoom"]).nullable(),
    })).min(1).max(200),
    music: z.string().max(200).nullable().describe("Music mood or track reference."),
    notes: z.string().max(2000).nullable(),
  }),
  execute: async (timeline, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    const isHttpUrl = (url: string | null) => url === null || /^https?:\/\/\S+$/.test(url);
    const badUrl = timeline.scenes.find((s) => !isHttpUrl(s.audioUrl) || !isHttpUrl(s.imageUrl));
    if (badUrl) return `Scene ${badUrl.order} has an audioUrl or imageUrl that is not an http(s) URL. Fix it and call again.`;
    const scenes = [...timeline.scenes].sort((a, b) => a.order - b.order);
    const totalSeconds = Math.round(scenes.reduce((sum, s) => sum + s.durationSeconds, 0));
    const missing = scenes.filter((s) => !s.imageUrl).map((s) => s.order);
    const summary = [
      `${timeline.title} — ${timeline.aspectRatio}, ${scenes.length} scenes, ${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`,
      ...scenes.map((s) => `${s.order}. [${s.durationSeconds}s] ${s.caption ?? s.narration.slice(0, 80)}`),
    ].join("\n");
    const memoryId = await saveMemory(scopeOf(context), {
      kind: "video", title: `Video timeline: ${timeline.title}`, content: summary, data: { ...timeline, scenes, totalSeconds }, tags: ["timeline"],
    });
    const duration = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
    const storyboard = [
      `# ${timeline.title}`,
      `**Format:** ${timeline.aspectRatio} · **Length:** ${duration} · **Scenes:** ${scenes.length}${timeline.music ? ` · **Music:** ${timeline.music}` : ""}`,
      ...scenes.map((s) => [
        `## Scene ${s.order}${s.caption ? ` — ${s.caption}` : ""}`,
        `*${s.durationSeconds}s${s.transition ? ` · ${s.transition}` : ""}*`,
        s.narration,
      ].join("\n\n")),
      timeline.notes ? `## Notes\n\n${timeline.notes}` : "",
    ].filter(Boolean).join("\n\n");
    const artifact = await recordArtifact(context, {
      title: `Video timeline: ${timeline.title}`, type: "video", category: "timeline", mimeType: null, memoryId,
      summary: `${timeline.aspectRatio} · ${duration} · ${scenes.length} scenes`, content: storyboard,
      url: scenes.find((s) => s.imageUrl)?.imageUrl ?? null, data: { ...timeline, scenes, totalSeconds },
    });
    return JSON.stringify({ memoryId, artifactId: artifact?.documentId ?? null, totalSeconds, scenes: scenes.length, scenesWithoutVisuals: missing });
  },
});

/** Composio app for each publishing platform. */
const PLATFORM_TOOLKIT = {
  youtube: "youtube", youtube_shorts: "youtube", tiktok: "tiktok", instagram_reels: "instagram", linkedin: "linkedin", x: "twitter",
} as const;

export const publishScheduleTool = tool({
  name: "prepare_publication",
  description: "Save the publishing package for a video (platform, title, description, tags, suggested time) as an artifact and as a draft on the user's Post page and calendar. It doesn't publish anything.",
  parameters: z.object({
    platform: z.enum(["youtube", "youtube_shorts", "tiktok", "instagram_reels", "linkedin", "x"]),
    title: z.string().min(1).max(100),
    description: z.string().max(5000),
    tags: z.array(z.string().max(60)).max(30),
    publishAt: z.string().nullable().describe("Suggested publish time, ISO 8601 with timezone offset, e.g. 2026-11-20T09:00:00+05:30; null if none."),
    videoMemoryId: z.string().nullable().describe("memoryId of the video timeline this publishes."),
  }),
  execute: async (pkg, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    if (pkg.publishAt && Number.isNaN(Date.parse(pkg.publishAt))) return "publishAt is not a valid ISO 8601 date-time. Fix it and call again.";
    const when = pkg.publishAt ? new Date(pkg.publishAt).toISOString() : null;
    const memoryId = await saveMemory(scopeOf(context), {
      kind: "publish",
      title: `${pkg.platform}: ${pkg.title}`,
      content: `${pkg.title}\n\n${pkg.description}\n\nTags: ${pkg.tags.join(", ")}\nSuggested time: ${when ?? "none"} (draft, not published)`,
      data: { ...pkg, publishAt: when, state: "draft" },
      tags: ["publish", pkg.platform],
    });
    const artifact = await recordArtifact(context, {
      title: `${pkg.platform.replace(/_/g, " ")}: ${pkg.title}`, type: "document", category: "publication", mimeType: "text/markdown", memoryId,
      summary: `${pkg.platform.replace(/_/g, " ")} · draft${when ? ` · suggested ${when}` : ""}`,
      content: [
        `# ${pkg.title}`,
        `**Platform:** ${pkg.platform.replace(/_/g, " ")}  \n**Status:** draft on the Post page${when ? `  \n**Suggested time:** ${when}` : ""}`,
        `## Description\n\n${pkg.description || "_No description._"}`,
        `## Tags\n\n${pkg.tags.length ? pkg.tags.map((t) => `\`${t}\``).join(" ") : "_No tags._"}`,
      ].join("\n\n"),
      data: { ...pkg, publishAt: when, state: "draft" },
    });
    // The package is also a draft on the Post page and calendar, where the user schedules or publishes it (after an
    // agent prepares it for the connected account). It is not published from here.
    const draft = await createPost({
      hqId: context.hq.documentId, agentId: context.agentId, taskId: context.taskId, artifactId: artifact?.documentId ?? null,
      toolkit: PLATFORM_TOOLKIT[pkg.platform], status: "draft", connectionId: null, toolSlug: null, toolVersion: null, arguments: null,
      title: pkg.title, summary: pkg.description.slice(0, 600) || pkg.title,
      content: [pkg.title, pkg.description, pkg.tags.length ? pkg.tags.map((t) => `#${t.replace(/^#/, "").replace(/\s+/g, "")}`).join(" ") : ""].filter(Boolean).join("\n\n"),
      publishAt: when,
    }).catch((error) => { console.warn("[publish] couldn't save the draft post:", error instanceof Error ? error.message : error); return null; });
    return JSON.stringify({
      memoryId, artifactId: artifact?.documentId ?? null, draftId: draft?.documentId ?? null, suggestedPublishAt: when, state: "draft",
      note: "Saved as a draft on the Post page and calendar; nothing is published yet. To publish it, prepare the draft with save_post_draft (draft_id) when the platform is connected, or schedule it with schedule_app_tool if the user asked you to.",
    });
  },
});
