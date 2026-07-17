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
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    eval: vi.fn(),
  },
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

import { DEL_IF_OWNER_LUA } from '@/core/redis/keys';

import { POST } from './route';

function bookingRequest() {
  return new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'lock-lifecycle-key',
    },
    body: JSON.stringify({
      salonSlug: 'salon-a',
      serviceIds: ['srv_1'],
      technicianId: 'tech_1',
      startTime: '2099-03-13T15:00:00.000Z',
    }),
  });
}

describe('POST /api/appointments booking-lock lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSalonBySlug.mockResolvedValue({ id: 'salon_1', slug: 'salon-a', name: 'Salon A' });
    guardSalonApiRoute.mockResolvedValue(null);
    guardFeatureEntitlement.mockResolvedValue(null);
    requireStaffSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '1111111111',
      phoneVariants: ['1111111111'],
      session: { phone: '+11111111111', clientName: 'Ava', sessionId: 'client_session_1' },
    });
    getActiveAppointmentsForClient.mockResolvedValue([]);
    getLocationById.mockResolvedValue(null);
    getPrimaryLocation.mockResolvedValue(null);

    isRedisAvailable.mockResolvedValue(true);
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK'); // lock acquired
    redis.eval.mockResolvedValue(1);

    // Force a failure AFTER the lock is acquired: unknown services.
    getServicesByIds.mockResolvedValue([]);
  });

  it('releases the lock (delete-if-owner) when the booking fails after lock acquisition', async () => {
    const response = await POST(bookingRequest());

    expect(response.status).toBeGreaterThanOrEqual(400);

    // Lock was acquired…
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('lock'),
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX',
    );

    // …and released with the compare-and-delete script using the same
    // key/token pair, so an immediate retry is not stuck behind the TTL.
    const [lockKey, lockToken] = redis.set.mock.calls[0]!;
    const releaseCall = redis.eval.mock.calls.find(call => call[0] === DEL_IF_OWNER_LUA);

    expect(releaseCall).toBeTruthy();
    expect(releaseCall![2]).toBe(lockKey);
    expect(releaseCall![3]).toBe(lockToken);
  });

  it('does not attempt a release when the request never owned the lock (cached result)', async () => {
    redis.get.mockResolvedValue(JSON.stringify({
      payloadHash: null,
      statusCode: 201,
      responseBody: { data: { appointmentId: 'appt_cached' } },
    }));

    const response = await POST(bookingRequest());

    expect(response.status).toBe(201);
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
