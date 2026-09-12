import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  getAppointmentReviewState: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
  scheduleReviewRequest: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: vi.fn(() => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/libs/reviewRequests.server', () => ({
  getAppointmentReviewState: mocks.getAppointmentReviewState,
  scheduleReviewRequest: mocks.scheduleReviewRequest,
}));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess: mocks.requireAppointmentManagerAccess }));

const post = async () => {
  const { POST } = await import('./route');
  return POST(new Request('https://app.test/api/appointments/appt_1/review-request?salonSlug=isla', { method: 'POST' }), {
    params: Promise.resolve({ id: 'appt_1' }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAppointmentManagerAccess.mockResolvedValue({ ok: true, appointment: { id: 'appt_1', salonId: 'salon_1' } });
  mocks.transaction.mockImplementation(async (callback: (tx: object) => unknown) => callback({ marker: 'transaction' }));
  mocks.getAppointmentReviewState.mockResolvedValue({ status: 'scheduled', phone: '4165550100' });
});

describe('appointment review request route', () => {
  it('queues a manual request under the server-resolved appointment salon', async () => {
    const response = await post();

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { status: 'scheduled', phone: '4165550100' } });
    expect(mocks.scheduleReviewRequest).toHaveBeenCalledWith({ marker: 'transaction' }, 'salon_1', 'appt_1', false);
  });

  it('keeps repeated POSTs stable by delegating both requests to the idempotent service', async () => {
    await post();
    await post();

    expect(mocks.scheduleReviewRequest).toHaveBeenCalledTimes(2);
    expect(mocks.getAppointmentReviewState).toHaveBeenCalledTimes(2);
    expect(mocks.scheduleReviewRequest).toHaveBeenNthCalledWith(1, { marker: 'transaction' }, 'salon_1', 'appt_1', false);
    expect(mocks.scheduleReviewRequest).toHaveBeenNthCalledWith(2, { marker: 'transaction' }, 'salon_1', 'appt_1', false);
  });

  it('returns the authorization response without scheduling a forged or cross-tenant appointment', async () => {
    mocks.requireAppointmentManagerAccess.mockResolvedValue({ ok: false, response: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }) });

    expect((await post()).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.scheduleReviewRequest).not.toHaveBeenCalled();
    expect(mocks.getAppointmentReviewState).not.toHaveBeenCalled();
  });
});
