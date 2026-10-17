import type { SiteStylePresetId } from './types';

export type SiteStylePreset = {
  description: string;
  id: SiteStylePresetId;
  label: string;
};

export const SITE_STYLE_PRESETS: readonly SiteStylePreset[] = [
  { description: 'Rounded cards and clean headings.', id: 'modern', label: 'Modern' },
  { description: 'Crisp edges and refined headings.', id: 'editorial', label: 'Editorial' },
  { description: 'Soft cards and pill-shaped buttons.', id: 'soft', label: 'Soft' },
  { description: 'Simple shapes and quiet headings.', id: 'minimal', label: 'Minimal' },
  { description: 'Square cards and strong headings.', id: 'bold', label: 'Bold' },
  { description: 'Refined headings and subtle corners.', id: 'luxury', label: 'Luxury' },
] as const;

export const getSiteStyleLabel = (id: SiteStylePresetId): string =>
  SITE_STYLE_PRESETS.find(preset => preset.id === id)?.label ?? 'Website style';
