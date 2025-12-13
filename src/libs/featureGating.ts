/**
 * Feature Gating - Single Source of Truth
 *
 * This file is the ONLY place that resolves effective feature/module state.
 * All other files (salonStatus.ts, API routes, etc.) MUST call these helpers.
 *
 * THREE-LAYER MODEL:
 * 1. Entitlement (Super Admin) - salon.features.* - "Is this allowed to exist?"
 * 2. Enable (Admin) - salon.settings.modules.* - "Is it turned on?"
 * 3. Visibility (Admin) - salon.settings.visibility.staff.* - "Can staff see this field?"
 *
 * EFFECTIVE RULE: effective = entitled AND adminEnabled
 * NOTE: If entitled is false, module is disabled regardless of settings.modules value.
 *       adminEnabled is only evaluated when entitled is true.
 *
 * BILLING MODE (Step 20):
 * - billingMode: 'NONE' | 'STRIPE'
 * - If billingMode !== 'STRIPE', billing enforcement (past_due locks) NEVER applies
 * - Cash-only salons work normally without subscription enforcement
 */

import { eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { salonSchema } from '@/models/Schema';
import type {
  ModuleKey,
  ResolvedModules,
  ResolvedStaffVisibility,
  SalonFeatures,
  SalonSettings,
} from '@/types/salonPolicy';

// =============================================================================
// CRITICAL: Module to Entitlement Mapping (Single Source of Truth)
// =============================================================================
// Flat module keys map to nested entitlement paths in salon.features

export const MODULE_TO_ENTITLEMENT: Record<ModuleKey, [string, string]> = {
  smsReminders: ['marketing', 'smsReminders'],
  referrals: ['marketing', 'referrals'],
  rewards: ['marketing', 'rewards'],
  scheduleOverrides: ['staff', 'scheduleOverrides'],
  staffEarnings: ['money', 'staffEarnings'],
  clientFlags: ['controls', 'clientFlags'],
  clientBlocking: ['controls', 'clientBlocking'],
  analyticsDashboard: ['analytics', 'dashboard'],
  utilization: ['analytics', 'utilization'],
} as const;

// =============================================================================
// FEATURE DEFAULTS (Nested Structure)
// =============================================================================

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
  // Core - ON by default
  booking: { onlineBooking: true, staffDashboard: true },
  staff: { scheduleOverrides: true, timeOff: true },
  clients: { clientProfiles: true, clientHistory: true },
  social: { photoUploads: true }, // TRUE - Step 14/15 needs this
  // Paid - OFF by default
  marketing: { smsReminders: false, referrals: false, rewards: false },
  money: { staffEarnings: false },
  analytics: { dashboard: false, utilization: false },
  controls: { clientBlocking: false, clientFlags: false },
  // Visibility entitlements - ON by default (admin CAN hide)
  visibility: {
    allowHideClientPhone: true,
    allowHideClientEmail: true,
    allowHideAppointmentPrice: true,
    allowHideClientHistory: true,
    allowHideClientFullName: true,
    allowHideClientNotes: true,
  },
};

// =============================================================================
// STAFF VISIBILITY DEFAULTS
// =============================================================================

export const STAFF_VISIBILITY_DEFAULTS: ResolvedStaffVisibility = {
  showClientPhone: true,
  showClientEmail: false,
  showClientFullName: true,
  showAppointmentPrice: true,
  showClientHistory: false,
  showClientNotes: true,
  showOtherTechAppointments: false,
};

// =============================================================================
// MODULE DEFAULTS (Admin Enable State)
// =============================================================================
// When entitled, default is ON unless explicitly disabled

export const MODULE_DEFAULTS: ResolvedModules = {
  smsReminders: true,
  referrals: true,
  rewards: true,
  scheduleOverrides: true,
  staffEarnings: true,
  clientFlags: true,
  clientBlocking: true,
  analyticsDashboard: true,
  utilization: true,
};

// =============================================================================
// RESOLVE ENTITLEMENT (Apply FEATURE_DEFAULTS)
// =============================================================================

/**
 * Resolve entitlement from nested features path.
 * Applies FEATURE_DEFAULTS when value is undefined.
 *
 * @param features - salon.features JSONB
 * @param group - top-level group (e.g., 'marketing')
 * @param key - nested key (e.g., 'smsReminders')
 * @returns boolean - whether the feature is entitled
 */
export function resolveEntitlement(
  features: SalonFeatures | null | undefined,
  group: string,
  key: string,
): boolean {
  // Walk nested path: features[group][key]
  const groupObj = features?.[group as keyof SalonFeatures];
  if (groupObj && typeof groupObj === 'object' && key in groupObj) {
    const value = (groupObj as Record<string, unknown>)[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }

  // Check legacy flat key (for backward compat)
  const legacyKey = key as keyof SalonFeatures;
  if (features && legacyKey in features) {
    const legacyValue = features[legacyKey];
    if (typeof legacyValue === 'boolean') {
      return legacyValue;
    }
  }

  // Use FEATURE_DEFAULTS
  const defaultGroup = FEATURE_DEFAULTS[group as keyof typeof FEATURE_DEFAULTS];
  if (defaultGroup && typeof defaultGroup === 'object' && key in defaultGroup) {
    return (defaultGroup as Record<string, boolean>)[key] ?? false;
  }

  return false;
}

// =============================================================================
// GET EFFECTIVE MODULE ENABLED
// =============================================================================

/**
 * Check if a module is effectively enabled.
 *
 * LOGIC:
 * 1. Resolve entitlement via MODULE_TO_ENTITLEMENT mapping (applies FEATURE_DEFAULTS)
 * 2. Resolve admin enabled (default true unless explicitly false)
 * 3. Return entitled && adminEnabled
 *
 * NOTE: If entitled is false, module is disabled regardless of settings.modules value.
 */
export function getEffectiveModuleEnabled(args: {
  features: SalonFeatures | null | undefined;
  settings: SalonSettings | null | undefined;
  module: ModuleKey;
}): boolean {
  const { features, settings, module } = args;

  // 1. Resolve entitlement via mapping
  const [group, key] = MODULE_TO_ENTITLEMENT[module];
  const entitled = resolveEntitlement(features, group, key);

  // If not entitled, module is disabled regardless of admin setting
  if (!entitled) {
    return false;
  }

  // 2. Resolve admin enabled (default true unless explicitly false)
  const adminEnabled = settings?.modules?.[module] !== false;

  // 3. Effective = both must be true
  return entitled && adminEnabled;
}

// =============================================================================
// GET ALL ENTITLED MODULES
// =============================================================================

/**
 * Get entitlement status for all modules.
 * Used by Admin UI to show which modules can be toggled.
 */
export function getEntitledModules(
  features: SalonFeatures | null | undefined,
): Record<ModuleKey, boolean> {
  const result: Record<ModuleKey, boolean> = {
    smsReminders: false,
    referrals: false,
    rewards: false,
    scheduleOverrides: false,
    staffEarnings: false,
    clientFlags: false,
    clientBlocking: false,
    analyticsDashboard: false,
    utilization: false,
  };

  for (const module of Object.keys(MODULE_TO_ENTITLEMENT) as ModuleKey[]) {
    const [group, key] = MODULE_TO_ENTITLEMENT[module];
    result[module] = resolveEntitlement(features, group, key);
  }

  return result;
}

// =============================================================================
// GET RESOLVED MODULES (With Defaults Applied)
// =============================================================================

/**
 * Get resolved module states with defaults applied.
 * Used by Admin UI to show toggle states.
 *
 * Returns effective admin setting state (defaults applied), not raw DB nulls.
 */
export function getResolvedModules(
  settings: SalonSettings | null | undefined,
): ResolvedModules {
  return {
    smsReminders: settings?.modules?.smsReminders ?? MODULE_DEFAULTS.smsReminders,
    referrals: settings?.modules?.referrals ?? MODULE_DEFAULTS.referrals,
    rewards: settings?.modules?.rewards ?? MODULE_DEFAULTS.rewards,
    scheduleOverrides: settings?.modules?.scheduleOverrides ?? MODULE_DEFAULTS.scheduleOverrides,
    staffEarnings: settings?.modules?.staffEarnings ?? MODULE_DEFAULTS.staffEarnings,
    clientFlags: settings?.modules?.clientFlags ?? MODULE_DEFAULTS.clientFlags,
    clientBlocking: settings?.modules?.clientBlocking ?? MODULE_DEFAULTS.clientBlocking,
    analyticsDashboard: settings?.modules?.analyticsDashboard ?? MODULE_DEFAULTS.analyticsDashboard,
    utilization: settings?.modules?.utilization ?? MODULE_DEFAULTS.utilization,
  };
}

// =============================================================================
// GET EFFECTIVE STAFF VISIBILITY
// =============================================================================

/**
 * Resolve staff visibility settings.
 *
 * For each field:
 * 1. Check entitlement: features.visibility.allowHideX (default true)
 * 2. If entitled, use setting: settings.visibility.staff.X
 * 3. If NOT entitled, force visible (safe default)
 */
export function getEffectiveStaffVisibility(
  features: SalonFeatures | null | undefined,
  settings: SalonSettings | null | undefined,
): ResolvedStaffVisibility {
  const visibilityEntitlements = features?.visibility ?? {};
  const staffSettings = settings?.visibility?.staff ?? {};

  // Staff settings key type (short form without "show" prefix)
  type StaffSettingKey = 'clientPhone' | 'clientEmail' | 'clientFullName' | 'appointmentPrice' | 'clientHistory' | 'clientNotes' | 'otherTechAppointments';

  // Helper to resolve a single visibility field
  const resolveField = (
    entitlementKey: keyof typeof FEATURE_DEFAULTS.visibility,
    staffSettingKey: StaffSettingKey,
    defaultValue: boolean,
  ): boolean => {
    // Check entitlement (default true - admin CAN hide)
    const entitled = visibilityEntitlements[entitlementKey] ?? FEATURE_DEFAULTS.visibility[entitlementKey];

    if (!entitled) {
      // Not entitled to hide - force visible (safe default)
      return true;
    }

    // Entitled - use admin setting or default
    const settingValue = staffSettings[staffSettingKey];

    return settingValue ?? defaultValue;
  };

  return {
    showClientPhone: resolveField('allowHideClientPhone', 'clientPhone', STAFF_VISIBILITY_DEFAULTS.showClientPhone),
    showClientEmail: resolveField('allowHideClientEmail', 'clientEmail', STAFF_VISIBILITY_DEFAULTS.showClientEmail),
    showClientFullName: resolveField('allowHideClientFullName', 'clientFullName', STAFF_VISIBILITY_DEFAULTS.showClientFullName),
    showAppointmentPrice: resolveField('allowHideAppointmentPrice', 'appointmentPrice', STAFF_VISIBILITY_DEFAULTS.showAppointmentPrice),
    showClientHistory: resolveField('allowHideClientHistory', 'clientHistory', STAFF_VISIBILITY_DEFAULTS.showClientHistory),
    showClientNotes: resolveField('allowHideClientNotes', 'clientNotes', STAFF_VISIBILITY_DEFAULTS.showClientNotes),
    // Note: otherTechAppointments doesn't have a separate entitlement key
    showOtherTechAppointments: staffSettings.otherTechAppointments ?? STAFF_VISIBILITY_DEFAULTS.showOtherTechAppointments,
  };
}

// =============================================================================
// IS MODULE ENTITLED (Pure Function)
// =============================================================================

/**
 * Pure function - check if module is entitled (no DB call).
 * Use when you already have salon.features loaded.
 *
 * @returns true if the module is entitled, false otherwise
 */
export function isModuleEntitled(
  features: SalonFeatures | null | undefined,
  module: ModuleKey,
): boolean {
  const [group, key] = MODULE_TO_ENTITLEMENT[module];
  return resolveEntitlement(features, group, key);
}

// =============================================================================
// GUARD ENTITLED OR UPGRADE REQUIRED (Sync - With Pre-fetched Salon)
// =============================================================================

/**
 * Guard that ONLY checks entitlement (not admin enabled).
 * Returns 403 UPGRADE_REQUIRED if not entitled, null if entitled.
 *
 * Use when you already have salon data and want to check entitlement only.
 */
export function guardEntitledOrUpgradeRequiredSync(args: {
  features: SalonFeatures | null | undefined;
  module: ModuleKey;
}): Response | null {
  const entitled = isModuleEntitled(args.features, args.module);
  if (!entitled) {
    return Response.json(
      { error: { code: 'UPGRADE_REQUIRED', message: 'Upgrade required' } },
      { status: 403 },
    );
  }
  return null;
}

// =============================================================================
// GUARD ENTITLED OR UPGRADE REQUIRED (Async - Loads Salon)
// =============================================================================

/**
 * Async guard that loads salon and checks entitlement.
 * Use when you don't have salon data yet and only need to check entitlement.
 *
 * Returns:
 * - 404 if salon not found
 * - 403 UPGRADE_REQUIRED if not entitled
 * - null if entitled
 */
export async function guardEntitledOrUpgradeRequired(args: {
  salonId: string;
  module: ModuleKey;
}): Promise<Response | null> {
  const [salon] = await db
    .select({ features: salonSchema.features })
    .from(salonSchema)
    .where(eq(salonSchema.id, args.salonId))
    .limit(1);

  if (!salon) {
    return Response.json(
      { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
      { status: 404 },
    );
  }

  return guardEntitledOrUpgradeRequiredSync({
    features: salon.features as SalonFeatures | null,
    module: args.module,
  });
}

// =============================================================================
// GUARD MODULE OR 403 (Distinguishes UPGRADE_REQUIRED vs MODULE_DISABLED)
// =============================================================================

/**
 * API guard - returns 403 Response if module is not accessible, null if allowed.
 *
 * IMPORTANT: This distinguishes between two error codes:
 * - UPGRADE_REQUIRED: Module is not entitled (needs plan upgrade)
 * - MODULE_DISABLED: Module is entitled but admin has disabled it
 *
 * Usage:
 * ```ts
 * const guard = await guardModuleOr403({ salonId, module: 'referrals' });
 * if (guard) return guard;
 * // ... proceed with logic
 * ```
 */
export async function guardModuleOr403(args: {
  salonId: string;
  module: ModuleKey;
}): Promise<Response | null> {
  const { salonId, module } = args;

  // Fetch salon features and settings
  const [salon] = await db
    .select({
      features: salonSchema.features,
      settings: salonSchema.settings,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return Response.json(
      { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
      { status: 404 },
    );
  }

  const features = salon.features as SalonFeatures | null;
  const settings = salon.settings as SalonSettings | null;

  // 1. Check entitlement first
  const entitled = isModuleEntitled(features, module);
  if (!entitled) {
    return Response.json(
      { error: { code: 'UPGRADE_REQUIRED', message: 'Upgrade required' } },
      { status: 403 },
    );
  }

  // 2. Check admin enabled (only if entitled)
  const adminEnabled = settings?.modules?.[module] !== false;
  if (!adminEnabled) {
    return Response.json(
      { error: { code: 'MODULE_DISABLED', message: 'Module disabled' } },
      { status: 403 },
    );
  }

  return null;
}

// =============================================================================
// GUARD MODULE OR 403 (Sync - With Pre-fetched Salon)
// =============================================================================

/**
 * Guard module using pre-fetched salon data (avoids extra DB query).
 *
 * IMPORTANT: This distinguishes between two error codes:
 * - UPGRADE_REQUIRED: Module is not entitled (needs plan upgrade)
 * - MODULE_DISABLED: Module is entitled but admin has disabled it
 */
export function guardModuleOr403Sync(args: {
  features: SalonFeatures | null | undefined;
  settings: SalonSettings | null | undefined;
  module: ModuleKey;
}): Response | null {
  const { features, settings, module } = args;

  // 1. Check entitlement first
  const entitled = isModuleEntitled(features, module);
  if (!entitled) {
    return Response.json(
      { error: { code: 'UPGRADE_REQUIRED', message: 'Upgrade required' } },
      { status: 403 },
    );
  }

  // 2. Check admin enabled (only if entitled)
  const adminEnabled = settings?.modules?.[module] !== false;
  if (!adminEnabled) {
    return Response.json(
      { error: { code: 'MODULE_DISABLED', message: 'Module disabled' } },
      { status: 403 },
    );
  }

  return null;
}

// =============================================================================
// BILLING MODE HELPERS (Step 20 - Stripe Optional Per Salon)
// =============================================================================

/**
 * Billing mode values
 */
export const BILLING_MODE = {
  NONE: 'NONE', // Cash-only, no Stripe enforcement
  STRIPE: 'STRIPE', // Stripe subscription billing
} as const;

export type BillingMode = (typeof BILLING_MODE)[keyof typeof BILLING_MODE];

/**
 * Stripe subscription statuses that indicate immediate "bad standing"
 * (past_due and unpaid require immediate action)
 */
export const IMMEDIATE_BAD_STANDING_STATUSES = ['past_due', 'unpaid'] as const;

/**
 * Check if Stripe billing is enabled for a salon
 *
 * @param billingMode - salon.billingMode value
 * @returns true if Stripe billing is enabled
 */
export function isStripeBillingEnabled(billingMode: string | null | undefined): boolean {
  return billingMode === BILLING_MODE.STRIPE;
}

/**
 * Check if a subscription status indicates immediate bad standing
 *
 * @param status - Stripe subscription status
 * @returns true if status indicates past_due or unpaid
 */
export function isSubscriptionInBadStanding(status: string | null | undefined): boolean {
  if (!status) {
    return false;
  }
  return IMMEDIATE_BAD_STANDING_STATUSES.includes(status as (typeof IMMEDIATE_BAD_STANDING_STATUSES)[number]);
}

/**
 * Check if a canceled subscription has passed its paid period
 *
 * @param status - Stripe subscription status
 * @param currentPeriodEnd - Unix timestamp of period end
 * @returns true if canceled AND past the paid period
 */
export function isCanceledAndExpired(
  status: string | null | undefined,
  currentPeriodEnd: number | null | undefined,
): boolean {
  if (status !== 'canceled') {
    return false;
  }
  if (!currentPeriodEnd) {
    // No period end recorded - treat as expired to be safe
    return true;
  }
  const now = Math.floor(Date.now() / 1000); // Current time in Unix seconds
  return now > currentPeriodEnd;
}

/**
 * Check if billing enforcement should apply (past_due locks, etc.)
 *
 * Rules:
 * - Only enforce if billingMode === 'STRIPE'
 * - Lock immediately for past_due or unpaid
 * - For canceled: allow access until stripeCurrentPeriodEnd, then lock
 *
 * @returns true if billing enforcement should apply
 */
export function shouldEnforceBillingLock(salon: {
  billingMode?: string | null;
  stripeSubscriptionStatus?: string | null;
  stripeCurrentPeriodEnd?: number | null;
}): boolean {
  // If not using Stripe billing, never enforce billing locks
  if (!isStripeBillingEnabled(salon.billingMode)) {
    return false;
  }

  // Immediate lock for past_due or unpaid
  if (isSubscriptionInBadStanding(salon.stripeSubscriptionStatus)) {
    return true;
  }

  // For canceled: lock only after paid period ends
  if (isCanceledAndExpired(salon.stripeSubscriptionStatus, salon.stripeCurrentPeriodEnd)) {
    return true;
  }

  return false;
}

/**
 * Guard that returns 402 PAYMENT_REQUIRED if billing enforcement applies.
 *
 * Use in API routes to block actions when salon subscription is in bad standing.
 * ONLY applies when billingMode === 'STRIPE'.
 */
export function guardBillingOr402Sync(salon: {
  billingMode?: string | null;
  stripeSubscriptionStatus?: string | null;
  stripeCurrentPeriodEnd?: number | null;
}): Response | null {
  if (shouldEnforceBillingLock(salon)) {
    // Determine reason based on status
    const isCanceled = salon.stripeSubscriptionStatus === 'canceled';
    const reason = isCanceled ? 'SUBSCRIPTION_EXPIRED' : 'PAST_DUE';
    const message = isCanceled
      ? 'Your subscription has expired. Please renew to continue.'
      : 'Subscription payment is past due. Please update your billing information.';

    return Response.json(
      {
        error: {
          code: 'PAYMENT_REQUIRED',
          reason,
          message,
        },
      },
      { status: 402 },
    );
  }
  return null;
}

/**
 * Async guard that loads salon and checks billing status.
 *
 * Returns:
 * - 404 if salon not found
 * - 402 PAYMENT_REQUIRED if billing enforcement applies
 * - null if OK
 */
export async function guardBillingOr402(salonId: string): Promise<Response | null> {
  const [salon] = await db
    .select({
      billingMode: salonSchema.billingMode,
      stripeSubscriptionStatus: salonSchema.stripeSubscriptionStatus,
      stripeCurrentPeriodEnd: salonSchema.stripeCurrentPeriodEnd,
    })
    .from(salonSchema)
    .where(eq(salonSchema.id, salonId))
    .limit(1);

  if (!salon) {
    return Response.json(
      { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
      { status: 404 },
    );
  }

  return guardBillingOr402Sync(salon);
}
