"use server";

import { HEADQUARTERS_ID } from "@/components/agent-city";
import { MAX_ATTACHMENTS, resolveAttachments, withAttachmentNote } from "@/lib/ai/artifact-access";
import { cancelTask, scheduleHeadquartersQueue } from "@/lib/ai/task-runner";
import { parseRuntimeConfig } from "@/lib/agent-config";
import type { AgentRecord } from "@/lib/agent-records";
import { findOwnedAgent, updateAgentRuntime } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth/session";
import { findHeadquarters } from "@/lib/headquarters";
import {
  activeHeadquartersTasks, addMessage, createTask, findOwnedTask, getOrCreateConversation, latestHeadquartersTask, listMessagePage,
  listTaskEvents, startFreshConversation, updateTask,
} from "@/lib/runtime-store";
import { isPlanningRequest, isTaskFinished, type StoredMessage, type TaskEvent, type TaskRecord } from "@/lib/task-records";

// Agent runtime actions for the city page. Like agent-actions.ts, every action re-checks the session and that
// the agent or task belongs to the caller's own headquarters.

type Fail = { ok: false; error: string };
const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
const NOT_FOUND = "This agent no longer exists. Refresh the page to see your latest city.";
const MESSAGE_MAX = 8000;
/** Content of a message that only carries attachments. */
const FILES_ONLY = "Shared files.";

const isDocumentId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{8,64}$/i.test(value);

async function currentHeadquarters() {
  const user = await getCurrentUser();
  return user ? findHeadquarters(user.email) : null;
}

async function attempt<T extends { ok: boolean }>(fallback: string, run: () => Promise<T>): Promise<T | Fail> {
  try {
    return await run();
  } catch (error) {
    console.error(error);
    return { ok: false, error: fallback };
  }
}

/** Messages per chat page: the newest page opens the chat, and scrolling up loads the next older page. */
const CHAT_PAGE_SIZE = 10;

/**
 * One page of the saved chat with an agent, or with headquarters when `target` is the headquarters building ID.
 * Without `before` it returns the newest messages; with it (the `createdAt` of the oldest message the client
 * already shows) it returns the page just before that. Messages are oldest first.
 */
export async function loadConversationAction(target: string, before?: string | null): Promise<{ ok: true; messages: StoredMessage[]; hasMore: boolean } | Fail> {
  return attempt("We couldn't load this conversation.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const cursor = typeof before === "string" && before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;
    let id: string;
    if (target === HEADQUARTERS_ID) id = await getOrCreateConversation(hq, null, `${hq.name} headquarters`);
    else {
      const record = isDocumentId(target) ? await findOwnedAgent(hq, target) : null;
      if (!record) return { ok: false, error: NOT_FOUND };
      id = await getOrCreateConversation(hq, target, `Chat with ${record.name}`);
    }
    return { ok: true, ...(await listMessagePage(hq, id, { limit: CHAT_PAGE_SIZE, before: cursor })) };
  });
}

/**
 * Sends a request to headquarters, which plans and delegates it across agents in the background. While another
 * request is still planning (hasn't handed work to its agents yet), this one waits in the queue (`queuePosition`
 * > 0) and starts by itself when its turn comes; steps whose agent is busy wait for that agent.
 * `attachmentIds` are artifacts (usually files the user just uploaded) that headquarters and its agents can open.
 */
export async function askHeadquartersAction(text: string, attachmentIds: string[] = []): Promise<{ ok: true; message: StoredMessage; task: TaskRecord; queuePosition: number } | Fail> {
  return attempt("We couldn't send this to headquarters. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const attachments = await resolveAttachments(hq, Array.isArray(attachmentIds) ? attachmentIds.slice(0, MAX_ATTACHMENTS) : []);
    const message = typeof text === "string" ? text.trim() : "";
    if (!message && !attachments.length) return { ok: false, error: "Write a message first." };
    if (message.length > MESSAGE_MAX) return { ok: false, error: `Keep messages under ${MESSAGE_MAX} characters.` };
    if (!process.env.OPENAI_API_KEY) return { ok: false, error: "Agents aren't set up yet: OPENAI_API_KEY is missing on the server." };

    const active = await activeHeadquartersTasks(hq);
    // A request after finished real work (a task with a plan) starts a fresh headquarters chat; greetings and
    // questions, and requests that queue behind running work, stay in the current one.
    let conversationId = await getOrCreateConversation(hq, null, `${hq.name} headquarters`);
    if (!active.length) {
      const last = await latestHeadquartersTask(hq);
      if (last?.plan?.length && last.conversationId === conversationId) conversationId = await startFreshConversation(hq, null, `${hq.name} headquarters`);
    }
    const title = (message || attachments.map((a) => a.title).join(", ")).replace(/\s+/g, " ").slice(0, 120);
    const task = await createTask(hq, { title, input: withAttachmentNote(message || FILES_ONLY, attachments), conversationId });
    // Strapi requires message content, so a files-only message gets a short line.
    const saved = await addMessage(hq.documentId, conversationId, "user", message || FILES_ONLY, {
      taskId: task.documentId, ...(attachments.length ? { metadata: { attachments } } : {}),
    });
    await scheduleHeadquartersQueue(hq);
    // It starts right away unless another request is still planning or others are queued ahead of it.
    const ahead = active.filter((t) => t.status === "queued" && !t.jobRunId).length;
    const queuePosition = ahead || active.some(isPlanningRequest) ? ahead + 1 : 0;
    return { ok: true, message: saved, task, queuePosition };
  });
}

/**
 * Clears a chat: starts a new, empty conversation with the agent (or headquarters). The old messages stay in
 * Strapi with their tasks; artifacts, uploads, memory, and the agent's settings are not touched.
 */
export async function clearConversationAction(target: string): Promise<{ ok: true } | Fail> {
  return attempt("We couldn't clear this chat. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    if (target === HEADQUARTERS_ID) {
      await startFreshConversation(hq, null, `${hq.name} headquarters`);
      return { ok: true };
    }
    const record = isDocumentId(target) ? await findOwnedAgent(hq, target) : null;
    if (!record) return { ok: false, error: NOT_FOUND };
    await startFreshConversation(hq, record.documentId, `Chat with ${record.name}`);
    return { ok: true };
  });
}

export async function cancelTaskAction(taskId: string): Promise<{ ok: true } | Fail> {
  return attempt("We couldn't cancel this task. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const task = isDocumentId(taskId) ? await findOwnedTask(hq, taskId) : null;
    if (!task) return { ok: false, error: "This task no longer exists." };
    await cancelTask(hq, task);
    // A request removed from the queue may have been the next one dispatched; keep the queue moving.
    await scheduleHeadquartersQueue(hq);
    return { ok: true };
  });
}

/** Clears a stopped or finished headquarters task from the work progress card. The task and its chat stay saved. */
export async function clearTaskProgressAction(taskId: string): Promise<{ ok: true } | Fail> {
  return attempt("We couldn't clear the work progress. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const task = isDocumentId(taskId) ? await findOwnedTask(hq, taskId) : null;
    if (!task) return { ok: true };
    if (!isTaskFinished(task.status)) return { ok: false, error: "Stop this task before clearing it." };
    await updateTask(task.documentId, { progressCleared: true });
    return { ok: true };
  });
}

/** Saves an agent's AI settings: role, model, tools, and execution settings. */
export async function updateAgentConfigAction(agentId: string, raw: unknown): Promise<{ ok: true; agent: AgentRecord } | Fail> {
  return attempt("We couldn't save the AI settings. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const parsed = parseRuntimeConfig(raw);
    if ("error" in parsed) return { ok: false, error: parsed.error };
    if (!isDocumentId(agentId) || !(await findOwnedAgent(hq, agentId))) return { ok: false, error: NOT_FOUND };
    return { ok: true, agent: await updateAgentRuntime(agentId, parsed.config) };
  });
}

/** Execution history of one task, including the steps it delegated. */
export async function taskEventsAction(taskId: string): Promise<{ ok: true; events: TaskEvent[] } | Fail> {
  return attempt("We couldn't load the task history.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    if (!isDocumentId(taskId) || !(await findOwnedTask(hq, taskId))) return { ok: false, error: "This task no longer exists." };
    return { ok: true, events: await listTaskEvents(hq, taskId) };
  });
}
