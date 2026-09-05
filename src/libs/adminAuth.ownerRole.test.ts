import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isSalonOwner, requireAdminOwner } from './adminAuth';

/**
 * Collaborator RBAC (AG-security-tenancy-02): membership role 'admin' is a
 * collaborator, role 'owner' is the owner. `requireAdmin` admits both — that is
 * correct for daily work — while `requireAdminOwner` is the guard the
 * irreversible/financial routes use.
 */
const {
  cookieGet,
  db,
  getAdminImpersonationSession,
  setSelectPlans,
} = vi.hoisted(() => {
  type Plan =
    | { type: 'limit'; result: unknown[] }
    | { type: 'memberships'; result: unknown[] };

  let plans: Plan[] = [];

  const setSelectPlans = (nextPlans: Plan[]) => {
    plans = [...nextPlans];
  };

  const cookieGet = vi.fn((name: string) =>
    name === 'n5_admin_session' ? { value: 'admin_session_1' } : undefined,
  );

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
    setSelectPlans,
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
    getAll: () => [],
  })),
}));

vi.mock('@/libs/DB', () => ({ db }));

vi.mock('@/libs/adminImpersonation', () => ({
  clearAdminImpersonationSession: vi.fn(),
  getAdminImpersonationSession,
  setAdminImpersonationSession: vi.fn(),
}));

vi.mock('@/libs/clerkIdentity.server', () => ({
  isClerkUserMissing: vi.fn(async () => false),
}));

vi.mock('@/libs/queries', () => ({
  getSalonByFormerSlug: vi.fn(),
  getSalonById: vi.fn(),
  getSalonBySlug: vi.fn(),
}));

vi.mock('@/libs/devRole.server', () => ({
  isDevModeServer: vi.fn(() => false),
  readDevRoleFromCookies: vi.fn(),
  getMockAdminSession: vi.fn(),
}));

function primeSession(options: {
  isSuperAdmin?: boolean;
  memberships: Array<{ salonId: string; role: string }>;
}) {
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
        name: 'Collaborator',
        email: 'collab@example.com',
        isSuperAdmin: options.isSuperAdmin ?? false,
      }],
    },
    {
      type: 'memberships',
      result: options.memberships.map(membership => ({
        salonId: membership.salonId,
        role: membership.role,
        salonSlug: 'salon-b',
        salonName: 'Salon B',
        customDomain: null,
        salonStatus: 'active',
        freeSoloEnabled: false,
      })),
    },
  ]);
}

describe('requireAdminOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminImpersonationSession.mockResolvedValue(null);
    cookieGet.mockImplementation((name: string) =>
      name === 'n5_admin_session' ? { value: 'admin_session_1' } : undefined,
    );
  });

  it('admits the owner of the salon', async () => {
    primeSession({ memberships: [{ salonId: 'salon_b', role: 'owner' }] });

    const guard = await requireAdminOwner('salon_b');

    expect(guard.ok).toBe(true);
  });

  it('refuses a collaborator (membership role admin) with 403 OWNER_REQUIRED', async () => {
    primeSession({ memberships: [{ salonId: 'salon_b', role: 'admin' }] });

    const guard = await requireAdminOwner('salon_b');

    expect(guard.ok).toBe(false);

    if (!guard.ok) {
      expect(guard.response.status).toBe(403);
      await expect(guard.response.json()).resolves.toEqual({
        error: {
          code: 'OWNER_REQUIRED',
          message: 'Only the salon owner can do this.',
        },
      });
    }
  });

  it('uses the caller-supplied message so each route can say what is owner-only', async () => {
    primeSession({ memberships: [{ salonId: 'salon_b', role: 'admin' }] });

    const guard = await requireAdminOwner('salon_b', 'Only the salon owner can see revenue.');

    expect(guard.ok).toBe(false);

    if (!guard.ok) {
      await expect(guard.response.json()).resolves.toEqual({
        error: {
          code: 'OWNER_REQUIRED',
          message: 'Only the salon owner can see revenue.',
        },
      });
    }
  });

  it('refuses an owner of a DIFFERENT salon with the requireAdmin tenant 403, not OWNER_REQUIRED', async () => {
    primeSession({ memberships: [{ salonId: 'salon_a', role: 'owner' }] });

    const guard = await requireAdminOwner('salon_b');

    expect(guard.ok).toBe(false);

    if (!guard.ok) {
      expect(guard.response.status).toBe(403);
      await expect(guard.response.json()).resolves.toEqual({ error: 'Forbidden' });
    }
  });

  it('propagates the 401 when there is no session at all', async () => {
    cookieGet.mockImplementation(() => undefined);

    const guard = await requireAdminOwner('salon_b');

    expect(guard.ok).toBe(false);

    if (!guard.ok) {
      expect(guard.response.status).toBe(401);
    }
  });

  it('admits a super admin, who has no membership row', async () => {
    primeSession({ isSuperAdmin: true, memberships: [] });

    const guard = await requireAdminOwner('salon_b');

    expect(guard.ok).toBe(true);
  });
});

describe('isSalonOwner', () => {
  const base = {
    id: 'admin_1',
    phoneE164: '+15551234567',
    name: 'Collaborator',
    email: 'collab@example.com',
    createdAt: new Date(),
    updatedAt: new Date(),
    clerkUserId: null,
    emailVerifiedAt: null,
  };

  it('is true for an owner membership and false for a collaborator one', () => {
    const owner = {
      ...base,
      isSuperAdmin: false,
      salons: [{ salonId: 'salon_b', salonSlug: 'salon-b', salonName: 'Salon B', role: 'owner' }],
    };
    const collaborator = {
      ...base,
      isSuperAdmin: false,
      salons: [{ salonId: 'salon_b', salonSlug: 'salon-b', salonName: 'Salon B', role: 'admin' }],
    };

    expect(isSalonOwner(owner, 'salon_b')).toBe(true);
    expect(isSalonOwner(collaborator, 'salon_b')).toBe(false);
    expect(isSalonOwner(owner, 'salon_a')).toBe(false);
  });

  it('is true for a super admin regardless of memberships', () => {
    expect(isSalonOwner({ ...base, isSuperAdmin: true, salons: [] }, 'salon_b')).toBe(true);
  });
});
