// Client-safe AI configuration for city agents: role, model, tools, and execution settings.
// Stored on the agent's Strapi record (`role`, `model`, `tools`, `settings`, `enabled`).
// The runtime that turns this into an OpenAI Agents SDK agent lives in lib/ai/ (server only).

export const agentRoles = ["research", "script", "voice", "media", "editor", "publisher", "custom"] as const;
export type AgentRole = (typeof agentRoles)[number];

export const agentRoleLabels: Record<AgentRole, string> = {
  research: "Research",
  script: "Script writing",
  voice: "Voiceover",
  media: "Media & visuals",
  editor: "Video editing",
  publisher: "Publishing & scheduling",
  custom: "Custom",
};

/** Tools an agent can be given. `memory` is the headquarters' shared Strapi memory (via MCP); `computer` is the CloudHike cloud computer. */
export const agentToolKeys = ["memory", "web_search", "computer", "voiceover", "image", "image_edit", "video_timeline", "publish_schedule"] as const;
export type AgentToolKey = (typeof agentToolKeys)[number];

export const agentToolInfo: Record<AgentToolKey, { label: string; description: string }> = {
  memory: { label: "Shared memory", description: "Save and read research, scripts, and assets in your headquarters' memory." },
  web_search: { label: "Web search", description: "Search the web for current information and sources." },
  computer: { label: "Cloud computer", description: "A cloud desktop with Chrome, a terminal, and files: browse and use websites (with your sign-ins), extract data, run commands, and save files. Starts when needed and stops when done." },
  voiceover: { label: "Voiceover", description: "Turn a script into a narrated audio file." },
  image: { label: "Image generation", description: "Create thumbnails, scene images, and graphics with ImageKit AI." },
  image_edit: { label: "Image editing", description: "Remove or change backgrounds, edit, extend, upscale, retouch, and smart-crop images with ImageKit AI." },
  video_timeline: { label: "Video timeline", description: "Assemble voiceover and media into an edit timeline." },
  publish_schedule: { label: "Publishing plan", description: "Prepare titles, descriptions, tags, and a publish time." },
};

export const reasoningEfforts = ["none", "minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

export type AgentSettings = {
  /** Most model turns (reason → tool → observe) one run may take. */
  maxTurns: number;
  /** Reasoning effort for reasoning models; null uses the model default. */
  reasoningEffort: ReasoningEffort | null;
  /** Hard time limit for one run, in seconds. */
  timeoutSeconds: number;
};

export type AgentRuntimeConfig = {
  role: AgentRole;
  /** OpenAI model ID; null uses the server default (OPENAI_DEFAULT_MODEL or the SDK default). */
  model: string | null;
  tools: AgentToolKey[];
  settings: AgentSettings;
  /** Disabled agents cannot be chatted with or receive delegated work. */
  enabled: boolean;
};

export const MAX_TURNS_LIMIT = 150;
export const TIMEOUT_LIMIT_SECONDS = 3600;
export const DEFAULT_SETTINGS: AgentSettings = { maxTurns: 12, reasoningEffort: null, timeoutSeconds: 300 };

/** Suggestions for the model field; any valid OpenAI model ID is accepted. */
export const MODEL_SUGGESTIONS = ["claude-sonnet-5-5", "claude-opus-5-5", "gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-4.1"] as const;

export const roleDefaultTools: Record<AgentRole, AgentToolKey[]> = {
  research: ["memory", "web_search", "computer"],
  script: ["memory"],
  voice: ["memory", "voiceover"],
  media: ["memory", "image", "image_edit", "web_search"],
  editor: ["memory", "video_timeline"],
  publisher: ["memory", "publish_schedule", "computer"],
  custom: ["memory"],
};

/** Roles of the six starter agents, matched by their seeded name. */
export const starterRoles: Record<string, AgentRole> = {
  "Research Agent": "research",
  "Script Writer Agent": "script",
  "Voice Agent": "voice",
  "Media Agent": "media",
  "Video Editor Agent": "editor",
  "Publishing/Scheduler Agent": "publisher",
};

/** A new agent's config. `defaults` are the workspace's new-agent defaults (Settings page); omitted, the built-in ones. */
export function defaultRuntimeConfig(role: AgentRole, defaults?: AgentSettings & { model: string | null }): AgentRuntimeConfig {
  const { model, ...settings } = defaults ?? { model: null, ...DEFAULT_SETTINGS };
  return {
    role, model, tools: [...roleDefaultTools[role]], enabled: true,
    settings: { maxTurns: settings.maxTurns, reasoningEffort: settings.reasoningEffort, timeoutSeconds: settings.timeoutSeconds },
  };
}

const MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{1,63}$/i;

function oneOf<T extends string>(options: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Validates a runtime config from the browser. Returns the config, or an error message for the first invalid field. */
export function parseRuntimeConfig(raw: unknown): { config: AgentRuntimeConfig } | { error: string } {
  const input = (raw ?? {}) as Partial<Record<keyof AgentRuntimeConfig, unknown>>;
  const role = oneOf(agentRoles, input.role);
  if (!role) return { error: "Choose what this agent does." };

  const modelText = typeof input.model === "string" ? input.model.trim() : "";
  if (modelText && !MODEL_ID.test(modelText)) return { error: "Enter a valid model ID, such as gpt-5.4-mini, or leave it empty for the default." };

  if (!Array.isArray(input.tools)) return { error: "Choose the agent's tools." };
  const tools = [...new Set(input.tools.filter((t): t is AgentToolKey => oneOf(agentToolKeys, t) !== null))];

  const settings = (input.settings ?? {}) as Partial<Record<keyof AgentSettings, unknown>>;
  const maxTurns = clampInt(settings.maxTurns, 1, MAX_TURNS_LIMIT, NaN);
  if (!Number.isFinite(maxTurns)) return { error: `Max turns must be a number from 1 to ${MAX_TURNS_LIMIT}.` };
  const timeoutSeconds = clampInt(settings.timeoutSeconds, 30, TIMEOUT_LIMIT_SECONDS, NaN);
  if (!Number.isFinite(timeoutSeconds)) return { error: "Time limit must be a number of seconds." };
  const effort = settings.reasoningEffort === null || settings.reasoningEffort === "" || settings.reasoningEffort === undefined
    ? null : oneOf(reasoningEfforts, settings.reasoningEffort);
  if (effort === null && settings.reasoningEffort && settings.reasoningEffort !== "") return { error: "Choose a reasoning effort." };

  return {
    config: {
      role, model: modelText || null, tools,
      settings: { maxTurns, timeoutSeconds, reasoningEffort: effort },
      enabled: input.enabled !== false,
    },
  };
}

/** Normalises stored values, filling defaults for agents saved before AI settings existed. */
export function runtimeConfigFromRow(row: Record<string, unknown>, name: string): AgentRuntimeConfig {
  // A row without `tools` was saved before AI settings existed (its role is just the schema default),
  // so starter agents get their starter role and every legacy agent gets its role's default tools.
  const legacy = !Array.isArray(row.tools);
  const role = (legacy ? starterRoles[name] : undefined) ?? oneOf(agentRoles, row.role) ?? starterRoles[name] ?? "custom";
  const tools = legacy
    ? [...roleDefaultTools[role]]
    : [...new Set((row.tools as unknown[]).filter((t): t is AgentToolKey => oneOf(agentToolKeys, t) !== null))];
  const settings = (row.settings ?? {}) as Partial<Record<keyof AgentSettings, unknown>>;
  const model = typeof row.model === "string" && MODEL_ID.test(row.model.trim()) ? row.model.trim() : null;
  return {
    role,
    model,
    tools,
    settings: {
      maxTurns: clampInt(settings.maxTurns, 1, MAX_TURNS_LIMIT, DEFAULT_SETTINGS.maxTurns),
      timeoutSeconds: clampInt(settings.timeoutSeconds, 30, TIMEOUT_LIMIT_SECONDS, DEFAULT_SETTINGS.timeoutSeconds),
      reasoningEffort: oneOf(reasoningEfforts, settings.reasoningEffort),
    },
    enabled: row.enabled !== false,
  };
}
