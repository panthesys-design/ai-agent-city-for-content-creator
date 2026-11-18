import type { CityBuilding } from './types';
/** `label` overrides the sign text, which otherwise uses `name`. */
export function createBuildingRenderer(defs: SVGDefsElement, prefix: string): (target: SVGGElement, building: CityBuilding & { label?: string }) => void;
