import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireStaffOrAdminSalonAccess, db, selectQueue } = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const limit = vi.fn(async () => selectQueue.shift() ?? []);
  const orderBy = vi.fn(async () => selectQueue.shift() ?? []);
  const where = vi.fn(() => ({ limit, orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    requireStaffOrAdminSalonAccess: vi.fn(),
    selectQueue,
    db: {
      select,
    },
  };
});

vi.mock('@/libs/routeAccessGuards', () => ({
  requireStaffOrAdminSalonAccess,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/visibilityPolicy', () => ({
  getEffectiveVisibility: vi.fn(() => 'full_access'),
}));

vi.mock('@/libs/redact', () => ({
  isFullAccess: vi.fn(() => true),
  redactClientForStaff: vi.fn((client) => client),
}));

import { GET } from './route';

describe('GET /api/staff/client/[phone]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
  });

  it('rejects unauthenticated access', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: { phone: '5551234567' } },
    );

    expect(response.status).toBe(401);
  });

  it('rejects wrong-tenant access', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: { phone: '5551234567' } },
    );

    expect(response.status).toBe(403);
  });

  it('allows authorized staff to view scoped client data', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
      },
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
    });
    selectQueue.push(
      [{ visibility: null }],
      [{ firstName: 'Ava', createdAt: new Date('2026-01-01T00:00:00Z') }],
      [],
      [],
      [],
    );

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: { phone: '5551234567' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        client: {
          phone: '5551234567',
          name: 'Ava',
          memberSince: '2026-01-01T00:00:00.000Z',
        },
        stats: {
          totalVisits: 0,
          totalSpent: 0,
          lastVisit: null,
        },
        preferences: null,
        appointments: [],
        photos: [],
      },
    });
  });
});
