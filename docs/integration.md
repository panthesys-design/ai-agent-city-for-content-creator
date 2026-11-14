# Integrate a city and creation dialog

[Documentation home](README.md) · [API reference](component-api.md)

Use a client component: the canvas, building renderer, and native modal use browser APIs. Give the canvas an explicit height. Keep IDs unique and use `agentId` to connect an office to its agent.

This complete example uses one workspace state object so agent and city updates happen together. It creates roads automatically and keeps headquarters when deleting an office.

```tsx
'use client';

import { useState } from 'react';
import {
  AddAgentDialog, AgentCity, HEADQUARTERS_ID,
  creatorAgents, creatorCity, nextOfficePosition,
  type Agent, type CityConfig, type NewAgentDraft,
} from '@/components/agent-city';

type Workspace = { agents: Agent[]; config: CityConfig };

export default function WorkspacePage() {
  const [workspace, setWorkspace] = useState<Workspace>(() => ({
    agents: structuredClone(creatorAgents),
    config: structuredClone(creatorCity),
  }));
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(HEADQUARTERS_ID);

  function createAgent(draft: NewAgentDraft) {
    const agentId = crypto.randomUUID();
    const buildingId = crypto.randomUUID();
    setWorkspace(current => ({
      agents: [...current.agents, {
        id: agentId, name: draft.name, task: draft.task, status: 'idle',
      }],
      config: {
        buildings: [...current.config.buildings, {
          ...draft.appearance,
          id: buildingId, agentId, type: 'agent', name: draft.name,
          ...nextOfficePosition(current.config),
        }],
        links: [...current.config.links, {
          id: crypto.randomUUID(), from: HEADQUARTERS_ID, to: buildingId,
        }],
      },
    }));
    setSelected(buildingId);
    setOpen(false);
  }

  function removeSelected() {
    if (!selected || selected === HEADQUARTERS_ID) return;
    setWorkspace(current => {
      const office = current.config.buildings.find(b => b.id === selected);
      if (!office || office.type !== 'agent') return current;
      const buildings = current.config.buildings.filter(b => b.id !== selected);
      return {
        // Keep an agent if another office still references it.
        agents: current.agents.filter(a => a.id !== office.agentId ||
          buildings.some(b => b.agentId === a.id)),
        config: {
          buildings,
          links: current.config.links.filter(l => l.from !== selected && l.to !== selected),
        },
      };
    });
    setSelected(HEADQUARTERS_ID);
  }

  return <>
    <button onClick={() => setOpen(true)}>Add agent</button>
    <button disabled={!selected || selected === HEADQUARTERS_ID}
      onClick={removeSelected}>Remove office</button>
    <AddAgentDialog open={open} onOpenChange={setOpen} onCreate={createAgent} />
    <div style={{ height: 720 }}>
      <AgentCity
        config={workspace.config}
        agents={workspace.agents}
        selectedBuildingId={selected}
        onSelectBuilding={building => setSelected(building.id)}
        onBuildingMove={(id, position) => setWorkspace(current => ({
          ...current,
          config: {
            ...current.config,
            buildings: current.config.buildings.map(b =>
              b.id === id ? { ...b, ...position } : b),
          },
        }))}
      />
    </div>
  </>;
}
```

## Reuse only the dialog

`onCreate` receives `{ name, task, appearance }`. Names and tasks are trimmed. The dialog does not assign IDs or coordinates and does not close automatically after creation; close it in your callback. Cancelling unmounts and discards the draft.

Provide `initialValue` to prefill an agent template. It takes the complete draft shape; appearance fields are optional and merge with the default appearance. Changing `initialValue` while open does not replace the active draft. Close and reopen to initialize a new one.

## Reuse only a building

```tsx
'use client';
import { AgentBuilding, type AgentOffice } from '@/components/agent-city';

const office: AgentOffice = {
  id: 'research-office', agentId: 'research-agent', type: 'agent',
  name: 'Researcher', x: 0, y: 0,
  theme: 'mint', icon: 'search', floors: 2,
  glass: 'full', interior: 'desk', roof: ['solar', 'tree'], trees: true,
};

export default function OfficePreview() {
  return <AgentBuilding building={office} status="working" />;
}
```

`AgentBuilding` draws the building at its local origin; its `x` and `y` fields are not used for standalone positioning. Use `BuildingGlyph` within your own SVG if you want to manage transforms and layout yourself.
