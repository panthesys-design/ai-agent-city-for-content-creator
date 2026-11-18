# Agent runtime

[Documentation home](README.md) · [Architecture](architecture.md)

Every agent building is an independent AI agent built with the [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/) (`@openai/agents`). Headquarters is the master agent that plans work and delegates it. Everything runs on the server; the browser only sees status, progress, and chat.

## Agent configuration

An agent's Strapi record holds its name and instructions (edited with **Customize**) and its AI configuration (edited with **AI settings** on the building's popover or the chat header):

| Field | Meaning |
| --- | --- |
| `role` | research, script, voice, media, editor, publisher, or custom. Adds a role playbook for how to use shared memory. |
| `model` | Model ID for the active provider; empty (or a model of the other provider) uses the provider default (see [LLM provider](#llm-provider)). |
| `tools` | `memory`, `web_search`, `computer` (the [cloud computer](cloud-computer.md): browser, terminal, files), `voiceover`, `image` (`generate_image`), `image_edit` (`transform_image`), `video_timeline`, `publish_schedule`. Every agent (and headquarters) also has `list_artifacts` and `read_artifact` (find and open any saved artifact or upload), `ask_user` (a choice shown as buttons, or an open question with no options), and `confirm_action` (approval before an outward-facing action); agents also have `report_progress` and `save_artifact`. |
| `settings` | `maxTurns`, `timeoutSeconds`, `reasoningEffort`. |
| `enabled` | Disabled agents can't chat or receive delegated work. |

The six starter agents get their role and default tools when seeded. Agents saved before this runtime existed get them on read. Agents saved before `image_edit` existed keep their saved tools; turn it on in **AI settings**.

## LLM provider

`AI_PROVIDER` picks the model provider for every agent and headquarters run (`configureAgentProvider()` and `agentModel()` in `lib/ai/env.ts`):

| `AI_PROVIDER` | Key | Default model | Notes |
| --- | --- | --- | --- |
| `openai` (default) | `OPENAI_API_KEY` | `OPENAI_DEFAULT_MODEL` / SDK default; HQ: `OPENAI_ORCHESTRATOR_MODEL` | Responses API, hosted `web_search`, OpenAI tracing. |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`); HQ: `ANTHROPIC_ORCHESTRATOR_MODEL` | Same Agents SDK loop, pointed at Anthropic's [OpenAI-compatible endpoint](https://platform.claude.com/docs/en/api/openai-sdk) with Chat Completions. Hosted `web_search` is skipped (agents with `computer` browse instead), `reasoningEffort` is ignored, tracing is off, and there is no prompt caching. |

An agent's saved `model` is used only when it belongs to the active provider (`claude-*` for Anthropic, anything else for OpenAI), so switching providers never sends a GPT model ID to Anthropic or the reverse. Voiceover and OpenAI image generation always use OpenAI and still need `OPENAI_API_KEY`.

## Current date

Models only know the world up to their training data and otherwise assume it is still that time. Every agent and headquarters therefore starts its instructions with the real date and time (`dateRules()` in `lib/ai/clock.ts`, built fresh for each run, in the headquarters' time zone from the Settings page (`timeZone` on its record) or, when none is set, the server's). Rules tell them that "today", "latest", and "trending" are relative to that date, to use live sources for anything current, and not to put guessed months or years into search queries. Headquarters writes the date into time-sensitive step instructions. `browser_search` takes `recency` (`day`, `week`, `month`, mapped to each engine's date filter). Its results say when they were searched, and they carry a note when the query names an earlier year.

## Headquarters orchestration

A message to headquarters creates a task and returns immediately. Headquarters plans one request at a time, but requests run side by side once they have handed work to their agents. A request sent while another is still planning (it hasn't given any step to an agent yet) waits in a queue: **Current Work Progress** lists it under **Up next** with a remove button, and the chat says how many are waiting. As soon as every running request has delegated its first step, the next one starts by itself, oldest first. Other running requests are listed under **Also in progress**, each with a stop button.

Each agent does one thing at a time. When a step's agent is busy (with another request's step, a standalone task, or a chat), the step is **queued for the agent**. The child task is saved with its full input, and the plan step stays active with `waitingFor` "<agent> to be free". `run_step` tells headquarters the step is waiting, and the request pauses, as with a [long wait](cloud-computer.md#long-waits). When the agent is free (`startWorkForAgent` in `lib/ai/task-runner.ts`, called whenever an agent's run ends or pauses and after a chat), the oldest waiting step starts in its own run, with a fresh chat for the agent. When it finishes, its plan step is updated and the request is queued again to continue its plan. An agent paused on a website counts as free. If its website is ready while it is busy, the resume waits for the agent the same way. Claims are written first and checked after (`lib/ai/agent-availability.ts`): of an agent's busy tasks, the oldest holds it, and a newer one steps back and waits.

The queue lives in `agent-tasks`: a waiting request is a root headquarters task with status `queued` and no `jobRunId`. `runHeadquartersQueue` (`lib/ai/task-runner.ts`) starts the oldest one when no request is planning (`isPlanningRequest` in `lib/task-records.ts`: dispatched but not started, or running with no step handed out). It runs again when a request hands out its first step, when a run ends, and from the sweeps. With CloudHike Jobs it dispatches one run at a time, and `/api/jobs/agent-task` (or the failed-run webhook) keeps it going. The live stream's periodic sweep restarts a queue left waiting by a crash. A queued request becomes **running** when it starts; only then are idle agents' statuses cleared.

The orchestrator:

1. reads shared memory for project context,
2. calls `plan_work` with steps (`agent`, `title`, `dependsOn`); the plan is saved on the task and drawn in **Current Work Progress**,
3. calls `run_step` per step. A step only starts when its dependencies are done (enforced in code); independent steps may run in parallel. Each step is a child task run by that agent,
4. summarizes the result into the headquarters conversation (its current one, so a chat cleared mid-task still gets the reply).

Each agent in the plan starts the task with a fresh chat, and when its step ends the result (with its artifacts) is posted there as **Headquarters task: …**. Clicking the building shows what the agent did for this task, and the user can follow up with it directly.

## Shared memory (Strapi MCP)

Agents pass work to each other through the `memories` collection: Research saves findings → Script reads them and saves a script → Voice and Media read the script and save audio/images → Video Editor builds a timeline → Publisher prepares the publication.

Agents only read shared memory when they work together: a step of a headquarters plan runs with `team: true` (`runCityAgent` in `lib/ai/run-agent.ts`), which opens memory and adds the role playbook. A direct chat with one agent (and a standalone agent task) runs without memory tools or the playbook, with chat rules instead: greetings and questions get a plain reply, and the agent uses its tools only when the user asks it to make something. Tools such as `generate_image` still save their results to memory, so later team work can find them. Headquarters answers greetings without memory or planning.

Memory goes through Strapi's MCP server (`/mcp`, admin-token authenticated). The Strapi project registers four tools: `memory_save`, `memory_search`, `memory_get`, and `memory_update`. Isolation works like this:

- The Next.js server signs `{hq, agent, task, exp}` with `MEMORY_SCOPE_SECRET` into the `x-creator-city-scope` header of each MCP connection. Strapi verifies it and filters every query by that headquarters. Tool arguments never choose the headquarters.
- Only the four memory tools are exposed to models (`createMCPToolStaticFilter`), never Strapi's generic content-manager tools.
- The admin token and secret never leave the server.

Without `STRAPI_MCP_TOKEN`, or if MCP is unreachable, the same tools run against Strapi's REST API with the headquarters filter applied server-side.

## Images (ImageKit AI)

Strapi's media library stores files on ImageKit (Strapi's ImageKit upload plugin). The image tools use [ImageKit AI transformations](https://imagekit.io/docs/ai-transformations) and save every result back to that library:

- **`generate_image`** (tool key `image`): text-to-image with `ik-genimg`, using a unique path per call because ImageKit caches by path. `aspectRatio` `landscape`/`portrait` adds a 1280×720 or 720×1280 smart crop. Without `IMAGEKIT_URL_ENDPOINT` (or with `IMAGE_PROVIDER=openai`), the tool falls back to OpenAI (`OPENAI_IMAGE_MODEL`).
- **`transform_image`** (tool key `image_edit`): one operation on an existing image, which is kept unchanged:

  | Operation | ImageKit transformation |
  | --- | --- |
  | `remove_background` | `e-bgremove` (or `e-removedotbg` with `highQuality`), PNG |
  | `change_background` / `edit` | `e-changebg` / `e-edit` with a base64 `prompte-` prompt |
  | `generative_fill` | `bg-genfill` to `width`×`height` (`cm-pad_resize`), optional prompt |
  | `drop_shadow` | `e-removedotbg:e-dropshadow`, optional azimuth/elevation/saturation, PNG |
  | `retouch` / `upscale` / `variation` | `e-retouch` / `e-upscale` / `e-genvar` |
  | `smart_crop` | `w-…,h-…,fo-auto` / `fo-face` / `fo-<object>` |

  The source is a `sourceAssetId` looked up in **this headquarters'** `media-assets`, or a `sourceImageUrl` that must be HTTPS under `IMAGEKIT_URL_ENDPOINT`. Arbitrary URLs are refused, so the server never fetches other hosts.

ImageKit answers slow AI work with `is-intermediate-response: true`. `lib/ai/imagekit.ts` polls with backoff for up to 2.5 minutes and honors Stop and timeouts. Each result is uploaded through `/api/upload` with alt text and a caption, recorded in `media-assets`, and saved to memory (kind `media`, `data.imageUrl` and `data.assetId`), and the tool returns `{ imageUrl, assetId, memoryId, width, height }`. If `media-assets` is missing or forbidden, the image is still uploaded and saved to memory, `assetId` is null, and a warning is logged.

With `IMAGEKIT_PRIVATE_KEY` set, every ImageKit request is signed (`ik-t`/`ik-s`), which ImageKit requires when **Restrict unsigned URLs** is on (ImageKit recommends it for AI transformations in production). AI transformations consume ImageKit extension units; failed ones are cached for a few minutes.

### `media-assets` collection

Collection type **Media Assets** (singular `media-asset`, plural `media-assets`, REST `/api/media-assets`, Draft & Publish off). The API token needs find/create on Media Asset and upload on Upload.

| Field | Strapi type | Values |
| --- | --- | --- |
| `title` | Short text, required, max 160 | |
| `operation` | Enumeration, required | `text_to_image`, `remove_background`, `change_background`, `edit`, `generative_fill`, `drop_shadow`, `retouch`, `upscale`, `variation`, `smart_crop` |
| `provider` | Enumeration, required, default `imagekit` | `imagekit`, `openai` |
| `purpose` | Enumeration, default `graphic` | `thumbnail`, `scene`, `graphic`, `product`, `social`, `other` |
| `prompt`, `transformation`, `sourceUrl` | Long text | Prompt, ImageKit chain, source image URL |
| `url` | Long text, required | Media-library URL of the result |
| `width`, `height` | Integer | |
| `file` | Media, single, images, required | The uploaded file |
| `source` | Relation: many-to-one Media Asset | The image this one was transformed from |
| `headquarter` / `agent` / `task` | Relation: many-to-one | Ownership and provenance |

## Artifacts

Artifacts are the deliverables a user keeps. Each is a record in Strapi's `artifacts` collection, shown on the **Artifacts** page (`/dashboard/artifacts`) and as preview cards in chat. Answers to simple questions are not artifacts.

| Produced by | Type / category | Preview |
| --- | --- | --- |
| `save_artifact` (every agent) | `document` / `script`, `research`, `topics`, `outline`, `copy`, `other` | Markdown rendered as a document; copy and download as `.md` |
| `generate_image`, `transform_image` | `image` / `image` (linked to its `media-assets` record) | Image with its prompt |
| `generate_voiceover` | `audio` / `voiceover` | Audio player with the script |
| `build_video_timeline` | `video` / `timeline` | Storyboard: scene images, captions, narration, per-scene audio |
| `prepare_publication` | `document` / `publication` | Title, platform, publish time, description, tags |

How it flows:

1. A tool saves the deliverable (file to the media library, text to memory) and then calls `recordArtifact` (`lib/ai/artifact-tools.ts`), which writes the `artifacts` record with the headquarters, agent, and task. `save_artifact` also writes the text to memory (`script` → `script`, `research`/`topics` → `research`, others → `note`), so the pipeline still reads it with `memory_search`. The role playbooks tell Research and Script to save through `save_artifact` instead of `memory_save`. Recording an artifact never fails the tool: if the collection is missing, it logs a warning.
2. **Direct chat** streams `{type:"artifact", artifact}` the moment a tool saves one, so cards appear while the agent keeps working. The finished reply stores the snapshots in the message's `metadata.artifacts`, so they reappear when the chat reloads. A stopped or failed run still saves a message with whatever was produced.
3. **Headquarters**: while a task runs, `/api/city/stream` adds the artifacts its delegated steps have saved so far (`task.artifacts`), which the chat shows as **Delivered so far**. When it finishes, the summary message stores every artifact of the task and its child tasks.
4. Agent replies render as Markdown (`react-markdown` + `remark-gfm`; raw HTML is not rendered). A card opens the full preview in a dialog, or the folder button opens it on the Artifacts page (`?id=`).

The Artifacts page is a file explorer: a folder tree by type (Documents, Images, Audio, Video) and by agent, a grid or list (`?view=list`), search, sort, and a preview pane (a sheet on narrow screens). **Upload** (or dropping files on the file area) adds files through the same `POST /api/uploads` route as chat attachments. Each grid tile and list row has a delete button (with a confirm step), as does the preview pane. Deleting an artifact removes only the record; its file stays in the media library and its memory stays shared. The page reads up to 500 artifacts, newest first.

### `artifacts` collection

Collection type **Artifacts** (singular `artifact`, plural `artifacts`, REST `/api/artifacts`, Draft & Publish off), defined in the Strapi project at `src/api/artifact/`. The API token needs find, findOne, create, and delete on Artifact.

| Field | Strapi type | Values |
| --- | --- | --- |
| `title` | Short text, required, max 160 | |
| `type` | Enumeration, required, default `document` | `document`, `image`, `audio`, `video` |
| `category` | Enumeration, required, default `other` | `script`, `research`, `topics`, `outline`, `copy`, `publication`, `timeline`, `image`, `voiceover`, `upload`, `other` |
| `mimeType` | Short text, max 120 | e.g. `text/markdown`, `image/png`, `audio/mpeg` |
| `summary` | Short text, max 300 | One line for cards; defaults to the start of `content` |
| `content` | Long text | Markdown document, image prompt, voiceover script, or timeline storyboard |
| `url` | Long text | Media-library URL of the file (for a timeline, its first scene image) |
| `data` | JSON | Structured extras: timeline scenes, publishing fields, image size, voice |
| `memoryId` | Short text, max 64 | The memory that shares this deliverable with other agents |
| `mediaAsset` | Relation: many-to-one Media Asset | For images |
| `headquarter` / `agent` / `task` | Relation: many-to-one | Ownership and provenance |

## Artifacts, uploads, and attachments

Every agent and headquarters can reach the city's saved work across tasks and chats:

- **`list_artifacts`** searches this headquarters' artifacts, newest first, by words (title, summary, content), `type`, `category` (`upload` = user files), or the current task. Each line gives the `artifactId` and file `url`.
- **`read_artifact`** opens one: the full text of a document (paged with `offset` beyond 20,000 characters), the data of a timeline or package, and the file URL. An image is also shown to the model.

**Uploads.** The chat composer attaches files with the paperclip, drag and drop, or paste. Up to 10 files per message and 25 MB each are allowed: images, video, audio, PDF, text/Markdown/CSV/JSON, and Word/Excel/PowerPoint (`lib/upload-records.ts`). Each file goes to `POST /api/uploads`, which stores it in the media library and records an artifact with category `upload` (text files keep their content, so agents read them without downloading). Uploads appear on the Artifacts page like any deliverable, and files can be uploaded there directly too.

**Attachments.** A message's attachments are saved in its `metadata.attachments` and shown as cards above the user's bubble. The model gets a note listing each attachment (title, `artifactId`, url), and in a direct chat it also sees attached images. A headquarters request carries the same note in the task input, and headquarters passes the IDs to the agents that need them. Earlier attachments stay in the chat history as references. Images are fetched by the server (only from the media library or ImageKit) and sent as data, so a local Strapi works too.

## Questions, approvals, and generative UI

Agents ask the user through `agent-requests`, and the user can answer from wherever they are:

| Tool | Request | Shown as |
| --- | --- | --- |
| `ask_user` with options | `choice` | Option buttons (plus a text field when `allowOther`). With a `capability` key, the answer is reused next time. |
| `ask_user` with no options | `choice`, no options | An open question with a text field |
| `confirm_action` | `confirm` | **Approve** / **Decline**, plus a field to ask for changes. The tool returns `approved` and any feedback |
| `request_user_action` | `login`, `captcha`, `action` | **Open computer** / **Done** (see [Cloud computer](cloud-computer.md)) |
| `request_connection` | `connect` | **Connect *App*** (sign-in popup), **Give access**, or **Allow posting**; resolves by itself once the agent can use the app (see [Connected accounts](accounts.md#the-connect-card-generative-ui)) |

Agents are told to confirm before anything hard to undo or that other people will see: publishing, posting, sending, scheduling, paying, deleting, or changing account settings. They should not confirm routine work. When they are unsure which tool, service, or website to use, they ask. Headquarters can ask too, for example before planning an ambiguous request; its questions sit on the headquarters building.

A pending request shows in four places at once:

- the agent's chat;
- the headquarters chat, which shows the whole team's requests, so a question from a delegated step reaches headquarters as well;
- a bubble above the agent's building (`AgentCity` `callouts`), which opens that chat when clicked;
- the **Needs you** header button.

In the agent's chat, typing in the composer answers its pending question. For an approval, “yes”/“ok”/“approve” approves and “no”/“decline” declines. Anything else is sent as feedback. The agent continues by itself once any of these is answered.

## Conversations: Clear chat and fresh tasks

Each agent and headquarters can have several conversations; the newest is the chat. Nothing is deleted:

- **Clear chat** (eraser button in the chat header) starts a new, empty conversation. Earlier messages no longer show and no longer reach the model.
- **New tasks start fresh.** A headquarters request sent after a finished request that had a plan starts a fresh headquarters chat. Each agent in the new plan also starts a fresh chat. Greetings and questions stay in the current chat, and so do requests that queue behind running work.
- **What persists:** artifacts, uploads, shared memory, tasks and their events, agent settings, and remembered choices. Agents reach earlier work with `list_artifacts`/`read_artifact` and memory, not the chat.

The live stream sends each chat's current `conversationId:latestMessageId` (`threads`). An open chat reloads when its value changes: a new conversation replaces the log, and a new message (a headquarters reply, a step result) is merged in.

## Cloud computer and asking the user

Agents with the `computer` tool use a CloudHike cloud computer (Chrome with the user's saved sign-ins, a terminal, and files). It starts on their first computer tool call and shuts down when their run ends. When an agent needs the user, it saves an agent request and waits. The user may need to sign in on the computer, solve a captcha, or pick a service for a capability no tool covers (`ask_user`, for example "Which service should I use for voice generation?"). Meanwhile the building shows **Needs you** (status `waiting`) and the City header shows the request. The run's time limit is paused, and the agent continues by itself once the request is answered. See [Cloud computer](cloud-computer.md).

## Execution, streaming, cancellation

- **Direct chat** (`POST /api/agents/[agentId]/chat`, body `{ message, attachments? }`) streams Server-Sent Events: the saved user message, text deltas, tool activity, artifacts as they are saved, and the saved reply. **Stop** aborts the request, which aborts the SDK run (`signal`).
- **Conversation memory**: every chat turn sends the model that thread's last 20 saved messages (`CHAT_HISTORY_MESSAGES` and `chatInput()` in `lib/ai/run-agent.ts`) before the new message, so follow-ups like "make it shorter" resolve. This applies to direct chat and to headquarters (`headquartersInput()` in `lib/ai/orchestrator.ts`, which drops the request's own saved message). Saved replies longer than 4,000 characters are trimmed in the history. Delegated steps still get self-contained instructions, not the chat.
- **Chat paging**: the chat panel loads the newest 10 messages (`loadConversationAction`). Scrolling to the top, or **Load earlier messages**, fetches the 10 before the oldest one shown (`before` = its `createdAt`, via `listMessagePage()`) and keeps the scroll position.
- **Headquarters tasks** run in the background. With `JOBS_API_URL`, `JOBS_API_KEY`, and a public `APP_PUBLIC_URL`, they are dispatched as [CloudHike Jobs](https://cloudhike.dev/docs/jobs) runs that call `POST /api/jobs/agent-task` (signature-verified, at most once per task, `retries: 0`). `POST /api/jobs/webhook` marks tasks whose run failed or timed out. Otherwise (for example on localhost) they run in-process with `after()`. A task whose agent waits for a website (`wait_for_external`) stays running without a run; a CloudHike Jobs schedule calls `POST /api/jobs/external-waits` to check the page and resumes the task with `POST /api/jobs/agent-task` and a `waitId` (see [Long waits](cloud-computer.md#long-waits)).
- Time limits (`RunClock` in `lib/ai/run-clock.ts`) pause while an agent waits for the user. Chat streams send keep-alive comments meanwhile.
- **Stop** on a headquarters task sets `cancelRequested`; the runner polls it every 3 seconds and aborts the run and any delegated steps.
- **Clear** appears on the work progress card once the headquarters task has stopped, completed, or failed. It sets the task's `progressCleared` (boolean, default `false`), and the card shows "No active task" until the next request. The task, its chat, and its artifacts stay saved.
- A call to a tool the agent doesn't have (a model inventing `browser_screenshot`, say) doesn't fail the run: `streamAgent` returns an error listing the agent's real tools to the model, which retries.
- Every run has a time limit (agent `timeoutSeconds`; `TASK_TIMEOUT_SECONDS` for tasks, capped by the job timeout). Tasks left running by a crashed server are failed by a periodic sweep.
- `GET /api/city/stream` pushes each agent's status (`idle`, `working`, `waiting`, `completed`, `failed`), progress, and activity, the current headquarters task and plan, the queue behind it, each chat's current thread, the cloud computer's state, and pending agent requests to the City page.
- When a task starts (a headquarters request or a direct agent chat), every agent that isn't working is reset to a plain `idle` with no progress or activity, so only the agents doing the new work show a status. Agents still working on another run keep theirs.

## Persistence (Strapi collections)

| Collection | Holds |
| --- | --- |
| `agents` | Configuration plus live `status`, `progress`, `activity` |
| `agent-tasks` | Headquarters tasks, delegated steps, and chat runs: input, status, plan, output, error, usage, job run ID, `progressCleared`, `paused` (Boolean, default false: a running request with no run while its steps wait) |
| `task-events` | Execution history: started, tool calls and outputs, delegations, outcome |
| `conversations` / `chat-messages` | Chat threads per agent and for headquarters (the newest is the current chat). Message `metadata` holds `artifacts` (what a reply produced) and `attachments` (files the user attached) |
| `memories` | Shared memory, always linked to a headquarters |
| `media-assets` | Generated and transformed images (file in the media library), linked to a headquarters and their source image |
| `artifacts` | Deliverables shown on the Artifacts page and in chat: documents, images, audio, video timelines, and user uploads (category `upload`) |
| `computer-sessions` | The headquarters' cloud computer: state and which agent is using it ([schema](cloud-computer.md#computer-sessions)) |
| `agent-requests` | What agents need from the user: sign-ins, captchas, manual steps, choices, open questions, approvals ([schema](cloud-computer.md#agent-requests)) |

The **Agents** dashboard page lists each agent's configuration and the execution history. The **Artifacts** page lists every deliverable.

## Limits

- Headquarters runs requests one at a time; agents' direct chats are not queued. A direct chat with an agent that is also working on a headquarters step starts a second, independent run.
- Only images are shown to the model directly. Other uploads are read as text (text files) or used through their URL (for example downloaded on the cloud computer).
- `build_video_timeline` produces an edit timeline (scenes, audio/image URLs, durations, captions) saved to memory; it does not render a video file.
- `prepare_publication` saves a publishing package and time to memory; it doesn't post to any platform itself. An agent with the cloud computer can post through the platform's website once the user is signed in there.
- A CloudHike run on the Free plan waits at most 5 minutes; long pipelines need Pro (up to 60 minutes) or `AGENT_RUNNER=inline` on a long-running server.
