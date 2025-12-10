import { and, eq, gte, inArray, lt, lte } from 'drizzle-orm';

import { db } from '@/libs/DB';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';
import { getSalonBySlug } from '@/libs/queries';
import { guardSalonApiRoute } from '@/libs/salonStatus';
import { appointmentSchema, technicianSchema, technicianTimeOffSchema, type WeeklySchedule } from '@/models/Schema';

// =============================================================================
// GET /api/appointments/availability
// Returns booked time slots for a given date and optional technician
// This considers:
// - Appointment DURATION + BUFFER
// - Technician's weekly schedule (working hours)
// =============================================================================

// Buffer time between appointments (cleanup time)
const BUFFER_MINUTES = 10;

// Toronto timezone - all schedule times are stored in Toronto local time
const TORONTO_TZ = 'America/Toronto';

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

// Helper to check if a time slot is within a technician's working hours
function isSlotWithinSchedule(
  slotTime: string, // "HH:MM"
  daySchedule: { start: string; end: string } | null | undefined,
): boolean {
  if (!daySchedule) return false; // Day off

  const [slotHour, slotMin] = slotTime.split(':').map(Number);
  const [startHour, startMin] = daySchedule.start.split(':').map(Number);
  const [endHour, endMin] = daySchedule.end.split(':').map(Number);

  const slotMinutes = (slotHour || 0) * 60 + (slotMin || 0);
  const startMinutes = (startHour || 0) * 60 + (startMin || 0);
  const endMinutes = (endHour || 0) * 60 + (endMin || 0);

  // Slot must start at or after working hours start, and before end (with 30 min buffer for service)
  return slotMinutes >= startMinutes && slotMinutes < endMinutes - 30;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date'); // YYYY-MM-DD format
  const salonSlug = searchParams.get('salonSlug');
  const technicianId = searchParams.get('technicianId'); // Optional

  // Validate required params
  if (!date || !salonSlug) {
    return Response.json(
      { error: { code: 'INVALID_REQUEST', message: 'date and salonSlug are required' } },
      { status: 400 },
    );
  }

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return Response.json(
      { error: { code: 'INVALID_DATE', message: 'Date must be in YYYY-MM-DD format' } },
      { status: 400 },
    );
  }

  try {
    // Get salon
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
        { status: 404 },
      );
    }

    // Check salon status - block availability checks for suspended/cancelled salons
    const statusGuard = await guardSalonApiRoute(salon.id);
    if (statusGuard) {
      return statusGuard;
    }

    // Parse the date to get day of week
    // Use Toronto timezone to ensure correct day-of-week calculation on UTC servers
    const [year, month, day] = date.split('-').map(Number);
    const selectedDate = new Date(year!, month! - 1, day!);
    // Convert to Toronto timezone before getting day of week
    const selectedDateInToronto = new Date(selectedDate.toLocaleString('en-US', { timeZone: TORONTO_TZ }));
    const dayOfWeek = selectedDateInToronto.getDay(); // 0 = Sunday, 6 = Saturday
    const dayName = DAY_NAMES[dayOfWeek]!;

    // Calculate date range for the given day
    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59`);

    // Generate all possible time slots (9 AM to 5:30 PM in 30-min increments)
    const allSlots: string[] = [];
    for (let hour = 9; hour < 18; hour++) {
      allSlots.push(`${hour}:00`);
      allSlots.push(`${hour}:30`);
    }

    // Get technician(s) to check
    let technicians: { id: string; weeklySchedule: WeeklySchedule | null }[] = [];

    if (technicianId && technicianId !== 'any') {
      // Specific technician
      const tech = await db
        .select({
          id: technicianSchema.id,
          weeklySchedule: technicianSchema.weeklySchedule,
        })
        .from(technicianSchema)
        .where(
          and(
            eq(technicianSchema.id, technicianId),
            eq(technicianSchema.salonId, salon.id),
            eq(technicianSchema.isActive, true),
          ),
        )
        .limit(1);

      if (tech.length > 0) {
        technicians = tech;
      }
    } else {
      // "Any" technician - get all active technicians
      technicians = await db
        .select({
          id: technicianSchema.id,
          weeklySchedule: technicianSchema.weeklySchedule,
        })
        .from(technicianSchema)
        .where(
          and(
            eq(technicianSchema.salonId, salon.id),
            eq(technicianSchema.isActive, true),
          ),
        );
    }

    // Filter out technicians who are on time off for this date
    if (technicians.length > 0) {
      try {
        const techIds = technicians.map(t => t.id);
        const techsOnTimeOff = await db
          .select({ technicianId: technicianTimeOffSchema.technicianId })
          .from(technicianTimeOffSchema)
          .where(
            and(
              inArray(technicianTimeOffSchema.technicianId, techIds),
              lte(technicianTimeOffSchema.startDate, selectedDate),
              gte(technicianTimeOffSchema.endDate, selectedDate),
            ),
          );

        if (techsOnTimeOff.length > 0) {
          const timeOffTechIds = new Set(techsOnTimeOff.map(t => t.technicianId));
          technicians = technicians.filter(t => !timeOffTechIds.has(t.id));
        }
      } catch (timeOffError) {
        // Table might not exist yet - continue without time off filtering
        console.warn('Time off query failed (table may not exist):', timeOffError);
      }
    }

    // If no technicians found, all slots are unavailable
    if (technicians.length === 0) {
      return Response.json({
        date,
        salonSlug,
        technicianId: technicianId || null,
        bookedSlots: allSlots, // All slots unavailable
        appointmentCount: 0,
        reason: 'no_technicians',
      });
    }

    // For "any" technician: a slot is available if ANY tech can take it
    // For specific technician: check only their schedule and appointments
    const blockedSlots = new Set<string>();

    if (technicianId && technicianId !== 'any') {
      // Single technician mode
      const tech = technicians[0]!;
      const schedule = tech.weeklySchedule as WeeklySchedule | null;
      const daySchedule = schedule?.[dayName];

      // First, block all slots outside working hours
      for (const slot of allSlots) {
        if (!isSlotWithinSchedule(slot, daySchedule)) {
          blockedSlots.add(slot);
        }
      }

      // Then, block slots that overlap with existing appointments
      const appointments = await db
        .select({
          startTime: appointmentSchema.startTime,
          endTime: appointmentSchema.endTime,
        })
        .from(appointmentSchema)
        .where(
          and(
            eq(appointmentSchema.salonId, salon.id),
            eq(appointmentSchema.technicianId, technicianId),
            gte(appointmentSchema.startTime, startOfDay),
            lt(appointmentSchema.startTime, endOfDay),
            inArray(appointmentSchema.status, ['pending', 'confirmed']),
          ),
        );

      for (const apt of appointments) {
        const aptStart = new Date(apt.startTime);
        const aptEnd = new Date(apt.endTime);
        const aptEndWithBuffer = new Date(aptEnd.getTime() + BUFFER_MINUTES * 60 * 1000);

        for (const slot of allSlots) {
          const [hours, minutes] = slot.split(':').map(Number);
          const slotStart = new Date(startOfDay);
          slotStart.setHours(hours || 0, minutes || 0, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

          const overlaps = !(slotEnd <= aptStart || slotStart >= aptEndWithBuffer);
          if (overlaps) {
            blockedSlots.add(slot);
          }
        }
      }
    } else {
      // "Any" technician mode - slot is blocked only if ALL technicians are unavailable
      for (const slot of allSlots) {
        let anyTechAvailable = false;

        for (const tech of technicians) {
          const schedule = tech.weeklySchedule as WeeklySchedule | null;
          const daySchedule = schedule?.[dayName];

          // Check if this tech works at this time
          if (!isSlotWithinSchedule(slot, daySchedule)) {
            continue; // This tech doesn't work at this time
          }

          // Check if this tech has an appointment at this time
          const [hours, minutes] = slot.split(':').map(Number);
          const slotStart = new Date(startOfDay);
          slotStart.setHours(hours || 0, minutes || 0, 0, 0);
          const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

          const appointments = await db
            .select({ id: appointmentSchema.id, endTime: appointmentSchema.endTime })
            .from(appointmentSchema)
            .where(
              and(
                eq(appointmentSchema.salonId, salon.id),
                eq(appointmentSchema.technicianId, tech.id),
                gte(appointmentSchema.startTime, startOfDay),
                lt(appointmentSchema.startTime, endOfDay),
                inArray(appointmentSchema.status, ['pending', 'confirmed']),
              ),
            );

          // Check if any appointment overlaps with this slot
          let hasOverlap = false;
          for (const apt of appointments) {
            // We need the start time too - let me fetch it properly
            const fullApt = await db
              .select({ startTime: appointmentSchema.startTime, endTime: appointmentSchema.endTime })
              .from(appointmentSchema)
              .where(eq(appointmentSchema.id, apt.id))
              .limit(1);

            if (fullApt.length > 0) {
              const aptStart = new Date(fullApt[0]!.startTime);
              const aptEnd = new Date(fullApt[0]!.endTime);
              const aptEndBuf = new Date(aptEnd.getTime() + BUFFER_MINUTES * 60 * 1000);

              if (!(slotEnd <= aptStart || slotStart >= aptEndBuf)) {
                hasOverlap = true;
                break;
              }
            }
          }

          if (!hasOverlap) {
            anyTechAvailable = true;
            break; // At least one tech is available for this slot
          }
        }

        if (!anyTechAvailable) {
          blockedSlots.add(slot);
        }
      }
    }

    const bookedSlots = Array.from(blockedSlots);

    return Response.json({
      date,
      salonSlug,
      technicianId: technicianId || null,
      bookedSlots,
      appointmentCount: bookedSlots.length,
    });
  } catch (error) {
    console.error('[Availability API] Error:', error);
    return Response.json(
      { error: { code: 'SERVER_ERROR', message: 'Failed to fetch availability' } },
      { status: 500 },
    );
  }
}
