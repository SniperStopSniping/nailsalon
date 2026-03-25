import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminSalon, db } = vi.hoisted(() => {
  const offset = vi.fn(async () => []);
  const limit = vi.fn(() => ({ offset }));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({
    orderBy,
    then: (resolve: (value: unknown) => void) => resolve([]),
  }));
  const leftJoin = vi.fn(() => ({ leftJoin, where }));
  const from = vi.fn(() => ({ leftJoin, where }));
  const select = vi.fn(() => ({ from }));

  return {
    requireAdminSalon: vi.fn(),
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

import { GET } from './route';

describe('GET /api/admin/reviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated admins', async () => {
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/reviews?salonSlug=salon-a'),
    );

    expect(response.status).toBe(401);
  });

  it('allows authorized admins to list salon reviews', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/reviews?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        reviews: [],
        stats: {
          totalReviews: 0,
          averageRating: 0,
          ratingDistribution: {
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0,
          },
        },
      },
      meta: {
        timestamp: expect.any(String),
        limit: 50,
        offset: 0,
        total: 0,
      },
    });
  });
});
