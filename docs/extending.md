# Extend and maintain the boilerplate

[Documentation home](README.md) · [Architecture](architecture.md)

## What is implemented today

The dashboard city has one permanent headquarters, six seeded starter agents with their own building designs, agent creation/editing with a live preview, deletion with confirmation, street roads to headquarters, a building popover, plot-snapping drag and drop, camera controls (pan, wheel/button zoom, fit), and night mode. Agents, their office appearance, and positions are saved in Strapi, so the layout survives a reload. No agent actually executes a task; `status`, `progress`, and `activity` are display fields.

## Add persistence

Keep workspace layout and agent definitions separate. A useful future model is:

| Record | Fields to consider |
| --- | --- |
| Workspace | ID, owner, name, schema version |
| Agent | ID, workspace ID, name, task, execution configuration |
| Building | ID, workspace ID, agent ID, type, position, appearance |
| Link | ID, workspace ID, endpoint building IDs, route/style |
| Job | ID, agent ID, input, status, output, timestamps |

The original PostgreSQL/Drizzle scaffold is in `db/` with users/posts tables and `drizzle.config.ts`. It is not connected to the city. Add your city schema and persistence API when needed.

Validate imported records at your API boundary: unique IDs, finite coordinates, known enum values, roof items, and existing link endpoints. Preserve exactly one headquarters per workspace. Version saved configuration before introducing incompatible shape changes.

For creation, save the agent, office, and road as one transaction or one consistent server operation, then update the UI from the result. For deletion, remove related links and handle shared agent references. The generic renderer cannot enforce these persistence rules.

## Agents in Strapi

Collection type **Agents** (singular `agent`, plural `agents`, REST `/api/agents`, Draft & Publish off). One record is an agent plus its office:

| Field | Strapi type | Values |
| --- | --- | --- |
| `name` | Short text, required, max 32 | Full name in labels; the building sign shortens it (`signLabel`) |
| `instructions` | Long text, required, max 2000 | The dialog's "Agent instructions" |
| `status` | Enumeration, default `idle` | `idle`, `working`, `error`, `offline` |
| `progress` / `activity` | Integer 0–100 / short text, optional | Shown in the building popover when set |
| `design` | Enumeration, default `studio` | `studio`, `observatory`, `broadcast`, `gallery`, `cinema`, `dispatch` |
| `theme`, `icon`, `floors`, `glass`, `interior`, `roof`, `trees` | Office appearance | Same values as `AgentOffice` |
| `x`, `y` | Integer, required | Plot centre; multiples of `CITY_PLOT` within 12 plots of the origin |
| `headquarter` | Relation: Agent belongs to one Headquarter | Ownership |

Headquarters also stores its dragged plot as `x`/`y` (integers; null means the preset plot at `(290, 290)`). **Reset layout** clears them and moves each starter agent (matched by name) to its starter plot and every other agent to the next free plot in creation order (`originalLayout` in `lib/agent-records.ts`); names, instructions, and appearance are untouched.

Headquarters also has `agentsSeeded` (boolean). The API token needs find/create/update/delete on Agent and update on Headquarter. Roads are not stored; they are derived from positions (`toRoad`), so they follow every move. Server actions in `app/dashboard/agent-actions.ts` validate drafts and plots and check that the agent belongs to the caller's headquarters before writing. Moves are optimistic and roll back with a notice if saving fails.

`next.config.ts` turns off `experimental.serverComponentsHmrCache`: with it on, dev hot reloads replay stale `fetch` responses, and the first-visit seeding could run twice.

## Connect actual agent execution

Run model calls and task dispatch in server-side services or jobs. Store credentials on the server. Keep runtime job status separate from layout changes, then map that status into the `agents` prop to update badges.

A visual road does not schedule work or define a dependency graph. If you need agent-to-agent handoffs, model those connections separately using agent IDs and execution semantics. Keep the visual map free to rearrange without changing task behavior accidentally.

## Asynchronous creation

`AddAgentDialog.onCreate` may return a promise. While it is pending, submit, cancel, close, Escape, and backdrop dismissal are disabled; a rejection keeps the draft and shows the error's message. The host closes the dialog after success. `initialValue` seeds a fresh draft per opening (used for editing); it is not a controlled draft.

## Accessibility and browser QA

The modal uses native `showModal()` for top-layer presentation and focus containment. It focuses the name field and restores the opening trigger on close. Building selection supports Enter and Space when an `onSelect` handler is provided. Movement currently requires a pointer; there are no keyboard move controls.

Before shipping, check in your supported browsers:

- Open from each Add agent button; Tab and Shift+Tab remain inside the dialog.
- Cancel, Escape, close button, and backdrop restore focus without creating records.
- Blank or whitespace-only names/tasks cannot create an agent.
- Appearance changes update the preview, including all floors and glass modes.
- Create adds one office and road; remove leaves headquarters; reset returns to one HQ.
- Drag, pan, zoom, selection, narrow layouts, night mode, and reduced motion behave as expected.
- Multiple city/preview instances have no SVG gradient/filter ID collisions.

Browser visuals and interactions have not yet been verified in this workspace. Automated checks do not substitute for these browser checks.

## Automated checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
# Or run all checks:
npm run check
```

Headquarters tests cover architecture/height/tint/spire combinations, palettes, isolated resource IDs, preview height bounds, and legacy building rendering using an SVG DOM double. The routing tests cover both elbow directions, moved endpoints, explicit/direct waypoints, duplicate points, zero-length paths, and non-finite coordinates. They do not exercise React events or browser SVG rendering.

`npm run build` uses the original Next.js command. `npm run build:webpack` is the verified fallback used by `npm run check`; the default Turbopack build stalled in the development environment. `npm start` serves a successful build. `npm run lint` uses the flat configuration in `eslint.config.mjs` and fails on warnings; the imported drawing factory and original HTML are excluded from lint. Renderer tests cover the factory separately. `npm run typecheck` generates Next route types first, so it also works in a clean checkout.

## Current layout limits

- Placement and dropping work per plot (`CITY_PLOT` grid); buildings larger than a pad are not supported.
- `nextOfficePosition` skips the plots directly behind and in front of headquarters in the first two rings so the tower neither hides nor is hidden by an office. Dragging may still place an office there.
- `street` roads run between plots and share streets; there is no lane or intersection modelling.
- Moving buildings has no keyboard alternative yet.
- The camera frames the whole city on load, on "Fit city", and when `fitKey` changes; otherwise it keeps the user's pan and zoom.
- The renderer is legacy JavaScript behind a typed declaration. New geometry needs runtime/browser verification as well as type checks.
- Apart from headquarters and agents (Strapi), there are no billing, job processing, or deployment features wired into the city. Authentication (CloudHike.dev + Strapi user records) protects `/dashboard`; see the README's Authentication section.

## Documentation assets

`docs/assets/creator-city.svg` illustrates the headquarters and offices using the project's actual drawing primitives. `docs/assets/agent-creation-flow.svg` explains state ownership. Both are vector assets with embedded accessible descriptions and no external fonts or network dependencies. Update the illustrations when changing architecture or major visual concepts; do not present them as live screenshots.
