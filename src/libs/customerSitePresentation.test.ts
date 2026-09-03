import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_SITE_PALETTE_PRESETS,
  CUSTOMER_SITE_STYLE_PRESETS,
  getCustomerSitePresentationCssVariables,
  resolveCustomerSitePalettePreset,
  resolveCustomerSiteStylePreset,
} from './customerSitePresentation';

describe('customerSitePresentation', () => {
  it('resolves every supported style and palette without coupling either choice', () => {
    expect(CUSTOMER_SITE_STYLE_PRESETS).toHaveLength(6);
    expect(CUSTOMER_SITE_PALETTE_PRESETS).toHaveLength(8);

    for (const stylePreset of CUSTOMER_SITE_STYLE_PRESETS) {
      for (const palettePreset of CUSTOMER_SITE_PALETTE_PRESETS) {
        const variables = getCustomerSitePresentationCssVariables({
          palettePreset,
          stylePreset,
        });

        expect(variables['--customer-site-body-font']).toBeTruthy();
        expect(variables['--customer-site-card-radius']).toBeTruthy();
        expect(variables['--theme-background']).toMatch(/^#[0-9a-f]{6}$/i);
        expect(variables['--theme-primary']).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('uses safe released defaults for absent or unsupported ids', () => {
    expect(resolveCustomerSiteStylePreset(undefined)).toBe('modern');
    expect(resolveCustomerSiteStylePreset('future-style')).toBe('modern');
    expect(resolveCustomerSitePalettePreset(undefined)).toBe('luster_berry');
    expect(resolveCustomerSitePalettePreset('future-palette')).toBe('luster_berry');
  });

  it('maps the dark palette to readable customer-surface roles', () => {
    const variables = getCustomerSitePresentationCssVariables({
      palettePreset: 'black_champagne',
      stylePreset: 'luxury',
    });

    expect(variables).toMatchObject({
      '--booking-brand-foreground': '#211a16',
      '--booking-brand-primary': '#e1c27e',
      '--customer-site-ink': '#fff7e8',
      '--theme-background': '#151315',
      '--theme-card-background': '#221e20',
    });
  });
});
