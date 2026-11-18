import { createHmac } from "node:crypto";
import { memoryScopeSecret } from "./env";

// Signs the headquarters scope sent to Strapi's MCP memory tools in the `x-creator-city-scope` header.
// Must match `verifyScope` in the Strapi project (src/mcp/scope.ts). The model never sees this value.

export const SCOPE_HEADER = "x-creator-city-scope";

export type MemoryScope = { hq: string; agent?: string; task?: string };

export function signMemoryScope(scope: MemoryScope, ttlSeconds = 3900): string {
  const payload = Buffer.from(JSON.stringify({ ...scope, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const signature = createHmac("sha256", memoryScopeSecret()).update(`v1.${payload}`).digest("hex");
  return `v1.${payload}.${signature}`;
}
