import { MCPServerStreamableHttp, createMCPToolStaticFilter, tool, type MCPServer, type Tool } from "@openai/agents";
import { z } from "zod";
import { strapi } from "@/lib/strapi";
import { strapiMcpConfig } from "./env";
import { SCOPE_HEADER, signMemoryScope, type MemoryScope } from "./memory-scope";
import type { CityRunContext } from "./context";

// Shared, persistent agent memory in Strapi's `memories` collection, scoped to one headquarters.
//
// Primary path: Strapi's MCP server (custom `memory_*` tools registered in the Strapi project). The connection
// carries a server-signed headquarters scope header, and only the four memory tools are exposed to the model,
// never Strapi's generic content-manager tools.
// Fallback: if MCP is not configured or unreachable, equivalent function tools call Strapi's REST API with the
// headquarters filter applied on this server. Either way, the model cannot pick another headquarters.

export const MEMORY_TOOL_NAMES = ["memory_save", "memory_search", "memory_get", "memory_update"] as const;
export const memoryKinds = ["research", "script", "voice", "media", "video", "publish", "context", "note"] as const;
export type MemoryKind = (typeof memoryKinds)[number];

export type MemoryConnection = { tools: Tool<CityRunContext>[]; mcpServers: MCPServer[]; close: () => Promise<void> };

const connect = (documentId: string) => ({ connect: [documentId] });
const excerpt = (text: string, n = 280) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** Saves a memory directly (used by server-side tools such as voiceover and image generation). */
export async function saveMemory(scope: MemoryScope, memory: { kind: MemoryKind; title: string; content: string; data?: unknown; tags?: string[] }) {
  const { data } = await strapi<{ data: { documentId: string } }>("/memories", {
    method: "POST",
    body: JSON.stringify({
      data: {
        kind: memory.kind, title: memory.title.slice(0, 160), content: memory.content, data: memory.data ?? null, tags: memory.tags ?? [],
        headquarter: connect(scope.hq),
        ...(scope.agent ? { agent: connect(scope.agent) } : {}),
        ...(scope.task ? { task: connect(scope.task) } : {}),
      },
    }),
  });
  return data.documentId;
}

type MemoryRow = { documentId: string; kind: string; title: string; content: string; data?: unknown; updatedAt?: string; agent?: { name?: string } | null };

async function findScoped(scope: MemoryScope, documentId: string): Promise<MemoryRow | null> {
  const query = new URLSearchParams({
    "filters[documentId][$eq]": documentId,
    "filters[headquarter][documentId][$eq]": scope.hq,
    "populate[agent][fields][0]": "name",
    "pagination[pageSize]": "1",
  });
  const { data } = await strapi<{ data: MemoryRow[] }>(`/memories?${query}`);
  return data[0] ?? null;
}

/** REST-backed memory tools with the same names and behavior as the Strapi MCP tools. */
function restMemoryTools(scope: MemoryScope): Tool<CityRunContext>[] {
  return [
    tool({
      name: "memory_save",
      description: "Save findings, scripts, asset references, or project context to the shared memory of your headquarters so other agents can use them later.",
      parameters: z.object({
        kind: z.enum(memoryKinds),
        title: z.string().min(1).max(160),
        content: z.string().min(1).max(60_000),
        tags: z.array(z.string().max(40)).max(12).nullable(),
      }),
      execute: async ({ kind, title, content, tags }) => {
        const id = await saveMemory(scope, { kind, title, content, tags: tags ?? [] });
        return `Saved memory "${title}" (${id}).`;
      },
    }),
    tool({
      name: "memory_search",
      description: "Search the shared memory of your headquarters, newest first. Returns excerpts; use memory_get for the full content.",
      parameters: z.object({
        query: z.string().max(200).nullable().describe("Words to look for; null for the most recent memories."),
        kind: z.enum(memoryKinds).nullable(),
        agentName: z.string().max(64).nullable().describe('Only memories saved by an agent whose name contains this, e.g. "Research".'),
        limit: z.number().int().min(1).max(25).nullable(),
      }),
      execute: async ({ query, kind, agentName, limit }) => {
        const params = new URLSearchParams({
          "filters[$and][0][headquarter][documentId][$eq]": scope.hq,
          "populate[agent][fields][0]": "name",
          "sort[0]": "updatedAt:desc",
          "pagination[pageSize]": String(limit ?? 8),
        });
        let i = 1;
        if (kind) params.set(`filters[$and][${i++}][kind][$eq]`, kind);
        if (agentName) params.set(`filters[$and][${i++}][agent][name][$containsi]`, agentName);
        for (const word of (query ?? "").split(/\s+/).filter(Boolean).slice(0, 6)) {
          params.set(`filters[$and][${i}][$or][0][title][$containsi]`, word);
          params.set(`filters[$and][${i++}][$or][1][content][$containsi]`, word);
        }
        const { data } = await strapi<{ data: MemoryRow[] }>(`/memories?${params}`);
        if (!data.length) return "No matching memories.";
        return data.map((m) => `- [${m.kind}] ${m.title} (${m.documentId})${m.agent?.name ? ` by ${m.agent.name}` : ""}: ${excerpt(m.content ?? "")}`).join("\n");
      },
    }),
    tool({
      name: "memory_get",
      description: "Read the full content of one memory from your headquarters.",
      parameters: z.object({ documentId: z.string().regex(/^[A-Za-z0-9]{8,64}$/) }),
      execute: async ({ documentId }) => {
        const row = await findScoped(scope, documentId);
        if (!row) return "No memory with that id in this headquarters.";
        const data = row.data ? `\n\nData: ${JSON.stringify(row.data)}` : "";
        return `# ${row.title} [${row.kind}]${row.agent?.name ? ` by ${row.agent.name}` : ""}\n\n${row.content}${data}`;
      },
    }),
    tool({
      name: "memory_update",
      description: "Revise an existing memory of your headquarters, e.g. to refine the shared project context or fix a script.",
      parameters: z.object({
        documentId: z.string().regex(/^[A-Za-z0-9]{8,64}$/),
        title: z.string().min(1).max(160).nullable(),
        content: z.string().min(1).max(60_000).nullable(),
      }),
      execute: async ({ documentId, title, content }) => {
        const row = await findScoped(scope, documentId);
        if (!row) return "No memory with that id in this headquarters.";
        const changes = { ...(title ? { title } : {}), ...(content ? { content } : {}) };
        if (!Object.keys(changes).length) return "Nothing to update.";
        await strapi(`/memories/${row.documentId}`, { method: "PUT", body: JSON.stringify({ data: changes }) });
        return `Updated memory "${title ?? row.title}".`;
      },
    }),
  ];
}

/**
 * Opens memory for one agent run. Prefers Strapi MCP; falls back to REST tools when MCP is not configured or
 * the connection fails. Always call `close()` when the run ends.
 */
export async function openMemory(scope: MemoryScope): Promise<MemoryConnection> {
  const mcp = strapiMcpConfig();
  if (mcp) {
    const server = new MCPServerStreamableHttp({
      url: mcp.url,
      name: "strapi_memory",
      cacheToolsList: true,
      toolFilter: createMCPToolStaticFilter({ allowed: [...MEMORY_TOOL_NAMES] }),
      requestInit: { headers: { authorization: `Bearer ${mcp.token}`, [SCOPE_HEADER]: signMemoryScope(scope) } },
      timeout: 30_000,
    });
    try {
      await server.connect();
      const names = new Set((await server.listTools()).map((t) => t.name));
      if (!MEMORY_TOOL_NAMES.every((name) => names.has(name))) throw new Error("Strapi MCP does not expose the memory_* tools.");
      return { tools: [], mcpServers: [server], close: () => server.close().catch(() => undefined) };
    } catch (error) {
      console.warn("[memory] Strapi MCP unavailable, using REST memory tools instead:", error instanceof Error ? error.message : error);
      await server.close().catch(() => undefined);
    }
  }
  return { tools: restMemoryTools(scope), mcpServers: [], close: async () => undefined };
}
