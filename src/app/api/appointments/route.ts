import { createHash } from 'node:crypto';

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
import { requireAdmin, requireAdminSalon } from '@/libs/adminAuth';
import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { buildAppointmentAuditRow } from '@/libs/appointmentAudit';
import { buildAppointmentManageUrl } from '@/libs/appointmentManageUrl';
import { getBookingConfigForSalon, getClientChangePolicy, resolveIntroPriceLabel } from '@/libs/bookingConfig';
import {
  BLOCKING_APPOINTMENT_STATUSES,
  isSlotConstraintViolation,
  lockTechnicianAndAssertSlotFree,
  SlotConflictError,
} from '@/libs/bookingConflictGuard';
import { sendBookingNotificationsForNewBooking } from '@/libs/bookingNotifications';
import {
  canTechnicianTakeAppointment,
  getTorontoDateString,
  loadBookingPolicy,
  type LoadedBookingPolicy,
  resolveTechnicianCapabilityMode,
} from '@/libs/bookingPolicy';
import {
  BookingSelectionError,
  getPublicBookingSelectionMessage,
  getPublicTechnicianCompatibility,
  validatePublicBookingSelection,
} from '@/libs/bookingQuote';
import { requireClientApiSession } from '@/libs/clientApiGuards';
import { sendCustomerBookingConfirmationEmail } from '@/libs/customerBookingEmail';
import { db } from '@/libs/DB';
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
import { enqueueGoogleCalendarDelete, enqueueGoogleCalendarUpsert } from '@/libs/integrationOutbox';
import { createOpaqueToken } from '@/libs/lusterSecurity';
import {
  getActiveAppointmentsForClient,
  getAppointmentById,
  getAppointmentServiceNames,
  getClientByPhone,
  getLocationById,
  getOrCreateSalonClient,
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
import { sendSalonNotificationEmail } from '@/libs/salonNotificationEmail';
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
  sendBookingConfirmationToClient,
  sendCancellationNotificationToTech,
  sendRescheduleConfirmation,
} from '@/libs/SMS';
import { requireStaffSession } from '@/libs/staffAuth';
import { getDateKeyInTimeZone, getZonedDayBounds, zonedTimeToUtc } from '@/libs/timeZone';
import {
  type Appointment,
  APPOINTMENT_STATUSES,
  appointmentAccessTokenSchema,
  appointmentAddOnSchema,
  appointmentAuditLogSchema,
  appointmentPhotoSchema,
  appointmentSchema,
  type AppointmentService,
  appointmentServicesSchema,
  clientCommunicationSchema,
  communicationConsentSchema,
  googleCalendarEventSchema,
  referralSchema,
  retentionCampaignRedemptionSchema,
  retentionCampaignSchema,
  rewardSchema,
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

function formatLocationAddress(location: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
} | null): string | null {
  if (!location) {
    return null;
  }

  return [location.address, location.city, location.state, location.zipCode]
    .map(part => part?.trim())
    .filter(Boolean)
    .join(', ') || null;
}

// =============================================================================
// HELPERS
// =============================================================================

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

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

type SuccessResponse = {
  data: AppointmentResponse;
  meta: {
    timestamp: string;
  };
};

type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
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

function isCampaignFailureCode(value: string): value is CampaignValidationFailureCode {
  return [
    'CAMPAIGN_EXPIRED',
    'CAMPAIGN_REDEEMED',
    'CLIENT_MISMATCH',
    'NO_ELIGIBLE_SERVICE',
    'PROMOTION_DISABLED',
  ].includes(value);
}

async function markLatestRetentionOutreachConverted(args: {
  salonId: string;
  salonClientId: string;
  appointmentId: string;
}): Promise<void> {
  const convertedAt = new Date();
  await db.execute(sql`
    WITH latest_eligible AS (
      SELECT id
      FROM ${clientCommunicationSchema}
      WHERE ${clientCommunicationSchema.salonId} = ${args.salonId}
        AND ${clientCommunicationSchema.salonClientId} = ${args.salonClientId}
        AND ${clientCommunicationSchema.kind} IN ('rebook', 'promo_6w', 'promo_8w')
        AND ${clientCommunicationSchema.status} IN ('prepared', 'marked_sent', 'snoozed')
      ORDER BY ${clientCommunicationSchema.createdAt} DESC
      LIMIT 1
    )
    UPDATE ${clientCommunicationSchema}
    SET status = 'converted',
        converted_at = ${convertedAt},
        updated_at = ${convertedAt},
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ resultingAppointmentId: args.appointmentId })}::jsonb
    WHERE ${clientCommunicationSchema.id} IN (SELECT id FROM latest_eligible)
      AND ${clientCommunicationSchema.salonId} = ${args.salonId}
  `);
}

/**
 * Salon-facing "new booking" / "rescheduled" alert.
 *
 * A reschedule in this codebase creates a brand new appointment and cancels the
 * original with cancelReason='rescheduled', so the two events are mutually
 * exclusive: a reschedule must never also announce itself as a new booking.
 *
 * Only customer-initiated reschedules notify — an owner moving an appointment
 * in their own dashboard does not need an email about their own action.
 *
 * Never throws: the booking is already committed and the client has already
 * been shown a confirmation.
 */
async function notifySalonAboutBooking(args: {
  salonId: string;
  appointmentId: string;
  actorRole: 'guest' | 'client' | 'staff' | 'admin';
  originalAppointment: Appointment | null;
  newStartTime: Date;
  newEndTime: Date;
}): Promise<void> {
  try {
    const customerInitiated = args.actorRole === 'guest' || args.actorRole === 'client';

    if (!args.originalAppointment) {
      await sendSalonNotificationEmail({
        salonId: args.salonId,
        appointmentId: args.appointmentId,
        event: 'newBooking',
        source: customerInitiated ? 'online_booking' : 'dashboard',
      });
      return;
    }

    if (!customerInitiated) {
      return;
    }

    const original = args.originalAppointment;
    const scheduleChanged
      = original.startTime.getTime() !== args.newStartTime.getTime()
      || original.endTime.getTime() !== args.newEndTime.getTime();

    if (!scheduleChanged) {
      return;
    }

    const [previousTechnician, previousServiceNames] = await Promise.all([
      original.technicianId
        ? getTechnicianById(original.technicianId, args.salonId)
        : Promise.resolve(null),
      getAppointmentServiceNames(original.id),
    ]);

    await sendSalonNotificationEmail({
      salonId: args.salonId,
      appointmentId: args.appointmentId,
      event: 'rescheduled',
      source: 'client_manage_link',
      previous: {
        appointmentId: original.id,
        startTime: original.startTime.toISOString(),
        endTime: original.endTime.toISOString(),
        technicianName: previousTechnician?.name ?? null,
        serviceSummary: previousServiceNames.join(', ') || 'Appointment',
        discountLabel: original.discountLabel,
        discountAmountCents: original.discountAmountCents ?? 0,
        totalPriceCents: original.totalPrice,
      },
    });
  } catch (error) {
    console.error('[SALON NOTIFICATION] Booking alert failed after the booking committed:', {
      salonId: args.salonId,
      appointmentId: args.appointmentId,
      error,
    });
  }
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
          actorRole = 'client';
          clientPhoneInput = clientAuth.normalizedPhone;
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

    // 2d. IDEMPOTENCY CHECK: Prevent double-submit on booking confirmation
    // Client should send Idempotency-Key header with a UUID generated on page load
    const idempotencyKey = request.headers.get('Idempotency-Key');
    let idempotencyCacheKey: string | null = null;
    let requestBodyHash: string | null = null;
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
      // Generate hash using ALREADY NORMALIZED values (computed once above)
      // This ensures hash matches DB canonicalization exactly
      requestBodyHash = createHash('sha256')
        .update(JSON.stringify({
          salonId: salon.id, // Use resolved salonId, not slug
          serviceIds: [...normalizedLegacyServiceIds].sort(), // Sorted for consistency
          baseServiceId: normalizedBaseServiceId,
          selectedAddOns: normalizedSelectedAddOns
            .map(addOn => ({ addOnId: addOn.addOnId, quantity: addOn.quantity ?? 1 }))
            .sort((a, b) => a.addOnId.localeCompare(b.addOnId)),
          technicianId: normalizedTechnicianId, // Already normalized (null or valid ID, NOT lowercased)
          clientPhone: normalizedPhone, // 10-digit normalized (same as DB)
          clientName: normalizedClientName, // Trimmed + empty→null
          clientEmail: normalizedClientEmail,
          startTime: canonicalStartTime, // UTC ISO (validated above)
          locationId: normalizedLocationId, // Trimmed + empty→null
          originalAppointmentId: normalizedOriginalApptId, // Trimmed + empty→null
          googleEventReviewId: data.googleEventReviewId ?? null,
          priceCentsOverride: data.priceCentsOverride ?? null,
          durationMinutesOverride: data.durationMinutesOverride ?? null,
          notes: normalizedNotes,
          campaignTokenHash: normalizedCampaignToken
            ? hashRetentionCampaignToken(normalizedCampaignToken)
            : null,
        }))
        .digest('hex')
        .substring(0, 16); // Short hash is sufficient

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
      } catch (error) {
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
      const existingAppointments = await getActiveAppointmentsForClient(
        normalizedPhone,
        salon.id,
      );

      if (existingAppointments.length > 0) {
        // Intentionally no appointment id or date in the body: this response
        // is reachable with nothing but a phone number, so any detail beyond
        // the code would let callers enumerate other people's schedules.
        return Response.json(
          {
            error: {
              code: 'EXISTING_APPOINTMENT',
              message: 'You already have an upcoming appointment. Use your appointment link to change or cancel it, or request a fresh link.',
            },
          } satisfies ErrorResponse,
          { status: 409 },
        );
      }
    }

    // 4c. If this is a reschedule, validate that the original appointment exists
    // and that the authenticated actor is allowed to reschedule it.
    let originalAppointment = null;
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
      const clientOwnsOriginal = actorRole === 'client'
        && clientAuth?.ok
        && clientAuth.phoneVariants.some(phoneVariant =>
          normalizePhone(phoneVariant) === normalizedOriginalPhone,
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

    if (googleReviewEvent) {
      totalDurationMinutes = data.durationMinutesOverride ?? googleReviewEvent.durationMinutes;
      blockedDurationMinutes = totalDurationMinutes + bufferMinutes;
      if (data.priceCentsOverride !== undefined) {
        totalPrice = data.priceCentsOverride;
        subtotalBeforeDiscountCents = data.priceCentsOverride;
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

    // 7b. Resolve salonClientId before the appointment insert
    const salonClient = await getOrCreateSalonClient(
      salon.id,
      clientPhoneInput ?? normalizedPhone,
      clientName ?? undefined,
    );

    if (!salonClient) {
      return Response.json(
        {
          error: {
            code: 'INVALID_PHONE',
            message: 'Invalid phone number format. Please provide a valid 10-digit phone number.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    if (retentionCampaign) {
      const campaignValidation = validateRetentionCampaign({
        promotion: retentionCampaign.promotionSnapshot,
        expiresAt: retentionCampaign.expiresAt,
        redeemedAt: retentionCampaign.redeemedAt,
        singleUse: retentionCampaign.singleUse,
        campaignClientId: retentionCampaign.salonClientId,
        bookingClientId: salonClient.id,
        serviceIds: services.map(service => service.id),
      });
      if (!campaignValidation.valid) {
        return campaignFailureResponse(campaignValidation.code);
      }

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

    type BookingTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

    const finalizeBookingPricingInTx = async (tx: BookingTx): Promise<void> => {
      const lockedTechnician = technician;
      smartFitGrantEvaluation = null;

      if (smartFitScopeAllowed && smartFitGoogleBusyWindows !== null && lockedTechnician) {
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
    const capabilityExpiresAt = new Date(endTime.getTime() + 30 * 24 * 60 * 60 * 1000);

    let appointment: Appointment | null = null;
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
        const transactionalResult = await db.transaction(async (tx) => {
          // Cancel the original first so the replacement can occupy the same or
          // an overlapping window without tripping the double-booking
          // constraints. Atomic within this transaction: a failure below rolls
          // the cancellation back, and other sessions never observe a gap.
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
              updatedAt: new Date(),
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

          if (technician) {
            await lockTechnicianAndAssertSlotFree(tx, {
              salonId: salon.id,
              technicianId: technician.id,
              startTime,
              blockedEndTime,
              excludedAppointmentId: normalizedOriginalApptId,
            });
          }

          await finalizeBookingPricingInTx(tx);

          const [createdAppointment] = await tx
            .insert(appointmentSchema)
            .values({
              id: appointmentId,
              salonId: salon.id,
              technicianId: technician?.id ?? null,
              locationId: validatedLocationId,
              clientPhone: salonClient.phone,
              clientName,
              clientEmail: normalizedClientEmail ?? originalAppointment.clientEmail,
              notes: normalizedNotes ?? originalAppointment.notes,
              salonClientId: salonClient.id,
              googleCalendarEventId: googleReviewEvent?.googleEventId ?? null,
              startTime,
              endTime,
              status: salon.freeSoloEnabled ? 'confirmed' : 'pending',
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

          await tx.insert(appointmentAccessTokenSchema).values({
            id: crypto.randomUUID(),
            salonId: salon.id,
            appointmentId: createdAppointment.id,
            tokenHash: managementCapability.tokenHash,
            expiresAt: capabilityExpiresAt,
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

          return {
            appointment: createdAppointment,
            appointmentServices: insertedServices,
            appointmentAddOns: insertedAddOns,
          };
        });

        appointment = transactionalResult.appointment;
        appointmentServices = transactionalResult.appointmentServices;
        appointmentAddOns = transactionalResult.appointmentAddOns;
      } catch (error) {
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
        const transactionalResult = await db.transaction(async (tx) => {
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

          await finalizeBookingPricingInTx(tx);

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
              bookingClientId: salonClient.id,
              serviceIds: services.map(service => service.id),
            });
            if (!lockedValidation.valid) {
              throw new Error(lockedValidation.code);
            }
            lockedRetentionCampaign = lockedCampaign;
          }

          const [createdAppointment] = await tx
            .insert(appointmentSchema)
            .values({
              id: appointmentId,
              salonId: salon.id,
              technicianId: technician?.id ?? null,
              locationId: validatedLocationId,
              clientPhone: salonClient.phone,
              clientName,
              clientEmail: normalizedClientEmail,
              notes: normalizedNotes,
              salonClientId: salonClient.id,
              googleCalendarEventId: googleReviewEvent?.googleEventId ?? null,
              startTime,
              endTime,
              status: salon.freeSoloEnabled ? 'confirmed' : 'pending',
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

          await tx.insert(appointmentAccessTokenSchema).values({
            id: crypto.randomUUID(),
            salonId: salon.id,
            appointmentId: createdAppointment.id,
            tokenHash: managementCapability.tokenHash,
            expiresAt: capabilityExpiresAt,
          });
          if (data.smsConsent?.granted) {
            await tx.insert(communicationConsentSchema).values({
              id: crypto.randomUUID(),
              salonId: salon.id,
              recipient: salonClient.phone,
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
            const [claimedEvent] = await tx.update(googleCalendarEventSchema).set({
              appointmentId: createdAppointment.id,
              reviewStatus: 'appointment',
              reviewedAt: new Date(),
            }).where(and(
              eq(googleCalendarEventSchema.id, googleReviewEvent.id),
              eq(googleCalendarEventSchema.salonId, salon.id),
              isNull(googleCalendarEventSchema.appointmentId),
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

          return {
            appointment: createdAppointment,
            appointmentServices: insertedServices,
            appointmentAddOns: insertedAddOns,
          };
        });

        appointment = transactionalResult.appointment;
        appointmentServices = transactionalResult.appointmentServices;
        appointmentAddOns = transactionalResult.appointmentAddOns;
      } catch (error) {
        if (error instanceof SmartFitStaleError) {
          return smartFitStaleResponse(error);
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

    if (googleReviewEvent) {
      await recordGoogleEventReviewDecision({
        salonId: salon.id,
        title: googleReviewEvent.title,
        decision: 'appointment',
      });
    }

    try {
      await markLatestRetentionOutreachConverted({
        salonId: salon.id,
        salonClientId: salonClient.id,
        appointmentId: appointment.id,
      });
    } catch (conversionError) {
      // The appointment is already committed. Timeline enrichment must never
      // turn a successful booking into a 500 that encourages a duplicate retry.
      console.error('[Retention] Failed to convert latest outreach after booking:', conversionError);
    }

    // 9b. If this is a reschedule, cancel the original appointment and send SMS
    if (originalAppointment && normalizedOriginalApptId) {
      await enqueueGoogleCalendarDelete({
        appointmentId: normalizedOriginalApptId,
        salonId: salon.id,
        googleCalendarEventId: originalAppointment.googleCalendarEventId,
      });

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

    // 9c. Link the applied reward to this appointment (mark as pending redemption)
    if (appliedReward) {
      await db
        .update(rewardSchema)
        .set({
          usedInAppointmentId: appointment.id,
        })
        .where(eq(rewardSchema.id, appliedReward.id));
    }

    // 9d. Check for claimed referrals for this client and update status to 'booked'
    // This handles the case where a referee (person who claimed a referral) books their first appointment
    // Use salonClient.phone and variants for lookup (source of truth)
    const phoneVariants = [
      salonClient.phone,
      `+1${salonClient.phone}`,
      `+${salonClient.phone}`,
    ];

    const claimedReferrals = await db
      .select()
      .from(referralSchema)
      .where(
        and(
          eq(referralSchema.salonId, salon.id),
          inArray(referralSchema.refereePhone, phoneVariants),
          eq(referralSchema.status, 'claimed'),
        ),
      );

    // Update claimed referrals based on expiry status
    for (const referral of claimedReferrals) {
      if (referral.expiresAt && new Date(referral.expiresAt) < new Date()) {
        // Referral has expired - mark as expired
        await db
          .update(referralSchema)
          .set({ status: 'expired' })
          .where(eq(referralSchema.id, referral.id));
      } else {
        // Within expiry window - update to 'booked'
        await db
          .update(referralSchema)
          .set({ status: 'booked' })
          .where(eq(referralSchema.id, referral.id));
      }
    }

    if (!googleReviewEvent || googleReviewEvent.syncMode === 'bidirectional') {
      await enqueueGoogleCalendarUpsert({
        appointmentId: appointment.id,
        salonId: salon.id,
        salonName: salon.name,
        clientName,
        clientPhone: salonClient.phone,
        serviceNames: services.map(s => s.name),
        technicianName: technician?.name ?? null,
        startTime,
        endTime,
        totalPrice,
        totalDurationMinutes,
        timeZone: bookingConfig.timezone,
        locationName: validatedLocation?.name ?? null,
        locationAddress: formatLocationAddress(validatedLocation),
        notes: appointment.notes,
        googleCalendarEventId: appointment.googleCalendarEventId,
      });
    }

    // =========================================================================
    // 10. BUILD RESPONSE (single definition, used for cache AND return)
    // =========================================================================
    // Build response ONCE to guarantee cache and return are byte-for-byte identical
    const manageUrl = buildAppointmentManageUrl(
      { slug: salon.slug, customDomain: salon.customDomain },
      managementCapability.token,
    );
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
    // 12. SLOW WORK - SMS notifications (OUTSIDE lock window, after cache write)
    // =========================================================================
    // Use salonClient.phone as source of truth for all SMS
    const confirmationEmail = normalizedClientEmail ?? originalAppointment?.clientEmail ?? null;
    if (confirmationEmail) {
      await sendCustomerBookingConfirmationEmail({
        salonId: salon.id,
        appointmentId: appointment.id,
        to: confirmationEmail,
        salonName: salon.name,
        clientName: clientName ?? 'Guest',
        serviceNames: services.map(service => service.name),
        startTime: startTime.toISOString(),
        timeZone: bookingConfig.timezone,
        manageUrl,
      });
    }

    if (data.smsConsent?.granted) {
      await sendBookingConfirmationToClient(salon.id, {
        phone: salonClient.phone,
        clientName: clientName ?? undefined,
        appointmentId: appointment.id,
        salonName: salon.name,
        services: services.map(s => s.name),
        technicianName: technician?.name ?? 'Any available artist',
        startTime: startTime.toISOString(),
        totalPrice,
        timeZone: bookingConfig.timezone,
        manageUrl,
      });
    }

    // Salon-facing appointment alert. Runs only after the insert committed and
    // the response was cached, so abandoned sessions, holds, failed bookings
    // and idempotent replays never reach it. Failures are swallowed: a
    // notification must never undo a booking the client already saw succeed.
    await notifySalonAboutBooking({
      salonId: salon.id,
      appointmentId: appointment.id,
      actorRole,
      originalAppointment,
      newStartTime: startTime,
      newEndTime: endTime,
    });

    await sendBookingNotificationsForNewBooking({
      salon: {
        id: salon.id,
        name: salon.name,
        ownerName: salon.ownerName,
        ownerPhone: salon.ownerPhone,
        ownerEmail: salon.ownerEmail,
        features: (salon.features as SalonFeatures | null | undefined) ?? null,
        settings: (salon.settings as SalonSettings | null | undefined) ?? null,
      },
      technician: technician
        ? {
            id: technician.id,
            name: technician.name,
            phone: technician.phone,
            email: technician.email,
          }
        : null,
      appointmentId: appointment.id,
      clientName: clientName ?? 'Guest',
      clientPhone: salonClient.phone,
      services: services.map(s => s.name),
      startTime: startTime.toISOString(),
      totalDurationMinutes,
      totalPrice,
      timeZone: bookingConfig.timezone,
    });

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
