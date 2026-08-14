import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertNoDevRoleBypass,
  releaseHold,
  requireDepositMoneyActor,
  serializeDepositForRole,
} = vi.hoisted(() => ({
  assertNoDevRoleBypass: vi.fn(),
  releaseHold: vi.fn(),
  requireDepositMoneyActor: vi.fn(),
  serializeDepositForRole: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/deposits/depositMoneyGuard', () => ({
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
}));
vi.mock('@/libs/deposits/depositLifecycle', () => ({
  releaseHold,
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

function request(body: unknown) {
  return new Request('http://localhost/deposit/release?salonSlug=salon-a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/appointments/[id]/deposit/release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertNoDevRoleBypass.mockResolvedValue(null);
    requireDepositMoneyActor.mockResolvedValue(guarded);
    releaseHold.mockResolvedValue({
      ok: true,
      disposition: 'released',
      deposit: { id: 'dep_1', status: 'canceled' },
    });
    serializeDepositForRole.mockReturnValue({ id: 'dep_1', status: 'canceled' });
  });

  it('refuses the dev-role bypass before loading money state', async () => {
    assertNoDevRoleBypass.mockResolvedValue(Response.json({}, { status: 403 }));
    const response = await POST(request({ reason: 'release' }), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(response.status).toBe(403);
    expect(requireDepositMoneyActor).not.toHaveBeenCalled();
  });

  it('strictly rejects absent and extra reason fields', async () => {
    const missing = await POST(request({}), {
      params: Promise.resolve({ id: 'appt_1' }),
    });
    const extra = await POST(request({ reason: 'release', note: 'not allowed' }), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(missing.status).toBe(400);
    expect(extra.status).toBe(400);
    expect(releaseHold).not.toHaveBeenCalled();
  });

  it('trims the reason and invokes the release transition', async () => {
    const response = await POST(request({ reason: '  client cancelled  ' }), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(response.status).toBe(200);
    expect(releaseHold).toHaveBeenCalledWith({
      depositId: 'dep_1',
      salonId: 'salon_1',
      actor,
      reason: 'client cancelled',
    });
    expect(serializeDepositForRole).toHaveBeenCalledWith(
      'admin',
      expect.objectContaining({ status: 'canceled' }),
    );
  });
});
