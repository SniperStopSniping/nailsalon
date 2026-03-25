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
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => []),
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

import { DELETE, GET } from './route';

describe('/api/staff/time-off/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSelectResults([]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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
      new Request('http://localhost/api/staff/time-off/timeoff_1'),
      { params: Promise.resolve({ id: 'timeoff_1' }) },
    );

    expect(response.status).toBe(401);
  });

  it('returns not found when the time-off entry is outside the active salon', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active' },
      admin: { id: 'admin_1', name: 'Admin' },
    });
    setSelectResults([[]]);

    const response = await GET(
      new Request('http://localhost/api/staff/time-off/timeoff_1'),
      { params: Promise.resolve({ id: 'timeoff_1' }) },
    );

    expect(response.status).toBe(404);
  });

  it('deletes a time-off entry scoped to the active salon', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active' },
      admin: { id: 'admin_1', name: 'Admin' },
    });
    setSelectResults([[{ id: 'timeoff_1', salonId: 'salon_active', technicianId: 'tech_1' }]]);

    const response = await DELETE(
      new Request('http://localhost/api/staff/time-off/timeoff_1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'timeoff_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        deleted: true,
        id: 'timeoff_1',
      },
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
