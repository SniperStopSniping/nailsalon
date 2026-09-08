import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ guard: vi.fn(), readiness: vi.fn(), queue: vi.fn(), history: vi.fn(), retry: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: mocks.guard }));
vi.mock('@/libs/clientLifecycleStabilization', () => ({ ClientLifecycleStabilizationError: class extends Error {} }));
vi.mock('@/libs/clientMessaging', () => ({
  ClientMessagingError: class extends Error {
    constructor(public code: string, message: string, public status = 400) {
      super(message);
    }
  },
  queueClientSms: mocks.queue,
  getClientSmsHistory: mocks.history,
  retryClientSms: mocks.retry,
}));
vi.mock('@/libs/integrationHealth', () => ({ getSalonSmsReadiness: mocks.readiness }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: () => ({ allowed: true }), getClientIp: () => 'test', rateLimitResponse: vi.fn() }));
const ctx = { params: Promise.resolve({ id: 'client-a' }) };
const send = () => new Request('https://luster.test/api/admin/clients/client-a/messages', { method: 'POST', body: JSON.stringify({ salonSlug: 'salon-a', requestId: crypto.randomUUID(), message: 'Appointment update' }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ salon: { id: 'salon-from-session' }, error: null });
  mocks.readiness.mockResolvedValue({ manualAvailable: true });
  mocks.queue.mockResolvedValue({ intentId: 'ci-test', created: true });
  mocks.history.mockResolvedValue([]);
});

describe('owner manual SMS route', () => {
  it('denies unauthorized tenant access before reading settings or queuing', async () => {
    const { POST } = await import('./route');
    mocks.guard.mockResolvedValue({ salon: null, error: new Response(null, { status: 403 }) });

    expect((await POST(send(), ctx)).status).toBe(403);
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it('lets the service reject a new request with missing Twilio configuration after checking for a replay', async () => {
    const { POST } = await import('./route');
    const { ClientMessagingError } = await import('@/libs/clientMessaging');
    mocks.readiness.mockResolvedValue({ manualAvailable: false, blockingReason: 'SENDER_NOT_READY', detail: 'Texting is not set up yet.' });
    mocks.queue.mockRejectedValue(new ClientMessagingError('SENDER_NOT_READY', 'Texting is not set up yet.', 409));
    const response = await POST(send(), ctx);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'SENDER_NOT_READY', message: 'Texting is not set up yet.' } });
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon-from-session',
      clientId: 'client-a',
      availability: { available: false, code: 'SENDER_NOT_READY', message: 'Texting is not set up yet.' },
    }));
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('returns the original intent when the same request is replayed after texting becomes unavailable', async () => {
    const { POST } = await import('./route');
    const history = [{ id: 'ci-existing', status: 'delivered' }];
    const sms = { manualAvailable: false, blockingReason: 'SENDER_NOT_READY', detail: 'Texting is not set up yet.' };
    mocks.readiness.mockResolvedValue(sms);
    mocks.queue.mockResolvedValue({ intentId: 'ci-existing', created: false });
    mocks.history.mockResolvedValue(history);
    const request = send();
    const originalPayload = await request.clone().json();
    const response = await POST(request, ctx);

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ data: { intentId: 'ci-existing', created: false, history, sms } });
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon-from-session',
      clientId: 'client-a',
      requestId: originalPayload.requestId,
      availability: { available: false, code: 'SENDER_NOT_READY', message: 'Texting is not set up yet.' },
    }));
    expect(mocks.history).toHaveBeenCalledWith({ salonId: 'salon-from-session', clientId: 'client-a' });
  });

  it('still requires available texting before retrying a failed provider send', async () => {
    const { PATCH } = await import('./route');
    mocks.readiness.mockResolvedValue({ manualAvailable: false, blockingReason: 'SENDER_NOT_READY', detail: 'Texting is not set up yet.' });
    const request = new Request('https://luster.test/api/admin/clients/client-a/messages', {
      method: 'PATCH',
      body: JSON.stringify({ salonSlug: 'salon-a', intentId: 'ci-failed' }),
    });
    const response = await PATCH(request, ctx);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'SENDER_NOT_READY' } });
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it('queues against the server-authorized salon and returns history', async () => {
    const { POST } = await import('./route');

    expect((await POST(send(), ctx)).status).toBe(202);
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ salonId: 'salon-from-session', clientId: 'client-a' }));
  });

  it('rejects a client-supplied recipient or salon identifier', async () => {
    const { POST } = await import('./route');
    const request = new Request('https://luster.test/messages', { method: 'POST', body: JSON.stringify({ salonSlug: 'salon-a', message: 'Hi', requestId: crypto.randomUUID(), recipient: '4165550199', salonId: 'other-salon' }) });

    expect((await POST(request, ctx)).status).toBe(400);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
