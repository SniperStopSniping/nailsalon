import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
  serializeDepositForRole,
  waiveDeposit,
} = vi.hoisted(() => ({
  assertNoDevRoleBypass: vi.fn(),
  requireDepositMoneyActor: vi.fn(),
  serializeDepositForRole: vi.fn(),
  waiveDeposit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/deposits/depositMoneyGuard', () => ({
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
}));
vi.mock('@/libs/deposits/depositLifecycle', () => ({
  serializeDepositForRole,
  waiveDeposit,
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

function request(body: unknown) {
  return new Request('http://localhost/deposit/waive?salonSlug=salon-a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/appointments/[id]/deposit/waive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertNoDevRoleBypass.mockResolvedValue(null);
    requireDepositMoneyActor.mockResolvedValue(guarded);
    waiveDeposit.mockResolvedValue({
      ok: true,
      disposition: 'waived',
      deposit: { id: 'dep_1', status: 'waived' },
    });
    serializeDepositForRole.mockReturnValue({ id: 'dep_1', status: 'waived' });
  });

  it('refuses the dev-role bypass before reading the body or deposit', async () => {
    assertNoDevRoleBypass.mockResolvedValue(Response.json({}, { status: 403 }));
    const response = await POST(request({ reason: 'approved' }), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(response.status).toBe(403);
    expect(requireDepositMoneyActor).not.toHaveBeenCalled();
    expect(waiveDeposit).not.toHaveBeenCalled();
  });

  it.each([
    [{ reason: '   ' }],
    [{ reason: 'valid', extra: true }],
    [{ reason: 'x'.repeat(501) }],
  ])('strictly rejects an invalid reason body %#', async (body) => {
    const response = await POST(request(body), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(response.status).toBe(400);
    expect(waiveDeposit).not.toHaveBeenCalled();
  });

  it('trims the reason and serializes the resulting deposit', async () => {
    const response = await POST(request({ reason: '  courtesy waiver  ' }), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(response.status).toBe(200);
    expect(waiveDeposit).toHaveBeenCalledWith({
      depositId: 'dep_1',
      salonId: 'salon_1',
      actor,
      reason: 'courtesy waiver',
    });
    expect(serializeDepositForRole).toHaveBeenCalledWith(
      'admin',
      expect.objectContaining({ status: 'waived' }),
    );
  });
});
