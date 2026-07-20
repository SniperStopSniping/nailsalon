import * as Sentry from '@sentry/nextjs';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { parseSelectedAddOnsParam } from '@/libs/bookingParams';
import type { RequestedService } from '@/libs/bookingPolicy';
import {
  canTechnicianTakeAppointment,
  loadBookingPolicy,
  resolveTechnicianCapabilityMode,
} from '@/libs/bookingPolicy';
import {
  BookingSelectionError,
  getPublicBookingSelectionMessage,
  getPublicTechnicianCompatibility,
  validatePublicBookingSelection,
} from '@/libs/bookingQuote';
import { getClientSession } from '@/libs/clientAuth';
import {
  FIRST_VISIT_DISCOUNT_TYPE,
  resolveAutomaticBookingDiscount,
} from '@/libs/firstVisitDiscount';
import {
  getGoogleCalendarBusyWindows,
  GoogleCalendarAvailabilityError,
  isBusyWindowConflict,
} from '@/libs/googleCalendar';
import { normalizePhone } from '@/libs/phone';
import { technicianSupportsPublicLocation } from '@/libs/publicTechnicianCompatibility';
import {
  getAppointmentById,
  getLocationById,
  getSalonBySlug,
  getServicesByIds,
  getTechnicianById,
  getTechniciansBySalonId,
} from '@/libs/queries';
import { guardSalonApiRoute } from '@/libs/salonStatus';
import { evaluateSmartFitSlot } from '@/libs/smartFit';
import {
  buildSmartFitClientKeys,
  buildSmartFitDayContext,
  buildSmartFitSlotAnnotation,
  smartFitServiceScopeAllows,
  type SmartFitSlotAnnotation,
} from '@/libs/smartFitBooking';
import { resolveSmartFitConfig } from '@/libs/smartFitConfig';
import { getZonedDayBounds, zonedTimeToUtc } from '@/libs/timeZone';
import type { WeeklySchedule } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

export const dynamic = 'force-dynamic';

const DEFAULT_DURATION_MINUTES = 30;
const MIN_LEAD_TIME_MINUTES = 120;

type PublicAvailabilityError = {
  kind: 'unsupported_technician' | 'invalid_service' | 'temporary_failure';
  message: string;
  canRetry: boolean;
  canReselectTechnician: boolean;
};

function buildPublicAvailabilityError(args: {
  error: unknown;
  canReselectTechnician?: boolean;
}): PublicAvailabilityError | null {
  if (!(args.error instanceof BookingSelectionError)) {
    return null;
  }

  if (args.error.code === 'unsupported_technician') {
    return {
      kind: 'unsupported_technician',
      message: getPublicBookingSelectionMessage(args.error),
      canRetry: false,
      canReselectTechnician: Boolean(args.canReselectTechnician),
    };
  }

  return {
    kind: 'invalid_service',
    message: getPublicBookingSelectionMessage(args.error),
    canRetry: false,
    canReselectTechnician: false,
  };
}

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
  const manageToken = searchParams.get('manageToken');
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
    const { startOfDay, endOfDay } = getZonedDayBounds(date, bookingConfig.timezone);
    const selectedDate = startOfDay;
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
    // Same records with pricing, for the automatic-discount resolution below.
    let pricedRequestedServices: Array<{ id: string; name: string; price: number }> = [];
    let visibleDurationMinutes = DEFAULT_DURATION_MINUTES;
    let bufferMinutes = bookingConfig.bufferMinutes;
    let subtotalBeforeDiscountCents = 0;

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
        pricedRequestedServices = [validatedSelection.baseServiceRecord];
        visibleDurationMinutes = validatedSelection.quote.visibleDurationMinutes;
        bufferMinutes = validatedSelection.quote.bufferMinutes;
        subtotalBeforeDiscountCents = validatedSelection.quote.subtotalCents;
      } catch (error) {
        if (!(error instanceof BookingSelectionError)) {
          throw error;
        }

        const technicians = error.code === 'unsupported_technician'
          ? await getTechniciansBySalonId(salon.id)
          : [];
        const canReselectTechnician = technicians.some(technician =>
          technician.id !== technicianId
          && technician.enabledServiceIds?.includes(baseServiceId)
          && technicianSupportsPublicLocation({ technician, locationId }),
        );
        const publicError = buildPublicAvailabilityError({ error, canReselectTechnician });

        console.warn('[Availability API] Invalid public booking selection', {
          requestPath: new URL(request.url).pathname,
          salonId: salon.id,
          serviceId: baseServiceId,
          technicianId,
          locationId,
          date,
          classification: error.code,
        });

        return Response.json(
          { error: publicError },
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
      pricedRequestedServices = requestedLegacyServices;
      visibleDurationMinutes = durationParam
        ? Number.parseInt(durationParam, 10)
        : (requestedLegacyServices.length > 0
            ? requestedLegacyServices.reduce((sum, service) => sum + service.durationMinutes, 0)
            : DEFAULT_DURATION_MINUTES);
      subtotalBeforeDiscountCents = requestedLegacyServices.reduce(
        (sum, service) => sum + service.price,
        0,
      );
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

    const compatibleTechnicians = technicians.filter(tech =>
      getPublicTechnicianCompatibility({
        selectionMode: baseServiceId ? 'base-service' : 'legacy',
        technician: tech,
        requestedServices: requestedServices as RequestedService[],
      }).bookable,
    );

    if (compatibleTechnicians.length === 0) {
      return Response.json({
        date,
        salonSlug,
        technicianId: technicianId || null,
        visibleSlots: [],
        bookedSlots: [],
        appointmentCount: 0,
        reason: 'no_compatible_technicians',
      });
    }

    technicians = compatibleTechnicians;

    // Reschedules: `originalAppointmentId` only earns the right to exclude
    // that appointment's own blocked window (and to suppress Smart Fit
    // self-adjacency below) once ownership is proven server-side — either a
    // logged-in client session whose phone matches the appointment, or a
    // manage token scoped to this exact appointment+salon. This endpoint is
    // public and unauthenticated, so a bare, unverified id is never trusted:
    // without proof, the appointment stays fully "in the way" like anyone
    // else's, which keeps this endpoint from being used as a schedule oracle
    // or identity oracle for someone else's booking.
    //
    // The session lookup is lazy and memoized: plain requests (no reschedule,
    // Smart Fit dark) never touch cookies at all, preserving the original
    // behavior and cost profile of the common path.
    let sessionPhonePromise: Promise<string | null> | null = null;
    const getSessionPhoneOnce = (): Promise<string | null> => {
      sessionPhonePromise ??= getClientSession().then(session => session?.phone ?? null);
      return sessionPhonePromise;
    };
    let verifiedOriginalAppointment: Awaited<ReturnType<typeof getAppointmentById>> | null = null;
    if (originalAppointmentId) {
      const candidateAppointment = await getAppointmentById(originalAppointmentId, salon.id);
      if (candidateAppointment) {
        const sessionPhone = await getSessionPhoneOnce();
        const sessionOwnsIt = sessionPhone
          ? normalizePhone(candidateAppointment.clientPhone) === normalizePhone(sessionPhone)
          : false;
        const tokenOwnsIt = !sessionOwnsIt && manageToken
          ? Boolean(await verifyAppointmentAccessToken(manageToken, {
            appointmentId: candidateAppointment.id,
            salonId: salon.id,
          }))
          : false;
        if (sessionOwnsIt || tokenOwnsIt) {
          verifiedOriginalAppointment = candidateAppointment;
        }
      }
    }
    const excludedAppointmentId = verifiedOriginalAppointment?.id ?? null;

    const capabilityMode = baseServiceId
      ? 'service_assignments'
      : resolveTechnicianCapabilityMode(
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
      excludedAppointmentId,
    });
    const googleBusyWindows = await getGoogleCalendarBusyWindows({
      salonId: salon.id,
      startTime: startOfDay,
      endTime: endOfDay,
      timeZone: bookingConfig.timezone,
      // Same authorization as the database-side exclusion above: only an
      // appointment proven to belong to this requester (session or manage
      // token) suppresses its own mirrored calendar event.
      excludeAppointmentId: excludedAppointmentId,
    });

    // Smart Fit (P7.2): annotate qualifying slots from data already in scope.
    // Everything below is inert unless the salon enabled `settings.smartFit`.
    const smartFitConfig = resolveSmartFitConfig(
      (salon.settings as SalonSettings | null | undefined) ?? null,
    );
    const requestedServiceIds = requestedServices.map(service => service.id);
    const smartFitRequestedTechnicianId = technicianId && technicianId !== 'any'
      ? technicianId
      : null;
    let smartFitActive = smartFitConfig.enabled
      && subtotalBeforeDiscountCents > 0
      && smartFitServiceScopeAllows(smartFitConfig, requestedServiceIds);
    const smartFitDayByTechnician = new Map<
      string,
      NonNullable<ReturnType<typeof buildSmartFitDayContext>>
    >();
    let smartFitCandidateClientKeys: string[] | undefined;
    // Reschedules: derive the client's identity server-side from their own
    // appointment so their remaining bookings cannot mint self-adjacency.
    // Only a verified reschedule (session- or token-proven above) ever
    // contributes an identity here — an unverified id is ignored, same as
    // everywhere else `verifiedOriginalAppointment` is used in this handler.
    if (smartFitActive && verifiedOriginalAppointment) {
      const keys = buildSmartFitClientKeys({
        salonClientId: verifiedOriginalAppointment.salonClientId,
        clientPhone: verifiedOriginalAppointment.clientPhone,
      });
      smartFitCandidateClientKeys = keys.length > 0 ? keys : undefined;
    }
    // Identity-aware annotation (P7.5): when the request carries a PROVEN
    // client identity — a logged-in session cookie, or (for guest
    // reschedules) a manage token verified against this exact appointment
    // above — run the SAME automatic discount resolution the confirm step
    // and booking POST use. A higher-priority discount (reward / first-visit
    // / preserved first-visit) outranks Smart Fit at confirmation —
    // applySmartFitOverlay only upgrades `kind: 'none'` — so annotating
    // those slots would advertise savings this client can never book.
    // Suppression changes nothing about pricing authority: the booking POST
    // still recomputes everything in-transaction.
    //
    // The bare originalAppointmentId query param is NEVER identity proof on
    // its own — this endpoint is public, so treating it as one would let
    // anyone probe another client's reward/first-visit state by diffing
    // annotation presence. Only `verifiedOriginalAppointment` (session- or
    // token-proven) ever contributes an identity here; an unverified guest
    // reschedule falls back to the fully anonymous annotation path (like a
    // fresh booking), and the confirm step still recomputes everything
    // honestly with no 409 surprise.
    if (smartFitActive) {
      const identityPhone = (await getSessionPhoneOnce())
        ?? verifiedOriginalAppointment?.clientPhone
        ?? null;
      if (identityPhone) {
        try {
          const automaticDiscount = await resolveAutomaticBookingDiscount({
            salonId: salon.id,
            services: pricedRequestedServices,
            subtotalBeforeDiscountCents,
            clientPhone: identityPhone,
            originalAppointmentId: verifiedOriginalAppointment?.id ?? null,
            preserveFirstVisitDiscount: verifiedOriginalAppointment?.discountType === FIRST_VISIT_DISCOUNT_TYPE,
          });
          if (automaticDiscount.kind !== 'none') {
            smartFitActive = false;
          }
        } catch (identityError) {
          // Never let a discount-resolution failure take down availability.
          // Fail closed for the annotation only: don't advertise savings we
          // could not verify for this client; slots stay fully bookable.
          Sentry.captureException(identityError);
          smartFitActive = false;
        }
      }
    }
    if (smartFitActive) {
      const nowMs = Date.now();
      for (const tech of technicians) {
        const dayContext = buildSmartFitDayContext({
          technicianId: tech.id,
          weeklySchedule: tech.weeklySchedule as WeeklySchedule | null,
          override: bookingPolicy.overridesByTechnician.get(tech.id) ?? null,
          isOnTimeOff: bookingPolicy.timeOffTechnicianIds.has(tech.id),
          appointments: bookingPolicy.appointmentsByTechnician.get(tech.id) ?? [],
          blockedSlots: bookingPolicy.blockedSlotsByTechnician.get(tech.id) ?? [],
          googleBusyWindows,
          locationId: location?.id ?? null,
          locationBusinessHours: location?.businessHours ?? null,
          date,
          timeZone: bookingConfig.timezone,
          slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
          gridAnchorMs: startOfDay.getTime(),
          nowMs,
        });
        if (dayContext) {
          smartFitDayByTechnician.set(tech.id, dayContext);
        }
      }
    }

    const visibleSlots: string[] = [];
    const slots: Array<{ time: string; startTime: string; smartFit?: SmartFitSlotAnnotation }> = [];
    const blockedSlots = new Set<string>();
    const minimumStartTime = new Date(Date.now() + MIN_LEAD_TIME_MINUTES * 60 * 1000);

    for (const slot of allSlots) {
      const startTime = zonedTimeToUtc({ date, time: slot, timeZone: bookingConfig.timezone });
      if (startTime < minimumStartTime) {
        continue;
      }

      const blockedEndTime = new Date(startTime.getTime() + (visibleDurationMinutes + bufferMinutes) * 60 * 1000);

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
          excludedAppointmentId,
          bufferMinutes: 0,
        });

        return visibleDecision.available;
      });

      if (!anyTechVisible) {
        continue;
      }

      visibleSlots.push(slot);
      const slotEntry: { time: string; startTime: string; smartFit?: SmartFitSlotAnnotation } = {
        time: slot,
        startTime: startTime.toISOString(),
      };
      slots.push(slotEntry);

      if (isBusyWindowConflict(startTime, blockedEndTime, googleBusyWindows)) {
        blockedSlots.add(slot);
        continue;
      }

      const isTechAvailableAtSlot = (tech: (typeof technicians)[number]): boolean => {
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
          excludedAppointmentId,
          bufferMinutes: 0,
        });

        return decision.available;
      };

      const anyTechAvailable = technicians.some(isTechAvailableAtSlot);

      if (!anyTechAvailable) {
        blockedSlots.add(slot);
        continue;
      }

      // Smart Fit annotation: the slot qualifies when ANY technician who can
      // actually take it evaluates as a tight fit ('any'-tech booking assigns
      // a qualifying technician first — see the booking POST).
      if (smartFitDayByTechnician.size > 0) {
        for (const tech of technicians) {
          const dayContext = smartFitDayByTechnician.get(tech.id);
          if (!dayContext || !isTechAvailableAtSlot(tech)) {
            continue;
          }
          const evaluation = evaluateSmartFitSlot({
            config: smartFitConfig,
            candidate: {
              startMs: startTime.getTime(),
              visibleDurationMinutes,
              bufferMinutes,
              serviceId: requestedServiceIds[0]!,
              technicianId: smartFitRequestedTechnicianId,
              locationId: location?.id ?? null,
              clientKeys: smartFitCandidateClientKeys,
              excludeAppointmentId: excludedAppointmentId,
            },
            day: dayContext,
          });
          if (!evaluation.eligible) {
            continue;
          }
          const annotation = buildSmartFitSlotAnnotation({
            config: smartFitConfig,
            evaluation,
            subtotalBeforeDiscountCents,
          });
          if (annotation) {
            slotEntry.smartFit = annotation;
            break;
          }
        }
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
      slots: slots.map(slot => ({
        ...slot,
        availability: blockedSlots.has(slot.time) ? 'schedule_conflict' : 'available',
      })),
      bookedSlots,
      appointmentCount: bookedSlots.length,
    });
  } catch (error) {
    if (error instanceof GoogleCalendarAvailabilityError) {
      const publicMessage = error.reconnectRequired
        ? 'Online booking is temporarily unavailable while the salon restores its calendar connection. Please try again later.'
        : 'Live calendar availability is temporarily unavailable. Please try again shortly.';
      console.warn('[Availability API] Google Calendar unavailable', {
        salonSlug,
        date,
        reconnectRequired: error.reconnectRequired,
      });
      return Response.json(
        {
          error: {
            kind: 'temporary_failure',
            message: publicMessage,
            canRetry: !error.reconnectRequired,
            canReselectTechnician: false,
          },
        },
        { status: 503 },
      );
    }

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
    Sentry.captureException(error, {
      tags: {
        route: '/api/appointments/availability',
        salonSlug,
      },
      extra: {
        date,
        technicianId,
        baseServiceId,
        serviceIds: serviceIdList,
        locationId,
        requestPath: new URL(request.url).pathname,
      },
    });
    return Response.json(
      {
        error: {
          kind: 'temporary_failure',
          message: 'Unable to evaluate availability for the selected day.',
          canRetry: true,
          canReselectTechnician: false,
        },
      },
      { status: 500 },
    );
  }
}
