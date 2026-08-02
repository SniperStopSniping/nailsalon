/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  canTechnicianTakeAppointment,
  loadBookingPolicy,
  resolveTechnicianCapabilityMode,
  resolveAutomaticBookingDiscount,
  checkPublicBookingRateLimit,
  getPublicBookingClientIp,
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
  checkPublicBookingRateLimit: vi.fn(),
  getPublicBookingClientIp: vi.fn(() => '203.0.113.7'),
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

vi.mock('@/libs/publicBookingRateLimit.server', () => ({
  checkPublicBookingRateLimit,
  getPublicBookingClientIp,
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
import { hashCanonicalBookingRequest } from '@/libs/bookingPolicyAcknowledgment';

import { POST } from './route';

function bookingRequest(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/appointments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'lock-lifecycle-key',
      'x-forwarded-for': '203.0.113.7',
    },
    body: JSON.stringify({
      salonSlug: 'salon-a',
      serviceIds: ['srv_1'],
      technicianId: 'tech_1',
      startTime: '2099-03-13T15:00:00.000Z',
      ...overrides,
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

    checkPublicBookingRateLimit.mockResolvedValue({
      allowed: true,
      reason: 'allowed',
    });

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
    expect(checkPublicBookingRateLimit).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('returns a structured 429 before service or provider work when a public booking is limited', async () => {
    checkPublicBookingRateLimit.mockResolvedValue({
      allowed: false,
      reason: 'rate_limited',
      retryAfterSeconds: 73,
    });

    const response = await POST(bookingRequest());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('73');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toMatchObject({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: expect.any(String),
        retryAfterSeconds: 73,
      },
    });
    expect(checkPublicBookingRateLimit).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientIp: '203.0.113.7',
      normalizedPhone: '1111111111',
    });
    expect(getPublicBookingClientIp).toHaveBeenCalledWith(expect.any(Request));
    expect(getServicesByIds).not.toHaveBeenCalled();
    expect(hasGoogleCalendarConflict).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(sendCustomerBookingConfirmationEmail).not.toHaveBeenCalled();
    expect(sendBookingNotificationsForNewBooking).not.toHaveBeenCalled();
  });

  it('does not invoke the booking limiter for an invalid request schema', async () => {
    const response = await POST(new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: 'salon-a' }),
    }));

    expect(response.status).toBe(400);
    expect(checkPublicBookingRateLimit).not.toHaveBeenCalled();
    expect(getSalonBySlug).not.toHaveBeenCalled();
    expect(getServicesByIds).not.toHaveBeenCalled();
  });

  it('bypasses the public limiter for authenticated admin appointment creation', async () => {
    requireAdmin.mockResolvedValue({ ok: true });

    const response = await POST(bookingRequest({
      clientPhone: '1111111111',
      clientName: 'Ava',
      clientEmail: 'ava@example.com',
    }));

    expect(response.status).toBe(400);
    expect(checkPublicBookingRateLimit).not.toHaveBeenCalled();
    expect(getServicesByIds).toHaveBeenCalledWith(['srv_1'], 'salon_1');
  });

  it('bypasses the public limiter for authenticated staff appointment creation', async () => {
    requireStaffSession.mockResolvedValue({
      ok: true,
      session: { salonId: 'salon_1', technicianId: 'tech_1' },
    });

    const response = await POST(bookingRequest({
      clientPhone: '1111111111',
      clientName: 'Ava',
      clientEmail: 'ava@example.com',
    }));

    expect(response.status).toBe(400);
    expect(checkPublicBookingRateLimit).not.toHaveBeenCalled();
    expect(getServicesByIds).toHaveBeenCalledWith(['srv_1'], 'salon_1');
  });

  it('fails open and continues normal booking processing when the limiter is unavailable', async () => {
    checkPublicBookingRateLimit.mockResolvedValue({
      allowed: true,
      reason: 'unavailable',
    });

    const response = await POST(bookingRequest());

    expect(response.status).toBe(400);
    expect(checkPublicBookingRateLimit).toHaveBeenCalledTimes(1);
    expect(getServicesByIds).toHaveBeenCalledWith(['srv_1'], 'salon_1');
  });

  it('binds the acknowledgment attempt, version, and acceptance state into the full request hash', () => {
    const baseRequest = {
      salonId: 'salon_1',
      startTime: '2099-03-13T15:00:00.000Z',
      bookingPolicyAcknowledgment: {
        accepted: true,
        version: `policy-v1:${'a'.repeat(64)}`,
        attemptId: '4e4cc0d4-5678-4b18-a9e1-1ddf88980b41',
      },
    };
    const originalHash = hashCanonicalBookingRequest(baseRequest);
    const exactRetryHash = hashCanonicalBookingRequest(baseRequest);
    const changedAttemptHash = hashCanonicalBookingRequest({
      ...baseRequest,
      bookingPolicyAcknowledgment: {
        ...baseRequest.bookingPolicyAcknowledgment,
        attemptId: '3d58db86-9ab8-426c-b65a-54a116671f4b',
      },
    });
    const changedVersionHash = hashCanonicalBookingRequest({
      ...baseRequest,
      bookingPolicyAcknowledgment: {
        ...baseRequest.bookingPolicyAcknowledgment,
        version: `policy-v1:${'b'.repeat(64)}`,
      },
    });
    const changedAcceptanceHash = hashCanonicalBookingRequest({
      ...baseRequest,
      bookingPolicyAcknowledgment: {
        ...baseRequest.bookingPolicyAcknowledgment,
        accepted: false,
      },
    });

    expect(originalHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(exactRetryHash).toBe(originalHash);
    expect(changedAttemptHash).not.toBe(originalHash);
    expect(changedVersionHash).not.toBe(originalHash);
    expect(changedAcceptanceHash).not.toBe(originalHash);
  });
});
