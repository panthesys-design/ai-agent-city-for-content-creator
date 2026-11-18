// Server-only configuration for the agent runtime. Every secret here stays on the server.
import { setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from "@openai/agents";
import OpenAI from "openai";

const trimSlash = (url: string) => url.replace(/\/$/, "");

/**
 * LLM provider for agent runs: AI_PROVIDER=anthropic runs agents on Claude through Anthropic's OpenAI-compatible
 * endpoint (Chat Completions); anything else uses OpenAI. Voiceover and OpenAI image generation always use OpenAI.
 */
export const aiProvider = (): "openai" | "anthropic" => (process.env.AI_PROVIDER?.toLowerCase() === "anthropic" ? "anthropic" : "openai");
const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5-5";
const isClaudeModel = (model: string) => model.startsWith("claude-");

let configured: "openai" | "anthropic" | null = null;

/** Checks the provider's API key and points the Agents SDK at that provider. Call before every run. */
export function configureAgentProvider() {
  const provider = aiProvider();
  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY must be set in .env.local to run agents with AI_PROVIDER=anthropic.");
  } else if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY must be set in .env.local to run agents.");
  }
  if (configured === provider) return;
  if (provider === "anthropic") {
    setDefaultOpenAIClient(new OpenAI({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com/v1/" }));
    // Anthropic's compatibility layer speaks Chat Completions only, and traces would be exported to OpenAI.
    setOpenAIAPI("chat_completions");
    setTracingDisabled(true);
  }
  configured = provider;
}

/**
 * Model for an agent run. An agent's saved model is used when it belongs to the active provider; otherwise the
 * provider default: ANTHROPIC_MODEL (default claude-sonnet-5-5) for Anthropic, OPENAI_DEFAULT_MODEL / SDK default for OpenAI.
 */
export function agentModel(saved?: string | null): string | undefined {
  if (aiProvider() === "anthropic") return saved && isClaudeModel(saved) ? saved : process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL;
  return saved && !isClaudeModel(saved) ? saved : undefined;
}

/** Headquarters (orchestrator) model: ANTHROPIC_ORCHESTRATOR_MODEL / OPENAI_ORCHESTRATOR_MODEL, else the provider default. */
export const orchestratorModel = () =>
  agentModel(aiProvider() === "anthropic" ? process.env.ANTHROPIC_ORCHESTRATOR_MODEL : process.env.OPENAI_ORCHESTRATOR_MODEL);
export const ttsModel = () => process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
export const imageModel = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

/** Strapi's MCP endpoint (Strapi 5 serves it at /mcp when `server.mcp.enabled`). Null disables MCP memory. */
export function strapiMcpConfig(): { url: string; token: string } | null {
  const url = process.env.STRAPI_URL;
  const token = process.env.STRAPI_MCP_TOKEN;
  return url && token ? { url: `${trimSlash(url)}/mcp`, token } : null;
}

export function memoryScopeSecret(): string {
  const secret = process.env.MEMORY_SCOPE_SECRET;
  if (!secret || secret.length < 32) throw new Error("MEMORY_SCOPE_SECRET must be set (32+ characters, same value as in Strapi).");
  return secret;
}

/** Public base URL that CloudHike workers can reach. Jobs are only used when it is not a local address. */
export function publicAppUrl(): string | null {
  const url = process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!url) return null;
  try {
    const { hostname, protocol } = new URL(url);
    const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname.endsWith(".local")
      || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(hostname);
    return local || !protocol.startsWith("http") ? null : trimSlash(url);
  } catch {
    return null;
  }
}

export function jobsConfig(): { apiUrl: string; apiKey: string; appUrl: string; timeoutSeconds: number } | null {
  const apiUrl = process.env.JOBS_API_URL;
  const apiKey = process.env.JOBS_API_KEY;
  const appUrl = publicAppUrl();
  if (!apiUrl || !apiKey || !appUrl || process.env.AGENT_RUNNER === "inline") return null;
  const timeoutSeconds = Math.min(3600, Math.max(30, Number(process.env.JOBS_TIMEOUT_SECONDS) || 300));
  return { apiUrl: trimSlash(apiUrl), apiKey, appUrl, timeoutSeconds };
}

/**
 * ImageKit (the storage behind Strapi's media library) for AI image generation and transformation.
 * `privateKey` is optional: with it, every ImageKit URL this server requests is signed, which is required when
 * "Restrict unsigned URLs" is on in ImageKit. Null when IMAGEKIT_URL_ENDPOINT is not set.
 */
export function imagekitConfig(): { urlEndpoint: string; privateKey: string | null } | null {
  const urlEndpoint = process.env.IMAGEKIT_URL_ENDPOINT;
  if (!urlEndpoint) return null;
  return { urlEndpoint: trimSlash(urlEndpoint), privateKey: process.env.IMAGEKIT_PRIVATE_KEY || null };
}

/** Text-to-image provider: ImageKit when configured (or IMAGE_PROVIDER=imagekit), else OpenAI. */
export function imageProvider(): "imagekit" | "openai" {
  const forced = process.env.IMAGE_PROVIDER;
  if (forced === "openai" || forced === "imagekit") return forced;
  return imagekitConfig() ? "imagekit" : "openai";
}

/** Public base for files Strapi serves (`/uploads/...`). */
export const strapiPublicUrl = () => trimSlash(process.env.STRAPI_PUBLIC_URL || process.env.STRAPI_URL || "");
