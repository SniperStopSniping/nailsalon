import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertNoDevRoleBypass,
  db,
  filterDepositAuditMetadata,
  queryQueue,
  requireDepositReadActor,
  serializeDepositForRole,
} = vi.hoisted(() => {
  const queryQueue: unknown[] = [];
  const query = (result: unknown) => {
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => result),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };
  return {
    assertNoDevRoleBypass: vi.fn(),
    db: { select: vi.fn(() => query(queryQueue.shift() ?? [])) },
    filterDepositAuditMetadata: vi.fn(),
    queryQueue,
    requireDepositReadActor: vi.fn(),
    serializeDepositForRole: vi.fn(),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/deposits/depositMoneyGuard', () => ({
  assertNoDevRoleBypass,
  requireDepositReadActor,
}));
vi.mock('@/libs/deposits/depositLifecycle', () => ({
  filterDepositAuditMetadata,
  serializeDepositForRole,
}));

/* eslint-disable import/first */
import { dynamic, GET } from './route';
/* eslint-enable import/first */

const guarded = {
  ok: true,
  admin: { isSuperAdmin: false },
  salon: { id: 'salon_1' },
  appointment: { id: 'appt_1' },
};

function request() {
  return new Request(
    'http://localhost/api/admin/appointments/appt_1/deposit?salonSlug=salon-a',
  );
}

describe('GET /api/admin/appointments/[id]/deposit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    assertNoDevRoleBypass.mockResolvedValue(null);
    requireDepositReadActor.mockResolvedValue(guarded);
    serializeDepositForRole.mockImplementation((_role, deposit) => ({
      id: deposit.id,
      status: deposit.status,
    }));
    filterDepositAuditMetadata.mockImplementation(value => value && {
      depositId: value.depositId,
      refundId: value.refundId,
    });
  });

  it('is private, force-dynamic, and refuses a dev-role before database access', async () => {
    expect(dynamic).toBe('force-dynamic');

    assertNoDevRoleBypass.mockResolvedValue(Response.json({}, { status: 403 }));

    const response = await GET(request(), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(requireDepositReadActor).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('loads the tenant-scoped panel and returns only filtered deposit audits', async () => {
    queryQueue.push(
      [{ id: 'dep_1', status: 'paid', refundLastErrorCode: 'UNKNOWN_PROVIDER_ERROR' }],
      [
        {
          id: 'audit_2',
          action: 'deposit_refund_failed',
          performedByRole: 'system',
          performedByName: null,
          reason: 'webhook',
          createdAt: new Date('2026-08-14T12:00:00.000Z'),
          newValue: {
            depositId: 'dep_1',
            refundId: 're_1',
            rawProviderMessage: 'must never escape',
          },
        },
      ],
      [{ total: 52 }],
    );

    const response = await GET(request(), {
      params: Promise.resolve({ id: 'appt_1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(requireDepositReadActor).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      salonSlug: 'salon-a',
      rateLimitKey: 'admin-deposit-panel',
    }));
    expect(serializeDepositForRole).toHaveBeenCalledWith(
      'admin',
      expect.objectContaining({ id: 'dep_1' }),
    );
    expect(body).toEqual({
      deposit: { id: 'dep_1', status: 'paid' },
      auditRows: [{
        id: 'audit_2',
        action: 'deposit_refund_failed',
        performedByRole: 'system',
        performedByName: null,
        reason: 'webhook',
        createdAt: '2026-08-14T12:00:00.000Z',
        newValue: { depositId: 'dep_1', refundId: 're_1' },
      }],
      moreOmitted: 51,
    });
    expect(JSON.stringify(body)).not.toContain('rawProviderMessage');
  });

  it('passes read-guard failures through with private cache headers', async () => {
    requireDepositReadActor.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET(request(), {
      params: Promise.resolve({ id: 'appt_1' }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(db.select).not.toHaveBeenCalled();
  });
});
