import type {
  InternalPlanKey,
  ResolvedSubscriptionFeatureEntitlement,
  SalonFeatures,
  SubscriptionFeatureKey,
} from '@/types/salonPolicy';

export const INTERNAL_PLAN_KEYS = [
  'free',
  'tier_1',
  'tier_2',
  'enterprise',
] as const satisfies readonly InternalPlanKey[];

export const SUBSCRIPTION_FEATURE_KEYS = [
  'booking_experience_customization',
] as const satisfies readonly SubscriptionFeatureKey[];

const STORED_PLAN_TO_INTERNAL_PLAN: Readonly<Record<string, InternalPlanKey>> = {
  free: 'free',
  single_salon: 'tier_1',
  multi_salon: 'tier_2',
  enterprise: 'enterprise',
};

/**
 * Plan defaults are deliberately independent of customer-facing names, prices,
 * Stripe Price IDs, billing status, and freeSoloEnabled.
 */
export const SUBSCRIPTION_FEATURE_PLAN_DEFAULTS: Readonly<
  Record<SubscriptionFeatureKey, Readonly<Record<InternalPlanKey, boolean>>>
> = {
  booking_experience_customization: {
    free: false,
    tier_1: true,
    tier_2: true,
    enterprise: true,
  },
};

export type SubscriptionEntitlementContext = {
  storedPlan?: unknown;
  features?: SalonFeatures | null;
};

export type ResolveSubscriptionFeatureEntitlementInput =
  SubscriptionEntitlementContext & {
    featureKey: SubscriptionFeatureKey;
  };

/**
 * Maps persisted, legacy salon plan values to stable internal keys.
 * Unknown, malformed, null, and missing values fail closed to free.
 */
export function mapStoredPlanToInternalPlan(storedPlan: unknown): InternalPlanKey {
  if (typeof storedPlan !== 'string') {
    return 'free';
  }

  return STORED_PLAN_TO_INTERNAL_PLAN[storedPlan] ?? 'free';
}

const SUBSCRIPTION_FEATURE_OVERRIDE_READERS: Readonly<
  Record<
    SubscriptionFeatureKey,
    (features: SalonFeatures | null | undefined) => boolean | undefined
  >
> = {
  booking_experience_customization: (features) => {
    const value = features?.booking?.customization;
    return typeof value === 'boolean' ? value : undefined;
  },
};

function readSubscriptionFeatureOverride(
  features: SalonFeatures | null | undefined,
  featureKey: SubscriptionFeatureKey,
): boolean | undefined {
  return SUBSCRIPTION_FEATURE_OVERRIDE_READERS[featureKey](features);
}

/**
 * Resolves a subscription feature from trusted, server-loaded salon state.
 *
 * An explicit per-salon boolean override wins over the mapped plan default.
 * Consumers should use this decision instead of inspecting persisted plan
 * values directly.
 */
export function resolveSubscriptionFeatureEntitlement({
  storedPlan,
  features,
  featureKey,
}: ResolveSubscriptionFeatureEntitlementInput): ResolvedSubscriptionFeatureEntitlement {
  const normalizedStoredPlan = typeof storedPlan === 'string' ? storedPlan : null;
  const planKey = mapStoredPlanToInternalPlan(storedPlan);
  const override = readSubscriptionFeatureOverride(features, featureKey);
  const source = override === undefined ? 'plan' : 'override';
  const entitled = override
    ?? SUBSCRIPTION_FEATURE_PLAN_DEFAULTS[featureKey][planKey];

  return {
    featureKey,
    entitled,
    source,
    planKey,
    storedPlan: normalizedStoredPlan,
    lockedReason: entitled ? null : 'upgrade_required',
  };
}

export function resolveBookingExperienceEntitlement(
  context: SubscriptionEntitlementContext,
): ResolvedSubscriptionFeatureEntitlement {
  return resolveSubscriptionFeatureEntitlement({
    ...context,
    featureKey: 'booking_experience_customization',
  });
}

export const FEATURE_DEFAULTS: {
  booking: { onlineBooking: boolean; staffDashboard: boolean };
  staff: { scheduleOverrides: boolean; timeOff: boolean };
  clients: { clientProfiles: boolean; clientHistory: boolean };
  social: { photoUploads: boolean };
  marketing: { smsReminders: boolean; referrals: boolean; rewards: boolean };
  money: { staffEarnings: boolean };
  analytics: { dashboard: boolean; utilization: boolean };
  controls: { clientBlocking: boolean; clientFlags: boolean };
  visibility: {
    allowHideClientPhone: boolean;
    allowHideClientEmail: boolean;
    allowHideAppointmentPrice: boolean;
    allowHideClientHistory: boolean;
    allowHideClientFullName: boolean;
    allowHideClientNotes: boolean;
  };
} = {
  booking: { onlineBooking: true, staffDashboard: true },
  staff: { scheduleOverrides: true, timeOff: true },
  clients: { clientProfiles: true, clientHistory: true },
  social: { photoUploads: true },
  marketing: { smsReminders: false, referrals: false, rewards: false },
  money: { staffEarnings: false },
  analytics: { dashboard: false, utilization: false },
  controls: { clientBlocking: false, clientFlags: false },
  visibility: {
    allowHideClientPhone: true,
    allowHideClientEmail: true,
    allowHideAppointmentPrice: true,
    allowHideClientHistory: true,
    allowHideClientFullName: true,
    allowHideClientNotes: true,
  },
};

export function resolveEntitlement(
  features: SalonFeatures | null | undefined,
  group: string,
  key: string,
): boolean {
  const groupObj = features?.[group as keyof SalonFeatures];
  if (groupObj && typeof groupObj === 'object' && key in groupObj) {
    const value = (groupObj as Record<string, unknown>)[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }

  const legacyKey = key as keyof SalonFeatures;
  if (features && legacyKey in features) {
    const legacyValue = features[legacyKey];
    if (typeof legacyValue === 'boolean') {
      return legacyValue;
    }
  }

  const defaultGroup = FEATURE_DEFAULTS[group as keyof typeof FEATURE_DEFAULTS];
  if (defaultGroup && typeof defaultGroup === 'object' && key in defaultGroup) {
    return (defaultGroup as Record<string, boolean>)[key] ?? false;
  }

  return false;
}
