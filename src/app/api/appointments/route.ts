import { createHash } from 'node:crypto';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  BOOKING_LOCK_MS,
  BOOKING_POLL_WINDOW_MS,
  EXTEND_IF_OWNER_LUA,
  getBookingIdempotencyKey,
  getBookingLockKey,
  TTL,
} from '@/core/redis/keys';
import { isRedisAvailable, redis } from '@/core/redis/redisClient';
import {
  canTechnicianTakeAppointment,
  getTorontoDateString,
  loadBookingPolicy,
  resolveTechnicianCapabilityMode,
} from '@/libs/bookingPolicy';
import { requireAdminSalon, requireAdmin } from '@/libs/adminAuth';
import { requireClientApiSession } from '@/libs/clientApiGuards';
import { getBookingConfigForSalon, resolveIntroPriceLabel } from '@/libs/bookingConfig';
import { db } from '@/libs/DB';
import { getEffectiveStaffVisibility } from '@/libs/featureGating';
import { resolveSalonLoyaltyPoints } from '@/libs/loyalty';
import { validatePublicBookingSelection } from '@/libs/bookingQuote';
import {
  getActiveAppointmentsForClient,
  getAppointmentById,
  getClientByPhone,
  getLocationById,
  getOrCreateSalonClient,
  getPrimaryLocation,
  getSalonBySlug,
  getServicesByIds,
  getTechnicianById,
  getTechniciansBySalonId,
  normalizePhone,
  upsertSalonClient,
} from '@/libs/queries';
import { redactAppointmentForStaff } from '@/libs/redact';
import { guardFeatureEntitlement, guardSalonApiRoute } from '@/libs/salonStatus';
import {
  sendBookingConfirmationToClient,
  sendBookingNotificationToTech,
  sendCancellationNotificationToTech,
  sendRescheduleConfirmation,
} from '@/libs/SMS';
import { requireStaffSession } from '@/libs/staffAuth';
import {
  type Appointment,
  appointmentAddOnSchema,
  APPOINTMENT_STATUSES,
  appointmentSchema,
  type AppointmentService,
  appointmentServicesSchema,
  appointmentPhotoSchema,
  referralSchema,
  type Reward,
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
  clientName: z.string().optional(),
  startTime: z.string().datetime({ message: 'Invalid datetime format. Use ISO 8601.' }),
  // Optional: Location for multi-location salons
  locationId: z.string().optional(),
  // Optional: If provided, this is a reschedule - bypass duplicate check and cancel the original
  originalAppointmentId: z.string().optional(),
});

type CreateAppointmentRequest = z.infer<typeof createAppointmentSchema>;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

type AppointmentResponse = {
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
    const normalizedTechnicianId = (!rawTechId || rawTechId.toLowerCase() === 'any') ? null : rawTechId;

    // Normalize clientName: trim + empty→null
    const normalizedClientName = data.clientName?.trim() || null;

    // Normalize locationId: trim + empty→null
    const normalizedLocationId = data.locationId?.trim() || null;

    // Normalize originalAppointmentId: trim + empty→null
    const normalizedOriginalApptId = data.originalAppointmentId?.trim() || null;
    const normalizedBaseServiceId = data.baseServiceId?.trim() || null;
    const normalizedSelectedAddOns = data.selectedAddOns ?? [];
    const normalizedLegacyServiceIds = data.serviceIds ?? [];

    // Validate and canonicalize startTime: must be valid ISO, convert to UTC
    const parsedStartTime = new Date(data.startTime);
    if (Number.isNaN(parsedStartTime.getTime())) {
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
    const canonicalStartTime = parsedStartTime.toISOString(); // UTC ISO

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

    let actorRole: 'client' | 'staff' | 'admin' = 'client';
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
        if (!clientAuth.ok) {
          return clientAuth.response;
        }
        clientPhoneInput = clientAuth.normalizedPhone;
      }
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
            message: 'Phone number must be a valid 10-digit US number',
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
    let lockKey: string | null = null;
    let lockOwnerToken: string | null = null;
    let idempotencyEnabled = false; // Master flag - if false, skip ALL idempotency codepaths
    let ownsLock = false; // Track if we successfully acquired and still own the lock

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
          startTime: canonicalStartTime, // UTC ISO (validated above)
          locationId: normalizedLocationId, // Trimmed + empty→null
          originalAppointmentId: normalizedOriginalApptId, // Trimmed + empty→null
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
    const bookingConfig = await getBookingConfigForSalon(salon.id);
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
              message: error instanceof Error ? error.message : 'Invalid booking selection',
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
        const existingAppt = existingAppointments[0]!;
        return Response.json(
          {
            error: {
              code: 'EXISTING_APPOINTMENT',
              message: 'You already have an upcoming appointment. Please change or cancel it from your profile instead of booking another one.',
              existingAppointmentId: existingAppt.id,
              existingAppointmentDate: existingAppt.startTime.toISOString(),
            },
          } satisfies ErrorResponse & { error: { existingAppointmentId: string; existingAppointmentDate: string } },
          { status: 409 },
        );
      }
    }

    // 4c. If this is a reschedule, validate that the original appointment exists
    // and that the authenticated actor is allowed to reschedule it.
    let originalAppointment = null;
    if (normalizedOriginalApptId) {
      originalAppointment = await getAppointmentById(normalizedOriginalApptId);
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

      if (actorRole === 'client' && !clientOwnsOriginal) {
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

    // 4e. Check for active rewards that can be applied
    let appliedReward: Reward | null = null;
    let discountedServiceId: string | null = null;
    let discountAmount = 0;

    // Look for active rewards for this client that aren't expired
    // Use normalizedPhone for DB lookups
    const activeRewards = await db
      .select()
      .from(rewardSchema)
      .where(
        and(
          eq(rewardSchema.salonId, salon.id),
          eq(rewardSchema.clientPhone, normalizedPhone),
          eq(rewardSchema.status, 'active'),
        ),
      );

    // Find a reward that matches one of the booked services
    for (const reward of activeRewards) {
      // Check if reward is expired
      if (reward.expiresAt && new Date(reward.expiresAt) < new Date()) {
        // Mark as expired in background
        db.update(rewardSchema)
          .set({ status: 'expired' })
          .where(eq(rewardSchema.id, reward.id))
          .catch(err => console.error('Error expiring reward:', err));
        continue;
      }

      // Check if any booked service matches the eligible service
      const eligibleServiceName = reward.eligibleServiceName?.toLowerCase() || 'gel manicure';
      const matchingService = services.find(
        s => s.name.toLowerCase().includes(eligibleServiceName)
          || eligibleServiceName.includes(s.name.toLowerCase()),
      );

      if (matchingService) {
        appliedReward = reward;
        discountedServiceId = matchingService.id;
        discountAmount = matchingService.price;
        break;
      }
    }

    // 5. Calculate total price and duration (apply discount if reward found)
    if (appliedReward && discountAmount > 0) {
      totalPrice = Math.max(0, totalPrice - discountAmount);
      basePriceCents = Math.max(0, totalPrice - addOnsPriceCents);
    }

    if (!appliedReward) {
      basePriceCents = Math.max(0, totalPrice - addOnsPriceCents);
    }

    // 6. Compute endTime from startTime + total duration
    // Use parsedStartTime (already validated above - not Invalid Date)
    const startTime = parsedStartTime;
    const endTime = new Date(startTime.getTime() + totalDurationMinutes * 60 * 1000);
    const blockedEndTime = new Date(startTime.getTime() + blockedDurationMinutes * 60 * 1000);

    // 6b. Validate that start time is in the future with 30-minute minimum lead time
    // Use Toronto timezone for the comparison
    const torontoNowString = new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' });
    const torontoNow = new Date(torontoNowString);

    // Add 30-minute buffer - appointments must be at least 30 minutes in the future
    const MIN_LEAD_TIME_MINUTES = 30;
    const minimumStartTime = new Date(torontoNow.getTime() + MIN_LEAD_TIME_MINUTES * 60 * 1000);

    if (startTime <= torontoNow) {
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

    if (startTime < minimumStartTime) {
      return Response.json(
        {
          error: {
            code: 'TOO_SOON',
            message: 'Appointments must be booked at least 30 minutes in advance. Please select a later time.',
          },
        } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const bookingDate = getTorontoDateString(startTime);
    const bookingStartOfDay = new Date(`${bookingDate}T00:00:00`);
    const bookingEndOfDay = new Date(`${bookingDate}T23:59:59.999`);

    const candidateTechnicians = technician
      ? [technician]
      : await getTechniciansBySalonId(salon.id);

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

    const capabilityMode = resolveTechnicianCapabilityMode(candidateTechnicians, services);

    const initialPolicy = await loadBookingPolicy({
      salonId: salon.id,
      technicianIds: candidateTechnicians.map(tech => tech.id),
      date: bookingDate,
      selectedDate: bookingStartOfDay,
      startOfDay: bookingStartOfDay,
      endOfDay: bookingEndOfDay,
      excludedAppointmentId: normalizedOriginalApptId,
    });

    if (technician) {
      const decision = canTechnicianTakeAppointment({
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

      if (!decision.available) {
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
    } else {
      technician = candidateTechnicians.find((tech) => {
        const decision = canTechnicianTakeAppointment({
          startTime,
          endTime: blockedEndTime,
          weeklySchedule: tech.weeklySchedule as WeeklySchedule | null,
          override: initialPolicy.overridesByTechnician.get(tech.id),
          isOnTimeOff: initialPolicy.timeOffTechnicianIds.has(tech.id),
          blockedSlots: initialPolicy.blockedSlotsByTechnician.get(tech.id) ?? [],
          requestedServices: services,
          capabilityMode,
          enabledServiceIds: tech.enabledServiceIds ?? [],
          specialties: tech.specialties ?? [],
          locationId: validatedLocationId,
          primaryLocationId: tech.primaryLocationId ?? null,
          locationBusinessHours: validatedLocation?.businessHours ?? null,
          existingAppointments: initialPolicy.appointmentsByTechnician.get(tech.id) ?? [],
          excludedAppointmentId: normalizedOriginalApptId,
          bufferMinutes: 0,
        });

        return decision.available;
      }) ?? null;

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

    if (!normalizedTechnicianId) {
      technician = candidateTechnicians.find((tech) => {
        const decision = canTechnicianTakeAppointment({
          startTime,
          endTime: blockedEndTime,
          weeklySchedule: tech.weeklySchedule as WeeklySchedule | null,
          override: finalPolicy.overridesByTechnician.get(tech.id),
          isOnTimeOff: finalPolicy.timeOffTechnicianIds.has(tech.id),
          blockedSlots: finalPolicy.blockedSlotsByTechnician.get(tech.id) ?? [],
          requestedServices: services,
          capabilityMode,
          enabledServiceIds: tech.enabledServiceIds ?? [],
          specialties: tech.specialties ?? [],
          locationId: validatedLocationId,
          primaryLocationId: tech.primaryLocationId ?? null,
          locationBusinessHours: validatedLocation?.businessHours ?? null,
          existingAppointments: finalPolicy.appointmentsByTechnician.get(tech.id) ?? [],
          excludedAppointmentId: normalizedOriginalApptId,
          bufferMinutes: 0,
        });

        return decision.available;
      }) ?? null;
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

    // 7b. Resolve salonClientId BEFORE appointment insert (required for fraud detection)
    // This ensures stable client identity and enables fraud queries by salonClientId
    // getOrCreateSalonClient normalizes phone internally - pass raw phone
    const salonClient = await getOrCreateSalonClient(
      salon.id,
      clientPhoneInput ?? normalizedPhone,
      clientName ?? undefined,
    );

    if (!salonClient) {
      // Phone was invalid (getOrCreateSalonClient returns null for invalid phones)
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

    // 7c. Generate appointment ID
    const appointmentId = `appt_${crypto.randomUUID()}`;

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
          const [createdAppointment] = await tx
            .insert(appointmentSchema)
            .values({
              id: appointmentId,
              salonId: salon.id,
              technicianId: technician?.id ?? null,
              locationId: validatedLocationId,
              clientPhone: salonClient.phone,
              clientName,
              salonClientId: salonClient.id,
              startTime,
              endTime,
              status: 'pending',
              totalPrice,
              totalDurationMinutes,
              basePriceCents,
              addOnsPriceCents,
              baseDurationMinutes,
              addOnsDurationMinutes,
              bufferMinutes,
              blockedDurationMinutes,
            })
            .returning();

          if (!createdAppointment) {
            throw new Error('FAILED_TO_CREATE_RESCHEDULE_APPOINTMENT');
          }

          const insertedServices: AppointmentService[] = [];
          for (const service of services) {
            const priceAtBooking = (appliedReward && service.id === discountedServiceId)
              ? 0
              : service.price;

            const [apptService] = await tx
              .insert(appointmentServicesSchema)
              .values({
                id: `apptSvc_${crypto.randomUUID()}`,
                appointmentId: createdAppointment.id,
                serviceId: service.id,
                priceAtBooking,
                durationAtBooking: service.durationMinutes,
                nameSnapshot: service.name,
                categorySnapshot: service.category,
                priceCentsSnapshot: priceAtBooking,
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

          const [cancelledOriginal] = await tx
            .update(appointmentSchema)
            .set({
              status: 'cancelled',
              cancelReason: 'rescheduled',
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

        throw error;
      }
    } else {
      const transactionalResult = await db.transaction(async (tx) => {
        const [createdAppointment] = await tx
          .insert(appointmentSchema)
          .values({
            id: appointmentId,
            salonId: salon.id,
            technicianId: technician?.id ?? null,
            locationId: validatedLocationId,
            clientPhone: salonClient.phone,
            clientName,
            salonClientId: salonClient.id,
            startTime,
            endTime,
            status: 'pending',
            totalPrice,
            totalDurationMinutes,
            basePriceCents,
            addOnsPriceCents,
            baseDurationMinutes,
            addOnsDurationMinutes,
            bufferMinutes,
            blockedDurationMinutes,
          })
          .returning();

        if (!createdAppointment) {
          throw new Error('Failed to create appointment');
        }

        const insertedServices: AppointmentService[] = [];
        for (const service of services) {
          const priceAtBooking = (appliedReward && service.id === discountedServiceId)
            ? 0
            : service.price;

          const [apptService] = await tx
            .insert(appointmentServicesSchema)
            .values({
              id: `apptSvc_${crypto.randomUUID()}`,
              appointmentId: createdAppointment.id,
              serviceId: service.id,
              priceAtBooking,
              durationAtBooking: service.durationMinutes,
              nameSnapshot: service.name,
              categorySnapshot: service.category,
              priceCentsSnapshot: priceAtBooking,
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

        return {
          appointment: createdAppointment,
          appointmentServices: insertedServices,
          appointmentAddOns: insertedAddOns,
        };
      });

      appointment = transactionalResult.appointment;
      appointmentServices = transactionalResult.appointmentServices;
      appointmentAddOns = transactionalResult.appointmentAddOns;
    }

    // 8b. Grant welcome bonus if this is a new client (handled by upsertSalonClient)
    // getOrCreateSalonClient doesn't grant bonuses, so we still call upsertSalonClient for that
    // Use salonClient.phone as source of truth
    try {
      const loyaltyPoints = resolveSalonLoyaltyPoints(salon);
      await upsertSalonClient(salon.id, salonClient.phone, clientName ?? undefined, undefined, undefined, loyaltyPoints.welcomeBonus);
    } catch (err) {
      // Log but don't fail the booking if client upsert fails
      console.error('Failed to upsert salon client:', err);
    }

    // 9b. If this is a reschedule, cancel the original appointment and send SMS
    if (originalAppointment && normalizedOriginalApptId) {
      // Send reschedule confirmation SMS to client (gated by smsRemindersEnabled toggle)
      // Use salonClient.phone as source of truth
      await sendRescheduleConfirmation(salon.id, {
        phone: salonClient.phone,
        clientName: clientName ?? undefined,
        salonName: salon.name,
        oldStartTime: originalAppointment.startTime.toISOString(),
        newStartTime: startTime.toISOString(),
        services: services.map(s => s.name),
        technicianName: technician?.name ?? 'Any available artist',
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

    // =========================================================================
    // 10. BUILD RESPONSE (single definition, used for cache AND return)
    // =========================================================================
    // Build response ONCE to guarantee cache and return are byte-for-byte identical
    const response: SuccessResponse = {
      data: {
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
    await sendBookingConfirmationToClient(salon.id, {
      phone: salonClient.phone,
      clientName: clientName ?? undefined,
      appointmentId: appointment.id,
      salonName: salon.name,
      services: services.map(s => s.name),
      technicianName: technician?.name ?? 'Any available artist',
      startTime: startTime.toISOString(),
      totalPrice,
    });

    if (technician) {
      await sendBookingNotificationToTech(salon.id, {
        technicianId: technician.id,
        technicianName: technician.name,
        appointmentId: appointment.id,
        clientName: clientName ?? 'Guest',
        clientPhone: salonClient.phone,
        services: services.map(s => s.name),
        startTime: startTime.toISOString(),
        totalDurationMinutes,
      });
    }

    // 13. Return response (same object that was cached, if caching was enabled)
    return Response.json(response, { status: 201 });
  } catch (error) {
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

      // Build date range (safe - no identity information)
      let startOfDay: Date;
      let endOfDay: Date;

      if (startDateParam && endDateParam) {
        startOfDay = new Date(startDateParam);
        endOfDay = new Date(endDateParam);
      } else if (dateParam === 'today') {
        startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
      } else if (dateParam) {
        startOfDay = new Date(dateParam);
        startOfDay.setHours(0, 0, 0, 0);
        endOfDay = new Date(dateParam);
        endOfDay.setHours(23, 59, 59, 999);
      } else {
        startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);
      }

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
        if (!isNaN(parsed) && parsed > 0) {
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

    // Build date range for query
    let startOfDay: Date;
    let endOfDay: Date;

    if (startDateParam && endDateParam) {
      startOfDay = new Date(startDateParam);
      endOfDay = new Date(endDateParam);
    } else if (dateParam === 'today') {
      startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
    } else if (dateParam) {
      startOfDay = new Date(dateParam);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(dateParam);
      endOfDay.setHours(23, 59, 59, 999);
    } else {
      startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
    }

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
      if (!isNaN(limit) && limit > 0) {
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
