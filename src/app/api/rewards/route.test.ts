import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireClientApiSession,
  requireClientSalonFromQuery,
  guardModuleOr403,
  db,
} = vi.hoisted(() => ({
  requireClientApiSession: vi.fn(),
  requireClientSalonFromQuery: vi.fn(),
  guardModuleOr403: vi.fn(),
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

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET } from './route';

function makeLimitSelect(result: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => result),
      })),
    })),
  };
}

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
  });

  it('returns active and pending points separately', async () => {
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

    db.select
      .mockReturnValueOnce(makeLimitSelect([{ loyaltyPoints: 25000, totalVisits: 2 }]))
      .mockReturnValueOnce(makeWhereSelect([{ pendingTotalCents: 6500, pendingAppointments: 1 }]))
      .mockReturnValueOnce(makeOrderBySelect([]));

    const response = await GET(new Request('http://localhost/api/rewards?salonSlug=salon-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.meta.activePoints).toBe(25000);
    expect(body.meta.pendingPoints).toBe(1300);
    expect(body.meta.pendingAppointments).toBe(1);
  });
});
