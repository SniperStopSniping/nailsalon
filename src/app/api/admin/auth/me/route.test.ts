import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { getAdminImpersonationForAdmin, getAdminSession, requireActiveAdminSalon } = vi.hoisted(() => ({
  getAdminImpersonationForAdmin: vi.fn(),
  getAdminSession: vi.fn(),
  requireActiveAdminSalon: vi.fn(),
}));
const { getSalonById, getSalonBySlug } = vi.hoisted(() => ({
  getSalonById: vi.fn(),
  getSalonBySlug: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({
  getAdminImpersonationForAdmin,
  getAdminSession,
  requireActiveAdminSalon,
}));

vi.mock('@/libs/queries', () => ({
  getSalonById,
  getSalonBySlug,
}));

describe('GET /api/admin/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSalonById.mockResolvedValue(null);
    getSalonBySlug.mockResolvedValue(null);
    requireActiveAdminSalon.mockResolvedValue({ salon: null });
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      phoneE164: '+15551234567',
      name: 'Sam Super',
      email: 'sam@example.com',
      isSuperAdmin: true,
      salons: [{
        salonId: 'salon_member',
        salonSlug: 'member-salon',
        salonName: 'Member Salon',
        role: 'owner',
      }],
    });
  });

  it('returns impersonation details and locks the salons list to the impersonated salon', async () => {
    getAdminImpersonationForAdmin.mockResolvedValue({
      salonId: 'salon_locked',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    });

    const response = await GET(new Request('http://localhost/api/admin/auth/me'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.impersonation).toEqual({
      isActive: true,
      salonId: 'salon_locked',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      startedAt: '2026-03-14T15:00:00.000Z',
    });
    expect(body.user.salons).toEqual([{
      id: 'salon_locked',
      slug: 'locked-salon',
      name: 'Locked Salon',
      status: null,
      role: 'impersonation',
      freeSoloEnabled: false,
      publicUrl: 'http://localhost:3000/en/locked-salon',
      bookingUrl: 'http://localhost:3000/en/locked-salon/book/service',
    }]);
  });

  it('recovers a stale salon query while keeping the response locked to the impersonated salon', async () => {
    getAdminImpersonationForAdmin.mockResolvedValue({
      salonId: 'salon_locked',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    });

    const response = await GET(
      new Request('http://localhost/api/admin/auth/me?salonSlug=other-salon'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.salons).toEqual([
      expect.objectContaining({
        id: 'salon_locked',
        slug: 'locked-salon',
        role: 'impersonation',
      }),
    ]);
    expect(body.user.impersonation.salonSlug).toBe('locked-salon');
  });

  it('returns the exact requested salon for a super-admin without a membership', async () => {
    getAdminImpersonationForAdmin.mockResolvedValue(null);
    getSalonBySlug.mockResolvedValue({
      id: 'salon_hello',
      slug: 'hello',
      name: 'Hello Nail Studio',
      status: 'active',
      freeSoloEnabled: true,
      customDomain: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/auth/me?salonSlug=hello'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.salons).toEqual([expect.objectContaining({
      id: 'salon_hello',
      slug: 'hello',
      name: 'Hello Nail Studio',
      role: 'super_admin',
      freeSoloEnabled: true,
    })]);
    expect(body.user.availableSalons).toHaveLength(1);
  });

  it('returns the recovered active salon for a super-admin without memberships', async () => {
    getAdminImpersonationForAdmin.mockResolvedValue(null);
    getAdminSession.mockResolvedValue({
      id: 'admin_1',
      phoneE164: '+15551234567',
      name: 'Sam Super',
      email: 'sam@example.com',
      isSuperAdmin: true,
      salons: [],
    });
    requireActiveAdminSalon.mockResolvedValue({
      salon: {
        id: 'salon_renamed',
        slug: 'renamed-salon',
        name: 'Renamed Salon',
        status: 'active',
        freeSoloEnabled: false,
        customDomain: null,
      },
    });

    const response = await GET(new Request('http://localhost/api/admin/auth/me'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.salons).toEqual([
      expect.objectContaining({
        id: 'salon_renamed',
        slug: 'renamed-salon',
        role: 'super_admin',
      }),
    ]);
    expect(body.user.availableSalons).toEqual(body.user.salons);
  });
});
