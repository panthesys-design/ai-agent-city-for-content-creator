import type { ArtifactSummary } from "@/lib/artifact-records";
import type { ComputerLease } from "@/lib/computer/computer";
import type { HeadquartersRecord } from "@/lib/headquarters";

/** Server-side context passed to every agent run. Tools read it; the model never sees it. */
export type CityRunContext = {
  hq: HeadquartersRecord;
  /** Task this run belongs to; null for direct chat. */
  taskId: string | null;
  /** Agent documentId; null for the headquarters orchestrator. */
  agentId: string | null;
  agentName: string;
  /** Reports progress (0–100) and/or a short activity line to the city UI. */
  report: (update: { progress?: number; activity?: string }) => Promise<void>;
  /** Aborted when the user cancels or the time limit is reached. */
  signal: AbortSignal;
  /** Called after a tool saves an artifact, so live chat can show it while the run continues. */
  onArtifact?: (artifact: ArtifactSummary) => void;
  /**
   * This run's cloud computer lease, taken by the first computer tool and released when the run ends, or earlier
   * once no computer tool has run for a while (`active` counts tools in progress; `idleTimer` is that countdown).
   */
  computer?: {
    lease: Promise<ComputerLease> | null; active?: number; idleTimer?: ReturnType<typeof setTimeout> | null; searching?: boolean;
    /** When the run started (ms), so browser_wait only reports downloads made during this run. */
    startedAt?: number;
    /** Downloads browser_wait already reported in this run, so the next wait looks for a new one. */
    seenDownloads?: string[];
  };
  /** Shows "Needs you" on the building while the agent waits for the user, then "Working" again. */
  setStatus?: (status: "working" | "waiting", activity: string) => Promise<void>;
};
