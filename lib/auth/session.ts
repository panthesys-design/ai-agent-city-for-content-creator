import { cookies } from "next/headers";
import { cache } from "react";
import { getSessionUser, signOutSession, type AuthUser } from "./cloudhike";

const SESSION_COOKIE = "cc_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days; CloudHike remains the source of truth via get-session.

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Revokes the session with CloudHike (best effort) and always clears the local cookie. */
export async function clearSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await signOutSession(token);
    } catch (error) {
      console.error("CloudHike sign-out failed; clearing the local session anyway.", error);
    }
  }
  store.delete(SESSION_COOKIE);
}

/** The current user from the HTTP-only session cookie, validated against CloudHike once per request. */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(token);
});
