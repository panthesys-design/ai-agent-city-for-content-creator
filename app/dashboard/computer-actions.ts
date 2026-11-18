"use server";

import { getCurrentUser } from "@/lib/auth/session";
import { COMPUTER_WORKSPACE, isQuestion, type ComputerState, type RequestResponse } from "@/lib/computer-records";
import { computersEnabled, previewLink, getCloudComputer } from "@/lib/computer/client";
import {
  STALE_MS, exec, markUserActive, openComputerForUser, readComputerFile, runningComputer, shellQuote, shutdownComputer, writeComputerFile,
} from "@/lib/computer/computer";
import { findOwnedRequest, findSession, settleRequest } from "@/lib/computer/store";
import { findHeadquarters } from "@/lib/headquarters";

// The user's side of the cloud computer: live screen links, answering agents' requests, starting/stopping, and the
// file panel. Every action re-checks the session and works only on the caller's own headquarters' computer.

type Fail = { ok: false; error: string };
const SIGNED_OUT = "Your session has ended. Sign in again to continue.";
const NOT_CONFIGURED = "The cloud computer isn't set up on this server. Add COMPUTERS_API_URL and COMPUTERS_API_KEY.";
const isDocumentId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{8,64}$/i.test(value);

async function currentHeadquarters() {
  const user = await getCurrentUser();
  return user ? findHeadquarters(user.email) : null;
}

async function attempt<T extends { ok: boolean }>(fallback: string, run: () => Promise<T>): Promise<T | Fail> {
  try {
    return await run();
  } catch (error) {
    console.error("[computer]", error);
    const message = error instanceof Error && /cloud computer|credits|allowance|busy|MB|limit/i.test(error.message) ? error.message : fallback;
    return { ok: false, error: message };
  }
}

export type ScreenResult = { ok: true; state: ComputerState; url: string | null; expiresAt: number | null } | Fail;

/**
 * A link to the live screen. With `start`, the computer is started if it is off (the user wants to watch, sign in
 * ahead of time, or use it); without, an off computer just returns its state. `interactive` lets the user use
 * mouse and keyboard (for signing in or solving a captcha); otherwise the link is watch-only.
 */
export async function computerScreenAction(options: { interactive: boolean; start: boolean }): Promise<ScreenResult> {
  if (!computersEnabled()) return { ok: false, error: NOT_CONFIGURED };
  return attempt("We couldn't open the computer screen. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const session = await findSession(hq.documentId);
    let computerId = session?.computerId ?? null;
    let running = false;
    if (computerId) running = (await getCloudComputer(computerId).catch(() => null))?.state === "running";
    if (!running) {
      // While an agent is starting it, wait for that instead of starting it twice.
      if (!options.start && session?.state !== "starting") return { ok: true, state: session?.state === "error" ? "error" : "stopped", url: null, expiresAt: null };
      computerId = (await openComputerForUser(hq.documentId, AbortSignal.timeout(170_000))).computerId;
    } else if (options.interactive && session) {
      await markUserActive(session.documentId);
    }
    const link = await previewLink(computerId!, !options.interactive);
    return { ok: true, state: "running", url: link.url, expiresAt: Date.now() + (link.expiresIn ?? 3600) * 1000 };
  });
}

/** Stops the computer now, unless an agent is using it. */
export async function stopComputerAction(): Promise<{ ok: true } | Fail> {
  if (!computersEnabled()) return { ok: false, error: NOT_CONFIGURED };
  return attempt("We couldn't stop the computer.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const session = await findSession(hq.documentId);
    if (!session?.computerId) return { ok: true };
    if (session.holderRun && session.heartbeatAt && Date.now() - Date.parse(session.heartbeatAt) < STALE_MS) {
      return { ok: false, error: `${session.snapshot.agentName ?? "An agent"} is using the computer. Stop its task first, or wait until it finishes.` };
    }
    await shutdownComputer(hq.documentId, session.computerId);
    return { ok: true };
  });
}

/** Answers an agent's request: a choice, open question, or approval (option or typed answer), "done" after signing in, or a dismissal. */
export async function answerRequestAction(requestId: string, answer: { optionId?: string; text?: string; done?: boolean; dismiss?: boolean }): Promise<{ ok: true } | Fail> {
  if (!isDocumentId(requestId)) return { ok: false, error: "This request no longer exists." };
  return attempt("We couldn't send your answer. Please try again.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const request = await findOwnedRequest(hq.documentId, requestId);
    if (!request) return { ok: false, error: "This request no longer exists." };
    if (request.status !== "pending") return { ok: false, error: "The agent has already moved on." };
    if (answer.dismiss) {
      await settleRequest(request.documentId, "cancelled");
      return { ok: true };
    }
    let response: RequestResponse;
    if (isQuestion(request.kind)) {
      const text = typeof answer.text === "string" ? answer.text.trim().slice(0, 300) : "";
      if (answer.optionId && request.options.some((o) => o.id === answer.optionId)) response = { optionId: answer.optionId };
      else if (request.allowOther && text) response = { optionId: "other", text };
      else return { ok: false, error: !request.options.length ? "Type your answer." : request.allowOther ? "Pick an option or type your answer." : "Pick one of the options." };
    } else {
      response = { done: true };
    }
    await settleRequest(request.documentId, "resolved", response);
    return { ok: true };
  });
}

// ---------- Files (limited to the workspace folder) ----------

export type ComputerFile = { name: string; path: string; directory: boolean; size: number; modified: string };

/** Resolves a path inside the workspace, refusing anything that escapes it. */
function workspacePath(path: string | null | undefined): string | null {
  const parts: string[] = [];
  for (const part of String(path ?? "").replace(/^\/root\/creator-city\/?/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); continue; }
    if (/[\0\n]/.test(part)) return null;
    parts.push(part);
  }
  return [COMPUTER_WORKSPACE, ...parts].join("/");
}

const OFF = "The computer is off. Start it to see its files.";
/** Upload/download limit for the file panel (uploads also need `serverActions.bodySizeLimit` in next.config.ts). */
const FILE_LIMIT = 5 * 1024 * 1024;

export async function listComputerFilesAction(path: string): Promise<{ ok: true; path: string; files: ComputerFile[] } | Fail> {
  const dir = workspacePath(path);
  if (!dir) return { ok: false, error: "That folder is outside the workspace." };
  return attempt("We couldn't list the files.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const computer = await runningComputer(hq.documentId);
    if (!computer) return { ok: false, error: OFF };
    const { output } = await exec(computer, `mkdir -p ${COMPUTER_WORKSPACE} && find ${shellQuote(dir)} -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n' 2>/dev/null | head -500`, AbortSignal.timeout(30_000));
    const files = output.split("\n").filter(Boolean).map((line) => {
      const [type, size, mtime, ...name] = line.split("\t");
      const fileName = name.join("\t");
      return { name: fileName, path: `${dir}/${fileName}`, directory: type === "d", size: Number(size) || 0, modified: new Date(Number(mtime) * 1000).toISOString() };
    }).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return { ok: true, path: dir, files };
  });
}

export async function downloadComputerFileAction(path: string): Promise<{ ok: true; name: string; base64: string } | Fail> {
  const file = workspacePath(path);
  if (!file || file === COMPUTER_WORKSPACE) return { ok: false, error: "Choose a file in the workspace." };
  return attempt("We couldn't download the file.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const computer = await runningComputer(hq.documentId);
    if (!computer) return { ok: false, error: OFF };
    const bytes = await readComputerFile(computer, file, AbortSignal.timeout(120_000), FILE_LIMIT);
    return { ok: true, name: file.split("/").pop() ?? "file", base64: bytes.toString("base64") };
  });
}

export async function uploadComputerFileAction(formData: FormData): Promise<{ ok: true; path: string } | Fail> {
  const file = formData.get("file");
  const dir = workspacePath(String(formData.get("path") ?? ""));
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose a file to upload." };
  if (file.size > FILE_LIMIT) return { ok: false, error: "Files up to 5 MB can be uploaded here." };
  if (!dir) return { ok: false, error: "That folder is outside the workspace." };
  const name = file.name.replace(/[/\\\0\n]+/g, "_").slice(0, 120) || "upload";
  return attempt("We couldn't upload the file.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const computer = await runningComputer(hq.documentId);
    if (!computer) return { ok: false, error: OFF };
    const target = `${dir}/${name}`;
    await writeComputerFile(computer, target, new Uint8Array(await file.arrayBuffer()), AbortSignal.timeout(170_000));
    return { ok: true, path: target };
  });
}

export async function deleteComputerFileAction(path: string): Promise<{ ok: true } | Fail> {
  const target = workspacePath(path);
  if (!target || target === COMPUTER_WORKSPACE) return { ok: false, error: "Choose a file in the workspace." };
  return attempt("We couldn't delete the file.", async () => {
    const hq = await currentHeadquarters();
    if (!hq) return { ok: false, error: SIGNED_OUT };
    const computer = await runningComputer(hq.documentId);
    if (!computer) return { ok: false, error: OFF };
    const { exitCode, output } = await exec(computer, `rm -rf -- ${shellQuote(target)}`, AbortSignal.timeout(30_000));
    return exitCode === 0 ? { ok: true } : { ok: false, error: output.trim().slice(0, 200) || "Delete failed." };
  });
}
