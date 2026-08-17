/**
 * Salon Policy Types
 *
 * Single source of truth for visibility and settings policies.
 * Used by redaction utilities and policy helpers.
 *
 * THREE-LAYER MODEL:
 * 1. Entitlement (Super Admin) - salon.features.* - "Is this allowed to exist?"
 * 2. Enable (Admin) - salon.settings.modules.* - "Is it turned on?"
 * 3. Visibility (Admin) - salon.settings.visibility.staff.* - "Can staff see this field?"
 */

// =============================================================================
// ROLE TYPES
// =============================================================================

export type ViewerRole = 'super_admin' | 'admin' | 'staff';

// =============================================================================
// MODULE KEYS (Admin Enable Toggles)
// =============================================================================

/**
 * Module keys for admin enable/disable toggles.
 * These are FLAT keys that map to nested entitlement paths via MODULE_TO_ENTITLEMENT.
 */
export type ModuleKey =
  | 'smsReminders'
  | 'referrals'
  | 'rewards'
  | 'scheduleOverrides'
  | 'staffEarnings'
  | 'clientFlags'
  | 'clientBlocking'
  | 'analyticsDashboard'
  | 'utilization';

// =============================================================================
// SALON FEATURES (Entitlements - Super Admin Controlled)
// =============================================================================

/**
 * Feature entitlements controlled by Super Admin.
 * NESTED structure - groups related features together.
 *
 * TIER STRUCTURE:
 * - Core: Always ON (booking, staff basics, clients, social.photoUploads)
 * - Paid: OFF by default (marketing, money, analytics, controls)
 * - Visibility: ON by default (admin CAN hide fields)
 */
export type SalonFeatures = {
  // ==========================================================================
  // CORE - Always ON by default
  // ==========================================================================
  booking?: {
    onlineBooking?: boolean; // default: true
    staffDashboard?: boolean; // default: true
    // Subscription-tier override. Missing means "use the plan default".
    customization?: boolean;
    // Provenance/CAS pointer only. Entitlement resolution must never inspect it.
    customizationOverrideAuditId?: string;
  };
  staff?: {
    scheduleOverrides?: boolean; // default: true
    timeOff?: boolean; // default: true
  };
  clients?: {
    clientProfiles?: boolean; // default: true
    clientHistory?: boolean; // default: true
  };
  social?: {
    photoUploads?: boolean; // default: TRUE (core - Step 14/15 needs this)
  };

  // ==========================================================================
  // PAID ADD-ONS - OFF by default
  // ==========================================================================
  marketing?: {
    smsReminders?: boolean; // default: false
    referrals?: boolean; // default: false
    rewards?: boolean; // default: false
  };
  money?: {
    staffEarnings?: boolean; // default: false
    // Per-salon deposits entitlement. Written ONLY by the dedicated, audited
    // super-admin entitlement route; protected from stale whole-object saves.
    deposits?: boolean; // default: false
  };
  analytics?: {
    dashboard?: boolean; // default: false
    utilization?: boolean; // default: false
  };
  controls?: {
    clientBlocking?: boolean; // default: false
    clientFlags?: boolean; // default: false
  };

  // ==========================================================================
  // VISIBILITY ENTITLEMENTS - ON by default (admin CAN hide)
  // ==========================================================================
  visibility?: {
    allowHideClientPhone?: boolean; // default: true
    allowHideClientEmail?: boolean; // default: true
    allowHideAppointmentPrice?: boolean; // default: true
    allowHideClientHistory?: boolean; // default: true
    allowHideClientFullName?: boolean; // default: true
    allowHideClientNotes?: boolean; // default: true
  };

  // ==========================================================================
  // LEGACY FLAT KEYS (for backward compatibility during migration)
  // ==========================================================================
  onlineBooking?: boolean;
  staffDashboard?: boolean;
  photoUploads?: boolean;
  clientProfiles?: boolean;
  visibilityControls?: boolean;
  smsReminders?: boolean;
  rewards?: boolean;
  referrals?: boolean;
  scheduleOverrides?: boolean;
  clientFlags?: boolean;
  clientBlocking?: boolean;
  analyticsDashboard?: boolean;
  profilePage?: boolean;
  multiLocation?: boolean;
  advancedAnalytics?: boolean;
  revenueReports?: boolean;
  utilization?: boolean;
  techPerformance?: boolean;
  customBranding?: boolean;
  apiAccess?: boolean;
};

/**
 * Resolved features with all defaults applied.
 */
export type ResolvedSalonFeatures = {
  // Core
  booking: {
    onlineBooking: boolean;
    staffDashboard: boolean;
  };
  staff: {
    scheduleOverrides: boolean;
    timeOff: boolean;
  };
  clients: {
    clientProfiles: boolean;
    clientHistory: boolean;
  };
  social: {
    photoUploads: boolean;
  };
  // Paid
  marketing: {
    smsReminders: boolean;
    referrals: boolean;
    rewards: boolean;
  };
  money: {
    staffEarnings: boolean;
  };
  analytics: {
    dashboard: boolean;
    utilization: boolean;
  };
  controls: {
    clientBlocking: boolean;
    clientFlags: boolean;
  };
  // Visibility entitlements
  visibility: {
    allowHideClientPhone: boolean;
    allowHideClientEmail: boolean;
    allowHideAppointmentPrice: boolean;
    allowHideClientHistory: boolean;
    allowHideClientFullName: boolean;
    allowHideClientNotes: boolean;
  };
};

/**
 * Feature keys for type-safe feature checking.
 * Supports both nested paths and legacy flat keys.
 */
export type FeatureKey = keyof SalonFeatures;

// =============================================================================
// SUBSCRIPTION ENTITLEMENTS
// =============================================================================

/**
 * Stable internal plan keys used by feature entitlement code.
 *
 * Stored salon plan values are mapped to these keys by the authoritative
 * resolver. Customer-facing names, prices, and Stripe identifiers must not be
 * used as feature keys.
 */
export type InternalPlanKey = 'free' | 'tier_1' | 'tier_2' | 'enterprise';

/**
 * Stable feature keys used by the subscription entitlement resolver.
 */
export type SubscriptionFeatureKey = 'booking_experience_customization';

export type SubscriptionEntitlementSource = 'plan' | 'override';

export type SubscriptionEntitlementLockedReason = 'upgrade_required' | null;

export type ResolvedSubscriptionFeatureEntitlement = {
  featureKey: SubscriptionFeatureKey;
  entitled: boolean;
  source: SubscriptionEntitlementSource;
  planKey: InternalPlanKey;
  storedPlan: string | null;
  lockedReason: SubscriptionEntitlementLockedReason;
};

export type BookingExperienceEntitlementOverrideState =
  | 'default'
  | 'force_enabled'
  | 'force_disabled';

export type BookingExperienceEntitlementOverrideActor = {
  id: string;
  email: string | null;
};

export type BookingExperienceEntitlementOverrideProvenance = {
  auditId: string;
  overrideState: BookingExperienceEntitlementOverrideState;
  reason: string | null;
  actor: BookingExperienceEntitlementOverrideActor;
  updatedAt: string;
};

export type BookingExperienceEntitlementInspection =
  ResolvedSubscriptionFeatureEntitlement & {
    planDefault: boolean;
    overrideState: BookingExperienceEntitlementOverrideState;
    overrideAuditId: string | null;
    reason: string | null;
    actor: BookingExperienceEntitlementOverrideActor | null;
    updatedAt: string | null;
    provenanceRecorded: boolean;
  };

export type BookingExperienceEntitlementOverrideServerState = {
  features: SalonFeatures;
  bookingExperienceEntitlement: BookingExperienceEntitlementInspection;
};

// =============================================================================
// SALON SETTINGS (Admin Controls)
// =============================================================================

export type BookingPolicyAcknowledgment = {
  required: boolean;
  text: string | null;
};

export type BookingExperiencePolicy = {
  enabled: boolean;
  title: string | null;
  text: string | null;
  showOnServicePage: boolean;
  showBeforeConfirmation: boolean;
  showAfterConfirmation: boolean;
  showInConfirmationEmail: boolean;
  /**
   * Optional at the persisted/public compatibility boundary. Older browser
   * tabs omit it, dormant drafts are admin-only, and the defensive resolver
   * exposes it publicly only for a fully valid required acknowledgment.
   */
  acknowledgment?: BookingPolicyAcknowledgment;
  /**
   * Server-resolved content fingerprint. It is never accepted as persisted
   * salon configuration or as authoritative browser input.
   */
  readonly version?: string | null;
};

export type BookingExperience = {
  primaryColor: string | null;
  bookingMessage: string | null;
  policy: BookingExperiencePolicy;
  quickFacts: {
    appointmentOnly: {
      enabled: boolean;
      label: string | null;
    };
    depositNotice: {
      enabled: boolean;
      label: string | null;
    };
    cancellationNotice: {
      enabled: boolean;
      label: string | null;
    };
  };
  socialLinks: {
    instagram: string | null;
    facebook: string | null;
    tiktok: string | null;
  };
  confirmationMessage: string | null;
};

export type ResolvedBookingExperience = Omit<
  BookingExperience,
  'policy'
> & {
  policy: Omit<BookingExperiencePolicy, 'acknowledgment' | 'version'> & {
    acknowledgment: BookingPolicyAcknowledgment;
    readonly version: string | null;
  };
};

/**
 * Persisted Booking Experience JSON can predate the current canonical shape
 * or contain independently missing fields. It must always pass through
 * `resolveBookingExperience` before being exposed to application UI.
 */
export type StoredBookingExperience = {
  primaryColor?: string | null;
  bookingMessage?: string | null;
  policy?: {
    enabled?: boolean;
    title?: string | null;
    text?: string | null;
    showOnServicePage?: boolean;
    showBeforeConfirmation?: boolean;
    showAfterConfirmation?: boolean;
    showInConfirmationEmail?: boolean;
    acknowledgment?: {
      required?: boolean;
      text?: string | null;
    };
  };
  quickFacts?: {
    appointmentOnly?: {
      enabled?: boolean;
      label?: string | null;
    };
    depositNotice?: {
      enabled?: boolean;
      label?: string | null;
    };
    cancellationNotice?: {
      enabled?: boolean;
      label?: string | null;
    };
  };
  socialLinks?: {
    instagram?: string | null;
    facebook?: string | null;
    tiktok?: string | null;
  };
  confirmationMessage?: string | null;
  appointmentOnly?: boolean;
};

/**
 * Admin-controlled operational settings.
 * Includes module enable/disable toggles and visibility policy.
 */
export type SalonSettings = {
  // Booking behavior
  allowSameDayBooking?: boolean; // default: true
  requireDepositForNew?: boolean; // default: false

  // Public Google review link used by the post-appointment review follow-up.
  // When empty, the "Send Google review link" option is disabled in the UI.
  googleReviewUrl?: string | null;
  booking?: {
    bufferMinutes?: number;
    slotIntervalMinutes?: number;
    currency?: string;
    timezone?: string;
    introPriceDefaultLabel?: string | null;
    firstVisitDiscountEnabled?: boolean;
    clientChangeCutoffHours?: number;
    /**
     * Hard enforcement of service_add_on rows with selectionMode 'required'
     * (PR 1 stage e). Default FALSE, for every salon, including salons whose
     * settings predate this field.
     *
     * When false (the default) validatePublicBookingSelection only observes an
     * unsatisfied required rule and reports it as observedRequiredAddOnGaps.
     * When true it throws BookingSelectionError('missing_required_add_on') and
     * the booking is refused.
     *
     * Turning this on for a salon is a per-salon decision that must be based on
     * that salon's observation data (audit action required_add_on_rule_omitted
     * plus `npm run db:report:required-addon-rules`). A required rule that
     * points at a deactivated add-on makes the service unbookable online while
     * this is true — see src/libs/bookingQuote.ts.
     */
    enforceRequiredAddOns?: boolean;
  };

  // Controlled public booking-page and confirmation-message customization.
  // The canonical defaults, validation, and safe legacy-data resolver live in
  // src/libs/bookingExperience.ts.
  bookingExperience?: StoredBookingExperience;

  // Checkout payments & taxes (0058). Tax defaults OFF for every salon and is
  // never inferred from the address; completed appointments snapshot the
  // resolved config, so edits here never recalculate history. Canonical zod
  // shapes live in src/libs/taxConfig.ts.
  payments?: {
    tax?: {
      enabled?: boolean;
      name?: string;
      rateBps?: number; // 13% = 1300
      pricesIncludeTax?: boolean;
      taxServicesByDefault?: boolean;
      taxAddOnsByDefault?: boolean;
      taxCustomByDefault?: boolean;
      forfeitureTaxEstimationEnabled?: boolean;
      jurisdiction?: string;
      country?: string;
      region?: string;
      scheduledChange?: {
        rateBps: number;
        name?: string;
        effectiveFrom: string; // ISO date
        /** Derived by the settings API from the salon-local date and zone. */
        effectiveDate?: string; // YYYY-MM-DD
        effectiveTimeZone?: string; // IANA timezone
      } | null;
    };
    etransfer?: {
      enabled?: boolean;
      recipient?: string; // email or mobile — never banking credentials
      recipientName?: string;
      autodepositEnabled?: boolean; // informational only
      instructions?: string;
      requireReference?: boolean;
      qrPageEnabled?: boolean;
    };
    // Salon-wide fixed-amount deposit policy. Canonical zod shapes, bounds and
    // the read-time gate live in src/libs/depositPolicy.ts. Stored `enabled`
    // is inert unless every conjunct of that gate holds.
    deposit?: {
      enabled?: boolean;
      amountCents?: number; // integer cents
    };
  };

  // Smart Fit discount (P7.1). OFF by default; never inferred. Canonical zod
  // shape + clamps live in src/libs/smartFitConfig.ts. Approved settings only —
  // no adjacency-side toggles, no stacking, no suggestion-distance setting.
  smartFit?: {
    enabled?: boolean;
    discountType?: 'percent' | 'fixed'; // percent value 0-100 | fixed cents
    value?: number;
    maxRemainingGapMinutes?: number; // default 10
    minImprovementMinutes?: number; // default 20
    eligibleServiceIds?: string[]; // empty = all
    eligibleTechnicianIds?: string[]; // empty = all
  };

  // Booking-page merchandising (featured services, owner promos).
  merchandising?: {
    featureLusterManicure?: boolean; // default: true
    showServiceImages?: boolean; // default: true
    lusterPromoDismissed?: boolean; // default: false
    serviceLibraryIntroDismissed?: boolean; // default: false
  };

  // Transactional client communications (Gate C1): channel masters, kill
  // switch, quiet hours, per-event toggles and reminder rules. Canonical
  // defaults, Zod schemas and the pure resolver live in
  // src/libs/communicationSettings.ts — this type deliberately stays loose
  // (unknown) at the leaf level because the resolver revalidates everything
  // and malformed stored data must fall back to defaults, never throw.
  communications?: {
    sms?: { enabled?: boolean };
    email?: { enabled?: boolean };
    killSwitch?: boolean;
    quietHours?: { enabled?: boolean; start?: string; end?: string };
    events?: Record<string, { enabled?: boolean; channels?: 'sms' | 'email' | 'both' }>;
    reminders?: {
      rules?: Array<{
        id?: string;
        offsetMinutes?: number;
        channels?: 'sms' | 'email' | 'both';
        enabled?: boolean;
      }>;
    };
    staffOverrides?: Record<string, { notificationsEnabled?: boolean; channels?: 'sms' | 'email' | 'both' }>;
  };

  notifications?: {
    newBooking?: {
      technicianEnabled?: boolean;
      ownerEnabled?: boolean;
      technicianChannel?: 'sms' | 'email' | 'both';
      ownerChannel?: 'sms' | 'email' | 'both';
    };
    appointmentCancelled?: {
      technicianEnabled?: boolean;
      ownerEnabled?: boolean;
      technicianChannel?: 'sms' | 'email' | 'both';
      ownerChannel?: 'sms' | 'email' | 'both';
    };
    // Salon-facing appointment emails plus D6's two deposit money alerts.
    // Separate from the client-facing confirmation and reminder settings.
    // Canonical zod shape lives in salonNotificationEmailSettings.ts; only the
    // booking alerts and recipient are owner-editable in v1.
    salonEmail?: {
      newBooking?: boolean;
      rescheduled?: boolean;
      cancelled?: boolean;
      // Money alerts default on and are intentionally absent from the owner
      // update schema in salonNotificationEmailSettings.ts.
      refundFailed?: boolean;
      refundAccountDisconnected?: boolean;
      // null/absent = fall back to the owner email, then the account email.
      recipientEmail?: string | null;
    };
  };

  // ==========================================================================
  // MODULE ENABLE/DISABLE TOGGLES
  // ==========================================================================
  // Admin can turn modules on/off (only effective if entitled)
  modules?: {
    smsReminders?: boolean;
    referrals?: boolean;
    rewards?: boolean;
    scheduleOverrides?: boolean;
    staffEarnings?: boolean;
    clientFlags?: boolean;
    clientBlocking?: boolean;
    analyticsDashboard?: boolean;
    utilization?: boolean;
  };

  // ==========================================================================
  // VISIBILITY POLICY (Staff Field Visibility)
  // ==========================================================================
  // ONLY place for staff visibility settings
  visibility?: {
    staff?: {
      clientPhone?: boolean; // default: true
      clientEmail?: boolean; // default: false
      appointmentPrice?: boolean; // default: true
      clientHistory?: boolean; // default: false
      clientFullName?: boolean; // default: true
      clientNotes?: boolean; // default: true
      otherTechAppointments?: boolean; // default: false
    };
  };
};

/**
 * Resolved modules with defaults applied.
 * Used by UI to show toggle states.
 */
export type ResolvedModules = {
  smsReminders: boolean;
  referrals: boolean;
  rewards: boolean;
  scheduleOverrides: boolean;
  staffEarnings: boolean;
  clientFlags: boolean;
  clientBlocking: boolean;
  analyticsDashboard: boolean;
  utilization: boolean;
};

// =============================================================================
// VISIBILITY POLICY (Legacy - for backward compat)
// =============================================================================

/**
 * Salon-controlled visibility policy for staff.
 * All fields are optional - missing means "use default".
 *
 * @deprecated Use SalonSettings.visibility.staff instead
 */
export type SalonVisibilityPolicy = {
  staff?: {
    showClientPhone?: boolean; // default: true
    showClientEmail?: boolean; // default: false
    showClientFullName?: boolean; // default: true
    showAppointmentPrice?: boolean; // default: true
    showClientHistory?: boolean; // default: false
    showClientNotes?: boolean; // default: true
    showOtherTechAppointments?: boolean; // default: false
  };
};

/**
 * Resolved visibility policy with all defaults applied.
 * Used by redaction functions - no optional fields.
 */
export type ResolvedStaffVisibility = {
  showClientPhone: boolean;
  showClientEmail: boolean;
  showClientFullName: boolean;
  showAppointmentPrice: boolean;
  showClientHistory: boolean;
  showClientNotes: boolean;
  showOtherTechAppointments: boolean;
};
