import { describe, expect, it } from 'vitest';

import type { SalonSettings } from '@/types/salonPolicy';

import {
  DEFAULT_MERCHANDISING_SETTINGS,
  merchandisingSettingsUpdateSchema,
  resolveMerchandisingSettings,
} from './salonMerchandisingSettings';

describe('salonMerchandisingSettings', () => {
  it('returns canonical defaults for missing settings', () => {
    expect(resolveMerchandisingSettings(null)).toEqual(DEFAULT_MERCHANDISING_SETTINGS);
    expect(resolveMerchandisingSettings(undefined)).toEqual(DEFAULT_MERCHANDISING_SETTINGS);
    expect(resolveMerchandisingSettings({})).toEqual(DEFAULT_MERCHANDISING_SETTINGS);
  });

  it('fills missing keys with defaults', () => {
    const resolved = resolveMerchandisingSettings({
      merchandising: { lusterPromoDismissed: true },
    });

    expect(resolved).toEqual({
      featureLusterManicure: true,
      showServiceImages: true,
      lusterPromoDismissed: true,
      serviceLibraryIntroDismissed: false,
    });
  });

  it('preserves explicit opt-outs', () => {
    const resolved = resolveMerchandisingSettings({
      merchandising: {
        featureLusterManicure: false,
        showServiceImages: false,
      },
    });

    expect(resolved.featureLusterManicure).toBe(false);
    expect(resolved.showServiceImages).toBe(false);
  });

  it.each([
    ['a null merchandising block', { merchandising: null }],
    ['a null value', { merchandising: { showServiceImages: null } }],
    ['a string value', { merchandising: { showServiceImages: 'false' } }],
  ])('fails open for service images when stored settings contain %s', (_label, settings) => {
    const resolved = resolveMerchandisingSettings(
      settings as unknown as SalonSettings,
    );

    expect(resolved.showServiceImages).toBe(true);
  });

  it('defaults only a corrupt service-image value while preserving valid siblings', () => {
    const resolved = resolveMerchandisingSettings({
      merchandising: {
        featureLusterManicure: false,
        showServiceImages: null,
        lusterPromoDismissed: true,
        serviceLibraryIntroDismissed: true,
      },
    } as unknown as SalonSettings);

    expect(resolved).toEqual({
      featureLusterManicure: false,
      showServiceImages: true,
      lusterPromoDismissed: true,
      serviceLibraryIntroDismissed: true,
    });
  });

  it('falls back to defaults when the stored shape is corrupt', () => {
    const resolved = resolveMerchandisingSettings({
      merchandising: { featureLusterManicure: 'yes please' },
    } as unknown as SalonSettings);

    expect(resolved).toEqual(DEFAULT_MERCHANDISING_SETTINGS);
  });

  it('accepts partial updates and rejects unknown values', () => {
    expect(merchandisingSettingsUpdateSchema.parse({ showServiceImages: false }))
      .toEqual({ showServiceImages: false });
    expect(() => merchandisingSettingsUpdateSchema.parse({ showServiceImages: 1 }))
      .toThrow();
  });
});
