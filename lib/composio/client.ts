import { Composio } from "@composio/core";

// Server-only Composio client (https://docs.composio.dev). COMPOSIO_API_KEY never leaves the server: the browser only
// gets Composio's hosted sign-in link for one connection, and agents reach connected accounts through our own tools.

let client: Composio | null = null;

export const composioConfigured = () => Boolean(process.env.COMPOSIO_API_KEY);

export function composio(): Composio {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) throw new Error("COMPOSIO_API_KEY must be set in .env.local to connect accounts.");
  return (client ??= new Composio({ apiKey }));
}

/**
 * Composio's user ID for a Creator City user: their Strapi profile's documentId. Every connection is made for this
 * ID, and every tool call passes it with the connection's own account ID, so one user's accounts never serve another.
 */
export const composioUserIdFor = (strapiUserDocumentId: string) => `cc-user-${strapiUserDocumentId}`;

/** Short, readable message for a Composio error (never includes credentials). */
export function composioError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.replace(/\s+/g, " ").trim();
    if (/401|unauthori[sz]ed|invalid api key/i.test(message)) return "Composio rejected the request. Check COMPOSIO_API_KEY.";
    return message.slice(0, 300) || "Composio request failed.";
  }
  return "Composio request failed.";
}
