/**
 * Admin Dashboard Types
 *
 * Centralized type definitions for admin APIs and components.
 * Keeps UI and API response shapes in sync.
 */

import type { CatalogViolation } from '@/libs/catalogDomain';
// Type-only: erased at compile time, so this does NOT create a production
// import edge into the catalog module set (`architecturalInvariants.test.ts`
// invariant 5) — only a runtime `import` of a VALUE would.
import type { CatalogRuleType } from '@/libs/catalogRuleContract';
import type { ReportingProvenance } from '@/libs/financialReporting';
import type { AppointmentStatus } from '@/models/Schema';

// Re-export so UI can import from here
export type { AppointmentStatus };

export type FinancialPeriodSummary = {
  completedAppointmentRevenueCents: number;
  cashCollectedCents: number;
  appointmentPaymentsCollectedCents?: number;
  depositCollectedCents?: number;
  depositRefundedCents?: number;
  depositForfeitedCents?: number;
  depositForfeitureEstimatedTaxCents?: number;
  depositForfeitureEstimatedNetCents?: number;
  depositForfeitureRefundReversalCents?: number;
  depositForfeitureTaxReversalCents?: number;
  depositForfeitureNetReversalCents?: number;
  forfeitureTaxIdentityBuckets?: Array<{
    schemaVersion: number;
    classification: string;
    label: string | null;
    rateBps: number;
    mode: 'included' | 'added';
    configurationEffectiveFrom: string | null;
    configurationSource: 'default' | 'base' | 'scheduled_change';
    taxEstimateApplied: boolean;
    forfeitureCount: number;
    grossForfeitedCents: number;
    estimatedTaxIncludedCents: number;
    estimatedNetCents: number;
    refundReversalCount: number;
    refundReversalCents: number;
    estimatedTaxReversalCents: number;
    estimatedNetReversalCents: number;
  }>;
  depositAppliedCents?: number;
  remainingBalancePaymentsCollectedCents?: number;
  unattributedPaymentEventCount?: number;
  unresolvedDepositApplicationCount?: number;
  unattributedDepositEventCount?: number;
  unresolvedDepositEventCount?: number;
  unknownCurrencyAppointmentCount?: number;
  excludedForeignCurrencyAppointmentCount?: number;
  unknownCurrencyPaymentEventCount?: number;
  excludedForeignCurrencyPaymentEventCount?: number;
  unknownCurrencyDepositEventCount?: number;
  excludedForeignCurrencyDepositEventCount?: number;
  discountsCents: number;
  taxCents: number;
  taxableSubtotalCents?: number;
  unresolvedActualTaxIdentityCount?: number;
  actualTaxIdentityBuckets?: Array<{
    schemaVersion: number;
    classification: string;
    label: string | null;
    rateBps: number;
    mode: 'included' | 'added';
    configurationEffectiveFrom: string | null;
    configurationSource: 'default' | 'base' | 'scheduled_change';
    taxApplied: boolean;
    taxExempt: boolean;
    appointmentCount: number;
    serviceSubtotalCents: number;
    taxableSubtotalCents: number;
    taxCents: number;
  }>;
  tipsCents: number;
  completedAppointmentCount: number;
  provenance: ReportingProvenance;
  dateRange: {
    start: string;
    end: string;
    timezone: string;
    isToDate: boolean;
  };
};

export type FinancialBalanceSummary = {
  completedOutstandingCents: number;
  upcomingBalanceCents: number;
  completed: ReportingProvenance;
  upcomingAppointmentCount: number;
  unresolvedUpcomingAppointmentCount: number;
  unknownCurrencyAppointmentCount?: number;
  excludedForeignCurrencyAppointmentCount?: number;
  asOf: string;
};

/**
 * Response shape for GET /api/admin/analytics
 */
export type AnalyticsResponse = {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  revenue: {
    total: number; // cents — final (net-of-tax) revenue; comp appointments count 0
    tips: number; // cents — total tips for completed appointments in the period
    taxCollected: number; // cents — tax collected in the period, reported separately from revenue
    discounts?: number; // cents — completed appointment discounts, reported separately
    provenance?: ReportingProvenance;
    trend: number; // percentage change from previous period
    /** False when the prior period is zero, so no percentage is meaningful. */
    trendAvailable?: boolean;
    completed: number; // count of completed appointments
    series: number[]; // revenue in cents bucketed evenly across the period
  };
  appointments: {
    total: number;
    completed: number;
    noShows: number;
    upcoming: number;
  };
  staff: Array<{
    id: string;
    name: string;
    role: string;
    avatarUrl: string | null;
    revenue: number; // cents
    appointmentCount: number;
    utilization: number; // 0-100 percentage
    color: string; // hex color for charts
  }>;
  services: Array<{
    label: string;
    percent: number; // 0-100
    color: string; // hex color
    count: number;
  }>;
  dateRange: {
    start: string; // ISO date string
    end: string; // ISO date string
  };
  /** Additive canonical reporting metadata; optional for cached/legacy clients. */
  currency?: string;
  timeZone?: string;
  financials?: {
    currency: string;
    timeZone: string;
    asOf: string;
    selectedPeriod: FinancialPeriodSummary;
    previousPeriod: FinancialPeriodSummary;
    currentPeriods: {
      today: FinancialPeriodSummary;
      weekToDate: FinancialPeriodSummary;
      monthToDate: FinancialPeriodSummary;
    };
    balances: FinancialBalanceSummary;
    depositDue: {
      supported: false;
      amountCents: null;
      reason: string;
    };
  };
};

/**
 * Response shape for GET /api/salon/services (admin usage)
 */
export type ServiceResponse = {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  descriptionItems?: string[] | null;
  price: number; // cents
  priceDisplayText?: string | null;
  durationMinutes: number;
  preparationBufferMinutes?: number;
  cleanupBufferMinutes?: number;
  category?: string | null;
  bookingCategory?: string | null;
  templateKey?: string | null;
  imageUrl?: string | null;
  sortOrder?: number | null;
  featuredOrder?: number | null;
  isActive: boolean | null;
  isIntroPrice?: boolean | null;
  introPriceLabel?: string | null;
  introPriceExpiresAt?: string | null;
  /** Enabled links to ACTIVE technicians; 0 ⇒ hidden from public booking. */
  assignedTechnicianCount?: number;

  // ---- Luster L1 catalog foundation (dark; migration 0072) ----------------
  // Raw stored values, never re-derived here. NULL on every legacy service —
  // see `src/libs/confirmationMode.ts` for how a NULL `confirmationMode` is
  // resolved to an EFFECTIVE mode elsewhere; this response carries the
  // stored column as-is so an owner editor can tell "never set" apart from
  // an explicit past choice.
  /** Parent service id for a variant CHILD; null for a legacy service or a parent. */
  parentServiceId?: string | null;
  /** Distinguishes a child from its siblings ("Short", "XL"); null unless this row is a child. */
  variantLabel?: string | null;
  /** The axis a PARENT's children vary along; null on a child or a legacy service. */
  variantKind?: string | null;
  selectionMode?: 'direct' | 'guided' | null;
  /**
   * `'consultation'` is representable here because the database CHECK
   * (migration 0072) allows it and a row could already carry it — but no
   * write path in this PR can ever STORE it: `PATCH /api/salon/services/[id]`
   * rejects `'consultation'` as not-yet-available (deferred to L7).
   */
  confirmationMode?: 'instant' | 'request_approval' | 'consultation' | null;
};

export type AddOnResponse = {
  id: string;
  name: string;
  slug: string;
  descriptionItems?: string[] | null;
  priceCents: number;
  priceDisplayText?: string | null;
  durationMinutes: number;
  category: string;
  pricingType: 'fixed' | 'per_unit';
  unitLabel?: string | null;
  maxQuantity?: number | null;
  displayOrder?: number | null;
  isActive: boolean | null;
  /** Catalog template this add-on came from; null for owner-created ones. */
  templateKey?: string | null;
  /**
   * Base services this add-on is offered under (service_add_on rows). Owners
   * edit this directly; clients only ever see an add-on after picking one of
   * these services.
   */
  compatibleServiceIds?: string[];
  // ---- Luster L1 catalog rules foundation (dark; migration 0073) ---------
  /** `add_on_group` this add-on belongs to; null is a perfectly valid, legacy-compatible ungrouped add-on. */
  groupId?: string | null;
};

export type ServiceAddOnRuleResponse = {
  id: string;
  serviceId: string;
  addOnId: string;
  selectionMode: 'optional' | 'required' | 'conditional';
  defaultQuantity?: number | null;
  maxQuantityOverride?: number | null;
  displayOrder?: number | null;
};

// =============================================================================
// Luster L1 PR6 — owner/admin catalog configuration surface
//
// Every type below is an AUTHENTICATED owner payload, not a public DTO — it
// may carry internal ids (group id, capability id, rule id) that CRUD needs,
// which the public catalog projection (`catalogDomain.ts`'s
// `PublicCatalog*` types) never does. See `catalogPublicDtoBoundary.test.ts`
// for the boundary these types must never be confused with.
// =============================================================================

/** Response shape for the add-on group CRUD API (`/api/salon/add-on-groups`). */
export type AddOnGroupResponse = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  minSelections: number;
  maxSelections: number | null;
  sortOrder: number;
  isActive: boolean;
  templateKey: string | null;
  /** Add-on ids currently pointing `group_id` at this group. */
  memberAddOnIds: string[];
};

/** Response shape for the capability CRUD API (`/api/salon/capabilities`). */
export type CapabilityResponse = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

/** Response shape for one `technician_capability` assignment row. */
export type TechnicianCapabilityResponse = {
  id: string;
  technicianId: string;
  capabilityId: string;
};

/**
 * Owner-facing projection of a `catalog_rule` row. Unlike the public
 * projection (`PublicCatalogRuleProjection`), this MAY carry the internal
 * id, priority, note and raw params — an owner editing their own rules is
 * exactly who those fields exist for. Never returned from any unauthenticated
 * or public route.
 */
export type CatalogRuleResponse = {
  id: string;
  ruleType: CatalogRuleType;
  /** Mirrors `catalog_rule.service_id`: null means the rule is in force salon-wide. */
  serviceScopeId: string | null;
  subjectServiceId: string | null;
  subjectAddOnId: string | null;
  objectAddOnId: string | null;
  capabilityId: string | null;
  params: Record<string, unknown>;
  priority: number;
  isActive: boolean;
  note: string | null;
};

/**
 * Response shape for `POST /api/salon/catalog-preview` — the resolved
 * outcome of ONE selection, produced by the SAME resolver booking uses
 * (`resolvePublicCatalogSnapshot` / `resolveCatalogSelectionForSalon` in
 * `catalogResolver.server.ts`). There is no alternate price/duration math
 * here; a corrupt catalog surfaces as `ok: false`, never a guess.
 */
export type CatalogPreviewResponse =
  | {
    ok: true;
    basePriceCents: number;
    baseDurationMinutes: number;
    subtotalCents: number;
    totalDurationMinutes: number;
    addOns: Array<{
      addOnId: string;
      quantity: number;
      unitPriceCents: number;
      lineTotalCents: number;
      unitDurationMinutes: number;
      lineDurationMinutes: number;
      autoAdded: boolean;
    }>;
    violations: CatalogViolation[];
    blocksContinue: boolean;
  }
  | {
    ok: false;
    /** Catalog data is structurally corrupt — never guessed at, always reported as-is. */
    code: string;
  };

/**
 * Response shape for GET /api/admin/clients
 */
export type SalonClientResponse = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  preferredTechnicianId: string | null;
  preferredTechnicianName: string | null;
  notes: string | null;
  lastVisitAt: string | null; // ISO date
  totalVisits: number;
  totalSpent: number; // cents
  noShowCount: number;
  loyaltyPoints: number;
  createdAt: string; // ISO date
};
