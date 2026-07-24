/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  requireClientApiSession,
  requireClientSalonFromBody,
  guardModuleOr403,
  resolveSalonClientIdentityByPhone,
  updateSet,
  updateWhere,
  transaction,
  db,
} = vi.hoisted(() => {
  const updateWhere = vi.fn(async (_condition: unknown) => []);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const transaction = vi.fn(async (callback: (tx: { update: typeof update }) => unknown) => (
    callback({ update })
  ));

  return {
    requireClientApiSession: vi.fn(),
    requireClientSalonFromBody: vi.fn(),
    guardModuleOr403: vi.fn(),
    resolveSalonClientIdentityByPhone: vi.fn(),
    updateSet,
    updateWhere,
    transaction,
    db: {
      select: vi.fn(),
      transaction,
    },
  };
});

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromBody,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403,
}));

vi.mock('@/libs/queries', () => ({
  resolveSalonClientIdentityByPhone,
}));

import { POST } from './route';

function makeLimitSelect(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => result),
      })),
    })),
  };
}

function containsValue(
  value: unknown,
  expected: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (value === expected) {
    return true;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  seen.add(value);
  return Object.values(value).some(child => containsValue(child, expected, seen));
}

describe('POST /api/rewards/redeem-points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardModuleOr403.mockResolvedValue(null);
    resolveSalonClientIdentityByPhone.mockResolvedValue(null);
  });

  it('rejects points redemption when the appointment already has a first-visit discount', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '4165551234',
      session: {
        phone: '+14165551234',
      },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
      },
    });

    resolveSalonClientIdentityByPhone.mockResolvedValue({
      client: {
        id: 'client_1',
        phone: '4165551234',
        loyaltyPoints: 5000,
      },
      clientIds: ['client_1'],
      phoneVariants: ['4165551234', '+14165551234'],
      resolvedFromClientId: null,
    });
    db.select.mockReturnValueOnce(makeLimitSelect([{
      id: 'appt_1',
      salonId: 'salon_1',
      clientPhone: '+14165551234',
      status: 'pending',
      totalPrice: 5000,
      discountType: 'first_visit_25',
    }]));

    const response = await POST(new Request('http://localhost/api/rewards/redeem-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rewardTitle: 'Free Service',
        rewardPoints: 2500,
        appointmentId: 'appt_1',
        salonSlug: 'salon-a',
      }),
    }));

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('FIRST_VISIT_DISCOUNT_ALREADY_APPLIED');
  });

  it('spends the exact current-phone balance even with historical resolver provenance', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '4165551234',
      session: {
        phone: '+14165551234',
      },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        rewardsEnabled: true,
      },
    });
    resolveSalonClientIdentityByPhone.mockResolvedValue({
      client: {
        id: 'client_primary',
        phone: '4165551234',
        loyaltyPoints: 5000,
      },
      clientIds: ['client_primary', 'client_source'],
      normalizedPhones: ['4165551234'],
      phoneVariants: ['4165551234', '+14165551234'],
      resolvedFromClientId: 'client_source',
    });
    db.select.mockReturnValueOnce(makeLimitSelect([{
      id: 'appt_primary',
      salonId: 'salon_1',
      salonClientId: 'client_primary',
      clientPhone: '+14165551234',
      status: 'pending',
      totalPrice: 5000,
      discountType: null,
      notes: null,
    }]));

    const response = await POST(new Request('http://localhost/api/rewards/redeem-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rewardTitle: '$5 off',
        rewardPoints: 2500,
        appointmentId: 'appt_primary',
        salonSlug: 'salon-a',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      appointmentId: 'appt_primary',
      pointsSpent: 2500,
      newPointsBalance: 2500,
    });
    expect(resolveSalonClientIdentityByPhone).toHaveBeenCalledWith(
      'salon_1',
      '4165551234',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledTimes(2);
    expect(updateWhere).toHaveBeenCalledTimes(2);
    expect(containsValue(updateWhere.mock.calls[1]![0], 'client_primary')).toBe(true);
    expect(containsValue(updateWhere.mock.calls[1]![0], 'client_source')).toBe(false);
  });

  it('does not spend a primary balance through a historical merged phone', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '4165551234',
      session: {
        phone: '+14165551234',
      },
    });
    requireClientSalonFromBody.mockResolvedValue({
      ok: true,
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
        rewardsEnabled: true,
      },
    });
    resolveSalonClientIdentityByPhone.mockResolvedValue({
      client: {
        id: 'client_primary',
        phone: '6475550199',
        loyaltyPoints: 5000,
      },
      clientIds: ['client_primary', 'client_source'],
      normalizedPhones: ['4165551234', '6475550199'],
      phoneVariants: ['4165551234', '6475550199'],
      resolvedFromClientId: 'client_source',
    });

    const response = await POST(new Request('http://localhost/api/rewards/redeem-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rewardTitle: '$5 off',
        rewardPoints: 2500,
        appointmentId: 'appt_primary',
        salonSlug: 'salon-a',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CLIENT_IDENTITY_RECONCILIATION_REQUIRED' },
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
