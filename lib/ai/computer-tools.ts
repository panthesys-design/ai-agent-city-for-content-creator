import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";
import { COMPUTER_WORKSPACE, CONFIRM_OPTIONS, capabilityKey } from "@/lib/computer-records";
import { composioConfigured } from "@/lib/composio/client";
import { activeConnections } from "@/lib/composio/connections";
import { agentCanUse, appForUrl } from "@/lib/connection-records";
import { computersEnabled, type ComputerAction } from "@/lib/computer/client";
import {
  acquireComputer, browserCommand, checkPage, computerAction, exec, readComputerFile, releaseComputer, screenshot, shellQuote, touchComputer, writeComputerFile,
  type BrowserPage, type ComputerLease,
} from "@/lib/computer/computer";
import { getTask } from "@/lib/runtime-store";
import { rememberedChoice } from "@/lib/computer/store";
import { recordArtifact } from "./artifact-tools";
import { describeNow, resolveTimeZone, staleYearsIn } from "./clock";
import type { CityRunContext } from "./context";
import { jobsConfig } from "./env";
import { RunParkedError, countTaskWaits, createWait, waitingActivity } from "./external-waits";
import { ensureWaitSchedule, waitCheckIntervalSeconds } from "./jobs";
import { uploadToMediaLibrary } from "./media-library";
import { contextOf, slug } from "./tool-context";
import { pauseRunClocks } from "./run-clock";
import { askUser } from "./user-requests";

// The Cloud Computer tool (agent tool key `computer`): a CloudHike.dev Linux desktop per headquarters with Google
// Chrome, a terminal, and a file system. Agents use the browser through the DevTools protocol (cc_browser.py on
// the computer) for reliable navigation, form filling, and extraction, and fall back to screenshots plus mouse and
// keyboard for anything outside a web page. The computer starts on the first tool call and stops when the run
// ends (see lib/computer/computer.ts). `ask_user` (every agent) is the generative-UI question for the user.

type Ctx = RunContext<unknown>;
const ctx = (rc: Ctx | undefined) => contextOf(rc as RunContext<CityRunContext> | undefined);

/** Rules added to an agent's instructions when it has the computer tool. */
export const COMPUTER_RULES = [
  "You have a cloud computer: a Linux desktop with Google Chrome, a terminal, and files. Use it whenever your own knowledge and your other tools are not enough: current information from the web, a website or platform the user uses, a service you have no direct tool for, downloading or converting files, or running commands.",
  "Connected apps come first: before doing anything on an app's website (posting, uploading, reading stats or comments, editing a Notion page or a Google Sheet), check whether that app is connected for you (your connected apps are listed in these instructions; list_connected_apps shows them too). If it is, call find_app_tools and do it with run_app_tool or schedule_app_tool, not in the browser. Use the computer for that app only when find_app_tools has no tool for the action, the tool failed and the website is the only way left, or the user explicitly asked you to use the website. Reading public pages for research is fine in the browser.",
  "It starts by itself on your first computer tool call and shuts down by itself when you finish or stop using it for a few minutes; never wait for it or try to stop it. The user can watch it live.",
  "The browser has one tab you share with yourself: browser tools run strictly one at a time, so call one, wait for its result, then call the next (never several at once; a second browser_search while one is running is refused). browser_search returns the top results (title, link, snippet) in seconds and falls back to another search engine when one is blocked; open the most relevant 1–3 results with browser_open rather than searching again and again.",
  "Browser: browser_search or browser_open, then read the result. Interact with elements by their [id] (browser_click, browser_type, browser_select); ids change after the page changes, so use the ids from the latest result. Use browser_read with an offset to read further, browser_extract to pull structured data with a JavaScript expression, and computer_screenshot plus computer_action when you need to see the screen or use something outside a web page (file pickers, native dialogs, canvas editors).",
  "Work fast; every tool call uses one of your limited turns. (1) Act right away: every browser tool already returns the page text and its elements, so act on that result directly. Don't call browser_read, browser_scroll, or computer_screenshot just to look again. (2) Batch: when you know the next several steps (fill a form, click through a menu, type and submit, click Export then wait), do them all in ONE browser_do call. Target later steps by their visible label (`target`), because ids change after the page changes. (3) Look only when the text isn't enough: if the elements don't show what you need (a canvas editor, a visual layout, an unlabeled icon, or two failed attempts), take ONE screenshot (browser_do with screenshot true, or computer_screenshot). Work out every action you can from it, then do them together (browser_do, or computer_action with several actions). computer_action already returns a screenshot, so never take another one right after it. (4) Don't explore. Go straight for the goal, and open a site's page directly by URL when you know it.",
  "Sign-ins: the browser keeps the user's sign-ins between sessions, so first open the site and check whether they are already signed in. If a page asks to sign in, shows a captcha, or needs something only the user can do (2-factor codes, payments, consent), call request_user_action with the service and why; never ask for passwords or codes in chat and never type credentials yourself. When it returns, continue from the page it shows.",
  `Terminal and files: terminal_run runs bash as root; keep work files in ${COMPUTER_WORKSPACE} (the default folder). Use file_save to keep a finished file (audio, video, image, PDF, CSV…) as an artifact for the user; files only on the computer are not visible to them.`,
  "Uploading to a website: get the file onto the computer first (file_download for an artifact's url), then call browser_upload with its path and the [id] of the site's upload button, drop area, or file input. Don't use the native file picker or page scripts for uploads.",
  `Waiting: when a site is uploading, processing, rendering, or exporting, call browser_wait (until text appears, until text such as "Rendering" is gone, or until a download finishes). One browser_wait can wait several minutes in a single step; never use terminal_run sleep, repeated screenshots, or browser_extract polling to wait. If it returns before it's done but the site is still progressing, call browser_wait again.`,
  `Downloads: files the browser downloads are saved in ${COMPUTER_WORKSPACE}/downloads. After clicking a site's Download or Export button, call browser_wait with download true; it returns the finished file's path. Then file_save that file. When the result of the task is a file (an edited video, an image, a document), the task isn't done until that file is saved with file_save, and your answer names it.`,
  "Long waits: when a website will keep working for more than about 10 minutes on its own servers (another AI such as Claude building a video or an app, a cloud render, a long export the site emails or shows later), don't browser_wait for it: call wait_for_external with the page, what shows it is ready, and what to do next. Your run ends and the computer turns off; the page is checked every few minutes and the task continues by itself in a new run once it is ready. Work that runs inside the browser tab (an in-browser editor rendering or exporting) stops when the computer turns off, so use browser_wait for that.",
  "The cloud computer is small (no GPU, limited memory). Before a heavy job in the browser (rendering or exporting video), close the tabs you don't need and choose the smallest export quality that fits the task (720p unless the user asked for more).",
  "Work on a website with the browser tools only: open → (browser_upload) → click → browser_wait → click Export/Download → browser_wait with download true → file_save. Don't use terminal_run, ffmpeg, or scripts to do, check, or replace what the website does; terminal_run is for tasks that are about the computer itself.",
  "Report what you actually saw. If a site blocks you or an action fails twice, stop and explain instead of looping.",
].join("\n");

/** Rules for every agent: ask the user when a capability is missing instead of guessing or giving up. */
export const ASK_RULES = [
  "If a task needs something you have no tool for (for example a voiceover with no voice tool, or posting to a platform), or you are unsure which tool, service, or website to use, don't refuse, guess, or invent results: call ask_user with the question and 2–5 realistic services as options (for voice generation: ElevenLabs, Deepgram, OpenAI TTS…), passing a capability key such as \"voice_generation\" so the choice is remembered.",
  "Then do it with a matching tool if you have one, including a connected app (find_app_tools, run_app_tool); otherwise, with your cloud computer, use the chosen service's website (asking the user to sign in with request_user_action if needed). If you have no cloud computer, explain that the user can turn on Cloud computer in your AI settings.",
  "When the user names a specific website, app, or service for the work (\"edit it on clipgenie.app\"), do it there. Naming an app (\"post it on Instagram\") doesn't mean using its website: when that app is connected, its connected-app tools are the way to do it there. If that doesn't work, don't quietly do it another way (for example editing locally with ffmpeg instead of the named editor): explain what blocked you, or ask_user whether to switch, and only switch if they agree.",
  "When something you need is missing and no list of options fits (a brand name, a target audience, a link), ask_user with no options asks an open question the user answers in a sentence.",
  "Before an action that is hard to undo or that other people will see (publishing or posting, sending a message or email, scheduling, buying or paying, deleting files or data, changing account settings), call confirm_action and only go ahead if it returns approved. If the user declines or asks for changes, follow their feedback.",
  "The user answers your questions and approvals right in your chat, in the headquarters chat, or from the bubble above your building, and you continue by yourself afterwards. Ask only for real decisions and approvals, not for routine work you can decide yourself (drafting, generating, saving artifacts).",
].join("\n");

/** Tool failures go back to the model with their message (not the SDK's generic one), so it can adapt. */
function toolError(_context: unknown, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error: ${message.slice(0, 600)}`;
}

// ---------- Lease ----------

/**
 * A run gives the computer back after this long without a computer tool call (COMPUTER_IDLE_RELEASE_SECONDS,
 * default 3 minutes), so it isn't left on while the agent writes; the next computer tool starts it again.
 */
const idleReleaseMs = () => Math.max(30, Number(process.env.COMPUTER_IDLE_RELEASE_SECONDS) || 180) * 1000;

async function leaseOf(context: CityRunContext): Promise<ComputerLease> {
  if (!computersEnabled()) throw new Error("The cloud computer isn't configured on this server (COMPUTERS_API_URL and COMPUTERS_API_KEY).");
  const holder = context.computer;
  if (!holder) throw new Error("The cloud computer is not available in this run.");
  if (!holder.lease) {
    // Set the promise synchronously (before any await): parallel tool calls of one run must share a single lease.
    // Otherwise each call acquires its own, the later ones wait for the first ("<this agent> is using it"), and the
    // first lease is overwritten and never released, so the run stalls until it goes stale.
    const lease = (async () => {
      await context.report({ activity: "Starting the cloud computer" });
      return acquireComputer(
        { hqId: context.hq.documentId, agentId: context.agentId, agentName: context.agentName, taskId: context.taskId },
        { signal: context.signal, onWait: (busy) => context.report({ activity: `Waiting for the computer (${busy} is using it)` }) },
      );
    })();
    holder.lease = lease;
    lease.catch(() => { if (holder.lease === lease) holder.lease = null; });
  }
  return holder.lease;
}

/** Ends this run's computer lease (and shuts the computer down). Called when an agent run finishes. */
export async function releaseRunComputer(context: Pick<CityRunContext, "computer">): Promise<void> {
  const holder = context.computer;
  if (!holder) return;
  if (holder.idleTimer) clearTimeout(holder.idleTimer);
  holder.idleTimer = null;
  const pending = holder.lease;
  holder.lease = null;
  const lease = await pending?.catch(() => null);
  if (lease) await releaseComputer(lease);
}

/** Starts the idle countdown once no computer tool is running; when it ends, the run gives the computer back. */
function scheduleIdleRelease(context: CityRunContext) {
  const holder = context.computer;
  if (!holder || (holder.active ?? 0) > 0 || !holder.lease) return;
  if (holder.idleTimer) clearTimeout(holder.idleTimer);
  holder.idleTimer = setTimeout(() => {
    holder.idleTimer = null;
    if ((holder.active ?? 0) > 0 || context.signal.aborted) return;
    void releaseRunComputer({ computer: holder }).then(() => context.report({ activity: "Turned the cloud computer off (not in use)" })).catch(() => undefined);
  }, idleReleaseMs());
  holder.idleTimer.unref?.();
}

async function using<T>(runContext: Ctx | undefined, activity: string, fn: (lease: ComputerLease, context: CityRunContext) => Promise<T>): Promise<T> {
  const context = ctx(runContext);
  const holder = context.computer;
  if (holder) {
    holder.active = (holder.active ?? 0) + 1;
    if (holder.idleTimer) { clearTimeout(holder.idleTimer); holder.idleTimer = null; }
  }
  try {
    const lease = await leaseOf(context);
    await Promise.all([context.report({ activity }), touchComputer(lease, { activity })]);
    return await fn(lease, context);
  } finally {
    if (holder) {
      holder.active = Math.max(0, (holder.active ?? 1) - 1);
      scheduleIdleRelease(context);
    }
  }
}

/** Shows that a browser action is waiting for the one before it (parallel tool calls share one tab). */
const queuedStatus = (context: CityRunContext, activity: string) => ({
  onQueued: () => { void context.report({ activity: `${activity} (after the current browser step)` }).catch(() => undefined); },
});

// ---------- Formatting ----------

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** A page as compact text for the model: where it is, warnings, the text, and the elements it can use. */
export function describePage(page: BrowserPage, { elements = true } = {}): string {
  const lines = [`URL: ${page.url}`, `Title: ${page.title || "(none)"}`];
  if (page.signals?.captcha) lines.push("⚠ This page shows a captcha or bot check. Call request_user_action with kind \"captcha\".");
  else if (page.signals?.loginForm) lines.push("⚠ This page asks to sign in. Call request_user_action with kind \"login\" (never type credentials yourself).");
  if (page.text !== undefined) {
    const start = page.offset ?? 0, end = start + page.text.length, total = page.textLength ?? end;
    lines.push("", `Text (characters ${start}–${end} of ${total}${end < total ? `; browser_read with offset ${end} for more` : ""}):`, page.text || "(no text)");
  }
  if (elements && page.elements?.length) {
    lines.push("", "Elements (use the [id]; ↓ = scrolled out of view):");
    for (const e of page.elements) {
      const kind = e.type && e.tag === "input" ? `input:${e.type}` : e.tag;
      lines.push(`[${e.id}] ${kind} "${e.label}"${e.value ? ` value="${e.value}"` : ""}${e.href ? ` → ${clip(e.href, 100)}` : ""}${e.disabled ? " (disabled)" : ""}${e.checked ? " (checked)" : ""}${e.offscreen ? " ↓" : ""}`);
    }
  }
  return lines.join("\n");
}

async function browse(runContext: Ctx | undefined, activity: string, command: string, args: Record<string, unknown>) {
  return using(runContext, activity, async (lease, context) => {
    const page = await browserCommand(lease, command, args, context.signal, queuedStatus(context, activity));
    if (page?.url) await touchComputer(lease, { url: page.url, pageTitle: page.title ?? null });
    return describePage(page);
  });
}

const screenshotOutput = (shot: { image: string; mime: string }, note: string) => [
  { type: "text" as const, text: note },
  { type: "image" as const, image: { data: shot.image, mediaType: shot.mime || "image/png" }, detail: "auto" as const },
];

const resolvePath = (path: string | null | undefined) => {
  const p = (path ?? "").trim();
  if (!p) return COMPUTER_WORKSPACE;
  return p.startsWith("/") ? p : p.startsWith("~/") ? `/root/${p.slice(2)}` : `${COMPUTER_WORKSPACE}/${p}`;
};

// ---------- Browser ----------

/** Toolkits this run's agent can use through a connected account, looked up once per run. */
const usableToolkits = new WeakMap<CityRunContext, Promise<{ toolkit: string; name: string }[]>>();
function connectedToolkitsFor(context: CityRunContext) {
  let found = usableToolkits.get(context);
  if (!found) {
    found = !composioConfigured() || !context.agentId
      ? Promise.resolve([])
      : activeConnections(context.hq.documentId)
        .then((all) => all.filter((c) => agentCanUse(c, context.agentId)).map((c) => ({ toolkit: c.toolkit, name: c.toolkitName })))
        .catch(() => []);
    usableToolkits.set(context, found);
  }
  return found;
}

/** A reminder when the agent opens the website of an app it could use through its connection instead. */
async function connectedAppNote(runContext: Ctx | undefined, url: string): Promise<string | null> {
  const context = runContext?.context as CityRunContext | undefined;
  if (!context) return null;
  const apps = await connectedToolkitsFor(context);
  const toolkit = appForUrl(url, apps.map((a) => a.toolkit));
  const app = toolkit ? apps.find((a) => a.toolkit === toolkit) : null;
  if (!app) return null;
  return `Note: ${app.name} is a connected app you can use. For actions on it (posting, uploading, reading stats or comments, editing), use find_app_tools with toolkit "${app.toolkit}" and run_app_tool or schedule_app_tool instead of this website, unless no app tool does what you need or the user asked for the website. Reading this page for research is fine.`;
}

const browserOpenTool = tool({
  name: "browser_open",
  errorFunction: toolError,
  description: "Open a URL in the cloud computer's Chrome (keeps the user's sign-ins). Returns the page text and its interactive elements with [id]s. For an app that is connected (Instagram, YouTube, Notion…), act through its connected-app tools (find_app_tools, run_app_tool) instead.",
  parameters: z.object({
    url: z.string().min(1).max(2048),
    newTab: z.boolean().nullable().describe("Open in a new tab instead of the current one."),
  }),
  execute: async ({ url, newTab }, rc) => {
    const [page, note] = await Promise.all([
      browse(rc, `Opening ${clip(url.replace(/^https?:\/\//, ""), 60)}`, newTab ? "new_tab" : "open", { url, maxChars: 5000 }),
      connectedAppNote(rc, url),
    ]);
    return note && typeof page === "string" ? `${note}\n\n${page}` : page;
  },
});

type SearchResult = { title: string; url: string; snippet: string };
type SearchPage = {
  engine: string; query: string; recency?: string | null; url: string; title: string; results: SearchResult[]; tried: string[]; blocked: string[]; captcha?: boolean; error?: string | null;
};

/** Search results as compact text for the model. */
function describeSearch(found: SearchPage, timeZone: string): string {
  const fallback = found.tried.length > 1 ? ` (after ${found.tried.slice(0, -1).join(", ")} ${found.blocked.length ? "showed a bot check" : "returned nothing"})` : "";
  return [
    `${found.results.length} results from ${found.engine}${fallback} for “${found.query}”${found.recency ? `, limited to the past ${found.recency}` : ""} (searched ${describeNow(new Date(), timeZone)}):`,
    ...found.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`),
    "",
    "Open the most relevant results with browser_open to read them; quote facts only from pages you opened or from these snippets.",
  ].join("\n");
}

const browserSearchTool = tool({
  name: "browser_search",
  errorFunction: toolError,
  description: "Search the web in the cloud browser. Returns the top results as a list (title, link, snippet) within seconds; it searches Google and falls back to Bing, and asks the user to solve a bot check only when both are blocked. Searches run strictly one at a time: call it once, wait for the results, and only then search again if needed. For anything current (today, latest, trending, this week) set recency instead of writing a date into the query.",
  parameters: z.object({
    query: z.string().min(1).max(400).describe("What to search for, without a guessed month or year."),
    engine: z.enum(["google", "bing"]).nullable().describe("Engine to try first (default google); the other is the fallback."),
    recency: z.enum(["day", "week", "month"]).nullable().describe('Only pages from the past day, week, or month. Use "day" for today/trending/breaking, "week" for this week/latest.'),
  }),
  execute: async ({ query, engine, recency }, rc) => {
    // One search at a time per run: a second call while one is running is turned away (set before any await).
    const holder = ctx(rc).computer;
    if (holder?.searching) return "Not searched: another browser_search is still running. Searches run one at a time; wait for its results, then search again only if you still need to.";
    if (holder) holder.searching = true;
    try { return await searchWeb(query, engine, recency, rc); } finally { if (holder) holder.searching = false; }
  },
});

async function searchWeb(query: string, engine: "google" | "bing" | null, recency: "day" | "week" | "month" | null, rc: Ctx | undefined): Promise<string> {
  return using(rc, `Searching “${clip(query, 50)}”`, async (lease, context) => {
    const activity = `Searching “${clip(query, 50)}”`;
    const run = () => browserCommand<SearchPage>(lease, "search", { query, engine: engine ?? "google", maxResults: 8, recency }, context.signal, queuedStatus(context, activity));
    let found = await run();
    await touchComputer(lease, { url: found.url || null, pageTitle: found.title || null });
    if (!found.results.length && found.captcha) {
      // Every engine shows a bot check: the user solves it on the computer's screen (shown in the city as
      // "Needs you"), then the search runs again by itself.
      const service = found.engine.charAt(0).toUpperCase() + found.engine.slice(1);
      await touchComputer(lease, { activity: `Waiting for you: solve the ${service} check` });
      const answer = await askUser(context, {
        kind: "captcha", title: `Solve the ${service} bot check so I can search`, service, url: found.url || null,
        message: `Every search engine asked the cloud computer to prove it's human. Open the computer, solve the check on the ${service} page, then press Done.`,
      }, {
        detect: async () => !(await browserCommand<BrowserPage>(lease, "status", {}, context.signal).catch(() => null))?.signals?.captcha,
        onTick: () => touchComputer(lease),
      });
      if (answer.status !== "resolved") {
        return `Search is blocked: ${found.tried.join(", ")} all showed a bot check and the user ${answer.status === "expired" ? "didn't respond in time" : "skipped it"}. Don't search again; work from what you know or open a specific site with browser_open, and say that live search wasn't available.`;
      }
      await context.report({ activity });
      found = await run();
    }
    if (!found.results.length) {
      return `No results for “${query}”${found.error ? ` (${found.error})` : ""}${found.blocked.length ? `; blocked by a bot check on ${found.blocked.join(", ")}` : ""}. Try different words or open a likely site directly with browser_open.`;
    }
    const timeZone = resolveTimeZone(context.hq.timeZone);
    const stale = staleYearsIn(query, new Date(), timeZone);
    const note = stale.length ? `\n\nNote: your query names ${stale.join(", ")}, but today is ${describeNow(new Date(), timeZone)}. If you meant current results, search again without the year and with recency.` : "";
    return describeSearch(found, timeZone) + note;
  });
}

const browserReadTool = tool({
  name: "browser_read",
  errorFunction: toolError,
  description: "Read the current page again: text (from an offset, for long pages) and interactive elements with fresh [id]s.",
  parameters: z.object({
    offset: z.number().int().min(0).nullable(),
    maxChars: z.number().int().min(500).max(20000).nullable(),
  }),
  execute: ({ offset, maxChars }, rc) => browse(rc, "Reading the page", "read", { offset: offset ?? 0, maxChars: maxChars ?? 8000 }),
});

const browserClickTool = tool({
  name: "browser_click",
  errorFunction: toolError,
  description: "Click an element of the current page by its [id] (preferred), or at x/y page coordinates. Returns the page after the click.",
  parameters: z.object({
    elementId: z.number().int().min(1).nullable(),
    x: z.number().nullable(),
    y: z.number().nullable(),
    double: z.boolean().nullable(),
  }),
  execute: ({ elementId, x, y, double }, rc) => {
    if (elementId === null && (x === null || y === null)) return "Give an elementId, or both x and y.";
    return browse(rc, "Clicking", "click", elementId !== null ? { id: elementId, double } : { x, y, double });
  },
});

const browserTypeTool = tool({
  name: "browser_type",
  errorFunction: toolError,
  description: "Type text into an input, textarea, or editor by [id] (replaces its content unless clear is false). Set submit to press Enter afterwards.",
  parameters: z.object({
    elementId: z.number().int().min(1).nullable().describe("Field to type into; null types into the focused element."),
    text: z.string().max(20000),
    submit: z.boolean().nullable(),
    clear: z.boolean().nullable(),
  }),
  execute: async ({ elementId, text, submit, clear }, rc) => using(rc, "Typing", async (lease, context) => {
    const result = await browserCommand<BrowserPage | { ok: boolean; typed: number }>(lease, "type", { id: elementId, text, submit: Boolean(submit), clear: clear !== false }, context.signal);
    if ("url" in result) { await touchComputer(lease, { url: result.url, pageTitle: result.title }); return describePage(result); }
    return `Typed ${result.typed} characters.`;
  }),
});

const browserSelectTool = tool({
  name: "browser_select",
  errorFunction: toolError,
  description: "Choose an option of a <select> element by its [id], using the option's value or visible text.",
  parameters: z.object({ elementId: z.number().int().min(1), option: z.string().min(1).max(200) }),
  execute: ({ elementId, option }, rc) => browse(rc, "Choosing an option", "select", { id: elementId, value: option }),
});

const browserKeyTool = tool({
  name: "browser_key",
  errorFunction: toolError,
  description: "Press a key in the page: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, PageDown, PageUp, Space, Home, End.",
  parameters: z.object({ key: z.string().min(1).max(20) }),
  execute: ({ key }, rc) => browse(rc, `Pressing ${key}`, "key", { key }),
});

const browserScrollTool = tool({
  name: "browser_scroll",
  errorFunction: toolError,
  description: "Scroll the page up or down by a fraction of the window height (default 0.8) and return what is visible.",
  parameters: z.object({ direction: z.enum(["up", "down"]), amount: z.number().min(0.1).max(10).nullable() }),
  execute: ({ direction, amount }, rc) => browse(rc, "Scrolling", "scroll", { direction, amount: amount ?? 0.8 }),
});

const browserHistoryTool = tool({
  name: "browser_history",
  errorFunction: toolError,
  description: "Go back, go forward, or reload the current page.",
  parameters: z.object({ action: z.enum(["back", "forward", "reload"]) }),
  execute: ({ action }, rc) => browse(rc, action === "reload" ? "Reloading" : `Going ${action}`, action, {}),
});

const browserTabsTool = tool({
  name: "browser_tabs",
  errorFunction: toolError,
  description: "List the browser's tabs, switch to one, or close one (by index from the list).",
  parameters: z.object({ action: z.enum(["list", "switch", "close"]), index: z.number().int().min(0).nullable() }),
  execute: async ({ action, index }, rc) => using(rc, "Managing tabs", async (lease, context) => {
    if (action === "switch") {
      const page = await browserCommand(lease, "switch_tab", { index: index ?? 0 }, context.signal);
      await touchComputer(lease, { url: page.url, pageTitle: page.title });
      return describePage(page);
    }
    if (action === "close") await browserCommand(lease, "close_tab", { index: index ?? 0 }, context.signal);
    const { tabs } = await browserCommand<{ tabs: { index: number; title: string; url: string }[] }>(lease, "tabs", {}, context.signal);
    return tabs.map((t) => `${t.index}: ${t.title || "(untitled)"} — ${t.url}`).join("\n") || "No tabs open.";
  }),
});

const browserExtractTool = tool({
  name: "browser_extract",
  errorFunction: toolError,
  description: "Evaluate a JavaScript expression in the current page and return its JSON value, to extract structured data (tables, lists, prices, links). Example: [...document.querySelectorAll('h3 a')].map(a => ({title: a.innerText, url: a.href}))",
  parameters: z.object({ expression: z.string().min(1).max(8000), maxChars: z.number().int().min(500).max(50000).nullable() }),
  execute: async ({ expression, maxChars }, rc) => using(rc, "Extracting data from the page", async (lease, context) => {
    const { value, truncated } = await browserCommand<{ value: string; truncated: boolean }>(lease, "eval", { expression, maxChars: maxChars ?? 20000 }, context.signal);
    return truncated ? `${value}\n…(truncated; narrow the expression)` : value;
  }),
});

const browserUploadTool = tool({
  name: "browser_upload",
  errorFunction: toolError,
  description: "Upload files from the cloud computer to the current page: give the file path(s) and the [id] of the site's upload button, drop area, or file input (null uses the page's file input). No file picker is needed. Returns the page after the upload.",
  parameters: z.object({
    paths: z.array(z.string().min(1).max(500)).min(1).max(10).describe(`Files on the computer; relative paths are under ${COMPUTER_WORKSPACE}.`),
    elementId: z.number().int().min(1).nullable(),
  }),
  execute: async ({ paths, elementId }, rc) => using(rc, "Uploading a file", async (lease, context) => {
    const page = await browserCommand<BrowserPage & { uploaded?: string[] }>(lease, "upload", { paths: paths.map(resolvePath), id: elementId, waitSeconds: 10 }, context.signal, queuedStatus(context, "Uploading a file"));
    if (page?.url) await touchComputer(lease, { url: page.url, pageTitle: page.title ?? null });
    return `Uploaded ${(page.uploaded ?? paths).join(", ")}. The site may still be processing it: use browser_wait if it shows progress.\n\n${describePage(page)}`;
  }),
});

type WaitState = { url?: string; title?: string; progress?: string | null; excerpt?: string };
type WaitResult = {
  met: boolean; reason: "text" | "gone" | "download" | "time" | "crashed"; busy?: boolean; page?: WaitState;
  memory?: { limitMb: number | null; usedMb: number | null; oomKills: number };
  files?: { path: string; name: string; size: number }[]; partial?: { name: string; size: number }[];
};

/** Longest single browser_wait; each helper call waits at most 45 s, and the loop keeps the lease alive. */
const WAIT_LIMIT_SECONDS = 900;

const browserWaitTool = tool({
  name: "browser_wait",
  errorFunction: toolError,
  description: "Wait, in one step, while a website uploads, processes, renders, or exports: until text appears on the page, until text disappears (e.g. \"Rendering\"), or until a browser download finishes (returns its path for file_save). Use it instead of sleeping or polling. Waiting doesn't count against your time limit.",
  parameters: z.object({
    untilText: z.string().max(200).nullable().describe("Return once this text is on the page (case-insensitive), e.g. \"Download MP4\"."),
    untilGone: z.string().max(200).nullable().describe("Return once this text is no longer on the page, e.g. \"Rendering\"."),
    download: z.boolean().nullable().describe("Return once a new download has finished."),
    timeoutSeconds: z.number().int().min(5).max(WAIT_LIMIT_SECONDS).nullable().describe("Longest wait (default 300)."),
  }),
  execute: async ({ untilText, untilGone, download, timeoutSeconds }, rc) => using(rc, "Waiting for the page", async (lease, context) => {
    const holder = context.computer;
    const limitMs = (timeoutSeconds ?? 300) * 1000;
    const started = Date.now();
    // Waiting on a website is not the agent working: like waiting for the user, it pauses the run's time limits.
    const resume = pauseRunClocks();
    try {
      let result: WaitResult;
      for (;;) {
        const remaining = Math.ceil((limitMs - (Date.now() - started)) / 1000);
        const sinceSeconds = Math.ceil((Date.now() - (holder?.startedAt ?? Date.now() - 30 * 60_000)) / 1000) + 30;
        result = await browserCommand<WaitResult>(lease, "wait", {
          text: untilText, gone: untilGone, download: Boolean(download), seconds: Math.max(1, Math.min(45, remaining)),
          sinceSeconds, exclude: holder?.seenDownloads ?? [],
        }, context.signal, queuedStatus(context, "Waiting for the page"));
        const progress = result.page?.progress ? ` (${result.page.progress})` : result.partial?.length ? " (downloading)" : "";
        await Promise.all([
          context.report({ activity: `Waiting for the page${progress}` }),
          touchComputer(lease, { activity: `Waiting for the page${progress}`, ...(result.page?.url ? { url: result.page.url, pageTitle: result.page.title ?? null } : {}) }),
        ]);
        if (result.met || result.reason === "crashed" || Date.now() - started >= limitMs) break;
      }
      const waited = Math.round((Date.now() - started) / 1000);
      const page = result.page?.url ? `\n\nPage: ${result.page.url}${result.page.excerpt ? `\nShows: ${result.page.excerpt}` : ""}` : "";
      if (result.met && result.reason === "download" && result.files?.length) {
        if (holder) holder.seenDownloads = [...(holder.seenDownloads ?? []), ...result.files.map((f) => f.path)];
        const list = result.files.map((f) => `- ${f.path} (${(f.size / 1024 / 1024).toFixed(1)} MB)`).join("\n");
        return `Download finished after ${waited}s:\n${list}\nSave it for the user now with file_save (path above).`;
      }
      if (result.reason === "crashed") {
        const memory = result.memory?.limitMb ? ` The computer has ${result.memory.limitMb} MB of memory${result.memory.oomKills ? ` and has had to kill ${result.memory.oomKills} process(es) for lack of it` : ""}.` : "";
        return `The browser tab crashed after ${waited}s, most likely out of memory: rendering video in the browser is heavy for the cloud computer.${memory} Retry once, lighter: close every other tab (browser_tabs), reopen the editor page, choose the smallest export quality (720p or lower) and fewer effects if the site offers it, then export and browser_wait again. If it crashes again, stop and tell the user the cloud computer needs more memory (COMPUTER_SIZE=medium); don't switch to another method without asking.`;
      }
      if (result.met) return `Done after ${waited}s (${result.reason === "gone" ? `“${untilGone}” is gone` : result.reason === "text" ? `“${untilText}” is on the page` : "waited"}).${page}`;
      return [
        `Not done after ${waited}s.`,
        result.busy ? "The page is busy (for example rendering a video in the browser); that is normal, don't interrupt it." : "",
        result.partial?.length ? `A download is still in progress: ${result.partial.map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB so far)`).join(", ")}.` : "",
        "If it's still progressing, call browser_wait again; otherwise check the page with browser_read.",
      ].filter(Boolean).join(" ") + page;
    } finally {
      resume();
    }
  }),
});

// ---------- Several steps in one call ----------

type PageElement = NonNullable<BrowserPage["elements"]>[number];

/** The element whose visible label best matches `target`: exact, then starts with, then contains (visible and enabled first). */
export function findElement(elements: PageElement[], target: string): PageElement | null {
  const want = target.replace(/\s+/g, " ").trim().toLowerCase();
  if (!want) return null;
  const usable = [...elements].sort((a, b) => Number(Boolean(a.disabled)) - Number(Boolean(b.disabled)) || Number(Boolean(a.offscreen)) - Number(Boolean(b.offscreen)));
  const label = (e: PageElement) => (e.label ?? "").toLowerCase();
  return usable.find((e) => label(e) === want)
    ?? usable.find((e) => label(e).startsWith(want))
    ?? usable.find((e) => label(e).includes(want))
    ?? null;
}

const STEP_LIMIT = 12;

const browserDoTool = tool({
  name: "browser_do",
  errorFunction: toolError,
  description: "Do several browser steps in ONE call (fill a whole form, click through a menu, type then submit, click Export then wait), instead of one tool call per click. Steps run in order and stop at the first one that fails. Target an element by elementId (ids from the latest page you saw) or, more reliably for later steps, by `target`: its visible label or text (e.g. \"Export\", \"Email\"). Returns the final page, plus a screenshot if you ask for one.",
  parameters: z.object({
    steps: z.array(z.object({
      action: z.enum(["click", "double_click", "type", "select", "key", "scroll", "wait_for_text"]),
      elementId: z.number().int().min(1).nullable(),
      target: z.string().max(120).nullable().describe("Visible label or text of the element, used when elementId is null."),
      value: z.string().max(20000).nullable().describe("type: the text; select: the option; key: Enter, Tab, Escape…; scroll: up or down; wait_for_text: the text to wait for (up to 45 s)."),
      submit: z.boolean().nullable().describe("type: press Enter afterwards."),
    })).min(1).max(STEP_LIMIT),
    screenshot: z.boolean().nullable().describe("Also return a screenshot of the screen at the end (for visual pages, canvas editors, or to check the result)."),
  }),
  execute: async ({ steps, screenshot: wantShot }, rc) => using(rc, `Doing ${steps.length} browser step${steps.length === 1 ? "" : "s"}`, async (lease, context) => {
    const done: string[] = [];
    let page: BrowserPage | null = null;
    let failure: string | null = null;
    const command = <T = BrowserPage>(name: string, args: Record<string, unknown>) =>
      browserCommand<T>(lease, name, args, context.signal, queuedStatus(context, "Doing browser steps"));

    for (const [index, step] of steps.entries()) {
      const label = `${index + 1}. ${step.action}${step.target ? ` “${clip(step.target, 40)}”` : step.elementId ? ` [${step.elementId}]` : ""}`;
      try {
        let id = step.elementId;
        if (id === null && step.target && ["click", "double_click", "type", "select"].includes(step.action)) {
          const current = await command("read", { maxChars: 500 });
          const found = findElement(current.elements ?? [], step.target);
          if (!found) { page = current; throw new Error(`no element labelled “${step.target}” on the page`); }
          id = found.id;
        }
        if (step.action === "click" || step.action === "double_click") {
          if (id === null) throw new Error("give elementId or target");
          page = await command("click", { id, double: step.action === "double_click" });
        } else if (step.action === "type") {
          const result = await command<BrowserPage | { ok: boolean; typed: number }>("type", { id, text: step.value ?? "", submit: Boolean(step.submit), clear: true });
          if ("url" in result) page = result;
        } else if (step.action === "select") {
          if (id === null || !step.value) throw new Error("give the select's elementId or target, and the option as value");
          page = await command("select", { id, value: step.value });
        } else if (step.action === "key") {
          page = await command("key", { key: step.value || "Enter" });
        } else if (step.action === "scroll") {
          page = await command("scroll", { direction: step.value === "up" ? "up" : "down", amount: 0.8 });
        } else {
          if (!step.value) throw new Error("give the text to wait for as value");
          const resume = pauseRunClocks();
          try {
            const result = await command<WaitResult>("wait", { text: step.value, seconds: 45, sinceSeconds: 60, exclude: [] });
            if (!result.met) throw new Error(`“${step.value}” did not appear within 45 s${result.page?.excerpt ? `; the page shows: ${clip(result.page.excerpt, 200)}` : ""}`);
          } finally { resume(); }
        }
        done.push(`${label} ✓`);
      } catch (error) {
        failure = `${label} failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`;
        break;
      }
    }

    const latest = await command("read", { maxChars: 3000 }).catch(() => page);
    if (latest?.url) await touchComputer(lease, { url: latest.url, pageTitle: latest.title ?? null });
    const skipped = failure ? steps.length - done.length - 1 : 0;
    const outcome = failure
      ? `${failure}${skipped ? ` (${skipped} later step${skipped === 1 ? "" : "s"} not run)` : ""}. Look at the page below and continue from here.`
      : `All ${steps.length} steps done.`;
    const summary = [...done, outcome, ...(latest ? ["", describePage(latest)] : [])].join("\n");
    if (!wantShot) return summary;
    return screenshotOutput(await screenshot(lease, context.signal), summary);
  }),
});

// ---------- Long waits ----------

/** A task may wait this many times, so an agent can't keep postponing the same work. */
const MAX_WAITS_PER_TASK = 4;
const WAIT_FIRST_CHECK_MINUTES = 10;
const WAIT_MAX_MINUTES = 90;

const waitForExternalTool = tool({
  name: "wait_for_external",
  // A RunParkedError must end the run, so errors are not turned into tool output here; execute returns its own.
  errorFunction: null,
  description: "Pause this task while a website keeps working for a long time on its own servers (for example Claude building a video, a cloud render). Saves the page and what shows it is ready, ends your run, and turns the cloud computer off. The page is checked every few minutes without you; when it is ready (or the time is up) the task continues in a new run with your `next` instructions. Not for work that runs inside the browser tab (use browser_wait).",
  parameters: z.object({
    title: z.string().min(3).max(120).describe('What you are waiting for, e.g. "Claude to finish the video".'),
    url: z.string().max(2048).nullable().describe("Page that shows the result (e.g. the chat's URL); null uses the current page."),
    readyText: z.string().max(200).nullable().describe("Text that is on the page only once it is ready (case-insensitive), e.g. a Download button's label. Pick text that is not in your own prompt or elsewhere on the page."),
    busyText: z.string().max(200).nullable().describe('Text shown only while it is still working, e.g. "Generating"; ready once it is gone. Give readyText, busyText, or both.'),
    next: z.string().min(10).max(2000).describe("Self-contained instructions for the new run once it is ready, e.g. \"Open the chat, download the finished video, and save it with file_save.\" The new run won't remember this one."),
    firstCheckMinutes: z.number().int().min(1).max(60).nullable().describe(`First check after this many minutes (default ${WAIT_FIRST_CHECK_MINUTES}): about when it could be done.`),
    maxMinutes: z.number().int().min(10).max(240).nullable().describe(`Stop waiting after this many minutes (default ${WAIT_MAX_MINUTES}); the task then continues so you can check the page yourself.`),
  }),
  execute: async (args, rc) => {
    try {
      return await waitForExternal(args, rc);
    } catch (error) {
      if (error instanceof RunParkedError) throw error;
      return toolError(null, error);
    }
  },
});

async function waitForExternal(args: {
  title: string; url: string | null; readyText: string | null; busyText: string | null; next: string; firstCheckMinutes: number | null; maxMinutes: number | null;
}, rc: Ctx | undefined): Promise<string> {
  const context = ctx(rc);
  const readyText = args.readyText?.trim() || null;
  const busyText = args.busyText?.trim() || null;
  if (!readyText && !busyText) return "Error: give readyText (shown once it is ready) or busyText (shown while it is still working), or both.";
  if (!context.taskId) return "Error: waiting is only possible inside a task. Use browser_wait instead.";
  if (await countTaskWaits(context.taskId) >= MAX_WAITS_PER_TASK) {
    return `Error: this task has already waited ${MAX_WAITS_PER_TASK} times. Don't wait again: check the page, and tell the user what is still pending.`;
  }

  // Look once now: it may already be done, and this confirms the page and the texts make sense.
  const seen = await using(rc, `Checking ${clip(args.title, 60)}`, async (lease, c) => {
    if (args.url) await browserCommand(lease, "open", { url: args.url, maxChars: 100 }, c.signal);
    return checkPage(lease, { readyText, busyText }, c.signal, { settleSeconds: args.url ? 8 : 0 });
  });
  if (seen.ready) return `It's already ready (${readyText ? `“${readyText}” is on the page` : `“${busyText}” is gone`}). Don't wait: continue now.${seen.url ? `\n\nPage: ${seen.url}` : ""}`;
  if (seen.signin) return "The page asks to sign in, so nobody could see the result while you wait. Call request_user_action with kind \"login\" first, then wait again.";
  const url = args.url ?? seen.url;
  if (!url || !/^https?:\/\//i.test(url)) return "Error: give the url of the page that shows the result.";

  // With CloudHike Jobs a schedule runs the checks; without it (local development), the open city page runs them.
  if (jobsConfig()) {
    try {
      await ensureWaitSchedule();
    } catch (error) {
      return `Error: the checks couldn't be scheduled (${error instanceof Error ? error.message.slice(0, 300) : "CloudHike Jobs refused the schedule"}). Use browser_wait instead.`;
    }
  }

  const task = await getTask(context.taskId);
  const now = Date.now();
  const wait = await createWait({
    hqId: context.hq.documentId, agentId: context.agentId, taskId: context.taskId, rootTaskId: task?.parentId ?? null,
    title: args.title, url, readyText, busyText, next: args.next, intervalSeconds: waitCheckIntervalSeconds(),
    // A little early, so the schedule's tick in that minute picks it up instead of the one after.
    nextCheckAt: new Date(now + (args.firstCheckMinutes ?? WAIT_FIRST_CHECK_MINUTES) * 60_000 - 45_000).toISOString(),
    deadlineAt: new Date(now + (args.maxMinutes ?? WAIT_MAX_MINUTES) * 60_000).toISOString(),
  });
  await context.report({ activity: waitingActivity(wait, context.hq.timeZone) }).catch(() => undefined);
  throw new RunParkedError(wait);
}

// ---------- Screen ----------

const screenshotTool = tool({
  name: "computer_screenshot",
  errorFunction: toolError,
  description: "Take a screenshot of the whole cloud desktop (1280×800). Use it to check what is on screen or before computer_action.",
  parameters: z.object({}),
  execute: async (_input, rc) => using(rc, "Looking at the screen", async (lease, context) => screenshotOutput(await screenshot(lease, context.signal), "Screenshot of the cloud desktop (1280×800):")),
});

const desktopActionSchema = z.object({
  action: z.enum(["click", "double_click", "right_click", "move", "drag", "scroll", "type", "key", "hotkey"]),
  x: z.number().int().min(0).max(1280).nullable(),
  y: z.number().int().min(0).max(800).nullable(),
  toX: z.number().int().min(0).max(1280).nullable().describe("Drag end."),
  toY: z.number().int().min(0).max(800).nullable(),
  text: z.string().max(5000).nullable().describe("For type: the text. For key: a key name like enter, tab, escape. For hotkey: e.g. ctrl+l."),
  direction: z.enum(["up", "down", "left", "right"]).nullable(),
});
type DesktopActionInput = z.infer<typeof desktopActionSchema>;

function toComputerAction(input: DesktopActionInput): ComputerAction | string {
  const at = (fn: (x: number, y: number) => ComputerAction): ComputerAction | string =>
    input.x === null || input.y === null ? `${input.action} needs x and y.` : fn(input.x, input.y);
  return input.action === "click" ? at((x, y) => ({ type: "click", x, y }))
    : input.action === "double_click" ? at((x, y) => ({ type: "click", x, y, double: true }))
    : input.action === "right_click" ? at((x, y) => ({ type: "click", x, y, button: "right" }))
    : input.action === "move" ? at((x, y) => ({ type: "move", x, y }))
    : input.action === "drag" ? (input.toX === null || input.toY === null ? "drag needs toX and toY." : at((x, y) => ({ type: "drag", x, y, toX: input.toX!, toY: input.toY! })))
    : input.action === "scroll" ? at((x, y) => ({ type: "scroll", x, y, direction: input.direction ?? "down", amount: 3 }))
    : !input.text ? `${input.action} needs text.`
    : input.action === "type" ? { type: "type", text: input.text }
    : input.action === "key" ? { type: "key", key: input.text.toLowerCase() }
    : { type: "hotkey", keys: input.text.toLowerCase() };
}

const computerActionTool = tool({
  name: "computer_action",
  errorFunction: toolError,
  description: "Control the desktop with the mouse and keyboard at screen pixel coordinates (from the latest screenshot), for things outside a web page: native dialogs, file pickers, canvas apps. Give ALL the actions you can already plan from the screenshot in one call (e.g. click a field, type, press enter, click Save); they run in order and ONE screenshot of the result comes back. Don't take a separate computer_screenshot afterwards.",
  parameters: z.object({
    actions: z.array(desktopActionSchema).min(1).max(10),
  }),
  execute: async ({ actions }, rc) => using(rc, "Using the desktop", async (lease, context) => {
    const done: string[] = [];
    for (const [index, input] of actions.entries()) {
      const action = toComputerAction(input);
      if (typeof action === "string") { done.push(`${index + 1}. ${input.action}: not run (${action})`); break; }
      await computerAction(lease, action, context.signal);
      done.push(`${index + 1}. ${input.action} ✓`);
      // A short pause lets menus and dialogs open before the next action; the last one waits a little longer.
      await new Promise((r) => setTimeout(r, index === actions.length - 1 ? 700 : 350));
    }
    return screenshotOutput(await screenshot(lease, context.signal), `${done.join("\n")}\nThe screen now:`);
  }),
});

// ---------- Terminal and files ----------

const OUTPUT_FOR_MODEL = 12_000;

const terminalTool = tool({
  name: "terminal_run",
  errorFunction: toolError,
  description: `Run a bash command on the cloud computer as root (Debian with python3, node, curl, ffmpeg if installed via apt). Default folder ${COMPUTER_WORKSPACE}. Returns the exit code and output (last 12,000 characters).`,
  parameters: z.object({
    command: z.string().min(1).max(8000),
    timeoutSeconds: z.number().int().min(1).max(120).nullable().describe("Up to 120 seconds; run longer jobs in the background (nohup … &) and check on them."),
    cwd: z.string().max(500).nullable(),
  }),
  execute: async ({ command, timeoutSeconds, cwd }, rc) => using(rc, `Running ${clip(command.split("\n")[0], 50)}`, async (lease, context) => {
    const dir = resolvePath(cwd);
    const { exitCode, output } = await exec(lease, `mkdir -p ${shellQuote(dir)} && cd ${shellQuote(dir)} && ${command}`, context.signal, timeoutSeconds ?? 120);
    const tail = output.length > OUTPUT_FOR_MODEL ? `…(${output.length - OUTPUT_FOR_MODEL} earlier characters cut)\n${output.slice(-OUTPUT_FOR_MODEL)}` : output;
    return `Exit code ${exitCode}\n${tail || "(no output)"}`;
  }),
});

const filesListTool = tool({
  name: "files_list",
  errorFunction: toolError,
  description: `List a folder on the cloud computer (default ${COMPUTER_WORKSPACE}).`,
  parameters: z.object({ path: z.string().max(500).nullable() }),
  execute: async ({ path }, rc) => using(rc, "Listing files", async (lease, context) => {
    const dir = resolvePath(path);
    const { exitCode, output } = await exec(lease, `mkdir -p ${COMPUTER_WORKSPACE}; find ${shellQuote(dir)} -mindepth 1 -maxdepth 1 -printf '%y %s %TY-%Tm-%Td %TH:%TM %f\\n' | sort -k5 | head -300`, context.signal);
    if (exitCode !== 0) return `Couldn't list ${dir}: ${output.trim()}`;
    return `${dir}\n${output.trim().split("\n").filter(Boolean).map((l) => { const [type, size, date, time, ...name] = l.split(" "); return `${type === "d" ? "📁" : "  "} ${name.join(" ")}${type === "d" ? "/" : ` (${size} B)`} ${date} ${time}`; }).join("\n") || "(empty)"}`;
  }),
});

const fileReadTool = tool({
  name: "file_read",
  errorFunction: toolError,
  description: "Read a text file from the cloud computer.",
  parameters: z.object({ path: z.string().min(1).max(500), maxChars: z.number().int().min(100).max(50000).nullable() }),
  execute: async ({ path, maxChars }, rc) => using(rc, "Reading a file", async (lease, context) => {
    const text = (await readComputerFile(lease, resolvePath(path), context.signal, 2 * 1024 * 1024)).toString("utf8");
    const max = maxChars ?? 20000;
    return text.length > max ? `${text.slice(0, max)}\n…(${text.length - max} more characters)` : text || "(empty file)";
  }),
});

const fileWriteTool = tool({
  name: "file_write",
  errorFunction: toolError,
  description: "Create or overwrite a text file on the cloud computer (folders are created).",
  parameters: z.object({ path: z.string().min(1).max(500), content: z.string().max(500_000) }),
  execute: async ({ path, content }, rc) => using(rc, "Writing a file", async (lease, context) => {
    const full = resolvePath(path);
    await writeComputerFile(lease, full, new TextEncoder().encode(content), context.signal);
    return `Saved ${full} (${content.length} characters).`;
  }),
});

const fileDownloadTool = tool({
  name: "file_download",
  errorFunction: toolError,
  description: "Download a file from an http(s) URL onto the cloud computer (for example an artifact's URL, so you can edit or upload it elsewhere).",
  parameters: z.object({ url: z.string().min(1).max(2048), path: z.string().max(500).nullable().describe("Where to save it; default: the workspace with the URL's file name.") }),
  execute: async ({ url, path }, rc) => using(rc, "Downloading a file", async (lease, context) => {
    if (!/^https?:\/\//i.test(url)) return "Only http(s) URLs can be downloaded.";
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "download").replace(/[^\w.-]+/g, "_") || "download";
    const full = path ? resolvePath(path) : `${COMPUTER_WORKSPACE}/${name}`;
    const { exitCode, output } = await exec(lease, `mkdir -p "$(dirname ${shellQuote(full)})" && curl -fsSL --connect-timeout 15 --max-time 110 -o ${shellQuote(full)} ${shellQuote(url)} && stat -c %s ${shellQuote(full)}`, context.signal, 120);
    return exitCode === 0 ? `Downloaded to ${full} (${output.trim()} bytes).` : `Download failed: ${output.trim().slice(-300)}`;
  }),
});

/** File types the media library accepts (see the Strapi project's config/plugins.ts); text formats go up as plain text. */
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", aac: "audio/aac",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  pdf: "application/pdf", csv: "text/csv", txt: "text/plain", md: "text/plain", json: "text/plain", html: "text/plain",
  srt: "text/plain", vtt: "text/plain", log: "text/plain", xml: "text/plain", yaml: "text/plain", yml: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const TEXT_TYPES = new Set(["text/csv", "text/plain"]);

const fileSaveTool = tool({
  name: "file_save",
  errorFunction: toolError,
  description: "Keep a file from the cloud computer for the user: uploads it to the media library and shows it as an artifact (Artifacts page and chat). Use it for every finished file: audio, video, images, PDFs, spreadsheets. Up to 25 MB.",
  parameters: z.object({
    path: z.string().min(1).max(500),
    title: z.string().min(1).max(160),
    summary: z.string().max(300).nullable(),
  }),
  execute: async ({ path, title, summary }, rc) => using(rc, `Saving “${clip(title, 40)}”`, async (lease, context) => {
    const full = resolvePath(path);
    const ext = full.split(".").pop()?.toLowerCase() ?? "";
    const mime = MIME[ext];
    if (!mime) return `Files of type .${ext || "(none)"} can't be kept as artifacts. Convert it first with terminal_run (for example to PDF, PNG, MP3, MP4, CSV, or TXT).`;
    const bytes = await readComputerFile(lease, full, context.signal);
    const file = await uploadToMediaLibrary(bytes, `${slug(title)}${ext ? `.${ext}` : ""}`, mime, { caption: title, signal: context.signal });
    const type = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : "document";
    const category = type === "image" ? "image" : type === "audio" ? "voiceover" : "other";
    const content = TEXT_TYPES.has(mime) ? bytes.toString("utf8").slice(0, 60_000) : `[${title}](${file.url})\n\nSaved from the cloud computer: \`${full}\` (${(bytes.length / 1024).toFixed(0)} KB, ${mime}).`;
    const artifact = await recordArtifact(context, {
      title, type, category, mimeType: mime, url: file.url, summary: summary ?? `${ext.toUpperCase() || "File"} · ${(bytes.length / 1024).toFixed(0)} KB · from the cloud computer`,
      content, data: { source: "computer", path: full, size: bytes.length },
    });
    return JSON.stringify({ url: file.url, artifactId: artifact?.documentId ?? null, bytes: bytes.length, mimeType: mime });
  }),
});

// ---------- Asking the user ----------

const requestUserActionTool = tool({
  name: "request_user_action",
  errorFunction: toolError,
  description: "Ask the user to do something on the cloud computer that you must not or cannot do: sign in to a website, solve a captcha, enter a 2-factor code, approve a payment. Opens the page, shows the user a prompt with the live screen, waits until they finish (sign-ins and captchas are detected automatically), and returns the page so you can continue.",
  parameters: z.object({
    kind: z.enum(["login", "captcha", "action"]),
    service: z.string().max(80).nullable().describe("Site or service, e.g. ElevenLabs."),
    url: z.string().max(2048).nullable().describe("Page to open first, e.g. the sign-in page; null keeps the current page."),
    instructions: z.string().min(1).max(500).describe("What the user should do, in one or two sentences."),
  }),
  execute: async ({ kind, service, url, instructions }, rc) => using(rc, "Asking you for help", async (lease, context) => {
    if (url) await browserCommand(lease, "open", { url, maxChars: 100 }, context.signal).catch(() => undefined);
    const before = await browserCommand<BrowserPage>(lease, "status", {}, context.signal).catch(() => null);
    const title = kind === "login" ? `Sign in to ${service ?? "continue"}` : kind === "captcha" ? `Solve the captcha${service ? ` on ${service}` : ""}` : clip(instructions, 100);
    await touchComputer(lease, { activity: `Waiting for you: ${title}`, ...(before ? { url: before.url, pageTitle: before.title } : {}) });
    // A sign-in is done once the sign-in form is gone and the page moved on; a captcha once it is gone.
    const detect = before && kind !== "action" && (kind === "login" ? before.signals?.loginForm : before.signals?.captcha) ? async () => {
      const now = await browserCommand<BrowserPage>(lease, "status", {}, context.signal);
      return kind === "login" ? !now.signals?.loginForm && now.url !== before.url : !now.signals?.captcha;
    } : undefined;
    const result = await askUser(context, { kind, title, message: instructions, url: before?.url ?? url, service }, { detect, onTick: () => touchComputer(lease) });
    await touchComputer(lease, { activity: "Using the computer" });
    if (result.status === "resolved") {
      const page = await browserCommand(lease, "read", { maxChars: 2500 }, context.signal).catch(() => null);
      return `${result.response?.detected ? "Detected that the user finished." : "The user says they finished."} Continue the task.${page ? `\n\n${describePage(page)}` : ""}`;
    }
    if (result.status === "expired") return "The user did not respond in time. Stop this part of the task and tell them what still needs their sign-in or action.";
    return "The user declined. Don't ask again; explain what you couldn't do without it.";
  }),
});

const askUserTool = tool({
  name: "ask_user",
  errorFunction: toolError,
  description: "Ask the user a question and wait for the answer: with options it is a choice shown as buttons (to pick a service, tool, or website, or for a real decision); with no options it is an open question the user answers in a sentence. With a capability key, the user's previous choice is reused unless you set reuseChoice to false.",
  parameters: z.object({
    question: z.string().min(1).max(160),
    details: z.string().max(400).nullable().describe("One sentence of context shown under the question."),
    capability: z.string().max(80).nullable().describe('What the choice is for, e.g. "voice_generation", so it can be remembered.'),
    options: z.array(z.object({
      id: z.string().min(1).max(40).describe('Short ID, e.g. "elevenlabs".'),
      label: z.string().min(1).max(60),
      description: z.string().max(140).nullable(),
    })).max(6).describe("2–6 options for a choice, or an empty list for an open question."),
    allowOther: z.boolean().describe("Let the user type another answer (always on for an open question)."),
    reuseChoice: z.boolean().nullable(),
  }),
  execute: async ({ question, details, capability, options, allowOther, reuseChoice }, rc) => {
    const context = ctx(rc);
    if (options.length === 1) return "Error: give at least 2 options, or none for an open question.";
    const key = capability && options.length ? capabilityKey(capability) : null;
    if (key && reuseChoice !== false) {
      const previous = await rememberedChoice(context.hq.documentId, key).catch(() => null);
      const id = previous?.response?.optionId;
      if (previous && id) {
        const label = previous.options.find((o) => o.id === id)?.label ?? previous.response?.text ?? id;
        return JSON.stringify({ choice: id, label, text: previous.response?.text ?? null, remembered: true, note: "The user chose this before for the same capability; use it. Call again with reuseChoice false only if it doesn't work." });
      }
    }
    await context.report({ activity: `Asking: ${clip(question, 80)}` });
    const result = await askUser(context, {
      kind: "choice", title: question, message: details, capability: key,
      options: options.map((o) => ({ id: o.id, label: o.label, ...(o.description ? { description: o.description } : {}) })), allowOther: allowOther || !options.length,
    });
    if (result.status !== "resolved" || !result.response) {
      return result.status === "expired" ? "The user did not answer in time. Choose the most sensible option yourself and say so, or stop and explain." : "The user dismissed the question. Don't ask again; explain what you need.";
    }
    const id = result.response.optionId ?? "other";
    const label = options.find((o) => o.id === id)?.label ?? result.response.text ?? id;
    return JSON.stringify({ choice: id, label, text: result.response.text ?? null });
  },
});

const confirmActionTool = tool({
  name: "confirm_action",
  errorFunction: toolError,
  description: "Ask the user to approve an action before you take it (shown with Approve and Decline buttons) and wait for the answer. Use it before anything hard to undo or that other people will see: publishing or posting, sending, scheduling, paying, deleting, changing account settings. Returns approved true/false and any feedback the user typed.",
  parameters: z.object({
    action: z.string().min(1).max(160).describe('What you are about to do, e.g. "Publish “AI note-taking apps” to YouTube as public".'),
    details: z.string().max(600).nullable().describe("What exactly will happen: where, when, to whom, and with which content."),
    service: z.string().max(80).nullable().describe("Site or service involved, e.g. YouTube."),
  }),
  execute: async ({ action, details, service }, rc) => {
    const context = ctx(rc);
    await context.report({ activity: `Waiting for approval: ${clip(action, 70)}` });
    const result = await askUser(context, { kind: "confirm", title: action, message: details, service, options: CONFIRM_OPTIONS, allowOther: true });
    if (result.status !== "resolved" || !result.response) {
      return JSON.stringify({ approved: false, reason: result.status === "expired" ? "The user did not answer in time. Don't do it; tell them it is waiting for their approval." : "The user dismissed the request. Don't do it." });
    }
    const { optionId, text } = result.response;
    if (optionId === "approve") return JSON.stringify({ approved: true });
    if (optionId === "decline") return JSON.stringify({ approved: false, reason: "The user declined. Don't do it." });
    return JSON.stringify({ approved: false, feedback: text ?? null, reason: "The user asked for changes instead of approving. Apply their feedback, then ask again before doing it." });
  },
});

export const computerTools = [
  browserSearchTool, browserOpenTool, browserReadTool, browserClickTool, browserTypeTool, browserSelectTool, browserKeyTool, browserScrollTool,
  browserDoTool, browserHistoryTool, browserTabsTool, browserExtractTool, browserUploadTool, browserWaitTool, waitForExternalTool, screenshotTool, computerActionTool, terminalTool, filesListTool, fileReadTool,
  fileWriteTool, fileDownloadTool, fileSaveTool, requestUserActionTool,
];

export { askUserTool, confirmActionTool };
