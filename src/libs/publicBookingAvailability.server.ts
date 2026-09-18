import 'server-only';

import * as Sentry from '@sentry/nextjs';

import { verifyAppointmentAccessToken } from '@/libs/appointmentAccess';
import type { AnnotateSlot } from '@/libs/availability/engine.server';
import { computeDaySlots, preflightDayAvailability } from '@/libs/availability/engine.server';
import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { parseSelectedAddOnsParam } from '@/libs/bookingParams';
import type { RequestedService } from '@/libs/bookingPolicy';
import {
  loadBookingPolicy,
  resolveBookingHoursCeiling,
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
  getGoogleCalendarBusyWindowsReadOnly,
  GoogleCalendarAvailabilityError,
} from '@/libs/googleCalendar';
import { normalizePhone } from '@/libs/phone';
import { technicianSupportsPublicLocation } from '@/libs/publicTechnicianCompatibility';
import {
  getAppointmentById,
  getLocationById,
  getPrimaryLocation,
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
} from '@/libs/smartFitBooking';
import { resolveSmartFitConfig } from '@/libs/smartFitConfig';
import { getZonedDayBounds } from '@/libs/timeZone';
import type { WeeklySchedule } from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

const DEFAULT_DURATION_MINUTES = 30;

type PublicAvailabilityError = {
  kind: 'unsupported_technician' | 'invalid_service' | 'missing_required_add_on' | 'temporary_failure';
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

  // Reachable only for a salon that has opted into
  // settings.booking.enforceRequiredAddOns (PR 1 stage e; default off, so no
  // salon reaches this today). Classified distinctly rather than falling into
  // the generic invalid_service bucket below, and not retryable: retrying the
  // same selection cannot fix a missing required add-on — the client has to go
  // back and add it.
  if (args.error.code === 'missing_required_add_on') {
    return {
      kind: 'missing_required_add_on',
      message: getPublicBookingSelectionMessage(args.error),
      canRetry: false,
      canReselectTechnician: false,
    };
  }

  return {
    kind: 'invalid_service',
    message: getPublicBookingSelectionMessage(args.error),
    canRetry: false,
    canReselectTechnician: false,
  };
}

type AvailabilityAccess =
  | { kind: 'public_route' }
  | {
    kind: 'anonymous_customer_assistant';
    /** Bound by the public booking page/server caller; never model-provided. */
    salon: { id: string; slug: string };
    /** Customer-assistant deadline; never used by the manual public route. */
    signal?: AbortSignal;
    timeoutMs?: number;
  };

export type AnonymousCustomerAvailabilityInput = {
  /** Resolved from the public booking-page context, never chat/model text. */
  salon: { id: string; slug: string };
  date: string;
  technicianId?: string;
  locationId?: string;
  serviceIds?: string[];
  baseServiceId?: string;
  selectedAddOns?: string;
  durationMinutes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Tenant-bound, anonymous availability adapter for the customer assistant.
 * It purposefully has no reschedule/manage-token fields and always uses the
 * read-only Google busy-window reader.
 */
export async function getAnonymousCustomerBookingAvailability(
  input: AnonymousCustomerAvailabilityInput,
): Promise<Response> {
  const searchParams = new URLSearchParams({
    date: input.date,
    salonSlug: input.salon.slug,
  });
  if (input.technicianId) {
    searchParams.set('technicianId', input.technicianId);
  }
  if (input.locationId) {
    searchParams.set('locationId', input.locationId);
  }
  if (input.serviceIds?.length) {
    searchParams.set('serviceIds', input.serviceIds.join(','));
  }
  if (input.baseServiceId) {
    searchParams.set('baseServiceId', input.baseServiceId);
  }
  if (input.selectedAddOns) {
    searchParams.set('selectedAddOns', input.selectedAddOns);
  }
  if (input.durationMinutes !== undefined) {
    searchParams.set('durationMinutes', String(input.durationMinutes));
  }

  return getPublicBookingAvailability(
    new Request(`http://localhost/internal/public-booking-availability?${searchParams.toString()}`, { signal: input.signal }),
    { kind: 'anonymous_customer_assistant', salon: input.salon, signal: input.signal, timeoutMs: input.timeoutMs },
  );
}

/**
 * Execute the established public-booking availability calculation.
 *
 * The anonymous assistant adapter is intentionally narrow: it receives a
 * salon identity already resolved by its caller and it cannot enter the
 * reschedule/customer-history branch. This keeps an assistant conversation
 * from becoming a tenant or appointment-information oracle.
 */
export async function getPublicBookingAvailability(
  request: Request,
  access: AvailabilityAccess = { kind: 'public_route' },
): Promise<Response> {
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

  if (access.kind === 'anonymous_customer_assistant') {
    if (salonSlug !== access.salon.slug) {
      return Response.json(
        { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
        { status: 404 },
      );
    }
    if (originalAppointmentId || manageToken) {
      return Response.json(
        { error: { code: 'INVALID_REQUEST', message: 'Reschedule parameters are not supported' } },
        { status: 400 },
      );
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: { code: 'INVALID_DATE', message: 'Date must be in YYYY-MM-DD format' } },
      { status: 400 },
    );
  }

  try {
    const salon = access.kind === 'anonymous_customer_assistant'
      ? await getSalonBySlug(access.salon.slug)
      : await getSalonBySlug(salonSlug);
    if (!salon || (access.kind === 'anonymous_customer_assistant' && salon.id !== access.salon.id)) {
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

    const requestedLocation = locationId
      ? await getLocationById(locationId, salon.id)
      : null;

    if (locationId && !requestedLocation) {
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

    // A caller that omits `locationId` is not asking for an unbounded day: it
    // is asking for this salon's default location, which is exactly what
    // `POST /api/appointments` books against (`getPrimaryLocation` there). The
    // two paths agreed on nothing before, so availability advertised times the
    // booking POST then refused, and a salon whose hours live only on the
    // `salon` row was bookable around the clock.
    const location = requestedLocation ?? (locationId ? null : await getPrimaryLocation(salon.id));
    const hoursCeiling = resolveBookingHoursCeiling({
      location,
      salonBusinessHours: salon.businessHours ?? null,
    });
    const effectiveLocationId = hoursCeiling.locationId;

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
          && technicianSupportsPublicLocation({ technician, locationId: effectiveLocationId }),
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

    // The "is there anybody to book with at all" decision lives in the engine
    // (`preflightDayAvailability`); the route keeps building the two Responses,
    // which echo request fields the engine has no business knowing.
    const preflight = preflightDayAvailability({
      technicians,
      compatibility: tech =>
        getPublicTechnicianCompatibility({
          selectionMode: baseServiceId ? 'base-service' : 'legacy',
          technician: tech,
          requestedServices: requestedServices as RequestedService[],
        }).bookable,
    });

    if (!preflight.ok) {
      return Response.json({
        date,
        salonSlug,
        technicianId: technicianId || null,
        visibleSlots: [],
        bookedSlots: [],
        appointmentCount: 0,
        reason: preflight.code,
      });
    }

    technicians = preflight.technicians;

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
      if (access.kind === 'anonymous_customer_assistant') {
        return Promise.resolve(null);
      }
      sessionPhonePromise ??= getClientSession().then(session => session?.phone ?? null);
      return sessionPhonePromise;
    };
    let verifiedOriginalAppointment: Awaited<ReturnType<typeof getAppointmentById>> | null = null;
    if (originalAppointmentId && access.kind === 'public_route') {
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
    const googleBusyWindows = access.kind === 'anonymous_customer_assistant'
      ? await getGoogleCalendarBusyWindowsReadOnly({
        salonId: salon.id,
        startTime: startOfDay,
        endTime: endOfDay,
        timeZone: bookingConfig.timezone,
        signal: access.signal,
        timeoutMs: access.timeoutMs,
      })
      : await getGoogleCalendarBusyWindows({
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
          locationId: effectiveLocationId,
          locationBusinessHours: hoursCeiling.businessHours,
          date,
          timeZone: bookingConfig.timezone,
          slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
          gridAnchorMs: startOfDay.getTime(),
          minLeadTimeMinutes: bookingConfig.minimumNoticeMinutes,
          nowMs,
        });
        if (dayContext) {
          smartFitDayByTechnician.set(tech.id, dayContext);
        }
      }
    }

    // Smart Fit never enters the engine: it reaches the loop only through this
    // opaque per-slot callback, invoked at exactly the point the inline block
    // used to run (after the decision pass proved the slot bookable).
    const annotateSlot: AnnotateSlot = ({
      slot: slotEntry,
      startTime,
      technicians: slotTechnicians,
      isTechnicianAvailable,
    }) => {
      // Smart Fit annotation: the slot qualifies when ANY technician who can
      // actually take it evaluates as a tight fit ('any'-tech booking assigns
      // a qualifying technician first — see the booking POST).
      if (smartFitDayByTechnician.size > 0) {
        for (const tech of slotTechnicians) {
          const dayContext = smartFitDayByTechnician.get(tech.id);
          if (!dayContext || !isTechnicianAvailable(tech)) {
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
              locationId: effectiveLocationId,
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

      return slotEntry;
    };

    const { visibleSlots, slots, bookedSlots } = computeDaySlots({
      date,
      technicians,
      requestedServices,
      capabilityMode,
      bookingPolicy,
      googleBusyWindows,
      hoursCeiling,
      effectiveLocationId,
      visibleDurationMinutes,
      bufferMinutes,
      slotIntervalMinutes: bookingConfig.slotIntervalMinutes,
      minimumNoticeMinutes: bookingConfig.minimumNoticeMinutes,
      timeZone: bookingConfig.timezone,
      now: new Date(Date.now()),
      excludedAppointmentId,
    }, { explain: false, annotateSlot });

    return Response.json({
      date,
      salonSlug,
      technicianId: technicianId || null,
      durationMinutes: visibleDurationMinutes,
      visibleDurationMinutes,
      blockedDurationMinutes: visibleDurationMinutes + bufferMinutes,
      visibleSlots,
      slots,
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
