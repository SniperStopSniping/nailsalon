import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAdminImpersonationForAdmin, getAdminSession } = vi.hoisted(() => ({
  getAdminImpersonationForAdmin: vi.fn(),
  getAdminSession: vi.fn(),
}));
const { getSalonById } = vi.hoisted(() => ({
  getSalonById: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({
  getAdminImpersonationForAdmin,
  getAdminSession,
}));

vi.mock('@/libs/queries', () => ({
  getSalonById,
}));

import { GET } from './route';

describe('GET /api/admin/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSalonById.mockResolvedValue(null);
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
    }]);
  });

  it('rejects a salon query outside the locked impersonation scope', async () => {
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

    expect(response.status).toBe(403);
    expect(body.error).toBe('Impersonation is locked to a different salon');
  });
});
