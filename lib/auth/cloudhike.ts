// Server-only client for the CloudHike.dev Auth API.
// Docs: https://cloudhike.dev/docs/md/auth

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
};

type AuthResult = { token: string; user: AuthUser };

export class AuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AuthError";
  }
}

function config() {
  const url = process.env.AUTH_URL;
  const key = process.env.AUTH_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("AUTH_URL and AUTH_PUBLISHABLE_KEY must be set in .env.local.");
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { url, key } = config();
  const { token, headers, ...rest } = init;
  const res = await fetch(`${url}${path}`, {
    ...rest,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new AuthError(body?.message || `Auth request failed (${res.status}).`, res.status);
  }
  return (await res.json()) as T;
}

export function signUpWithEmail(name: string, email: string, password: string) {
  return request<AuthResult>("/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export function signInWithEmail(email: string, password: string) {
  return request<AuthResult>("/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** Returns the signed-in user for a token, or null when the token is missing, expired, or revoked. */
export async function getSessionUser(token: string): Promise<AuthUser | null> {
  try {
    const session = await request<{ user?: AuthUser } | null>("/get-session", { token });
    return session?.user ?? null;
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) return null;
    throw error;
  }
}

/** Revokes a session token with CloudHike. */
export async function signOutSession(token: string) {
  await request<unknown>("/sign-out", { method: "POST", token, body: "{}" });
}

/** Browser URL that starts Google sign-in and returns to `returnTo` with the token in the URL fragment. */
export function googleSignInUrl(returnTo: string) {
  return `${config().url}/social/google?to=${encodeURIComponent(returnTo)}`;
}
