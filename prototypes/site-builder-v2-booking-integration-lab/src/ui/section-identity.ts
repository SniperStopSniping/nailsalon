import { BOOKING_LAYOUT_META } from '../booking/layout-meta';
import {
  getSectionRegistryEntry,
  isLibrarySection,
} from '../model/section-library/registry';
import type { SectionInstance } from '../model/types';

export type SectionOwnerIdentity = {
  detail: string;
  label: string;
  mark: string;
  recoveryDetail: string;
  short: string;
};

const imageCountLabel = (count: number): string =>
  `${count} image${count === 1 ? '' : 's'}`;

const displayModeLabel = (
  displayMode: 'contained' | 'full_width' | 'poster',
): string => ({
  contained: 'Contained',
  full_width: 'Full width',
  poster: 'Poster',
})[displayMode];

/** Two-letter mark from the registry label, e.g. "Final Booking CTA" -> "FB". */
const sectionLibraryMark = (label: string): string => {
  const words = label.split(/\s+/u).filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words[1]?.[0] ?? words[0]?.[1] ?? '';
  return `${first}${second}`.toUpperCase();
};

export const getSectionOwnerIdentity = (
  section: SectionInstance,
): SectionOwnerIdentity => {
  if (section.sectionType === 'booking') {
    const layout = BOOKING_LAYOUT_META[section.settings.layout].label;
    return {
      detail: layout,
      label: 'Booking',
      mark: 'B',
      recoveryDetail: 'Client booking menu',
      short: layout,
    };
  }

  if (section.sectionType === 'custom_design') {
    const count = section.settings.images.length;
    const short = count === 0 ? 'Empty' : imageCountLabel(count);
    const mode = displayModeLabel(section.settings.displayMode);
    return {
      detail: count === 0 ? 'Empty' : `${short} · ${mode}`,
      label: 'Custom Design',
      mark: 'CD',
      recoveryDetail: `${short} · settings and links retained`,
      short,
    };
  }

  if (isLibrarySection(section)) {
    const entry = getSectionRegistryEntry(section.sectionType);
    const preset = 'preset' in section.settings
      ? String(section.settings.preset).replaceAll('_', ' ')
      : entry.category;
    return {
      detail: preset,
      label: section.label,
      mark: sectionLibraryMark(entry.label),
      recoveryDetail: `${preset} · settings retained`,
      short: preset,
    };
  }

  const placeholder = section as Extract<SectionInstance, { size: unknown }>;
  return {
    detail: placeholder.size,
    label: placeholder.label,
    mark: placeholder.label.replace('Section ', ''),
    recoveryDetail: `${placeholder.size} · settings retained`,
    short: placeholder.size,
  };
};
