import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
  requestDepositRefund,
  serializeDepositForRole,
} = vi.hoisted(() => ({
  assertNoDevRoleBypass: vi.fn(),
  requireDepositMoneyActor: vi.fn(),
  requestDepositRefund: vi.fn(),
  serializeDepositForRole: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/deposits/depositMoneyGuard', () => ({
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
}));
vi.mock('@/libs/deposits/depositLifecycle', () => ({
  requestDepositRefund,
  serializeDepositForRole,
}));

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const actor = { requestedBy: 'admin_1' };
const guarded = {
  ok: true,
  admin: { isSuperAdmin: false },
  salon: { id: 'salon_1' },
  deposit: { id: 'dep_1' },
  actor,
};

function request(body = 'not-json') {
  return new Request(
    'http://localhost/api/admin/appointments/appt_1/deposit/refund?salonSlug=salon-a',
    { method: 'POST', body },
  );
}

describe('POST /api/admin/appointments/[id]/deposit/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertNoDevRoleBypass.mockResolvedValue(null);
    requireDepositMoneyActor.mockResolvedValue(guarded);
    requestDepositRefund.mockResolvedValue({
      ok: true,
      disposition: 'refunded',
      deposit: { id: 'dep_1', status: 'refunded' },
      refundId: 're_1',
    });
    serializeDepositForRole.mockReturnValue({ id: 'dep_1', status: 'refunded' });
  });

  it('refuses the dev-role bypass before running the route guard', async () => {
    assertNoDevRoleBypass.mockResolvedValue(Response.json({}, { status: 403 }));

    const response = await POST(request(), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(403);
    expect(requireDepositMoneyActor).not.toHaveBeenCalled();
    expect(requestDepositRefund).not.toHaveBeenCalled();
  });

  it('does not parse a body and runs the tenant-scoped owner refund', async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(200);
    expect(requireDepositMoneyActor).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      salonSlug: 'salon-a',
      rateLimitKey: 'admin-deposit-refund',
    }));
    expect(requestDepositRefund).toHaveBeenCalledWith({
      depositId: 'dep_1',
      salonId: 'salon_1',
      actor,
    });
    expect(serializeDepositForRole).toHaveBeenCalledWith(
      'admin',
      expect.objectContaining({ id: 'dep_1' }),
    );
    await expect(response.json()).resolves.toEqual({
      disposition: 'refunded',
      deposit: { id: 'dep_1', status: 'refunded' },
      refundId: 're_1',
    });
  });

  it('returns the lifecycle conflict without serializing a deposit', async () => {
    requestDepositRefund.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'REFUND_ALREADY_REQUESTED',
      message: 'Already requested.',
    });

    const response = await POST(request(), { params: Promise.resolve({ id: 'appt_1' }) });

    expect(response.status).toBe(409);
    expect(serializeDepositForRole).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: { code: 'REFUND_ALREADY_REQUESTED', message: 'Already requested.' },
    });
  });
});
