/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  canTechnicianTakeAppointment,
  loadBookingPolicy,
  resolveTechnicianCapabilityMode,
  resolveAutomaticBookingDiscount,
  isRedisAvailable,
  redis,
  getSalonBySlug,
  getSalonById,
  getServicesByIds,
  getTechnicianById,
  getLocationById,
  getPrimaryLocation,
  getActiveAppointmentsForClient,
  getActiveAppointmentsForContact,
  getAppointmentById,
  getAppointmentServiceNames,
  getClientByPhone,
  getOrCreateSalonClient,
  getTechniciansBySalonId,
  normalizePhone,
  updateAppointmentStatus,
  upsertSalonClient,
  guardSalonApiRoute,
  guardFeatureEntitlement,
  resolveSalonLoyaltyPoints,
  requireAdmin,
  requireClientApiSession,
  requireStaffSession,
  sendBookingNotificationsForNewBooking,
  GoogleCalendarAvailabilityError,
  hasGoogleCalendarConflict,
  syncGoogleCalendarEventForAppointment,
  deleteGoogleCalendarEventForAppointment,
  recordGoogleEventReviewDecision,
  enqueueGoogleCalendarUpsert,
  enqueueGoogleCalendarDelete,
  sendCustomerBookingConfirmationEmail,
  db,
} = vi.hoisted(() => ({
  canTechnicianTakeAppointment: vi.fn(),
  loadBookingPolicy: vi.fn(),
  resolveTechnicianCapabilityMode: vi.fn(),
  resolveAutomaticBookingDiscount: vi.fn(),
  isRedisAvailable: vi.fn(),
  redis: null,
  getSalonBySlug: vi.fn(),
  getSalonById: vi.fn(),
  getServicesByIds: vi.fn(),
  getTechnicianById: vi.fn(),
  getLocationById: vi.fn(),
  getPrimaryLocation: vi.fn(),
  getActiveAppointmentsForClient: vi.fn(),
  getActiveAppointmentsForContact: vi.fn(),
  getAppointmentById: vi.fn(),
  getAppointmentServiceNames: vi.fn(async () => ['BIAB']),
  getClientByPhone: vi.fn(),
  getOrCreateSalonClient: vi.fn(),
  getTechniciansBySalonId: vi.fn(),
  normalizePhone: vi.fn((phone: string) => phone),
  updateAppointmentStatus: vi.fn(),
  upsertSalonClient: vi.fn(),
  guardSalonApiRoute: vi.fn(),
  guardFeatureEntitlement: vi.fn(),
  resolveSalonLoyaltyPoints: vi.fn(),
  requireAdmin: vi.fn(),
  requireClientApiSession: vi.fn(),
  requireStaffSession: vi.fn(),
  sendBookingNotificationsForNewBooking: vi.fn(),
  GoogleCalendarAvailabilityError: class GoogleCalendarAvailabilityError extends Error {
    reconnectRequired: boolean;

    constructor(reconnectRequired = false) {
      super('Google Calendar availability is unavailable');
      this.reconnectRequired = reconnectRequired;
    }
  },
  hasGoogleCalendarConflict: vi.fn(),
  syncGoogleCalendarEventForAppointment: vi.fn(),
  deleteGoogleCalendarEventForAppointment: vi.fn(),
  recordGoogleEventReviewDecision: vi.fn(),
  enqueueGoogleCalendarUpsert: vi.fn(),
  enqueueGoogleCalendarDelete: vi.fn(),
  sendCustomerBookingConfirmationEmail: vi.fn(),
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Object.assign(Promise.resolve([]), {
          limit: vi.fn(async () => []),
        })),
      })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(async () => undefined),
    transaction: vi.fn(),
  },
}));

vi.mock('@/libs/bookingPolicy', () => ({
  canTechnicianTakeAppointment,
  getTorontoDateString: vi.fn(() => '2026-03-13'),
  loadBookingPolicy,
  resolveTechnicianCapabilityMode,
}));

vi.mock('@/libs/firstVisitDiscount', () => ({
  FIRST_VISIT_DISCOUNT_TYPE: 'first_visit_25',
  resolveAutomaticBookingDiscount,
}));

vi.mock('@/core/redis/redisClient', () => ({
  isRedisAvailable,
  redis,
}));

vi.mock('@/libs/activeAppointments', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/activeAppointments')>()),
  getActiveAppointmentsForContact,
}));

vi.mock('@/libs/queries', () => ({
  getSalonBySlug,
  getSalonById,
  getServicesByIds,
  getTechnicianById,
  getLocationById,
  getPrimaryLocation,
  getActiveAppointmentsForClient,
  getAppointmentById,
  getAppointmentServiceNames,
  getClientByPhone,
  getOrCreateSalonClient,
  getTechniciansBySalonId,
  normalizePhone,
  updateAppointmentStatus,
  upsertSalonClient,
}));

vi.mock('@/libs/salonStatus', () => ({
  guardSalonApiRoute,
  guardFeatureEntitlement,
}));

vi.mock('@/libs/loyalty', () => ({
  resolveSalonLoyaltyPoints,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin,
  requireAdminSalon: vi.fn(),
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
}));

vi.mock('@/libs/staffAuth', () => ({
  requireStaffSession,
}));

vi.mock('@/libs/bookingNotifications', () => ({
  sendBookingNotificationsForNewBooking,
}));

vi.mock('@/libs/salonNotificationEmail', () => ({
  sendSalonNotificationEmail: vi.fn(async () => ({ status: 'skipped', reason: 'disabled' })),
}));

vi.mock('@/libs/googleCalendar', () => ({
  GoogleCalendarAvailabilityError,
  hasGoogleCalendarConflict,
  syncGoogleCalendarEventForAppointment,
  deleteGoogleCalendarEventForAppointment,
}));

vi.mock('@/libs/googleEventReview', () => ({
  recordGoogleEventReviewDecision,
}));

vi.mock('@/libs/integrationOutbox', () => ({
  enqueueGoogleCalendarUpsert,
  enqueueGoogleCalendarDelete,
}));

vi.mock('@/libs/customerBookingEmail', () => ({
  sendCustomerBookingConfirmationEmail,
}));

vi.mock('@/libs/SMS', () => ({
  sendBookingConfirmationToClient: vi.fn(),
  sendCancellationNotificationToTech: vi.fn(),
  sendRescheduleConfirmation: vi.fn(),
}));

import { POST } from './route';

describe('POST /api/appointments booking policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSalonBySlug.mockResolvedValue({ id: 'salon_1', slug: 'salon-a', name: 'Salon A' });
    getSalonById.mockResolvedValue({
      id: 'salon_1',
      slug: 'salon-a',
      name: 'Salon A',
      settings: {
        booking: {
          bufferMinutes: 10,
          slotIntervalMinutes: 15,
          currency: 'CAD',
          timezone: 'America/Toronto',
          introPriceDefaultLabel: null,
        },
      },
    });
    guardSalonApiRoute.mockResolvedValue(null);
    guardFeatureEntitlement.mockResolvedValue(null);
    requireStaffSession.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      phoneVariants: ['1111111111', '+11111111111'],
      session: {
        phone: '+11111111111',
        clientName: 'Ava',
        sessionId: 'client_session_1',
      },
    });
    sendBookingNotificationsForNewBooking.mockResolvedValue(undefined);
    hasGoogleCalendarConflict.mockResolvedValue(false);
    syncGoogleCalendarEventForAppointment.mockResolvedValue({ status: 'disabled' });
    deleteGoogleCalendarEventForAppointment.mockResolvedValue({ status: 'disabled' });
    recordGoogleEventReviewDecision.mockResolvedValue(undefined);
    enqueueGoogleCalendarUpsert.mockResolvedValue(undefined);
    enqueueGoogleCalendarDelete.mockResolvedValue(undefined);
    sendCustomerBookingConfirmationEmail.mockResolvedValue(true);
    getServicesByIds.mockResolvedValue([{
      id: 'srv_1',
      name: 'BIAB',
      price: 6500,
      durationMinutes: 90,
    }]);
    getTechnicianById.mockResolvedValue({
      id: 'tech_1',
      salonId: 'salon_1',
      name: 'Taylor',
      avatarUrl: null,
      weeklySchedule: {
        friday: { start: '09:00', end: '18:00' },
      },
    });
    getLocationById.mockResolvedValue(null);
    getPrimaryLocation.mockResolvedValue(null);
    getActiveAppointmentsForClient.mockResolvedValue([]);
    getActiveAppointmentsForContact.mockResolvedValue([]);
    getAppointmentById.mockResolvedValue(null);
    getClientByPhone.mockResolvedValue(null);
    getOrCreateSalonClient.mockResolvedValue({ id: 'client_1', phone: '1111111111' });
    getTechniciansBySalonId.mockResolvedValue([{
      id: 'tech_1',
      salonId: 'salon_1',
      name: 'Taylor',
      avatarUrl: null,
      weeklySchedule: {
        friday: { start: '09:00', end: '18:00' },
      },
      enabledServiceIds: ['srv_1'],
      serviceIds: ['srv_1'],
      specialties: [],
      primaryLocationId: null,
    }]);
    upsertSalonClient.mockResolvedValue(undefined);
    resolveSalonLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
    loadBookingPolicy.mockResolvedValue({
      overridesByTechnician: new Map(),
      timeOffTechnicianIds: new Set(),
      blockedSlotsByTechnician: new Map(),
      appointmentsByTechnician: new Map(),
    });
    resolveTechnicianCapabilityMode.mockReturnValue('service_assignments');
    resolveAutomaticBookingDiscount.mockResolvedValue({
      kind: 'none',
      subtotalBeforeDiscountCents: 6500,
      discountAmountCents: 0,
      finalTotalCents: 6500,
      reward: null,
      firstVisit: null,
    });
    canTechnicianTakeAppointment.mockReturnValue({
      available: false,
      reason: 'outside_schedule',
    });
    db.transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  });

  it('rejects booking writes when the shared booking policy says the slot is not bookable', async () => {
    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T17:00:00.000Z',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'OUTSIDE_SCHEDULE',
        message: 'Selected technician is unavailable at this time. Please choose another slot.',
      },
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects campaign discounts on reschedules before reading or consuming the campaign token', async () => {
    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T17:00:00.000Z',
          originalAppointmentId: 'appt_original',
          campaignToken: 'campaign_token_123456789012345678901234',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'CAMPAIGN_FLOW_INVALID',
        message: 'Retention promotions can only be used for a new public booking.',
      },
    });
    expect(getAppointmentById).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a campaign token on a management-token path without consuming it', async () => {
    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T17:00:00.000Z',
          manageToken: 'manage_token_12345678901234567890',
          campaignToken: 'campaign_token_123456789012345678901234',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('CAMPAIGN_FLOW_INVALID');
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('returns a 409 without any appointment details when an active booking exists', async () => {
    getActiveAppointmentsForContact.mockResolvedValue([{
      id: 'appt_existing',
      startTime: new Date('2099-03-14T15:00:00.000Z'),
    }]);

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T17:00:00.000Z',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('EXISTING_APPOINTMENT');

    // Anti-enumeration: the body must not leak the existing appointment's
    // id or schedule to a caller who only knows a phone number.
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('existingAppointmentId');
    expect(serialized).not.toContain('existingAppointmentDate');
    expect(serialized).not.toContain('appt_existing');
    expect(serialized).not.toContain('2099-03-14');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('passes requested services and location constraints into any-tech assignment', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    getOrCreateSalonClient.mockResolvedValue({ id: 'client_1', phone: '9999999999' });
    getTechnicianById.mockResolvedValue(null);
    getLocationById.mockResolvedValue({
      id: 'loc_1',
      businessHours: {
        friday: { open: '09:00', close: '18:00' },
      },
    });
    getTechniciansBySalonId.mockResolvedValue([
      {
        id: 'tech_wrong_location',
        salonId: 'salon_1',
        name: 'Wrong Location',
        avatarUrl: null,
        weeklySchedule: {
          friday: { start: '09:00', end: '18:00' },
        },
        enabledServiceIds: ['srv_1'],
        serviceIds: ['srv_1'],
        specialties: [],
        primaryLocationId: 'loc_2',
      },
      {
        id: 'tech_supported',
        salonId: 'salon_1',
        name: 'Supported',
        avatarUrl: null,
        weeklySchedule: {
          friday: { start: '09:00', end: '18:00' },
        },
        enabledServiceIds: ['srv_1'],
        serviceIds: ['srv_1'],
        specialties: [],
        primaryLocationId: 'loc_1',
      },
    ]);
    canTechnicianTakeAppointment.mockImplementation((args: {
      enabledServiceIds?: string[];
      requestedServices?: Array<{ id: string }>;
      locationId?: string | null;
      primaryLocationId?: string | null;
    }) => {
      if (!args.requestedServices?.some(service => service.id === 'srv_1')) {
        return { available: false, reason: 'service_unsupported' };
      }

      if (args.locationId === 'loc_1' && args.primaryLocationId === 'loc_2') {
        return { available: false, reason: 'location_unavailable' };
      }

      if (args.enabledServiceIds?.includes('srv_1')) {
        return {
          available: true,
          schedule: { start: '09:00', end: '18:00' },
        };
      }

      return { available: false, reason: 'service_unsupported' };
    });

    const appointmentReturning = vi.fn(async () => [{
      id: 'appt_1',
      salonId: 'salon_1',
      technicianId: 'tech_supported',
      locationId: 'loc_1',
      clientPhone: '1111111111',
      clientName: null,
      salonClientId: 'client_1',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      endTime: new Date('2099-03-13T16:30:00.000Z'),
      status: 'pending',
      totalPrice: 6500,
      totalDurationMinutes: 90,
    }]);
    const appointmentServicesReturning = vi.fn(async () => [{
      id: 'apptSvc_1',
      appointmentId: 'appt_1',
      serviceId: 'srv_1',
      priceAtBooking: 6500,
      durationAtBooking: 90,
    }]);
    db.insert
      .mockImplementationOnce(() => ({ values: vi.fn(() => ({ returning: appointmentReturning })) }))
      .mockImplementationOnce(() => ({ values: vi.fn(async () => undefined) }))
      .mockImplementationOnce(() => ({ values: vi.fn(() => ({ returning: appointmentServicesReturning })) }));

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'any',
          locationId: 'loc_1',
          clientName: 'Ava Guest',
          clientEmail: 'ava@example.com',
          clientPhone: '9999999999',
          startTime: '2099-03-13T15:00:00.000Z',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(canTechnicianTakeAppointment).toHaveBeenCalledWith(expect.objectContaining({
      requestedServices: [expect.objectContaining({ id: 'srv_1' })],
      locationId: 'loc_1',
    }));
    expect(sendBookingNotificationsForNewBooking).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      clientName: 'Ava Guest',
      clientPhone: '9999999999',
      services: ['BIAB'],
      totalPrice: 6500,
    }));
    expect(enqueueGoogleCalendarUpsert).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      salonName: 'Salon A',
      clientPhone: '9999999999',
      serviceNames: ['BIAB'],
      technicianName: 'Supported',
      timeZone: 'America/Toronto',
    }));
  });

  it('rejects booking writes when Google Calendar is busy', async () => {
    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });
    hasGoogleCalendarConflict.mockResolvedValue(true);

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T15:00:00.000Z',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('TIME_CONFLICT');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects booking writes when Google Calendar availability cannot be verified', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });
    hasGoogleCalendarConflict.mockRejectedValue(new GoogleCalendarAvailabilityError(false));

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T15:00:00.000Z',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('CALENDAR_UNAVAILABLE');
    expect(body.error.message).toBe('Unable to confirm calendar availability. Please try again shortly.');
    expect(db.insert).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('does not suggest retrying shortly when Google Calendar must be reconnected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });
    hasGoogleCalendarConflict.mockRejectedValue(new GoogleCalendarAvailabilityError(true));

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T15:00:00.000Z',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: 'CALENDAR_UNAVAILABLE',
      message: 'Unable to confirm this booking while the salon restores its calendar connection. Please try again later.',
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('enforces owner authorization server-side for Google event conversion', async () => {
    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T15:00:00.000Z',
          googleEventReviewId: 'google_event_1',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('stores conversion duration and notes while atomically claiming the source event', async () => {
    requireAdmin.mockResolvedValue({ ok: true });
    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });
    const sourceEvent = {
      id: 'google_event_1',
      salonId: 'salon_1',
      calendarId: 'primary',
      googleEventId: 'provider_event_1',
      appointmentId: null,
      title: 'Controlled fake event',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      endTime: new Date('2099-03-13T16:30:00.000Z'),
      durationMinutes: 90,
      reviewStatus: 'needs_review',
      transparency: 'busy',
      syncMode: 'inbound_only',
      deletedAt: null,
    };
    db.select
      .mockImplementationOnce(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => [sourceEvent]) })),
        })),
      }));

    let appointmentValues: Record<string, unknown> | null = null;
    const claimReturning = vi.fn(async () => [sourceEvent]);
    db.transaction.mockImplementationOnce(async (callback: (tx: typeof db) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async () => undefined),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
          })),
        })),
        insert: vi.fn()
          .mockImplementationOnce(() => ({
            values: vi.fn((values: Record<string, unknown>) => {
              appointmentValues = values;
              return {
                returning: vi.fn(async () => [{
                  ...values,
                  id: 'appt_converted',
                  startTime: new Date(String(values.startTime)),
                  endTime: new Date(String(values.endTime)),
                }]),
              };
            }),
          }))
          .mockImplementationOnce(() => ({ values: vi.fn(async () => undefined) }))
          .mockImplementationOnce(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => [{
                id: 'apptSvc_converted',
                appointmentId: 'appt_converted',
                serviceId: 'srv_1',
                priceAtBooking: 6500,
                durationAtBooking: 90,
              }]),
            })),
          })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({ returning: claimReturning })),
          })),
        })),
      };
      return callback(tx as never);
    });

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'controlled-conversion-session',
        },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          clientPhone: '1111111111',
          clientName: 'Controlled Client',
          startTime: '2099-03-13T15:00:00.000Z',
          googleEventReviewId: 'google_event_1',
          durationMinutesOverride: 75,
          notes: 'Controlled conversion note',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(appointmentValues).toEqual(expect.objectContaining({
      googleCalendarEventId: 'provider_event_1',
      totalDurationMinutes: 75,
      blockedDurationMinutes: 85,
      notes: 'Controlled conversion note',
    }));
    expect(claimReturning).toHaveBeenCalledTimes(1);
    expect(recordGoogleEventReviewDecision).toHaveBeenCalledWith({
      salonId: 'salon_1',
      title: 'Controlled fake event',
      decision: 'appointment',
    });
    expect(enqueueGoogleCalendarUpsert).not.toHaveBeenCalled();
  });

  function buildConversionSourceEvent() {
    return {
      id: 'google_event_1',
      salonId: 'salon_1',
      calendarId: 'primary',
      googleEventId: 'provider_event_1',
      appointmentId: null,
      title: 'Imported event',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      endTime: new Date('2099-03-13T16:30:00.000Z'),
      durationMinutes: 90,
      reviewStatus: 'needs_review',
      transparency: 'busy',
      syncMode: 'inbound_only',
      deletedAt: null,
    };
  }

  function mockConversionSelects(sourceEvent: ReturnType<typeof buildConversionSourceEvent>) {
    // Only the source-event load hits db.select: conversions no longer probe
    // other Google events for overlaps (imports coexist with their calendar
    // neighbours by definition).
    db.select
      .mockImplementationOnce(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => [sourceEvent]) })),
        })),
      }));
  }

  function mockConversionTransaction(options: { guardConflict?: boolean } = {}) {
    const state: { appointmentValues: Record<string, unknown> | null } = { appointmentValues: null };
    const sourceEvent = buildConversionSourceEvent();
    db.transaction.mockImplementationOnce(async (callback: (tx: typeof db) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async () => undefined),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              // lockTechnicianAndAssertSlotFree's overlap probe: a returned
              // row means a genuine double-book and throws SlotConflictError.
              limit: vi.fn(async () => (options.guardConflict ? [{ id: 'existing_overlap' }] : [])),
            })),
          })),
        })),
        insert: vi.fn()
          .mockImplementationOnce(() => ({
            values: vi.fn((values: Record<string, unknown>) => {
              state.appointmentValues = values;
              return {
                returning: vi.fn(async () => [{
                  ...values,
                  id: 'appt_converted',
                  startTime: new Date(String(values.startTime)),
                  endTime: new Date(String(values.endTime)),
                }]),
              };
            }),
          }))
          .mockImplementationOnce(() => ({ values: vi.fn(async () => undefined) }))
          .mockImplementationOnce(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => [{
                id: 'apptSvc_converted',
                appointmentId: 'appt_converted',
                serviceId: 'srv_1',
                priceAtBooking: 6500,
                durationAtBooking: 90,
              }]),
            })),
          })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({ returning: vi.fn(async () => [sourceEvent]) })),
          })),
        })),
      };
      return callback(tx as never);
    });
    return state;
  }

  it('converts a Google event even when the soft availability gate rejects the slot', async () => {
    requireAdmin.mockResolvedValue({ ok: true });
    // The gate would reject this slot for a client booking — conversions
    // import an event that already exists, so it must not block them.
    canTechnicianTakeAppointment.mockReturnValue({ available: false, reason: 'outside_schedule' });
    mockConversionSelects(buildConversionSourceEvent());
    const txState = mockConversionTransaction();

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          clientPhone: '1111111111',
          clientName: 'Converted Client',
          startTime: '2099-03-13T15:00:00.000Z',
          googleEventReviewId: 'google_event_1',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(canTechnicianTakeAppointment).not.toHaveBeenCalled();
    expect(txState.appointmentValues).toEqual(expect.objectContaining({
      technicianId: 'tech_1',
    }));
  });

  it('assigns the primary technician when converting without an explicit one', async () => {
    requireAdmin.mockResolvedValue({ ok: true });
    canTechnicianTakeAppointment.mockReturnValue({ available: false, reason: 'outside_schedule' });
    mockConversionSelects(buildConversionSourceEvent());
    const txState = mockConversionTransaction();

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: null,
          clientPhone: '1111111111',
          clientName: 'Converted Client',
          startTime: '2099-03-13T15:00:00.000Z',
          googleEventReviewId: 'google_event_1',
        }),
      }),
    );
    const body = await response.json().catch(() => null);

    expect(response.status).toBe(201);
    expect(body?.error?.code).toBeUndefined();
    // First (primary) technician from getTechniciansBySalonId.
    expect(txState.appointmentValues).toEqual(expect.objectContaining({
      technicianId: 'tech_1',
    }));
  });

  it('never blocks a conversion on other Google events (back-to-back or duplicate rows)', async () => {
    requireAdmin.mockResolvedValue({ ok: true });
    canTechnicianTakeAppointment.mockReturnValue({ available: false, reason: 'outside_schedule' });
    // Under the previous behaviour this scenario required a queued empty
    // response for the "other Google events" overlap probe to pass; that
    // probe no longer exists — mockConversionSelects queues only the
    // source-event load, and a busy neighbouring/duplicate Google row can
    // no longer produce "Another Google event overlaps this time."
    mockConversionSelects(buildConversionSourceEvent());
    mockConversionTransaction();

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          clientPhone: '1111111111',
          clientName: 'Converted Client',
          startTime: '2099-03-13T15:00:00.000Z',
          googleEventReviewId: 'google_event_1',
        }),
      }),
    );
    const body = await response.json().catch(() => null);

    expect(body?.error?.message).not.toBe('Another Google event overlaps this time.');
    expect(response.status).toBe(201);
  });

  it('still rejects a conversion that genuinely double-books the technician', async () => {
    requireAdmin.mockResolvedValue({ ok: true });
    canTechnicianTakeAppointment.mockReturnValue({ available: false, reason: 'outside_schedule' });
    mockConversionSelects(buildConversionSourceEvent());
    mockConversionTransaction({ guardConflict: true });

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          clientPhone: '1111111111',
          clientName: 'Converted Client',
          startTime: '2099-03-13T15:00:00.000Z',
          googleEventReviewId: 'google_event_1',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('TIME_CONFLICT');
  });

  it('rejects an incomplete guest booking when name and email are missing', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          clientPhone: '9999999999',
          startTime: '2099-03-13T14:00:00.000Z',
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'GUEST_CONTACT_REQUIRED',
        message: 'Name, email, and phone are required to book.',
      },
    });
    expect(getActiveAppointmentsForContact).not.toHaveBeenCalled();
    expect(getOrCreateSalonClient).not.toHaveBeenCalled();
  });

  it('books under the account phone when the signed-in customer declares self mode', async () => {
    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });

    const appointmentReturning = vi.fn(async () => [{
      id: 'appt_2',
      salonId: 'salon_1',
      technicianId: 'tech_1',
      locationId: null,
      clientPhone: '1111111111',
      clientName: null,
      salonClientId: 'client_1',
      startTime: new Date('2099-03-13T15:00:00.000Z'),
      endTime: new Date('2099-03-13T16:30:00.000Z'),
      status: 'pending',
      totalPrice: 6500,
      totalDurationMinutes: 90,
    }]);
    const appointmentServicesReturning = vi.fn(async () => [{
      id: 'apptSvc_2',
      appointmentId: 'appt_2',
      serviceId: 'srv_1',
      priceAtBooking: 6500,
      durationAtBooking: 90,
    }]);
    db.insert
      .mockImplementationOnce(() => ({ values: vi.fn(() => ({ returning: appointmentReturning })) }))
      .mockImplementationOnce(() => ({ values: vi.fn(async () => undefined) }))
      .mockImplementationOnce(() => ({ values: vi.fn(() => ({ returning: appointmentServicesReturning })) }));

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          clientPhone: '9999999999',
          bookingSubject: 'self',
          startTime: '2099-03-13T15:00:00.000Z',
        }),
      }),
    );

    expect(response.status).toBe(201);
    // The account phone is authoritative for a self booking; it is the OTP
    // login credential, so the form can never repoint it.
    expect(getActiveAppointmentsForContact).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '1111111111', salonId: 'salon_1' }),
    );
    expect(getOrCreateSalonClient).toHaveBeenCalledWith('salon_1', '1111111111', undefined);
    expect(getOrCreateSalonClient).not.toHaveBeenCalledWith('salon_1', '9999999999', undefined);
  });

  it('reschedules atomically by creating the new appointment and cancelling the original in one transaction', async () => {
    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });
    getAppointmentById.mockResolvedValue({
      id: 'appt_original',
      salonId: 'salon_1',
      status: 'confirmed',
      clientPhone: '1111111111',
      technicianId: 'tech_1',
      startTime: new Date('2099-03-13T13:00:00.000Z'),
      endTime: new Date('2099-03-13T14:30:00.000Z'),
      totalPrice: 6500,
      discountLabel: null,
      discountAmountCents: 0,
    });

    const committedAppointments: string[] = [];
    const committedCancelledAppointments: string[] = [];
    let cancelOriginalSetPayload: Record<string, unknown> | null = null;

    db.transaction.mockImplementationOnce(async (callback: (tx: {
      insert: typeof db.insert;
      update: typeof db.update;
    }) => Promise<unknown>) => {
      const staged = {
        appointmentId: null as string | null,
        cancelledAppointmentId: null as string | null,
      };

      const tx = {
        insert: vi.fn()
          .mockImplementationOnce(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => {
                staged.appointmentId = 'appt_rescheduled';
                return [{
                  id: 'appt_rescheduled',
                  salonId: 'salon_1',
                  technicianId: 'tech_1',
                  locationId: null,
                  clientPhone: '1111111111',
                  clientName: null,
                  salonClientId: 'client_1',
                  startTime: new Date('2099-03-13T15:00:00.000Z'),
                  endTime: new Date('2099-03-13T16:30:00.000Z'),
                  status: 'pending',
                  totalPrice: 6500,
                  totalDurationMinutes: 90,
                }];
              }),
            })),
          }))
          .mockImplementationOnce(() => ({
            values: vi.fn(async () => undefined),
          }))
          .mockImplementationOnce(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => [{
                id: 'apptSvc_rescheduled',
                appointmentId: 'appt_rescheduled',
                serviceId: 'srv_1',
                priceAtBooking: 6500,
                durationAtBooking: 90,
              }]),
            })),
          })),
        update: vi.fn()
          // Reschedules cancel the original first, then revoke its tokens.
          .mockImplementationOnce(() => ({
            set: vi.fn((payload: Record<string, unknown>) => {
              cancelOriginalSetPayload = payload;
              return {
                where: vi.fn(() => ({
                  returning: vi.fn(async () => {
                    staged.cancelledAppointmentId = 'appt_original';
                    return [{
                      id: 'appt_original',
                      status: 'cancelled',
                      cancelReason: 'rescheduled',
                    }];
                  }),
                })),
              };
            }),
          }))
          .mockImplementationOnce(() => ({
            set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
          })),
        execute: vi.fn(async () => undefined),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => []),
            })),
          })),
        })),
      };

      const result = await callback(tx as never);
      if (staged.appointmentId) {
        committedAppointments.push(staged.appointmentId);
      }
      if (staged.cancelledAppointmentId) {
        committedCancelledAppointments.push(staged.cancelledAppointmentId);
      }
      return result;
    });

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T15:00:00.000Z',
          originalAppointmentId: 'appt_original',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(committedAppointments).toEqual(['appt_rescheduled']);
    expect(committedCancelledAppointments).toEqual(['appt_original']);
    expect(updateAppointmentStatus).not.toHaveBeenCalled();
    // The reschedule-cancel of the original must sync BOTH the legacy status
    // and the staff-facing canvas column, or the row lingers as a 'waiting'
    // card on the canvas board while reading 'cancelled' everywhere else.
    expect(cancelOriginalSetPayload).toMatchObject({
      status: 'cancelled',
      cancelReason: 'rescheduled',
      canvasState: 'cancelled',
    });
    expect((cancelOriginalSetPayload as Record<string, unknown> | null)?.canvasStateUpdatedAt)
      .toBeInstanceOf(Date);
  });

  it('rolls back a reschedule when cancelling the original appointment fails', async () => {
    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });
    getAppointmentById.mockResolvedValue({
      id: 'appt_original',
      salonId: 'salon_1',
      status: 'confirmed',
      clientPhone: '1111111111',
      technicianId: 'tech_1',
      startTime: new Date('2099-03-13T13:00:00.000Z'),
      endTime: new Date('2099-03-13T14:30:00.000Z'),
      totalPrice: 6500,
      discountLabel: null,
      discountAmountCents: 0,
    });

    const committedAppointments: string[] = [];

    db.transaction.mockImplementationOnce(async (callback: (tx: {
      insert: typeof db.insert;
      update: typeof db.update;
    }) => Promise<unknown>) => {
      const staged = {
        appointmentId: null as string | null,
      };

      const tx = {
        insert: vi.fn()
          .mockImplementationOnce(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => {
                staged.appointmentId = 'appt_rescheduled';
                return [{
                  id: 'appt_rescheduled',
                  salonId: 'salon_1',
                  technicianId: 'tech_1',
                  locationId: null,
                  clientPhone: '1111111111',
                  clientName: null,
                  salonClientId: 'client_1',
                  startTime: new Date('2099-03-13T15:00:00.000Z'),
                  endTime: new Date('2099-03-13T16:30:00.000Z'),
                  status: 'pending',
                  totalPrice: 6500,
                  totalDurationMinutes: 90,
                }];
              }),
            })),
          }))
          .mockImplementationOnce(() => ({
            values: vi.fn(async () => undefined),
          }))
          .mockImplementationOnce(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => [{
                id: 'apptSvc_rescheduled',
                appointmentId: 'appt_rescheduled',
                serviceId: 'srv_1',
                priceAtBooking: 6500,
                durationAtBooking: 90,
              }]),
            })),
          })),
        update: vi.fn()
          // Cancel-first: the original is no longer active, so the update
          // returns no row and the transaction aborts before any insert.
          .mockImplementationOnce(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => ({
                returning: vi.fn(async () => []),
              })),
            })),
          }))
          .mockImplementationOnce(() => ({
            set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
          })),
        execute: vi.fn(async () => undefined),
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => []),
            })),
          })),
        })),
      };

      const result = await callback(tx as never);
      if (staged.appointmentId) {
        committedAppointments.push(staged.appointmentId);
      }
      return result;
    });

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T15:00:00.000Z',
          originalAppointmentId: 'appt_original',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'APPOINTMENT_NOT_ACTIVE',
        message: 'The original appointment could not be rescheduled because it is no longer active.',
      },
    });
    expect(committedAppointments).toEqual([]);
  });

  it('does not commit a partially-created reschedule when the transactional insert path fails mid-flight', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });
    getAppointmentById.mockResolvedValue({
      id: 'appt_original',
      salonId: 'salon_1',
      status: 'confirmed',
      clientPhone: '1111111111',
      technicianId: 'tech_1',
      startTime: new Date('2099-03-13T13:00:00.000Z'),
      endTime: new Date('2099-03-13T14:30:00.000Z'),
      totalPrice: 6500,
      discountLabel: null,
      discountAmountCents: 0,
    });

    const committedAppointments: string[] = [];

    db.transaction.mockImplementationOnce(async (callback: (tx: {
      insert: typeof db.insert;
      update: typeof db.update;
    }) => Promise<unknown>) => {
      const staged = {
        appointmentId: null as string | null,
      };

      const tx = {
        insert: vi.fn()
          .mockImplementationOnce(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => {
                staged.appointmentId = 'appt_rescheduled';
                return [{
                  id: 'appt_rescheduled',
                  salonId: 'salon_1',
                  technicianId: 'tech_1',
                  locationId: null,
                  clientPhone: '1111111111',
                  clientName: null,
                  salonClientId: 'client_1',
                  startTime: new Date('2099-03-13T15:00:00.000Z'),
                  endTime: new Date('2099-03-13T16:30:00.000Z'),
                  status: 'pending',
                  totalPrice: 6500,
                  totalDurationMinutes: 90,
                }];
              }),
            })),
          }))
          .mockImplementationOnce(() => ({
            values: vi.fn(async () => undefined),
          }))
          .mockImplementationOnce(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => {
                throw new Error('SERVICE_INSERT_FAILED');
              }),
            })),
          })),
        update: vi.fn(),
      };

      const result = await callback(tx as never);
      if (staged.appointmentId) {
        committedAppointments.push(staged.appointmentId);
      }
      return result;
    });

    const response = await POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T15:00:00.000Z',
          originalAppointmentId: 'appt_original',
        }),
      }),
    );

    expect(response.status).toBe(500);
    expect(committedAppointments).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error creating appointment:', expect.any(Error));

    consoleErrorSpy.mockRestore();
  });

  it('atomically redeems a campaign without failing the committed booking when ancillary timeline conversion fails', async () => {
    const token = 'campaign_token_123456789012345678901234';
    const campaign = {
      id: 'campaign_1',
      salonId: 'salon_1',
      salonClientId: 'client_1',
      communicationId: null,
      tokenHash: 'stored_hash',
      stage: 'promo_6w',
      promotionSnapshot: {
        enabled: true,
        name: 'Welcome back',
        discountType: 'percent',
        value: 20,
        eligibleServiceIds: ['srv_1'],
        expiryDays: 14,
        code: 'BACK20',
        messageTemplate: '{bookingLink}',
        singleUse: true,
      },
      expiresAt: new Date('2099-04-01T00:00:00.000Z'),
      singleUse: true,
      redeemedAt: null,
      redeemedAppointmentId: null,
      createdAt: new Date('2099-03-01T00:00:00.000Z'),
      updatedAt: new Date('2099-03-01T00:00:00.000Z'),
    };
    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });
    const conversionError = new Error('timeline temporarily unavailable');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.execute.mockRejectedValueOnce(conversionError);
    db.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [campaign]) })),
      })),
    }));

    let appointmentValues: Record<string, unknown> | null = null;
    let redemptionValues: Record<string, unknown> | null = null;
    db.transaction.mockImplementationOnce(async (callback: (tx: typeof db) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async () => undefined),
        select: vi.fn()
          .mockImplementationOnce(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
            })),
          }))
          .mockImplementationOnce(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(() => ({ limit: vi.fn(async () => [campaign]) })),
              })),
            })),
          })),
        insert: vi.fn()
          .mockImplementationOnce(() => ({
            values: vi.fn((values: Record<string, unknown>) => {
              appointmentValues = values;
              return {
                returning: vi.fn(async () => [{
                  ...values,
                  id: 'appt_campaign',
                  notes: null,
                  startTime: new Date(String(values.startTime)),
                  endTime: new Date(String(values.endTime)),
                }]),
              };
            }),
          }))
          .mockImplementationOnce(() => ({ values: vi.fn(async () => undefined) }))
          .mockImplementationOnce(() => ({
            values: vi.fn(() => ({
              returning: vi.fn(async () => [{
                id: 'apptSvc_campaign',
                appointmentId: 'appt_campaign',
                serviceId: 'srv_1',
                priceAtBooking: 6500,
                durationAtBooking: 90,
              }]),
            })),
          }))
          .mockImplementationOnce(() => ({
            values: vi.fn((values: Record<string, unknown>) => {
              redemptionValues = values;
              return Promise.resolve();
            }),
          })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({ returning: vi.fn(async () => [{ ...campaign, redeemedAt: new Date() }]) })),
          })),
        })),
      };
      return callback(tx as never);
    });

    const response = await POST(new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'salon-a',
        serviceIds: ['srv_1'],
        technicianId: 'tech_1',
        startTime: '2099-03-13T15:00:00.000Z',
        campaignToken: token,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.appointment).toEqual(expect.objectContaining({
      totalPrice: 5200,
      subtotalBeforeDiscountCents: 6500,
      discountAmountCents: 1300,
      discountType: 'retention_promo_6w',
      discountLabel: 'Welcome back',
    }));
    expect(appointmentValues).toEqual(expect.objectContaining({
      totalPrice: 5200,
      discountAmountCents: 1300,
      discountType: 'retention_promo_6w',
    }));
    expect(redemptionValues).toEqual(expect.objectContaining({
      salonId: 'salon_1',
      campaignId: 'campaign_1',
      appointmentId: 'appt_campaign',
      discountAmountCents: 1300,
    }));
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Retention] Failed to convert latest outreach after booking:',
      conversionError,
    );

    consoleErrorSpy.mockRestore();
  });

  it('rejects a retention campaign prepared for a different client', async () => {
    const campaign = {
      id: 'campaign_other',
      salonId: 'salon_1',
      salonClientId: 'client_other',
      communicationId: null,
      stage: 'promo_8w',
      promotionSnapshot: {
        enabled: true,
        name: 'Come back',
        discountType: 'fixed',
        value: 1500,
        eligibleServiceIds: [],
        expiryDays: 14,
        code: null,
        messageTemplate: '{bookingLink}',
        singleUse: true,
      },
      expiresAt: new Date('2099-04-01T00:00:00.000Z'),
      singleUse: true,
      redeemedAt: null,
    };
    canTechnicianTakeAppointment.mockReturnValue({
      available: true,
      schedule: { start: '09:00', end: '18:00' },
    });
    db.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [campaign]) })),
      })),
    }));

    const response = await POST(new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'salon-a',
        serviceIds: ['srv_1'],
        technicianId: 'tech_1',
        startTime: '2099-03-13T15:00:00.000Z',
        campaignToken: 'campaign_token_123456789012345678901234',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('CLIENT_MISMATCH');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  /**
   * Customer identity across the booking gate.
   *
   * Root cause these cover: a `client_session` cookie used to silently replace
   * the phone typed in the form, so a signed-in browser was blocked by the
   * account's appointment and editing the form changed nothing, while the same
   * flow worked in Incognito.
   */
  describe('booking subject and duplicate matching', () => {
    // These cases assert the identity gate only. Cases that pass the gate then
    // continue into the insert path, which this suite does not stub, so its
    // logging is silenced here rather than mocking a whole booking per test.
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    const signedOut = () => requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });

    const post = (body: Record<string, unknown>) => POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T15:00:00.000Z',
          clientName: 'Guest Person',
          clientEmail: 'guest@example.com',
          ...body,
        }),
      }),
    );

    it('refuses to guess when a signed-in browser submits a different phone', async () => {
      const response = await post({ clientPhone: '9999999999' });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.code).toBe('BOOKING_IDENTITY_CONFLICT');
      // The old behaviour: silently look up the ACCOUNT's appointments.
      expect(getActiveAppointmentsForContact).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('does not leak the signed-in account details in that conflict', async () => {
      const response = await post({ clientPhone: '9999999999' });
      const body = await response.json();

      expect(JSON.stringify(body)).not.toContain('1111111111');
      expect(JSON.stringify(body)).not.toContain('Ava');
    });

    it('guest mode never inherits the signed-in phone', async () => {
      canTechnicianTakeAppointment.mockReturnValue({
        available: true,
        schedule: { start: '09:00', end: '18:00' },
      });

      await post({ clientPhone: '9999999999', bookingSubject: 'guest' });

      expect(getActiveAppointmentsForContact).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '9999999999' }),
      );
      expect(getActiveAppointmentsForContact).not.toHaveBeenCalledWith(
        expect.objectContaining({ phone: '1111111111' }),
      );
    });

    it('guest mode never inherits the signed-in email', async () => {
      canTechnicianTakeAppointment.mockReturnValue({
        available: true,
        schedule: { start: '09:00', end: '18:00' },
      });

      await post({
        clientPhone: '9999999999',
        clientEmail: 'someone-else@example.com',
        bookingSubject: 'guest',
      });

      expect(getActiveAppointmentsForContact).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'someone-else@example.com' }),
      );
    });

    it('signing out makes the same browser behave like Incognito', async () => {
      signedOut();
      canTechnicianTakeAppointment.mockReturnValue({
        available: true,
        schedule: { start: '09:00', end: '18:00' },
      });

      await post({ clientPhone: '9999999999' });

      expect(getActiveAppointmentsForContact).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '9999999999' }),
      );
    });

    it('blocks a genuine duplicate on the normalized phone', async () => {
      signedOut();
      getActiveAppointmentsForContact.mockImplementation(async (args: { phone?: string }) =>
        (args.phone === '9999999999' ? [{ id: 'appt_x', clientPhone: '+19999999999', clientEmail: null }] : []));

      const response = await post({ clientPhone: '9999999999' });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.code).toBe('EXISTING_APPOINTMENT');
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('keeps the guest-facing block message free of appointment details', async () => {
      signedOut();
      getActiveAppointmentsForContact.mockImplementation(async (args: { phone?: string }) =>
        (args.phone === '9999999999'
          ? [{ id: 'appt_x', clientPhone: '9999999999', clientEmail: 'other@example.com' }]
          : []));

      const response = await post({ clientPhone: '9999999999' });
      const body = await response.json();

      expect(body.error.message).not.toContain('appt_x');
      expect(body.error.message).not.toContain('other@example.com');
      expect(body.error.message).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('does not block a household sharing one email with a different phone', async () => {
      signedOut();
      canTechnicianTakeAppointment.mockReturnValue({
        available: true,
        schedule: { start: '09:00', end: '18:00' },
      });
      getActiveAppointmentsForContact.mockImplementation(async (args: { email?: string }) =>
        (args.email
          ? [{ id: 'appt_partner', clientPhone: '4165550000', clientEmail: 'family@example.com' }]
          : []));

      const response = await post({ clientPhone: '9999999999', clientEmail: 'family@example.com' });

      expect(response.status).not.toBe(409);
    });

    it('blocks on email for a legacy row that has no phone', async () => {
      signedOut();
      getActiveAppointmentsForContact.mockImplementation(async (args: { email?: string }) =>
        (args.email
          ? [{ id: 'appt_legacy', clientPhone: null, clientEmail: 'legacy@example.com' }]
          : []));

      const response = await post({ clientPhone: '9999999999', clientEmail: 'legacy@example.com' });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.code).toBe('EXISTING_APPOINTMENT');
    });

    it('reports an identity conflict when phone and email point at different people', async () => {
      signedOut();
      getActiveAppointmentsForContact.mockImplementation(async (args: { phone?: string; email?: string }) => {
        if (args.phone) {
          return [{ id: 'appt_phone', clientPhone: '9999999999', clientEmail: 'someone@example.com' }];
        }
        if (args.email) {
          return [{ id: 'appt_email', clientPhone: '4165550000', clientEmail: 'shared@example.com' }];
        }
        return [];
      });

      const response = await post({ clientPhone: '9999999999', clientEmail: 'shared@example.com' });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error.code).toBe('CONTACT_IDENTITY_CONFLICT');
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('never blocks on a cancelled or completed appointment', async () => {
      signedOut();
      canTechnicianTakeAppointment.mockReturnValue({
        available: true,
        schedule: { start: '09:00', end: '18:00' },
      });
      // The canonical lookup only ever returns active rows, so an inactive
      // appointment reaches the gate as no match at all.
      getActiveAppointmentsForContact.mockResolvedValue([]);

      const response = await post({ clientPhone: '9999999999' });

      expect(response.status).not.toBe(409);
    });

    it('scopes every duplicate lookup to the requested salon', async () => {
      signedOut();
      canTechnicianTakeAppointment.mockReturnValue({
        available: true,
        schedule: { start: '09:00', end: '18:00' },
      });

      await post({ clientPhone: '9999999999' });

      for (const call of getActiveAppointmentsForContact.mock.calls) {
        expect(call[0]).toMatchObject({ salonId: 'salon_1' });
      }
    });

    it('cannot use guest mode to reach another customer\'s appointment', async () => {
      // Guest mode drops the session, so the reschedule ownership check has no
      // authenticated client to lean on and the manage token must carry it.
      getAppointmentById.mockResolvedValue({
        id: 'appt_other',
        salonId: 'salon_1',
        clientPhone: '1111111111',
        status: 'confirmed',
        startTime: new Date('2099-03-13T15:00:00.000Z'),
      });

      const response = await post({
        clientPhone: '9999999999',
        bookingSubject: 'guest',
        originalAppointmentId: 'appt_other',
      });

      expect(response.status).toBe(403);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  /**
   * A stale cookie must behave exactly like no cookie. requireClientApiSession
   * already returns not-ok for an unknown/expired/deleted/malformed session
   * (see clientAuth.staleSession.test.ts); these assert what the ROUTE then
   * does with that — the browser books as a guest instead of inheriting the
   * account identity, so no one has to reach for Incognito.
   */
  describe('stale client sessions', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      canTechnicianTakeAppointment.mockReturnValue({
        available: true,
        schedule: { start: '09:00', end: '18:00' },
      });
      // Whatever the reason, the guard reports "no usable session".
      requireClientApiSession.mockResolvedValue({
        ok: false,
        response: new Response(null, { status: 401 }),
      });
    });

    const post = (body: Record<string, unknown> = {}) => POST(
      new Request('http://localhost/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug: 'salon-a',
          serviceIds: ['srv_1'],
          technicianId: 'tech_1',
          startTime: '2099-03-13T15:00:00.000Z',
          clientName: 'Stale Cookie Person',
          clientEmail: 'stale@example.com',
          clientPhone: '4165553333',
          ...body,
        }),
      }),
    );

    it('books under the typed details, not the account that owned the cookie', async () => {
      await post();

      expect(getActiveAppointmentsForContact).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '4165553333' }),
      );
      // '1111111111' is the account phone from the live-session fixture.
      expect(getActiveAppointmentsForContact).not.toHaveBeenCalledWith(
        expect.objectContaining({ phone: '1111111111' }),
      );
      expect(getOrCreateSalonClient).not.toHaveBeenCalledWith('salon_1', '1111111111', undefined);
    });

    it('does not demand a booking subject from a browser with a dead cookie', async () => {
      const response = await post();

      // No BOOKING_IDENTITY_CONFLICT: there is no signed-in identity to conflict with.
      expect(response.status).not.toBe(409);
    });

    it('exposes nothing about the account the stale cookie referred to', async () => {
      const response = await post();
      const text = await response.text();

      expect(text).not.toContain('1111111111');
      expect(text).not.toContain('Ava');
      expect(text).not.toContain('client_session_1');
    });

    it('lets the same browser keep booking without clearing cookies by hand', async () => {
      await post();

      // It reaches the booking transaction instead of being turned away at the
      // identity gate — which is the whole point: no Incognito required.
      expect(db.transaction).toHaveBeenCalled();
    });
  });
});
