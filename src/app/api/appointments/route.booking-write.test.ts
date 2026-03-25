import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  canTechnicianTakeAppointment,
  loadBookingPolicy,
  resolveTechnicianCapabilityMode,
  isRedisAvailable,
  redis,
  getSalonBySlug,
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
  db,
} = vi.hoisted(() => ({
  canTechnicianTakeAppointment: vi.fn(),
  loadBookingPolicy: vi.fn(),
  resolveTechnicianCapabilityMode: vi.fn(),
  isRedisAvailable: vi.fn(),
  redis: null,
  getSalonBySlug: vi.fn(),
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
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('@/libs/bookingPolicy', () => ({
  canTechnicianTakeAppointment,
  getTorontoDateString: vi.fn(() => '2026-03-13'),
  loadBookingPolicy,
  resolveTechnicianCapabilityMode,
}));

vi.mock('@/core/redis/redisClient', () => ({
  isRedisAvailable,
  redis,
}));

vi.mock('@/libs/queries', () => ({
  getSalonBySlug,
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

vi.mock('@/libs/SMS', () => ({
  sendBookingConfirmationToClient: vi.fn(),
  sendBookingNotificationToTech: vi.fn(),
  sendCancellationNotificationToTech: vi.fn(),
  sendRescheduleConfirmation: vi.fn(),
}));

import { POST } from './route';

describe('POST /api/appointments booking policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSalonBySlug.mockResolvedValue({ id: 'salon_1', slug: 'salon-a', name: 'Salon A' });
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
    canTechnicianTakeAppointment.mockReturnValue({
      available: false,
      reason: 'outside_schedule',
    });
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
  });

  it('rejects unauthenticated customer booking attempts even if a body phone is supplied', async () => {
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

    expect(response.status).toBe(401);
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
        update: vi.fn(() => ({
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
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn(async () => []),
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
