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
  getAppointmentById,
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
  getAppointmentById: vi.fn(),
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

vi.mock('@/libs/queries', () => ({
  getSalonBySlug,
  getSalonById,
  getServicesByIds,
  getTechnicianById,
  getLocationById,
  getPrimaryLocation,
  getActiveAppointmentsForClient,
  getAppointmentById,
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

vi.mock('@/libs/googleCalendar', () => ({
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
      }))
      .mockImplementationOnce(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
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
    expect(getActiveAppointmentsForClient).not.toHaveBeenCalled();
    expect(getOrCreateSalonClient).not.toHaveBeenCalled();
  });

  it('uses the authenticated client session phone instead of the request body phone', async () => {
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
          startTime: '2099-03-13T15:00:00.000Z',
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(getActiveAppointmentsForClient).toHaveBeenCalledWith('1111111111', 'salon_1');
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
    });

    const committedAppointments: string[] = [];
    const committedCancelledAppointments: string[] = [];

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
            set: vi.fn(() => ({
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
});
