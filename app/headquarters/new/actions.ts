"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createHeadquarters, findHeadquarters, parseHeadquartersForm } from "@/lib/headquarters";
import { timeZoneFrom } from "@/lib/workspace-settings";

/** `savedAt` is set by the Settings page's edit action after a save, so the form can confirm it. */
export type HeadquartersFormState = { error?: string; savedAt?: number };

export async function createHeadquartersAction(
  _prev: HeadquartersFormState,
  formData: FormData,
): Promise<HeadquartersFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const parsed = parseHeadquartersForm(formData);
  if ("error" in parsed) return parsed;

  try {
    // A double submit or a second tab must not create a second headquarters.
    if (!(await findHeadquarters(user.email))) {
      // The browser's zone (a hidden field) is where "today" starts; it can be changed on the Settings page.
      await createHeadquarters(user.email, parsed.input, { timeZone: timeZoneFrom(formData.get("timeZone")) });
    }
  } catch (error) {
    console.error(error);
    return { error: "We couldn't save your headquarters. Please try again." };
  }

  redirect("/dashboard");
}
