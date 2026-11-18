export { AgentBuilding, BuildingGlyph } from './agent-building';
export type { AgentBuildingProps, BuildingGlyphProps } from './agent-building';
export { AgentCity } from './agent-city';
export type { AgentCityProps, CityCallout, CityPopover } from './agent-city';
export { BuildingIcon, buildingIconLabels } from './building-icon';
export * from './types';
export {
  creatorAgents, creatorCity, headquarters, headquartersPresets, HEADQUARTERS_ID, nextOfficePosition, starterAgents,
} from './presets';
export type { OfficeAppearance, StarterAgent } from './presets';

export { Road, RoadNetwork } from './road';
export type { RoadProps, RoadNetworkProps, RoadStyle } from './road';
export { CITY_PLOT, isPlotFree, snapToPlot, streetWaypoints } from './road-geometry';
export type { RoadPoint, RoadRoute } from './road-geometry';

export { AddAgentDialog, AGENT_NAME_MAX, AGENT_TASK_MAX } from './add-agent-dialog';
export type { AddAgentDialogProps, NewAgentDraft } from './add-agent-dialog';

export { HeadquartersBuilding } from './headquarters-building';
export type { HeadquartersBuildingProps } from './headquarters-building';
