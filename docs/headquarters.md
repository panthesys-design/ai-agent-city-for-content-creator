# Reusable headquarters buildings

[Documentation home](README.md) · [Component API](component-api.md)

![Empire, Crown, and Twin headquarters rendered from the reusable configurations](assets/headquarters-styles.svg)

The three skyscraper designs come from the updated `Isometric Campus.html`. Use the same typed specification for a standalone preview or a building on the city canvas.

## Preview a headquarters

```tsx
'use client';

import {
  HeadquartersBuilding, headquartersPresets, type HeadquartersSpec,
} from '@/components/agent-city';

const building: HeadquartersSpec = {
  ...headquartersPresets.crown,
  name: 'Creator HQ',
  height: 4,
  icon: 'rocket',
};

export default function HeadquartersPreview() {
  return <HeadquartersBuilding building={building} night={false} />;
}
```

`HeadquartersBuilding` accepts a required `building: HeadquartersSpec` and optional `selected`, `status`, `onSelect`, `night`, and `className`. It reuses the isolated building renderer. Its SVG framing accounts for the selected architecture, height, and spire, so tall previews remain inside the viewBox. `AgentBuilding` also accepts headquarters specs; `HeadquartersBuilding` provides a more specific typed interface for HQ-only uses.

## Configuration

All specs require `id`, `name`, `type: 'skyscraper'`, `x`, and `y`. `agentId` is optional; the default headquarters does not have an agent record.

| Field | Values | Renderer default |
| --- | --- | --- |
| `style` | `empire`, `crown`, `twin` | `empire` |
| `theme` | `lavender`, `mint`, `peach`, `sky`, `rose`, `white`, `gold` | `gold` |
| `height` | `1`, `2`, `3`, `4`, `5` | `3` |
| `tint` | `blue`, `teal`, `warm`, `clear` | `blue` |
| `icon` | `search`, `doc`, `wave`, `play`, `image`, `rocket`, `sparkle` | `sparkle` |
| `spire` | Boolean | `true` |
| `trees` | Boolean | `true` |

Height is a relative tower scale, not a floor count. The dedicated HQ options are exported as `headquartersStyles`, `headquartersThemes`, and `headquartersTints`. Agent office palette options stay unchanged; gold is available in the HQ interface.

The `headquarters` preset uses Empire, gold, height level 2, warm glass, a sparkle emblem, spire, and landscaping. The raw renderer's height default remains level 3. `headquartersPresets` supplies Empire, Crown, and Twin alternatives using the same ID and position. Clone and choose an alternative; do not add all three to a city that should contain exactly one headquarters.

## Switch architecture in a city

Headquarters renders through the same `AgentCity` building pipeline as offices. Change its spec in place so its ID, position, and road endpoints remain stable:

```tsx
setConfig(city => ({
  ...city,
  buildings: city.buildings.map(building =>
    building.id === HEADQUARTERS_ID && building.type === 'skyscraper'
      ? { ...building, style: 'twin', tint: 'teal' }
      : building),
}));
```

The homepage displays the static documentation illustrations, including the headquarters style comparison. To add an interactive workspace, use the [integration example](integration.md) and add your own controls for the headquarters configuration. Keep its ID stable when changing appearance.

The initial camera is fixed. High towers or moved buildings may need panning or zooming to see fully on the city canvas; automatic framing applies to standalone previews, not the city camera. The height/footprint also does not change the free-plot spacing heuristic.

## Compatibility and tests

Legacy `tower`, `stepped`, and `office` buildings remain available. The reusable renderer imports only the new skyscraper drawing functions and gold palette; it does not import the HTML's global listeners or state.

```bash
node --test components/agent-city/headquarters.test.mjs
```

The tests exercise 120 combinations of architecture, height, tint, and spire, plus all HQ palettes, instance-specific resource IDs, height bounds, and legacy building rendering. These are SVG DOM-double checks, not browser interaction tests. The guide's illustration was rendered from actual SVG drawing output and visually checked.
