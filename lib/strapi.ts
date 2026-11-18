import { randomBytes } from "node:crypto";

// Server-only helpers for Strapi CMS: the users collection (plugin::users-permissions.user) and the shared REST client.
// Credentials live in CloudHike; Strapi keeps a profile record for each user.

export type StrapiUser = { id: number; documentId: string; username: string; email: string };

function config() {
  const url = process.env.STRAPI_URL;
  const token = process.env.STRAPI_API_TOKEN;
  if (!url || !token) {
    throw new Error("STRAPI_URL and STRAPI_API_TOKEN must be set in .env.local.");
  }
  return { url: url.replace(/\/$/, ""), token };
}

/** Authenticated JSON request to Strapi's REST API (`/api` + path). Throws with Strapi's message on failure. */
export async function strapi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, token } = config();
  const res = await fetch(`${url}/api${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(`Strapi ${init.method ?? "GET"} ${path} failed (${res.status}): ${body?.error?.message ?? res.statusText}`);
  }
  if (res.status === 204) return undefined as T; // DELETE responds without a body
  return (await res.json()) as T;
}

type StrapiRole = { id: number; type: string };

// Strapi 5's REST create requires an explicit role; use the default "Authenticated" role.
let authenticatedRoleId: Promise<number> | null = null;

function getAuthenticatedRoleId() {
  authenticatedRoleId ??= strapi<{ roles: StrapiRole[] }>("/users-permissions/roles")
    .then(({ roles }) => {
      const role = roles.find((r) => r.type === "authenticated");
      if (!role) throw new Error('Strapi has no "authenticated" users-permissions role.');
      return role.id;
    })
    .catch((error) => {
      authenticatedRoleId = null; // retry on the next request instead of caching the failure
      throw error;
    });
  return authenticatedRoleId;
}

/**
 * Makes sure the user has a record in Strapi's Users collection, creating one on first sign-up
 * (or first Google sign-in). Safe to call on every sign-in.
 */
export async function ensureStrapiUser(email: string): Promise<StrapiUser> {
  const normalized = email.trim().toLowerCase();
  const query = new URLSearchParams({ "filters[email][$eqi]": normalized });
  const [existing] = await strapi<StrapiUser[]>(`/users?${query}`);
  if (existing) return existing;

  return strapi<StrapiUser>("/users", {
    method: "POST",
    body: JSON.stringify({
      username: normalized,
      email: normalized,
      // Strapi requires a password, but sign-in goes through CloudHike, so store an unusable random one.
      password: randomBytes(32).toString("base64url"),
      confirmed: true,
      blocked: false,
      role: await getAuthenticatedRoleId(),
    }),
  });
}
