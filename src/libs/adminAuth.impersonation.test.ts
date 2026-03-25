import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cookieGet,
  db,
  getAdminImpersonationSession,
  getSalonById,
  getSalonBySlug,
  setSelectPlans,
} = vi.hoisted(() => {
  type Plan =
    | { type: 'limit'; result: unknown[] }
    | { type: 'memberships'; result: unknown[] };

  let plans: Plan[] = [];

  const setSelectPlans = (nextPlans: Plan[]) => {
    plans = [...nextPlans];
  };

  const cookieGet = vi.fn((name: string) => {
    if (name === 'n5_admin_session') {
      return { value: 'admin_session_1' };
    }
    if (name === '__active_salon_slug') {
      return { value: 'other-salon' };
    }
    return undefined;
  });

  const db = {
    select: vi.fn(() => {
      const plan = plans.shift() ?? { type: 'limit', result: [] };

      if (plan.type === 'memberships') {
        return {
          from: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(async () => plan.result),
            })),
          })),
        };
      }

      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => plan.result),
          })),
        })),
      };
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  };

  return {
    cookieGet,
    db,
    getAdminImpersonationSession: vi.fn(),
    getSalonById: vi.fn(),
    getSalonBySlug: vi.fn(),
    setSelectPlans,
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
  })),
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/adminImpersonation', () => ({
  getAdminImpersonationSession,
}));

vi.mock('@/libs/queries', () => ({
  getSalonById,
  getSalonBySlug,
}));

vi.mock('@/libs/devRole.server', () => ({
  isDevModeServer: vi.fn(() => false),
  readDevRoleFromCookies: vi.fn(),
  getMockAdminSession: vi.fn(),
}));

import { requireActiveAdminSalon, requireAdmin } from './adminAuth';

function primeAdminSessionSelects() {
  setSelectPlans([
    {
      type: 'limit',
      result: [{
        id: 'admin_session_1',
        adminId: 'admin_1',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      }],
    },
    {
      type: 'limit',
      result: [{
        id: 'admin_1',
        phoneE164: '+15551234567',
        name: 'Sam Super',
        email: 'sam@example.com',
        isSuperAdmin: true,
      }],
    },
    {
      type: 'memberships',
      result: [],
    },
  ]);
}

describe('adminAuth impersonation enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGet.mockImplementation((name: string) => {
      if (name === 'n5_admin_session') {
        return { value: 'admin_session_1' };
      }
      if (name === '__active_salon_slug') {
        return { value: 'other-salon' };
      }
      return undefined;
    });
    getAdminImpersonationSession.mockResolvedValue({
      salonId: 'salon_locked',
      salonSlug: 'locked-salon',
      salonName: 'Locked Salon',
      adminUserId: 'admin_1',
      adminPhone: '+15551234567',
      startedAt: '2026-03-14T15:00:00.000Z',
    });
    getSalonById.mockResolvedValue({
      id: 'salon_locked',
      slug: 'locked-salon',
      name: 'Locked Salon',
    });
    getSalonBySlug.mockResolvedValue({
      id: 'salon_other',
      slug: 'other-salon',
      name: 'Other Salon',
    });
  });

  it('allows admin-equivalent access for the impersonated salon', async () => {
    primeAdminSessionSelects();

    const guard = await requireAdmin('salon_locked');

    expect(guard.ok).toBe(true);
  });

  it('blocks access to a different salon while impersonating', async () => {
    primeAdminSessionSelects();

    const guard = await requireAdmin('salon_other');

    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.response.status).toBe(403);
      await expect(guard.response.json()).resolves.toEqual({
        error: {
          code: 'IMPERSONATION_LOCKED',
          message: 'Impersonation is locked to a different salon',
        },
      });
    }
  });

  it('resolves the impersonated salon even if the active salon cookie points elsewhere', async () => {
    primeAdminSessionSelects();

    const result = await requireActiveAdminSalon();

    expect(result.error).toBeNull();
    expect(result.salon?.id).toBe('salon_locked');
    expect(result.impersonation?.salonSlug).toBe('locked-salon');
    expect(getSalonBySlug).not.toHaveBeenCalled();
  });
});
