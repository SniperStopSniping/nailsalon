import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireClientManagerSalon } from './clientManagementAuth';

const { getAdminSession, requireAdminSalon } = vi.hoisted(() => ({
  getAdminSession: vi.fn(),
  requireAdminSalon: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({
  getAdminSession,
  requireAdminSalon,
}));

vi.mock('server-only', () => ({}));

const salon = {
  id: 'salon_1',
  slug: 'salon-one',
};

describe('requireClientManagerSalon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon,
    });
  });

  it.each([
    ['owner', 'owner'],
    ['admin', 'admin'],
  ] as const)('allows an authenticated %s for the authorized salon', async (role, expectedRole) => {
    getAdminSession.mockResolvedValue({
      id: `admin_${role}`,
      isSuperAdmin: false,
      salons: [{
        salonId: salon.id,
        salonSlug: salon.slug,
        salonName: 'Salon One',
        role,
      }],
    });

    const result = await requireClientManagerSalon(salon.slug);

    expect(result).toEqual({
      ok: true,
      salon,
      actor: {
        id: `admin_${role}`,
        role: expectedRole,
      },
    });
    expect(requireAdminSalon).toHaveBeenCalledWith(salon.slug);
  });

  it('denies a staff membership without exposing salon data', async () => {
    getAdminSession.mockResolvedValue({
      id: 'admin_staff',
      isSuperAdmin: false,
      salons: [{
        salonId: salon.id,
        salonSlug: salon.slug,
        salonName: 'Salon One',
        role: 'staff',
      }],
    });

    const result = await requireClientManagerSalon(salon.slug);

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error('Expected staff authorization to fail');
    }

    expect(result.response.status).toBe(403);
    expect(result.response.headers.get('cache-control')).toContain('private');
    expect(result.response.headers.get('cache-control')).toContain('no-store');
    await expect(result.response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Owner or admin access is required',
      },
    });
  });

  it('returns the tenant guard response without loading the admin session', async () => {
    const tenantResponse = Response.json(
      { error: { code: 'NOT_FOUND', message: 'Salon not found' } },
      { status: 404 },
    );
    requireAdminSalon.mockResolvedValue({
      error: tenantResponse,
      salon: null,
    });

    const result = await requireClientManagerSalon('foreign-salon');

    expect(result).toEqual({
      ok: false,
      response: tenantResponse,
    });
    expect(getAdminSession).not.toHaveBeenCalled();
  });
});
