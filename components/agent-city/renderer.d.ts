import type { CityBuilding } from './types';
export function createBuildingRenderer(defs: SVGDefsElement, prefix: string): (target: SVGGElement, building: CityBuilding) => void;
