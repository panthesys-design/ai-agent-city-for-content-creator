import type { HeadquartersSpec } from './types';

/** Conservative skyline bound matching the imported renderer, including the spire. */
export function headquartersHeight(building: HeadquartersSpec): number {
  const height = Math.max(1, Math.min(5, Math.trunc(building.height ?? 3) || 3));
  const scale = .7 + .15 * (height - 1);
  const spire = building.spire !== false;
  switch (building.style) {
    case 'crown': return 36 + 250 * scale + 72 + 46 + (spire ? 46 : 0);
    case 'twin': return 36 + 280 * scale + 28 + (spire ? 58 : 6);
    default: return 36 + 366 * scale + (spire ? 122 : 12);
  }
}
