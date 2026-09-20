import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/core/redis/redisClient', () => ({
  isRedisAvailable: mocks.available,
  redis: { get: mocks.get, set: mocks.set },
}));

const { hashPublicBookingRecoveryKey } = await import('@/libs/publicBookingRecovery.server');
const { getBookingIdempotencyKey } = await import('@/core/redis/keys');
const { POST } = await import('./route');

const ATTEMPT_ID = 'd5be2570-801d-4b1c-b4ff-cb5974244026';
const RECOVERY_KEY = '5aae910a-90e8-4444-86cc-ee1346ad2fa3';
const context = { params: Promise.resolve({ salonId: 'salon-a' }) };

function cachedReceipt() {
  return JSON.stringify({
    payloadHash: 'unchanged-canonical-payload-hash',
    createdAt: '2026-09-19T12:00:00.000Z',
    statusCode: 201,
    recoveryKeyHash: hashPublicBookingRecoveryKey(RECOVERY_KEY),
    responseBody: {
      data: {
        appointmentId: 'appointment_123',
        appointment: { id: 'appointment_123', status: 'confirmed' },
        deposit: { required: true, checkoutUrl: 'https://checkout.example/session' },
      },
      meta: { timestamp: '2026-09-19T12:00:00.000Z' },
    },
  });
}

function request(
  body: unknown = { attemptId: ATTEMPT_ID, recoveryKey: RECOVERY_KEY },
  origin = 'https://app.test',
) {
  return new Request('https://app.test/api/public/booking-attempt/salon-a/status', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.available.mockResolvedValue(true);
  mocks.get.mockResolvedValue(null);
});

describe('POST /api/public/booking-attempt/[salonId]/status', () => {
  it('returns only the original successful receipt and preserves checkout payloads', async () => {
    const expectedKey = getBookingIdempotencyKey('salon-a', ATTEMPT_ID);
    mocks.get.mockImplementation(async (key: string) => key === expectedKey ? cachedReceipt() : null);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      kind: 'resolved',
      response: {
        data: {
          appointmentId: 'appointment_123',
          appointment: { id: 'appointment_123', status: 'confirmed' },
          deposit: { required: true, checkoutUrl: 'https://checkout.example/session' },
        },
        meta: { timestamp: '2026-09-19T12:00:00.000Z' },
      },
    });
    expect(mocks.get).toHaveBeenCalledWith(expectedKey);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('does not cross tenant cache namespaces', async () => {
    const tenantAKey = getBookingIdempotencyKey('salon-a', ATTEMPT_ID);
    mocks.get.mockImplementation(async (key: string) => key === tenantAKey ? cachedReceipt() : null);

    const response = await POST(request(), { params: Promise.resolve({ salonId: 'salon-b' }) });

    expect(await response.json()).toEqual({ kind: 'unresolved' });
    expect(mocks.get).toHaveBeenCalledWith(getBookingIdempotencyKey('salon-b', ATTEMPT_ID));
  });

  it('fails closed for a wrong proof, old receipt, missing receipt, or Redis error without creating anything', async () => {
    mocks.get.mockResolvedValue(cachedReceipt());

    expect(await (await POST(request({ attemptId: ATTEMPT_ID, recoveryKey: '578062aa-6708-479e-b3d6-1e6a398ad052' }), context)).json())
      .toEqual({ kind: 'unresolved' });

    mocks.get.mockResolvedValue(JSON.stringify({ statusCode: 201, responseBody: {} }));

    expect(await (await POST(request(), context)).json()).toEqual({ kind: 'unresolved' });

    mocks.get.mockResolvedValue(null);

    expect(await (await POST(request(), context)).json()).toEqual({ kind: 'unresolved' });

    mocks.get.mockRejectedValue(new Error('Redis unavailable'));

    expect(await (await POST(request(), context)).json()).toEqual({ kind: 'unresolved' });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('rejects cross-origin or malformed input before reading the receipt', async () => {
    expect((await POST(request({}, 'https://attacker.test'), context)).status).toBe(403);
    expect((await POST(request({ attemptId: ATTEMPT_ID, recoveryKey: RECOVERY_KEY, salonId: 'salon-b' }), context)).status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('returns unresolved when Redis is unavailable rather than asserting no booking exists', async () => {
    mocks.available.mockResolvedValue(false);

    const response = await POST(request(), context);

    expect(await response.json()).toEqual({ kind: 'unresolved' });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
