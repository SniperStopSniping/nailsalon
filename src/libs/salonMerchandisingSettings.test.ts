import { describe, expect, it } from 'vitest';

import type { SalonSettings } from '@/types/salonPolicy';

import {
  DEFAULT_MERCHANDISING_SETTINGS,
  merchandisingSettingsUpdateSchema,
  resolveMerchandisingSettings,
} from './salonMerchandisingSettings';

describe('salonMerchandisingSettings', () => {
  it('defaults featureLusterManicure to enabled for null settings', () => {
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
      lusterPromoDismissed: true,
      serviceLibraryIntroDismissed: false,
    });
  });

  it('preserves an explicit opt-out', () => {
    const resolved = resolveMerchandisingSettings({
      merchandising: { featureLusterManicure: false },
    });

    expect(resolved.featureLusterManicure).toBe(false);
  });

  it('falls back to defaults when the stored shape is corrupt', () => {
    const resolved = resolveMerchandisingSettings({
      merchandising: { featureLusterManicure: 'yes please' },
    } as unknown as SalonSettings);

    expect(resolved).toEqual(DEFAULT_MERCHANDISING_SETTINGS);
  });

  it('accepts partial updates and rejects unknown values', () => {
    expect(merchandisingSettingsUpdateSchema.parse({ featureLusterManicure: false }))
      .toEqual({ featureLusterManicure: false });
    expect(() => merchandisingSettingsUpdateSchema.parse({ featureLusterManicure: 1 }))
      .toThrow();
  });
});
