import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readRequestedAdminSalonSlug, requireAdminSalonForSlug } from './adminAuth';

/**
 * AG-security-tenancy-03 / AG-w2-settings-integrations-07: cookie-derived admin
 * surfaces used to ignore the salon the URL named, so a link naming salon A
 * silently read and wrote whichever salon the active-salon cookie held. The URL
 * now wins — after the caller's membership is re-checked.
 */
const {
  cookieGet,
  cookieSet,
  db,
  getAdminImpersonationSession,
  getSalonById,
  getSalonBySlug,
  getSalonByFormerSlug,
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
    cookieSet: vi.fn(),
    db,
    getAdminImpersonationSession: vi.fn(),
    getSalonById: vi.fn(),
    getSalonBySlug: vi.fn(),
    getSalonByFormerSlug: vi.fn(),
    setSelectPlans,
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: cookieGet,
    getAll: () => [],
    set: cookieSet,
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
  getSalonByFormerSlug,
  getSalonById,
  getSalonBySlug,
}));

vi.mock('@/libs/devRole.server', () => ({
  isDevModeServer: vi.fn(() => false),
  readDevRoleFromCookies: vi.fn(),
  getMockAdminSession: vi.fn(),
}));

const salonB = { id: 'salon_b', slug: 'salon-b', name: 'Salon B' };
const salonA = { id: 'salon_a', slug: 'salon-a', name: 'Salon A' };

/** One `getAdminSession()` call's worth of query plans. */
function sessionPlans(memberships: Array<{ salonId: string; salonSlug: string }>) {
  return [
    {
      type: 'limit' as const,
      result: [{
        id: 'admin_session_1',
        adminId: 'admin_1',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      }],
    },
    {
      type: 'limit' as const,
      result: [{
        id: 'admin_1',
        phoneE164: '+15551234567',
        name: 'Owner',
        email: 'owner@example.com',
        isSuperAdmin: false,
      }],
    },
    {
      type: 'memberships' as const,
      result: memberships.map(membership => ({
        salonId: membership.salonId,
        role: 'owner',
        salonSlug: membership.salonSlug,
        salonName: membership.salonSlug,
        customDomain: null,
        salonStatus: 'active',
        freeSoloEnabled: false,
      })),
    },
  ];
}

describe('readRequestedAdminSalonSlug', () => {
  it('reads either query name and ignores blanks', () => {
    expect(readRequestedAdminSalonSlug('http://x/api?salonSlug=a')).toBe('a');
    expect(readRequestedAdminSalonSlug('http://x/api?salon=b')).toBe('b');
    expect(readRequestedAdminSalonSlug('http://x/api?salon=%20')).toBeNull();
    expect(readRequestedAdminSalonSlug('http://x/api')).toBeNull();
  });
});

describe('requireAdminSalonForSlug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminImpersonationSession.mockResolvedValue(null);
    getSalonById.mockImplementation(async (id: string) =>
      id === salonB.id ? salonB : id === salonA.id ? salonA : null);
    getSalonBySlug.mockImplementation(async (slug: string) =>
      slug === salonA.slug ? salonA : slug === salonB.slug ? salonB : null);
    getSalonByFormerSlug.mockResolvedValue(null);
  });

  it('falls back to the active selection when the URL names no salon', async () => {
    setSelectPlans(sessionPlans([{ salonId: salonB.id, salonSlug: salonB.slug }]));

    const result = await requireAdminSalonForSlug(null);

    expect(result.error).toBeNull();
    expect(result.salon?.id).toBe(salonB.id);
  });

  it('acts on the salon the URL names, not the cookie fallback', async () => {
    setSelectPlans([
      ...sessionPlans([
        { salonId: salonB.id, salonSlug: salonB.slug },
        { salonId: salonA.id, salonSlug: salonA.slug },
      ]),
      ...sessionPlans([
        { salonId: salonB.id, salonSlug: salonB.slug },
        { salonId: salonA.id, salonSlug: salonA.slug },
      ]),
    ]);

    const result = await requireAdminSalonForSlug('salon-a');

    expect(result.error).toBeNull();
    expect(result.salon?.id).toBe(salonA.id);
    expect(cookieSet).toHaveBeenCalledWith(
      '__active_salon_slug',
      'salon-a',
      expect.objectContaining({ path: '/' }),
    );
  });

  it('refuses a salon the caller has no membership for', async () => {
    setSelectPlans([
      ...sessionPlans([{ salonId: salonB.id, salonSlug: salonB.slug }]),
      ...sessionPlans([{ salonId: salonB.id, salonSlug: salonB.slug }]),
    ]);

    const result = await requireAdminSalonForSlug('salon-a');

    expect(result.salon).toBeNull();
    expect(result.error?.status).toBe(403);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('answers 404 for a slug that names no salon', async () => {
    setSelectPlans(sessionPlans([{ salonId: salonB.id, salonSlug: salonB.slug }]));

    const result = await requireAdminSalonForSlug('does-not-exist');

    expect(result.salon).toBeNull();
    expect(result.error?.status).toBe(404);
  });

  it('does not move the active-salon cookie when asked not to', async () => {
    setSelectPlans([
      ...sessionPlans([
        { salonId: salonB.id, salonSlug: salonB.slug },
        { salonId: salonA.id, salonSlug: salonA.slug },
      ]),
      ...sessionPlans([
        { salonId: salonB.id, salonSlug: salonB.slug },
        { salonId: salonA.id, salonSlug: salonA.slug },
      ]),
    ]);

    const result = await requireAdminSalonForSlug('salon-a', {
      persistActiveSalon: false,
    });

    expect(result.salon?.id).toBe(salonA.id);
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
