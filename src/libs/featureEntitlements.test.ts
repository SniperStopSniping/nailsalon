import { describe, expect, it } from 'vitest';

import {
  INTERNAL_PLAN_KEYS,
  mapStoredPlanToInternalPlan,
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
