import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ salon: vi.fn(), read: vi.fn(), status: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/queries', () => ({ getSalonBySlug: mocks.salon }));
vi.mock('@/libs/salonStatus', () => ({ guardSalonApiRoute: vi.fn(), isOnlineBookingEnabled: vi.fn() }));
vi.mock('@/libs/customerAssistant/operationStore.server', () => ({
  readCustomerBookingOperation: mocks.read,
  CustomerBookingOperationError: class extends Error {},
}));
vi.mock('@/libs/customerAssistant/bookingStatus.server', () => ({ readCustomerBookingStatus: mocks.status }));

const { POST } = await import('../customer-booking/[salonId]/status/route');
const { CustomerBookingOperationError } = await import('@/libs/customerAssistant/operationStore.server');
const context = { params: Promise.resolve({ salonId: 'tenant-a' }) };
function request(body: unknown = { capability: 'opaque-capability' }, origin = 'https://app.test') {
  return new Request('https://app.test/api/public/customer-assistant/synthetic-salon/booking/status', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'false');
  vi.stubEnv('OPENAI_API_KEY_CUSTOMER', '');
  vi.stubEnv('CUSTOMER_ASSISTANT_SIGNING_SECRET', 's'.repeat(32));
  mocks.salon.mockResolvedValue({ id: 'tenant-a', slug: 'synthetic-salon', publicationStatus: 'unpublished' });
  mocks.read.mockResolvedValue({ id: 'operation', salonId: 'tenant-a', appointmentId: 'appointment' });
  mocks.status.mockResolvedValue({ kind: 'booking_status', status: 'confirmed' });
});

describe('durable customer booking recovery boundary', () => {
  it('recovers an existing operation with the model disabled and salon unpublished', async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.read).toHaveBeenCalledWith({ salonId: 'tenant-a', capability: 'opaque-capability', secret: 's'.repeat(32) });
    expect(await response.json()).toEqual({ kind: 'booking_status', status: 'confirmed' });
  });

  it('rejects cross-origin calls and client-supplied authority before reading state', async () => {
    expect((await POST(request({}, 'https://attacker.test'), context)).status).toBe(403);
    expect((await POST(request({ capability: 'opaque', salonId: 'tenant-b' }), context)).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('does not expose booking state for invalid or wrong-tenant capabilities', async () => {
    mocks.read.mockRejectedValue(new CustomerBookingOperationError('invalid_operation'));

    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('reports database ambiguity as unavailable rather than no booking', async () => {
    mocks.read.mockRejectedValue(new Error('synthetic database timeout'));
    const response = await POST(request(), context);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ kind: 'recovery_unavailable' });
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('requires a strong dedicated signing secret without falling back to owner credentials', async () => {
    vi.stubEnv('CUSTOMER_ASSISTANT_SIGNING_SECRET', '');
    vi.stubEnv('OWNER_ASSISTANT_SIGNING_SECRET', 'o'.repeat(32));

    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
