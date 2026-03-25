import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireActiveAdminSalon, db } = vi.hoisted(() => {
  const limit = vi.fn(async () => []);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ innerJoin, where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    requireActiveAdminSalon: vi.fn(),
    db: { select },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireActiveAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET } from './route';

describe('GET /api/admin/time-off-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      new Request('http://localhost/api/admin/time-off-requests?status=PENDING'),
    );

    expect(response.status).toBe(401);
  });

  it('lists requests for the active salon selection', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1' },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/time-off-requests?status=PENDING'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ data: { requests: [] } });
  });
});
