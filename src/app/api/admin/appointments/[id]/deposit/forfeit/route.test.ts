import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
  transaction,
  forfeitCancelledAppointmentDepositForOwnerInTx,
} = vi.hoisted(() => ({
  assertNoDevRoleBypass: vi.fn(),
  requireDepositMoneyActor: vi.fn(),
  transaction: vi.fn(),
  forfeitCancelledAppointmentDepositForOwnerInTx: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: { transaction } }));
vi.mock('@/libs/deposits/depositMoneyGuard', () => ({
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
}));
vi.mock('@/libs/deposits/depositForfeiture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/deposits/depositForfeiture')>();
  return {
    ...actual,
    forfeitCancelledAppointmentDepositForOwnerInTx,
  };
});

/* eslint-disable import/first */
import { POST } from './route';
/* eslint-enable import/first */

const guarded = {
  ok: true,
  admin: { isSuperAdmin: false },
  salon: { id: 'salon_1' },
  appointment: { id: 'appt_1', status: 'cancelled', invoiceCurrency: 'CAD' },
  deposit: { id: 'dep_1' },
  actor: {
    performedBy: 'admin_1',
    performedByName: 'Owner One',
  },
};

function request(body: unknown) {
  return new Request('http://localhost/deposit/forfeit?salonSlug=salon-a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/appointments/[id]/deposit/forfeit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertNoDevRoleBypass.mockResolvedValue(null);
    requireDepositMoneyActor.mockResolvedValue(guarded);
    transaction.mockImplementation(async (callback: (tx: object) => unknown) => callback({}));
    forfeitCancelledAppointmentDepositForOwnerInTx.mockResolvedValue({
      disposition: 'forfeited',
      depositIds: ['dep_1'],
      forfeitedCents: 2500,
    });
  });

  it('refuses the dev-role bypass before reading deposit money', async () => {
    assertNoDevRoleBypass.mockResolvedValue(Response.json({}, { status: 403 }));
    const response = await POST(request({ reason: 'Retained under policy' }), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(response.status).toBe(403);
    expect(requireDepositMoneyActor).not.toHaveBeenCalled();
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
    expect(transaction).not.toHaveBeenCalled();
  });

  it('records the explicit owner choice with the frozen appointment currency', async () => {
    const response = await POST(request({ reason: '  Retained under cancellation policy  ' }), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(response.status).toBe(200);
    expect(forfeitCancelledAppointmentDepositForOwnerInTx).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      appointmentId: 'appt_1',
      invoiceCurrency: 'CAD',
      appointmentLockHeld: true,
      ownerAction: {
        performedBy: 'admin_1',
        performedByName: 'Owner One',
        reason: 'Retained under cancellation policy',
      },
    }));
    await expect(response.json()).resolves.toMatchObject({
      disposition: 'forfeited',
      forfeitedCents: 2500,
    });
  });
});
