# Customize the boilerplate

[Documentation home](README.md) · [API reference](component-api.md)

## Start from a role template

Pass a draft to the creation dialog. The user can change every option before submission.

```tsx
import { AddAgentDialog, type NewAgentDraft } from '@/components/agent-city';

const researcherTemplate: NewAgentDraft = {
  name: 'Researcher',
  task: 'Find reliable sources and prepare an evidence-backed research brief.',
  appearance: {
    theme: 'mint', icon: 'search', floors: 2,
    glass: 'full', interior: 'desk', roof: ['tree', 'solar'], trees: true,
  },
};

// In a client component with your own open state and creation callback:
<AddAgentDialog open={open} onOpenChange={setOpen}
  initialValue={researcherTemplate} onCreate={handleCreate} />
```

The initial draft is read when opening. Close and reopen the dialog to switch templates. `night` sets initial preview lighting without locking the user's preview toggle.

## Change an existing office

Use immutable updates so the drawing effect sees the new building object:

```tsx
setConfig(city => ({
  ...city,
  buildings: city.buildings.map(building =>
    building.id === selected && building.type === 'agent'
      ? { ...building, theme: 'sky', floors: 3, roof: ['dish', 'garden'] }
      : building),
}));
```

Office names are independent of agent names. If your product expects both to change together, update the agent record in the same host action.

## Style and route roads

```tsx
<AgentCity config={config} agents={agents}
  roadStyle={{ width: 46, sidewalkWidth: 10, markingColor: '#ffffff' }} />
```

Individual links override network styles:

```ts
const link = {
  id: 'research-to-writer', from: 'research-office', to: 'writer-office',
  route: 'y-first' as const,
  width: 38, markings: false,
};
```

For manual routing around plots, supply world-space waypoints:

```ts
const link = {
  id: 'research-to-writer', from: 'research-office', to: 'writer-office',
  waypoints: [{ x: 145, y: 0 }, { x: 145, y: 580 }],
};
```

Waypoints replace the automatic elbow. An empty array makes a direct line. Endpoints follow moved buildings; waypoints stay fixed in world space. The resulting connections can become diagonal when a building moves. If you need permanent orthogonal routing or obstacle avoidance, recompute waypoints in your host or add a routing layer.

## Embed a standalone road network

```tsx
import { RoadNetwork } from '@/components/agent-city';

export default function RoadsPreview() {
  return <svg viewBox="-300 -50 900 500">
    <RoadNetwork roads={[
      { id: 'main', from: { x: 0, y: 0 }, to: { x: 580, y: 0 } },
      { id: 'branch', from: { x: 290, y: 0 }, to: { x: 290, y: 290 } },
    ]} />
  </svg>;
}
```

Use a single `RoadNetwork` for shared junctions. Separate `Road` instances paint independently and can overlay each other's sidewalks. Mount roads below building groups and avoid applying a second isometric projection.

## Change the visual theme

| File | Controls |
| --- | --- |
| `app/page.tsx` | Homepage layout and documentation illustrations |
| `components/agent-city/city.module.css` | Ground, selected outline, hover, status lighting, camera buttons |
| `components/agent-city/add-agent-dialog.module.css` | Modal, form, preview panel, palette swatches, responsive behavior |
| `components/agent-city/renderer.js` | Building palettes, geometry, sign drawing, interior details |

The SVG artwork includes explicit colors. CSS-only changes to the shell will not recolor every building surface. Existing palette keys are the stable configuration API.

To add a new palette, update the exported `buildingThemes` array in `types.ts`, the renderer's `THEMES` map, and the dialog's `palette` swatch map. Adding an icon or interior also requires its public type/options and renderer implementation to agree. Finish with TypeScript and a browser preview of both standalone and city usage.

## Layout and headquarters

The headquarters definition is in `presets.ts`, including architecture, palette, glass tint, spire, and landscaping. Keep its ID stable if you use the default reset and delete guards. `nextOfficePosition` uses that ID as its search origin. Change spacing there if your buildings have larger footprints, then adjust roads and the initial camera as needed.

The city accepts a wrapper `className`; give its parent an explicit height. `AgentBuilding` accepts a class on its root SVG. Each building's resources are instance-scoped, so standalone previews, dialogs, and multiple cities can render together.
