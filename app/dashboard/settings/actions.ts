"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { findHeadquarters, parseHeadquartersForm, updateHeadquarters } from "@/lib/headquarters";
import { AccountDisconnectError, clearSharedMemory, deleteHeadquartersAndData } from "@/lib/workspace-data";
import { confirmsDeletion, parseProfileForm, parseWorkspaceForm } from "@/lib/workspace-settings";
import type { HeadquartersFormState } from "../../headquarters/new/actions";

// Settings page actions. Each one re-checks the session and works only on the caller's own headquarters; form
// values are validated with the shared parsers (`lib/workspace-settings.ts`, `parseHeadquartersForm`).

/** `savedAt` changes on every successful save, so the form can show (and re-announce) its confirmation. */
export type SettingsState = { error?: string; savedAt?: number; message?: string };

const SIGNED_OUT = "Your session has ended. Sign in again to continue.";

async function currentHeadquarters() {
  const user = await getCurrentUser();
  return user ? findHeadquarters(user.email) : null;
}

/** Saves and refreshes the dashboard frame (the sidebar shows the headquarters and profile names). */
async function save(run: () => Promise<unknown>, failure: string): Promise<SettingsState> {
  try {
    await run();
  } catch (error) {
    console.error(error);
    return { error: failure };
  }
  revalidatePath("/dashboard", "layout");
  return { savedAt: Date.now() };
}

export async function saveWorkspaceAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const hq = await currentHeadquarters();
  if (!hq) return { error: SIGNED_OUT };
  const parsed = parseWorkspaceForm(formData);
  if ("error" in parsed) return parsed;
  return save(() => updateHeadquarters(hq.documentId, parsed.input), "We couldn't save your workspace settings. Please try again.");
}

export async function saveHeadquartersAction(_prev: HeadquartersFormState, formData: FormData): Promise<HeadquartersFormState> {
  const hq = await currentHeadquarters();
  if (!hq) return { error: SIGNED_OUT };
  const parsed = parseHeadquartersForm(formData);
  if ("error" in parsed) return parsed;
  return save(() => updateHeadquarters(hq.documentId, parsed.input), "We couldn't save your headquarters. Please try again.");
}

export async function saveProfileAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const hq = await currentHeadquarters();
  if (!hq) return { error: SIGNED_OUT };
  const parsed = parseProfileForm(formData);
  if ("error" in parsed) return parsed;
  return save(() => updateHeadquarters(hq.documentId, { displayName: parsed.displayName }), "We couldn't save your profile. Please try again.");
}

export async function clearMemoryAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const hq = await currentHeadquarters();
  if (!hq) return { error: SIGNED_OUT };
  if (formData.get("confirm") !== "clear") return { error: "Confirm that you want to clear shared memory." };
  try {
    const count = await clearSharedMemory(hq);
    return { savedAt: Date.now(), message: count ? `Cleared ${count} ${count === 1 ? "memory" : "memories"}.` : "Shared memory was already empty." };
  } catch (error) {
    console.error(error);
    return { error: "We couldn't clear shared memory. Some entries may remain; please try again." };
  }
}

export async function deleteHeadquartersAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const hq = await currentHeadquarters();
  if (!hq) return { error: SIGNED_OUT };
  if (!confirmsDeletion(formData.get("confirmName"), hq.name)) return { error: `Type “${hq.name}” to confirm.` };
  try {
    await deleteHeadquartersAndData(hq);
  } catch (error) {
    console.error(error);
    return {
      error: error instanceof AccountDisconnectError
        ? "We couldn't disconnect one of your accounts, so nothing else was deleted. Try again, or disconnect it on the Accounts page first."
        : "We couldn't finish deleting your headquarters. Try again to remove what's left.",
    };
  }
  revalidatePath("/", "layout");
  redirect("/headquarters/new");
}
