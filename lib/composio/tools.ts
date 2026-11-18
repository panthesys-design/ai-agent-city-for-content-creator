import { toolEffect, type ToolEffect } from "@/lib/connection-records";
import { composio, composioError } from "./client";

// Server-only: Composio tool discovery and execution for agents. Agents never get Composio's tools wholesale (one app
// alone has dozens, too many for a model's context); they search a connected app's tools, read one tool's inputs,
// and run it through app-tools.ts, which checks the connection and the user's permissions first.

export type AppTool = {
  slug: string;
  toolkit: string;
  name: string;
  description: string;
  effect: ToolEffect;
  version: string | null;
  /** JSON Schema of the inputs. */
  input: Record<string, unknown>;
};

type RawTool = {
  slug: string; name?: string; description?: string; tags?: string[]; version?: string; isDeprecated?: boolean;
  toolkit?: { slug?: string }; inputParameters?: Record<string, unknown>;
};

const TOOL_TTL_MS = 10 * 60 * 1000;
const toolCache = new Map<string, { at: number; tool: AppTool }>();

const fromRaw = (raw: RawTool): AppTool => ({
  slug: raw.slug,
  toolkit: raw.toolkit?.slug ?? raw.slug.split("_")[0].toLowerCase(),
  name: raw.name ?? raw.slug,
  description: (raw.description ?? "").replace(/\s+/g, " ").trim(),
  effect: toolEffect(raw.tags),
  version: raw.version ?? null,
  input: raw.inputParameters ?? { type: "object", properties: {} },
});

function remember(tool: AppTool) {
  toolCache.set(tool.slug, { at: Date.now(), tool });
  return tool;
}

/** One tool's details, or null when Composio has no such tool. */
export async function getAppTool(slug: string): Promise<AppTool | null> {
  const cached = toolCache.get(slug);
  if (cached && Date.now() - cached.at < TOOL_TTL_MS) return cached.tool;
  try {
    const raw = await composio().tools.getRawComposioToolBySlug(slug) as unknown as RawTool;
    return raw?.slug ? remember(fromRaw(raw)) : null;
  } catch (error) {
    if (/404|not found/i.test(error instanceof Error ? error.message : "")) return null;
    throw new Error(composioError(error));
  }
}

/** A connected app's tools matching what the agent wants to do (or its most important tools without a query). */
export async function searchAppTools(toolkit: string, query: string | null, limit = 8): Promise<AppTool[]> {
  const fetchTools = async (params: Parameters<ReturnType<typeof composio>["tools"]["getRawComposioTools"]>[0]) =>
    (await composio().tools.getRawComposioTools(params) as unknown as RawTool[]).filter((t) => t?.slug && !t.isDeprecated);
  const important = () => fetchTools({ toolkits: [toolkit], important: true, limit: 20 });
  let raw = query ? await fetchTools({ toolkits: [toolkit], search: query.slice(0, 120), limit }) : await important();
  // Composio's search can miss the main tool for a long phrase; fill thin results with the app's important tools,
  // putting the ones whose names share words with the query first.
  if (query && raw.length < Math.min(4, limit)) {
    const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const extra = (await important())
      .filter((t) => !raw.some((r) => r.slug === t.slug))
      .map((t) => ({ t, hits: words.filter((w) => `${t.slug} ${t.name ?? ""}`.toLowerCase().includes(w)).length }))
      .sort((a, b) => b.hits - a.hits)
      .map(({ t }) => t);
    raw = [...raw, ...extra];
  }
  return raw.slice(0, limit).map((t) => remember(fromRaw(t)));
}

/** Compact JSON Schema for the model: property names, types, descriptions, enums, and what is required. */
export function compactSchema(schema: Record<string, unknown>, depth = 0): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const key of ["type", "description", "enum", "default", "format", "required", "examples"]) {
    if (schema[key] === undefined) continue;
    out[key] = key === "description" && typeof schema[key] === "string" ? (schema[key] as string).slice(0, 300) : schema[key];
  }
  if (depth < 3 && schema.properties && typeof schema.properties === "object") {
    out.properties = Object.fromEntries(Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [k, compactSchema(v, depth + 1)]));
  }
  if (depth < 3 && schema.items && typeof schema.items === "object") out.items = compactSchema(schema.items as Record<string, unknown>, depth + 1);
  for (const key of ["anyOf", "oneOf"]) {
    if (depth < 3 && Array.isArray(schema[key])) out[key] = (schema[key] as Record<string, unknown>[]).slice(0, 4).map((s) => compactSchema(s, depth + 1));
  }
  return out;
}

export type ExecuteResult = { successful: boolean; data: unknown; error: string | null };

/** Runs a tool as one of the user's connected accounts. Callers must have checked access and approval already. */
export async function executeAppTool(tool: AppTool, connection: { composioUserId: string; composioAccountId: string }, args: Record<string, unknown>, signal?: AbortSignal): Promise<ExecuteResult> {
  try {
    const result = await composio().tools.execute(tool.slug, {
      userId: connection.composioUserId,
      connectedAccountId: connection.composioAccountId,
      arguments: args,
      // Pin the version we just showed the model, so its inputs match the schema it read.
      ...(tool.version ? { version: tool.version } : { dangerouslySkipVersionCheck: true }),
    }, signal ? { signal } as never : undefined) as unknown as { successful?: boolean; data?: unknown; error?: string | null };
    return { successful: result.successful !== false && !result.error, data: result.data ?? null, error: result.error ?? null };
  } catch (error) {
    return { successful: false, data: null, error: composioError(error) };
  }
}
