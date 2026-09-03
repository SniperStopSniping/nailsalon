import { describe, expect, it } from 'vitest';

import type { SiteStylePresetId } from '../model/types';
import { ONBOARDING_STYLE_ROLES } from './OnboardingSitePreview';

const relativeLuminance = (hex: string): number => {
  const channels = hex.match(/[\da-f]{2}/giu)?.map(channel => (
    Number.parseInt(channel, 16) / 255
  )) ?? [];
  const linear = channels.map(channel => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * (linear[0] ?? 0))
    + (0.7152 * (linear[1] ?? 0))
    + (0.0722 * (linear[2] ?? 0));
};

const contrastRatio = (first: string, second: string): number => {
  const luminances = [relativeLuminance(first), relativeLuminance(second)]
    .sort((left, right) => right - left);
  return ((luminances[0] ?? 0) + 0.05) / ((luminances[1] ?? 0) + 0.05);
};

describe('Daniela-ready site style tokens', () => {
  it('defines six distinct complete customer style systems', () => {
    const presets = Object.keys(ONBOARDING_STYLE_ROLES) as SiteStylePresetId[];

    expect(presets).toEqual([
      'modern',
      'editorial',
      'soft',
      'minimal',
      'bold',
      'luxury',
    ]);

    for (const preset of presets) {
      expect(Object.keys(ONBOARDING_STYLE_ROLES[preset]).sort()).toEqual([
        'accent',
        'bodyFont',
        'buttonRadius',
        'ground',
        'headingFont',
        'ink',
        'line',
        'muted',
        'radius',
        'secondaryAccent',
        'spacingMood',
        'surface',
      ]);
      expect(ONBOARDING_STYLE_ROLES[preset].accent)
        .not.toBe(ONBOARDING_STYLE_ROLES[preset].ground);
    }

    expect(new Set(presets.map(preset => JSON.stringify(ONBOARDING_STYLE_ROLES[preset]))))
      .toHaveLength(6);
  });

  it('keeps small customer action text at or above WCAG AA contrast', () => {
    for (const roles of Object.values(ONBOARDING_STYLE_ROLES)) {
      expect(contrastRatio(roles.surface, roles.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
