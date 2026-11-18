import { redirect } from "next/navigation";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { findHeadquarters } from "@/lib/headquarters";

/**
 * The signed-in user and their headquarters, or a redirect to sign-in / onboarding.
 * Layouts don't re-render on client navigation, so every dashboard page calls this too;
 * `cache` keeps it to one CloudHike + Strapi lookup per request.
 */
export const requireDashboardAccess = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const headquarters = await findHeadquarters(user.email);
  if (!headquarters) redirect("/headquarters/new");
  return { user, headquarters };
});
