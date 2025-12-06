import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

import { db } from '@/libs/DB';
import {
  getActiveAppointmentsForClient,
  getAppointmentById,
  getClientByPhone,
  getSalonBySlug,
  getServicesByIds,
  getTechnicianById,
  updateAppointmentStatus,
} from '@/libs/queries';
import { sendBookingConfirmationToClient, sendBookingNotificationToTech } from '@/libs/SMS';
import {
  appointmentSchema,
  appointmentServicesSchema,
  referralSchema,
  rewardSchema,
  technicianSchema,
  type Appointment,
  type AppointmentService,
  type Reward,
  type Service,
  type WeeklySchedule,
} from '@/models/Schema';

// =============================================================================
// CONSTANTS
// =============================================================================

// Buffer time between appointments (cleanup time)
const BUFFER_MINUTES = 10;

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

  const dayOfWeek = startTime.getDay(); // 0 = Sunday, 6 = Saturday
  const dayName = DAY_NAMES[dayOfWeek]!;
  const daySchedule = schedule[dayName];

  if (!daySchedule) {
    return { valid: false, reason: `Technician does not work on ${dayName}s` };
  }

  // Parse start and end hours from schedule
  const [schedStartHour, schedStartMin] = daySchedule.start.split(':').map(Number);
  const [schedEndHour, schedEndMin] = daySchedule.end.split(':').map(Number);

  // Get appointment times in minutes from midnight
  const apptStartMinutes = startTime.getHours() * 60 + startTime.getMinutes();
  const apptEndMinutes = endTime.getHours() * 60 + endTime.getMinutes();
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
  // Optional: If provided, this is a reschedule - bypass duplicate check and cancel the original
  originalAppointmentId: z.string().optional(),
});

type CreateAppointmentRequest = z.infer<typeof createAppointmentSchema>;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface AppointmentResponse {
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
}

interface SuccessResponse {
  data: AppointmentResponse;
  meta: {
    timestamp: string;
  };
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
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
    let technician = null;
    if (data.technicianId && data.technicianId !== 'any') {
      technician = await getTechnicianById(data.technicianId, salon.id);
      if (!technician) {
        return Response.json(
          {
            error: {
              code: 'INVALID_TECHNICIAN',
              message: `Technician "${data.technicianId}" not found for this salon`,
            },
          } satisfies ErrorResponse,
          { status: 400 },
        );
      }
    }

    // 4b. Check for existing active appointment (duplicate booking prevention)
    // Skip this check if this is a reschedule (originalAppointmentId provided)
    if (!data.originalAppointmentId) {
      const existingAppointments = await getActiveAppointmentsForClient(
        data.clientPhone,
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
    if (data.originalAppointmentId) {
      originalAppointment = await getAppointmentById(data.originalAppointmentId);
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

      // Verify the original appointment belongs to this client (normalize phone for comparison)
      const normalizedClientPhone = data.clientPhone.replace(/\D/g, '');
      const normalizedOriginalPhone = originalAppointment.clientPhone.replace(/\D/g, '');
      if (normalizedClientPhone !== normalizedOriginalPhone) {
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
    let clientName = data.clientName;
    if (!clientName) {
      const existingClient = await getClientByPhone(data.clientPhone);
      if (existingClient?.firstName) {
        clientName = existingClient.firstName;
      }
    }

    // 4e. Check for active rewards that can be applied
    let appliedReward: Reward | null = null;
    let discountedServiceId: string | null = null;
    let discountAmount = 0;

    // Look for active rewards for this client that aren't expired
    const activeRewards = await db
      .select()
      .from(rewardSchema)
      .where(
        and(
          eq(rewardSchema.salonId, salon.id),
          eq(rewardSchema.clientPhone, data.clientPhone),
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
        s => s.name.toLowerCase().includes(eligibleServiceName) ||
             eligibleServiceName.includes(s.name.toLowerCase()),
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
    const startTime = new Date(data.startTime);
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

    // 7. Generate appointment ID
    const appointmentId = `appt_${crypto.randomUUID()}`;

    // 8. Insert appointment
    const [appointment] = await db
      .insert(appointmentSchema)
      .values({
        id: appointmentId,
        salonId: salon.id,
        technicianId: technician?.id ?? null,
        clientPhone: data.clientPhone,
        clientName,
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

    // 9b. If this is a reschedule, cancel the original appointment
    if (originalAppointment && data.originalAppointmentId) {
      await updateAppointmentStatus(
        data.originalAppointmentId,
        'cancelled',
        'rescheduled',
      );
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
    const phoneVariants = [
      data.clientPhone,
      `+1${data.clientPhone}`,
      `+${data.clientPhone}`,
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

    // 10. Send SMS notifications (stub functions)
    await sendBookingConfirmationToClient({
      phone: data.clientPhone,
      clientName,
      appointmentId: appointment.id,
      salonName: salon.name,
      services: services.map(s => s.name),
      technicianName: technician?.name ?? 'Any available artist',
      startTime: startTime.toISOString(),
      totalPrice,
    });

    if (technician) {
      await sendBookingNotificationToTech({
        technicianId: technician.id,
        technicianName: technician.name,
        appointmentId: appointment.id,
        clientName: clientName ?? 'Guest',
        clientPhone: data.clientPhone,
        services: services.map(s => s.name),
        startTime: startTime.toISOString(),
        totalDurationMinutes,
      });
    }

    // 11. Build and return response
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
          ? {
              id: technician.id,
              name: technician.name,
              avatarUrl: technician.avatarUrl,
            }
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
// Query params:
//   - date: 'today' or YYYY-MM-DD
//   - status: comma-separated list of statuses to filter by
//   - salonSlug: optional salon filter
// =============================================================================

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const statusParam = searchParams.get('status');
    // Note: salonSlug filter can be added here for multi-salon support
    // const salonSlug = searchParams.get('salonSlug');

    // Build date range for query
    let startOfDay: Date;
    let endOfDay: Date;

    if (dateParam === 'today') {
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
      // Default to today
      startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
    }

    // Parse status filter
    const statuses = statusParam ? statusParam.split(',').map(s => s.trim()) : ['confirmed', 'in_progress'];

    // Build query
    const appointments = await db
      .select()
      .from(appointmentSchema)
      .where(
        and(
          sql`${appointmentSchema.startTime} >= ${startOfDay}`,
          sql`${appointmentSchema.startTime} <= ${endOfDay}`,
          inArray(appointmentSchema.status, statuses),
        ),
      )
      .orderBy(appointmentSchema.startTime);

    // Fetch services and photos for each appointment
    const appointmentsWithDetails = await Promise.all(
      appointments.map(async (appt) => {
        // Get services
        const services = await db
          .select({
            name: sql<string>`(SELECT name FROM service WHERE id = ${appointmentServicesSchema.serviceId})`,
          })
          .from(appointmentServicesSchema)
          .where(eq(appointmentServicesSchema.appointmentId, appt.id));

        // Get photos
        const photos = await db.query.appointmentPhotoSchema?.findMany({
          where: (photo, { eq: photoEq }) => photoEq(photo.appointmentId, appt.id),
          orderBy: (photo, { desc }) => [desc(photo.createdAt)],
        }) || [];

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

