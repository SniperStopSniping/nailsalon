import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { requireAdminSalonFromRequest, db, getBookingConfigForSalon, getTechniciansBySalonId } = vi.hoisted(() => {
  const limit = vi.fn(async () => []);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const leftJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ leftJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    requireAdminSalonFromRequest: vi.fn(),
    getBookingConfigForSalon: vi.fn(async () => ({ slotIntervalMinutes: 15 })),
    getTechniciansBySalonId: vi.fn(async () => []),
    db: { select },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalonFromRequest,
}));

vi.mock('@/libs/bookingConfig', () => ({
  getBookingConfigForSalon,
}));

vi.mock('@/libs/queries', () => ({
  getTechniciansBySalonId,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

describe('GET /api/admin/appointments', () => {
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
      new Request('http://localhost/api/admin/appointments?date=2026-03-14'),
    );

    expect(response.status).toBe(401);
  });

  it('lists appointments for the active salon only', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1' },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/appointments?date=2026-03-14'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        appointments: [],
        technicians: [],
      },
      meta: {
        slotIntervalMinutes: 15,
      },
    });
  });

  // AG-security-tenancy-03: `?salon=`/`?salonSlug=` must reach the guard, so a
  // deep link naming one salon is never answered from another one's cookie.
  it('scopes the listing to the salon the URL names', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_requested', name: 'Requested Salon' },
      admin: { id: 'admin_1' },
    });

    const request = new Request(
      'http://localhost/api/admin/appointments?date=2026-03-14&salon=requested-salon',
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(requireAdminSalonFromRequest).toHaveBeenCalledWith(request);
    expect(getBookingConfigForSalon).toHaveBeenCalledWith('salon_requested');
  });
});
