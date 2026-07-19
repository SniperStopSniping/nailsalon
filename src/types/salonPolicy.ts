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
// SALON SETTINGS (Admin Controls)
// =============================================================================

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
  };
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
      scheduledChange?: {
        rateBps: number;
        name?: string;
        effectiveFrom: string; // ISO date
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
    lusterPromoDismissed?: boolean; // default: false
    serviceLibraryIntroDismissed?: boolean; // default: false
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
