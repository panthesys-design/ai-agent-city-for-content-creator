import type { AgentRecord } from "./agent-records";
import type { ArtifactSummary } from "./artifact-records";
import type { AgentRequest, ComputerSnapshot } from "./computer-records";
import type { TaskRecord } from "./task-records";

/** Key of the headquarters thread in `CitySnapshot.threads` (agents use their documentId). */
export const HEADQUARTERS_THREAD = "headquarters";

/** A headquarters request waiting for the one in progress to finish. */
export type QueuedTask = Pick<TaskRecord, "documentId" | "title" | "createdAt">;

/** Another headquarters request in progress alongside `task` (requests run side by side once they've handed out work). */
export type OtherTask = Pick<TaskRecord, "documentId" | "title" | "progress" | "activity">;

/** What `/api/city/stream` sends: live agent state, the latest headquarters task, the cloud computer, and what agents need from the user. Client-safe. */
export type CitySnapshot = {
  /** The headquarters' cloud computer; null when computers aren't configured or never used. */
  computer: ComputerSnapshot | null;
  /** Requests waiting for the user (sign in, captcha, a choice, an approval), oldest first. */
  requests: AgentRequest[];
  agents: Pick<AgentRecord, "documentId" | "status" | "progress" | "activity">[];
  /** The headquarters task in progress (or the latest one when nothing is running). */
  task: (Pick<TaskRecord, "documentId" | "title" | "status" | "progress" | "activity" | "plan" | "error" | "finishedAt" | "conversationId"> & {
    /** Deliverables saved so far by a running task's steps (empty once it finishes; the reply carries them then). */
    artifacts?: ArtifactSummary[];
  }) | null;
  /** Other headquarters requests in progress, oldest first. */
  others: OtherTask[];
  /** Headquarters requests waiting their turn, in the order they will run. */
  queue: QueuedTask[];
  /**
   * The current conversation of each chat (agent documentId, or `HEADQUARTERS_THREAD`) as
   * `<conversationId>:<latest message id>`. A chat panel reloads when its value changes: a new message arrived,
   * or a new task (or Clear chat) started a fresh conversation.
   */
  threads: Record<string, string>;
};
