"use server";

import { redirect } from "next/navigation";
import { AuthError, getSessionUser, signInWithEmail, signUpWithEmail, type AuthUser } from "@/lib/auth/cloudhike";
import { clearSession, setSessionCookie } from "@/lib/auth/session";
import { ensureStrapiUser } from "@/lib/strapi";

export type AuthFormState = {
  error?: string;
  fields?: { name?: string; email?: string };
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROFILE_ERROR = "Your account is ready, but we couldn't finish setting up your profile. Please try signing in again.";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function authMessage(error: unknown, fallback: string) {
  if (error instanceof AuthError) return error.message;
  console.error(error);
  return fallback;
}

/** Shared last step for every sign-in path: sync the Strapi profile, then store the session. */
async function completeSignIn(token: string, user: AuthUser) {
  await ensureStrapiUser(user.email);
  await setSessionCookie(token);
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = text(formData, "name");
  const email = text(formData, "email");
  const password = formData.get("password");
  const fields = { name, email };

  if (!name) return { error: "Enter your name.", fields };
  if (!EMAIL_PATTERN.test(email)) return { error: "Enter a valid email address.", fields };
  if (typeof password !== "string" || password.length < 8) {
    return { error: "Password must be at least 8 characters.", fields };
  }

  let result;
  try {
    result = await signUpWithEmail(name, email, password);
  } catch (error) {
    return { error: authMessage(error, "Sign up failed. Please try again."), fields };
  }

  try {
    await completeSignIn(result.token, result.user);
  } catch (error) {
    console.error(error);
    return { error: PROFILE_ERROR, fields };
  }

  redirect("/dashboard");
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = text(formData, "email");
  const password = formData.get("password");
  const fields = { email };

  if (!EMAIL_PATTERN.test(email)) return { error: "Enter a valid email address.", fields };
  if (typeof password !== "string" || !password) return { error: "Enter your password.", fields };

  let result;
  try {
    result = await signInWithEmail(email, password);
  } catch (error) {
    return { error: authMessage(error, "Sign in failed. Please try again."), fields };
  }

  try {
    await completeSignIn(result.token, result.user);
  } catch (error) {
    console.error(error);
    return { error: PROFILE_ERROR, fields };
  }

  redirect("/dashboard");
}

/** Finishes Google sign-in with the token CloudHike returned in the callback URL fragment. */
export async function completeGoogleSignIn(token: string): Promise<{ error: string }> {
  let user: AuthUser | null;
  try {
    user = token ? await getSessionUser(token) : null;
  } catch (error) {
    return { error: authMessage(error, "Google sign-in failed. Please try again.") };
  }
  if (!user) return { error: "Google sign-in expired or was not completed. Please try again." };

  try {
    await completeSignIn(token, user);
  } catch (error) {
    console.error(error);
    return { error: PROFILE_ERROR };
  }

  redirect("/dashboard");
}

export async function signOut() {
  await clearSession();
  redirect("/sign-in");
}
