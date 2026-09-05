import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminSalonFromRequest, db, limit } = vi.hoisted(() => {
  const limit = vi.fn(async (): Promise<unknown[]> => []);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ innerJoin, where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    requireAdminSalonFromRequest: vi.fn(),
    db: { select },
    limit,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalonFromRequest,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

/* eslint-disable import/first */
import { GET } from './route';
/* eslint-enable import/first */

describe('GET /api/admin/time-off-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthorized admins', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
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
    requireAdminSalonFromRequest.mockResolvedValue({
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

  // AG-security-tenancy-03: the URL's salon must reach the guard so a link
  // naming salon A cannot be answered from the active-salon cookie's salon.
  it('scopes the listing to the salon the URL names', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_requested', name: 'Requested Salon' },
      admin: { id: 'admin_1' },
    });

    const request = new Request(
      'http://localhost/api/admin/time-off-requests?salonSlug=requested-salon',
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(requireAdminSalonFromRequest).toHaveBeenCalledWith(request);
  });

  it('lists a pending request with its whole-day dates', async () => {
    // Shape of the audit fixture tor_audit_1 (Tiffany, 2026-09-17 -> 2026-09-18).
    // start/end arrive from the DATE mapper as 'YYYY-MM-DD' strings; calling
    // toISOString() on them used to throw RangeError and 500 the whole inbox.
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_b', name: 'Nail Salon No.5' },
      admin: { id: 'admin_1' },
    });
    limit.mockResolvedValueOnce([
      {
        id: 'tor_audit_1',
        salonId: 'salon_b',
        salonName: 'Nail Salon No.5',
        technicianId: 'tech_tiffany',
        technicianName: 'Tiffany',
        startDate: '2026-09-17',
        endDate: '2026-09-18',
        note: 'AUDIT-0905 family trip',
        status: 'PENDING',
        decidedAt: null,
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    ]);

    const response = await GET(
      new Request('http://localhost/api/admin/time-off-requests?status=PENDING'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.requests).toEqual([
      {
        id: 'tor_audit_1',
        salonId: 'salon_b',
        salonName: 'Nail Salon No.5',
        technicianId: 'tech_tiffany',
        technicianName: 'Tiffany',
        startDate: '2026-09-17',
        endDate: '2026-09-18',
        note: 'AUDIT-0905 family trip',
        status: 'PENDING',
        decidedAt: null,
        createdAt: '2026-09-01T12:00:00.000Z',
      },
    ]);
  });

  it('skips a row with an unreadable date instead of failing the list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_b', name: 'Nail Salon No.5' },
      admin: { id: 'admin_1' },
    });
    limit.mockResolvedValueOnce([
      {
        id: 'tor_broken',
        salonId: 'salon_b',
        salonName: 'Nail Salon No.5',
        technicianId: 'tech_tiffany',
        technicianName: 'Tiffany',
        startDate: new Date('nonsense'),
        endDate: '2026-09-18',
        note: null,
        status: 'PENDING',
        decidedAt: null,
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
      {
        id: 'tor_audit_1',
        salonId: 'salon_b',
        salonName: 'Nail Salon No.5',
        technicianId: 'tech_tiffany',
        technicianName: 'Tiffany',
        startDate: '2026-09-17',
        endDate: '2026-09-18',
        note: null,
        status: 'PENDING',
        decidedAt: null,
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    ]);

    const response = await GET(
      new Request('http://localhost/api/admin/time-off-requests'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.requests.map((r: { id: string }) => r.id)).toEqual(['tor_audit_1']);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
