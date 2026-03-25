import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireActiveAdminSalon, db, setSelectPlans } = vi.hoisted(() => {
  type Plan =
    | { type: 'signals'; result: unknown[] }
    | { type: 'count'; result: unknown[] };

  let plans: Plan[] = [];

  const setSelectPlans = (nextPlans: Plan[]) => {
    plans = [...nextPlans];
  };

  const db = {
    select: vi.fn(() => {
      const plan = plans.shift() ?? { type: 'count', result: [] };

      if (plan.type === 'signals') {
        return {
          from: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    offset: vi.fn(async () => plan.result),
                  })),
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
    requireActiveAdminSalon: vi.fn(),
    db,
    setSelectPlans,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireActiveAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET } from './route';

describe('GET /api/admin/fraud-signals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSelectPlans([]);
  });

  it('rejects unauthorized admins', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
      admin: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/fraud-signals?page=1&limit=10'),
    );

    expect(response.status).toBe(401);
  });

  it('lists fraud signals for the active salon selection', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1' },
    });
    setSelectPlans([
      {
        type: 'signals',
        result: [{
          id: 'signal_1',
          type: 'duplicate_booking',
          severity: 'high',
          reason: 'Same-day duplicate',
          metadata: { source: 'system' },
          createdAt: new Date('2026-03-14T10:00:00.000Z'),
          resolvedAt: null,
          resolvedBy: null,
          resolutionNote: null,
          appointmentId: 'appt_1',
          clientName: 'Ava',
          clientPhone: '+15551234567',
        }],
      },
      { type: 'count', result: [{ count: 1 }] },
      { type: 'count', result: [{ count: 1 }] },
    ]);

    const response = await GET(
      new Request('http://localhost/api/admin/fraud-signals?page=1&limit=10'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.unresolvedCount).toBe(1);
    expect(body.data.total).toBe(1);
    expect(body.data.signals).toEqual([{
      id: 'signal_1',
      type: 'duplicate_booking',
      severity: 'high',
      reason: 'Same-day duplicate',
      metadata: { source: 'system' },
      createdAt: '2026-03-14T10:00:00.000Z',
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      appointmentId: 'appt_1',
      client: {
        name: 'Ava',
        phone: '+15551234567',
      },
    }]);
  });
});
