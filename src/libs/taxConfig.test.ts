import { describe, expect, it } from 'vitest';

import { computeCheckoutTotals, computeInclusiveTaxCents } from '@/libs/checkoutTotals';
import type { SalonSettings } from '@/types/salonPolicy';

import {
  buildBookingTaxSnapshot,
  buildFinalTaxSnapshot,
  buildForfeitureTaxSnapshot,
  buildRescheduleTaxSnapshot,
  buildTaxConfigurationIdentity,
  hasReviewedForfeitureTaxTreatment,
  mergePaymentsSettings,
  normalizeTaxSettingsForTimeZone,
  readStoredPaymentsSettings,
  resolveEtransferSettings,
  resolveTaxConfig,
  salonPaymentsSettingsSchema,
  salonPaymentsSettingsWriteSchema,
  selectActiveInvoiceTaxSnapshot,
  validateForfeitureTaxSnapshot,
  validateInvoiceTaxSnapshot,
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
      forfeitureTaxEstimationEnabled: false,
      configurationSource: 'base',
      configurationEffectiveFrom: null,
      configurationEffectiveDate: null,
      configurationTimeZone: null,
      jurisdiction: null,
      country: null,
      region: null,
    });
  });

  it('uses the scheduled rate only once its effective date passes and preserves its identity', () => {
    const settings: SalonSettings = {
      payments: {
        tax: {
          enabled: true,
          name: 'HST',
          rateBps: 1300,
          jurisdiction: 'Ontario HST',
          country: 'CA',
          region: 'ON',
          scheduledChange: { rateBps: 1500, effectiveFrom: '2026-08-01T00:00:00Z' },
        },
      },
    };

    const before = resolveTaxConfig(settings, new Date('2026-07-31T23:59:59Z'));
    const after = resolveTaxConfig(settings, new Date('2026-08-01T00:00:00Z'));

    expect(before).toMatchObject({
      rateBps: 1300,
      configurationSource: 'base',
      configurationEffectiveFrom: null,
    });
    expect(after).toMatchObject({
      rateBps: 1500,
      configurationSource: 'scheduled_change',
      configurationEffectiveFrom: '2026-08-01T00:00:00.000Z',
      configurationEffectiveDate: null,
      configurationTimeZone: null,
      jurisdiction: 'Ontario HST',
      country: 'CA',
      region: 'ON',
    });
  });

  it('normalizes a scheduled date to midnight in the salon timezone', () => {
    const normalized = normalizeTaxSettingsForTimeZone({
      enabled: true,
      rateBps: 1300,
      scheduledChange: {
        rateBps: 1500,
        effectiveFrom: '2026-09-01',
      },
    }, 'America/Toronto');

    expect(normalized.scheduledChange).toEqual({
      rateBps: 1500,
      effectiveFrom: '2026-09-01T04:00:00.000Z',
      effectiveDate: '2026-09-01',
      effectiveTimeZone: 'America/Toronto',
    });

    const settings = { payments: { tax: normalized } } satisfies SalonSettings;

    expect(resolveTaxConfig(settings, new Date('2026-09-01T03:59:59.999Z')))
      .toMatchObject({ rateBps: 1300, configurationSource: 'base' });
    expect(resolveTaxConfig(settings, new Date('2026-09-01T04:00:00.000Z')))
      .toMatchObject({
        rateBps: 1500,
        configurationSource: 'scheduled_change',
        configurationEffectiveFrom: '2026-09-01T04:00:00.000Z',
        configurationEffectiveDate: '2026-09-01',
        configurationTimeZone: 'America/Toronto',
      });
  });

  it('retains explicit disabled metadata without enabling tax', () => {
    const config = resolveTaxConfig({
      payments: {
        tax: {
          enabled: false,
          name: 'GST',
          rateBps: 500,
          pricesIncludeTax: true,
          jurisdiction: 'Federal',
          country: ' CA ',
        },
      },
    }, NOW);

    expect(config).toMatchObject({
      enabled: false,
      name: 'GST',
      rateBps: 500,
      pricesIncludeTax: true,
      configurationSource: 'base',
      jurisdiction: 'Federal',
      country: 'CA',
    });
  });

  it('tolerates malformed legacy settings as tax-off', () => {
    const settings = {
      payments: { tax: { enabled: 'yes', rateBps: 'thirteen' } },
    } as unknown as SalonSettings;

    expect(resolveTaxConfig(settings, NOW).enabled).toBe(false);
  });
});

describe('D6.1 tax snapshots', () => {
  const taxSettings: SalonSettings = {
    payments: {
      tax: {
        enabled: true,
        name: 'HST',
        rateBps: 1300,
        forfeitureTaxEstimationEnabled: true,
        jurisdiction: 'Ontario HST',
        country: 'CA',
        region: 'ON',
      },
    },
  };

  it('distinguishes the booking estimate from the final actual snapshot and excludes tip', () => {
    const taxConfig = resolveTaxConfig(taxSettings, NOW);
    const totals = computeCheckoutTotals({
      items: [{ lineTotalCents: 10000, taxable: true }],
      taxConfig,
      tipCents: 2000,
    });

    const booking = buildBookingTaxSnapshot({
      taxConfig,
      totals,
      capturedAt: NOW,
      currency: 'cad',
    });
    const final = buildFinalTaxSnapshot({
      taxConfig,
      totals,
      capturedAt: NOW,
      currency: 'CAD',
    });

    expect(booking).toMatchObject({
      schemaVersion: 1,
      kind: 'booking_estimate',
      classification: 'estimate',
      capturedAt: NOW.toISOString(),
      currency: 'CAD',
      serviceSubtotalCents: 10000,
      taxAmountCents: 1300,
      invoiceTotalCents: 11300,
      configuration: {
        label: 'HST',
        rateBps: 1300,
        mode: 'added',
        taxServicesByDefault: true,
        taxAddOnsByDefault: true,
        taxCustomByDefault: true,
        forfeitureTaxEstimationEnabled: true,
        configurationEffectiveDate: null,
        configurationTimeZone: null,
        configurationIdentityVersion: 1,
        configurationIdentity: expect.stringMatching(/^tax-config:v1:/),
        jurisdiction: 'Ontario HST',
        country: 'CA',
        region: 'ON',
      },
    });
    expect(final).toMatchObject({
      kind: 'final_actual',
      classification: 'actual',
      invoiceTotalCents: 11300,
      taxExempt: false,
      taxExemptReason: null,
    });
    expect(totals.totalDueCents).toBe(13300);
  });

  it('keeps the original estimate as history while selecting the latest reschedule estimate', () => {
    const original = buildRescheduleTaxSnapshot({
      settings: taxSettings,
      capturedAt: NOW,
      currency: 'CAD',
      serviceLineTotalCents: 10_000,
      addOnLineTotalCents: 0,
      discountCents: 0,
    });
    const rescheduled = buildRescheduleTaxSnapshot({
      settings: taxSettings,
      capturedAt: new Date(NOW.getTime() + 60_000),
      currency: 'CAD',
      serviceLineTotalCents: 10_000,
      addOnLineTotalCents: 2_000,
      discountCents: 1_000,
    });
    const final = buildFinalTaxSnapshot({
      taxConfig: resolveTaxConfig(taxSettings, NOW),
      totals: computeCheckoutTotals({
        items: [{ lineTotalCents: 9_000, taxable: true }],
        taxConfig: resolveTaxConfig(taxSettings, NOW),
      }),
      capturedAt: new Date(NOW.getTime() + 120_000),
      currency: 'CAD',
    });

    expect(selectActiveInvoiceTaxSnapshot({
      bookingTaxSnapshot: original,
      rescheduleTaxSnapshot: rescheduled,
      finalTaxSnapshot: null,
    })).toEqual({ source: 'reschedule', snapshot: rescheduled });
    expect(selectActiveInvoiceTaxSnapshot({
      bookingTaxSnapshot: original,
      rescheduleTaxSnapshot: rescheduled,
      finalTaxSnapshot: final,
    })).toEqual({ source: 'final', snapshot: final });
    expect(selectActiveInvoiceTaxSnapshot({
      bookingTaxSnapshot: original,
      rescheduleTaxSnapshot: null,
      finalTaxSnapshot: null,
    })).toEqual({ source: 'booking', snapshot: original });
    expect(selectActiveInvoiceTaxSnapshot({
      bookingTaxSnapshot: null,
      rescheduleTaxSnapshot: null,
      finalTaxSnapshot: null,
    })).toEqual({ source: 'historical', snapshot: null });
    expect(original.invoiceTotalCents).toBe(11_300);
    expect(rescheduled.invoiceTotalCents).toBe(12_430);
  });

  it('records an actual exemption without inventing tax', () => {
    const taxConfig = resolveTaxConfig(taxSettings, NOW);
    const totals = computeCheckoutTotals({
      items: [{ lineTotalCents: 10000, taxable: true }],
      taxConfig,
      taxExempt: true,
    });
    const snapshot = buildFinalTaxSnapshot({
      taxConfig,
      totals,
      capturedAt: NOW,
      currency: 'CAD',
      taxExempt: true,
      taxExemptReason: 'Certificate on file',
    });

    expect(snapshot).toMatchObject({
      taxApplied: false,
      taxAmountCents: 0,
      invoiceTotalCents: 10000,
      taxExempt: true,
      taxExemptReason: 'Certificate on file',
    });
  });

  it('reuses inclusive checkout rounding for the optional forfeiture estimate', () => {
    const taxConfig = resolveTaxConfig(taxSettings, NOW);
    const snapshot = buildForfeitureTaxSnapshot({
      taxConfig,
      grossForfeitedCents: 2500,
      capturedAt: NOW,
      currency: 'CAD',
      estimateTaxIncluded: true,
    });

    expect(snapshot).toMatchObject({
      kind: 'forfeiture_estimate',
      classification: 'estimate',
      grossForfeitedCents: 2500,
      taxEstimateApplied: true,
      estimatedTaxIncludedCents: 288,
      estimatedNetCents: 2212,
    });
    expect(snapshot.estimatedTaxIncludedCents).toBe(computeInclusiveTaxCents(2500, 1300));
  });

  it('reports gross only when forfeiture estimation is not explicitly enabled', () => {
    const taxConfig = resolveTaxConfig({
      payments: {
        tax: {
          ...taxSettings.payments?.tax,
          forfeitureTaxEstimationEnabled: false,
        },
      },
    }, NOW);
    const snapshot = buildForfeitureTaxSnapshot({
      taxConfig,
      grossForfeitedCents: 2500,
      capturedAt: NOW,
      currency: 'CAD',
      estimateTaxIncluded: false,
    });

    expect(snapshot).toMatchObject({
      taxEstimateApplied: false,
      estimatedTaxIncludedCents: 0,
      estimatedNetCents: 2500,
    });
  });

  it('requires both the stored opt-in and reviewed jurisdiction, regardless of caller hints', () => {
    const optedInOntario = resolveTaxConfig(taxSettings, NOW);
    const enabled = buildForfeitureTaxSnapshot({
      taxConfig: optedInOntario,
      grossForfeitedCents: 2500,
      capturedAt: NOW,
      currency: 'CAD',
      estimateTaxIncluded: false,
    });

    expect(enabled.taxEstimateApplied).toBe(true);

    const unreviewed = buildForfeitureTaxSnapshot({
      taxConfig: {
        ...optedInOntario,
        country: 'US',
        region: 'NY',
      },
      grossForfeitedCents: 2500,
      capturedAt: NOW,
      currency: 'CAD',
      estimateTaxIncluded: true,
    });

    expect(unreviewed).toMatchObject({
      taxEstimateApplied: false,
      estimatedTaxIncludedCents: 0,
      estimatedNetCents: 2500,
    });
  });

  it('rejects invoice identity, money, kind, timestamp, and currency mutants', () => {
    const taxConfig = resolveTaxConfig(taxSettings, NOW);
    const totals = computeCheckoutTotals({
      items: [{ lineTotalCents: 10000, taxable: true }],
      taxConfig,
    });
    const original = buildBookingTaxSnapshot({
      taxConfig,
      totals,
      capturedAt: NOW,
      currency: 'CAD',
    });

    expect(validateInvoiceTaxSnapshot(original, {
      expectedKind: 'booking_estimate',
      expectedCurrency: 'CAD',
    }).ok).toBe(true);

    const mutants: Array<[string, unknown, string]> = [
      ['identity', {
        ...original,
        configuration: { ...original.configuration, rateBps: 500 },
      }, 'TAX_SNAPSHOT_CONFIGURATION_IDENTITY_MISMATCH'],
      ['money', { ...original, taxAmountCents: 1299 }, 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH'],
      ['kind', { ...original, kind: 'final_actual' }, 'TAX_SNAPSHOT_KIND_MISMATCH'],
      ['classification', { ...original, classification: 'actual' }, 'TAX_SNAPSHOT_CLASSIFICATION_MISMATCH'],
      ['timestamp', { ...original, capturedAt: '2026-07-18T12:00:00Z' }, 'TAX_SNAPSHOT_TIMESTAMP_INVALID'],
      ['currency', { ...original, currency: 'cad' }, 'TAX_SNAPSHOT_CURRENCY_MISMATCH'],
      ['integer', { ...original, serviceSubtotalCents: 10000.5 }, 'TAX_SNAPSHOT_MONEY_INVALID'],
      ['range', { ...original, serviceSubtotalCents: 50_000_001 }, 'TAX_SNAPSHOT_MONEY_INVALID'],
    ];
    for (const [label, mutant, code] of mutants) {
      expect(
        validateInvoiceTaxSnapshot(mutant, {
          expectedKind: 'booking_estimate',
          expectedCurrency: 'CAD',
        }),
        label,
      ).toMatchObject({ ok: false, code });
    }
  });

  it('rejects one-sided appointment scalar drift for booking and final snapshots', () => {
    const taxConfig = resolveTaxConfig(taxSettings, NOW);
    const totals = computeCheckoutTotals({
      items: [{ lineTotalCents: 10000, taxable: true }],
      taxConfig,
    });
    const booking = buildBookingTaxSnapshot({
      taxConfig,
      totals,
      capturedAt: NOW,
      currency: 'CAD',
    });
    const final = buildFinalTaxSnapshot({
      taxConfig,
      totals,
      capturedAt: NOW,
      currency: 'CAD',
    });

    expect(validateInvoiceTaxSnapshot(booking, {
      expectedKind: 'booking_estimate',
      expectedCurrency: 'CAD',
      expectedScalars: { bookingTotalPriceCents: 10000 },
    }).ok).toBe(true);
    expect(validateInvoiceTaxSnapshot(booking, {
      expectedKind: 'booking_estimate',
      expectedCurrency: 'CAD',
      expectedScalars: { bookingTotalPriceCents: 9999 },
    })).toMatchObject({
      ok: false,
      code: 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
    });

    expect(validateInvoiceTaxSnapshot(final, {
      expectedKind: 'final_actual',
      expectedCurrency: 'CAD',
      expectedScalars: {
        finalPriceCents: 10000,
        taxableSubtotalCents: 10000,
        taxAmountCents: 1301,
        taxExempt: false,
        taxExemptReason: null,
      },
    })).toMatchObject({
      ok: false,
      code: 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
    });

    const internallyConsistentSnapshotDrift = {
      ...final,
      serviceSubtotalCents: 10001,
      invoiceTotalCents: 11301,
    };

    expect(validateInvoiceTaxSnapshot(internallyConsistentSnapshotDrift, {
      expectedKind: 'final_actual',
      expectedCurrency: 'CAD',
      expectedScalars: {
        finalPriceCents: 10000,
        taxableSubtotalCents: 10000,
        taxAmountCents: 1300,
        taxExempt: false,
        taxExemptReason: null,
      },
    })).toMatchObject({
      ok: false,
      code: 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
    });
  });

  it('uses mode-specific taxable-pool bounds and accepts valid tax-inclusive invoices', () => {
    const addedConfig = resolveTaxConfig(taxSettings, NOW);
    const addedTotals = computeCheckoutTotals({
      items: [{ lineTotalCents: 10000, taxable: true }],
      taxConfig: addedConfig,
    });
    const added = buildBookingTaxSnapshot({
      taxConfig: addedConfig,
      totals: addedTotals,
      capturedAt: NOW,
      currency: 'CAD',
    });
    const includedConfig = resolveTaxConfig({
      payments: {
        tax: {
          ...taxSettings.payments!.tax!,
          pricesIncludeTax: true,
        },
      },
    }, NOW);
    const includedTotals = computeCheckoutTotals({
      items: [{ lineTotalCents: 10000, taxable: true }],
      taxConfig: includedConfig,
    });
    const included = buildBookingTaxSnapshot({
      taxConfig: includedConfig,
      totals: includedTotals,
      capturedAt: NOW,
      currency: 'CAD',
    });

    expect(included.taxableSubtotalCents).toBeGreaterThan(included.serviceSubtotalCents);
    expect(validateInvoiceTaxSnapshot(included).ok).toBe(true);

    const impossibleAdded = {
      ...added,
      serviceSubtotalCents: 1,
      invoiceTotalCents: 1 + added.taxAmountCents,
    };
    const impossibleIncluded = {
      ...included,
      serviceSubtotalCents: 1,
      invoiceTotalCents: 1 + included.taxAmountCents,
    };

    expect(validateInvoiceTaxSnapshot(impossibleAdded)).toMatchObject({
      ok: false,
      code: 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
    });
    expect(validateInvoiceTaxSnapshot(impossibleIncluded)).toMatchObject({
      ok: false,
      code: 'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
    });
  });

  it('rejects forfeiture opt-in, jurisdiction, identity, and arithmetic mutants', () => {
    const original = buildForfeitureTaxSnapshot({
      taxConfig: resolveTaxConfig(taxSettings, NOW),
      grossForfeitedCents: 2500,
      capturedAt: NOW,
      currency: 'CAD',
    });

    expect(validateForfeitureTaxSnapshot(original, {
      expectedCurrency: 'CAD',
      expectedGrossForfeitedCents: 2500,
      expectedCapturedAt: NOW,
    }).ok).toBe(true);

    const reidentify = (
      configuration: typeof original.configuration,
    ): typeof original.configuration => {
      const {
        configurationIdentity: _oldIdentity,
        configurationIdentityVersion,
        ...fields
      } = configuration;
      void _oldIdentity;
      return {
        ...fields,
        configurationIdentityVersion,
        configurationIdentity: buildTaxConfigurationIdentity(fields),
      };
    };
    for (const mutant of [
      {
        ...original,
        configuration: reidentify({
          ...original.configuration,
          forfeitureTaxEstimationEnabled: false,
        }),
      },
      {
        ...original,
        configuration: reidentify({
          ...original.configuration,
          country: 'US',
          region: 'NY',
        }),
      },
      { ...original, estimatedTaxIncludedCents: 287, estimatedNetCents: 2213 },
    ]) {
      expect(validateForfeitureTaxSnapshot(mutant, {
        expectedCurrency: 'CAD',
        expectedGrossForfeitedCents: 2500,
        expectedCapturedAt: NOW,
      }).ok).toBe(false);
    }
  });

  it('enables the reviewed forfeiture treatment only from explicit Ontario, Canada metadata', () => {
    expect(hasReviewedForfeitureTaxTreatment({ country: 'CA', region: 'ON' })).toBe(true);
    expect(hasReviewedForfeitureTaxTreatment({ country: 'Canada', region: 'Ontario' })).toBe(true);
    expect(hasReviewedForfeitureTaxTreatment({ country: 'CA', region: null })).toBe(false);
    expect(hasReviewedForfeitureTaxTreatment({ country: 'US', region: 'ON' })).toBe(false);
    expect(hasReviewedForfeitureTaxTreatment({ country: null, region: null })).toBe(false);
  });

  it('refuses invalid minor units and timestamps', () => {
    const taxConfig = resolveTaxConfig(taxSettings, NOW);

    expect(() => buildForfeitureTaxSnapshot({
      taxConfig,
      grossForfeitedCents: 25.5,
      capturedAt: NOW,
      currency: 'CAD',
      estimateTaxIncluded: true,
    })).toThrow(TypeError);
    expect(() => buildForfeitureTaxSnapshot({
      taxConfig,
      grossForfeitedCents: 2500,
      capturedAt: new Date(Number.NaN),
      currency: 'CAD',
      estimateTaxIncluded: true,
    })).toThrow(TypeError);
    expect(() => computeInclusiveTaxCents(Number.MAX_SAFE_INTEGER, 1300)).toThrow(RangeError);
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
