import { describe, expect, it } from 'vitest';

import {
  DISABLED_SMART_FIT_CONFIG,
  readStoredSmartFitSettings,
  resolveSmartFitConfig,
  SMART_FIT_LIMITS,
} from '@/libs/smartFitConfig';
import type { SalonSettings } from '@/types/salonPolicy';

const settingsWith = (smartFit: unknown): SalonSettings =>
  ({ smartFit }) as unknown as SalonSettings;

describe('resolveSmartFitConfig', () => {
  it('defaults to OFF when settings are missing entirely', () => {
    expect(resolveSmartFitConfig(null)).toEqual(DISABLED_SMART_FIT_CONFIG);
    expect(resolveSmartFitConfig(undefined)).toEqual(DISABLED_SMART_FIT_CONFIG);
    expect(resolveSmartFitConfig({} as SalonSettings)).toEqual(DISABLED_SMART_FIT_CONFIG);
    expect(resolveSmartFitConfig(null).enabled).toBe(false);
  });

  it('never throws on malformed smartFit blobs and returns stable defaults', () => {
    const malformed = [
      'garbage',
      42,
      [],
      { enabled: 'yes' },
      { enabled: true, value: 'ten' },
      { enabled: true, eligibleServiceIds: 'svc_1' },
      { enabled: true, maxRemainingGapMinutes: { a: 1 } },
    ];
    for (const blob of malformed) {
      expect(() => resolveSmartFitConfig(settingsWith(blob))).not.toThrow();
      expect(resolveSmartFitConfig(settingsWith(blob))).toEqual(DISABLED_SMART_FIT_CONFIG);
    }
  });

  it('a bare enabled flag resolves to the documented defaults (percent 10, gap 10, improvement 20, all services/techs)', () => {
    expect(resolveSmartFitConfig(settingsWith({ enabled: true }))).toEqual({
      enabled: true,
      discountType: 'percent',
      value: 10,
      maxRemainingGapMinutes: 10,
      minImprovementMinutes: 20,
      eligibleServiceIds: [],
      eligibleTechnicianIds: [],
    });
  });

  it('clamps numeric values to the approved limits and truncates fractions', () => {
    const resolved = resolveSmartFitConfig(settingsWith({
      enabled: true,
      discountType: 'percent',
      value: 150,
      maxRemainingGapMinutes: 999.9,
      minImprovementMinutes: -3,
    }));

    expect(resolved.value).toBe(SMART_FIT_LIMITS.percentMax);
    expect(resolved.maxRemainingGapMinutes).toBe(SMART_FIT_LIMITS.maxRemainingGapMinutesMax);
    expect(resolved.minImprovementMinutes).toBe(0);

    expect(resolveSmartFitConfig(settingsWith({ enabled: true, value: 12.9 })).value).toBe(12);
    expect(
      resolveSmartFitConfig(settingsWith({ enabled: true, discountType: 'fixed', value: 99_999_999 })).value,
    ).toBe(SMART_FIT_LIMITS.fixedCentsMax);
  });

  it('ignores unknown fields, including the settings the P6 plan dropped', () => {
    const resolved = resolveSmartFitConfig(settingsWith({
      enabled: true,
      beforeAfterBetweenToggles: { before: false },
      promotionStacking: true,
      suggestionDistanceMinutes: 90,
    }));

    expect(resolved.enabled).toBe(true);
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(DISABLED_SMART_FIT_CONFIG).sort());
    expect(resolved).not.toHaveProperty('promotionStacking');
    expect(resolved).not.toHaveProperty('suggestionDistanceMinutes');
  });

  it('filters empty ids out of eligibility lists', () => {
    const resolved = resolveSmartFitConfig(settingsWith({
      enabled: true,
      eligibleServiceIds: ['svc_1', ''],
      eligibleTechnicianIds: ['', 'tech_1'],
    }));

    expect(resolved.eligibleServiceIds).toEqual(['svc_1']);
    expect(resolved.eligibleTechnicianIds).toEqual(['tech_1']);
  });

  it('disabled config is returned as-is even when other fields are customized', () => {
    const resolved = resolveSmartFitConfig(settingsWith({ enabled: false, value: 25 }));

    expect(resolved).toEqual(DISABLED_SMART_FIT_CONFIG);
  });
});

describe('readStoredSmartFitSettings', () => {
  it('returns the stored shape for editing and {} for malformed blobs', () => {
    expect(readStoredSmartFitSettings(settingsWith({ enabled: true, value: 15 })))
      .toEqual({ enabled: true, value: 15 });
    expect(readStoredSmartFitSettings(settingsWith('garbage'))).toEqual({});
    expect(readStoredSmartFitSettings(null)).toEqual({});
  });
});
