import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ guard: vi.fn(), readiness: vi.fn(), queue: vi.fn(), history: vi.fn(), preference: vi.fn(), retry: vi.fn() }));
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
  getClientSmsPreference: mocks.preference,
  retryClientSms: mocks.retry,
}));
vi.mock('@/libs/reviewRequests.server', () => ({
  ClientReviewRequestError: class extends Error {
    constructor(public code: string, message: string, public status = 409) {
      super(message);
    }
  },
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
  mocks.preference.mockResolvedValue({ state: 'customer_disabled', selection: 'explicit_off' });
});

describe('owner manual SMS route', () => {
  it('returns the preference without requiring delivery history, scoped to the authorized salon', async () => {
    const { GET } = await import('./route');
    const response = await GET(new Request('https://luster.test/messages?salonSlug=salon-a'), ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { history: [], reminderPreference: { state: 'customer_disabled' } } });
    expect(mocks.preference).toHaveBeenCalledWith({ salonId: 'salon-from-session', clientId: 'client-a', appointmentId: undefined });
  });

  it('denies unauthorized preference reads', async () => {
    const { GET } = await import('./route');
    mocks.guard.mockResolvedValue({ salon: null, error: new Response(null, { status: 403 }) });

    expect((await GET(new Request('https://luster.test/messages?salonSlug=other'), ctx)).status).toBe(403);
    expect(mocks.preference).not.toHaveBeenCalled();
  });

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

  it('passes an explicit Google-review purpose through the server-authorized queue', async () => {
    const { POST } = await import('./route');
    const requestId = crypto.randomUUID();
    const response = await POST(new Request('https://luster.test/messages', {
      method: 'POST',
      body: JSON.stringify({ salonSlug: 'salon-a', requestId, message: 'Please review us', purpose: 'google_review' }),
    }), ctx);

    expect(response.status).toBe(202);
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon-from-session',
      clientId: 'client-a',
      requestId,
      purpose: 'google_review',
    }));
  });

  it('keeps ordinary messages purpose-free and rejects an appointment on the Google preset', async () => {
    const { POST } = await import('./route');
    await POST(send(), ctx);

    expect(mocks.queue).toHaveBeenCalledWith(expect.not.objectContaining({ purpose: expect.anything() }));

    const response = await POST(new Request('https://luster.test/messages', {
      method: 'POST',
      body: JSON.stringify({ salonSlug: 'salon-a', requestId: crypto.randomUUID(), message: 'Review', purpose: 'google_review', appointmentId: 'appt_1' }),
    }), ctx);

    expect(response.status).toBe(400);
  });

  it('rejects a client-supplied recipient or salon identifier', async () => {
    const { POST } = await import('./route');
    const request = new Request('https://luster.test/messages', { method: 'POST', body: JSON.stringify({ salonSlug: 'salon-a', message: 'Hi', requestId: crypto.randomUUID(), recipient: '4165550199', salonId: 'other-salon' }) });

    expect((await POST(request, ctx)).status).toBe(400);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
