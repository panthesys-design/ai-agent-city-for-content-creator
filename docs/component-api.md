# Component API

[Documentation home](README.md) · [Integration](integration.md)

Import public components, helpers, and types from `@/components/agent-city`. This reference describes the current source contracts; `types.ts` and each component's exported props remain the source of truth.

## AgentCity

A controlled city canvas. The host owns buildings, agents, selection, and saved positions. The component owns the temporary drag position and camera.

| Prop | Type | Default / behavior |
| --- | --- | --- |
| `config` | `CityConfig` | Required; `{ buildings, links }` |
| `agents` | `Agent[]` | `[]`; status is resolved through each building's `agentId` |
| `selectedBuildingId` | `string \| null` | No selected building |
| `onSelectBuilding` | `(building: CityBuilding) => void` | Optional; enables selection and keyboard activation |
| `onBuildingMove` | `(id: string, position: { x: number; y: number }) => void` | Optional; called with the snapped plot centre after a drop on a free plot. Drops on a taken plot snap back without a call |
| `canDrag` | `(building: CityBuilding) => boolean` | All buildings; e.g. `b => b.type === 'agent'` keeps HQ fixed. Pressing a non-draggable building pans instead |
| `onBackgroundClick` | `() => void` | Optional; a click (not a drag) on empty ground |
| `popover` | `CityPopover \| null` | Optional `{ buildingId, content, label, onClose }`, opened beside that building on whichever side has more room so the building stays visible (above/below its label when neither side fits). Escape or a pointer-down outside the city (and outside the popover) calls `onClose` unless a modal dialog is open |
| `callouts` | `CityCallout[]` | `[]`; speech bubbles above buildings: `{ buildingId, text, tone?, more?, label?, onClick? }`. `tone` is `question` (default, amber) or `info`; `more` shows a `+n` count; `label` is the button's accessible name (defaults to `text`). One per building; a bubble replaces that building's hover label and hides while its popover is open. Creator City uses it for an agent's pending question, and clicking it opens that agent's chat |
| `showLabels` | `boolean` | `true`; HTML name/icon/status label above the roof of the hovered or keyboard-focused building (hidden while that building's popover is open). When off, the SVG status badge is shown instead |
| `scenery` | `boolean` | `true`; island base, parks on empty plots, drop target. Off restores the plain ground grid |
| `fitKey` | `string \| number` | Change it to re-frame the camera around the whole city |
| `night` | `boolean` | Day mode |
| `roadStyle` | `RoadStyle` | Network-wide defaults; individual links can override |
| `draggable` | `boolean` | `true`; movement also requires `onBuildingMove` |
| `className` | `string` | Optional wrapper class |

Give the parent a defined height, such as `720px`. The wrapper has a minimum height of `480px`. The SVG viewBox tracks the frame size, so one SVG unit is one CSS pixel and the HTML labels/popover line up exactly. Drag the ground to pan; use the wheel or buttons to zoom (clamped to `0.25–2.5`). The camera frames the whole city on load and keeps doing so on resize until the user pans or zooms; **Fit city** re-frames it without changing application data.

While dragging, the building floats under the pointer, the target plot is highlighted (green free, red taken), and its roads already route to that plot.

Missing road endpoints are skipped. Buildings are sorted by `x + y` for drawing order. A matching agent supplies the status badge; an office without a matching agent still renders.

## AgentBuilding and BuildingGlyph

| Prop | Type | Default / behavior |
| --- | --- | --- |
| `building` | `CityBuilding` | Required |
| `selected` | `boolean` | No selected outline |
| `status` | `AgentStatus` | No status badge |
| `onSelect` | `() => void` | Optional; adds button semantics and Enter / Space activation |
| `className` | `string` | `AgentBuilding` only; class on the root SVG |
| `night` | `boolean` | `AgentBuilding` only; day mode |

`AgentBuilding` supplies a responsive SVG with viewBox `-180 -350 360 450` for offices and legacy buildings; skyscraper framing adjusts to its skyline. `BuildingGlyph` supplies a `<g>` and must be placed inside an SVG. It draws at the local origin, with instance-specific gradient and filter IDs. Translate the group yourself for custom layouts. In the city, lighting comes from the ancestor's `data-night` attribute.

## HeadquartersBuilding

A standalone HQ preview with the same optional props as `AgentBuilding` but a required `building: HeadquartersSpec`. Supported `style` values are `empire`, `crown`, and `twin`; options include HQ theme, height level 1–5, tint, emblem, spire, and landscaping. Specs render directly in `AgentCity` too. [See the illustrated headquarters guide](headquarters.md) for all values and examples.

## AddAgentDialog

| Prop | Type | Default / behavior |
| --- | --- | --- |
| `open` | `boolean` | Required; false unmounts the dialog content |
| `onOpenChange` | `(open: boolean) => void` | Required; handles close, Cancel, Escape, and backdrop dismissal |
| `onCreate` | `(draft: NewAgentDraft) => void \| Promise<void>` | Required; host commits the draft and closes the dialog. A promise shows a pending state; a rejection keeps the dialog open with its message |
| `mode` | `'create' \| 'edit'` | `create`; `edit` relabels the dialog for customizing an existing agent (pass `initialValue`) |
| `initialValue` | `NewAgentDraft` | Empty name/task and default office appearance |
| `night` | `boolean` | Initial preview lighting; independent from city lighting after opening |

```ts
interface NewAgentDraft {
  name: string;
  task: string;
  appearance: Omit<AgentOffice, 'id' | 'agentId' | 'name' | 'type' | 'x' | 'y'>;
}
```

Name is limited to `AGENT_NAME_MAX` (32) characters and task to 2,000 characters in the form. Both must contain non-whitespace content. The callback receives trimmed values and an appearance object with a copied roof array. These checks are UI validation, not server-side validation.

Default appearance is the glass studio design, lavender, sparkle icon, one floor, glass on both sides, research desk, tree and AC units on the roof, and landscaping enabled. Each opening creates fresh state. Cancelling makes no city changes. The form uses a native modal `<dialog>` for focus containment; it explicitly focuses the name field and restores the trigger on close.

The form has a design gallery (live thumbnails of every `agentDesigns` entry), color, icon, and height controls; interior, windows, and rooftop items apply to the glass studio only. While an async `onCreate` is pending, every dismissal path is disabled to avoid a half-committed cancel.

## Agent and building data

```ts
interface Agent {
  id: string;
  name: string;
  task: string;
  status: 'idle' | 'working' | 'waiting' | 'completed' | 'failed' | 'error' | 'offline'; // waiting: the agent needs the user
}
```

All buildings require `id`, `name`, `type`, `x`, and `y`, and may reference an agent with `agentId`. Building IDs and agent IDs are separate domains. Links use building IDs. Renaming an office does not automatically rename its agent.

### AgentOffice

Set `type: 'agent'` and optionally configure:

| Field | Accepted values | Renderer fallback |
| --- | --- | --- |
| `design` | `studio`, `observatory`, `broadcast`, `gallery`, `cinema`, `dispatch` (see `agentDesignInfo`) | `studio` |
| `theme` | `lavender`, `mint`, `peach`, `sky`, `rose`, `white` | `lavender` |
| `icon` | `search`, `doc`, `wave`, `play`, `image`, `rocket`, `sparkle` | `search` |
| `floors` | `1`, `2`, `3`, `4` | `1`; renderer clamps to this range |
| `glass` | `full`, `front`, `none` | `full` |
| `interior` | `desk`, `writer`, `voice`, `editing`, `gallery`, `publish` | `desk` |
| `roof` | Array of `tree`, `units`, `dish`, `solar`, `garden` | `['tree', 'units']`; pass `[]` for an empty roof |
| `trees` | `boolean` | `true` |

The dialog's default sparkle icon differs from the raw renderer's search fallback. Exported option arrays are `buildingThemes`, `buildingIcons`, and `roofItems`.

### HeadquartersSpec

Set `type: 'skyscraper'`. The complete option table and defaults are in the [headquarters guide](headquarters.md#configuration). `CityBuilding` includes this type alongside agent offices and legacy campus buildings.

### CampusBuilding

Set `type` to `tower`, `stepped`, or `office`. Optional fields are `accent` (color), `glass` (`blue`, `teal`, `warm`, `clear`), and `extras` (legacy decoration descriptors). Extras are loosely typed; valid placement keys depend on the renderer's building parts. See the [original HTML](../Isometric%20Campus.html) and `drawExtras` in `renderer.js` for examples.

### CityConfig and CityLink

```ts
interface CityConfig {
  buildings: CityBuilding[];
  links: CityLink[];
}
// CityLink also accepts every RoadStyle property.
interface CityLink {
  id: string;
  from: string; // building ID
  to: string;   // building ID
  route?: 'x-first' | 'y-first' | 'street'; // street: follows the gaps between plots
  waypoints?: { x: number; y: number }[];
}
```

Keep IDs unique and coordinates finite. TypeScript contracts do not validate imported JSON at runtime.

## Road and RoadNetwork

Both render SVG groups and handle their own world-to-isometric transform. Mount under the buildings, inside the camera group. Do not project their points yourself.

| Prop | Type | Behavior |
| --- | --- | --- |
| `from`, `to` | `{ x: number; y: number }` | Required on `Road`; world coordinates |
| `route` | `'x-first' \| 'y-first'` | `x-first`; ignored when waypoints are supplied |
| `waypoints` | `{ x: number; y: number }[]` | Replaces the automatic elbow; `[]` makes a direct connection |
| `roads` | `(RoadProps & { id: string })[]` | Required on `RoadNetwork` |
| `night` | `boolean` | Day palette by default; individual roads can override the network |
| `className` | `string` | Optional class on the SVG group |

### RoadStyle

| Property | Default | Notes |
| --- | --- | --- |
| `width` | `42` | Asphalt width in world units; minimum `8` |
| `sidewalkWidth` | `9` | Per-side width; minimum `0` |
| `markings` | `true` | Dashed center line |
| `surfaceColor` | Day `#858d98`, night `#354052` | Asphalt |
| `sidewalkColor` | Day `#e3e5e8`, night `#616c7d` | Pavement |
| `markingColor` | Day `#fff1bd`, night `#d2c59b` | Center line |

Non-finite widths fall back to defaults. Zero-length routes and routes with non-finite coordinates are omitted. Consecutive duplicate points are removed. All road edges are drawn before all asphalt to keep shared junctions continuous. Roads are decorative and do not intercept pointer events. Routing does not avoid buildings automatically.

## Presets and helpers

| Export | Purpose |
| --- | --- |
| `HEADQUARTERS_ID` | Stable ID: `headquarters` |
| `headquarters` | Empire skyscraper at world position `(290, 290)`, gold palette, height level 2, warm glass, spire, and landscaping |
| `headquartersPresets` | Alternative Empire, Crown, and Twin specs for the same HQ |
| `headquartersStyles`, `headquartersThemes`, `headquartersTints` | Typed HQ option arrays |
| `creatorCity` | One headquarters and no road links |
| `creatorAgents` | Empty agent array |
| `starterAgents` | The six seeded agents (name, instructions, appearance, plot offset from HQ) |
| `nextOfficePosition(config)` | First free `CITY_PLOT` plot in expanding rings around HQ, skipping the plots directly behind/in front of HQ in the first two rings |
| `CITY_PLOT`, `snapToPlot`, `isPlotFree`, `streetWaypoints` | Plot grid (290 units), snapping, occupancy, and street routing |
| `signLabel(name)` | Short building-sign text (drops a trailing "Agent", max 16 characters) |
| `BuildingIcon`, `themeAccent` | HTML icon and accent colour matching a building's sign |
| `project(x, y)` | Returns `{ x: (x-y) cos(π/6), y: (x+y)/2 }` |

Free-plot allocation reuses vacancies and accounts for moved buildings. Occupancy is per plot, not footprint-aware. Presets are exported objects: clone them or use immutable updates rather than mutating them.
