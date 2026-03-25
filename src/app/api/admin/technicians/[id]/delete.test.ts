import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, requireAdminSalon, setSelectPlans } = vi.hoisted(() => {
  type Plan =
    | { type: 'limit'; result: unknown[] }
    | { type: 'where'; result: unknown[] };

  let plans: Plan[] = [];

  const setSelectPlans = (nextPlans: Plan[]) => {
    plans = [...nextPlans];
  };

  const db = {
    select: vi.fn(() => {
      const plan = plans.shift() ?? { type: 'where', result: [] };

      if (plan.type === 'limit') {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => plan.result),
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
    delete: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{
            id: 'tech_1',
            name: 'Taylor',
            isActive: false,
            terminatedAt: new Date('2026-03-15T12:00:00.000Z'),
          }]),
        })),
      })),
    })),
  };

  return {
    db,
    requireAdminSalon: vi.fn(),
    setSelectPlans,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { DELETE } from './route';

describe('DELETE /api/admin/technicians/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSelectPlans([]);
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
  });

  it('blocks permanent deletion when the technician has linked history', async () => {
    setSelectPlans([
      {
        type: 'limit',
        result: [{ id: 'tech_1', salonId: 'salon_1', name: 'Taylor' }],
      },
      { type: 'where', result: [{ count: 2 }] },
      { type: 'where', result: [{ count: 1 }] },
      { type: 'where', result: [{ count: 0 }] },
    ]);

    const response = await DELETE(
      new Request('http://localhost/api/admin/technicians/tech_1?salonSlug=salon-a&hard=true', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toEqual({
      code: 'TECHNICIAN_HAS_HISTORY',
      message: 'This staff member has booking or client history and cannot be permanently removed. Disable them instead.',
      details: {
        appointments: 2,
        reviews: 1,
        favoritePreferences: 0,
      },
    });
  });
});
