"use server";

import { getCurrentUser } from "@/lib/auth/session";
import type { CityStats } from "@/lib/city-stats";
import { findHeadquarters } from "@/lib/headquarters";
import { cityStats } from "@/lib/stats";

/**
 * Fresh overview numbers for the signed-in user's city. Platform numbers older than 30 minutes are read again;
 * `force` (the refresh button) re-reads them all.
 */
export async function refreshCityStatsAction(options: { force?: boolean } = {}): Promise<{ ok: true; stats: CityStats } | { ok: false; error: string }> {
  try {
    const user = await getCurrentUser();
    const hq = user ? await findHeadquarters(user.email) : null;
    if (!hq) return { ok: false, error: "Your session has ended. Sign in again to continue." };
    return { ok: true, stats: await cityStats(hq, { refreshAudience: true, force: options.force === true }) };
  } catch (error) {
    console.error("[stats]", error);
    return { ok: false, error: "We couldn't refresh the numbers." };
  }
}
