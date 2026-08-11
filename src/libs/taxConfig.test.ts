import { describe, expect, it } from 'vitest';

import type { SalonSettings } from '@/types/salonPolicy';

import {
  mergePaymentsSettings,
  readStoredPaymentsSettings,
  resolveEtransferSettings,
  resolveTaxConfig,
  salonPaymentsSettingsSchema,
  salonPaymentsSettingsWriteSchema,
} from './taxConfig';

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

// =============================================================================
// D3 — the deposit sub-object (Group G)
// =============================================================================

describe('payments sub-objects are read INDEPENDENTLY', () => {
  it('keeps a valid deposit block beside a malformed tax block', () => {
    const stored = readStoredPaymentsSettings({
      payments: {
        tax: 'legacy-string',
        etransfer: { recipient: 'pay@salon.test' },
        deposit: { enabled: true, amountCents: 2500 },
      },
    } as unknown as SalonSettings);

    // One bad sub-object collapses ONLY itself, never its siblings.
    expect(stored.tax).toBeUndefined();
    expect(stored.etransfer).toEqual({ recipient: 'pay@salon.test' });
    expect(stored.deposit).toEqual({ enabled: true, amountCents: 2500 });
  });

  it('reads an out-of-window stored amount rather than collapsing the block', () => {
    // Privileged whole-column writers never run the write validator, so the
    // stored parser must stay permissive and let the READ-TIME gate refuse it.
    expect(readStoredPaymentsSettings({
      payments: { deposit: { enabled: true, amountCents: 99_999_999 } },
    } as unknown as SalonSettings).deposit).toEqual({
      enabled: true,
      amountCents: 99_999_999,
    });
  });

  it('returns an empty object for a legacy non-object payments value', () => {
    expect(readStoredPaymentsSettings({ payments: 'legacy' } as unknown as SalonSettings))
      .toEqual({});
  });
});

describe('mergePaymentsSettings merges deposit field-by-field', () => {
  it('carries the untouched sibling field forward', () => {
    expect(mergePaymentsSettings(
      { deposit: { enabled: true, amountCents: 2500 } },
      { deposit: { amountCents: 4000 } },
    ).deposit).toEqual({ enabled: true, amountCents: 4000 });
  });

  it('leaves the stored deposit untouched when the update omits it', () => {
    expect(mergePaymentsSettings(
      { deposit: { enabled: true, amountCents: 2500 } },
      { tax: { rateBps: 500 } },
    ).deposit).toEqual({ enabled: true, amountCents: 2500 });
  });

  it('never yields an undefined amount for a submitted field', () => {
    // `jsonb_set` is STRICT: an undefined value stringifies to `undefined`,
    // binds as NULL, and would blank the tenant's whole settings column.
    const merged = mergePaymentsSettings({}, { deposit: { amountCents: 2500 } });

    expect(merged.deposit?.amountCents).toBe(2500);
    expect(JSON.stringify(merged.deposit?.amountCents)).not.toBe(undefined);
  });
});

describe('the WRITE schema is bounded where the stored one is not', () => {
  it('rejects amounts the stored schema accepts', () => {
    expect(salonPaymentsSettingsWriteSchema.safeParse({
      deposit: { amountCents: 99_999_999 },
    }).success).toBe(false);
    expect(salonPaymentsSettingsSchema.safeParse({
      deposit: { amountCents: 99_999_999 },
    }).success).toBe(true);
  });
});
