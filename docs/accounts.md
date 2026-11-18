# Connected accounts (Composio)

Users connect external accounts on **Dashboard → Accounts**: Instagram, YouTube, X (Twitter), LinkedIn, Facebook, Threads, TikTok, Pinterest, Reddit, Notion, Google Docs, Sheets, Calendar, and Drive, Dropbox, Canva, Slack, Discord, Gmail, and Mailchimp are featured. **Search all apps** finds any other app in Composio's catalog. Agents then publish, schedule, and read through those accounts with [Composio](https://docs.composio.dev) tools.

Creator City never sees a password or token. Each sign-in happens on the app's own page through Composio's hosted connection link, and Composio stores the tokens. Strapi keeps only the Composio account ID, its status, and the access settings the user chose.

## Setup

1. Create a Composio project and copy its API key into `.env.local` as `COMPOSIO_API_KEY` (server only).
2. Add the two Strapi collections below, and add `connect` to the `kind` enum of `agent-requests`.
3. For apps Composio can't sign in to with its own developer app (X/Twitter, Threads, TikTok, Buffer, Telegram at the time of writing), create an auth config with your own app credentials in the Composio dashboard (**Auth Configs → the app**). The Accounts page marks these apps **Needs setup** until one exists. When a project has its own auth config for an app, it is used instead of Composio's.
4. Scheduled posts publish through a CloudHike Jobs schedule (`/api/jobs/scheduled-posts`), so scheduling needs `JOBS_API_URL`, `JOBS_API_KEY`, and a public `APP_PUBLIC_URL`, like headquarters jobs. `POST_PUBLISH_CRON` changes how often it checks (default every 5 minutes; CloudHike Free allows every 15 minutes at most). Without Jobs, agents can still publish right away; `schedule_app_tool` refuses and says why.

`NEXT_PUBLIC_APP_URL` (else the request's host) is the origin Composio returns to after sign-in: `/api/accounts/callback`.

## Connecting, step by step

1. **Connect** calls `startConnectionAction`. The server picks the project's auth config for the app (its own first, else Composio-managed, created on first use), creates a `connected-accounts` row with status `initiated`, and asks Composio for a connection link (`connectedAccounts.link`) for the user's Composio ID, `cc-user-<Strapi user documentId>`.
2. The browser opens the link in a popup (opened during the click so blockers allow it; if it is blocked, the sign-in opens in the same tab).
3. Composio redirects to `/api/accounts/callback?connection=<row>`. The route only looks the row up inside the signed-in user's headquarters, syncs it with Composio, posts the result to the opener (same origin only), and closes. If the popup is closed early, the page re-checks the row itself.
4. **Reconnect** starts a fresh link that remembers the old row (`replacesId`) and copies its settings. Once the new account is active, the old one is deleted in Composio and Strapi. Unfinished sign-ins are removed after an hour.

**Pause** disables the account in Composio (tokens kept, no agent can use it). **Disconnect** deletes it in Composio, which revokes its tokens there, and removes the row; posts scheduled on it fail with a clear reason.

## Access: who may do what

Each account has settings, edited in its **Manage** dialog:

| Setting | Values | Effect |
| --- | --- | --- |
| Agent access | All agents (default), or only selected agents | `agentCanUse` in `lib/connection-records.ts` |
| What agents may do | Read and post (default), or Read only | Read-only accounts refuse every tool that isn't tagged read-only |
| Ask me before posting | On (default) / off | Posting tools ask the user with an approval card first; deleting always asks |

The workspace's **Publishing approval** on the Settings page (`publishingApproval` on the headquarters) sits above these: **Ask before posting** (the default) asks for every post or change on any account; **Auto-publish** leaves it to each account's **Ask me before posting**. It can only add approvals, never remove one an account requires, and deleting always asks.

A tool's effect comes from Composio's tags (`readOnlyHint`, `createHint`, `updateHint`, `destructiveHint`). A tool without tags counts as a write. The server checks all of this on every call (`toolPolicy(connection, effect, workspaceApproval)`), so the model can't talk its way around it.

## Agent tools

Every agent gets these tools (`lib/ai/app-tools.ts`), plus a line in its instructions listing the apps it can use and the connected ones it can't:

| Tool | What it does |
| --- | --- |
| `list_connected_apps` | The accounts this agent may use (with `account_id`, whether it can post, whether it asks first), and connected ones it lacks access to |
| `find_app_tools` | Searches one connected app's Composio tools by intent ("create post"); returns slugs, what they do, their effect, and compact input schemas |
| `run_app_tool` | Runs a tool as the user's account after the access and approval checks; posts go to the **Post** page, failures too |
| `schedule_app_tool` | Approves now, then saves the call as a scheduled `social-posts` row that the CloudHike schedule publishes at `publish_at` |
| `request_connection` | Generative UI: shows a **Connect** card and waits (see below) |

### Connected apps before the cloud computer

When an app is connected, agents work with it through these tools, not its website. Their instructions (`APP_RULES`, `COMPUTER_RULES`, `ASK_RULES`, and headquarters' planning rules) say to check the connected apps first and fall back to the cloud computer only when no app tool does the action, the app tool failed, or the user explicitly asked for the website. As a backstop, `browser_open` on a connected app's website (hosts in `APP_HOSTS`, matched by `appForUrl` in `lib/connection-records.ts`) puts a reminder above the page text naming the app's toolkit. It doesn't block the page, so agents can still read public pages for research. Add hosts to `APP_HOSTS` when featuring a new app.

Agents don't get every Composio tool up front: one app alone can have 50+ tools, too many for a model's context. They discover tools on demand instead, so newly connected apps work mid-run without restarting the agent.

Headquarters gets `list_connected_apps` and `request_connection`, and a summary of what is connected and who may use it, so it can ask for a missing connection before planning and hand app work to an agent with access. The Publisher's role playbook tells it to publish or schedule on the connected account when the plan says so.

### The Connect card (generative UI)

`request_connection` saves an `agent-requests` row of kind `connect` (`service` is the app slug, `url` its logo, and `capability` what is missing: `connect`, `grant`, or `publish`). Like every request, it shows in the agent's chat, in the headquarters chat, in **Needs you**, and as a bubble above the building. The card's button does what's missing:

- **Connect *App*** opens the sign-in popup.
- **Give access** adds the agent to the account's selected agents (`approveConnectRequestAction`).
- **Allow posting** switches the account to Read and post.

The agent's wait checks every few seconds whether it can now use the app, so it continues by itself as soon as the user finishes. **Skip** tells it the user declined.

## Strapi collections

### `connected-accounts`

| Field | Type | Notes |
| --- | --- | --- |
| `toolkit` | string, required | Composio toolkit slug, e.g. `instagram`, `twitter` |
| `toolkitName`, `logo` | string, text | Display name and logo URL |
| `composioAccountId` | string, required, unique | Composio connected-account ID (`pending-…` until the link exists) |
| `composioUserId` | string, required | `cc-user-<Strapi user documentId>` |
| `authConfigId` | string | Composio auth config used |
| `status` | enum `initiated`, `active`, `failed`, `expired`, `disabled`, `revoked` | Synced with Composio |
| `statusReason` | text | Composio's reason, for failed/expired accounts |
| `accountLabel` | string | User-chosen name, e.g. `@brand` |
| `permission` | enum `read`, `publish` (default `publish`) | |
| `agentAccess` | enum `all`, `selected` (default `all`) | |
| `allowedAgents` | json | Agent documentIds when `selected` |
| `requireApproval` | boolean, default true | |
| `connectedAt`, `lastSyncedAt` | datetime | |
| `replacesId` | string | Row this reconnection replaces |
| `stats`, `statsAt` | json, datetime | Cached audience numbers (`followers`, `views`, `posts`, `handle`, `error`) and when they were read |
| `headquarter` | relation many-to-one → `headquarter` | Every query filters by it |
| `owner` | relation many-to-one → `plugin::users-permissions.user` | The user who connected it |

### `social-posts`

| Field | Type | Notes |
| --- | --- | --- |
| `toolkit` | string, required | The app it is for |
| `toolSlug`, `toolVersion` | string | The Composio tool that publishes it and the version the agent saw; empty on a draft that isn't prepared yet |
| `arguments` | json | Tool arguments (kept to publish a draft or scheduled post) |
| `title`, `summary`, `content` | string, text, text | Shown on the Post page; `content` is the post text as written |
| `media` | json | https URLs of the images/videos that go with it |
| `status` | enum `draft` (default), `scheduled`, `publishing`, `published`, `failed`, `cancelled` | `publishing` is the claim that keeps two runs from posting twice |
| `publishAt`, `publishedAt` | datetime | `publishAt` is the publish time, or the suggested time of a draft |
| `userScheduled` | boolean | The user scheduled or published it from the Post/Calendar page |
| `url`, `result`, `error` | text, json, text | Link to the post when the app returned one; result capped at ~4 KB |
| `headquarter`, `connectedAccount`, `agent`, `task`, `artifact` | relations | `artifact` is the publishing package it came from, if any |

At publish time a scheduled post still has to pass the checks: the account is active and still allows posting, and, for posts an agent scheduled, it is still shared with that agent. If any check fails, the post is marked failed with the reason; a failed post can be published or scheduled again.

## Drafts, the Post page, and the Calendar

Agents don't only save posts as artifacts: `save_post_draft` (every agent) and `prepare_publication` (the Publisher's publishing package) save a **draft** to `social-posts`, which shows on **Post** (`app/dashboard/posted/`, sidebar label "Post") and on the **Calendar**. Nothing is published until the user acts.

A draft is **ready** when an agent prepared it: it picked the app's publishing tool and arguments (`tool_slug`, `arguments_json`) for an account that allows posting. `draftReadiness` in `lib/connection-records.ts` decides what the card offers:

| State | Card offers |
| --- | --- |
| Ready | **Schedule** (date and time picker) and **Publish now** |
| Needs preparing | **Prepare with agent**: sends headquarters a request to prepare that draft (`draft_id`) without publishing it |
| Account not connected / read-only | **Connect *App*** / **Allow posting** (Accounts page) |

The Post page shows posts as cards (app, account, status, cover image, and text); clicking a card opens a preview of the post as it reads on the app. Drafts can be edited in a dialog with a live preview beside the editor: the title, the text, and the images and video (upload through `/api/uploads`, replace, reorder, remove, or paste an https link; up to 10, the first is the cover). Changing the text or media of a prepared draft clears the preparation, because both also live in the tool arguments. Scheduled posts can be rescheduled, published now, or **unscheduled** back to drafts. A failed **Publish now** keeps the post as a draft with the error. Drafts, failed, and cancelled posts can be deleted. The server actions (`app/dashboard/posted/actions.ts`) re-check the account and its permission each time; the user scheduling a post is its approval.

The **Calendar** (`app/dashboard/calendar/`) has a month grid (Monday first) and an agenda list. It shows scheduled, published, and failed posts, drafts at their suggested time (dashed), and headquarters requests as agent work, each of which can be toggled. Drafts also wait in a side tray: drag one, or a scheduled post, onto a day to open the schedule dialog for that day, or use its schedule button. Clicking a day lists its items and offers ready drafts for that day; clicking an item opens it with the same actions as on the Post page. Scheduling needs CloudHike Jobs (see Setup); without it, both pages say so and still allow **Publish now**.

## Files

| Concern | Source |
| --- | --- |
| Client-safe types, catalog, permission rules (unit tested) | `lib/connection-records.ts` |
| Composio client and user IDs | `lib/composio/client.ts` |
| Catalog, connecting, syncing, disconnecting | `lib/composio/connections.ts` |
| Tool search and execution | `lib/composio/tools.ts` |
| `social-posts` CRUD | `lib/composio/posts.ts` |
| Agent tools and instructions | `lib/ai/app-tools.ts` |
| Scheduled publishing | `lib/ai/scheduled-posts.ts`, `app/api/jobs/scheduled-posts/route.ts`, `ensurePostSchedule` in `lib/ai/jobs.ts` |
| Accounts page, actions, popup hook | `app/dashboard/accounts/` |
| Sign-in return | `app/api/accounts/callback/route.ts` |
| Connect card | `ConnectActions` in `app/dashboard/computer/computer-ui.tsx` |
| Post page and shared post UI, server actions | `app/dashboard/posted/` (`post-ui.tsx`, `actions.ts`) |
| Calendar | `app/dashboard/calendar/` |

## City overview numbers

The City page's cards (`app/dashboard/city-stats.tsx`, numbers from `cityStats` in `lib/stats.ts`) show:

| Card | Source | Details line |
| --- | --- | --- |
| Content Created | `artifacts` count, excluding user uploads | Docs, images, audio, videos |
| Posts Published | `social-posts` with status `published` | This week, failed |
| Scheduled Posts | `social-posts` `scheduled` or `publishing` | Next publish time |
| Followers & Subscribers | Connected platforms, summed | Per platform; the tooltip lists each account and its post count |

Each card links to Artifacts, Post, or Accounts; the Scheduled Posts card also counts drafts. Platform numbers come from one read-only Composio tool per platform (`AUDIENCE_SOURCES` in `lib/composio/audience.ts`):

| Platform | Tool | Numbers |
| --- | --- | --- |
| YouTube | `YOUTUBE_GET_CHANNEL_STATISTICS` (`mine`) | Subscribers, videos |
| Instagram | `INSTAGRAM_GET_USER_INFO` (`me`) | Followers, posts (Business/Creator accounts only) |
| X | `TWITTER_USER_LOOKUP_ME` (`public_metrics`) | Followers, posts |
| TikTok | `TIKTOK_GET_USER_STATS` | Followers, videos |
| Facebook | `FACEBOOK_GET_USER_PAGES` | Followers of every Page, summed |

LinkedIn (follower counts only exist for company pages), Threads, and work apps such as Notion have no numbers here. The numbers are cached on the account row for 30 minutes. The page renders with the cached numbers, then the cards ask for fresh ones (`refreshCityStatsAction`) after loading, every 5 minutes, and when the tab is shown again. **Refresh** re-reads every platform. A failed read keeps the last good numbers and shows a warning with the reason. The first successful read also fills in an empty account label with the handle (for example `@brand`). Add a platform by adding an entry to `AUDIENCE_SOURCES` with its tool, arguments, and the result keys holding each number.

## Limits

- Media inputs are URLs. Agents pass artifact URLs (ImageKit/Strapi), which works for tools that take a public image or video URL (Instagram containers, LinkedIn shares). Tools that need a file upload from disk (for example some YouTube uploads) depend on Composio's own file handling for that tool.
- The account label is set by the user; Composio doesn't return a profile handle for every app.
- The catalog and Composio's full app list are cached in memory (30 minutes and 6 hours). A new auth config made in Composio's dashboard shows up after the cache expires or the server restarts.
