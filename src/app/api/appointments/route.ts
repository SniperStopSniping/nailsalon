import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  BOOKING_LOCK_MS,
  BOOKING_POLL_WINDOW_MS,
  DEL_IF_OWNER_LUA,
  EXTEND_IF_OWNER_LUA,
  getBookingIdempotencyKey,
  getBookingLockKey,
  TTL,
} from '@/core/redis/keys';
import { isRedisAvailable, redis } from '@/core/redis/redisClient';
import {
  getActiveAppointmentsForCanonicalClientWithHandle,
  getActiveAppointmentsForContact,
} from '@/libs/activeAppointments';
import { requireAdmin, requireAdminSalon } from '@/libs/adminAuth';
import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { logAuditEvent } from '@/libs/auditLog';
import type { BookingCommitEffectsContext } from '@/libs/bookingCommitEffects';
import {
  formatLocationAddress,
  mintAppointmentManageCapability,
  runBookingCommitSideEffects,
} from '@/libs/bookingCommitEffects';
import {
  getBookingConfigForSalon,
  getClientChangePolicy,
  resolveBookingConfigFromSettings,
  resolveIntroPriceLabel,
} from '@/libs/bookingConfig';
import {
  BLOCKING_APPOINTMENT_STATUSES,
  isSlotConstraintViolation,
  lockTechnicianAndAssertSlotFree,
  SlotConflictError,
} from '@/libs/bookingConflictGuard';
import {
  type BookingSubjectMode,
  classifyDuplicateBooking,
  resolveBookingSubject,
} from '@/libs/bookingIdentity';
import {
  canTechnicianTakeAppointment,
  getTorontoDateString,
  loadBookingPolicy,
  type LoadedBookingPolicy,
  resolveTechnicianCapabilityMode,
} from '@/libs/bookingPolicy';
import {
  BOOKING_POLICY_ACKNOWLEDGMENT_REQUIRED_MESSAGE,
  BOOKING_POLICY_ACKNOWLEDGMENT_SOURCE,
  BOOKING_POLICY_ATTEMPT_REUSED_MESSAGE,
  BOOKING_POLICY_CHANGED_MESSAGE,
  BOOKING_POLICY_CHECK_RETRY_MESSAGE,
  buildPublicBookingPolicyAcknowledgmentSnapshot,
  hashCanonicalBookingRequest,
  hashSensitiveBookingValue,
  type RequiredBookingPolicy,
  resolveRequiredBookingPolicy,
} from '@/libs/bookingPolicyAcknowledgment';
import {
  BookingSelectionError,
  getPublicBookingSelectionMessage,
  getPublicTechnicianCompatibility,
  validatePublicBookingSelection,
} from '@/libs/bookingQuote';
import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import { requireClientApiSession } from '@/libs/clientApiGuards';
import {
  type CanonicalSalonClientIdentity,
  ClientLifecycleStabilizationError,
  type LifecycleSqlHandle,
  lockOperationalSalonClientContactWithHandle,
  lockSalonClientIdentityKeysWithHandle,
  type OperationalSalonClientContact,
  resolveCanonicalSalonClientIdentity,
  resolveCanonicalSalonClientIdentityWithHandle,
  resolveOperationalSalonClientContact,
  withClientLifecycleTransactionRetry,
} from '@/libs/clientLifecycleStabilization';
import { db } from '@/libs/DB';
import {
  buildDepositCheckoutIdempotencyKey,
  createDepositCheckoutSession,
  DEPOSIT_HOLD_WINDOW_MINUTES,
  type DepositCheckoutRow,
  depositHoldExpiresAtEpochSeconds,
  isCancellableCreateFailure,
} from '@/libs/depositCheckout';
import {
  buildDepositDisclosureFingerprint,
  DEPOSIT_CURRENCY,
  DEPOSIT_ISO_CURRENCY,
  type DepositAccountSnapshot,
  type DepositPolicyInactiveReason,
  MIN_DEPOSIT_CENTS,
  parseDepositDisclosureFingerprint,
  resolveDepositChargeForTotal,
  resolveDepositPolicy,
} from '@/libs/depositPolicy';
import { EXPECTED_LIVEMODE, getDepositPolicyForSalon } from '@/libs/depositPolicy.server';
import { cancelHoldAfterDefiniteCheckoutFailure } from '@/libs/deposits/holdWriters';
import { getEffectiveStaffVisibility } from '@/libs/featureGating';
import {
  FIRST_VISIT_DISCOUNT_TYPE,
  resolveAutomaticBookingDiscount,
} from '@/libs/firstVisitDiscount';
import {
  getGoogleCalendarBusyWindows,
  GoogleCalendarAvailabilityError,
  type GoogleCalendarBusyWindow,
  hasGoogleCalendarConflict,
  isBusyWindowConflict,
} from '@/libs/googleCalendar';
import { recordGoogleEventReviewDecision } from '@/libs/googleEventReview';
import {
  acquireGoogleCalendarEventPairMutationBarrierInTx,
  enqueueGoogleCalendarAppointmentMutation,
  enqueueGoogleCalendarDeleteInTx,
} from '@/libs/integrationOutbox';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import {
  checkPublicBookingRateLimit,
  getPublicBookingClientIp,
} from '@/libs/publicBookingRateLimit.server';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import {
  getAppointmentById,
  getClientByPhone,
  getLocationById,
  getPrimaryLocation,
  getSalonBySlug,
  getServicesByIds,
  getTechnicianById,
  getTechniciansBySalonId,
  normalizePhone,
} from '@/libs/queries';
import { redactAppointmentForStaff } from '@/libs/redact';
import {
  calculateRetentionDiscount,
  type CampaignValidationFailureCode,
  hashRetentionCampaignToken,
  validateRetentionCampaign,
} from '@/libs/retentionCampaigns';
import { isUnsettledForReschedule } from '@/libs/salonPurge';
import { guardFeatureEntitlement, guardSalonApiRoute } from '@/libs/salonStatus';
import {
  applySmartFitOverlay,
  evaluateSmartFitSlot,
  SMART_FIT_DISCOUNT_LABEL,
  SMART_FIT_DISCOUNT_TYPE,
  type SmartFitEvaluation,
} from '@/libs/smartFit';
import {
  buildSmartFitClientKeys,
  buildSmartFitDayContext,
  smartFitServiceScopeAllows,
} from '@/libs/smartFitBooking';
import { resolveSmartFitConfig } from '@/libs/smartFitConfig';
import {
  hasCommittedSmartFitDiscount,
  type ReschedulePricingInputs,
  resolveSmartFitRescheduleDiscount,
} from '@/libs/smartFitReschedulePolicy';
import {
  sendCancellationNotificationToTech,
  sendRescheduleConfirmation,
} from '@/libs/SMS';
import { requireStaffSession } from '@/libs/staffAuth';
import {
  type ReadinessDecision,
  refreshAccountReadiness,
} from '@/libs/stripeConnect/readiness';
import {
  buildBookingTaxSnapshot,
  resolveTaxConfig,
} from '@/libs/taxConfig';
import { getDateKeyInTimeZone, getZonedDayBounds, zonedTimeToUtc } from '@/libs/timeZone';
import {
  type Appointment,
  APPOINTMENT_STATUSES,
  appointmentAccessTokenSchema,
  appointmentAddOnSchema,
  appointmentAuditLogSchema,
  appointmentBookingPolicyAcknowledgmentSchema,
  appointmentDepositSchema,
  appointmentPhotoSchema,
  appointmentSchema,
  type AppointmentService,
  appointmentServicesSchema,
  clientCommunicationSchema,
  communicationConsentSchema,
  googleCalendarEventSchema,
  retentionCampaignRedemptionSchema,
  retentionCampaignSchema,
  rewardSchema,
  salonClientSchema,
  salonSchema,
  type Service,
  serviceSchema,
  type WeeklySchedule,
} from '@/models/Schema';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// CONSTANTS
// =============================================================================

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Parse and validate status filter parameter.
 * Returns null if no param provided, empty array if all values invalid.
 * Invalid values are filtered out, not silently accepted.
 */
function parseStatusParam(statusParam: string | null): string[] | null {
  if (!statusParam) {
    return null;
  }

  const allowed = new Set<string>(APPOINTMENT_STATUSES);
  const statuses = statusParam
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => allowed.has(s));

  return statuses;
}

function resolveAppointmentDateRange(args: {
  dateParam: string | null;
  startDateParam: string | null;
  endDateParam: string | null;
  timeZone?: string | null;
}): { startOfDay: Date; endOfDay: Date } {
  const { dateParam, startDateParam, endDateParam, timeZone } = args;

  if (startDateParam && endDateParam) {
    return {
      startOfDay: new Date(startDateParam),
      endOfDay: new Date(endDateParam),
    };
  }

  const dateKey = dateParam === 'today' || !dateParam
    ? getDateKeyInTimeZone(new Date(), timeZone)
    : dateParam;

  return getZonedDayBounds(dateKey, timeZone);
}

// =============================================================================
// HELPERS
// =============================================================================

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const bookingPolicyAcknowledgmentRequestSchema = z.object({
  // Kept boolean here so an explicit false can receive the same authoritative
  // typed response as an omitted acknowledgment when the current policy
  // requires acceptance.
  accepted: z.boolean(),
  version: z.string().regex(/^policy-v1:[a-f0-9]{64}$/u),
  attemptId: z.string().uuid(),
}).strict();

const createAppointmentSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  serviceIds: z.array(z.string()).min(1, 'At least one service is required').optional(),
  baseServiceId: z.string().min(1, 'Base service is required').optional(),
  selectedAddOns: z.array(z.object({
    addOnId: z.string().min(1),
    quantity: z.number().int().min(1).max(20).optional(),
  })).optional().default([]),
  technicianId: z.string().nullable(), // null = "any artist"
  clientPhone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits').optional(),
  clientName: z.string().trim().max(100).optional(),
  clientEmail: z.string().email().optional(),
  smsConsent: z.object({
    granted: z.boolean(),
    wordingVersion: z.string().min(1).max(50),
  }).optional(),
  startTime: z.string().datetime({ message: 'Invalid datetime format. Use ISO 8601.' }),
  appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'appointmentDate must be YYYY-MM-DD').optional(),
  appointmentTime: z.string().regex(/^\d{1,2}:\d{2}$/, 'appointmentTime must be HH:mm').optional(),
  // Optional: Location for multi-location salons
  locationId: z.string().optional(),
  // Optional: If provided, this is a reschedule - bypass duplicate check and cancel the original
  originalAppointmentId: z.string().optional(),
  manageToken: z.string().min(20).optional(),
  /**
   * Who this booking is for. Server-validated; never a customer id from the
   * client. Absent on older clients, which resolveBookingSubject handles by
   * refusing to guess rather than silently booking as the account holder.
   */
  bookingSubject: z.enum(['self', 'guest']).optional(),
  googleEventReviewId: z.string().min(1).optional(),
  priceCentsOverride: z.number().int().min(0).max(1_000_000).optional(),
  durationMinutesOverride: z.number().int().min(1).max(1440).optional(),
  notes: z.string().trim().max(2000).optional(),
  campaignToken: z.string().trim().min(32).max(200).regex(/^[\w-]+$/).optional(),
  // Optional client expectations from a previously displayed offer (Smart
  // Fit). When present, the in-transaction recompute must match them exactly
  // or the booking is rejected with 409 SMART_FIT_CHANGED — a displayed price
  // is never silently changed. Absent fields keep legacy behavior.
  expectedDiscountType: z.string().trim().max(50).nullable().optional(),
  expectedTotalCents: z.number().int().min(0).max(50_000_000).optional(),
  expectedBookingFinancialQuote: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/u),
    totalDueCents: z.number().int().min(0).max(50_000_000),
    taxConfigurationIdentity: z.string().min(16).max(2000),
  }).strict().optional(),
  // The deposit amount the confirm page DISPLAYED, as an opaque token
  // ('deposit-v1:cad:<cents>', or 'deposit-v1:none' when nothing was shown).
  // The .max(64) cap is load-bearing: it is why the parser is never handed an
  // unbounded token. Always read via `data.expectedDepositFingerprint` — the
  // zod-validated object — and never off the raw JSON body.
  expectedDepositFingerprint: z.string().max(64).optional(),
  bookingPolicyAcknowledgment:
    bookingPolicyAcknowledgmentRequestSchema.optional(),
});

type CreateAppointmentRequest = z.infer<typeof createAppointmentSchema>;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type AppointmentResponse = {
  appointmentId: string;
  manageUrl: string;
  appointment: Appointment;
  services: Array<{
    service: Service;
    priceAtBooking: number;
    durationAtBooking: number;
  }>;
  addOns?: Array<{
    id: string | null;
    name: string;
    quantity: number;
    lineTotalCents: number;
    lineDurationMinutes: number;
  }>;
  technician: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  salon: {
    id: string;
    name: string;
    slug: string;
  };
};

/**
 * The 201's deposit object.
 *
 * `currency` is LOWERCASE 'cad' — the same literal the DB row and the Stripe
 * call use. Do not write a comparison against 'CAD' anywhere.
 *
 * Present with `required: true` when a hold was created; present with
 * `required: false` when the salon's policy resolved ACTIVE but this particular
 * request was outside the charge predicate (an owner or staff member booking
 * from the public confirm page: they were shown the deposit statement and will
 * never be charged, and this clause is the only correction that screen gets).
 * ABSENT entirely when the policy is not active.
 */
type DepositResponseObject
  = | { required: false }
  | {
    required: true;
    checkoutUrl: string;
    amountCents: number;
    currency: typeof DEPOSIT_CURRENCY;
    fingerprint: string;
    holdExpiresAt: string;
  };

type SuccessResponse = {
  data: AppointmentResponse & { deposit?: DepositResponseObject };
  meta: {
    timestamp: string;
  };
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    retryAfterSeconds?: number;
  };
};

/** Approved user-facing copy for a stale Smart Fit expectation (P7.2). */
const SMART_FIT_STALE_MESSAGE = 'This discounted time is no longer available. Please choose from the latest times.';

type SmartFitPricingBreakdown = {
  subtotalBeforeDiscountCents: number;
  discountAmountCents: number;
  discountType: string | null;
  discountLabel: string | null;
  finalTotalCents: number;
};

/**
 * Thrown inside the booking transaction when the client's expected discount or
 * total no longer matches the authoritative in-transaction recompute. Rolls
 * the transaction back; the catch maps it to 409 SMART_FIT_CHANGED with the
 * fresh breakdown so the caller can re-confirm at the current price.
 */
class SmartFitStaleError extends Error {
  constructor(public readonly breakdown: SmartFitPricingBreakdown) {
    super('SMART_FIT_CHANGED');
    this.name = 'SmartFitStaleError';
  }
}

class BookingIdentityAppearedError extends Error {
  constructor() {
    super('BOOKING_IDENTITY_APPEARED');
    this.name = 'BookingIdentityAppearedError';
  }
}

class BookingClientConflictError extends Error {
  constructor() {
    super('BOOKING_CLIENT_CONFLICT');
    this.name = 'BookingClientConflictError';
  }
}

class BookingActiveAppointmentError extends Error {
  constructor() {
    super('BOOKING_ACTIVE_APPOINTMENT');
    this.name = 'BookingActiveAppointmentError';
  }
}

/**
 * The original appointment of a reschedule carries a live deposit.
 *
 * The reschedule branch cancels the original and INSERTS A NEW APPOINTMENT ID
 * with request-derived services and prices. A deposit is bolted to the original
 * id by a composite FK, so without this fence one paid deposit would stay
 * attached to a `cancelled` shell while buying an unbounded chain of
 * re-bookings at arbitrary services and prices. The manage-flow move preserves
 * the appointment id and is the correct route for this.
 */
class RescheduleRequiresManageFlowError extends Error {
  constructor() {
    super('DEPOSIT_LOCKED_RESCHEDULE');
    this.name = 'RescheduleRequiresManageFlowError';
  }
}

class BookingPolicyAcknowledgmentRequiredError extends Error {
  constructor(public readonly bookingPolicy: RequiredBookingPolicy) {
    super('BOOKING_POLICY_ACKNOWLEDGMENT_REQUIRED');
    this.name = 'BookingPolicyAcknowledgmentRequiredError';
  }
}

class BookingPolicyChangedError extends Error {
  constructor(public readonly bookingPolicy: RequiredBookingPolicy) {
    super('BOOKING_POLICY_CHANGED');
    this.name = 'BookingPolicyChangedError';
  }
}

class BookingPolicyAttemptReusedError extends Error {
  constructor() {
    super('ACKNOWLEDGMENT_ATTEMPT_REUSED');
    this.name = 'BookingPolicyAttemptReusedError';
  }
}

class BookingFinancialQuoteChangedError extends Error {
  constructor(public readonly quote: {
    currency: string;
    totalDueCents: number;
    taxConfigurationIdentity: string;
  }) {
    super('BOOKING_FINANCIAL_QUOTE_CHANGED');
    this.name = 'BookingFinancialQuoteChangedError';
  }
}

function bookingPolicyAcknowledgmentRequiredResponse(
  bookingPolicy: RequiredBookingPolicy,
): Response {
  return Response.json(
    {
      error: 'BOOKING_POLICY_ACKNOWLEDGMENT_REQUIRED',
      message: BOOKING_POLICY_ACKNOWLEDGMENT_REQUIRED_MESSAGE,
      bookingPolicy,
    },
    { status: 400 },
  );
}

function bookingPolicyChangedResponse(
  bookingPolicy: RequiredBookingPolicy,
): Response {
  return Response.json(
    {
      error: 'BOOKING_POLICY_CHANGED',
      message: BOOKING_POLICY_CHANGED_MESSAGE,
      bookingPolicy,
    },
    { status: 409 },
  );
}

function bookingPolicyAttemptReusedResponse(): Response {
  return Response.json(
    {
      error: 'ACKNOWLEDGMENT_ATTEMPT_REUSED',
      message: BOOKING_POLICY_ATTEMPT_REUSED_MESSAGE,
    },
    { status: 409 },
  );
}

function bookingPolicyCheckRetryResponse(): Response {
  return Response.json(
    {
      error: 'BOOKING_POLICY_CHECK_RETRY',
      message: BOOKING_POLICY_CHECK_RETRY_MESSAGE,
    },
    {
      status: 503,
      headers: { 'Retry-After': '1' },
    },
  );
}

function bookingFinancialQuoteChangedResponse(
  error: BookingFinancialQuoteChangedError,
): Response {
  return Response.json(
    {
      error: {
        code: 'BOOKING_FINANCIAL_QUOTE_CHANGED',
        message: 'The salon tax or currency settings changed. Review the updated total before booking.',
        details: {
          refreshQuote: true,
          quote: error.quote,
        },
      },
    } satisfies ErrorResponse,
    { status: 409 },
  );
}

function publicBookingRateLimitResponse(retryAfterSeconds: number): Response {
  return Response.json(
    {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many booking attempts. Please wait a few minutes and try again.',
        retryAfterSeconds,
      },
    } satisfies ErrorResponse,
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfterSeconds),
      },
    },
  );
}

function postgresErrorField(
  error: unknown,
  field: 'code' | 'constraint',
): string | null {
  let current = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== 'object') {
      return null;
    }
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    const value = candidate[field];
    if (typeof value === 'string') {
      return value;
    }
    current = candidate.cause;
  }
  return null;
}

function isBookingPolicyLockTimeout(error: unknown): boolean {
  return ['55P03', '57014'].includes(
    postgresErrorField(error, 'code') ?? '',
  );
}

function isBookingPolicyAttemptConstraintViolation(error: unknown): boolean {
  return postgresErrorField(error, 'code') === '23505'
    && postgresErrorField(error, 'constraint')
    === 'booking_policy_ack_attempt_unique';
}

function smartFitStaleResponse(error: SmartFitStaleError): Response {
  return Response.json(
    {
      error: {
        code: 'SMART_FIT_CHANGED',
        message: SMART_FIT_STALE_MESSAGE,
        details: {
          refreshAvailability: true,
          breakdown: error.breakdown,
        },
      },
    } satisfies ErrorResponse,
    { status: 409 },
  );
}

function campaignFailureResponse(code: CampaignValidationFailureCode): Response {
  const status = code === 'CAMPAIGN_EXPIRED' || code === 'PROMOTION_DISABLED'
    ? 410
    : code === 'CLIENT_MISMATCH'
      ? 403
      : 409;
  const message = code === 'CAMPAIGN_EXPIRED' || code === 'PROMOTION_DISABLED'
    ? 'This promotion is no longer available.'
    : code === 'CAMPAIGN_REDEEMED'
      ? 'This promotion has already been used.'
      : code === 'CLIENT_MISMATCH'
        ? 'This promotion was prepared for a different client.'
        : 'This promotion does not apply to the selected service.';

  return Response.json({ error: { code, message } } satisfies ErrorResponse, { status });
}

function bookingClientConflictResponse(): Response {
  return Response.json(
    {
      error: {
        code: 'CONTACT_IDENTITY_CONFLICT',
        message: 'These contact details cannot be used for an online booking. Please check the details, or contact the salon for help.',
      },
    } satisfies ErrorResponse,
    { status: 409 },
  );
}

function bookingActiveAppointmentResponse(
  bookingSubjectMode: BookingSubjectMode,
): Response {
  return Response.json(
    {
      error: {
        code: 'EXISTING_APPOINTMENT',
        message: bookingSubjectMode === 'self'
          ? 'You already have an upcoming appointment. Use your appointment link to change or cancel it, or request a fresh link.'
          : 'An active appointment already exists for these contact details. Use the appointment-access email or contact the salon for help.',
      },
    } satisfies ErrorResponse,
    { status: 409 },
  );
}

// =============================================================================
// DEPOSITS — scope predicate, refusals, and their responses
// =============================================================================

/**
 * Fails CLOSED at runtime, and reddens `check-types` at build time.
 *
 * The scope predicate below is an exhaustive `switch` over
 * `DepositPolicyInactiveReason` whose `default` arm calls this. A literal added
 * by a future D3 PR therefore (a) fails to compile here, and (b) if it somehow
 * reached runtime, throws — producing a 500 with NO committed row — instead of
 * falling through to the surrounding non-deposit path, which is a silent FREE
 * BOOKING for a whole salon population.
 */
function assertNever(value: never): never {
  throw new Error(
    `Unclassified deposit policy reason: ${String(value)}. A new reason is an owner election, not a default.`,
  );
}

type DepositScopeDecision = 'enter' | 'refuse_undetermined' | 'skip';

/** Everything the post-commit Checkout call needs from the committed rows. */
type CommittedDepositPlan = {
  depositId: string;
  amountCents: number;
  holdExpiresAt: Date;
  stripeAccountId: string;
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
  fingerprint: string;
};

/**
 * THE DEPOSIT-BRANCH SCOPE PREDICATE, DEFINED ON THE REASON PARTITION.
 *
 * It is emphatically NOT `if (!policy.active) skip`. A composite-verdict gate
 * makes reason 'undetermined' SKIP the branch, so every refusal that lives
 * inside the branch never runs and the booking commits FREE on a live deposits
 * salon — with no deposit row, no audit row, no alert, and no test placed
 * inside the branch able to observe it.
 *
 *   'undetermined'          -> REFUSE (503). Fail closed. This is the exact
 *                              position at which a composite gate books free.
 *                              It is narrowly scoped, not a booking outage:
 *                              getDepositPolicyForSalon resolves locally first
 *                              and only issues the binding read when the local
 *                              reason is 'account_not_connected', so only a
 *                              salon that is entitled AND enabled AND
 *                              configured AND CAD can ever see it.
 *   configuration-side (5)  -> SKIP. The salon decided, is not entitled, or its
 *                              currency is unsupported. Nothing was disclosed
 *                              and nothing is collectable. The fingerprint is
 *                              deliberately INERT here: no disclosure can drag
 *                              a decided-off salon into the branch.
 *   account-side (3)        -> CONDITIONAL on whether a deposit was disclosed.
 *                              A SET MEMBERSHIP TEST over all three literals:
 *                              conditioning one and skipping the other two
 *                              unconditionally silently commits free bookings
 *                              for every client shown a deposit at a
 *                              deauthorized or never-synced salon.
 */
function classifyDepositScope(
  reason: DepositPolicyInactiveReason,
  depositWasDisclosed: boolean,
): DepositScopeDecision {
  switch (reason) {
    case 'undetermined':
      return 'refuse_undetermined';

    case 'collection_not_live':
    case 'not_entitled':
    case 'not_configured':
    case 'disabled':
    case 'currency_unsupported':
      return 'skip';

    case 'account_not_connected':
    case 'account_not_charge_ready':
    case 'readiness_never_synced':
      return depositWasDisclosed ? 'enter' : 'skip';

    default:
      return assertNever(reason);
  }
}

/** R0/R1/R2/R3/R4 all land here. Fail closed, never a silent free booking. */
class DepositsUnavailableError extends Error {
  constructor(public readonly stage: string) {
    super('DEPOSITS_TEMPORARILY_UNAVAILABLE');
    this.name = 'DepositsUnavailableError';
  }
}

/** R5: the authoritative amount is HIGHER than what the client was shown. */
class DepositChangedError extends Error {
  constructor(
    public readonly amountCents: number,
    public readonly fingerprint: string,
  ) {
    super('DEPOSIT_CHANGED');
    this.name = 'DepositChangedError';
  }
}

/**
 * A required charge below Stripe's floor. NOT a refusal class of its own in the
 * policy sense — D3 already returns { required:false, reason:'below_minimum_charge' }
 * for a capped amount under the floor, which means "proceed with no deposit".
 * Reaching here means the resolver returned a required amount that is illegal,
 * so fail closed rather than dispatch an illegal charge.
 */
class DepositAmountFloorError extends Error {
  constructor(public readonly amountCents: number) {
    super('DEPOSIT_AMOUNT_BELOW_FLOOR');
    this.name = 'DepositAmountFloorError';
  }
}

function depositsTemporarilyUnavailableResponse(): Response {
  return Response.json(
    {
      error: {
        code: 'DEPOSITS_TEMPORARILY_UNAVAILABLE',
        message: 'Deposits are temporarily unavailable for this salon. Please try again in a few minutes.',
      },
    } satisfies ErrorResponse,
    { status: 503 },
  );
}

function depositChangedResponse(error: DepositChangedError): Response {
  return Response.json(
    {
      error: {
        code: 'DEPOSIT_CHANGED',
        message: 'The deposit for this booking has changed. Please review the updated amount before continuing.',
        // Reuses the smartFitStaleResponse SHAPE — `details.*` is the correct
        // container here. These authoritative values are MANDATORY: without
        // them a client re-rendering from the same URL reproduces the same
        // fingerprint and 409s forever.
        details: {
          deposit: {
            required: true,
            amountCents: error.amountCents,
            fingerprint: error.fingerprint,
          },
        },
      },
    } satisfies ErrorResponse,
    { status: 409 },
  );
}

function isCampaignFailureCode(value: string): value is CampaignValidationFailureCode {
  return [
    'CAMPAIGN_EXPIRED',
    'CAMPAIGN_REDEEMED',
    'CLIENT_MISMATCH',
    'NO_ELIGIBLE_SERVICE',
    'PROMOTION_DISABLED',
  ].includes(value);
}

type AppointmentDetailMaps = {
  servicesByAppointmentId: Map<string, Array<{ name: string }>>;
  photosByAppointmentId: Map<string, Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    photoType: string;
  }>>;
};

async function loadAppointmentDetailMaps(appointmentIds: string[]): Promise<AppointmentDetailMaps> {
  if (appointmentIds.length === 0) {
    return {
      servicesByAppointmentId: new Map(),
      photosByAppointmentId: new Map(),
    };
  }

  const [serviceRows, photoRows] = await Promise.all([
    db
      .select({
        appointmentId: appointmentServicesSchema.appointmentId,
        name: appointmentServicesSchema.nameSnapshot,
        liveName: serviceSchema.name,
      })
      .from(appointmentServicesSchema)
      .leftJoin(serviceSchema, eq(serviceSchema.id, appointmentServicesSchema.serviceId))
      .where(inArray(appointmentServicesSchema.appointmentId, appointmentIds)),
    db
      .select({
        id: appointmentPhotoSchema.id,
        appointmentId: appointmentPhotoSchema.appointmentId,
        imageUrl: appointmentPhotoSchema.imageUrl,
        thumbnailUrl: appointmentPhotoSchema.thumbnailUrl,
        photoType: appointmentPhotoSchema.photoType,
      })
      .from(appointmentPhotoSchema)
      .where(inArray(appointmentPhotoSchema.appointmentId, appointmentIds))
      .orderBy(desc(appointmentPhotoSchema.createdAt)),
  ]);

  const servicesByAppointmentId = new Map<string, Array<{ name: string }>>();
  for (const row of serviceRows) {
    const current = servicesByAppointmentId.get(row.appointmentId) ?? [];
    current.push({ name: row.name ?? row.liveName ?? 'Unknown service' });
    servicesByAppointmentId.set(row.appointmentId, current);
  }

  const photosByAppointmentId = new Map<string, Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    photoType: string;
  }>>();
  for (const row of photoRows) {
    const current = photosByAppointmentId.get(row.appointmentId) ?? [];
    current.push({
      id: row.id,
      imageUrl: row.imageUrl,
      thumbnailUrl: row.thumbnailUrl,
      photoType: row.photoType,
    });
    photosByAppointmentId.set(row.appointmentId, current);
  }

  return {
    servicesByAppointmentId,
    photosByAppointmentId,
  };
}

// =============================================================================
// POST /api/appointments - Create a new appointment
// =============================================================================

export async function POST(request: Request): Promise<Response> {
  // Booking-lock state lives outside the try so the finally can release the
  // lock when a request fails: without this, any failed attempt held the
  // lock for its full TTL and a same-key retry sat in the poll loop until
  // it returned BOOKING_IN_PROGRESS.
  let lockKey: string | null = null;
  let lockOwnerToken: string | null = null;
  let ownsLock = false; // Track if we successfully acquired and still own the lock
  let bookingSucceeded = false;

  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const parsed = createAppointmentSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: parsed.error.flatten(),
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const data: CreateAppointmentRequest = parsed.data;

    // 1b. NORMALIZE ALL INPUTS ONCE - reuse everywhere (hash, DB, lookups)
    // This ensures consistency between idempotency hash and actual data stored

    // Normalize technicianId: treat "any", "", whitespace-only as null
    // This ensures we NEVER store "any" string in the database
    const rawTechId = typeof data.technicianId === 'string' ? data.technicianId.trim() : '';
    let normalizedTechnicianId = (!rawTechId || rawTechId.toLowerCase() === 'any') ? null : rawTechId;

    // Normalize clientName: trim + empty→null
    const normalizedClientName = data.clientName?.trim() || null;

    // Normalize locationId: trim + empty→null
    const normalizedLocationId = data.locationId?.trim() || null;

    // Normalize originalAppointmentId: trim + empty→null
    const normalizedOriginalApptId = data.originalAppointmentId?.trim() || null;
    const normalizedBaseServiceId = data.baseServiceId?.trim() || null;
    const normalizedSelectedAddOns = data.selectedAddOns ?? [];
    const normalizedLegacyServiceIds = data.serviceIds ?? [];
    const normalizedNotes = data.notes?.trim() || null;
    const normalizedCampaignToken = data.campaignToken?.trim() || null;

    if (
      normalizedCampaignToken
      && (normalizedOriginalApptId || data.manageToken || data.googleEventReviewId)
    ) {
      return Response.json({
        error: {
          code: 'CAMPAIGN_FLOW_INVALID',
          message: 'Retention promotions can only be used for a new public booking.',
        },
      } satisfies ErrorResponse, { status: 400 });
    }

    // A management token is meaningful only when it is scoped to an original
    // appointment and subsequently verified below. Treating its mere presence
    // as a reschedule marker would let an unverified token bypass controls that
    // apply only to new public bookings, including required policy acceptance.
    if (data.manageToken && !normalizedOriginalApptId) {
      return Response.json({
        error: {
          code: 'RESCHEDULE_CONTEXT_INVALID',
          message: 'A management token must identify the appointment being rescheduled.',
        },
      } satisfies ErrorResponse, { status: 400 });
    }

    // Validate raw startTime early. If appointmentDate/appointmentTime are provided,
    // the server will recompute the final instant from the salon timezone after
    // the salon is resolved.
    const rawParsedStartTime = new Date(data.startTime);
    if (Number.isNaN(rawParsedStartTime.getTime())) {
      return Response.json(
        {
          error: {
            code: 'INVALID_START_TIME',
            message: 'startTime must be a valid ISO 8601 date string',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    if (!normalizedBaseServiceId && normalizedLegacyServiceIds.length === 0) {
      return Response.json(
        {
          error: {
            code: 'INVALID_SELECTION',
            message: 'A base service is required',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // 2. Resolve salon from slug
    const salon = await getSalonBySlug(data.salonSlug);
    if (!salon) {
      return Response.json(
        {
          error: {
            code: 'SALON_NOT_FOUND',
            message: `Salon with slug "${data.salonSlug}" not found`,
          },
        } satisfies ErrorResponse,
        { status: 404 },
      );
    }
    if (salon.freeSoloEnabled) {
      normalizedTechnicianId = null;
    }

    // 2b. Check salon status - block bookings for suspended/cancelled salons
    const statusGuard = await guardSalonApiRoute(salon.id);
    if (statusGuard) {
      return statusGuard;
    }

    // 2c. Check onlineBooking feature entitlement (Step 16.1)
    const featureGuard = await guardFeatureEntitlement(salon.id, 'onlineBooking');
    if (featureGuard) {
      return featureGuard;
    }

    const bookingConfig = await getBookingConfigForSalon(salon.id);
    // Smart Fit (P7.2): resolves to the inert disabled default unless the
    // salon explicitly enabled `settings.smartFit` — every smart-fit branch
    // below is skipped when disabled, keeping the legacy path unchanged.
    const smartFitConfig = resolveSmartFitConfig(
      (salon.settings as SalonSettings | null | undefined) ?? null,
    );
    const requestedDate = data.appointmentDate?.trim() || null;
    const requestedTime = data.appointmentTime?.trim() || null;
    const parsedStartTime = requestedDate && requestedTime
      ? zonedTimeToUtc({
        date: requestedDate,
        time: requestedTime,
        timeZone: bookingConfig.timezone,
      })
      : rawParsedStartTime;
    const canonicalStartTime = parsedStartTime.toISOString();

    let actorRole: 'guest' | 'client' | 'staff' | 'admin' = 'guest';
    let clientPhoneInput = data.clientPhone ?? null;
    // Defaults to 'guest' for visitors, staff and admins; only a resolved
    // client session can promote it to 'self'.
    let bookingSubjectMode: BookingSubjectMode = 'guest';
    let clientAuth:
      | Awaited<ReturnType<typeof requireClientApiSession>>
      | null = null;

    const staffAuth = await requireStaffSession();
    if (staffAuth.ok && staffAuth.session.salonId === salon.id) {
      actorRole = 'staff';
    } else {
      const adminGuard = await requireAdmin(salon.id);
      if (adminGuard.ok) {
        actorRole = 'admin';
      } else {
        clientAuth = await requireClientApiSession();
        if (clientAuth.ok) {
          // A session proves WHO is browsing, not who the booking is for. The
          // subject is resolved explicitly below; this route no longer rebinds
          // the typed phone to the account, which used to block a signed-in
          // browser from ever booking for anyone else.
          const subject = resolveBookingSubject({
            hasClientSession: true,
            sessionPhone: clientAuth.normalizedPhone,
            requestedMode: data.bookingSubject as BookingSubjectMode | undefined,
            typedPhone: clientPhoneInput,
          });

          if (!subject.ok) {
            return Response.json(
              {
                error: {
                  code: 'BOOKING_IDENTITY_CONFLICT',
                  // No detail about the account beyond the fact that one is
                  // signed in — this is reachable from any signed-in browser.
                  message: 'You are signed in, but the contact details entered are different. Continue with your signed-in details, choose "Book for someone else", or sign out.',
                },
              } satisfies ErrorResponse,
              { status: 409 },
            );
          }

          bookingSubjectMode = subject.mode;
          if (subject.mode === 'self') {
            actorRole = 'client';
            // The account's phone is authoritative and is never overwritten by
            // the form: it is the OTP login credential, so changing it here
            // would be an account-takeover path. Profile settings own it.
            clientPhoneInput = clientAuth.normalizedPhone;
          } else {
            // "Book for someone else": the signed-in identity is deliberately
            // not attached, and the typed contact details stand on their own.
            clientAuth = null;
          }
        }
      }
    }

    let googleReviewEvent: typeof googleCalendarEventSchema.$inferSelect | null = null;
    if (data.googleEventReviewId) {
      if (actorRole !== 'admin') {
        return Response.json({ error: { code: 'FORBIDDEN', message: 'Only a salon owner can convert a Google event.' } }, { status: 403 });
      }
      const [selectedGoogleReviewEvent] = await db.select().from(googleCalendarEventSchema).where(and(
        eq(googleCalendarEventSchema.id, data.googleEventReviewId),
        eq(googleCalendarEventSchema.salonId, salon.id),
        isNull(googleCalendarEventSchema.deletedAt),
      )).limit(1);
      googleReviewEvent = selectedGoogleReviewEvent || null;
      if (!googleReviewEvent) {
        return Response.json({ error: { code: 'GOOGLE_EVENT_NOT_FOUND', message: 'Google event not found.' } }, { status: 404 });
      }
      if (googleReviewEvent.appointmentId || googleReviewEvent.reviewStatus === 'appointment') {
        return Response.json({ error: { code: 'GOOGLE_EVENT_ALREADY_CONVERTED', message: 'This Google event is already an appointment.' } }, { status: 409 });
      }
      if (Math.abs(googleReviewEvent.startTime.getTime() - parsedStartTime.getTime()) > 60_000) {
        return Response.json({ error: { code: 'GOOGLE_EVENT_TIME_CHANGED', message: 'The Google event time changed. Refresh and try again.' } }, { status: 409 });
      }
    } else if (data.durationMinutesOverride !== undefined || normalizedNotes) {
      return Response.json({
        error: {
          code: 'GOOGLE_EVENT_FIELDS_INVALID',
          message: 'Duration overrides and conversion notes require a Google event.',
        },
      } satisfies ErrorResponse, { status: 400 });
    }

    const normalizedClientEmail = data.clientEmail?.trim().toLowerCase() || null;
    if (actorRole === 'guest' && (!clientPhoneInput || !normalizedClientName || !normalizedClientEmail)) {
      return Response.json({
        error: {
          code: 'GUEST_CONTACT_REQUIRED',
          message: 'Name, email, and phone are required to book.',
        },
      } satisfies ErrorResponse, { status: 400 });
    }

    if ((actorRole === 'staff' || actorRole === 'admin') && !clientPhoneInput) {
      return Response.json(
        {
          error: {
            code: 'INVALID_PHONE',
            message: 'Phone number must be provided when staff or admins create appointments',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    // Normalize phone for validation, hashing, and duplicate checks.
    const normalizedPhone = normalizePhone(clientPhoneInput ?? '');
    if (!normalizedPhone || normalizedPhone.length !== 10) {
      return Response.json(
        {
          error: {
            code: 'INVALID_PHONE',
            message: 'Phone number must be a valid 10-digit Canadian or US number',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const isNewPublicBooking = (
      actorRole === 'guest' || actorRole === 'client'
    )
    && !normalizedOriginalApptId
    && !data.manageToken
    && !googleReviewEvent;
    const requestedPolicyAcknowledgment = data.bookingPolicyAcknowledgment;

    // This full canonical hash is a database authority as well as the Redis
    // payload hash. It is therefore generated even when Redis is unavailable.
    // Key order is intentionally fixed; arrays whose order is not meaningful
    // are sorted after normalization.
    const requestBodyHash = hashCanonicalBookingRequest({
      salonId: salon.id,
      serviceIds: [...normalizedLegacyServiceIds].sort(),
      baseServiceId: normalizedBaseServiceId,
      selectedAddOns: normalizedSelectedAddOns
        .map(addOn => ({
          addOnId: addOn.addOnId,
          quantity: addOn.quantity ?? 1,
        }))
        .sort((left, right) =>
          left.addOnId.localeCompare(right.addOnId)
          || left.quantity - right.quantity),
      technicianId: normalizedTechnicianId,
      clientPhone: normalizedPhone,
      clientName: normalizedClientName,
      clientEmail: normalizedClientEmail,
      smsConsent: data.smsConsent
        ? {
            granted: data.smsConsent.granted,
            wordingVersion: data.smsConsent.wordingVersion,
          }
        : null,
      startTime: canonicalStartTime,
      locationId: normalizedLocationId,
      originalAppointmentId: normalizedOriginalApptId,
      manageTokenHash: hashSensitiveBookingValue(
        data.manageToken?.trim() || null,
      ),
      bookingSubject: bookingSubjectMode,
      actorRole,
      googleEventReviewId: data.googleEventReviewId ?? null,
      priceCentsOverride: data.priceCentsOverride ?? null,
      durationMinutesOverride: data.durationMinutesOverride ?? null,
      notes: normalizedNotes,
      campaignTokenHash: normalizedCampaignToken
        ? hashRetentionCampaignToken(normalizedCampaignToken)
        : null,
      expectedDiscountType: data.expectedDiscountType === undefined
        ? null
        : (data.expectedDiscountType?.trim() || null),
      expectedTotalCents: data.expectedTotalCents ?? null,
      expectedBookingFinancialQuote: data.expectedBookingFinancialQuote ?? null,
      // Registered here deliberately: without it, two requests differing ONLY
      // in the amount the client was shown hash identically, which weakens both
      // the Redis idempotency payload comparison and the acknowledgment-replay
      // authority.
      expectedDepositFingerprint: data.expectedDepositFingerprint ?? null,
      bookingPolicyAcknowledgment: requestedPolicyAcknowledgment
        ? {
            accepted: requestedPolicyAcknowledgment.accepted,
            version: requestedPolicyAcknowledgment.version,
            attemptId: requestedPolicyAcknowledgment.attemptId,
          }
        : null,
    });

    // 2d. IDEMPOTENCY CHECK: Prevent double-submit on booking confirmation
    // Client should send Idempotency-Key header with a UUID generated on page load
    const idempotencyKey = request.headers.get('Idempotency-Key');
    let idempotencyCacheKey: string | null = null;
    let redisAvailable = false;
    let idempotencyEnabled = false; // Master flag - if false, skip ALL idempotency codepaths

    // Check Redis availability ONCE upfront - if down, skip idempotency entirely
    if (idempotencyKey && redis) {
      try {
        redisAvailable = await isRedisAvailable();
      } catch {
        redisAvailable = false;
      }
    }

    if (idempotencyKey && redisAvailable && redis) {
      idempotencyCacheKey = getBookingIdempotencyKey(salon.id, idempotencyKey);
      lockKey = getBookingLockKey(salon.id, idempotencyKey);

      try {
        // First check if result is already cached
        const cachedResultJson = await redis.get(idempotencyCacheKey);

        if (cachedResultJson) {
          const cachedResult = JSON.parse(cachedResultJson);

          // Check if payload hash matches (same key, different payload = error)
          if (cachedResult.payloadHash && cachedResult.payloadHash !== requestBodyHash) {
            return Response.json(
              {
                error: {
                  code: 'IDEMPOTENCY_KEY_REUSE',
                  message: 'This idempotency key was already used with a different request payload',
                },
              } satisfies ErrorResponse,
              { status: 409 },
            );
          }

          // Same key, same payload - return cached response with SAME status code
          return Response.json(
            {
              ...cachedResult.responseBody,
              meta: {
                ...cachedResult.responseBody.meta,
                cached: true,
              },
            },
            { status: cachedResult.statusCode },
          );
        }

        // No cached result - try to acquire lock with ownership token
        // Token allows us to atomically verify we still own the lock before DB insert
        lockOwnerToken = crypto.randomUUID();
        const lockAcquired = await redis.set(lockKey, lockOwnerToken, 'PX', BOOKING_LOCK_MS, 'NX');

        if (lockAcquired) {
          // We own the lock - idempotency is active for this request
          idempotencyEnabled = true;
          ownsLock = true;
        } else {
          // Another request is processing this idempotency key
          // Poll for cached result - window derived from TTL (not hardcoded)
          const maxPollMs = BOOKING_POLL_WINDOW_MS; // TTL - 2s buffer
          const baseDelayMs = 300;
          const maxDelayMs = 2000;
          let elapsedMs = 0;

          while (elapsedMs < maxPollMs) {
            const delay = Math.min(baseDelayMs * 1.5 ** (elapsedMs / 1000), maxDelayMs);
            await new Promise(resolve => setTimeout(resolve, delay));
            elapsedMs += delay;

            const retryCache = await redis.get(idempotencyCacheKey);
            if (retryCache) {
              const cachedResult = JSON.parse(retryCache);

              // Validate payload hash even on retry
              if (cachedResult.payloadHash && cachedResult.payloadHash !== requestBodyHash) {
                return Response.json(
                  {
                    error: {
                      code: 'IDEMPOTENCY_KEY_REUSE',
                      message: 'This idempotency key was already used with a different request payload',
                    },
                  } satisfies ErrorResponse,
                  { status: 409 },
                );
              }

              // Return cached response with SAME status code as winner
              return Response.json(
                {
                  ...cachedResult.responseBody,
                  meta: {
                    ...cachedResult.responseBody.meta,
                    cached: true,
                  },
                },
                { status: cachedResult.statusCode },
              );
            }
          }

          // Still no result after polling window - return 409 so client can retry
          return Response.json(
            {
              error: {
                code: 'BOOKING_IN_PROGRESS',
                message: 'A booking with this idempotency key is currently being processed. Please retry.',
              },
            } satisfies ErrorResponse,
            { status: 409 },
          );
        }
      } catch (cacheReadError) {
        // Redis read failed - proceed without idempotency (booking must still work)
        console.warn('Idempotency cache read failed, proceeding without:', cacheReadError);
        idempotencyCacheKey = null; // Disable cache write too
        lockKey = null;
      }
    }

    // A cached idempotent replay has already returned above. Only the lock
    // owner (or a request without an idempotency key) spends rate-limit quota,
    // so accidental concurrent submissions behave like one booking attempt.
    // Staff/admin creations and all existing-appointment mutations are outside
    // this public-new-booking boundary.
    if (isNewPublicBooking) {
      const rateLimit = await checkPublicBookingRateLimit({
        salonId: salon.id,
        clientIp: getPublicBookingClientIp(request),
        normalizedPhone,
      });
      if (!rateLimit.allowed) {
        return publicBookingRateLimitResponse(rateLimit.retryAfterSeconds);
      }
    }

    // Keep abuse traffic out of the canonical-identity and downstream booking
    // queries, while retaining fail-open behavior when Redis is unavailable.
    let preliminaryCanonicalIdentity: CanonicalSalonClientIdentity | null = null;
    try {
      preliminaryCanonicalIdentity = await resolveCanonicalSalonClientIdentity({
        salonId: salon.id,
        phone: normalizedPhone,
        email: normalizedClientEmail,
      });
    } catch (error) {
      if (error instanceof ClientLifecycleStabilizationError) {
        return Response.json(
          {
            error: {
              code: 'CONTACT_IDENTITY_CONFLICT',
              message: 'These contact details cannot be used for an online booking. Please check the details, or contact the salon for help.',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }
      throw error;
    }

    const preliminaryRequiredPolicy = isNewPublicBooking
      ? resolveRequiredBookingPolicy({
        storedPlan: salon.plan,
        features: (salon.features as SalonFeatures | null | undefined) ?? null,
        settings: (salon.settings as SalonSettings | null | undefined) ?? null,
      })
      : null;

    if (preliminaryRequiredPolicy) {
      if (
        !requestedPolicyAcknowledgment
        || requestedPolicyAcknowledgment.accepted !== true
      ) {
        return bookingPolicyAcknowledgmentRequiredResponse(
          preliminaryRequiredPolicy,
        );
      }
      if (
        requestedPolicyAcknowledgment.version
        !== preliminaryRequiredPolicy.version
      ) {
        return bookingPolicyChangedResponse(preliminaryRequiredPolicy);
      }

      // Fast-path detection improves the response for a malicious or stale
      // attempt reuse. The transaction-scoped unique constraint remains the
      // race-safe authority.
      const [existingAttempt] = await db
        .select({
          requestHash:
            appointmentBookingPolicyAcknowledgmentSchema.requestHash,
        })
        .from(appointmentBookingPolicyAcknowledgmentSchema)
        .where(and(
          eq(
            appointmentBookingPolicyAcknowledgmentSchema.salonId,
            salon.id,
          ),
          eq(
            appointmentBookingPolicyAcknowledgmentSchema.source,
            BOOKING_POLICY_ACKNOWLEDGMENT_SOURCE,
          ),
          eq(
            appointmentBookingPolicyAcknowledgmentSchema.attemptId,
            requestedPolicyAcknowledgment.attemptId,
          ),
        ))
        .limit(1);
      if (
        existingAttempt
        && existingAttempt.requestHash !== requestBodyHash
      ) {
        return bookingPolicyAttemptReusedResponse();
      }
    }

    // 3. Resolve booking selection
    let services: Service[] = [];
    let selectedAddOnsForBooking: Array<{
      addOnId: string;
      name: string;
      quantity: number;
      category: string;
      pricingType: string;
      unitPriceCents: number;
      unitDurationMinutes: number;
      lineTotalCents: number;
      lineDurationMinutes: number;
    }> = [];
    let basePriceCents = 0;
    let addOnsPriceCents = 0;
    let baseDurationMinutes = 0;
    let addOnsDurationMinutes = 0;
    let totalPrice = 0;
    let totalDurationMinutes = 0;
    let bufferMinutes = bookingConfig.bufferMinutes;
    let blockedDurationMinutes = 0;
    let resolvedIntroPriceLabel: string | null = null;
    let subtotalBeforeDiscountCents = 0;
    let discountAmountCents = 0;
    let appointmentDiscountType: string | null = null;
    let appointmentDiscountLabel: string | null = null;
    let appointmentDiscountPercent: number | null = null;
    let discountAppliedAt: Date | null = null;

    if (normalizedBaseServiceId) {
      try {
        const validatedSelection = await validatePublicBookingSelection({
          salonId: salon.id,
          selection: {
            baseServiceId: normalizedBaseServiceId,
            selectedAddOns: normalizedSelectedAddOns,
          },
          technicianId: normalizedTechnicianId,
        });

        services = [validatedSelection.baseServiceRecord];
        selectedAddOnsForBooking = validatedSelection.quote.addOns.map(addOn => ({
          addOnId: addOn.addOnId,
          name: addOn.name,
          quantity: addOn.quantity,
          category: addOn.category,
          pricingType: addOn.pricingType,
          unitPriceCents: addOn.unitPriceCents,
          unitDurationMinutes: addOn.unitDurationMinutes,
          lineTotalCents: addOn.lineTotalCents,
          lineDurationMinutes: addOn.lineDurationMinutes,
        }));
        basePriceCents = validatedSelection.quote.baseService.priceCents;
        addOnsPriceCents = validatedSelection.quote.addOns.reduce((sum, addOn) => sum + addOn.lineTotalCents, 0);
        baseDurationMinutes = validatedSelection.quote.baseDurationMinutes;
        addOnsDurationMinutes = validatedSelection.quote.addOnsDurationMinutes;
        totalPrice = validatedSelection.quote.subtotalCents;
        totalDurationMinutes = validatedSelection.quote.visibleDurationMinutes;
        bufferMinutes = validatedSelection.quote.bufferMinutes;
        blockedDurationMinutes = validatedSelection.quote.blockedDurationMinutes;
        resolvedIntroPriceLabel = validatedSelection.quote.baseService.resolvedIntroPriceLabel;

        // Observation (PR 1 stage b) — this booking is not blocked, and this
        // write can never make it fail: logAuditEvent is fire-and-forget by
        // construction. Fires only on an actual booking attempt, not on every
        // availability/quote preview, to keep volume meaningful.
        //
        // Reachable only for a salon with enforcement OFF (the default): with
        // the gate on, validatePublicBookingSelection throws instead of
        // returning, and the blocked attempt is recorded by the
        // required_add_on_booking_blocked branch in the catch below. Between
        // the two, every booking attempt with a required-add-on gap stays
        // measurable whichever side of the rollout the salon is on.
        if (validatedSelection.observedRequiredAddOnGaps.length > 0) {
          await logAuditEvent({
            salonId: salon.id,
            actorType: 'client',
            action: 'required_add_on_rule_omitted',
            entityType: 'service',
            entityId: validatedSelection.baseServiceRecord.id,
            metadata: {
              missingRequiredAddOnIds: validatedSelection.observedRequiredAddOnGaps,
              technicianId: normalizedTechnicianId,
            },
          });
        }
      } catch (error) {
        // Enforcement (PR 1 stage e) must not cost us the telemetry that
        // justifies it. A blocked attempt never reaches the observation write
        // above, so record it here under its own action instead: the two are
        // deliberately distinct so a rollout can tell "would have blocked"
        // (required_add_on_rule_omitted) from "did block"
        // (required_add_on_booking_blocked). Still fire-and-forget, and it
        // cannot change the 400 that is returned either way.
        if (error instanceof BookingSelectionError && error.code === 'missing_required_add_on') {
          await logAuditEvent({
            salonId: salon.id,
            actorType: 'client',
            action: 'required_add_on_booking_blocked',
            entityType: 'service',
            entityId: normalizedBaseServiceId,
            metadata: {
              missingRequiredAddOnIds: error.missingRequiredAddOnIds,
              technicianId: normalizedTechnicianId,
            },
          });
        }

        return Response.json(
          {
            error: {
              code: 'INVALID_SELECTION',
              message: error instanceof BookingSelectionError
                ? getPublicBookingSelectionMessage(error)
                : 'Unable to validate the booking selection right now.',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    } else {
      services = await getServicesByIds(normalizedLegacyServiceIds, salon.id);

      if (services.length !== normalizedLegacyServiceIds.length) {
        const foundIds = new Set(services.map(s => s.id));
        const missingIds = normalizedLegacyServiceIds.filter(id => !foundIds.has(id));
        return Response.json(
          {
            error: {
              code: 'INVALID_SERVICES',
              message: 'One or more services not found for this salon',
              details: { missingServiceIds: missingIds },
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }

      basePriceCents = services.reduce((sum, s) => sum + s.price, 0);
      addOnsPriceCents = 0;
      baseDurationMinutes = services.reduce((sum, s) => sum + s.durationMinutes, 0);
      addOnsDurationMinutes = 0;
      totalPrice = basePriceCents;
      totalDurationMinutes = baseDurationMinutes;
      blockedDurationMinutes = totalDurationMinutes + bufferMinutes;

      if (services.length === 1) {
        resolvedIntroPriceLabel = resolveIntroPriceLabel({
          isIntroPrice: services[0]?.isIntroPrice,
          introPriceExpiresAt: services[0]?.introPriceExpiresAt ?? null,
          introPriceLabel: services[0]?.introPriceLabel ?? null,
          bookingConfig,
        });
      }
    }

    subtotalBeforeDiscountCents = totalPrice;

    let retentionCampaign: typeof retentionCampaignSchema.$inferSelect | null = null;
    if (normalizedCampaignToken) {
      const [campaign] = await db
        .select()
        .from(retentionCampaignSchema)
        .where(and(
          eq(retentionCampaignSchema.salonId, salon.id),
          eq(retentionCampaignSchema.tokenHash, hashRetentionCampaignToken(normalizedCampaignToken)),
        ))
        .limit(1);
      if (!campaign) {
        return Response.json({
          error: { code: 'CAMPAIGN_NOT_FOUND', message: 'This promotion link was not found for this salon.' },
        } satisfies ErrorResponse, { status: 404 });
      }

      const validation = validateRetentionCampaign({
        promotion: campaign.promotionSnapshot,
        expiresAt: campaign.expiresAt,
        redeemedAt: campaign.redeemedAt,
        singleUse: campaign.singleUse,
        campaignClientId: campaign.salonClientId,
        bookingClientId: campaign.salonClientId,
        serviceIds: services.map(service => service.id),
      });
      if (!validation.valid) {
        return campaignFailureResponse(validation.code);
      }
      retentionCampaign = campaign;
    }

    // 4. Validate technician (if provided) belongs to salon
    // Uses normalizedTechnicianId which has already converted "any"/""/whitespace to null
    let technician = null;
    if (normalizedTechnicianId) {
      technician = await getTechnicianById(normalizedTechnicianId, salon.id);
      if (!technician) {
        return Response.json(
          {
            error: {
              code: 'INVALID_TECHNICIAN',
              message: `Technician "${normalizedTechnicianId}" not found for this salon`,
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // 4a. Validate location (if provided) belongs to salon, else use primary
    // Use normalizedLocationId (already trimmed/empty→null above)
    let validatedLocationId: string | null = null;
    let validatedLocation = null;
    if (normalizedLocationId) {
      const location = await getLocationById(normalizedLocationId, salon.id);
      if (!location) {
        return Response.json(
          {
            error: {
              code: 'INVALID_LOCATION',
              message: `Location "${normalizedLocationId}" not found for this salon`,
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
      validatedLocationId = location.id;
      validatedLocation = location;
    } else {
      // No locationId provided - use primary location if exists
      const primaryLocation = await getPrimaryLocation(salon.id);
      validatedLocationId = primaryLocation?.id ?? null;
      validatedLocation = primaryLocation;
    }

    // 4b. Check for existing active appointment (duplicate booking prevention)
    // Skip this check if this is a reschedule (originalAppointmentId provided)
    // Use normalizedPhone for DB lookups (same as will be stored)
    if (!normalizedOriginalApptId) {
      // Canonical matching (see src/libs/bookingIdentity.ts): normalized phone
      // is primary, email secondary, and a phone/email split is an identity
      // conflict rather than a guess. Both lookups are salon-scoped and cover
      // active statuses only, so cancelled/completed rows never block.
      const [phoneMatches, emailMatches] = await Promise.all([
        getActiveAppointmentsForContact({
          salonId: salon.id,
          phone: normalizedPhone,
          horizon: 'booking-gate',
        }),
        normalizedClientEmail
          ? getActiveAppointmentsForContact({
            salonId: salon.id,
            email: normalizedClientEmail,
            horizon: 'booking-gate',
          })
          : Promise.resolve([]),
      ]);

      const stableLineageIds = new Set(
        preliminaryCanonicalIdentity?.clientIds ?? [],
      );
      const eligiblePhoneMatches = phoneMatches.filter(appointment =>
        appointment.salonClientId == null
        || stableLineageIds.has(appointment.salonClientId));
      const eligibleEmailMatches = emailMatches.filter(appointment =>
        appointment.salonClientId == null
        || stableLineageIds.has(appointment.salonClientId));
      const duplicate = classifyDuplicateBooking({
        normalizedPhone,
        email: normalizedClientEmail,
        phoneMatches: eligiblePhoneMatches,
        emailMatches: eligibleEmailMatches,
      });

      // Every branch below is intentionally detail-free: these responses are
      // reachable with nothing but a phone number or an email address, so any
      // date, service or name would let callers enumerate other people.
      if (duplicate.decision === 'identity_conflict') {
        return Response.json(
          {
            error: {
              code: 'CONTACT_IDENTITY_CONFLICT',
              message: 'The phone number and email address entered belong to different existing bookings. Please check the details, or contact the salon for help.',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }

      if (duplicate.decision === 'block') {
        // If what is blocking them is THEIR OWN live deposit hold, say so, and
        // give the expiry so the client knows how long the slot is theirs.
        // Deliberately NO checkout URL and NO manage URL: this API
        // authenticates by phone possession alone, so returning either would
        // hand an in-flight payment session to anyone who types the victim's
        // phone number. The client surfaces this through the existing
        // EXISTING_APPOINTMENT presentation, not the generic error banner.
        const blockingHold = [...eligiblePhoneMatches, ...eligibleEmailMatches]
          .find(match => match.status === 'awaiting_payment');
        if (blockingHold) {
          return Response.json(
            {
              error: {
                code: 'DEPOSIT_HOLD_ACTIVE',
                message: 'You already have a booking waiting for its deposit. Finish that payment, or wait for the hold to expire.',
                details: {
                  holdExpiresAt: blockingHold.depositHoldExpiresAt?.toISOString() ?? null,
                },
              },
            } satisfies ErrorResponse,
            { status: 409 },
          );
        }

        return Response.json(
          {
            error: {
              code: 'EXISTING_APPOINTMENT',
              message: bookingSubjectMode === 'self'
                ? 'You already have an upcoming appointment. Use your appointment link to change or cancel it, or request a fresh link.'
                : 'An active appointment already exists for these contact details. Use the appointment-access email or contact the salon for help.',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }
    }

    // 4c. If this is a reschedule, validate that the original appointment exists
    // and that the authenticated actor is allowed to reschedule it.
    let originalAppointment = null;
    let originalOperationalClient: OperationalSalonClientContact | null = null;
    if (normalizedOriginalApptId) {
      originalAppointment = await getAppointmentById(
        normalizedOriginalApptId,
        salon.id,
      );
      if (!originalAppointment) {
        return Response.json(
          {
            error: {
              code: 'ORIGINAL_APPOINTMENT_NOT_FOUND',
              message: 'Original appointment not found for rescheduling',
            },
          } satisfies ErrorResponse,
          { status: 404 },
        );
      }

      if (originalAppointment.salonId !== salon.id) {
        return Response.json(
          {
            error: {
              code: 'UNAUTHORIZED_RESCHEDULE',
              message: 'Original appointment does not belong to this salon',
            },
          } satisfies ErrorResponse,
          { status: 403 },
        );
      }

      const normalizedOriginalPhone = normalizePhone(originalAppointment.clientPhone);
      try {
        if (originalAppointment.salonClientId) {
          originalOperationalClient = await resolveOperationalSalonClientContact({
            salonId: salon.id,
            clientId: originalAppointment.salonClientId,
          });
        } else {
          const resolvedOriginalIdentity = await resolveCanonicalSalonClientIdentity({
            salonId: salon.id,
            phone: normalizedOriginalPhone,
            email: originalAppointment.clientEmail,
          });
          originalOperationalClient = resolvedOriginalIdentity?.terminal ?? null;
        }
      } catch (error) {
        if (error instanceof ClientLifecycleStabilizationError) {
          return Response.json(
            {
              error: {
                code: 'UNAUTHORIZED_RESCHEDULE',
                message: 'You can only reschedule your own appointments',
              },
            } satisfies ErrorResponse,
            { status: 403 },
          );
        }
        throw error;
      }
      const clientOwnsOriginal = actorRole === 'client'
        && clientAuth?.ok
        && (
          originalOperationalClient
            ? clientAuth.normalizedPhone === originalOperationalClient.phone
            : clientAuth.normalizedPhone === normalizedOriginalPhone
        );

      const guestOwnsOriginal = actorRole === 'guest' && data.manageToken
        ? Boolean(await verifyAppointmentAccessToken(data.manageToken, {
          appointmentId: originalAppointment.id,
          salonId: salon.id,
        }))
        : false;

      if ((actorRole === 'client' && !clientOwnsOriginal) || (actorRole === 'guest' && !guestOwnsOriginal)) {
        return Response.json(
          {
            error: {
              code: 'UNAUTHORIZED_RESCHEDULE',
              message: 'You can only reschedule your own appointments',
            },
          } satisfies ErrorResponse,
          { status: 403 },
        );
      }

      // Verify the original appointment is still active
      if (!['pending', 'confirmed'].includes(originalAppointment.status)) {
        return Response.json(
          {
            error: {
              code: 'APPOINTMENT_NOT_ACTIVE',
              message: 'Cannot reschedule an appointment that is already cancelled or completed',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
      if (actorRole === 'guest' && !getClientChangePolicy(originalAppointment.startTime, bookingConfig).canChange) {
        return Response.json(
          { error: { code: 'CHANGE_WINDOW_CLOSED', message: `Online changes close ${bookingConfig.clientChangeCutoffHours} hours before the appointment. Please contact the salon.` } } satisfies ErrorResponse,
          { status: 409 },
        );
      }
    }

    // 4d. Look up existing client by phone to get their name
    // Use normalizedClientName (already trimmed/empty→null above)
    let clientName = normalizedClientName;
    if (!clientName) {
      const existingClient = await getClientByPhone(normalizedPhone);
      if (existingClient?.firstName) {
        clientName = existingClient.firstName;
      }
    }

    // Ownership of the original appointment has been fully proven above (staff
    // actor, matching client session, or a manage token scoped to this exact
    // appointment+salon) — anything else already returned 403. Only from here
    // may the reschedule suppress its own Google Calendar mirror.
    const authorizedRescheduleAppointmentId = originalAppointment
      ? normalizedOriginalApptId
      : null;

    // 4e. Resolve automatic discount (existing active rewards win over first-visit)
    const automaticDiscount = await resolveAutomaticBookingDiscount({
      salonId: salon.id,
      services,
      subtotalBeforeDiscountCents,
      clientPhone: normalizedPhone,
      originalAppointmentId: normalizedOriginalApptId,
      preserveFirstVisitDiscount: originalAppointment?.discountType === FIRST_VISIT_DISCOUNT_TYPE,
    });

    // Smart Fit reschedule policy (shared with the manage-link in-place move,
    // so the two reschedule paths cannot diverge): a Smart Fit discount already
    // committed to this appointment survives a pure date/time/technician
    // change, and is only re-evaluated when a pricing input actually moved.
    const nextPricingInputs: ReschedulePricingInputs = {
      subtotalBeforeDiscountCents,
      serviceIds: services.map(service => service.id),
      addOns: selectedAddOnsForBooking.map(addOn => ({
        addOnId: addOn.addOnId,
        quantity: addOn.quantity,
      })),
    };
    let originalPricingInputs: ReschedulePricingInputs | null = null;
    if (originalAppointment && hasCommittedSmartFitDiscount(originalAppointment)) {
      const [originalServiceRows, originalAddOnRows] = await Promise.all([
        db.select({ serviceId: appointmentServicesSchema.serviceId })
          .from(appointmentServicesSchema)
          .where(eq(appointmentServicesSchema.appointmentId, originalAppointment.id)),
        db.select({
          addOnId: appointmentAddOnSchema.addOnId,
          quantity: appointmentAddOnSchema.quantitySnapshot,
        })
          .from(appointmentAddOnSchema)
          .where(eq(appointmentAddOnSchema.appointmentId, originalAppointment.id)),
      ]);
      originalPricingInputs = {
        subtotalBeforeDiscountCents: originalAppointment.subtotalBeforeDiscountCents
          ?? originalAppointment.totalPrice + (originalAppointment.discountAmountCents ?? 0),
        serviceIds: originalServiceRows.map(row => row.serviceId).filter((id): id is string => Boolean(id)),
        addOns: originalAddOnRows.map(row => ({ addOnId: row.addOnId, quantity: row.quantity })),
      };
    }
    const preservedSmartFitDecision = originalAppointment
      ? resolveSmartFitRescheduleDiscount({
        base: automaticDiscount,
        config: smartFitConfig,
        committed: originalAppointment,
        originalPricing: originalPricingInputs,
        nextPricing: nextPricingInputs,
        // Preservation must never depend on the new slot re-qualifying. When
        // nothing is preserved, the in-transaction overlay below does the
        // honest evaluation for this slot.
        newSlotEvaluation: null,
      })
      : null;
    const preservesCommittedSmartFit = preservedSmartFitDecision?.preservesCommittedDiscount === true;

    let appliedReward = automaticDiscount.kind === 'reward' ? automaticDiscount.reward : null;
    totalPrice = automaticDiscount.finalTotalCents;
    discountAmountCents = automaticDiscount.discountAmountCents;

    if (automaticDiscount.kind === 'first_visit' && automaticDiscount.firstVisit) {
      appointmentDiscountType = automaticDiscount.firstVisit.discountType;
      appointmentDiscountLabel = automaticDiscount.firstVisit.discountLabel;
      appointmentDiscountPercent = automaticDiscount.firstVisit.discountPercent;
      discountAppliedAt = automaticDiscount.firstVisit.discountAppliedAt;
    } else if (automaticDiscount.kind === 'reward') {
      appointmentDiscountType = 'reward';
      appointmentDiscountLabel = 'Reward applied';
      appointmentDiscountPercent = null;
      discountAppliedAt = new Date();
    }

    // Carry the committed Smart Fit discount over unchanged. Deliberately does
    // NOT consume a reward: the customer is moving a booking they already
    // agreed a price for, not making a new one.
    const applyPreservedSmartFit = () => {
      if (!preservedSmartFitDecision || !preservesCommittedSmartFit) {
        return;
      }
      appliedReward = null;
      totalPrice = preservedSmartFitDecision.finalTotalCents;
      discountAmountCents = preservedSmartFitDecision.discountAmountCents;
      appointmentDiscountType = preservedSmartFitDecision.discountType;
      appointmentDiscountLabel = preservedSmartFitDecision.discountLabel;
      appointmentDiscountPercent = preservedSmartFitDecision.discountPercent;
      discountAppliedAt = originalAppointment?.discountAppliedAt ?? new Date();
    };
    applyPreservedSmartFit();

    if (googleReviewEvent) {
      totalDurationMinutes = data.durationMinutesOverride ?? googleReviewEvent.durationMinutes;
      blockedDurationMinutes = totalDurationMinutes + bufferMinutes;
      if (data.priceCentsOverride !== undefined) {
        totalPrice = data.priceCentsOverride;
        subtotalBeforeDiscountCents = data.priceCentsOverride;
        // The owner-set price replaces the catalog decomposition entirely. The
        // booking tax snapshot is built from basePriceCents + addOnsPriceCents
        // − discount and is later validated against totalPrice, so every
        // component must describe the same single overridden amount; the whole
        // amount follows the salon's service taxability default.
        basePriceCents = data.priceCentsOverride;
        addOnsPriceCents = 0;
        discountAmountCents = 0;
        appointmentDiscountType = null;
        appointmentDiscountLabel = null;
        appointmentDiscountPercent = null;
        discountAppliedAt = null;
      }
    }

    // 6. Compute endTime from startTime + total duration
    // Use parsedStartTime (already validated above - not Invalid Date)
    const startTime = parsedStartTime;
    const endTime = new Date(startTime.getTime() + totalDurationMinutes * 60 * 1000);
    const blockedEndTime = new Date(startTime.getTime() + blockedDurationMinutes * 60 * 1000);

    // 6b. Validate that start time is in the future with 2-hour minimum lead time.
    const MIN_LEAD_TIME_MINUTES = 120;
    const now = new Date();
    const minimumStartTime = new Date(now.getTime() + MIN_LEAD_TIME_MINUTES * 60 * 1000);

    if (startTime <= now) {
      return Response.json(
        {
          error: {
            code: 'PAST_TIME',
            message: 'Cannot book an appointment in the past. Please select a future date and time.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    if (!googleReviewEvent && startTime < minimumStartTime) {
      return Response.json(
        {
          error: {
            code: 'TOO_SOON',
            message: 'Appointments must be booked at least 2 hours in advance. Please select a later time.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const bookingDate = getTorontoDateString(startTime);
    const { startOfDay: bookingStartOfDay, endOfDay: bookingEndOfDay } = getZonedDayBounds(
      bookingDate,
      bookingConfig.timezone,
    );

    let candidateTechnicians = technician
      ? [technician]
      : await getTechniciansBySalonId(salon.id);

    // Google-event conversions import an appointment that already exists on
    // the salon's calendar, so the SOFT availability gate (weekly hours,
    // service assignments, buffers, location hours) must not block them.
    // Hard double-book protection still applies: lockTechnicianAndAssertSlotFree
    // and the active-slot unique index reject a genuine overlap with an
    // active CRM appointment.
    const bypassAvailabilityGate = Boolean(googleReviewEvent);

    if (normalizedBaseServiceId) {
      candidateTechnicians = candidateTechnicians.filter(tech =>
        getPublicTechnicianCompatibility({
          selectionMode: 'base-service',
          technician: tech,
          requestedServices: services,
        }).bookable,
      );
    }

    if (candidateTechnicians.length === 0) {
      return Response.json(
        {
          error: {
            code: 'NO_AVAILABLE_TECHNICIAN',
            message: 'No technicians are available at this time. Please select a different time slot.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    const capabilityMode = normalizedBaseServiceId
      ? 'service_assignments'
      : resolveTechnicianCapabilityMode(candidateTechnicians, services);

    const initialPolicy = await loadBookingPolicy({
      salonId: salon.id,
      technicianIds: candidateTechnicians.map(tech => tech.id),
      date: bookingDate,
      selectedDate: bookingStartOfDay,
      startOfDay: bookingStartOfDay,
      endOfDay: bookingEndOfDay,
      excludedAppointmentId: normalizedOriginalApptId,
    });

    // Smart Fit (P7.2) — request-level applicability. Campaign bookings keep
    // strict precedence (campaign > reward > first_visit > smart_fit),
    // Google-event conversions bypass all availability logic, and the whole
    // service basket must be in the configured scope.
    const smartFitScopeAllowed = smartFitConfig.enabled
      && !normalizedCampaignToken
      && !bypassAvailabilityGate
      && subtotalBeforeDiscountCents > 0
      && smartFitServiceScopeAllows(smartFitConfig, services.map(service => service.id));

    // Day-wide Google busy windows, fetched ONCE and reused by the technician
    // pick, the Google conflict check, and the in-transaction revalidation.
    // Same fail-closed semantics as the existing per-window check below.
    let smartFitGoogleBusyWindows: GoogleCalendarBusyWindow[] | null = null;
    if (smartFitScopeAllowed) {
      try {
        smartFitGoogleBusyWindows = await getGoogleCalendarBusyWindows({
          salonId: salon.id,
          startTime: bookingStartOfDay,
          endTime: bookingEndOfDay,
          timeZone: bookingConfig.timezone,
          excludeAppointmentId: authorizedRescheduleAppointmentId,
        });
      } catch (error) {
        const reconnectRequired = error instanceof GoogleCalendarAvailabilityError
          && error.reconnectRequired;
        console.error('[GoogleCalendar] Availability check failed before booking:', error);
        return Response.json(
          {
            error: {
              code: 'CALENDAR_UNAVAILABLE',
              message: reconnectRequired
                ? 'Unable to confirm this booking while the salon restores its calendar connection. Please try again later.'
                : 'Unable to confirm calendar availability. Please try again shortly.',
            },
          } satisfies ErrorResponse,
          { status: 503 },
        );
      }
    }

    const smartFitVisibleDurationMinutes = totalDurationMinutes;
    // Derive the buffer from the blocked window so the evaluator sees exactly
    // the window the conflict guards enforce.
    const smartFitBufferMinutes = Math.max(0, blockedDurationMinutes - totalDurationMinutes);

    const buildSmartFitCandidate = (clientKeys: string[] | undefined) => ({
      startMs: startTime.getTime(),
      visibleDurationMinutes: smartFitVisibleDurationMinutes,
      bufferMinutes: smartFitBufferMinutes,
      serviceId: services[0]?.id ?? '',
      technicianId: normalizedTechnicianId,
      locationId: validatedLocationId,
      clientKeys,
      excludeAppointmentId: normalizedOriginalApptId,
    });

    const buildSmartFitDayContextForTech = (args: {
      tech: (typeof candidateTechnicians)[number];
      policy: LoadedBookingPolicy;
      appointments?: Parameters<typeof buildSmartFitDayContext>[0]['appointments'];
      nowMs: number;
    }) => buildSmartFitDayContext({
      technicianId: args.tech.id,
      weeklySchedule: args.tech.weeklySchedule as WeeklySchedule | null,
      override: args.policy.overridesByTechnician.get(args.tech.id) ?? null,
      isOnTimeOff: args.policy.timeOffTechnicianIds.has(args.tech.id),
      appointments: args.appointments ?? args.policy.appointmentsByTechnician.get(args.tech.id) ?? [],
      blockedSlots: args.policy.blockedSlotsByTechnician.get(args.tech.id) ?? [],
      googleBusyWindows: smartFitGoogleBusyWindows ?? [],
      locationId: validatedLocationId,
      locationBusinessHours: validatedLocation?.businessHours ?? null,
      date: bookingDate,
      timeZone: bookingConfig.timezone,
      slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
      gridAnchorMs: bookingStartOfDay.getTime(),
      nowMs: args.nowMs,
    });

    // Identity known pre-transaction: the booking phone. The in-transaction
    // recompute adds the resolved salonClientId key as well.
    const smartFitPreTxClientKeys = buildSmartFitClientKeys({ clientPhone: normalizedPhone });

    // 'any'-technician resolution. With Smart Fit enabled the pick prefers the
    // first AVAILABLE technician for whom this slot is a qualifying tight fit,
    // falling back to the existing first-available behavior — the one place
    // Smart Fit actively packs schedules (approved P6). Disabled salons keep
    // the original first-fit expression untouched.
    const pickAnyAvailableTechnician = (policy: LoadedBookingPolicy) => {
      const isAvailable = (tech: (typeof candidateTechnicians)[number]): boolean => {
        const decision = canTechnicianTakeAppointment({
          startTime,
          endTime: blockedEndTime,
          weeklySchedule: tech.weeklySchedule as WeeklySchedule | null,
          override: policy.overridesByTechnician.get(tech.id),
          isOnTimeOff: policy.timeOffTechnicianIds.has(tech.id),
          blockedSlots: policy.blockedSlotsByTechnician.get(tech.id) ?? [],
          requestedServices: services,
          capabilityMode,
          enabledServiceIds: tech.enabledServiceIds ?? [],
          specialties: tech.specialties ?? [],
          locationId: validatedLocationId,
          primaryLocationId: tech.primaryLocationId ?? null,
          locationBusinessHours: validatedLocation?.businessHours ?? null,
          existingAppointments: policy.appointmentsByTechnician.get(tech.id) ?? [],
          excludedAppointmentId: normalizedOriginalApptId,
          bufferMinutes: 0,
        });

        return decision.available;
      };

      if (!smartFitScopeAllowed || smartFitGoogleBusyWindows === null) {
        return candidateTechnicians.find(isAvailable) ?? null;
      }

      const availableTechnicians = candidateTechnicians.filter(isAvailable);
      const qualifying = availableTechnicians.find((tech) => {
        const dayContext = buildSmartFitDayContextForTech({
          tech,
          policy,
          nowMs: now.getTime(),
        });
        if (!dayContext) {
          return false;
        }
        return evaluateSmartFitSlot({
          config: smartFitConfig,
          candidate: buildSmartFitCandidate(
            smartFitPreTxClientKeys.length > 0 ? smartFitPreTxClientKeys : undefined,
          ),
          day: dayContext,
        }).eligible;
      });

      return qualifying ?? availableTechnicians[0] ?? null;
    };

    if (technician) {
      const decision = bypassAvailabilityGate
        ? null
        : canTechnicianTakeAppointment({
          startTime,
          endTime: blockedEndTime,
          weeklySchedule: technician.weeklySchedule as WeeklySchedule | null,
          override: initialPolicy.overridesByTechnician.get(technician.id),
          isOnTimeOff: initialPolicy.timeOffTechnicianIds.has(technician.id),
          blockedSlots: initialPolicy.blockedSlotsByTechnician.get(technician.id) ?? [],
          requestedServices: services,
          capabilityMode,
          enabledServiceIds: technician.enabledServiceIds ?? [],
          specialties: technician.specialties ?? [],
          locationId: validatedLocationId,
          primaryLocationId: technician.primaryLocationId ?? null,
          locationBusinessHours: validatedLocation?.businessHours ?? null,
          existingAppointments: initialPolicy.appointmentsByTechnician.get(technician.id) ?? [],
          excludedAppointmentId: normalizedOriginalApptId,
          bufferMinutes: 0,
        });

      if (decision && !decision.available) {
        const message = decision.reason === 'time_conflict'
          ? 'This time slot is no longer available. Please select a different time.'
          : 'Selected technician is unavailable at this time. Please choose another slot.';

        return Response.json(
          {
            error: {
              code: decision.reason === 'time_conflict' ? 'TIME_CONFLICT' : 'OUTSIDE_SCHEDULE',
              message,
            },
          } satisfies ErrorResponse,
          { status: decision.reason === 'time_conflict' ? 409 : 400 },
        );
      }
    } else if (bypassAvailabilityGate) {
      // Conversion without an explicit technician: assign the salon's
      // primary technician instead of failing the whole import. The admin
      // can reassign afterwards from the appointment sheet.
      technician = candidateTechnicians[0] ?? null;

      if (!technician) {
        return Response.json(
          {
            error: {
              code: 'NO_AVAILABLE_TECHNICIAN',
              message: 'Add a technician to the salon before converting Google events.',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }
    } else {
      technician = pickAnyAvailableTechnician(initialPolicy);

      if (!technician) {
        return Response.json(
          {
            error: {
              code: 'NO_AVAILABLE_TECHNICIAN',
              message: 'No technicians are available at this time. Please select a different time slot.',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }
    }

    // 7. ATOMIC LOCK OWNERSHIP CHECK: Before any writes, verify we still own the lock
    // Uses Lua script to atomically check ownership AND extend TTL in one operation
    // This prevents the race: GET token → TTL expires → another acquires → both proceed
    if (idempotencyEnabled && ownsLock && lockKey && lockOwnerToken && redis) {
      try {
        // Atomic: if we own the lock, extend TTL and return 1; else return 0
        const stillOwner = await redis.eval(
          EXTEND_IF_OWNER_LUA,
          1, // number of keys
          lockKey,
          lockOwnerToken,
          String(BOOKING_LOCK_MS), // extend by full TTL
        );

        if (stillOwner !== 1) {
          // Lock expired or was taken - we no longer own it
          ownsLock = false;

          // Check if a cached result appeared (winner may have completed)
          if (idempotencyCacheKey) {
            const cachedResult = await redis.get(idempotencyCacheKey);
            if (cachedResult) {
              const parsed = JSON.parse(cachedResult);
              // Validate payload hash before returning cached result
              if (parsed.payloadHash && parsed.payloadHash !== requestBodyHash) {
                return Response.json(
                  {
                    error: {
                      code: 'IDEMPOTENCY_KEY_REUSE',
                      message: 'This idempotency key was already used with a different request payload',
                    },
                  } satisfies ErrorResponse,
                  { status: 409 },
                );
              }
              return Response.json(
                {
                  ...parsed.responseBody,
                  meta: { ...parsed.responseBody.meta, cached: true },
                },
                { status: parsed.statusCode },
              );
            }
          }
          // No cached result - return 409 so client can retry
          return Response.json(
            {
              error: {
                code: 'BOOKING_IN_PROGRESS',
                message: 'Lock expired during processing. Please retry your booking.',
              },
            } satisfies ErrorResponse,
            { status: 409 },
          );
        }
        // stillOwner === 1: we still own the lock, proceed with insert
      } catch (lockCheckError) {
        // Lua script or Redis failed - FAIL OPEN (disable idempotency, proceed with booking)
        // Rationale: booking availability is more important than double-submit prevention
        console.error('[Idempotency] Lock ownership check failed, disabling idempotency:', {
          lockKey,
          error: lockCheckError instanceof Error ? lockCheckError.message : String(lockCheckError),
        });
        // Disable ALL idempotency for this request - no cache read/write, no lock checks
        idempotencyEnabled = false;
        ownsLock = false;
        idempotencyCacheKey = null;
        lockKey = null;
        lockOwnerToken = null;
      }
    }

    // 7b. GUARD: If idempotency is enabled, we MUST own the lock to proceed with insert
    // This is a hard invariant - if we don't own the lock, someone else is processing
    if (idempotencyEnabled && !ownsLock) {
      // This should be unreachable (loser path returns above), but enforce anyway
      return Response.json(
        {
          error: {
            code: 'BOOKING_IN_PROGRESS',
            message: 'Another request is processing this booking. Please retry.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    const finalPolicy = await loadBookingPolicy({
      salonId: salon.id,
      technicianIds: candidateTechnicians.map(tech => tech.id),
      date: bookingDate,
      selectedDate: bookingStartOfDay,
      startOfDay: bookingStartOfDay,
      endOfDay: bookingEndOfDay,
      excludedAppointmentId: normalizedOriginalApptId,
    });

    // Conversions keep the technician resolved in the initial pass — the
    // soft-availability re-check below is for client-facing bookings only.
    if (!normalizedTechnicianId && !bypassAvailabilityGate) {
      technician = pickAnyAvailableTechnician(finalPolicy);
    }

    if (!technician) {
      return Response.json(
        {
          error: {
            code: 'NO_AVAILABLE_TECHNICIAN',
            message: 'No technicians are available at this time. Please select a different time slot.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    if (!bypassAvailabilityGate) {
      const finalDecision = canTechnicianTakeAppointment({
        startTime,
        endTime: blockedEndTime,
        weeklySchedule: technician.weeklySchedule as WeeklySchedule | null,
        override: finalPolicy.overridesByTechnician.get(technician.id),
        isOnTimeOff: finalPolicy.timeOffTechnicianIds.has(technician.id),
        blockedSlots: finalPolicy.blockedSlotsByTechnician.get(technician.id) ?? [],
        requestedServices: services,
        capabilityMode,
        enabledServiceIds: technician.enabledServiceIds ?? [],
        specialties: technician.specialties ?? [],
        locationId: validatedLocationId,
        primaryLocationId: technician.primaryLocationId ?? null,
        locationBusinessHours: validatedLocation?.businessHours ?? null,
        existingAppointments: finalPolicy.appointmentsByTechnician.get(technician.id) ?? [],
        excludedAppointmentId: normalizedOriginalApptId,
        bufferMinutes: 0,
      });

      if (!finalDecision.available) {
        const requestedSpecificTechnician = Boolean(normalizedTechnicianId);
        const errorCode = finalDecision.reason === 'time_conflict'
          ? 'TIME_CONFLICT'
          : requestedSpecificTechnician
            ? 'OUTSIDE_SCHEDULE'
            : 'NO_AVAILABLE_TECHNICIAN';
        const status = finalDecision.reason === 'time_conflict'
          ? 409
          : requestedSpecificTechnician
            ? 400
            : 409;

        return Response.json(
          {
            error: {
              code: errorCode,
              message: finalDecision.reason === 'time_conflict'
                ? 'This time slot is no longer available. Please select a different time.'
                : 'Selected technician is unavailable at this time. Please choose another slot.',
            },
          } satisfies ErrorResponse,
          { status },
        );
      }
    }

    try {
      // Conversions intentionally skip BOTH Google-overlap checks: the event
      // being imported already coexists with its neighbours on the salon's
      // calendar (back-to-back bookings, duplicate rows from re-syncs, or a
      // second synced calendar), so another busy Google row must not block
      // the import. Only a genuine overlap with an active CRM appointment
      // blocks, via lockTechnicianAndAssertSlotFree in the transaction below.
      // When Smart Fit already fetched the day's busy windows, reuse them for
      // the same overlap decision instead of a second freeBusy call.
      const googleCalendarConflict = googleReviewEvent
        ? false
        : smartFitGoogleBusyWindows !== null
          ? isBusyWindowConflict(startTime, blockedEndTime, smartFitGoogleBusyWindows)
          : await hasGoogleCalendarConflict({
            salonId: salon.id,
            startTime,
            endTime: blockedEndTime,
            timeZone: bookingConfig.timezone,
            excludeAppointmentId: authorizedRescheduleAppointmentId,
          });

      if (googleCalendarConflict) {
        return Response.json(
          {
            error: {
              code: 'TIME_CONFLICT',
              message: 'This time slot is no longer available. Please select a different time.',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }
    } catch (error) {
      const reconnectRequired = error instanceof GoogleCalendarAvailabilityError
        && error.reconnectRequired;
      console.error('[GoogleCalendar] Availability check failed before booking:', error);
      return Response.json(
        {
          error: {
            code: 'CALENDAR_UNAVAILABLE',
            message: reconnectRequired
              ? 'Unable to confirm this booking while the salon restores its calendar connection. Please try again later.'
              : 'Unable to confirm calendar availability. Please try again shortly.',
          },
        } satisfies ErrorResponse,
        { status: 503 },
      );
    }

    if (retentionCampaign) {
      const campaignDiscount = calculateRetentionDiscount({
        promotion: retentionCampaign.promotionSnapshot,
        services: services.map(service => ({ id: service.id, priceCents: service.price })),
      });
      if (campaignDiscount.discountAmountCents <= 0) {
        return campaignFailureResponse('NO_ELIGIBLE_SERVICE');
      }

      // Retention promotions do not stack with rewards or the first-visit
      // offer. A reward remains active for a later visit instead of being
      // consumed silently by this booking.
      appliedReward = null;
      discountAmountCents = campaignDiscount.discountAmountCents;
      totalPrice = Math.max(0, subtotalBeforeDiscountCents - discountAmountCents);
      appointmentDiscountType = `retention_${retentionCampaign.stage}`;
      appointmentDiscountLabel = retentionCampaign.promotionSnapshot.name;
      appointmentDiscountPercent = retentionCampaign.promotionSnapshot.discountType === 'percent'
        ? retentionCampaign.promotionSnapshot.value
        : null;
      discountAppliedAt = new Date();
    }

    // Smart Fit (P7.2) — authoritative in-transaction pricing finalization.
    // Runs after `lockTechnicianAndAssertSlotFree` in both transaction
    // branches. Order: fresh tx-scoped day windows → evaluator → existing
    // automatic-discount resolver → overlay (strict precedence, no stacking)
    // → expectation guard. When Smart Fit is disabled the pre-transaction
    // pricing stands untouched and only the expectation guard runs (and only
    // if the caller sent expectations).
    const smartFitExpectationProvided = data.expectedTotalCents !== undefined
      || data.expectedDiscountType !== undefined;
    const normalizedExpectedDiscountType = data.expectedDiscountType === undefined
      ? undefined
      : (data.expectedDiscountType?.trim() || null);
    let smartFitGrantEvaluation: SmartFitEvaluation | null = null;

    type LockedBookingFinancialConfiguration = {
      settings: SalonSettings | null;
      features: SalonFeatures | null;
      requiredPolicy: RequiredBookingPolicy | null;
      taxConfig: ReturnType<typeof resolveTaxConfig>;
      invoiceCurrency: string;
      capturedAt: Date;
    };

    const buildCurrentBookingTaxSnapshot = (
      configuration: LockedBookingFinancialConfiguration,
    ) => buildBookingTaxSnapshot({
      taxConfig: configuration.taxConfig,
      totals: computeCheckoutTotals({
        items: [
          {
            lineTotalCents: basePriceCents,
            taxable: configuration.taxConfig.taxServicesByDefault,
          },
          {
            lineTotalCents: addOnsPriceCents,
            taxable: configuration.taxConfig.taxAddOnsByDefault,
          },
        ],
        discountCents: discountAmountCents,
        taxConfig: configuration.taxConfig,
        tipCents: 0,
      }),
      capturedAt: configuration.capturedAt,
      currency: configuration.invoiceCurrency,
    });

    const assertCurrentBookingFinancialQuote = (
      configuration: LockedBookingFinancialConfiguration,
    ) => {
      const snapshot = buildCurrentBookingTaxSnapshot(configuration);
      const currentQuote = {
        currency: snapshot.currency,
        totalDueCents: snapshot.invoiceTotalCents,
        taxConfigurationIdentity: snapshot.configuration.configurationIdentity,
      };
      const expected = data.expectedBookingFinancialQuote;
      if (
        expected
        && (
          expected.currency !== currentQuote.currency
          || expected.totalDueCents !== currentQuote.totalDueCents
          || expected.taxConfigurationIdentity !== currentQuote.taxConfigurationIdentity
        )
      ) {
        throw new BookingFinancialQuoteChangedError(currentQuote);
      }
      return snapshot;
    };

    type BookingTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

    const lockAndResolveRequiredBookingPolicyInTx = async (
      tx: BookingTx,
    ): Promise<LockedBookingFinancialConfiguration> => {
      // Lock order for this route is:
      //   salon-client identity -> salon policy row -> technician advisory lock
      //   -> appointment/children.
      // Settings and entitlement writers lock only the salon row. Salon purge
      // deletes children before the salon row. No audited writer takes a
      // technician/client lock after first taking the salon row, so this short
      // transaction-local SHARE lock does not invert an existing order.
      //
      // Bound only the salon-policy wait. Resetting to 0 after acquisition
      // leaves the route's established client/technician lock behavior intact.
      await tx.execute(sql`set local lock_timeout = '3s'`);
      await tx.execute(sql`
        SELECT ${salonSchema.id}
        FROM ${salonSchema}
        WHERE ${salonSchema.id} = ${salon.id}
        FOR SHARE
      `);
      const [lockedSalon] = await tx
        .select({
          plan: salonSchema.plan,
          features: salonSchema.features,
          settings: salonSchema.settings,
        })
        .from(salonSchema)
        .where(eq(salonSchema.id, salon.id))
        .limit(1);
      await tx.execute(sql`set local lock_timeout = '0'`);

      if (!lockedSalon) {
        throw new Error('SALON_NOT_FOUND_DURING_BOOKING');
      }
      const settings
        = (lockedSalon.settings as SalonSettings | null | undefined) ?? null;
      const features
        = (lockedSalon.features as SalonFeatures | null | undefined) ?? null;
      const capturedAt = new Date();
      return {
        settings,
        features,
        requiredPolicy: isNewPublicBooking
          ? resolveRequiredBookingPolicy({
            storedPlan: lockedSalon.plan,
            features,
            settings,
          })
          : null,
        taxConfig: resolveTaxConfig(settings, capturedAt),
        invoiceCurrency: resolveBookingConfigFromSettings(settings)
          .currency
          .trim()
          .toUpperCase(),
        capturedAt,
      };
    };

    const assertCurrentBookingPolicyAcknowledgment = (
      policy: RequiredBookingPolicy | null,
    ): RequiredBookingPolicy | null => {
      if (!policy) {
        return null;
      }
      if (
        !requestedPolicyAcknowledgment
        || requestedPolicyAcknowledgment.accepted !== true
      ) {
        throw new BookingPolicyAcknowledgmentRequiredError(policy);
      }
      if (requestedPolicyAcknowledgment.version !== policy.version) {
        throw new BookingPolicyChangedError(policy);
      }
      return policy;
    };

    const finalizeBookingPricingInTx = async (
      tx: BookingTx,
      salonClient: Pick<OperationalSalonClientContact, 'id' | 'phone'>,
    ): Promise<void> => {
      const lockedTechnician = technician;
      smartFitGrantEvaluation = null;

      // A preserved discount is authoritative: re-evaluating the new slot here
      // is exactly the divergence this policy exists to prevent. Re-apply it so
      // the transaction-final pricing matches what the customer was shown.
      if (preservesCommittedSmartFit) {
        applyPreservedSmartFit();
      }

      if (!preservesCommittedSmartFit && smartFitScopeAllowed && smartFitGoogleBusyWindows !== null && lockedTechnician) {
        const freshWindowConditions = [
          eq(appointmentSchema.salonId, salon.id),
          eq(appointmentSchema.technicianId, lockedTechnician.id),
          gte(appointmentSchema.startTime, bookingStartOfDay),
          lt(appointmentSchema.startTime, bookingEndOfDay),
          inArray(appointmentSchema.status, [...BLOCKING_APPOINTMENT_STATUSES]),
        ];
        if (normalizedOriginalApptId) {
          freshWindowConditions.push(ne(appointmentSchema.id, normalizedOriginalApptId));
        }
        const freshDayWindows = await tx
          .select({
            id: appointmentSchema.id,
            startTime: appointmentSchema.startTime,
            endTime: appointmentSchema.endTime,
            blockedDurationMinutes: appointmentSchema.blockedDurationMinutes,
            totalDurationMinutes: appointmentSchema.totalDurationMinutes,
            bufferMinutes: appointmentSchema.bufferMinutes,
            status: appointmentSchema.status,
            salonClientId: appointmentSchema.salonClientId,
            clientPhone: appointmentSchema.clientPhone,
          })
          .from(appointmentSchema)
          .where(and(...freshWindowConditions));

        const dayContext = buildSmartFitDayContextForTech({
          tech: lockedTechnician,
          policy: finalPolicy,
          appointments: freshDayWindows,
          nowMs: Date.now(),
        });

        const finalClientKeys = Array.from(new Set([
          ...buildSmartFitClientKeys({
            salonClientId: salonClient.id,
            clientPhone: salonClient.phone,
          }),
          ...smartFitPreTxClientKeys,
        ]));

        const evaluation = dayContext
          ? evaluateSmartFitSlot({
            config: smartFitConfig,
            candidate: buildSmartFitCandidate(
              finalClientKeys.length > 0 ? finalClientKeys : undefined,
            ),
            day: dayContext,
          })
          : null;

        // Overlay base = this request's automatic-discount resolution (the
        // existing :automaticDiscount call site) — the same freshness model
        // reward/first-visit writes already have. The resolver cannot be
        // re-run here: it reads through the global db handle, which inside
        // this transaction would deadlock the single-connection PGlite
        // driver (dev server and tests), and P7.2 forbids modifying its
        // internals to accept a transaction. Only the schedule state (the
        // input that concurrent bookings actually change) is re-read
        // transaction-scoped above.
        const finalDiscount = applySmartFitOverlay({
          base: automaticDiscount,
          config: smartFitConfig,
          evaluation,
          appliedAt: new Date(),
        });

        totalPrice = finalDiscount.finalTotalCents;
        discountAmountCents = finalDiscount.discountAmountCents;
        switch (finalDiscount.kind) {
          case 'reward':
            appliedReward = finalDiscount.reward;
            appointmentDiscountType = 'reward';
            appointmentDiscountLabel = 'Reward applied';
            appointmentDiscountPercent = null;
            discountAppliedAt = new Date();
            break;
          case 'first_visit':
            appliedReward = null;
            appointmentDiscountType = finalDiscount.firstVisit.discountType;
            appointmentDiscountLabel = finalDiscount.firstVisit.discountLabel;
            appointmentDiscountPercent = finalDiscount.firstVisit.discountPercent;
            discountAppliedAt = finalDiscount.firstVisit.discountAppliedAt;
            break;
          case 'smart_fit':
            appliedReward = null;
            appointmentDiscountType = SMART_FIT_DISCOUNT_TYPE;
            appointmentDiscountLabel = SMART_FIT_DISCOUNT_LABEL;
            appointmentDiscountPercent = finalDiscount.smartFit.discountPercent;
            discountAppliedAt = finalDiscount.smartFit.discountAppliedAt;
            smartFitGrantEvaluation = finalDiscount.smartFit.evaluation;
            break;
          default:
            appliedReward = null;
            appointmentDiscountType = null;
            appointmentDiscountLabel = null;
            appointmentDiscountPercent = null;
            discountAppliedAt = null;
            break;
        }
      }

      if (smartFitExpectationProvided) {
        const totalMismatch = data.expectedTotalCents !== undefined
          && data.expectedTotalCents !== totalPrice;
        const typeMismatch = normalizedExpectedDiscountType !== undefined
          && normalizedExpectedDiscountType !== (appointmentDiscountType ?? null);
        if (totalMismatch || typeMismatch) {
          throw new SmartFitStaleError({
            subtotalBeforeDiscountCents,
            discountAmountCents,
            discountType: appointmentDiscountType,
            discountLabel: appointmentDiscountLabel,
            finalTotalCents: totalPrice,
          });
        }
      }
    };

    const insertSmartFitAuditRowInTx = async (tx: BookingTx, createdAppointmentId: string): Promise<void> => {
      const grantedEvaluation = smartFitGrantEvaluation;
      const lockedTechnician = technician;
      if (!grantedEvaluation || appointmentDiscountType !== SMART_FIT_DISCOUNT_TYPE || !lockedTechnician) {
        return;
      }
      await tx.insert(appointmentAuditLogSchema).values(buildAppointmentAuditRow({
        appointmentId: createdAppointmentId,
        salonId: salon.id,
        action: 'discount_applied',
        performedBy: 'system',
        performedByRole: 'system',
        newValue: {
          type: SMART_FIT_DISCOUNT_TYPE,
          discountType: smartFitConfig.discountType,
          value: smartFitConfig.value,
          discountAmountCents,
          technicianId: lockedTechnician.id,
          remainingGapMinutes: grantedEvaluation.remainingGapMinutes,
          improvementMinutes: grantedEvaluation.improvementMinutes,
          consolidatedMinutes: grantedEvaluation.consolidatedMinutes,
          qualifyingSides: grantedEvaluation.qualifyingSides,
          maxRemainingGapMinutes: smartFitConfig.maxRemainingGapMinutes,
          minImprovementMinutes: smartFitConfig.minImprovementMinutes,
        },
      }));
    };

    // 7c. Generate appointment ID
    const appointmentId = `appt_${crypto.randomUUID()}`;
    const managementCapability = createOpaqueToken();

    const pricingBeforeTransaction = {
      appliedReward,
      appointmentDiscountLabel,
      appointmentDiscountPercent,
      appointmentDiscountType,
      discountAmountCents,
      discountAppliedAt,
      totalPrice,
    };
    const resetTransactionPricing = () => {
      appliedReward = pricingBeforeTransaction.appliedReward;
      appointmentDiscountLabel = pricingBeforeTransaction.appointmentDiscountLabel;
      appointmentDiscountPercent = pricingBeforeTransaction.appointmentDiscountPercent;
      appointmentDiscountType = pricingBeforeTransaction.appointmentDiscountType;
      discountAmountCents = pricingBeforeTransaction.discountAmountCents;
      discountAppliedAt = pricingBeforeTransaction.discountAppliedAt;
      totalPrice = pricingBeforeTransaction.totalPrice;
      smartFitGrantEvaluation = null;
    };

    const resolveBookingSalonClientInTx = async (
      tx: BookingTx,
      expectedTerminalClientId: string | null,
    ): Promise<OperationalSalonClientContact> => {
      if (expectedTerminalClientId) {
        const lockedClient = await lockOperationalSalonClientContactWithHandle(
          tx as LifecycleSqlHandle,
          {
            salonId: salon.id,
            clientId: expectedTerminalClientId,
          },
        );
        const authoritativeIdentity
          = await resolveCanonicalSalonClientIdentityWithHandle(
            tx as LifecycleSqlHandle,
            {
              salonId: salon.id,
              phone: normalizedPhone,
              email: normalizedClientEmail,
            },
          );
        if (
          authoritativeIdentity
          && authoritativeIdentity.terminal.id !== lockedClient.id
        ) {
          throw new BookingClientConflictError();
        }
        if (!authoritativeIdentity && !originalOperationalClient) {
          throw new BookingClientConflictError();
        }
        if (
          actorRole === 'client'
          && clientAuth?.ok
          && clientAuth.normalizedPhone !== lockedClient.phone
        ) {
          throw new BookingClientConflictError();
        }
        return lockedClient;
      }

      await lockSalonClientIdentityKeysWithHandle(
        tx as LifecycleSqlHandle,
        {
          salonId: salon.id,
          phone: normalizedPhone,
          email: normalizedClientEmail,
        },
      );
      const appearedIdentity = await resolveCanonicalSalonClientIdentityWithHandle(
        tx as LifecycleSqlHandle,
        {
          salonId: salon.id,
          phone: normalizedPhone,
          email: normalizedClientEmail,
        },
      );
      if (appearedIdentity) {
        throw new BookingIdentityAppearedError();
      }

      const [createdClient] = await tx
        .insert(salonClientSchema)
        .values({
          id: `sc_${crypto.randomUUID()}`,
          salonId: salon.id,
          phone: normalizedPhone,
          fullName: clientName ?? undefined,
          email: normalizedClientEmail,
        })
        .onConflictDoNothing()
        .returning();
      if (!createdClient) {
        throw new BookingIdentityAppearedError();
      }

      return {
        id: createdClient.id,
        salonId: createdClient.salonId,
        archivedAt: createdClient.archivedAt,
        redirectedFromClientId: null,
        lineagePath: [createdClient.id],
        phone: createdClient.phone,
        email: createdClient.email,
      };
    };

    const runSerializedBookingTransaction = async <T>(
      operation: (
        tx: BookingTx,
        salonClient: OperationalSalonClientContact,
      ) => Promise<T>,
    ): Promise<T> => {
      let expectedTerminalClientId = originalOperationalClient?.id
        ?? preliminaryCanonicalIdentity?.terminal.id
        ?? null;

      for (let identityAttempt = 0; identityAttempt < 2; identityAttempt += 1) {
        try {
          return await withClientLifecycleTransactionRetry(async () => {
            resetTransactionPricing();
            return db.transaction(async (tx) => {
              const salonClient = await resolveBookingSalonClientInTx(
                tx,
                expectedTerminalClientId,
              );
              return operation(tx, salonClient);
            });
          });
        } catch (error) {
          if (!(error instanceof BookingIdentityAppearedError)) {
            throw error;
          }
          const refreshedIdentity = await resolveCanonicalSalonClientIdentity({
            salonId: salon.id,
            phone: normalizedPhone,
            email: normalizedClientEmail,
          });
          if (!refreshedIdentity) {
            throw new BookingClientConflictError();
          }
          expectedTerminalClientId = refreshedIdentity.terminal.id;
        }
      }

      throw new BookingClientConflictError();
    };

    // =========================================================================
    // DEPOSITS — E.0a (scope predicate) and E.0b (readiness proof)
    //
    // BOTH are strictly PRE-TRANSACTION, and E.0b is hoisted ABOVE
    // runSerializedBookingTransaction rather than merely "before the
    // transaction". That runner is a retry loop nested inside a 2-iteration
    // identity loop: a retrieve placed inside it re-issues per attempt, and the
    // required "exactly one accounts.retrieve per deposit booking" test would
    // then FLAKE instead of failing — the worst possible shape for a money-path
    // test.
    // =========================================================================

    // Read from the ZOD-VALIDATED object, never the raw JSON body: the raw body
    // could carry a non-string or an over-long token straight into the parser,
    // bypassing the z.string().max(64) cap.
    const disclosedDepositCents = parseDepositDisclosureFingerprint(
      data.expectedDepositFingerprint ?? null,
    );
    // NOTE the asymmetry with E.3, and do not "unify" it: Step 0 asks *"was a
    // deposit disclosed at all?"*, so a null parse (absent, malformed, wrong
    // version) means NO and SKIPS. E.3 asks *"does the disclosure match?"*,
    // where a null parse is a HARD MISMATCH. Both are correct.
    const depositWasDisclosed = disclosedDepositCents !== null && disclosedDepositCents > 0;

    type DepositBranchContext = {
      accountSnapshot: DepositAccountSnapshot;
      stripeAccountId: string;
    };
    let depositBranch: DepositBranchContext | null = null;
    // Set when the policy resolves ACTIVE but this request is outside the charge
    // predicate, so the 201 must still carry `deposit: { required:false }`.
    let respondDepositNotRequired = false;

    // The scope read is issued for a public booking, and additionally for any
    // request that carried a fingerprint (i.e. came from the public confirm
    // page). An owner-entered phone booking or a walk-in never sends the field,
    // so the admin surfaces keep exactly today's query profile.
    if (isNewPublicBooking || data.expectedDepositFingerprint !== undefined) {
      const depositScopeRead = await getDepositPolicyForSalon({
        salonId: salon.id,
        salon,
      });

      if (!isNewPublicBooking) {
        // Outside the charge predicate BECAUSE OF THE ACTOR: an owner or staff
        // member booking from the public confirm page. The disclosure predicate
        // is WIDER than the charge predicate, so they were shown the deposit
        // statement and will never be charged; this object is the only
        // correction that screen ever receives, and it is never omitted when the
        // policy is active.
        //
        // A RESCHEDULE is excluded deliberately. It is outside the branch for a
        // different reason — a reschedule owes no deposit under ANY policy state
        // — and its client was never shown a new-booking deposit statement, so
        // there is nothing to correct. Emitting the object there would have the
        // manage/reschedule screens render a deposit line for a booking that has
        // no deposit semantics at all.
        respondDepositNotRequired = depositScopeRead.active && !normalizedOriginalApptId;
      } else {
        const decision: DepositScopeDecision = depositScopeRead.active
          ? 'enter'
          : classifyDepositScope(depositScopeRead.reason, depositWasDisclosed);

        if (decision === 'refuse_undetermined') {
          // R0. No refreshAccountReadiness call, no transaction opened, no
          // appointment row at all, no deposit row, no Stripe call.
          return depositsTemporarilyUnavailableResponse();
        }

        if (decision === 'enter') {
          // E.0b — the ONE Stripe call before the commit. It serves both the
          // gate and the snapshot; there is no second readiness read anywhere.
          let readiness: ReadinessDecision;
          try {
            readiness = await refreshAccountReadiness(salon.id);
          } catch {
            // R1: StripeConnectUnavailableError. Transaction never opened.
            return depositsTemporarilyUnavailableResponse();
          }
          if (!readiness.chargeReady || !readiness.binding) {
            // R1, fail closed. Reached by two distinct populations, kept
            // separate by the tests: the stale-stored-row race (stored says
            // ready, live says not), and every account-side-inactive salon on
            // which the client WAS shown a deposit.
            return depositsTemporarilyUnavailableResponse();
          }
          depositBranch = {
            // Immutable from here on. stripe_account_id is carried separately
            // because the snapshot type deliberately excludes it (it must never
            // reach a browser).
            accountSnapshot: {
              chargesEnabled: readiness.binding.chargesEnabled,
              revokedAt: readiness.binding.revokedAt,
              lastSyncedAt: readiness.binding.lastSyncedAt,
              livemode: readiness.binding.livemode,
            },
            stripeAccountId: readiness.binding.stripeAccountId,
          };
        }
      }
    }

    // Returned BY the committing attempt of the booking transaction rather than
    // assigned into from inside it: the runner retries the whole body, so a
    // closure-assigned plan can name a deposit row that was rolled back.
    let depositPlan: CommittedDepositPlan | null = null;

    let appointment: Appointment | null = null;
    let salonClient: OperationalSalonClientContact | null = null;
    let appointmentServices: AppointmentService[] = [];
    let appointmentAddOns: Array<{
      id: string | null;
      name: string;
      quantity: number;
      lineTotalCents: number;
      lineDurationMinutes: number;
    }> = [];

    if (originalAppointment && normalizedOriginalApptId) {
      try {
        const transactionalResult = await runSerializedBookingTransaction(
          async (tx, lockedSalonClient) => {
            const lockedBookingConfiguration
              = await lockAndResolveRequiredBookingPolicyInTx(tx);
            if (technician) {
              await lockTechnicianAndAssertSlotFree(tx, {
                salonId: salon.id,
                technicianId: technician.id,
                startTime,
                blockedEndTime,
                excludedAppointmentId: normalizedOriginalApptId,
              });
            }

            const [lockedOriginal] = await tx
              .select()
              .from(appointmentSchema)
              .where(and(
                eq(appointmentSchema.id, normalizedOriginalApptId),
                eq(appointmentSchema.salonId, salon.id),
              ))
              .for('update')
              .limit(1);
            if (
              !lockedOriginal
              || !['pending', 'confirmed'].includes(lockedOriginal.status)
            ) {
              throw new Error('RESCHEDULE_CONFLICT');
            }

            // The original is locked; now refuse to strand client money on it.
            // The shared predicate deliberately differs from salon purge for
            // canceled deposits, while retaining successful refunds for 30 days.
            const [liveDeposit] = await tx
              .select({ id: appointmentDepositSchema.id })
              .from(appointmentDepositSchema)
              .where(and(
                eq(appointmentDepositSchema.salonId, salon.id),
                eq(appointmentDepositSchema.appointmentId, normalizedOriginalApptId),
                isUnsettledForReschedule(),
              ))
              .limit(1);
            if (liveDeposit) {
              throw new RescheduleRequiresManageFlowError();
            }
            if (
              lockedOriginal.salonClientId !== originalAppointment.salonClientId
              || (
                originalOperationalClient
                && originalOperationalClient.id !== lockedSalonClient.id
              )
            ) {
              throw new BookingClientConflictError();
            }

            const competingAppointments
              = await getActiveAppointmentsForCanonicalClientWithHandle(
                tx as LifecycleSqlHandle,
                {
                  salonId: salon.id,
                  terminalClientId: lockedSalonClient.id,
                  horizon: 'lineage-active',
                  excludeAppointmentId: normalizedOriginalApptId,
                },
              );
            if (competingAppointments.length > 0) {
              throw new BookingActiveAppointmentError();
            }

            const originalMutationVersion = new Date(Math.max(
              Date.now(),
              lockedOriginal.updatedAt.getTime() + 1,
            ));
            const [cancelledOriginal] = await tx
              .update(appointmentSchema)
              .set({
                status: 'cancelled',
                cancelReason: 'rescheduled',
                // Keep the staff-facing canvas column in lockstep with the
                // legacy status column (the two-column invariant the state
                // machine documents). Without this the rescheduled-away row
                // would linger as a 'waiting' card on the staff board while
                // reading 'cancelled' everywhere else — the same sync the
                // cancel and transition routes already perform.
                canvasState: 'cancelled',
                canvasStateUpdatedAt: new Date(),
                updatedAt: originalMutationVersion,
              })
              .where(
                and(
                  eq(appointmentSchema.id, normalizedOriginalApptId),
                  eq(appointmentSchema.salonId, salon.id),
                  inArray(appointmentSchema.status, ['pending', 'confirmed']),
                ),
              )
              .returning();

            if (!cancelledOriginal) {
              throw new Error('RESCHEDULE_CONFLICT');
            }

            // Preserve the candidate-base terminal lifecycle behavior without
            // importing deferred reward machinery: an ordinary reward linked
            // to the rescheduled-away appointment is released by the same
            // transaction that cancels that appointment.
            const [linkedReward] = await tx
              .select()
              .from(rewardSchema)
              .where(and(
                eq(rewardSchema.usedInAppointmentId, cancelledOriginal.id),
                eq(rewardSchema.salonId, cancelledOriginal.salonId),
              ))
              .limit(1);

            if (linkedReward && linkedReward.status !== 'used') {
              await tx
                .update(rewardSchema)
                .set({
                  usedInAppointmentId: null,
                  status: 'active',
                })
                .where(and(
                  eq(rewardSchema.id, linkedReward.id),
                  eq(rewardSchema.salonId, cancelledOriginal.salonId),
                  eq(rewardSchema.usedInAppointmentId, cancelledOriginal.id),
                  ne(rewardSchema.status, 'used'),
                ));
            }

            await enqueueGoogleCalendarDeleteInTx(tx, {
              appointmentId: cancelledOriginal.id,
              salonId: cancelledOriginal.salonId,
              mutationVersion: cancelledOriginal.updatedAt,
              googleCalendarEventId: cancelledOriginal.googleCalendarEventId,
            });

            await finalizeBookingPricingInTx(tx, lockedSalonClient);
            const bookingTaxSnapshot
              = assertCurrentBookingFinancialQuote(lockedBookingConfiguration);

            const [createdAppointment] = await tx
              .insert(appointmentSchema)
              .values({
                id: appointmentId,
                salonId: salon.id,
                technicianId: technician?.id ?? null,
                locationId: validatedLocationId,
                clientPhone: lockedSalonClient.phone,
                clientName,
                clientEmail: normalizedClientEmail ?? originalAppointment.clientEmail,
                notes: normalizedNotes ?? originalAppointment.notes,
                salonClientId: lockedSalonClient.id,
                googleCalendarEventId: googleReviewEvent?.googleEventId ?? null,
                startTime,
                endTime,
                status: salon.freeSoloEnabled ? 'confirmed' : 'pending',
                invoiceCurrency: lockedBookingConfiguration.invoiceCurrency,
                bookingTaxSnapshot,
                totalPrice,
                totalDurationMinutes,
                basePriceCents,
                addOnsPriceCents,
                baseDurationMinutes,
                addOnsDurationMinutes,
                bufferMinutes,
                blockedDurationMinutes,
                subtotalBeforeDiscountCents,
                discountAmountCents,
                discountType: appointmentDiscountType,
                discountLabel: appointmentDiscountLabel,
                discountPercent: appointmentDiscountPercent,
                discountAppliedAt,
              })
              .returning();

            if (!createdAppointment) {
              throw new Error('FAILED_TO_CREATE_RESCHEDULE_APPOINTMENT');
            }

            await mintAppointmentManageCapability(tx, {
              salonId: salon.id,
              appointmentId: createdAppointment.id,
              appointmentEndTime: endTime,
              capability: managementCapability,
            });
            await tx.update(appointmentAccessTokenSchema)
              .set({ revokedAt: new Date() })
              .where(and(
                eq(appointmentAccessTokenSchema.salonId, salon.id),
                eq(appointmentAccessTokenSchema.appointmentId, normalizedOriginalApptId),
                isNull(appointmentAccessTokenSchema.revokedAt),
              ));

            await insertSmartFitAuditRowInTx(tx, createdAppointment.id);

            const insertedServices: AppointmentService[] = [];
            for (const service of services) {
              const [apptService] = await tx
                .insert(appointmentServicesSchema)
                .values({
                  id: `apptSvc_${crypto.randomUUID()}`,
                  appointmentId: createdAppointment.id,
                  serviceId: service.id,
                  priceAtBooking: service.price,
                  durationAtBooking: service.durationMinutes,
                  nameSnapshot: service.name,
                  categorySnapshot: service.category,
                  priceCentsSnapshot: service.price,
                  durationMinutesSnapshot: service.durationMinutes,
                  priceDisplayTextSnapshot: service.priceDisplayText ?? null,
                  resolvedIntroPriceLabelSnapshot: services.length === 1 ? resolvedIntroPriceLabel : null,
                })
                .returning();

              if (!apptService) {
                throw new Error('FAILED_TO_CREATE_RESCHEDULE_APPOINTMENT_SERVICE');
              }

              insertedServices.push(apptService);
            }

            const insertedAddOns: typeof appointmentAddOns = [];
            for (const addOn of selectedAddOnsForBooking) {
              await tx
                .insert(appointmentAddOnSchema)
                .values({
                  id: `apptAddon_${crypto.randomUUID()}`,
                  appointmentId: createdAppointment.id,
                  addOnId: addOn.addOnId,
                  quantitySnapshot: addOn.quantity,
                  nameSnapshot: addOn.name,
                  categorySnapshot: addOn.category,
                  pricingTypeSnapshot: addOn.pricingType,
                  unitPriceCentsSnapshot: addOn.unitPriceCents,
                  durationMinutesSnapshot: addOn.unitDurationMinutes,
                  lineTotalCentsSnapshot: addOn.lineTotalCents,
                  lineDurationMinutesSnapshot: addOn.lineDurationMinutes,
                });

              insertedAddOns.push({
                id: addOn.addOnId,
                name: addOn.name,
                quantity: addOn.quantity,
                lineTotalCents: addOn.lineTotalCents,
                lineDurationMinutes: addOn.lineDurationMinutes,
              });
            }

            if (!googleReviewEvent || googleReviewEvent.syncMode === 'bidirectional') {
              await enqueueGoogleCalendarAppointmentMutation(tx, {
                appointmentId: createdAppointment.id,
                salonId: createdAppointment.salonId,
                mutationVersion: createdAppointment.updatedAt,
              });
            }

            return {
              appointment: createdAppointment,
              appointmentServices: insertedServices,
              appointmentAddOns: insertedAddOns,
              salonClient: lockedSalonClient,
            };
          },
        );

        appointment = transactionalResult.appointment;
        appointmentServices = transactionalResult.appointmentServices;
        appointmentAddOns = transactionalResult.appointmentAddOns;
        salonClient = transactionalResult.salonClient;
      } catch (error) {
        if (error instanceof BookingActiveAppointmentError) {
          return bookingActiveAppointmentResponse(bookingSubjectMode);
        }
        if (error instanceof RescheduleRequiresManageFlowError) {
          return Response.json(
            {
              error: {
                code: 'DEPOSIT_LOCKED_RESCHEDULE',
                message: 'This appointment has unsettled deposit activity. Please use the manage link so the deposit stays attached.',
              },
            } satisfies ErrorResponse,
            { status: 409 },
          );
        }
        if (
          error instanceof BookingClientConflictError
          || error instanceof ClientLifecycleStabilizationError
        ) {
          return bookingClientConflictResponse();
        }
        if (error instanceof Error && error.message === 'RESCHEDULE_CONFLICT') {
          return Response.json(
            {
              error: {
                code: 'APPOINTMENT_NOT_ACTIVE',
                message: 'The original appointment could not be rescheduled because it is no longer active.',
              },
            } satisfies ErrorResponse,
            { status: 409 },
          );
        }

        if (error instanceof SmartFitStaleError) {
          return smartFitStaleResponse(error);
        }
        if (error instanceof BookingFinancialQuoteChangedError) {
          return bookingFinancialQuoteChangedResponse(error);
        }

        if (error instanceof SlotConflictError || isSlotConstraintViolation(error)) {
          return Response.json(
            {
              error: {
                code: 'TIME_CONFLICT',
                message: 'This time slot is no longer available. Please select a different time.',
              },
            } satisfies ErrorResponse,
            { status: 409 },
          );
        }

        throw error;
      }
    } else {
      try {
        const transactionalResult = await runSerializedBookingTransaction(
          async (tx, lockedSalonClient) => {
            const lockedBookingConfiguration
              = await lockAndResolveRequiredBookingPolicyInTx(tx);
            const currentRequiredPolicy
              = assertCurrentBookingPolicyAcknowledgment(
                lockedBookingConfiguration.requiredPolicy,
              );

            if (currentRequiredPolicy && requestedPolicyAcknowledgment) {
              const [existingAttempt] = await tx
                .select({
                  requestHash:
                    appointmentBookingPolicyAcknowledgmentSchema.requestHash,
                })
                .from(appointmentBookingPolicyAcknowledgmentSchema)
                .where(and(
                  eq(
                    appointmentBookingPolicyAcknowledgmentSchema.salonId,
                    salon.id,
                  ),
                  eq(
                    appointmentBookingPolicyAcknowledgmentSchema.source,
                    BOOKING_POLICY_ACKNOWLEDGMENT_SOURCE,
                  ),
                  eq(
                    appointmentBookingPolicyAcknowledgmentSchema.attemptId,
                    requestedPolicyAcknowledgment.attemptId,
                  ),
                ))
                .limit(1);
              if (
                existingAttempt
                && existingAttempt.requestHash !== requestBodyHash
              ) {
                throw new BookingPolicyAttemptReusedError();
              }
            }

            if (technician) {
            // Re-validate the slot against committed bookings while holding a
            // per-technician advisory lock, so two concurrent requests for the
            // same slot serialize here and exactly one succeeds.
              await lockTechnicianAndAssertSlotFree(tx, {
                salonId: salon.id,
                technicianId: technician.id,
                startTime,
                blockedEndTime,
              });
            }

            const competingAppointments
            = await getActiveAppointmentsForCanonicalClientWithHandle(
              tx as LifecycleSqlHandle,
              {
                salonId: salon.id,
                terminalClientId: lockedSalonClient.id,
                horizon: 'lineage-active',
              },
            );
            if (competingAppointments.length > 0) {
              throw new BookingActiveAppointmentError();
            }

            await finalizeBookingPricingInTx(tx, lockedSalonClient);
            const bookingTaxSnapshot
              = assertCurrentBookingFinancialQuote(lockedBookingConfiguration);

            // =================================================================
            // DEPOSITS — E.1 (pure in-transaction resolution) and E.2/E.3
            //
            // PURE: no provider call and no second pooled DB checkout. The
            // advisory lock pg_advisory_xact_lock(salonId, technicianId) is held
            // right now, so a helper that reaches @/libs/DB via await import()
            // would check out a SECOND connection while holding it AND read
            // outside this transaction's snapshot. getDepositPolicyForSalon is
            // therefore never called here — only the pure resolver is.
            // =================================================================
            let depositCharge: { amountCents: number; fingerprint: string } | null = null;
            let committedDepositPlan: CommittedDepositPlan | null = null;
            // The branch ran and the policy was live, but this particular
            // booking owes nothing (a reward dropped the total under the floor,
            // say). The 201 must still SAY so — see the return value below.
            let depositResolvedNotRequired = false;
            if (depositBranch) {
              const depositPolicy = resolveDepositPolicy({
                settings: lockedBookingConfiguration.settings,
                features: lockedBookingConfiguration.features,
                stripeAccount: depositBranch.accountSnapshot,
                // Imported from depositPolicy.server.ts. NEVER re-derived here:
                // a locally recomputed livemode is exactly how a live Checkout
                // gets created against a test-mode binding.
                expectedLivemode: EXPECTED_LIVEMODE,
              });

              let charge;
              try {
                // `totalPrice` is read HERE, after finalize, because
                // resetTransactionPricing() re-derives pricing on every attempt
                // — an earlier capture is not well defined, and with a 50%-off
                // retention campaign the subtotal would yield a CA$50 deposit
                // against a CA$30 booking. This is the exact value bound into
                // the INSERT below.
                charge = resolveDepositChargeForTotal(depositPolicy, totalPrice, {
                  mode: 'authoritative',
                  isReschedule: false,
                });
              } catch {
                // R3: a TypeError from a non-integer total. Defence in depth —
                // what it fixes is that this failure previously had no SHAPE:
                // the transaction is retried, so a deterministic corrupt total
                // burned the retry budget and then 500'd with no client code.
                throw new DepositsUnavailableError('charge_resolver_threw');
              }

              if (!charge.required && charge.reason === 'undetermined') {
                // R2. NEVER treated as required:false. Without this, every
                // active:false flattens to policy_inactive -> required:false and
                // a transient failure books FREE. Distinct from R0: R0 refuses
                // the pre-transaction SCOPE read, this refuses the
                // in-transaction PURE resolution, whose reachable causes are
                // different ones (EXPECTED_LIVEMODE === null, resolver throw).
                throw new DepositsUnavailableError('charge_undetermined');
              }

              if (charge.required) {
                // Defence in depth around the policy resolver: Stripe deposits
                // are CAD-only in D6. A booking invoice in another currency
                // must never reach a CAD hold even if stale or corrupt policy
                // input is accidentally classified active.
                if (lockedBookingConfiguration.invoiceCurrency !== DEPOSIT_ISO_CURRENCY) {
                  throw new DepositsUnavailableError('currency_mismatch');
                }
                // R4: a platform key-mode change is reachable, and would
                // otherwise create a LIVE Checkout against a test-mode binding
                // (or the reverse) — charging a client on an account Luster can
                // neither confirm nor refund against. Two values already in
                // scope; no new call, query or column.
                if (depositBranch.accountSnapshot?.livemode !== EXPECTED_LIVEMODE) {
                  throw new DepositsUnavailableError('livemode_mismatch');
                }

                const fingerprint = buildDepositDisclosureFingerprint(charge);

                // R5 / E.3 — A MAGNITUDE RULE, NOT EQUALITY. Only an UPWARD
                // surprise blocks; an equal-or-lower authoritative amount
                // proceeds. Writing this as equality rejects a client who now
                // owes LESS, and making an absent field an unconditional 409
                // loops forever (a pre-D3 bundle sends nothing, a 100%-value
                // reward makes required:false, and the client is told to adopt
                // an amount that does not exist).
                //
                // A null parse is a HARD MISMATCH here — the opposite of Step 0
                // — and 'deposit-v1:none' parses to 0, so a forged or stale
                // sentinel at an ACTIVE salon blocks rather than manufacturing
                // either a free booking or a silent charge.
                if (
                  disclosedDepositCents === null
                  || charge.amountCents > disclosedDepositCents
                ) {
                  throw new DepositChangedError(charge.amountCents, fingerprint);
                }

                if (charge.amountCents < MIN_DEPOSIT_CENTS) {
                  // A CAPPED amount below the floor is not a refusal — D3
                  // already returns { required:false, reason:'below_minimum_charge' }
                  // for that, meaning "proceed with no deposit". Reaching here
                  // means an illegal required amount, so fail closed rather
                  // than dispatch it.
                  throw new DepositAmountFloorError(charge.amountCents);
                }

                depositCharge = { amountCents: charge.amountCents, fingerprint };
              } else {
                depositResolvedNotRequired = true;
              }
            }

            let lockedRetentionCampaign: typeof retentionCampaignSchema.$inferSelect | null = null;
            if (retentionCampaign) {
              const [lockedCampaign] = await tx
                .select()
                .from(retentionCampaignSchema)
                .where(and(
                  eq(retentionCampaignSchema.id, retentionCampaign.id),
                  eq(retentionCampaignSchema.salonId, salon.id),
                ))
                .for('update')
                .limit(1);

              if (!lockedCampaign) {
                throw new Error('CAMPAIGN_NOT_FOUND');
              }
              const lockedValidation = validateRetentionCampaign({
                promotion: lockedCampaign.promotionSnapshot,
                expiresAt: lockedCampaign.expiresAt,
                redeemedAt: lockedCampaign.redeemedAt,
                singleUse: lockedCampaign.singleUse,
                campaignClientId: lockedCampaign.salonClientId,
                bookingClientId: lockedSalonClient.id,
                serviceIds: services.map(service => service.id),
              });
              if (!lockedValidation.valid) {
                throw new Error(lockedValidation.code);
              }
              lockedRetentionCampaign = lockedCampaign;
            }

            // Derived per attempt, INSIDE the transaction body: the runner
            // retries the whole body, so a holdNow captured outside would drift
            // from the row it stamps.
            const holdNow = new Date();
            const holdExpiresAt = depositCharge
              ? new Date(holdNow.getTime() + DEPOSIT_HOLD_WINDOW_MINUTES * 60_000)
              : null;

            const [createdAppointment] = await tx
              .insert(appointmentSchema)
              .values({
                id: appointmentId,
                salonId: salon.id,
                technicianId: technician?.id ?? null,
                locationId: validatedLocationId,
                clientPhone: lockedSalonClient.phone,
                clientName,
                clientEmail: normalizedClientEmail,
                notes: normalizedNotes,
                salonClientId: lockedSalonClient.id,
                googleCalendarEventId: googleReviewEvent?.googleEventId ?? null,
                startTime,
                endTime,
                // THE APPOINTMENT ROW IS THE HOLD.
                status: depositCharge
                  ? 'awaiting_payment'
                  : (salon.freeSoloEnabled ? 'confirmed' : 'pending'),
                ...(depositCharge
                  ? { createdAt: holdNow, depositHoldExpiresAt: holdExpiresAt }
                  : {}),
                invoiceCurrency: lockedBookingConfiguration.invoiceCurrency,
                bookingTaxSnapshot,
                totalPrice,
                totalDurationMinutes,
                basePriceCents,
                addOnsPriceCents,
                baseDurationMinutes,
                addOnsDurationMinutes,
                bufferMinutes,
                blockedDurationMinutes,
                subtotalBeforeDiscountCents,
                discountAmountCents,
                discountType: appointmentDiscountType,
                discountLabel: appointmentDiscountLabel,
                discountPercent: appointmentDiscountPercent,
                discountAppliedAt,
              })
              .returning();

            if (!createdAppointment) {
              throw new Error('Failed to create appointment');
            }

            if (depositCharge && depositBranch && holdExpiresAt) {
              // Same transaction as the appointment, so the active-uniqueness
              // rule (one non-terminal deposit per appointment) is claimed
              // atomically with the slot.
              const depositId = `dep_${crypto.randomUUID()}`;
              // Computed NOW from the already-loaded salon row so the Checkout
              // parameters can derive entirely from the committed deposit row —
              // salon slug and customDomain are runtime-mutable, and Stripe
              // errors if parameters differ under a replayed idempotency key.
              const checkoutSuccessUrl = buildSalonTenantPublicUrl('/deposit/return', salon);
              const checkoutCancelUrl = buildSalonTenantPublicUrl('/deposit/cancel', salon);

              await tx.insert(appointmentDepositSchema).values({
                id: depositId,
                salonId: salon.id,
                appointmentId: createdAppointment.id,
                status: 'checkout_created',
                amountCents: depositCharge.amountCents,
                // THE IMPORTED LOWERCASE CONSTANT, never a literal and never
                // 'CAD'. 0065 ships CHECK (currency = 'cad'); an uppercase
                // insert raises a check violation INSIDE this retried
                // transaction, burning the retry budget and 500ing — a total
                // booking outage for the deposit branch of every deposit salon,
                // caused by two characters, and invisible to any test that
                // mocks the DB.
                currency: DEPOSIT_CURRENCY,
                // amount_cents <= disclosed_amount_cents is the invariant;
                // EQUALITY IS NOT. A downward request persists both, unequal,
                // deliberately — 0065 adds no equality CHECK.
                disclosedAmountCents: disclosedDepositCents,
                stripeAccountId: depositBranch.stripeAccountId,
                checkoutSuccessUrl,
                checkoutCancelUrl,
                // Stays NULL until post-commit; unique constraints on nullable
                // columns admit NULLs, so "unique Checkout Session id" holds.
                stripeCheckoutSessionId: null,
              });

              committedDepositPlan = {
                depositId,
                amountCents: depositCharge.amountCents,
                holdExpiresAt,
                stripeAccountId: depositBranch.stripeAccountId,
                checkoutSuccessUrl,
                checkoutCancelUrl,
                fingerprint: depositCharge.fingerprint,
              };
            }

            if (currentRequiredPolicy && requestedPolicyAcknowledgment) {
              await tx
                .insert(appointmentBookingPolicyAcknowledgmentSchema)
                .values(buildPublicBookingPolicyAcknowledgmentSnapshot({
                  salonId: salon.id,
                  appointmentId: createdAppointment.id,
                  policy: currentRequiredPolicy,
                  scheduledStartAt: createdAppointment.startTime,
                  scheduledEndAt: createdAppointment.endTime,
                  attemptId: requestedPolicyAcknowledgment.attemptId,
                  requestHash: requestBodyHash,
                  appointmentUpdatedAt: createdAppointment.updatedAt,
                }));
            }

            await mintAppointmentManageCapability(tx, {
              salonId: salon.id,
              appointmentId: createdAppointment.id,
              appointmentEndTime: endTime,
              capability: managementCapability,
            });
            if (data.smsConsent?.granted) {
              await tx.insert(communicationConsentSchema).values({
                id: crypto.randomUUID(),
                salonId: salon.id,
                recipient: lockedSalonClient.phone,
                channel: 'sms',
                purpose: 'appointment_transactional',
                status: 'granted',
                wordingVersion: data.smsConsent.wordingVersion,
                source: 'public_booking',
                grantedAt: new Date(),
                metadata: { appointmentId: createdAppointment.id },
              });
            }

            await insertSmartFitAuditRowInTx(tx, createdAppointment.id);

            const insertedServices: AppointmentService[] = [];
            for (const service of services) {
              const [apptService] = await tx
                .insert(appointmentServicesSchema)
                .values({
                  id: `apptSvc_${crypto.randomUUID()}`,
                  appointmentId: createdAppointment.id,
                  serviceId: service.id,
                  priceAtBooking: service.price,
                  durationAtBooking: service.durationMinutes,
                  nameSnapshot: service.name,
                  categorySnapshot: service.category,
                  priceCentsSnapshot: service.price,
                  durationMinutesSnapshot: service.durationMinutes,
                  priceDisplayTextSnapshot: service.priceDisplayText ?? null,
                  resolvedIntroPriceLabelSnapshot: services.length === 1 ? resolvedIntroPriceLabel : null,
                })
                .returning();

              if (apptService) {
                insertedServices.push(apptService);
              }
            }

            const insertedAddOns: typeof appointmentAddOns = [];
            for (const addOn of selectedAddOnsForBooking) {
              await tx.insert(appointmentAddOnSchema).values({
                id: `apptAddon_${crypto.randomUUID()}`,
                appointmentId: createdAppointment.id,
                addOnId: addOn.addOnId,
                quantitySnapshot: addOn.quantity,
                nameSnapshot: addOn.name,
                categorySnapshot: addOn.category,
                pricingTypeSnapshot: addOn.pricingType,
                unitPriceCentsSnapshot: addOn.unitPriceCents,
                durationMinutesSnapshot: addOn.unitDurationMinutes,
                lineTotalCentsSnapshot: addOn.lineTotalCents,
                lineDurationMinutesSnapshot: addOn.lineDurationMinutes,
              });

              insertedAddOns.push({
                id: addOn.addOnId,
                name: addOn.name,
                quantity: addOn.quantity,
                lineTotalCents: addOn.lineTotalCents,
                lineDurationMinutes: addOn.lineDurationMinutes,
              });
            }

            if (googleReviewEvent) {
              // The review row was loaded before this transaction so the form
              // can be validated without holding locks through the rest of the
              // request. Before transferring its remote-event ownership, join
              // the same exact-pair ordering domain as reconciliation workers,
              // then compare every provider/review version that made the row
              // eligible. A tombstone, owner review, inbound refresh or copy
              // transition that won since the read therefore aborts this whole
              // booking transaction instead of being overwritten by a stale
              // claim.
              const pairIsIdle
                = await acquireGoogleCalendarEventPairMutationBarrierInTx(tx, {
                  expectedMirrorId: googleReviewEvent.id,
                  expectedSalonId: salon.id,
                  targetCalendarId: googleReviewEvent.calendarId,
                  googleCalendarEventId: googleReviewEvent.googleEventId,
                });
              if (!pairIsIdle) {
                throw new Error('GOOGLE_EVENT_ALREADY_CONVERTED');
              }
              const [claimedEvent] = await tx.update(googleCalendarEventSchema).set({
                appointmentId: createdAppointment.id,
                reviewStatus: 'appointment',
                reviewedAt: new Date(),
              }).where(and(
                eq(googleCalendarEventSchema.id, googleReviewEvent.id),
                eq(googleCalendarEventSchema.salonId, salon.id),
                eq(googleCalendarEventSchema.calendarId, googleReviewEvent.calendarId),
                eq(googleCalendarEventSchema.googleEventId, googleReviewEvent.googleEventId),
                isNull(googleCalendarEventSchema.appointmentId),
                isNull(googleCalendarEventSchema.deletedAt),
                eq(googleCalendarEventSchema.reviewStatus, googleReviewEvent.reviewStatus),
                eq(googleCalendarEventSchema.syncMode, googleReviewEvent.syncMode),
                googleReviewEvent.googleUpdatedAt
                  ? eq(
                    googleCalendarEventSchema.googleUpdatedAt,
                    googleReviewEvent.googleUpdatedAt,
                  )
                  : isNull(googleCalendarEventSchema.googleUpdatedAt),
              )).returning();
              if (!claimedEvent) {
                throw new Error('GOOGLE_EVENT_ALREADY_CONVERTED');
              }
            }

            if (lockedRetentionCampaign) {
              const [redeemedCampaign] = await tx
                .update(retentionCampaignSchema)
                .set({
                  redeemedAt: new Date(),
                  redeemedAppointmentId: createdAppointment.id,
                  updatedAt: new Date(),
                })
                .where(and(
                  eq(retentionCampaignSchema.id, lockedRetentionCampaign.id),
                  eq(retentionCampaignSchema.salonId, salon.id),
                  lockedRetentionCampaign.singleUse
                    ? isNull(retentionCampaignSchema.redeemedAt)
                    : undefined,
                ))
                .returning();
              if (!redeemedCampaign) {
                throw new Error('CAMPAIGN_REDEEMED');
              }

              await tx.insert(retentionCampaignRedemptionSchema).values({
                id: `campaign_redemption_${crypto.randomUUID()}`,
                salonId: salon.id,
                campaignId: lockedRetentionCampaign.id,
                appointmentId: createdAppointment.id,
                discountAmountCents,
              });

              if (lockedRetentionCampaign.communicationId) {
                await tx
                  .update(clientCommunicationSchema)
                  .set({
                    status: 'converted',
                    convertedAt: new Date(),
                    updatedAt: new Date(),
                  })
                  .where(and(
                    eq(clientCommunicationSchema.id, lockedRetentionCampaign.communicationId),
                    eq(clientCommunicationSchema.salonId, salon.id),
                  ));
              }
            }

            if (
              !depositCharge
              && (!googleReviewEvent || googleReviewEvent.syncMode === 'bidirectional')
            ) {
              await enqueueGoogleCalendarAppointmentMutation(tx, {
                appointmentId: createdAppointment.id,
                salonId: createdAppointment.salonId,
                mutationVersion: createdAppointment.updatedAt,
              });
            }

            return {
              appointment: createdAppointment,
              appointmentServices: insertedServices,
              appointmentAddOns: insertedAddOns,
              salonClient: lockedSalonClient,
              depositPlan: committedDepositPlan,
              depositResolvedNotRequired,
            };
          },
        );

        appointment = transactionalResult.appointment;
        appointmentServices = transactionalResult.appointmentServices;
        appointmentAddOns = transactionalResult.appointmentAddOns;
        salonClient = transactionalResult.salonClient;
        depositPlan = transactionalResult.depositPlan;
        // An ENTERED branch whose authoritative charge came back `required:false`
        // must still carry `deposit: { required:false }` on the 201. Omitting it
        // tells the client to adopt `details.deposit.amountCents`, of which
        // there is none — the exact loop the magnitude rule exists to prevent.
        if (transactionalResult.depositResolvedNotRequired) {
          respondDepositNotRequired = true;
        }
      } catch (error) {
        if (error instanceof DepositsUnavailableError) {
          // R2/R3/R4. The transaction aborted, so there is NO appointment row
          // and NO deposit row — which is the assertion the tests make, because
          // "an appointment exists with no deposit" is precisely the free
          // booking this refusal exists to prevent.
          return depositsTemporarilyUnavailableResponse();
        }
        if (error instanceof DepositChangedError) {
          return depositChangedResponse(error);
        }
        if (error instanceof DepositAmountFloorError) {
          console.error('[deposits] resolver returned a required amount below the Stripe floor', {
            salonId: salon.id,
            amountCents: error.amountCents,
          });
          return Response.json(
            {
              error: {
                code: 'DEPOSIT_AMOUNT_INVALID',
                message: 'This booking could not be completed. Please contact the salon.',
              },
            } satisfies ErrorResponse,
            { status: 500 },
          );
        }
        if (error instanceof BookingPolicyAcknowledgmentRequiredError) {
          return bookingPolicyAcknowledgmentRequiredResponse(
            error.bookingPolicy,
          );
        }
        if (error instanceof BookingPolicyChangedError) {
          return bookingPolicyChangedResponse(error.bookingPolicy);
        }
        if (
          error instanceof BookingPolicyAttemptReusedError
          || isBookingPolicyAttemptConstraintViolation(error)
        ) {
          return bookingPolicyAttemptReusedResponse();
        }
        if (isBookingPolicyLockTimeout(error)) {
          return bookingPolicyCheckRetryResponse();
        }
        if (error instanceof BookingActiveAppointmentError) {
          return bookingActiveAppointmentResponse(bookingSubjectMode);
        }
        if (
          error instanceof BookingClientConflictError
          || error instanceof ClientLifecycleStabilizationError
        ) {
          return bookingClientConflictResponse();
        }
        if (error instanceof SmartFitStaleError) {
          return smartFitStaleResponse(error);
        }
        if (error instanceof BookingFinancialQuoteChangedError) {
          return bookingFinancialQuoteChangedResponse(error);
        }

        if (error instanceof SlotConflictError || isSlotConstraintViolation(error)) {
          return Response.json(
            {
              error: {
                code: 'TIME_CONFLICT',
                message: 'This time slot is no longer available. Please select a different time.',
              },
            } satisfies ErrorResponse,
            { status: 409 },
          );
        }

        throw error;
      }
    }

    if (!appointment || !salonClient) {
      throw new Error('BOOKING_TRANSACTION_DID_NOT_COMMIT');
    }

    // §7.F — the ONLY new code on the non-deposit path is eight boolean
    // conditions. D4.5 replaced those eight conditions with ONE: the eight
    // effects they guarded now live in `runBookingCommitSideEffects`, which is
    // called only when this is not a hold. The response build, the cache write
    // and the return stay exactly where they are, in their current order.
    const isDepositHold = depositPlan !== null;

    if (googleReviewEvent) {
      await recordGoogleEventReviewDecision({
        salonId: salon.id,
        title: googleReviewEvent.title,
        decision: 'appointment',
      });
    }

    // 9b. If this is a reschedule, cancel the original appointment and send SMS
    if (originalAppointment && normalizedOriginalApptId) {
      // Send reschedule confirmation SMS to client (gated by smsRemindersEnabled toggle)
      // Use salonClient.phone as source of truth
      await sendRescheduleConfirmation(salon.id, {
        phone: salonClient.phone,
        clientName: clientName ?? undefined,
        appointmentId: appointment.id,
        salonName: salon.name,
        oldStartTime: originalAppointment.startTime.toISOString(),
        newStartTime: startTime.toISOString(),
        services: services.map(s => s.name),
        technicianName: technician?.name ?? 'Any available artist',
        timeZone: bookingConfig.timezone,
      });

      // Notify technician about the reschedule (if original had one assigned)
      if (originalAppointment.technicianId) {
        const originalTech = await getTechnicianById(originalAppointment.technicianId, salon.id);
        if (originalTech) {
          await sendCancellationNotificationToTech(salon.id, {
            technicianName: originalTech.name,
            // Note: technicianPhone not currently stored in schema, will log instead of SMS
            technicianPhone: undefined,
            clientName: clientName ?? 'Guest',
            startTime: originalAppointment.startTime.toISOString(),
            services: services.map(s => s.name),
            cancelReason: 'rescheduled',
          });
        }
      }
    }

    // =========================================================================
    // DEPOSITS — E.5: Checkout Session creation. POST-COMMIT, and never inside
    // any DB transaction.
    //
    // It runs BEFORE the response build on purpose: the `deposit` object has to
    // be part of the object that is both cached and returned, so an idempotent
    // replay carries the checkout URL. Attaching it after the cache write would
    // hand a replayed client a 201 with nowhere to pay.
    // =========================================================================
    let depositResponse: DepositResponseObject | undefined;
    if (respondDepositNotRequired) {
      depositResponse = { required: false };
    }

    if (depositPlan) {
      const depositRow: DepositCheckoutRow = {
        id: depositPlan.depositId,
        salonId: salon.id,
        appointmentId: appointment.id,
        amountCents: depositPlan.amountCents,
        stripeAccountId: depositPlan.stripeAccountId,
        checkoutSuccessUrl: depositPlan.checkoutSuccessUrl,
        checkoutCancelUrl: depositPlan.checkoutCancelUrl,
        holdExpiresAt: depositPlan.holdExpiresAt,
      };
      const created = await createDepositCheckoutSession({ deposit: depositRow });
      const checkoutUrl = created.ok ? created.session.url : null;

      if (created.ok && checkoutUrl) {
        const session = created.session;
        const paymentIntentId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          // May be NULL at creation under current API versions; store what the
          // session actually returns rather than synthesising one.
          : (session.payment_intent?.id ?? null);

        // ONE statement, guarded on the session id still being NULL.
        await db
          .update(appointmentDepositSchema)
          .set({
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            stripeCheckoutUrl: checkoutUrl,
            updatedAt: new Date(),
          })
          .where(and(
            eq(appointmentDepositSchema.id, depositPlan.depositId),
            eq(appointmentDepositSchema.salonId, salon.id),
            isNull(appointmentDepositSchema.stripeCheckoutSessionId),
          ));

        const expectedExpiry = depositHoldExpiresAtEpochSeconds(depositPlan.holdExpiresAt);
        if (session.expires_at !== expectedExpiry) {
          // The LOCAL deadline stays authoritative for the reaper; this is a
          // divergence alarm, not a correction.
          const Sentry = await import('@sentry/nextjs');
          Sentry.captureMessage('Deposit Checkout expires_at diverged from the local hold deadline', {
            level: 'warning',
            tags: { scope: 'deposit_checkout_expiry_mismatch', salon_id: salon.id },
            extra: { expected: expectedExpiry, received: session.expires_at },
          });
        }

        depositResponse = {
          required: true,
          checkoutUrl,
          amountCents: depositPlan.amountCents,
          currency: DEPOSIT_CURRENCY,
          fingerprint: depositPlan.fingerprint,
          holdExpiresAt: depositPlan.holdExpiresAt.toISOString(),
        };
      } else if (created.ok) {
        // A session exists but carries no hosted URL. A session id WAS learned,
        // so the hold is never cancelled here; the reaper owns it.
        await db
          .update(appointmentDepositSchema)
          .set({
            stripeCheckoutSessionId: created.session.id,
            updatedAt: new Date(),
          })
          .where(and(
            eq(appointmentDepositSchema.id, depositPlan.depositId),
            eq(appointmentDepositSchema.salonId, salon.id),
            isNull(appointmentDepositSchema.stripeCheckoutSessionId),
          ));
        return Response.json(
          {
            error: {
              code: 'DEPOSIT_CHECKOUT_UNAVAILABLE',
              message: 'We could not open the payment page. Your slot is held briefly — please try again.',
            },
          } satisfies ErrorResponse,
          { status: 503 },
        );
      } else if (isCancellableCreateFailure(created.failure)) {
        // DEFINITE / PERMANENT, and no session id was learned: Stripe decoded
        // the request and rejected it, so retrying is pointless and the slot
        // should become re-bookable immediately.
        //
        // NEVER reached for a 429, a concurrent idempotency_error, or any 5xx:
        // cancelling on a 429 destroys valid bookings during exactly the
        // traffic spikes deposits exist for, and cancelling on a concurrent 409
        // can strand a payable session created by the in-flight original with
        // no local record at all. Those are classified 'ambiguous' and fall to
        // the branch below.
        await cancelHoldAfterDefiniteCheckoutFailure({
          appointmentId: appointment.id,
          salonId: salon.id,
          depositId: depositPlan.depositId,
        });
        const Sentry = await import('@sentry/nextjs');
        Sentry.captureException(created.error, {
          tags: { scope: 'deposit_checkout_definite_failure', salon_id: salon.id },
        });
        return Response.json(
          {
            error: {
              code: 'DEPOSIT_CHECKOUT_FAILED',
              message: 'We could not start the deposit payment. Your slot was released — please try booking again.',
            },
          } satisfies ErrorResponse,
          { status: 502 },
        );
      } else {
        // AMBIGUOUS: a timeout, a reset, or a retryable failure that survived
        // its one retry. We do not know whether a session exists — a saved
        // result, including a saved 500, is replayed under the same key for
        // >= 24 h. Leave the hold standing; the reaper resolves it.
        console.error('[deposits] Checkout create was ambiguous; leaving the hold standing', {
          salonId: salon.id,
          appointmentId: appointment.id,
          idempotencyKey: buildDepositCheckoutIdempotencyKey(appointment.id),
        });
        return Response.json(
          {
            error: {
              code: 'DEPOSIT_CHECKOUT_UNAVAILABLE',
              message: 'We could not reach the payment provider. Your slot is held briefly — please try again.',
            },
          } satisfies ErrorResponse,
          { status: 503 },
        );
      }
    }

    // =========================================================================
    // 10. BUILD RESPONSE (single definition, used for cache AND return)
    // =========================================================================
    // Build response ONCE to guarantee cache and return are byte-for-byte identical
    const manageUrl = buildAppointmentManageUrl(
      { slug: salon.slug, customDomain: salon.customDomain },
      managementCapability.token,
    );

    // The post-commit effects context is assembled HERE, before the cache
    // write, because it shares `manageUrl` with the response body — and it is
    // built from values already in memory, so it costs no queries. The effects
    // themselves run AFTER the cache write (§12 below). That straddle is
    // deliberate: the client's 201 must not wait on notification work.
    const bookingCommitEffectsContext: BookingCommitEffectsContext = {
      salon: {
        id: salon.id,
        name: salon.name,
        ownerName: salon.ownerName,
        ownerPhone: salon.ownerPhone,
        ownerEmail: salon.ownerEmail,
        features: (salon.features as SalonFeatures | null | undefined) ?? null,
        settings: (salon.settings as SalonSettings | null | undefined) ?? null,
      },
      salonClientId: salonClient.id,
      clientPhone: salonClient.phone,
      clientName,
      appointment: {
        id: appointment.id,
        notes: appointment.notes,
        googleCalendarEventId: appointment.googleCalendarEventId,
        updatedAt: appointment.updatedAt,
      },
      serviceNames: services.map(s => s.name),
      technician: technician
        ? {
            id: technician.id,
            name: technician.name,
            phone: technician.phone,
            email: technician.email,
          }
        : null,
      startTime,
      endTime,
      totalPrice,
      totalDurationMinutes,
      timeZone: bookingConfig.timezone,
      manageUrl,
      smsConsentGranted: data.smsConsent?.granted === true,
      appliedRewardId: appliedReward?.id ?? null,
      actorRole,
      originalAppointment,
      googleCalendarSyncEligible:
        !googleReviewEvent || googleReviewEvent.syncMode === 'bidirectional',
      locationName: validatedLocation?.name ?? null,
      locationAddress: formatLocationAddress(validatedLocation),
    };

    const response: SuccessResponse = {
      data: {
        appointmentId: appointment.id,
        manageUrl,
        appointment,
        services: services.map((service) => {
          const apptService = appointmentServices.find(as => as.serviceId === service.id);
          return {
            service,
            priceAtBooking: apptService?.priceAtBooking ?? service.price,
            durationAtBooking: apptService?.durationAtBooking ?? service.durationMinutes,
          };
        }),
        addOns: appointmentAddOns,
        technician: technician
          ? { id: technician.id, name: technician.name, avatarUrl: technician.avatarUrl }
          : null,
        salon: {
          id: salon.id,
          name: salon.name,
          slug: salon.slug,
        },
        // Part of the object that is BOTH cached and returned, so a replay
        // carries the checkout URL. Absent entirely when the policy is not
        // active; `{ required: false }` when it is active but this request was
        // outside the charge predicate.
        ...(depositResponse ? { deposit: depositResponse } : {}),
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };

    // =========================================================================
    // 11. CACHE WRITE - Only if idempotency is enabled and we own the lock
    // DB insert is ALREADY COMMITTED at this point (line ~931 .returning() confirms)
    // =========================================================================
    if (idempotencyEnabled && ownsLock && idempotencyCacheKey && redis && requestBodyHash) {
      try {
        await redis.set(
          idempotencyCacheKey,
          JSON.stringify({
            payloadHash: requestBodyHash,
            createdAt: new Date().toISOString(),
            statusCode: 201,
            responseBody: response, // Same object returned to client
          }),
          'PX',
          TTL.BOOKING_IDEMPOTENCY * 1000,
        );
      } catch (cacheError) {
        console.error('[Idempotency] Cache write failed:', cacheError);
      }
    }

    // =========================================================================
    // 12. SLOW WORK — the post-commit side effects (OUTSIDE lock window, after
    // cache write).
    //
    // These are the eight effects a deposit hold skips: nobody has paid yet,
    // and the booking may never become real. When the deposit is confirmed,
    // this same runner becomes eligible for that appointment through its durable,
    // at-least-once confirmation aggregate. That is the whole reason it is one
    // named function and not eight inline blocks.
    // =========================================================================
    if (!isDepositHold) {
      await runBookingCommitSideEffects(bookingCommitEffectsContext, {
        calendarAlreadyEnqueued: true,
      });
    }

    // 13. Return response (same object that was cached, if caching was enabled)
    bookingSucceeded = true;
    return Response.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof Error && isCampaignFailureCode(error.message)) {
      return campaignFailureResponse(error.message);
    }
    if (error instanceof Error && error.message === 'CAMPAIGN_NOT_FOUND') {
      return Response.json({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'This promotion link was not found for this salon.' },
      } satisfies ErrorResponse, { status: 404 });
    }
    if (error instanceof Error && error.message === 'GOOGLE_EVENT_ALREADY_CONVERTED') {
      return Response.json(
        {
          error: {
            code: 'GOOGLE_EVENT_ALREADY_CONVERTED',
            message: 'This Google event is already an appointment.',
          },
        } satisfies ErrorResponse,
        { status: 409 },
      );
    }

    console.error('Error creating appointment:', error);

    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while creating the appointment',
        },
      } satisfies ErrorResponse,
      { status: 500 },
    );
  } finally {
    // A failed booking must not hold the idempotency lock for its full TTL:
    // release it (only if still owned) so an immediate retry can proceed.
    // Successful bookings keep the lock — the cached 201 answers replays.
    if (!bookingSucceeded && ownsLock && lockKey && lockOwnerToken && redis) {
      try {
        await redis.eval(DEL_IF_OWNER_LUA, 1, lockKey, lockOwnerToken);
      } catch (releaseError) {
        // TTL remains the backstop if Redis hiccups here.
        console.warn('[Idempotency] Failed to release booking lock:', releaseError);
      }
    }
  }
}

// =============================================================================
// GET /api/appointments - Fetch appointments (for staff dashboard)
// =============================================================================
//
// SECURITY CONTRACT (Step 16.4 Hardening):
// =========================================
//
// STAFF REQUESTS (detected via staff session cookies):
//   - salonId: DERIVED FROM SESSION (query params IGNORED)
//   - technicianId: DERIVED FROM SESSION (query params IGNORED)
//   - ALLOWED query params (whitelist):
//     * date, startDate, endDate - date filtering
//     * status - status filtering (validated against APPOINTMENT_STATUSES)
//     * limit - pagination (max 100)
//   - IGNORED query params (blacklist - silently dropped):
//     * salonSlug, salonId, technicianId, includeDeleted, allTechs
//   - Response: REDACTED via getEffectiveStaffVisibility + redactAppointmentForStaff
//
// ADMIN REQUESTS (no staff session):
//   - Requires explicit admin auth for the resolved salonSlug
//   - Public/customer filter-driven reads are not allowed here
//
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);

    // ==========================================================================
    // SECURITY: Check for staff session FIRST
    // If present, staff context wins and query params for identity are ignored.
    // ==========================================================================
    const staffAuth = await requireStaffSession();

    if (staffAuth.ok) {
      // SECURITY: These values come ONLY from validated session
      const salonId = staffAuth.session.salonId;
      const technicianId = staffAuth.session.technicianId;

      // Fetch salon features + settings for visibility resolution
      const [salonData] = await db
        .select({
          features: salonSchema.features,
          settings: salonSchema.settings,
        })
        .from(salonSchema)
        .where(eq(salonSchema.id, salonId))
        .limit(1);
      const bookingConfig = await getBookingConfigForSalon(salonId);

      const salonFeatures = (salonData?.features as SalonFeatures) ?? null;
      const salonSettings = (salonData?.settings as SalonSettings) ?? null;

      // =====================================================================
      // STAFF PARAM WHITELIST: Only these query params are allowed for staff
      // All identity params (salonSlug, technicianId, salonId) are IGNORED
      // =====================================================================
      const dateParam = searchParams.get('date');
      const statusParam = searchParams.get('status');
      const startDateParam = searchParams.get('startDate');
      const endDateParam = searchParams.get('endDate');
      const limitParam = searchParams.get('limit');

      const { startOfDay, endOfDay } = resolveAppointmentDateRange({
        dateParam,
        startDateParam,
        endDateParam,
        timeZone: bookingConfig.timezone,
      });

      // Parse status filter with validation against allowed values
      const parsedStatuses = parseStatusParam(statusParam);

      // If caller provided statuses but ALL were invalid, reject with 400
      if (parsedStatuses !== null && parsedStatuses.length === 0) {
        return Response.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message: `Invalid status filter. Valid values: ${APPOINTMENT_STATUSES.join(', ')}`,
            },
          },
          { status: 400 },
        );
      }

      const statuses = parsedStatuses ?? ['confirmed', 'in_progress'];

      // Parse limit with cap for staff (prevent abuse)
      let limit = 50; // Default
      if (limitParam) {
        const parsed = Number.parseInt(limitParam, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          limit = Math.min(parsed, 100); // Cap at 100 for staff
        }
      }

      // Build query with session-derived identity (NEVER from params)
      const appointments = await db
        .select()
        .from(appointmentSchema)
        .where(
          and(
            eq(appointmentSchema.salonId, salonId),
            eq(appointmentSchema.technicianId, technicianId),
            sql`${appointmentSchema.startTime} >= ${startOfDay}`,
            sql`${appointmentSchema.startTime} <= ${endOfDay}`,
            inArray(appointmentSchema.status, statuses),
          ),
        )
        .orderBy(appointmentSchema.startTime)
        .limit(limit);

      const appointmentIds = appointments.map(appt => appt.id);
      const { servicesByAppointmentId, photosByAppointmentId } = await loadAppointmentDetailMaps(appointmentIds);

      const appointmentsWithDetails = appointments.map((appt) => {
        const services = servicesByAppointmentId.get(appt.id) ?? [];
        const photos = photosByAppointmentId.get(appt.id) ?? [];

        // Build object with ONLY safe fields for staff
        // Note: cancelReason, internalNotes, paymentStatus, metadata are NOT included
        return {
          id: appt.id,
          clientName: appt.clientName,
          clientPhone: appt.clientPhone,
          startTime: appt.startTime.toISOString(),
          endTime: appt.endTime.toISOString(),
          status: appt.status,
          technicianId: appt.technicianId,
          totalPrice: appt.totalPrice,
          invoiceCurrency: appt.invoiceCurrency,
          totalDurationMinutes: appt.totalDurationMinutes,
          locationId: appt.locationId,
          services: services.map(s => ({ name: s.name })),
          photos,
        };
      });

      // Apply visibility redaction
      const visibility = getEffectiveStaffVisibility(salonFeatures, salonSettings);
      const redactedAppointments = appointmentsWithDetails.map(appt =>
        redactAppointmentForStaff(appt, visibility),
      );

      // Return staff response (early return - no fallthrough to admin path)
      return Response.json({
        data: {
          appointments: redactedAppointments,
        },
        meta: {
          slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
        },
      });
    }

    // =========================================================================
    // ADMIN REQUEST PATH
    // Explicit admin access only. Public/customer reads are not allowed here.
    // =========================================================================
    const dateParam = searchParams.get('date');
    const statusParam = searchParams.get('status');
    const salonSlug = searchParams.get('salonSlug');
    const technicianIdParam = searchParams.get('technicianId');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const limitParam = searchParams.get('limit');

    if (!salonSlug) {
      return Response.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Staff or admin authentication is required',
          },
        },
        { status: 401 },
      );
    }

    const { error, salon } = await requireAdminSalon(salonSlug);
    if (error || !salon) {
      return error!;
    }

    const salonId = salon.id;
    const technicianId = technicianIdParam;

    const { startOfDay, endOfDay } = resolveAppointmentDateRange({
      dateParam,
      startDateParam,
      endDateParam,
    });

    // Use same validation helper for admin path
    const parsedStatuses = parseStatusParam(statusParam);
    const statuses = parsedStatuses ?? ['confirmed', 'in_progress'];

    // Build where conditions for admin path
    const conditions = [
      sql`${appointmentSchema.startTime} >= ${startOfDay}`,
      sql`${appointmentSchema.startTime} <= ${endOfDay}`,
      inArray(appointmentSchema.status, statuses),
    ];

    if (salonId) {
      conditions.push(eq(appointmentSchema.salonId, salonId));
    }

    if (technicianId) {
      conditions.push(eq(appointmentSchema.technicianId, technicianId));
    }

    let query = db
      .select()
      .from(appointmentSchema)
      .where(and(...conditions))
      .orderBy(appointmentSchema.startTime);

    if (limitParam) {
      const limit = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(limit) && limit > 0) {
        query = query.limit(limit) as typeof query;
      }
    }

    const appointments = await query;

    const appointmentIds = appointments.map(appt => appt.id);
    const { servicesByAppointmentId, photosByAppointmentId } = await loadAppointmentDetailMaps(appointmentIds);

    const appointmentsWithDetails = appointments.map((appt) => {
      const services = servicesByAppointmentId.get(appt.id) ?? [];
      const photos = photosByAppointmentId.get(appt.id) ?? [];

      // Admin gets full appointment data (no redaction)
      return {
        id: appt.id,
        clientName: appt.clientName,
        clientPhone: appt.clientPhone,
        startTime: appt.startTime.toISOString(),
        endTime: appt.endTime.toISOString(),
        status: appt.status,
        technicianId: appt.technicianId,
        totalPrice: appt.totalPrice,
        invoiceCurrency: appt.invoiceCurrency,
        cancelReason: appt.cancelReason,
        paymentStatus: appt.paymentStatus,
        services: services.map(s => ({ name: s.name })),
        photos,
      };
    });

    return Response.json({
      data: {
        appointments: appointmentsWithDetails,
      },
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    return Response.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch appointments',
        },
      },
      { status: 500 },
    );
  }
}
