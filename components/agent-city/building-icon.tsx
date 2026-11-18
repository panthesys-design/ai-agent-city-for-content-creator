import { AudioLines, Clapperboard, FileText, Image, Rocket, Search, Sparkles, type LucideProps } from 'lucide-react';
import type { buildingIcons } from './types';

const ICONS = {
  search: Search, doc: FileText, wave: AudioLines, play: Clapperboard, image: Image, rocket: Rocket, sparkle: Sparkles,
} satisfies Record<typeof buildingIcons[number], unknown>;

export const buildingIconLabels: Record<typeof buildingIcons[number], string> = {
  search: 'Research', doc: 'Document', wave: 'Voice', play: 'Video', image: 'Image', rocket: 'Rocket', sparkle: 'Sparkle',
};

/** HTML icon matching a building's sign emblem. Decorative by default. */
export function BuildingIcon({ icon, ...props }: { icon?: typeof buildingIcons[number] } & LucideProps) {
  const Icon = ICONS[icon ?? 'sparkle'] ?? Sparkles;
  return <Icon aria-hidden="true" {...props} />;
}
