import { describe, expect, it } from 'vitest';

import {
  buildBookingExperienceEntitlementInspection,
  getBookingExperienceOverrideAuditId,
  getBookingExperienceOverrideState,
  getSubscriptionFeaturePlanDefault,
  INTERNAL_PLAN_KEYS,
  mapStoredPlanToInternalPlan,
  parseBookingExperienceOverrideProvenance,
  resolveBookingExperienceEntitlement,
  resolveEntitlement,
  resolveSubscriptionFeatureEntitlement,
  SUBSCRIPTION_FEATURE_KEYS,
  SUBSCRIPTION_FEATURE_PLAN_DEFAULTS,
} from '@/libs/featureEntitlements';
import type { SalonFeatures } from '@/types/salonPolicy';

describe('subscription feature entitlements', () => {
  it.each([
    ['free', 'free', false],
    ['single_salon', 'tier_1', true],
    ['multi_salon', 'tier_2', true],
    ['enterprise', 'enterprise', true],
  ] as const)(
    'maps stored plan %s to %s and applies its Booking Experience default',
    (storedPlan, planKey, entitled) => {
      expect(mapStoredPlanToInternalPlan(storedPlan)).toBe(planKey);
      expect(resolveBookingExperienceEntitlement({ storedPlan })).toEqual({
        featureKey: 'booking_experience_customization',
        entitled,
        source: 'plan',
        planKey,
        storedPlan,
        lockedReason: entitled ? null : 'upgrade_required',
      });
    },
  );

  it.each([
    ['unknown string', 'premium'],
    ['empty string', ''],
    ['number', 10],
    ['boolean', true],
    ['object', { plan: 'enterprise' }],
    ['array', ['enterprise']],
    ['null', null],
    ['missing', undefined],
  ])('fails closed for a %s stored plan', (_label, storedPlan) => {
    expect(mapStoredPlanToInternalPlan(storedPlan)).toBe('free');
    expect(resolveBookingExperienceEntitlement({ storedPlan })).toEqual({
      featureKey: 'booking_experience_customization',
      entitled: false,
      source: 'plan',
      planKey: 'free',
      storedPlan: typeof storedPlan === 'string' ? storedPlan : null,
      lockedReason: 'upgrade_required',
    });
  });

  it('lets an explicit true override enable a feature disabled by the plan', () => {
    const features: SalonFeatures = {
      booking: { customization: true },
    };

    expect(resolveBookingExperienceEntitlement({
      storedPlan: 'free',
      features,
    })).toEqual({
      featureKey: 'booking_experience_customization',
      entitled: true,
      source: 'override',
      planKey: 'free',
      storedPlan: 'free',
      lockedReason: null,
    });
  });

  it('lets an explicit false override disable a feature enabled by the plan', () => {
    const features: SalonFeatures = {
      booking: { customization: false },
    };

    expect(resolveBookingExperienceEntitlement({
      storedPlan: 'enterprise',
      features,
    })).toEqual({
      featureKey: 'booking_experience_customization',
      entitled: false,
      source: 'override',
      planKey: 'enterprise',
      storedPlan: 'enterprise',
      lockedReason: 'upgrade_required',
    });
  });

  it('ignores a non-boolean override and uses the plan default', () => {
    const features = {
      booking: { customization: 'true' },
    } as unknown as SalonFeatures;

    expect(resolveBookingExperienceEntitlement({
      storedPlan: 'free',
      features,
    })).toMatchObject({
      entitled: false,
      source: 'plan',
      planKey: 'free',
    });
  });

  it('does not inspect freeSoloEnabled', () => {
    const freeSoloSalon = {
      storedPlan: 'free',
      features: {},
      freeSoloEnabled: true,
    };
    const nonFreeSoloSalon = {
      storedPlan: 'free',
      features: {},
      freeSoloEnabled: false,
    };

    expect(resolveBookingExperienceEntitlement(freeSoloSalon))
      .toEqual(resolveBookingExperienceEntitlement(nonFreeSoloSalon));
    expect(resolveBookingExperienceEntitlement(freeSoloSalon).entitled).toBe(false);
  });

  it('exposes the same result through the generic stable-feature resolver', () => {
    const input = {
      storedPlan: 'single_salon',
      features: { booking: { customization: false } },
    } satisfies {
      storedPlan: string;
      features: SalonFeatures;
    };

    expect(resolveSubscriptionFeatureEntitlement({
      ...input,
      featureKey: 'booking_experience_customization',
    })).toEqual(resolveBookingExperienceEntitlement(input));
  });

  it('publishes only the approved stable plan and feature keys and defaults', () => {
    expect(INTERNAL_PLAN_KEYS).toEqual(['free', 'tier_1', 'tier_2', 'enterprise']);
    expect(SUBSCRIPTION_FEATURE_KEYS).toEqual(['booking_experience_customization']);
    expect(SUBSCRIPTION_FEATURE_PLAN_DEFAULTS).toEqual({
      booking_experience_customization: {
        free: false,
        tier_1: true,
        tier_2: true,
        enterprise: true,
      },
    });
  });

  it.each([
    [undefined, 'default'],
    [{ booking: {} }, 'default'],
    [{ booking: { customization: true } }, 'force_enabled'],
    [{ booking: { customization: false } }, 'force_disabled'],
    [{ booking: { customization: 'true' } }, 'default'],
  ] as const)('derives the three-state Booking Experience override from %j', (features, state) => {
    expect(getBookingExperienceOverrideState(features as SalonFeatures | undefined)).toBe(state);
  });

  it('keeps plan defaults independent from override metadata', () => {
    expect(getSubscriptionFeaturePlanDefault(
      'free',
      'booking_experience_customization',
    )).toBe(false);
    expect(getSubscriptionFeaturePlanDefault(
      'single_salon',
      'booking_experience_customization',
    )).toBe(true);
  });

  it.each([
    ['valid pointer', 'audit-1', 'audit-1'],
    ['missing pointer', undefined, null],
    ['empty pointer', '', null],
    ['whitespace pointer', ' audit-1 ', null],
    ['oversized pointer', 'a'.repeat(129), null],
    ['non-string pointer', 42, null],
  ])('safely reads a %s without using it as an entitlement input', (_label, pointer, expected) => {
    const features = {
      booking: {
        customizationOverrideAuditId: pointer,
      },
    } as unknown as SalonFeatures;

    expect(getBookingExperienceOverrideAuditId(features)).toBe(expected);
    expect(resolveBookingExperienceEntitlement({
      storedPlan: 'free',
      features,
    })).toMatchObject({
      entitled: false,
      source: 'plan',
    });
  });

  it('builds an inspection only from matching current provenance', () => {
    const features: SalonFeatures = {
      booking: {
        customization: true,
        customizationOverrideAuditId: 'audit-1',
      },
    };
    const matchingProvenance = {
      auditId: 'audit-1',
      overrideState: 'force_enabled',
      reason: 'Approved support exception',
      actor: { id: 'admin-1', email: 'admin@example.test' },
      updatedAt: '2026-07-27T17:00:00.000Z',
    } as const;

    expect(buildBookingExperienceEntitlementInspection(
      { storedPlan: 'free', features },
      matchingProvenance,
    )).toEqual({
      featureKey: 'booking_experience_customization',
      entitled: true,
      source: 'override',
      planKey: 'free',
      storedPlan: 'free',
      lockedReason: null,
      planDefault: false,
      overrideState: 'force_enabled',
      overrideAuditId: 'audit-1',
      reason: 'Approved support exception',
      actor: { id: 'admin-1', email: 'admin@example.test' },
      updatedAt: '2026-07-27T17:00:00.000Z',
      provenanceRecorded: true,
    });

    expect(buildBookingExperienceEntitlementInspection(
      { storedPlan: 'free', features },
      { ...matchingProvenance, auditId: 'audit-from-another-salon' },
    )).toMatchObject({
      entitled: true,
      reason: null,
      actor: null,
      updatedAt: null,
      provenanceRecorded: false,
    });
  });

  it('never lets malformed or mismatched provenance change entitlement resolution', () => {
    const features = {
      booking: {
        customization: false,
        customizationOverrideAuditId: 'audit-1',
      },
    } satisfies SalonFeatures;

    const inspection = buildBookingExperienceEntitlementInspection(
      { storedPlan: 'enterprise', features },
      {
        auditId: 'audit-1',
        overrideState: 'force_enabled',
        reason: 'Mismatched state',
        actor: { id: 'admin-1', email: null },
        updatedAt: 'not-a-date',
      },
    );

    expect(inspection).toMatchObject({
      overrideState: 'force_disabled',
      entitled: false,
      source: 'override',
      reason: null,
      actor: null,
      updatedAt: null,
      provenanceRecorded: false,
    });
  });

  it('accepts provenance only from the exact salon, action, feature, state, and pointer', () => {
    const candidate = {
      id: 'audit-1',
      salonId: 'salon-1',
      action: 'booking_experience_entitlement_override_changed',
      performedBy: 'admin-1',
      performedByEmail: 'admin@example.test',
      metadata: {
        field: 'booking_experience_customization',
        newValue: {
          overrideState: 'force_enabled',
          reason: 'Approved exception',
        },
      },
      createdAt: new Date('2026-07-27T17:00:00.000Z'),
    };
    const expected = {
      salonId: 'salon-1',
      auditId: 'audit-1',
      overrideState: 'force_enabled',
    } as const;

    expect(parseBookingExperienceOverrideProvenance(candidate, expected)).toEqual({
      auditId: 'audit-1',
      overrideState: 'force_enabled',
      reason: 'Approved exception',
      actor: { id: 'admin-1', email: 'admin@example.test' },
      updatedAt: '2026-07-27T17:00:00.000Z',
    });
    expect(parseBookingExperienceOverrideProvenance(
      { ...candidate, salonId: 'salon-2' },
      expected,
    )).toBeNull();
    expect(parseBookingExperienceOverrideProvenance(
      { ...candidate, action: 'updated' },
      expected,
    )).toBeNull();
    expect(parseBookingExperienceOverrideProvenance(
      {
        ...candidate,
        metadata: {
          ...candidate.metadata,
          field: 'another_feature',
        },
      },
      expected,
    )).toBeNull();
  });
});

describe('legacy feature entitlement compatibility', () => {
  it('preserves nested, legacy, and default resolution behavior', () => {
    expect(resolveEntitlement(
      { marketing: { smsReminders: true } },
      'marketing',
      'smsReminders',
    )).toBe(true);
    expect(resolveEntitlement(
      { smsReminders: true },
      'marketing',
      'smsReminders',
    )).toBe(true);
    expect(resolveEntitlement({}, 'marketing', 'smsReminders')).toBe(false);
  });
});
