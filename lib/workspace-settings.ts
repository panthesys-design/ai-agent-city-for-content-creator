import {
  DEFAULT_SETTINGS, MAX_TURNS_LIMIT, TIMEOUT_LIMIT_SECONDS, reasoningEfforts, type AgentSettings, type ReasoningEffort,
} from "./agent-config";

// Client-safe workspace settings stored on the Strapi headquarters record (see docs/headquarters.md):
// `timeZone`, `agentDefaults`, `publishingApproval`, and the owner's `displayName`. Parsing is shared by the
// Settings page's server actions and by the runtime, which reads stored values back through the `*From` helpers.

/** "ask": every post or change on a connected account needs the user's OK. "auto": each account's own setting decides. */
export const publishingApprovals = ["ask", "auto"] as const;
export type PublishingApproval = (typeof publishingApprovals)[number];

/** Model and execution settings every new agent starts with. `model` null uses the server default. */
export type AgentDefaults = AgentSettings & { model: string | null };

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = { model: null, ...DEFAULT_SETTINGS };
export const DISPLAY_NAME_MAX = 64;

const MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{1,63}$/i;

/** True for an IANA time zone name the runtime accepts, such as "Asia/Kolkata" or "UTC". */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The stored time zone, or null when none (or an invalid one) is saved. */
export const timeZoneFrom = (value: unknown): string | null => (isValidTimeZone(value) ? value : null);

/** The stored approval mode. Anything else, including a missing value, is the safe "ask". */
export const publishingApprovalFrom = (value: unknown): PublishingApproval => (value === "auto" ? "auto" : "ask");

function intIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const effortFrom = (value: unknown): ReasoningEffort | null =>
  typeof value === "string" && (reasoningEfforts as readonly string[]).includes(value) ? (value as ReasoningEffort) : null;

/** The stored new-agent defaults, with built-in defaults for anything missing or out of range. */
export function agentDefaultsFrom(raw: unknown): AgentDefaults {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    model: typeof input.model === "string" && MODEL_ID.test(input.model.trim()) ? input.model.trim() : null,
    reasoningEffort: effortFrom(input.reasoningEffort),
    maxTurns: intIn(input.maxTurns, 1, MAX_TURNS_LIMIT) ?? DEFAULT_SETTINGS.maxTurns,
    timeoutSeconds: intIn(input.timeoutSeconds, 30, TIMEOUT_LIMIT_SECONDS) ?? DEFAULT_SETTINGS.timeoutSeconds,
  };
}

export type WorkspaceInput = { timeZone: string; agentDefaults: AgentDefaults; publishingApproval: PublishingApproval };

/** Validates the Workspace form. Returns the input, or an error message for the first invalid field. */
export function parseWorkspaceForm(formData: FormData): { input: WorkspaceInput } | { error: string } {
  const timeZone = formData.get("timeZone");
  if (!isValidTimeZone(timeZone)) return { error: "Choose a time zone from the list." };

  const modelText = String(formData.get("model") ?? "").trim();
  if (modelText && !MODEL_ID.test(modelText)) return { error: "Enter a valid model ID, such as gpt-5.4-mini, or leave it empty for the server default." };

  const effortText = String(formData.get("reasoningEffort") ?? "");
  const reasoningEffort = effortText ? effortFrom(effortText) : null;
  if (effortText && !reasoningEffort) return { error: "Choose a reasoning effort." };

  const maxTurns = intIn(formData.get("maxTurns"), 1, MAX_TURNS_LIMIT);
  if (maxTurns === null) return { error: `Max turns must be a whole number from 1 to ${MAX_TURNS_LIMIT}.` };
  const timeoutSeconds = intIn(formData.get("timeoutSeconds"), 30, TIMEOUT_LIMIT_SECONDS);
  if (timeoutSeconds === null) return { error: `Time limit must be from 30 to ${TIMEOUT_LIMIT_SECONDS} seconds.` };

  const approval = formData.get("publishingApproval");
  if (approval !== "ask" && approval !== "auto") return { error: "Choose how agents publish." };

  return {
    input: {
      timeZone,
      agentDefaults: { model: modelText || null, reasoningEffort, maxTurns, timeoutSeconds },
      publishingApproval: approval,
    },
  };
}

/** Validates the Profile form. An empty name clears it, so the sign-in name is shown again. */
export function parseProfileForm(formData: FormData): { displayName: string | null } | { error: string } {
  const raw = formData.get("displayName");
  const displayName = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (displayName.length > DISPLAY_NAME_MAX) return { error: `Keep your name to ${DISPLAY_NAME_MAX} characters or fewer.` };
  return { displayName: displayName || null };
}

/** The phrase a user types to confirm deleting their headquarters: its name, compared without case or extra spaces. */
export function confirmsDeletion(typed: unknown, headquartersName: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return typeof typed === "string" && norm(typed) !== "" && norm(typed) === norm(headquartersName);
}
