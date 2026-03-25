import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireActiveAdminSalon, db, setSelectResults } = vi.hoisted(() => {
  let selectResults: unknown[][] = [];

  const setSelectResults = (nextResults: unknown[][]) => {
    selectResults = [...nextResults];
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectResults.shift() ?? []),
          orderBy: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
    })),
  };

  return {
    requireActiveAdminSalon: vi.fn(),
    db,
    setSelectResults,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireActiveAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET } from './route';

describe('GET /api/staff/time-off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSelectResults([]);
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
      new Request('http://localhost/api/staff/time-off?technicianId=tech_1'),
    );

    expect(response.status).toBe(401);
  });

  it('lists time-off only for technicians inside the active salon', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active' },
      admin: { id: 'admin_1', name: 'Admin' },
    });
    setSelectResults([
      [{ id: 'tech_1', salonId: 'salon_active' }],
      [{
        id: 'timeoff_1',
        startDate: new Date('2026-03-20T00:00:00.000Z'),
        endDate: new Date('2026-03-21T00:00:00.000Z'),
        reason: 'VACATION',
        notes: 'Out of town',
        createdAt: new Date('2026-03-14T09:00:00.000Z'),
      }],
    ]);

    const response = await GET(
      new Request('http://localhost/api/staff/time-off?technicianId=tech_1'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.timeOff).toEqual([{
      id: 'timeoff_1',
      startDate: '2026-03-20T00:00:00.000Z',
      endDate: '2026-03-21T00:00:00.000Z',
      reason: 'VACATION',
      notes: 'Out of town',
      createdAt: '2026-03-14T09:00:00.000Z',
    }]);
  });
});
