/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  requireClientApiSession,
  requireClientSalonFromBody,
  guardModuleOr403,
  resolveSalonClientIdentityByPhone,
  db,
} = vi.hoisted(() => ({
  requireClientApiSession: vi.fn(),
  requireClientSalonFromBody: vi.fn(),
  guardModuleOr403: vi.fn(),
  resolveSalonClientIdentityByPhone: vi.fn(),
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromBody,
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403,
}));

vi.mock('@/libs/queries', () => ({
  resolveSalonClientIdentityByPhone,
}));

vi.mock('@/libs/DB', () => ({
  db,
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

function makeWhereSelect(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(async () => result),
    })),
  };
}

describe('POST /api/rewards/redeem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardModuleOr403.mockResolvedValue(null);
    resolveSalonClientIdentityByPhone.mockResolvedValue(null);
  });

  it('rejects reward redemption when the appointment already has a first-visit discount', async () => {
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

    db.select
      .mockReturnValueOnce(makeLimitSelect([{
        id: 'reward_1',
        salonId: 'salon_1',
        clientPhone: '4165551234',
        status: 'active',
        expiresAt: null,
      }]))
      .mockReturnValueOnce(makeLimitSelect([{
        id: 'appt_1',
        salonId: 'salon_1',
        clientPhone: '+14165551234',
        status: 'pending',
        totalPrice: 5000,
        discountType: 'first_visit_25',
      }]));

    const response = await POST(new Request('http://localhost/api/rewards/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rewardId: 'reward_1',
        appointmentId: 'appt_1',
        salonSlug: 'salon-a',
      }),
    }));

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('FIRST_VISIT_DISCOUNT_ALREADY_APPLIED');
  });

  it('keeps exact-phone ownership and rejects a raced second claim', async () => {
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
        loyaltyPoints: 2500,
        totalVisits: 3,
      },
      clientIds: ['client_primary'],
      normalizedPhones: ['4165551234'],
      phoneVariants: ['4165551234', '+14165551234'],
      resolvedFromClientId: null,
    });

    db.select
      .mockReturnValueOnce(makeLimitSelect([{
        id: 'reward_alias',
        salonId: 'salon_1',
        clientPhone: '4165551234',
        clientName: 'Primary',
        referralId: null,
        type: 'referral_referrer',
        points: 0,
        discountType: 'fixed_amount',
        discountAmountCents: 500,
        discountPercent: null,
        eligibleServiceName: null,
        status: 'active',
        expiresAt: null,
        usedAt: null,
        usedInAppointmentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]))
      .mockReturnValueOnce(makeLimitSelect([{
        id: 'appt_primary',
        salonId: 'salon_1',
        salonClientId: 'client_primary',
        clientPhone: '+14165551234',
        status: 'pending',
        totalPrice: 5000,
        discountType: null,
        notes: null,
      }]))
      .mockReturnValueOnce(makeLimitSelect([]))
      .mockReturnValueOnce(makeWhereSelect([]));

    db.transaction.mockImplementation(async callback => callback({
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn(() => makeLimitSelect([])),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => []),
          })),
        })),
      })),
    }));

    const response = await POST(new Request('http://localhost/api/rewards/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rewardId: 'reward_alias',
        appointmentId: 'appt_primary',
        salonSlug: 'salon-a',
      }),
    }));

    expect(resolveSalonClientIdentityByPhone).toHaveBeenCalledWith(
      'salon_1',
      '4165551234',
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'REWARD_ALREADY_APPLIED' },
    });
  });

  it('does not authorize primary rewards through a historical merged phone', async () => {
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
      },
      clientIds: ['client_primary', 'client_source'],
      normalizedPhones: ['4165551234', '6475550199'],
      phoneVariants: ['4165551234', '6475550199'],
      resolvedFromClientId: 'client_source',
    });

    const response = await POST(new Request('http://localhost/api/rewards/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rewardId: 'reward_primary',
        appointmentId: 'appt_primary',
        salonSlug: 'salon-a',
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CLIENT_IDENTITY_RECONCILIATION_REQUIRED' },
    });
    expect(db.select).not.toHaveBeenCalled();
  });
});
