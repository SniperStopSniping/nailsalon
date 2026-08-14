import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
  retryFailedDepositRefund,
  serializeDepositForRole,
} = vi.hoisted(() => ({
  assertNoDevRoleBypass: vi.fn(),
  requireDepositMoneyActor: vi.fn(),
  retryFailedDepositRefund: vi.fn(),
  serializeDepositForRole: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/deposits/depositMoneyGuard', () => ({
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
}));
vi.mock('@/libs/deposits/depositLifecycle', () => ({
  retryFailedDepositRefund,
  serializeDepositForRole,
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const actor = { requestedBy: 'super_1', requestedByImpersonated: true };
const guarded = {
  ok: true,
  admin: { isSuperAdmin: true },
  salon: { id: 'salon_1' },
  deposit: { id: 'dep_1' },
  actor,
};

describe('POST /api/admin/appointments/[id]/deposit/refund/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertNoDevRoleBypass.mockResolvedValue(null);
    requireDepositMoneyActor.mockResolvedValue(guarded);
    retryFailedDepositRefund.mockResolvedValue({
      ok: true,
      disposition: 'refund_retried',
      deposit: { id: 'dep_1', refundStatus: 'requested' },
    });
    serializeDepositForRole.mockReturnValue({ id: 'dep_1', refundStatus: 'requested' });
  });

  it('refuses the dev-role bypass before loading money state', async () => {
    assertNoDevRoleBypass.mockResolvedValue(Response.json({}, { status: 403 }));
    const response = await POST(
      new Request('http://localhost/refund/retry', { method: 'POST' }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(403);
    expect(requireDepositMoneyActor).not.toHaveBeenCalled();
  });

  it('does not parse a body and reattributes the retrying impersonated actor', async () => {
    const response = await POST(
      new Request(
        'http://localhost/api/admin/appointments/appt_1/deposit/refund/retry?salonSlug=salon-a',
        { method: 'POST', body: '{malformed' },
      ),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(200);
    expect(retryFailedDepositRefund).toHaveBeenCalledWith({
      depositId: 'dep_1',
      salonId: 'salon_1',
      actor,
    });
    expect(serializeDepositForRole).toHaveBeenCalledWith(
      'super_admin',
      expect.objectContaining({ id: 'dep_1' }),
    );
  });

  it('passes a bounded retry conflict through unchanged', async () => {
    retryFailedDepositRefund.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'REFUND_RETRY_LIMIT_REACHED',
      message: 'Retry limit reached.',
    });
    const response = await POST(
      new Request('http://localhost/retry?salonSlug=salon-a', { method: 'POST' }),
      { params: Promise.resolve({ id: 'appt_1' }) },
    );

    expect(response.status).toBe(409);
    expect(serializeDepositForRole).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: { code: 'REFUND_RETRY_LIMIT_REACHED', message: 'Retry limit reached.' },
    });
  });
});
