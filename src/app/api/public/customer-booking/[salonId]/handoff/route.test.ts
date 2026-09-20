import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  secret: vi.fn(),
  read: vi.fn(),
  status: vi.fn(),
  handoff: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/customerAssistant/access.server', () => ({ getCustomerBookingRecoverySecret: mocks.secret }));
vi.mock('@/libs/customerAssistant/operationStore.server', () => ({
  CustomerBookingOperationError: class CustomerBookingOperationError extends Error {
    constructor(readonly code: string) {
      super('CUSTOMER_BOOKING_OPERATION_REJECTED');
    }
  },
  readCustomerBookingOperation: mocks.read,
}));
vi.mock('@/libs/customerAssistant/bookingStatus.server', () => ({ readCustomerBookingStatus: mocks.status }));
vi.mock('@/libs/customerAssistant/normalConfirmHandoff.server', () => ({ issueNormalConfirmHandoff: mocks.handoff }));

const { POST } = await import('./route');
const { CustomerBookingOperationError } = await import('@/libs/customerAssistant/operationStore.server');

const SALON_ID = 'salon-a';
const SESSION_ID = 'f6e8ba4e-04bc-45bd-9be3-0c8f1ae3cf04';
const SECRET = 's'.repeat(32);
const context = { params: Promise.resolve({ salonId: SALON_ID }) };

function request(body: unknown = { capability: 'opaque-capability' }, origin = 'https://app.test') {
  return new Request(`https://app.test/api/public/customer-booking/${SALON_ID}/handoff`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CUSTOMER_ASSISTANT_ENABLED', 'false');
  vi.stubEnv('OPENAI_API_KEY_CUSTOMER', '');
  mocks.secret.mockReturnValue(SECRET);
  mocks.read.mockResolvedValue({ id: 'operation-a', salonId: SALON_ID, sessionId: SESSION_ID, appointmentId: null });
  mocks.status.mockResolvedValue({ kind: 'booking_status', status: 'not_created' });
  mocks.handoff.mockReturnValue({ flowToken: 'normal-flow-token', expiresAt: '2030-01-01T00:00:00.000Z' });
});

describe('POST /api/public/customer-booking/[salonId]/handoff', () => {
  it('restores an existing operation into the normal confirmation flow with the exact operation session', async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.read).toHaveBeenCalledWith({ salonId: SALON_ID, capability: 'opaque-capability', secret: SECRET });
    expect(mocks.status).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION_ID }), SECRET);
    expect(mocks.handoff).toHaveBeenCalledWith({ salonId: SALON_ID, secret: SECRET, flowId: SESSION_ID });
    expect(await response.json()).toEqual({
      handoff: { flowToken: 'normal-flow-token', expiresAt: '2030-01-01T00:00:00.000Z' },
      status: { kind: 'booking_status', status: 'not_created' },
    });
  });

  it('works while customer AI is disabled because recovery has no AI admission dependency', async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.handoff).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-origin and malformed or surplus input before reading state', async () => {
    expect((await POST(request({}, 'https://attacker.test'), context)).status).toBe(403);
    expect((await POST(request({ capability: 'opaque-capability', salonId: 'salon-b' }), context)).status).toBe(400);
    expect((await POST(request({ capability: '' }), context)).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it.each(['invalid_operation', 'operation_expired'] as const)('rejects %s capabilities without status or handoff', async (code) => {
    mocks.read.mockRejectedValue(new CustomerBookingOperationError(code));

    const response = await POST(request(), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ kind: 'recovery_unavailable' });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it('does not reveal a wrong-tenant capability', async () => {
    mocks.read.mockRejectedValue(new CustomerBookingOperationError('invalid_operation'));

    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.read).toHaveBeenCalledWith({ salonId: SALON_ID, capability: 'opaque-capability', secret: SECRET });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it('reports storage failures as unavailable without minting a handoff', async () => {
    mocks.read.mockRejectedValue(new Error('database timeout'));

    const response = await POST(request(), context);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ kind: 'recovery_unavailable' });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it('passes through the canonical status for an operation already linked by a concurrent commit', async () => {
    mocks.read.mockResolvedValue({ id: 'operation-a', salonId: SALON_ID, sessionId: SESSION_ID, appointmentId: 'appointment-a', committedAt: new Date() });
    mocks.status.mockResolvedValue({ kind: 'booking_status', status: 'confirmed', appointment: { id: 'appointment-a' } });

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: { kind: 'booking_status', status: 'confirmed', appointment: { id: 'appointment-a' } } });
    expect(mocks.status).toHaveBeenCalledWith(expect.objectContaining({ appointmentId: 'appointment-a' }), SECRET);
  });
});
