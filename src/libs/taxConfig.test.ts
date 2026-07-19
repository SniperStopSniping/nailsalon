import { describe, expect, it } from 'vitest';

import type { SalonSettings } from '@/types/salonPolicy';

import { resolveEtransferSettings, resolveTaxConfig } from './taxConfig';

const NOW = new Date('2026-07-18T12:00:00Z');

describe('resolveTaxConfig', () => {
  it('defaults to tax OFF when settings are missing entirely', () => {
    expect(resolveTaxConfig(null, NOW).enabled).toBe(false);
    expect(resolveTaxConfig(undefined, NOW).enabled).toBe(false);
    expect(resolveTaxConfig({}, NOW).enabled).toBe(false);
    expect(resolveTaxConfig({ payments: {} }, NOW).enabled).toBe(false);
  });

  it('never enables tax without an explicit enabled flag (no address inference)', () => {
    const settings: SalonSettings = {
      payments: { tax: { name: 'HST', rateBps: 1300 } },
    };

    expect(resolveTaxConfig(settings, NOW).enabled).toBe(false);
  });

  it('resolves an enabled config with defaults applied', () => {
    const settings: SalonSettings = {
      payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } },
    };
    const config = resolveTaxConfig(settings, NOW);

    expect(config).toEqual({
      enabled: true,
      name: 'HST',
      rateBps: 1300,
      pricesIncludeTax: false,
      taxServicesByDefault: true,
      taxAddOnsByDefault: true,
      taxCustomByDefault: true,
    });
  });

  it('uses the scheduled rate only once its effective date passes', () => {
    const settings: SalonSettings = {
      payments: {
        tax: {
          enabled: true,
          name: 'HST',
          rateBps: 1300,
          scheduledChange: { rateBps: 1500, effectiveFrom: '2026-08-01T00:00:00Z' },
        },
      },
    };

    expect(resolveTaxConfig(settings, new Date('2026-07-31T23:59:59Z')).rateBps).toBe(1300);
    expect(resolveTaxConfig(settings, new Date('2026-08-01T00:00:00Z')).rateBps).toBe(1500);
  });

  it('tolerates malformed legacy settings as tax-off', () => {
    const settings = {
      payments: { tax: { enabled: 'yes', rateBps: 'thirteen' } },
    } as unknown as SalonSettings;

    expect(resolveTaxConfig(settings, NOW).enabled).toBe(false);
  });
});

describe('resolveEtransferSettings', () => {
  it('defaults to disabled with no configuration', () => {
    const resolved = resolveEtransferSettings(null);

    expect(resolved.enabled).toBe(false);
    expect(resolved.recipient).toBeNull();
    expect(resolved.qrPageEnabled).toBe(false);
  });

  it('is only enabled once a recipient is configured', () => {
    expect(
      resolveEtransferSettings({ payments: { etransfer: { enabled: true } } }).enabled,
    ).toBe(false);

    const resolved = resolveEtransferSettings({
      payments: {
        etransfer: { enabled: true, recipient: 'pay@salon.ca', recipientName: 'Luster Studio' },
      },
    });

    expect(resolved.enabled).toBe(true);
    expect(resolved.recipient).toBe('pay@salon.ca');
    expect(resolved.recipientName).toBe('Luster Studio');
    expect(resolved.requireReference).toBe(true);
  });
});
