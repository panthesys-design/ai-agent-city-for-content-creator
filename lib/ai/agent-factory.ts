import { Agent, tool, webSearchTool, type ModelSettings, type Tool } from "@openai/agents";
import { z } from "zod";
import type { AgentRole } from "@/lib/agent-config";
import type { AgentRecord } from "@/lib/agent-records";
import { APP_RULES, appTools } from "./app-tools";
import { dateRules, resolveTimeZone } from "./clock";
import { ARTIFACT_RULES, listArtifactsTool, readArtifactTool, saveArtifactTool } from "./artifact-tools";
import { ASK_RULES, COMPUTER_RULES, askUserTool, computerTools, confirmActionTool } from "./computer-tools";
import { publishScheduleTool, videoTimelineTool, voiceoverTool } from "./creative-tools";
import { imageTool, transformImageTool } from "./image-tools";
import type { CityRunContext } from "./context";
import { agentModel, aiProvider } from "./env";
import type { MemoryConnection } from "./memory";

// Builds an OpenAI Agents SDK agent from an agent's saved configuration (instructions, model, tools, settings).

/** How each role uses shared memory, so outputs flow Research → Script → Voice/Media → Video Editor → Publisher. */
const ROLE_PLAYBOOK: Record<AgentRole, string> = {
  research: [
    "Search memory first for the project context and earlier research so you build on it instead of repeating it.",
    "Research with web search when available; prefer recent, credible sources and keep their URLs.",
    'Save the research brief with save_artifact (category "research"): key facts, data points, angles, hooks, and sources. Save topic or idea lists with category "topics".',
  ].join("\n"),
  script: [
    'Read the latest research (memory_search kind "research", then memory_get) before writing.',
    "Write a complete script: hook in the first lines, clear structure, scene breakdown, and a call to action.",
    'Save the script with save_artifact (category "script"), marking scenes as "## Scene 1", "## Scene 2", ….',
  ].join("\n"),
  voice: [
    'Read the latest script (memory_search kind "script", then memory_get).',
    "Generate the voiceover with generate_voiceover, splitting long scripts into parts at scene boundaries.",
    "Report the audio URLs in your answer; they are saved to memory automatically.",
  ].join("\n"),
  media: [
    'Read the latest script (memory_search kind "script") and plan one visual per scene plus a thumbnail.',
    "Generate the visuals with generate_image; they are saved to the media library and memory automatically.",
    "Refine images with transform_image when useful (e.g. remove_background or drop_shadow for product shots, smart_crop or generative_fill to fit another aspect ratio, upscale for thumbnails), passing the assetId you got back.",
    "Report each image URL and assetId with the scene it belongs to.",
  ].join("\n"),
  editor: [
    'Collect the script, voiceover (kind "voice"), and visuals (kind "media") from memory.',
    "Build the edit with build_video_timeline: one scene per script scene, matching audio and image URLs, durations, captions, transitions.",
    "Point out any scene that is missing audio or visuals.",
  ].join("\n"),
  publisher: [
    'Read the script and the video timeline (kind "video") from memory.',
    "Write an optimized title, description, and tags, then save them with prepare_publication, choosing the best publish time for the audience.",
    "When the plan says to publish or schedule it, do that on the user's connected account (list_connected_apps, find_app_tools, run_app_tool or schedule_app_tool); if the platform isn't connected, call request_connection.",
  ].join("\n"),
  custom: "Use shared memory to read context from other agents. Save deliverables with save_artifact; use memory_save only for notes other agents need.",
};

/** Rules for a step of a headquarters plan, where agents pass work to each other through shared memory. */
const TEAM_RULES = [
  "You are working on one step of a plan from headquarters, together with other agents.",
  "Shared memory is the only way agents pass work to each other. Always save your final deliverable.",
].join("\n");

/**
 * Rules for a direct chat with the user. There is no shared memory here: the agent answers what was asked and
 * only produces deliverables on an explicit request, so a greeting never starts a run of tool calls.
 */
const CHAT_RULES = [
  "This is a direct chat with the user, not part of a headquarters plan. You have no shared memory here; the conversation so far and the city's saved artifacts (list_artifacts, read_artifact) are your context.",
  "Respond to the user's latest message and nothing more. Greetings, small talk, and questions get a short, friendly text answer with no tool calls.",
  "Only use tools (generating images, audio, research, saving artifacts) when the user clearly asks you to make or change something. If a request is vague, ask one short question instead of guessing.",
  "Don't continue or redo work from earlier in the conversation unless the user asks for it.",
].join("\n");

const COMMON_RULES = [
  "You work inside Creator City: a headquarters orchestrates specialist agents, each in its own building.",
  "Artifacts: every finished text deliverable (script, topic or idea list, research brief, outline, captions, post copy) goes through save_artifact, which also shares it in memory. Images, voiceovers, video timelines, and publishing packages from your tools are saved as artifacts automatically. Answers to simple questions or chit-chat are not artifacts.",
  "The user sees each artifact as a preview card under your reply, so don't paste a saved deliverable again in full: name it and summarize the highlights.",
  "When you are doing real work, call report_progress as you start each new phase, with an honest percentage.",
  "Write answers in Markdown (short headings, bullet lists, bold for key points). After real work, finish with what you produced, anything left open, and a suggested next step.",
  "Never invent sources, URLs, or results. If a tool fails, say so.",
].join("\n");

export const reportProgressTool = tool({
  name: "report_progress",
  description: "Update the progress bar and status line shown on your building in the city.",
  parameters: z.object({
    percent: z.number().int().min(0).max(99).describe("How much of your task is done."),
    activity: z.string().min(1).max(120).describe('What you are doing now, e.g. "Comparing sources".'),
  }),
  execute: async ({ percent, activity }, runContext) => {
    await (runContext?.context as CityRunContext | undefined)?.report({ progress: percent, activity });
    return "Progress updated.";
  },
});

export function modelSettingsFor(effort: AgentRecord["settings"]["reasoningEffort"], { computer = false } = {}): ModelSettings | undefined {
  const settings: ModelSettings = {};
  if (effort) settings.reasoning = { effort };
  // The cloud computer has one browser tab: agents with it call tools one at a time (no parallel browser searches).
  if (computer) settings.parallelToolCalls = false;
  return Object.keys(settings).length ? settings : undefined;
}

export function toolsFor(record: AgentRecord, memory: MemoryConnection | null): Tool<CityRunContext>[] {
  const tools: Tool<CityRunContext>[] = [
    reportProgressTool, saveArtifactTool, listArtifactsTool, readArtifactTool as Tool<CityRunContext>,
    askUserTool as Tool<CityRunContext>, confirmActionTool as Tool<CityRunContext>,
    // Connected apps (Composio): every agent can look; each account's Accounts-page settings decide who may use it.
    ...appTools,
  ];
  for (const key of record.tools) {
    if (key === "memory" && memory) tools.push(...memory.tools);
    // Hosted web search needs OpenAI's Responses API; on Anthropic, agents with the computer tool browse instead.
    if (key === "web_search" && aiProvider() === "openai") tools.push(webSearchTool());
    if (key === "computer") tools.push(...(computerTools as Tool<CityRunContext>[]));
    if (key === "voiceover") tools.push(voiceoverTool);
    if (key === "image") tools.push(imageTool);
    if (key === "image_edit") tools.push(transformImageTool);
    if (key === "video_timeline") tools.push(videoTimelineTool);
    if (key === "publish_schedule") tools.push(publishScheduleTool);
  }
  return tools;
}

/**
 * `memory` is only passed for team work (a step of a headquarters plan); a direct chat gets null and chat rules
 * instead of the memory-driven role playbook.
 */
export function buildCityAgent(record: AgentRecord, headquartersName: string, memory: MemoryConnection | null, { team, appsNote = null, timeZone = null }: {
  team: boolean;
  /** Which connected apps this agent can use right now (appsNoteFor), so it knows what's missing before it starts. */
  appsNote?: string | null;
  /** The headquarters' time zone for the date note (null: the server's). */
  timeZone?: string | null;
}): Agent<CityRunContext> {
  const hasMemory = record.tools.includes("memory") && memory;
  const instructions = [
    `You are ${record.name}, an AI agent of the "${headquartersName}" headquarters.`,
    dateRules(new Date(), resolveTimeZone(timeZone)),
    record.instructions,
    team
      ? [TEAM_RULES, hasMemory ? ROLE_PLAYBOOK[record.role] : "You have no shared memory tools; save your deliverable with save_artifact so the user and other agents can use it."].join("\n\n")
      : CHAT_RULES,
    COMMON_RULES,
    ARTIFACT_RULES,
    record.tools.includes("computer") ? COMPUTER_RULES : null,
    `Turn budget: you have at most ${record.settings.maxTurns} turns (model responses) for this run, and the run is cut off when they run out. Plan the shortest path and batch steps. If the task can't be finished within the budget, save what you have and stop with a clear summary of what is done and what is left, instead of running out mid-task.`,
    [APP_RULES, appsNote].filter(Boolean).join("\n"),
    ASK_RULES,
  ].filter(Boolean).join("\n\n");

  return new Agent<CityRunContext>({
    name: record.name,
    instructions,
    ...((model) => (model ? { model } : {}))(agentModel(record.model)),
    ...((settings) => (settings ? { modelSettings: settings } : {}))(modelSettingsFor(record.settings.reasoningEffort, { computer: record.tools.includes("computer") })),
    tools: toolsFor(record, memory),
    mcpServers: hasMemory ? memory.mcpServers : [],
  });
}
