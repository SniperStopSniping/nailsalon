import type {
  BookingExperienceEntitlementInspection,
  BookingExperienceEntitlementOverrideProvenance,
  BookingExperienceEntitlementOverrideState,
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

export const BOOKING_EXPERIENCE_OVERRIDE_AUDIT_ACTION
  = 'booking_experience_entitlement_override_changed';

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

export function getSubscriptionFeaturePlanDefault(
  storedPlan: unknown,
  featureKey: SubscriptionFeatureKey,
): boolean {
  return SUBSCRIPTION_FEATURE_PLAN_DEFAULTS[featureKey][
    mapStoredPlanToInternalPlan(storedPlan)
  ];
}

export function getBookingExperienceOverrideState(
  features: SalonFeatures | null | undefined,
): BookingExperienceEntitlementOverrideState {
  const override = features?.booking?.customization;
  if (override === true) {
    return 'force_enabled';
  }
  if (override === false) {
    return 'force_disabled';
  }
  return 'default';
}

export function getBookingExperienceOverrideAuditId(
  features: SalonFeatures | null | undefined,
): string | null {
  const auditId = features?.booking?.customizationOverrideAuditId;
  return typeof auditId === 'string'
    && auditId.length > 0
    && auditId.length <= 128
    && auditId.trim() === auditId
    ? auditId
    : null;
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

export function buildBookingExperienceEntitlementInspection(
  context: SubscriptionEntitlementContext,
  provenance?: BookingExperienceEntitlementOverrideProvenance | null,
): BookingExperienceEntitlementInspection {
  const entitlement = resolveBookingExperienceEntitlement(context);
  const overrideState = getBookingExperienceOverrideState(context.features);
  const overrideAuditId = getBookingExperienceOverrideAuditId(context.features);
  const provenanceMatches = Boolean(
    provenance
    && overrideAuditId
    && provenance.auditId === overrideAuditId
    && provenance.overrideState === overrideState
    && provenance.actor.id.length > 0
    && !Number.isNaN(Date.parse(provenance.updatedAt))
    && (
      overrideState === 'default'
        ? provenance.reason === null
        : typeof provenance.reason === 'string' && provenance.reason.length > 0
    ),
  );

  return {
    ...entitlement,
    planDefault: getSubscriptionFeaturePlanDefault(
      context.storedPlan,
      'booking_experience_customization',
    ),
    overrideState,
    overrideAuditId,
    reason: provenanceMatches ? provenance!.reason : null,
    actor: provenanceMatches ? provenance!.actor : null,
    updatedAt: provenanceMatches ? provenance!.updatedAt : null,
    provenanceRecorded: provenanceMatches,
  };
}

export type BookingExperienceOverrideAuditCandidate = {
  id: unknown;
  salonId: unknown;
  action: unknown;
  performedBy: unknown;
  performedByEmail: unknown;
  metadata: unknown;
  createdAt: unknown;
};

export function parseBookingExperienceOverrideProvenance(
  candidate: BookingExperienceOverrideAuditCandidate | null | undefined,
  expected: {
    salonId: string;
    auditId: string | null;
    overrideState: BookingExperienceEntitlementOverrideState;
  },
): BookingExperienceEntitlementOverrideProvenance | null {
  if (
    !candidate
    || !expected.auditId
    || candidate.id !== expected.auditId
    || candidate.salonId !== expected.salonId
    || candidate.action !== BOOKING_EXPERIENCE_OVERRIDE_AUDIT_ACTION
    || typeof candidate.performedBy !== 'string'
    || candidate.performedBy.length === 0
    || (
      candidate.performedByEmail !== null
      && typeof candidate.performedByEmail !== 'string'
    )
  ) {
    return null;
  }

  const metadata = candidate.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const metadataRecord = metadata as Record<string, unknown>;
  if (metadataRecord.field !== 'booking_experience_customization') {
    return null;
  }

  const newValue = metadataRecord.newValue;
  if (!newValue || typeof newValue !== 'object' || Array.isArray(newValue)) {
    return null;
  }

  const next = newValue as Record<string, unknown>;
  if (next.overrideState !== expected.overrideState) {
    return null;
  }

  const reason = next.reason;
  if (
    expected.overrideState === 'default'
      ? reason !== null
      : typeof reason !== 'string'
        || reason.length === 0
        || reason.length > 500
        || reason.trim() !== reason
  ) {
    return null;
  }

  const updatedAt = candidate.createdAt instanceof Date
    ? candidate.createdAt
    : typeof candidate.createdAt === 'string'
      ? new Date(candidate.createdAt)
      : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) {
    return null;
  }

  return {
    auditId: expected.auditId,
    overrideState: expected.overrideState,
    reason: reason as string | null,
    actor: {
      id: candidate.performedBy,
      email: candidate.performedByEmail as string | null,
    },
    updatedAt: updatedAt.toISOString(),
  };
}

export const FEATURE_DEFAULTS: {
  booking: { onlineBooking: boolean; staffDashboard: boolean };
  staff: { scheduleOverrides: boolean; timeOff: boolean };
  clients: { clientProfiles: boolean; clientHistory: boolean };
  social: { photoUploads: boolean };
  marketing: { smsReminders: boolean; referrals: boolean; rewards: boolean };
  money: { staffEarnings: boolean; deposits: boolean };
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
  money: { staffEarnings: false, deposits: false },
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
