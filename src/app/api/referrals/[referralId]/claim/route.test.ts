import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireClientApiSession,
  resolveSalonLoyaltyPoints,
  upsertClient,
  selectResults,
  updateSet,
  insertValues,
  db,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const updateSet = vi.fn(() => ({
    where: vi.fn(async () => undefined),
  }));
  const insertValues = vi.fn(async () => undefined);

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const result = selectResults.shift() ?? [];
        return {
          limit: vi.fn(async () => result),
        };
      }),
    })),
  }));

  const update = vi.fn(() => ({
    set: updateSet,
  }));

  const insert = vi.fn(() => ({
    values: insertValues,
  }));

  return {
    requireClientApiSession: vi.fn(),
    resolveSalonLoyaltyPoints: vi.fn(),
    upsertClient: vi.fn(),
    selectResults,
    updateSet,
    insertValues,
    db: {
      select,
      update,
      insert,
    },
  };
});

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
}));

vi.mock('@/libs/loyalty', () => ({
  resolveSalonLoyaltyPoints,
}));

vi.mock('@/libs/queries', () => ({
  upsertClient,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { POST } from './route';

describe('POST /api/referrals/[referralId]/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    resolveSalonLoyaltyPoints.mockReturnValue({
      referralReferee: 2500,
      referralReferrer: 3500,
    });
  });

  it('rejects unauthenticated referral claims', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await POST(
      new Request('http://localhost/api/referrals/ref_1/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refereeName: 'Bea' }),
      }),
      { params: Promise.resolve({ referralId: 'ref_1' }) },
    );

    expect(response.status).toBe(401);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('rejects claims when the posted phone does not match the authenticated session', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '2223334444',
      session: { phone: '+12223334444', clientName: null, sessionId: 'client_session_1' },
    });

    const response = await POST(
      new Request('http://localhost/api/referrals/ref_1/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refereeName: 'Bea',
          refereePhone: '9999999999',
        }),
      }),
      { params: Promise.resolve({ referralId: 'ref_1' }) },
    );

    expect(response.status).toBe(400);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('uses the authenticated session phone when claiming a referral', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '2223334444',
      session: { phone: '+12223334444', clientName: null, sessionId: 'client_session_1' },
    });
    selectResults.push(
      [{
        id: 'ref_1',
        salonId: 'salon_1',
        referrerPhone: '1111111111',
        referrerName: 'Ava',
        refereePhone: null,
        status: 'sent',
      }],
      [{
        id: 'salon_1',
        name: 'Salon A',
      }],
      [],
      [],
    );

    const response = await POST(
      new Request('http://localhost/api/referrals/ref_1/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refereeName: 'Bea' }),
      }),
      { params: Promise.resolve({ referralId: 'ref_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      refereePhone: '2223334444',
      refereeName: 'Bea',
      status: 'claimed',
    }));
    expect(upsertClient).toHaveBeenCalledWith('+12223334444', 'Bea');
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      clientPhone: '2223334444',
      clientName: 'Bea',
      referralId: 'ref_1',
      type: 'referral_referee',
    }));
    expect(body.data.referralId).toBe('ref_1');
  });
});
