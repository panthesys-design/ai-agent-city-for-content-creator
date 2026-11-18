"use server";

import type { ArtifactRecord } from "@/lib/artifact-records";
import { deleteOwnedArtifact, findOwnedArtifact } from "@/lib/artifacts";
import { getCurrentUser } from "@/lib/auth/session";
import { findHeadquarters } from "@/lib/headquarters";

// Artifact actions for the Artifacts page and chat previews. Every action re-checks the session and only reaches
// artifacts of the caller's own headquarters.

type Fail = { ok: false; error: string };
const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
const GONE = "This artifact no longer exists.";
const isDocumentId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{8,64}$/i.test(value);

async function currentHeadquarters() {
  const user = await getCurrentUser();
  return user ? findHeadquarters(user.email) : null;
}

/** One artifact with its full content (document text, timeline scenes…), for previews. */
export async function getArtifactAction(artifactId: string): Promise<{ ok: true; artifact: ArtifactRecord } | Fail> {
  try {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const artifact = isDocumentId(artifactId) ? await findOwnedArtifact(hq, artifactId) : null;
    return artifact ? { ok: true, artifact } : { ok: false, error: GONE };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "We couldn't open this artifact. Please try again." };
  }
}

/** Removes an artifact from the Artifacts page. Its file stays in the media library and its memory stays shared. */
export async function deleteArtifactAction(artifactId: string): Promise<{ ok: true } | Fail> {
  try {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    if (!isDocumentId(artifactId) || !(await deleteOwnedArtifact(hq, artifactId))) return { ok: false, error: GONE };
    return { ok: true };
  } catch (error) {
    console.error(error);
    return { ok: false, error: "We couldn't delete this artifact. Please try again." };
  }
}
