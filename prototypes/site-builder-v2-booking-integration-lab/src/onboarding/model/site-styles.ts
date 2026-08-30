import type { SiteStylePresetId } from './types';

export type SiteStylePreset = {
  description: string;
  id: SiteStylePresetId;
  label: string;
};

export const SITE_STYLE_PRESETS: readonly SiteStylePreset[] = [
  { description: 'Clean, warm and polished with rounded details.', id: 'modern', label: 'Modern' },
  { description: 'Magazine-inspired type with crisp lines and an elevated feel.', id: 'editorial', label: 'Editorial' },
  { description: 'Blush tones, softer shapes and a calm feminine feel.', id: 'soft', label: 'Soft' },
  { description: 'Simple neutrals, clean lines and less decoration.', id: 'minimal', label: 'Minimal' },
  { description: 'High-contrast colours, stronger type and statement details.', id: 'bold', label: 'Bold' },
  { description: 'Dark tones, refined typography and gold-inspired accents.', id: 'luxury', label: 'Luxury' },
] as const;

export const getSiteStyleLabel = (id: SiteStylePresetId): string =>
  SITE_STYLE_PRESETS.find((preset) => preset.id === id)?.label ?? 'Website style';
