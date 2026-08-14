import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertNoDevRoleBypass,
  db,
  needsAttentionPredicate,
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
    needsAttentionPredicate: vi.fn(() => ({ predicate: 'needs-attention' })),
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
  needsAttentionPredicate,
  serializeDepositForRole,
}));

/* eslint-disable import/first */
import { dynamic, GET } from './route';
/* eslint-enable import/first */

const guarded = {
  ok: true,
  admin: { isSuperAdmin: false },
  salon: { id: 'salon_1' },
};

function request() {
  return new Request(
    'http://localhost/api/admin/deposits?salonSlug=salon-a&needsAttention=1&depositId=dep_lookup&stripeRefundId=re_lookup&stripePaymentIntentId=pi_lookup',
  );
}

describe('GET /api/admin/deposits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    assertNoDevRoleBypass.mockResolvedValue(null);
    requireDepositReadActor.mockResolvedValue(guarded);
    serializeDepositForRole.mockImplementation((_role, deposit) => ({
      id: deposit.id,
      status: deposit.status,
    }));
  });

  it('is private, force-dynamic, and refuses dev-role bypass before the guard', async () => {
    expect(dynamic).toBe('force-dynamic');

    assertNoDevRoleBypass.mockResolvedValue(Response.json({}, { status: 403 }));

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(requireDepositReadActor).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('caps needs-attention at 100 and returns all three salon-scoped lookups', async () => {
    const attentionRows = Array.from({ length: 100 }, (_, index) => ({
      id: `dep_${index}`,
      status: 'failed',
    }));
    queryQueue.push(
      attentionRows,
      [{ total: 130 }],
      [{ id: 'dep_lookup', status: 'paid' }],
      [{ id: 'dep_refund', status: 'refunded' }],
      [{ id: 'dep_intent', status: 'paid' }],
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(requireDepositReadActor).toHaveBeenCalledWith(expect.objectContaining({
      salonSlug: 'salon-a',
      rateLimitKey: 'admin-deposits-read',
    }));
    expect(needsAttentionPredicate).toHaveBeenCalledWith('salon_1');
    expect(body.needsAttention).toHaveLength(100);
    expect(body.moreOmitted).toBe(30);
    expect(body.lookups).toEqual({
      depositId: { id: 'dep_lookup', status: 'paid' },
      stripeRefundId: { id: 'dep_refund', status: 'refunded' },
      stripePaymentIntentId: { id: 'dep_intent', status: 'paid' },
    });
    expect(body).not.toHaveProperty('page');
    expect(body).not.toHaveProperty('limit');
    expect(body).not.toHaveProperty('status');
  });

  it('does not query rows when the salon-scoped guard refuses access', async () => {
    requireDepositReadActor.mockResolvedValue({
      ok: false,
      response: Response.json({}, { status: 403 }),
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
    expect(needsAttentionPredicate).not.toHaveBeenCalled();
  });
});
