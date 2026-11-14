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
| `onBuildingMove` | `(id: string, position: { x: number; y: number }) => void` | Optional; commit final world position after a drag |
| `night` | `boolean` | Day mode |
| `roadStyle` | `RoadStyle` | Network-wide defaults; individual links can override |
| `draggable` | `boolean` | `true`; movement also requires `onBuildingMove` |
| `className` | `string` | Optional wrapper class |

Give the parent a defined height, such as `720px`. The wrapper has a minimum height of `480px`. Drag the ground to pan; use the buttons to zoom. The camera starts at `{ x: 650, y: 230, zoom: 0.85 }`, with zoom clamped to `0.25–2.5`. **Reset view** restores this camera; it does not reset application data. The camera does not automatically fit newly added or distant offices.

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
| `onCreate` | `(draft: NewAgentDraft) => void` | Required; host commits the draft and closes the dialog |
| `initialValue` | `NewAgentDraft` | Empty name/task and default office appearance |
| `night` | `boolean` | Initial preview lighting; independent from city lighting after opening |

```ts
interface NewAgentDraft {
  name: string;
  task: string;
  appearance: Omit<AgentOffice, 'id' | 'agentId' | 'name' | 'type' | 'x' | 'y'>;
}
```

Name is limited to 24 characters and task to 2,000 characters in the form. Both must contain non-whitespace content. The callback receives trimmed values and an appearance object with a copied roof array. These checks are UI validation, not server-side validation.

Default appearance is lavender, sparkle icon, one floor, glass on both sides, research desk, tree and AC units on the roof, and landscaping enabled. Each opening creates fresh state. Cancelling makes no city changes. The form uses a native modal `<dialog>` for focus containment; it explicitly focuses the name field and restores the trigger on close.

`onCreate` is synchronous. The component has no loading/error state for asynchronous requests. If you add persistence, implement submission state and error handling before treating the dialog as a server-backed form.

## Agent and building data

```ts
interface Agent {
  id: string;
  name: string;
  task: string;
  status: 'idle' | 'working' | 'error' | 'offline';
}
```

All buildings require `id`, `name`, `type`, `x`, and `y`, and may reference an agent with `agentId`. Building IDs and agent IDs are separate domains. Links use building IDs. Renaming an office does not automatically rename its agent.

### AgentOffice

Set `type: 'agent'` and optionally configure:

| Field | Accepted values | Renderer fallback |
| --- | --- | --- |
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
  route?: 'x-first' | 'y-first';
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
| `nextOfficePosition(config)` | Searches expanding square rings around HQ using 290-unit spacing and 220-unit occupancy checks |
| `project(x, y)` | Returns `{ x: (x-y) cos(π/6), y: (x+y)/2 }` |

Free-plot allocation reuses vacancies and accounts for moved building centers. It is a spacing heuristic, not footprint-aware collision detection. Presets are exported objects: clone them or use immutable updates rather than mutating them.
