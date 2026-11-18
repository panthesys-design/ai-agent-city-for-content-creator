import { MAX_ATTACHMENTS, resolveAttachments, userTurn } from "@/lib/ai/artifact-access";
import { parkedFrom, waitingActivity } from "@/lib/ai/external-waits";
import { CHAT_HISTORY_MESSAGES, RunCancelledError, chatInput, describeError, runCityAgent } from "@/lib/ai/run-agent";
import { startWorkForAgent, waitingMessage } from "@/lib/ai/task-runner";
import type { ArtifactSummary } from "@/lib/artifact-records";
import { clearIdleAgentStates, findOwnedAgent } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth/session";
import { findHeadquarters } from "@/lib/headquarters";
import { addEvent, addMessage, claimTask, createTask, getOrCreateConversation, listMessages, updateTask } from "@/lib/runtime-store";

// Direct chat with one agent, streamed as Server-Sent Events. The run uses the conversation history saved in
// Strapi, is recorded as a task with execution events, and stops when the browser aborts the request.
//
// Events: {type:"start", taskId, message} · {type:"delta", text} · {type:"tool", label} · {type:"artifact", artifact}
//         · {type:"done", message} · {type:"error", message}
// Artifacts (scripts, images, voiceovers…) stream as soon as a tool saves them and are kept in the reply's metadata.
// Body: { message, attachments?: artifactId[] }. Attachments (uploads or earlier artifacts) are saved in the user
// message's metadata; the agent gets a reference to each, and sees attached images.

export const maxDuration = 300;

const MESSAGE_MAX = 8000;

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return Response.json({ error: "Your session has ended. Sign in again to continue." }, { status: 401 });
  const hq = await findHeadquarters(sessionUser.email);
  if (!hq) return Response.json({ error: "Create your headquarters first." }, { status: 403 });
  if (!/^[a-z0-9]{8,64}$/i.test(agentId)) return Response.json({ error: "Unknown agent." }, { status: 404 });
  const record = await findOwnedAgent(hq, agentId);
  if (!record) return Response.json({ error: "This agent no longer exists. Refresh the page." }, { status: 404 });
  if (!record.enabled) return Response.json({ error: `${record.name} is turned off. Turn it on in its AI settings.` }, { status: 409 });

  const body = (await request.json().catch(() => null)) as { message?: unknown; attachments?: unknown } | null;
  const attachments = await resolveAttachments(hq, Array.isArray(body?.attachments) ? body.attachments.slice(0, MAX_ATTACHMENTS) : []);
  const typed = typeof body?.message === "string" ? body.message.trim() : "";
  if (!typed && !attachments.length) return Response.json({ error: "Write a message first." }, { status: 400 });
  if (typed.length > MESSAGE_MAX) return Response.json({ error: `Keep messages under ${MESSAGE_MAX} characters.` }, { status: 400 });
  const text = typed || "Shared files.";

  const conversationId = await getOrCreateConversation(hq, record.documentId, `Chat with ${record.name}`);
  // Earlier turns go to the model so the agent understands references to them ("shorter", "the second idea").
  const input = chatInput(await listMessages(hq, conversationId, CHAT_HISTORY_MESSAGES), await userTurn(text, attachments, request.signal));
  const saved = await addMessage(hq.documentId, conversationId, "user", text, attachments.length ? { metadata: { attachments } } : {});
  const title = typed || attachments.map((a) => a.title).join(", ");
  const task = await createTask(hq, { title: `Chat: ${title.replace(/\s+/g, " ").slice(0, 80)}`, input: text, agentId: record.documentId, conversationId });
  await claimTask(task);
  // Only the agent taking this chat shows a status; everyone else goes back to a plain "Idle".
  await clearIdleAgentStates(hq, { except: record.documentId }).catch((error: unknown) => console.warn("[chat] couldn't clear agent status:", error));
  await addEvent(hq.documentId, task.documentId, record.documentId, "started", `Chat with ${record.name}`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { /* client went away */ }
      };
      send({ type: "start", taskId: task.documentId, message: saved });
      // The agent may wait minutes for the user (signing in on the cloud computer, answering a question); comment
      // frames keep proxies from closing the quiet connection meanwhile.
      const keepAlive = setInterval(() => { try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch { /* closed */ } }, 15_000);
      const artifacts: ArtifactSummary[] = [];
      try {
        const { output, usage } = await runCityAgent({
          hq, record, input, taskId: task.documentId, signal: request.signal,
          handlers: { onText: (delta) => send({ type: "delta", text: delta }), onTool: (label) => send({ type: "tool", label }) },
          onArtifact: (artifact) => { artifacts.push(artifact); send({ type: "artifact", artifact }); },
        });
        const message = await addMessage(hq.documentId, conversationId, "assistant", output, {
          taskId: task.documentId, ...(artifacts.length ? { metadata: { artifacts } } : {}),
        });
        await updateTask(task.documentId, { status: "completed", progress: 100, output, usage, activity: "Completed", finishedAt: new Date().toISOString() });
        await addEvent(hq.documentId, task.documentId, record.documentId, "completed", "Replied");
        send({ type: "done", message });
      } catch (error) {
        // The agent paused for a website (wait_for_external): the task stays running and replies here once it's ready.
        const parked = request.signal.aborted ? null : parkedFrom(error);
        if (parked) {
          const message = await addMessage(hq.documentId, conversationId, "assistant", waitingMessage(parked.wait, hq.timeZone), {
            taskId: task.documentId, ...(artifacts.length ? { metadata: { artifacts } } : {}),
          }).catch(() => null);
          await updateTask(task.documentId, { activity: waitingActivity(parked.wait, hq.timeZone) }).catch(() => undefined);
          await addEvent(hq.documentId, task.documentId, record.documentId, "progress", `Waiting for ${parked.wait.title}`).catch(() => undefined);
          if (message) send({ type: "done", message });
          return;
        }
        const cancelled = error instanceof RunCancelledError || request.signal.aborted;
        const message = describeError(error);
        // Keep what was already produced visible in the thread even though the reply didn't finish.
        if (artifacts.length) {
          await addMessage(hq.documentId, conversationId, "assistant", cancelled ? "Stopped. These were saved before the stop:" : `I couldn't finish: ${message}\n\nThese were saved before it stopped:`, {
            taskId: task.documentId, metadata: { artifacts },
          }).catch(() => undefined);
        }
        await updateTask(task.documentId, {
          status: cancelled ? "cancelled" : "failed", error: cancelled ? null : message,
          activity: cancelled ? "Cancelled" : "Failed", finishedAt: new Date().toISOString(),
        }).catch(() => undefined);
        await addEvent(hq.documentId, task.documentId, record.documentId, cancelled ? "cancelled" : "failed", message).catch(() => undefined);
        if (!cancelled) {
          console.error(`[chat] ${record.name} failed`, error);
          send({ type: "error", message });
        }
      } finally {
        clearInterval(keepAlive);
        try { controller.close(); } catch { /* already closed */ }
        // Headquarters steps may have waited for this agent while it chatted.
        await startWorkForAgent(hq, record.documentId);
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
