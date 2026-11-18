import type { RunContext } from "@openai/agents";
import type { CityRunContext } from "./context";
import type { MemoryScope } from "./memory-scope";

// Helpers shared by the server-side function tools.

export function contextOf(runContext?: RunContext<CityRunContext>): CityRunContext {
  const context = runContext?.context;
  if (!context?.hq) throw new Error("Tool called outside a city run.");
  return context;
}

export const scopeOf = (c: CityRunContext): MemoryScope => ({
  hq: c.hq.documentId,
  ...(c.agentId ? { agent: c.agentId } : {}),
  ...(c.taskId ? { task: c.taskId } : {}),
});

export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "asset";
