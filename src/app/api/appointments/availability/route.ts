import {
  buildBlockedSlotWindow,
  canTechnicianTakeAppointment,
  loadBookingPolicy,
  resolveTechnicianCapabilityMode,
  type RequestedService,
} from '@/libs/bookingPolicy';
import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { parseSelectedAddOnsParam } from '@/libs/bookingParams';
import { validatePublicBookingSelection } from '@/libs/bookingQuote';
import {
  getLocationById,
  getSalonBySlug,
  getServicesByIds,
  getTechnicianById,
  getTechniciansBySalonId,
} from '@/libs/queries';
import { guardSalonApiRoute } from '@/libs/salonStatus';
import { type WeeklySchedule } from '@/models/Schema';

export const dynamic = 'force-dynamic';

const DEFAULT_DURATION_MINUTES = 30;

function getAllSlots(intervalMinutes: number): string[] {
  const slots: string[] = [];

  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += intervalMinutes) {
      slots.push(`${hour}:${minute.toString().padStart(2, '0')}`);
    }
  }

  return slots;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const salonSlug = searchParams.get('salonSlug');
  const technicianId = searchParams.get('technicianId');
  const originalAppointmentId = searchParams.get('originalAppointmentId');
  const durationParam = searchParams.get('durationMinutes');
  const locationId = searchParams.get('locationId');
  const serviceIdList = searchParams.get('serviceIds')?.split(',').filter(Boolean) ?? [];
  const baseServiceId = searchParams.get('baseServiceId');
  const selectedAddOns = parseSelectedAddOnsParam(searchParams.get('selectedAddOns'));

  if (!date || !salonSlug) {
    return Response.json(
      { error: { code: 'INVALID_REQUEST', message: 'date and salonSlug are required' } },
      { status: 400 },
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: { code: 'INVALID_DATE', message: 'Date must be in YYYY-MM-DD format' } },
      { status: 400 },
    );
  }

  try {
    const salon = await getSalonBySlug(salonSlug);
    if (!salon) {
      return Response.json(
        { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
        { status: 404 },
      );
    }

    const statusGuard = await guardSalonApiRoute(salon.id);
    if (statusGuard) {
      return statusGuard;
    }

    const bookingConfig = await getBookingConfigForSalon(salon.id);
    const [year, month, day] = date.split('-').map(Number);
    const selectedDate = new Date(year!, month! - 1, day!);
    const startOfDay = new Date(`${date}T00:00:00`);
    const endOfDay = new Date(`${date}T23:59:59.999`);
    const allSlots = getAllSlots(bookingConfig.slotIntervalMinutes);

    const location = locationId
      ? await getLocationById(locationId, salon.id)
      : null;

    if (locationId && !location) {
      return Response.json(
        {
          error: {
            code: 'INVALID_LOCATION',
            message: 'Location not found for this salon',
          },
        },
        { status: 400 },
      );
    }

    let requestedServices: RequestedService[] = [];
    let visibleDurationMinutes = DEFAULT_DURATION_MINUTES;
    let bufferMinutes = bookingConfig.bufferMinutes;

    if (baseServiceId) {
      try {
        const validatedSelection = await validatePublicBookingSelection({
          salonId: salon.id,
          selection: {
            baseServiceId,
            selectedAddOns,
          },
          technicianId: technicianId && technicianId !== 'any' ? technicianId : null,
        });

        requestedServices = [validatedSelection.baseServiceRecord];
        visibleDurationMinutes = validatedSelection.quote.visibleDurationMinutes;
        bufferMinutes = validatedSelection.quote.bufferMinutes;
      } catch (error) {
        return Response.json(
          {
            error: {
              code: 'INVALID_SELECTION',
              message: error instanceof Error ? error.message : 'Invalid booking selection',
            },
          },
          { status: 400 },
        );
      }
    } else {
      const requestedLegacyServices = serviceIdList.length > 0
        ? await getServicesByIds(serviceIdList, salon.id)
        : [];

      if (requestedLegacyServices.length !== serviceIdList.length) {
        return Response.json(
          {
            error: {
              code: 'INVALID_SERVICES',
              message: 'One or more services not found for this salon',
            },
          },
          { status: 400 },
        );
      }

      requestedServices = requestedLegacyServices;
      visibleDurationMinutes = durationParam
        ? Number.parseInt(durationParam, 10)
        : (requestedLegacyServices.length > 0
            ? requestedLegacyServices.reduce((sum, service) => sum + service.durationMinutes, 0)
            : DEFAULT_DURATION_MINUTES);
    }

    if (!Number.isFinite(visibleDurationMinutes) || visibleDurationMinutes <= 0) {
      return Response.json(
        { error: { code: 'INVALID_DURATION', message: 'durationMinutes must be a positive integer' } },
        { status: 400 },
      );
    }

    let technicians: Array<{
      id: string;
      weeklySchedule: WeeklySchedule | null;
      enabledServiceIds?: string[];
      serviceIds?: string[];
      specialties?: string[] | null;
      primaryLocationId?: string | null;
    }> = [];

    if (technicianId && technicianId !== 'any') {
      const technician = await getTechnicianById(technicianId, salon.id);
      technicians = technician ? [technician] : [];
    } else {
      technicians = await getTechniciansBySalonId(salon.id);
    }

    if (technicians.length === 0) {
      return Response.json({
        date,
        salonSlug,
        technicianId: technicianId || null,
        visibleSlots: [],
        bookedSlots: [],
        appointmentCount: 0,
        reason: 'no_technicians',
      });
    }

    const capabilityMode = resolveTechnicianCapabilityMode(
      technicians,
      requestedServices as RequestedService[],
    );

    const bookingPolicy = await loadBookingPolicy({
      salonId: salon.id,
      technicianIds: technicians.map(tech => tech.id),
      date,
      selectedDate,
      startOfDay,
      endOfDay,
      excludedAppointmentId: originalAppointmentId,
    });

    const visibleSlots: string[] = [];
    const blockedSlots = new Set<string>();

    for (const slot of allSlots) {
      const { startTime, blockedEndTime } = buildBlockedSlotWindow(
        startOfDay,
        slot,
        visibleDurationMinutes,
        bufferMinutes,
      );

      const anyTechVisible = technicians.some((tech) => {
        const visibleDecision = canTechnicianTakeAppointment({
          startTime,
          endTime: blockedEndTime,
          weeklySchedule: tech.weeklySchedule as WeeklySchedule | null,
          override: bookingPolicy.overridesByTechnician.get(tech.id),
          isOnTimeOff: bookingPolicy.timeOffTechnicianIds.has(tech.id),
          blockedSlots: bookingPolicy.blockedSlotsByTechnician.get(tech.id) ?? [],
          requestedServices,
          capabilityMode,
          enabledServiceIds: tech.enabledServiceIds ?? [],
          specialties: tech.specialties ?? [],
          locationId: location?.id ?? null,
          primaryLocationId: tech.primaryLocationId ?? null,
          locationBusinessHours: location?.businessHours ?? null,
          existingAppointments: [],
          excludedAppointmentId: originalAppointmentId,
          bufferMinutes: 0,
        });

        return visibleDecision.available;
      });

      if (!anyTechVisible) {
        continue;
      }

      visibleSlots.push(slot);

      const anyTechAvailable = technicians.some((tech) => {
        const decision = canTechnicianTakeAppointment({
          startTime,
          endTime: blockedEndTime,
          weeklySchedule: tech.weeklySchedule as WeeklySchedule | null,
          override: bookingPolicy.overridesByTechnician.get(tech.id),
          isOnTimeOff: bookingPolicy.timeOffTechnicianIds.has(tech.id),
          blockedSlots: bookingPolicy.blockedSlotsByTechnician.get(tech.id) ?? [],
          requestedServices,
          capabilityMode,
          enabledServiceIds: tech.enabledServiceIds ?? [],
          specialties: tech.specialties ?? [],
          locationId: location?.id ?? null,
          primaryLocationId: tech.primaryLocationId ?? null,
          locationBusinessHours: location?.businessHours ?? null,
          existingAppointments: bookingPolicy.appointmentsByTechnician.get(tech.id) ?? [],
          excludedAppointmentId: originalAppointmentId,
          bufferMinutes: 0,
        });

        return decision.available;
      });

      if (!anyTechAvailable) {
        blockedSlots.add(slot);
      }
    }

    const bookedSlots = Array.from(blockedSlots);

    return Response.json({
      date,
      salonSlug,
      technicianId: technicianId || null,
      durationMinutes: visibleDurationMinutes,
      visibleDurationMinutes,
      blockedDurationMinutes: visibleDurationMinutes + bufferMinutes,
      visibleSlots,
      bookedSlots,
      appointmentCount: bookedSlots.length,
    });
  } catch (error) {
    console.error('[Availability API] Error:', {
      date,
      salonSlug,
      technicianId,
      durationMinutes: durationParam ? Number.parseInt(durationParam, 10) : null,
      baseServiceId,
      selectedAddOns,
      serviceIds: serviceIdList,
      locationId,
      originalAppointmentId,
      error: error instanceof Error
        ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
        : error,
    });
    return Response.json(
      {
        error: {
          code: 'SERVER_ERROR',
          message: 'Unable to evaluate availability for the selected day.',
        },
      },
      { status: 500 },
    );
  }
}
