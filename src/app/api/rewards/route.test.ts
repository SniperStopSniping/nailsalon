/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireClientApiSession,
  requireClientSalonFromQuery,
  guardModuleOr403,
  resolveSalonClientIdentityByPhone,
  db,
} = vi.hoisted(() => ({
  requireClientApiSession: vi.fn(),
  requireClientSalonFromQuery: vi.fn(),
  guardModuleOr403: vi.fn(),
  resolveSalonClientIdentityByPhone: vi.fn(),
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession,
  requireClientSalonFromQuery,
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

import { GET } from './route';

function makeOrderBySelect(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(async () => result),
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

describe('GET /api/rewards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardModuleOr403.mockResolvedValue(null);
    resolveSalonClientIdentityByPhone.mockResolvedValue(null);
  });

  it('requires reconciliation instead of treating a merged phone alias as login authority', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '4165551234',
      session: {
        phone: '+14165551234',
      },
    });
    requireClientSalonFromQuery.mockResolvedValue({
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
        loyaltyPoints: 25000,
        totalVisits: 2,
      },
      clientIds: ['client_primary', 'client_source'],
      normalizedPhones: ['4165551234', '6475550199'],
      phoneVariants: [
        '4165551234',
        '+14165551234',
        '6475550199',
        '+16475550199',
      ],
      resolvedFromClientId: 'client_source',
    });

    const response = await GET(new Request('http://localhost/api/rewards?salonSlug=salon-a'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CLIENT_IDENTITY_RECONCILIATION_REQUIRED');
    expect(resolveSalonClientIdentityByPhone).toHaveBeenCalledWith(
      'salon_1',
      '4165551234',
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  it('uses the exact current-phone balance even when resolver provenance is historical', async () => {
    requireClientApiSession.mockResolvedValue({
      ok: true,
      normalizedPhone: '4165551234',
      session: {
        phone: '+14165551234',
      },
    });
    requireClientSalonFromQuery.mockResolvedValue({
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
        loyaltyPoints: 25000,
        totalVisits: 2,
      },
      clientIds: ['client_primary', 'client_source'],
      normalizedPhones: ['4165551234'],
      phoneVariants: ['4165551234', '+14165551234'],
      resolvedFromClientId: 'client_source',
    });
    db.select
      .mockReturnValueOnce(makeWhereSelect([{
        pendingTotalCents: 6500,
        pendingAppointments: 1,
      }]))
      .mockReturnValueOnce(makeOrderBySelect([]));

    const response = await GET(new Request('http://localhost/api/rewards?salonSlug=salon-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.activePoints).toBe(25000);
    expect(body.meta.pendingPoints).toBe(1300);
    expect(body.meta.pendingAppointments).toBe(1);
  });
});
