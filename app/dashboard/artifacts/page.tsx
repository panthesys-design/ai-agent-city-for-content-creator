import type { Metadata } from "next";
import type { ArtifactSummary } from "@/lib/artifact-records";
import { listArtifacts } from "@/lib/artifacts";
import { listAgents } from "@/lib/agents";
import { requireDashboardAccess } from "../access";
import { ArtifactExplorer, type ExplorerAgent } from "./artifact-explorer";

export const metadata: Metadata = { title: "Artifacts — Creator City" };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

export default async function ArtifactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { headquarters } = await requireDashboardAccess();
  const params = await searchParams;
  const id = one(params.id);

  let artifacts: ArtifactSummary[] = [];
  let agents: ExplorerAgent[] = [];
  let loadError: string | null = null;
  const [artifactResult, agentResult] = await Promise.allSettled([listArtifacts(headquarters), listAgents(headquarters)]);
  if (artifactResult.status === "fulfilled") artifacts = artifactResult.value;
  else {
    console.error(artifactResult.reason);
    const missing = /\((403|404|405)\)/.test(String(artifactResult.reason));
    loadError = missing
      ? "Strapi has no readable Artifacts collection yet. Add it (see docs/agent-runtime.md) and allow the API token to find, create, and delete Artifacts."
      : "We couldn't load your artifacts. Refresh the page to try again.";
  }
  if (agentResult.status === "fulfilled") agents = agentResult.value.map(({ documentId, name, theme }) => ({ documentId, name, theme }));
  else console.error(agentResult.reason);

  return (
    <ArtifactExplorer
      artifacts={artifacts}
      agents={agents}
      initialId={id && /^[a-z0-9]{8,64}$/i.test(id) ? id : null}
      initialFolder={one(params.folder)}
      initialView={one(params.view) === "list" ? "list" : "grid"}
      loadError={loadError}
    />
  );
}
