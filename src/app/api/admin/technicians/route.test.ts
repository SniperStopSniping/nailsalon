import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminSalon, db, selectQueue } = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const offset = vi.fn(async () => selectQueue.shift() ?? []);
  const limit = vi.fn(() => ({ offset }));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({
    orderBy,
    then: (resolve: (value: unknown) => void) => resolve(selectQueue.shift() ?? []),
  }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    requireAdminSalon: vi.fn(),
    selectQueue,
    db: {
      select,
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/planLimits', () => ({
  canAddTechnician: vi.fn(),
}));

import { GET } from './route';

describe('GET /api/admin/technicians', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it('rejects wrong-tenant admins', async () => {
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/technicians?salonSlug=salon-a'),
    );

    expect(response.status).toBe(403);
  });

  it('allows authorized admins to list technicians', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    selectQueue.push([{ count: 0 }], []);

    const response = await GET(
      new Request('http://localhost/api/admin/technicians?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        technicians: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      },
    });
  });
});
