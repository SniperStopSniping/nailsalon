import { createHash } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { db } from '@/libs/DB';
import { getEffectiveStaffVisibility } from '@/libs/featureGating';
import { resolveSalonLoyaltyPoints } from '@/libs/loyalty';
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
  normalizePhone,
  updateAppointmentStatus,
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
import { hasStaffSessionCookies, requireStaffSession } from '@/libs/staffAuth';
import {
  type Appointment,
  APPOINTMENT_STATUSES,
  appointmentSchema,
  type AppointmentService,
  appointmentServicesSchema,
  referralSchema,
  type Reward,
  rewardSchema,
  salonSchema,
  type Service,
  technicianSchema,
  type WeeklySchedule,
} from '@/models/Schema';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

// =============================================================================
// CONSTANTS
// =============================================================================

// Buffer time between appointments (cleanup time)
const BUFFER_MINUTES = 10;

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

// Days of week mapping
const DAY_NAMES: (keyof WeeklySchedule)[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

// =============================================================================
// HELPERS
// =============================================================================

// Check if a time is within a technician's working hours for a given day
function isWithinSchedule(
  startTime: Date,
  endTime: Date,
  schedule: WeeklySchedule | null,
): { valid: boolean; reason?: string } {
  if (!schedule) {
    return { valid: false, reason: 'Technician has no schedule configured' };
  }

  // Convert to Toronto timezone for proper comparison
  // This is critical because Vercel servers run in UTC, but schedule times are stored as Toronto local time
  const TORONTO_TZ = 'America/Toronto';
  const startInToronto = new Date(startTime.toLocaleString('en-US', { timeZone: TORONTO_TZ }));
  const endInToronto = new Date(endTime.toLocaleString('en-US', { timeZone: TORONTO_TZ }));

  const dayOfWeek = startInToronto.getDay(); // 0 = Sunday, 6 = Saturday
  const dayName = DAY_NAMES[dayOfWeek]!;
  const daySchedule = schedule[dayName];

  if (!daySchedule) {
    return { valid: false, reason: `Technician does not work on ${dayName}s` };
  }

  // Parse start and end hours from schedule
  const [schedStartHour, schedStartMin] = daySchedule.start.split(':').map(Number);
  const [schedEndHour, schedEndMin] = daySchedule.end.split(':').map(Number);

  // Get appointment times in minutes from midnight (using Toronto-converted times)
  const apptStartMinutes = startInToronto.getHours() * 60 + startInToronto.getMinutes();
  const apptEndMinutes = endInToronto.getHours() * 60 + endInToronto.getMinutes();
  const schedStartMinutes = (schedStartHour || 0) * 60 + (schedStartMin || 0);
  const schedEndMinutes = (schedEndHour || 0) * 60 + (schedEndMin || 0);

  // Appointment must start at or after schedule start
  if (apptStartMinutes < schedStartMinutes) {
    return {
      valid: false,
      reason: `Appointment starts before technician's shift (${daySchedule.start})`,
    };
  }

  // Appointment must end at or before schedule end
  if (apptEndMinutes > schedEndMinutes) {
    return {
      valid: false,
      reason: `Appointment ends after technician's shift (${daySchedule.end})`,
    };
  }

  return { valid: true };
}

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

const createAppointmentSchema = z.object({
  salonSlug: z.string().min(1, 'Salon slug is required'),
  serviceIds: z.array(z.string()).min(1, 'At least one service is required'),
  technicianId: z.string().nullable(), // null = "any artist"
  clientPhone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
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

    // Normalize phone for early validation and hash computation
    // NOTE: getOrCreateSalonClient also normalizes internally (single source of truth for DB)
    // We normalize here too for: (1) early fail-fast, (2) hash consistency, (3) duplicate checks
    const normalizedPhone = normalizePhone(data.clientPhone);
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

    // Normalize clientName: trim + empty→null
    const normalizedClientName = data.clientName?.trim() || null;

    // Normalize locationId: trim + empty→null
    const normalizedLocationId = data.locationId?.trim() || null;

    // Normalize originalAppointmentId: trim + empty→null
    const normalizedOriginalApptId = data.originalAppointmentId?.trim() || null;

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
          serviceIds: [...data.serviceIds].sort(), // Sorted for consistency
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

    // 3. Validate services belong to salon
    const services = await getServicesByIds(data.serviceIds, salon.id);

    if (services.length !== data.serviceIds.length) {
      const foundIds = new Set(services.map(s => s.id));
      const missingIds = data.serviceIds.filter(id => !foundIds.has(id));
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
    } else {
      // No locationId provided - use primary location if exists
      const primaryLocation = await getPrimaryLocation(salon.id);
      validatedLocationId = primaryLocation?.id ?? null;
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

    // 4c. If this is a reschedule, validate that the original appointment exists and belongs to this client
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

      // Verify the original appointment belongs to this client
      // Compare normalized phones (both 10-digit)
      const normalizedOriginalPhone = normalizePhone(originalAppointment.clientPhone);
      if (normalizedPhone !== normalizedOriginalPhone) {
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
    let totalPrice = services.reduce((sum, s) => sum + s.price, 0);
    if (appliedReward && discountAmount > 0) {
      totalPrice = Math.max(0, totalPrice - discountAmount);
    }
    const totalDurationMinutes = services.reduce((sum, s) => sum + s.durationMinutes, 0);

    // 6. Compute endTime from startTime + total duration
    // Use parsedStartTime (already validated above - not Invalid Date)
    const startTime = parsedStartTime;
    const endTime = new Date(startTime.getTime() + totalDurationMinutes * 60 * 1000);

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

    // 6d. Validate appointment is within technician's working hours (if specific tech selected)
    if (technician) {
      const schedule = technician.weeklySchedule as WeeklySchedule | null;
      const scheduleCheck = isWithinSchedule(startTime, endTime, schedule);

      if (!scheduleCheck.valid) {
        return Response.json(
          {
            error: {
              code: 'OUTSIDE_SCHEDULE',
              message: scheduleCheck.reason || 'Appointment is outside technician\'s working hours',
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // 6e. Auto-assign technician if "any artist" was selected
    if (!technician) {
      // Get all active technicians for this salon
      const allTechnicians = await db
        .select()
        .from(technicianSchema)
        .where(
          and(
            eq(technicianSchema.salonId, salon.id),
            eq(technicianSchema.isActive, true),
          ),
        );

      // Find an available technician
      for (const tech of allTechnicians) {
        const schedule = tech.weeklySchedule as WeeklySchedule | null;

        // Check if this tech works at the requested time
        const scheduleCheck = isWithinSchedule(startTime, endTime, schedule);
        if (!scheduleCheck.valid) {
          continue; // This tech doesn't work at this time
        }

        // Check if this tech has any overlapping appointments
        const techAppointments = await db
          .select({
            startTime: appointmentSchema.startTime,
            endTime: appointmentSchema.endTime,
          })
          .from(appointmentSchema)
          .where(
            and(
              eq(appointmentSchema.salonId, salon.id),
              eq(appointmentSchema.technicianId, tech.id),
              inArray(appointmentSchema.status, ['pending', 'confirmed']),
            ),
          );

        const techHasOverlap = techAppointments.some((existing) => {
          const existingStart = new Date(existing.startTime);
          const existingEnd = new Date(existing.endTime);
          const existingEndWithBuffer = new Date(existingEnd.getTime() + BUFFER_MINUTES * 60 * 1000);
          return startTime < existingEndWithBuffer && endTime > existingStart;
        });

        if (!techHasOverlap) {
          // Found an available technician!
          technician = tech;
          break;
        }
      }

      // If no technician is available, return an error
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

    // 6c. Check for overlapping appointments (server-side double-booking prevention)
    // This prevents race conditions where two users try to book the same slot simultaneously
    // Include buffer time between appointments for cleanup

    const existingAppointments = await db
      .select({
        id: appointmentSchema.id,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
      })
      .from(appointmentSchema)
      .where(
        and(
          eq(appointmentSchema.salonId, salon.id),
          inArray(appointmentSchema.status, ['pending', 'confirmed']),
          // If a specific technician is selected, only check their appointments
          // If "any artist" (null), we need to check all appointments
          technician?.id
            ? eq(appointmentSchema.technicianId, technician.id)
            : sql`1=1`, // Always true - check all technicians for "any artist"
        ),
      );

    // Check overlap with buffer: existing appointments need buffer time after them
    const hasOverlap = existingAppointments.some((existing) => {
      const existingStart = new Date(existing.startTime);
      const existingEnd = new Date(existing.endTime);
      // Add buffer to existing appointment's end time
      const existingEndWithBuffer = new Date(existingEnd.getTime() + BUFFER_MINUTES * 60 * 1000);

      // Overlap if: newStart < existingEndWithBuffer AND newEnd > existingStart
      // This ensures the new appointment doesn't start during an existing one OR during the buffer period
      return startTime < existingEndWithBuffer && endTime > existingStart;
    });

    if (hasOverlap) {
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

    // 7b. Resolve salonClientId BEFORE appointment insert (required for fraud detection)
    // This ensures stable client identity and enables fraud queries by salonClientId
    // getOrCreateSalonClient normalizes phone internally - pass raw phone
    const salonClient = await getOrCreateSalonClient(salon.id, data.clientPhone, clientName ?? undefined);

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

    // 8. Insert appointment with salonClientId
    // Use salonClient.phone as source of truth (what getOrCreateSalonClient actually stored)
    // This guarantees appointment.clientPhone === salonClient.phone (same normalization)
    const [appointment] = await db
      .insert(appointmentSchema)
      .values({
        id: appointmentId,
        salonId: salon.id,
        technicianId: technician?.id ?? null,
        locationId: validatedLocationId,
        clientPhone: salonClient.phone, // Source of truth from salonClient
        clientName,
        salonClientId: salonClient.id, // Always set for new appointments
        startTime,
        endTime,
        status: 'pending',
        totalPrice,
        totalDurationMinutes,
      })
      .returning();

    if (!appointment) {
      throw new Error('Failed to create appointment');
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

    // 9. Insert appointment services (with price/duration snapshot)
    // Apply reward discount to the matching service if applicable
    const appointmentServices: AppointmentService[] = [];
    for (const service of services) {
      // If this service is discounted by a reward, set price to 0
      const priceAtBooking = (appliedReward && service.id === discountedServiceId)
        ? 0
        : service.price;

      const [apptService] = await db
        .insert(appointmentServicesSchema)
        .values({
          id: `apptSvc_${crypto.randomUUID()}`,
          appointmentId: appointment.id,
          serviceId: service.id,
          priceAtBooking,
          durationAtBooking: service.durationMinutes,
        })
        .returning();

      if (apptService) {
        appointmentServices.push(apptService);
      }
    }

    // 9b. If this is a reschedule, cancel the original appointment and send SMS
    if (originalAppointment && normalizedOriginalApptId) {
      await updateAppointmentStatus(
        normalizedOriginalApptId,
        'cancelled',
        'rescheduled',
      );

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
// ADMIN/PUBLIC REQUESTS (no staff session):
//   - Uses query params for filtering
//   - Still tenant-scoped via salonSlug
//   - Response: Full data (no redaction)
//
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);

    // ==========================================================================
    // SECURITY: Check for staff session FIRST
    // If staff cookies exist, staff context wins (even if admin session also exists)
    // ==========================================================================
    const hasStaffCookies = await hasStaffSessionCookies();

    if (hasStaffCookies) {
      // =======================================================================
      // STAFF REQUEST PATH (bypass-proof)
      // Identity is ONLY derived from session - query params for identity IGNORED
      // =======================================================================
      const staffAuth = await requireStaffSession();

      if (!staffAuth.ok) {
        return staffAuth.response;
      }

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

      // Fetch services and photos for each appointment
      const appointmentsWithDetails = await Promise.all(
        appointments.map(async (appt) => {
          const services = await db
            .select({
              name: sql<string>`(SELECT name FROM service WHERE id = ${appointmentServicesSchema.serviceId})`,
            })
            .from(appointmentServicesSchema)
            .where(eq(appointmentServicesSchema.appointmentId, appt.id));

          const photos = await db.query.appointmentPhotoSchema?.findMany({
            where: (photo, { eq: photoEq }) => photoEq(photo.appointmentId, appt.id),
            orderBy: (photo, { desc }) => [desc(photo.createdAt)],
          }) || [];

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
            photos: photos.map(p => ({
              id: p.id,
              imageUrl: p.imageUrl,
              thumbnailUrl: p.thumbnailUrl,
              photoType: p.photoType,
            })),
          };
        }),
      );

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
    // ADMIN/PUBLIC REQUEST PATH
    // Uses query params for filtering, still tenant-scoped
    // =========================================================================
    const dateParam = searchParams.get('date');
    const statusParam = searchParams.get('status');
    const salonSlug = searchParams.get('salonSlug');
    const technicianIdParam = searchParams.get('technicianId');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const limitParam = searchParams.get('limit');

    let salonId: string | null = null;
    let technicianId: string | null = null;

    if (salonSlug) {
      const salon = await getSalonBySlug(salonSlug);
      if (salon) {
        salonId = salon.id;
      }
    }
    technicianId = technicianIdParam;

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
    // Note: For admin, we don't reject invalid statuses with 400 - just filter them out
    // This is more permissive for admin use cases

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

    // Fetch services and photos for each appointment (admin gets full data)
    const appointmentsWithDetails = await Promise.all(
      appointments.map(async (appt) => {
        const services = await db
          .select({
            name: sql<string>`(SELECT name FROM service WHERE id = ${appointmentServicesSchema.serviceId})`,
          })
          .from(appointmentServicesSchema)
          .where(eq(appointmentServicesSchema.appointmentId, appt.id));

        const photos = await db.query.appointmentPhotoSchema?.findMany({
          where: (photo, { eq: photoEq }) => photoEq(photo.appointmentId, appt.id),
          orderBy: (photo, { desc }) => [desc(photo.createdAt)],
        }) || [];

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
          photos: photos.map(p => ({
            id: p.id,
            imageUrl: p.imageUrl,
            thumbnailUrl: p.thumbnailUrl,
            photoType: p.photoType,
          })),
        };
      }),
    );

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
