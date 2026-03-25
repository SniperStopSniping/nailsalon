import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdmin, getResolvedSalon } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getResolvedSalon: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin,
}));

vi.mock('@/libs/tenant', () => ({
  getResolvedSalon,
  getSalonFromSlugOrCookie: vi.fn(),
}));

import { GET } from './route';

describe('GET /api/salon/page-appearance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires an authenticated admin for the resolved salon', async () => {
    getResolvedSalon.mockResolvedValue({
      id: 'salon_1',
      slug: 'salon-a',
    });
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(new Request('http://localhost/api/salon/page-appearance?salonSlug=salon-a') as never);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
    expect(requireAdmin).toHaveBeenCalledWith('salon_1');
  });
});
