import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSuperAdmin, db, setSelectPlans } = vi.hoisted(() => {
  type Plan =
    | { type: 'count'; result: unknown[] }
    | { type: 'salons'; result: unknown[] };

  let plans: Plan[] = [];

  const setSelectPlans = (nextPlans: Plan[]) => {
    plans = [...nextPlans];
  };

  const db = {
    select: vi.fn(() => {
      const plan = plans.shift() ?? { type: 'count', result: [{ count: 0 }] };

      if (plan.type === 'salons') {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn(() => ({
                limit: vi.fn(() => ({
                  offset: vi.fn(async () => plan.result),
                })),
              })),
            })),
          })),
        };
      }

      return {
        from: vi.fn(() => ({
          where: vi.fn(async () => plan.result),
        })),
      };
    }),
  };

  return {
    requireSuperAdmin: vi.fn(),
    db,
    setSelectPlans,
  };
});

vi.mock('@/libs/superAdmin', () => ({
  requireSuperAdmin,
  getSuperAdminInfo: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET } from './route';

describe('GET /api/super-admin/organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSelectPlans([]);
    requireSuperAdmin.mockResolvedValue(null);
  });

  it('tolerates blank plan/status filters from the dashboard and returns the salon list', async () => {
    setSelectPlans([
      { type: 'count', result: [{ count: 0 }] },
      { type: 'salons', result: [] },
    ]);

    const response = await GET(
      new Request('http://localhost/api/super-admin/organizations?plan=&status=&page=1&pageSize=20'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
  });
});
