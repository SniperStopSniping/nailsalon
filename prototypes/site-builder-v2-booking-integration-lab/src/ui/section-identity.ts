import { BOOKING_LAYOUT_META } from '../booking/layout-meta';
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

  return {
    detail: section.size,
    label: section.label,
    mark: section.label.replace('Section ', ''),
    recoveryDetail: `${section.size} · settings retained`,
    short: section.size,
  };
};
