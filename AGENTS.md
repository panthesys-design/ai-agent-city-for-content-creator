# Working on Creator City

## Start here

This is a Next.js App Router / React / TypeScript boilerplate for a visual AI agent workspace. Read `README.md`, then `docs/architecture.md` and the relevant component guide before changing behavior. Each building is an AI agent run with the OpenAI Agents SDK (`@openai/agents`); headquarters is the orchestrator. Headquarters appearance, agents (instructions, AI config, office appearance, plot position), tasks, execution events, conversations, and shared memory are persisted in Strapi. See `docs/agent-runtime.md`. Authentication uses CloudHike.dev, and user profiles are stored in Strapi.

Use npm and the committed `package-lock.json`. `.nvmrc` selects Node 22; the package engine requires Node >=20.9.0. Run `npm ci` for a fresh checkout. Auth pages need the CloudHike and Strapi variables listed in `.env.example`. Preserve local `.env*` files and never print credentials.

## Project boundaries

- `app/page.tsx` is the marketing landing page (server component; a valid session only swaps the call to action to `/dashboard`, and it renders without auth env vars). `app/_landing/` holds its decorative, client-only hero city (`hero-city.tsx`, the real starter layout with simulated status; nothing is saved or dispatched) and `landing.module.css`.
- `app/(auth)/` holds `/sign-in` and `/sign-up` with their server actions, plus the shared split-screen UI (`auth-shell.tsx`, `auth-form.tsx`, decorative `auth-showcase.tsx`, `auth.module.css`); `app/auth/google` and `app/auth/callback` handle Google sign-in; `app/dashboard` is signed-in only: `layout.tsx` renders `dashboard-shell.tsx` (collapsible icon-rail sidebar with logo, headquarters switcher, City/Artifacts/Post/Calendar/Agents/Accounts links, user + Settings footer, and a header with the sidebar toggle and profile menu (Settings and Sign out, which calls the `signOut` action in `app/(auth)/actions.ts`); collapse state is stored in the `cc_sidebar` cookie), `settings/` is the Settings page (workspace time zone, headquarters design via the reused `HeadquartersForm` `mode="edit"`, new-agent defaults, publishing approval, display name, and a danger zone; parsing in `lib/workspace-settings.ts`, deletion in `lib/workspace-data.ts`; see "Settings page" in `docs/headquarters.md`), and every page calls `requireDashboardAccess()` (`access.ts`), which redirects users without a headquarters to `app/headquarters/new`, the onboarding page that previews designs with `HeadquartersBuilding` and saves the choice to Strapi's `headquarters` collection (`lib/headquarters.ts`, schema in `docs/headquarters.md`). Each user has at most one headquarters. Auth calls CloudHike.dev (`lib/auth/`) and every user is mirrored to Strapi's Users collection (`lib/strapi.ts`). Keep `AUTH_SECRET_KEY` and `STRAPI_API_TOKEN` server-only.
- `docs/integration.md` provides a complete interactive workspace example. When adding a workspace, its host owns data, creation/removal, and headquarters rules.
- `components/agent-city/index.ts` is the public component/type/helper API. Import it from application code.
- `components/agent-city/types.ts` defines serializable agents, buildings, and links.
- `agent-city.tsx` owns the camera and temporary pointer interaction; callers own saved data and selection.
- `add-agent-dialog.tsx` owns a draft, the design gallery, and the live preview; `mode="edit"` reuses it for customizing. `onCreate` submits a validated draft and may return a promise (pending state; a rejection keeps the draft and shows its message); the host allocates IDs, commits it, and closes the dialog.
- `agent-building.tsx` handles client SVG drawing, isolated resource IDs, and cleanup.
- `headquarters-building.tsx` is the typed HQ-only preview. `headquarters-geometry.ts` supplies skyline bounds.
- `road.tsx` renders roads; `road-geometry.ts` builds pure world-space routes (`street` routes follow the gaps between `CITY_PLOT` plots) plus plot snapping/occupancy. `city-ground.tsx` draws the island, parks on empty plots, and the drop target.
- City agents live in Strapi's `agents` collection: `lib/agent-records.ts` (client-safe types, conversion, validation), `lib/agents.ts` (server-only CRUD and one-time starter seeding), and `app/dashboard/agent-actions.ts` (server actions that re-check ownership).
- The agent runtime is server-only in `lib/ai/`: `agent-factory.ts` (record → SDK `Agent`), `run-agent.ts` (streamed agent loop, building status, events), `orchestrator.ts` (headquarters `plan_work`/`run_step` with enforced dependencies), `task-runner.ts` (dispatch via CloudHike Jobs or `after()`, execution, cancellation, stale sweep), `memory.ts` (Strapi MCP memory with signed headquarters scope; REST fallback), `creative-tools.ts` (voiceover, timeline, publishing), `image-tools.ts` (`generate_image`/`transform_image` on ImageKit AI; `imagekit.ts` polls renders, `imagekit-url.ts` builds and signs URLs and is unit tested; `media-library.ts` uploads to Strapi and records `media-assets`), `artifact-tools.ts` (`save_artifact` for text deliverables plus `recordArtifact`, which the image/voiceover/timeline/publish tools call; `list_artifacts`/`read_artifact`, which every agent and headquarters has), `artifact-access.ts` (chat attachments: ownership check, the note the model gets, attached images it can see; images are fetched by the server only from the media library/ImageKit), `jobs.ts`. `app/api/uploads` saves a file the user attaches in chat to the media library as an `upload` artifact (`lib/upload-records.ts` has the allowed types and size limit). Artifacts (agent deliverables) live in Strapi's `artifacts` collection: `lib/artifact-records.ts` (client-safe types/parsing, unit tested), `lib/artifacts.ts` (server CRUD, always filtered by headquarters); `app/dashboard/artifacts/` holds the file-explorer page, its actions, and the shared chat/preview UI (`artifact-ui.tsx`, `markdown.tsx`). Chat replies store artifact snapshots in `chat-messages.metadata.artifacts`. Client-safe config/types: `lib/agent-config.ts`, `lib/task-records.ts`, `lib/city-live.ts`; Strapi CRUD: `lib/runtime-store.ts`. Routes: `app/api/agents/[agentId]/chat` (SSE chat), `app/api/city/stream` (SSE live status), `app/api/jobs/*` (signed CloudHike callbacks). Actions: `app/dashboard/runtime-actions.ts`. The cloud computer (`docs/cloud-computer.md`):
  - `lib/computer/client.ts` is the CloudHike Computers API client.
  - `lib/computer/computer.ts` handles the lease/lifecycle, helper install, browser commands, and chunked file transfer.
  - `lib/computer/store.ts` is Strapi CRUD for `computer-sessions` and `agent-requests`.
  - `lib/computer/cc_browser.py` is the in-computer Chrome DevTools helper; it is embedded into `browser-script.ts` by `npm run generate:browser-script`, so regenerate after editing it.
  - `lib/ai/computer-tools.ts` holds the agent tools and `ask_user`; `lib/ai/user-requests.ts` holds the wait-for-user loop; `lib/ai/run-clock.ts` holds the pausable time limits.
  - Long waits (`wait_for_external`, see "Long waits" in `docs/cloud-computer.md`): `lib/external-wait-records.ts` (client-safe types, `RunParkedError`, unit tested), `lib/ai/external-waits.ts` (Strapi CRUD for `external-waits`), `lib/ai/wait-checker.ts` (model-free page checks), `lib/ai/jobs.ts` (the CloudHike Jobs schedule), and `app/api/jobs/external-waits` (the signed schedule target). A parked task stays `running` with no run; anything that runs, cancels, or sweeps tasks must keep resuming and cancelling waiting tasks working.
  - `lib/computer-records.ts` has the client-safe types; `app/dashboard/computer/` has the preview, full-screen dialog, file panel, and request cards; `app/dashboard/computer-actions.ts` has the user's actions.

- Connected accounts (Composio, `docs/accounts.md`): `lib/connection-records.ts` (client-safe types, featured app catalog, `agentCanUse`/`toolEffect`/`toolPolicy` permission rules, unit tested); `lib/composio/` (`client.ts`, `connections.ts` for the catalog, connecting/syncing/disconnecting and `connected-accounts` CRUD, `tools.ts` for tool search/execution, `posts.ts` for `social-posts`); `lib/ai/app-tools.ts` (`list_connected_apps`, `find_app_tools`, `run_app_tool`, `schedule_app_tool`, `request_connection`; every agent has them, headquarters has the first and last); `lib/ai/scheduled-posts.ts` + `app/api/jobs/scheduled-posts` (signed CloudHike schedule, `ensurePostSchedule`); `app/dashboard/accounts/` (page, actions, `use-connect-app.ts` sign-in popup); `app/api/accounts/callback` (sign-in return); `app/dashboard/posted/` (the Post page, sidebar label "Post": drafts, scheduled, published; `post-ui.tsx` is the shared card/dialogs/state, `actions.ts` the publish/schedule/unschedule/edit/delete/prepare actions, `load.ts` the loader) and `app/dashboard/calendar/` (month grid and agenda of posts, drafts tray with drag-to-schedule, and headquarters work). Agents save drafts with `save_post_draft`, and `prepare_publication` also saves one; drafts publish only when the user publishes or schedules them. City overview cards: `app/dashboard/city-stats.tsx` + `stats-actions.ts`, numbers from `lib/stats.ts` (Strapi counts) and `lib/composio/audience.ts` (platform followers via read-only tools, cached 30 minutes on the account row); `lib/city-stats.ts` holds the client-safe types and result parsing (unit tested). `request_connection` is an `agent-requests` row of kind `connect` rendered by `ConnectActions` in `computer-ui.tsx`. Every connection query filters by headquarters, every tool call passes the row's own Composio user and account IDs, and access, read-only, and approval are checked on the server on every call (and again when a scheduled post publishes).

  Keep `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STRAPI_MCP_TOKEN`, `MEMORY_SCOPE_SECRET`, `JOBS_API_KEY`, `IMAGEKIT_PRIVATE_KEY`, `COMPUTERS_API_KEY`, and `COMPOSIO_API_KEY` server-only; every memory and media-asset read/write must stay filtered by the caller's headquarters, and image tools may only fetch URLs under `IMAGEKIT_URL_ENDPOINT`. Each headquarters has its own computer (CloudHike `userId` `hq-<documentId>`); never share one across headquarters, and keep the file panel confined to `/root/creator-city`.
- `renderer.js` is the isolated legacy drawing factory, with a typed boundary in `renderer.d.ts`.
- `Isometric Campus.html` is the original design reference. It is not app runtime code; change reusable components for product behavior.

## Preserve these behaviors when composing a workspace

1. A workspace starts with exactly one headquarters. The dashboard seeds the six `starterAgents` once per headquarters (flagged by `agentsSeeded`), with the headquarters' `agentDefaults`; deleting them never re-creates them. Headquarters cannot be deleted from the city, but it can be dragged (only Settings → Delete headquarters removes it, with all of its data); its plot is saved as `x`/`y` on the headquarters record (null = the preset plot). Keep its `HEADQUARTERS_ID` stable so roads stay attached.
2. Creating an agent adds one agent record, one office on a free plot, and one road to headquarters. Cancel, Escape, or backdrop dismissal creates nothing.
3. Removing an office removes its related road links. If supporting multiple offices per agent, retain an agent still referenced by another office.
4. **Reset layout** (`originalLayout` / `resetLayoutAction`) moves headquarters and every agent back to their original plots without changing agents' data; **Fit city** only re-frames the camera. Do not conflate the two actions.
5. Agent IDs, building IDs, and road IDs are separate domains. Link endpoints reference buildings; `agentId` connects an office to a worker.
6. Keep state updates immutable. The renderer redraws when the building object changes. Do not mutate exported presets.
7. A status badge is display data written by the agent runtime; a road is a visual connection. Neither dispatches AI work: work starts from chat (headquarters or an agent) through the server.
8. The cloud computer starts only when an agent's computer tool needs it and stops when that run ends; one agent holds it at a time. Agents never take credentials in chat: sign-ins happen on the computer's screen (`request_user_action`), and the agent continues by itself once the request is settled.
9. Headquarters plans one request at a time: a request sent while another is still planning (`isPlanningRequest`) is a queued task (no `jobRunId` until its turn), started oldest first by `runHeadquartersQueue` (`lib/ai/task-runner.ts`) once every running request has handed a step to an agent. Each agent does one thing at a time: a step whose agent is busy waits for it (`lib/ai/agent-availability.ts`) and is started by `startWorkForAgent`. Anything that ends, pauses, or removes a run must let the queue and the agent's waiting work move on.
10. The newest conversation of an agent (or headquarters) is its chat. **Clear chat**, and a new task (a headquarters request after finished planned work, and each agent in that request's plan), start a new conversation instead of deleting messages. Artifacts, uploads, memory, task history, and agent settings must survive both.
11. Agents ask the user through `agent-requests` (`ask_user`, `confirm_action`, `request_user_action`, `request_connection`). A pending request shows in the agent's chat, in the headquarters chat, and as a bubble above the agent's building (`AgentCity` `callouts`), and can be answered from any of them.
12. An agent posts or changes something on a connected account only through `run_app_tool`/`schedule_app_tool`, which enforce the account's agent access, read-only setting, and approval (the workspace's `publishingApproval` "ask" adds approval for every change; it never removes one). Never hand Composio tools to a model directly or skip those checks; never ask users for app passwords or tokens in chat. When the app is connected and an app tool can do the job, agents use it instead of the app's website on the cloud computer (rules in `APP_RULES`/`COMPUTER_RULES`, plus the `browser_open` reminder via `appForUrl`); keep that preference when changing either side.

## Implementation conventions

- Keep reusable components independent from route files, storage, credentials, and job execution. Add real backend behavior on the server when requested.
- Use TypeScript at public boundaries and discriminated building unions. Prefer guarded updates over casting unrelated building types.
- Use CSS modules for component visuals and keep `app/globals.css` limited to the shared baseline. Keep the existing Tailwind CSS, Lucide icons, and PostgreSQL/Drizzle dependencies and scaffolding; do not remove them during UI cleanup.
- Components that use React state, events, or browser APIs need a client boundary. Do not access `document`, SVG DOM APIs, or native dialogs during server rendering.
- Building origins and road points are world coordinates. Only project them once. `RoadNetwork` applies its own isometric transform inside the camera group.
- Preserve instance-specific SVG IDs and effect cleanup so dialog previews, standalone buildings, and multiple cities can coexist.
- Preserve native modal focus containment, Escape/backdrop behavior, focus restoration, clear labels, visible focus styles, responsive layouts, and reduced-motion support.
- `AddAgentDialog.onCreate` may be async; keep pending/error behavior and preserve the draft on failure when changing it.
- When adding a palette/icon/architecture, update public options, the renderer, UI options, relevant preview bounds, docs, and meaningful renderer tests together.
- Buildings sit on the `CITY_PLOT` grid. Dragging snaps to plots and refuses taken plots (client and server). `street` roads run between plots, so they never cross another plot, but roads are not otherwise obstacle-aware; legacy `x-first`/`y-first` routes still can cross plots.

## Checks

Run only what is relevant during development; run the complete check before handing off a boilerplate change:

```bash
npm run lint        # ESLint, no warnings allowed
npm run typecheck   # Generate Next route types, then TypeScript
npm test           # Road geometry, HQ/legacy renderer, ImageKit URL, artifact, upload, connected-account, and cloud computer checks
npm run build:webpack # Verified production webpack build
npm run check      # All of the above
```

`npm run build` uses the original Next.js build command. `npm run build:webpack` is the verified fallback; the default Turbopack build stalled in the development environment. `npm run check` uses that fallback. Do not disable lint rules globally to hide a failure. The imported renderer is intentionally outside ESLint; test its drawing behavior instead.

SVG renderer tests use a DOM double. They check drawing output and resource references, not browser paint or pointer/focus behavior. For UI changes, verify in a browser when available and report any verification limits honestly. Do not invent screenshot or browser-test results.

## Documentation

Update the relevant guide when changing the public API or example behavior. `docs/component-api.md` describes props/defaults; `docs/integration.md` contains a complete client example; `docs/headquarters.md` covers HQ styles; `docs/extending.md` describes production extension points and current limits. Keep relative links valid. SVG illustrations live in `docs/assets/` and should have accessible titles/descriptions.

Do not add unrelated integrations, generated build output, credentials, or duplicate agent instruction sets. `CLAUDE.md` points to this file so instructions stay in one place.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
