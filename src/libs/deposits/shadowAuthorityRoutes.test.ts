import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  cookieGet,
  cookieGetAll,
  clerkAuth,
  db,
  getAdminImpersonationSession,
  getSalonById,
  getSalonBySlug,
  isDevModeServer,
  loadAppointmentForSalon,
  readDevRoleFromCookies,
  requestDepositRefund,
  resolveDepositActor,
  selectPlans,
} = vi.hoisted(() => {
  type Plan = { kind: 'limit' | 'memberships' | 'deposit'; rows: unknown[] };
  let plans: Plan[] = [];
  const selectPlans = (next: Plan[]) => {
    plans = [...next];
  };
  const db = {
    select: vi.fn(() => {
      const plan = plans.shift() ?? { kind: 'limit' as const, rows: [] };
      const limit = vi.fn(async () => plan.rows);
      const where = vi.fn(() => plan.kind === 'memberships'
        ? Promise.resolve(plan.rows)
        : { limit, orderBy: vi.fn(() => ({ limit })) });
      return {
        from: vi.fn(() => ({
          where,
          innerJoin: vi.fn(() => ({ where: vi.fn(async () => plan.rows) })),
        })),
      };
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    })),
  };
  return {
    cookieGet: vi.fn(),
    cookieGetAll: vi.fn(),
    clerkAuth: vi.fn(),
    db,
    getAdminImpersonationSession: vi.fn(),
    getSalonById: vi.fn(),
    getSalonBySlug: vi.fn(),
    isDevModeServer: vi.fn(),
    loadAppointmentForSalon: vi.fn(),
    readDevRoleFromCookies: vi.fn(),
    requestDepositRefund: vi.fn(),
    resolveDepositActor: vi.fn(),
    selectPlans,
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookieGet, getAll: cookieGetAll })),
}));
vi.mock('@clerk/nextjs/server', () => ({ auth: clerkAuth }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/adminImpersonation', () => ({
  clearAdminImpersonationSession: vi.fn(),
  getAdminImpersonationSession,
  setAdminImpersonationSession: vi.fn(),
}));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/libs/clerkIdentity.server', () => ({ isClerkUserMissing: vi.fn() }));
vi.mock('@/libs/devRole.server', () => ({
  getMockAdminSession: vi.fn(),
  isDevModeServer,
  readDevRoleFromCookies,
}));
vi.mock('@/libs/queries', () => ({
  getSalonByFormerSlug: vi.fn(),
  getSalonById,
  getSalonBySlug,
}));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
  getClientIp: vi.fn(() => '203.0.113.25'),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/libs/routeAccessGuards', () => ({ loadAppointmentForSalon }));
// The legacy request boundary is intentionally the only financial seam. This
// test never imports Stripe, a dispatcher, or a shadow writer.
vi.mock('@/libs/deposits/depositLifecycle', () => ({
  requestDepositRefund,
  resolveDepositActor,
  serializeDepositForRole: vi.fn((_: string, deposit: unknown) => deposit),
}));

/* eslint-disable import/first */
import { POST } from '@/app/api/admin/appointments/[id]/deposit/refund/route';
/* eslint-enable import/first */

const SALON = { id: 'salon_authority', slug: 'authority-salon', name: 'Authority Salon' };
const APPOINTMENT = { id: 'appt_authority', salonId: SALON.id };
const DEPOSIT = { id: 'dep_authority', salonId: SALON.id, appointmentId: APPOINTMENT.id };
const OWNER_ACTOR = {
  recordedByType: 'admin' as const,
  recordedById: 'admin_authority',
  recordedByName: 'Authority Admin',
  performedBy: 'admin:admin_authority',
  performedByRole: 'admin' as const,
  performedByName: 'Authority Admin',
  requestedBy: 'admin_authority',
  requestedByRole: 'admin' as const,
  requestedByImpersonated: false,
  impersonated: false,
  superAdminUserId: null,
  impersonatedSalonId: null,
};
const SUPER_ADMIN_ACTOR = {
  ...OWNER_ACTOR,
  requestedByImpersonated: true,
  impersonated: true,
  superAdminUserId: 'admin_authority',
  impersonatedSalonId: SALON.id,
};

function sessionPlans(input: { isSuperAdmin?: boolean; memberships?: Array<{ salonId: string; role: string }> }) {
  return [
    { kind: 'limit' as const, rows: [{ id: 'session_authority', adminId: 'admin_authority', expiresAt: new Date('2099-01-01') }] },
    { kind: 'limit' as const, rows: [{ id: 'admin_authority', phoneE164: '+15551234567', name: 'Authority Admin', email: 'authority@example.test', isSuperAdmin: input.isSuperAdmin ?? false, createdAt: new Date(), updatedAt: new Date() }] },
    { kind: 'memberships' as const, rows: (input.memberships ?? []).map(membership => ({ ...membership, salonSlug: SALON.slug, salonName: SALON.name, customDomain: null, salonStatus: 'active', freeSoloEnabled: false })) },
    { kind: 'deposit' as const, rows: [DEPOSIT] },
  ];
}

function request() {
  return new Request(`http://localhost/api/admin/appointments/${APPOINTMENT.id}/deposit/refund?salonSlug=${SALON.slug}`, { method: 'POST' });
}

async function callRoute() {
  return POST(request(), { params: Promise.resolve({ id: APPOINTMENT.id }) });
}

describe('refund route authority matrix through the real owner guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectPlans([]);
    cookieGet.mockImplementation((name: string) => name === 'n5_admin_session'
      ? { value: 'session_authority' }
      : undefined);
    cookieGetAll.mockReturnValue([]);
    clerkAuth.mockResolvedValue({ userId: null });
    isDevModeServer.mockReturnValue(false);
    readDevRoleFromCookies.mockResolvedValue(null);
    getAdminImpersonationSession.mockResolvedValue(null);
    getSalonBySlug.mockResolvedValue(SALON);
    getSalonById.mockResolvedValue(SALON);
    loadAppointmentForSalon.mockResolvedValue(APPOINTMENT);
    resolveDepositActor.mockReturnValue(OWNER_ACTOR);
    requestDepositRefund.mockResolvedValue({
      ok: true,
      disposition: 'requested',
      deposit: { ...DEPOSIT, status: 'paid' },
      refundId: 're_legacy_only',
    });
  });

  it('refuses a guest and never reaches the legacy refund request', async () => {
    cookieGet.mockReturnValue(undefined);

    const response = await callRoute();

    expect(response.status).toBe(401);
    expect(requestDepositRefund).not.toHaveBeenCalled();
  });

  it('refuses an actual staff-session cookie and never reaches the legacy refund request', async () => {
    cookieGet.mockImplementation((name: string) => name === 'staff_session'
      ? { value: 'staff_session_authority' }
      : undefined);
    cookieGetAll.mockReturnValue([{ name: 'staff_session', value: 'staff_session_authority' }]);

    const response = await callRoute();

    expect(response.status).toBe(401);
    expect(requestDepositRefund).not.toHaveBeenCalled();
  });

  it('refuses a collaborator through actual requireAdminOwner before the deposit lookup', async () => {
    selectPlans(sessionPlans({ memberships: [{ salonId: SALON.id, role: 'admin' }] }));

    const response = await callRoute();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'OWNER_REQUIRED' } });
    expect(requestDepositRefund).not.toHaveBeenCalled();
    expect(loadAppointmentForSalon).not.toHaveBeenCalled();
  });

  it('refuses an owner of another salon before legacy refund work', async () => {
    selectPlans(sessionPlans({ memberships: [{ salonId: 'other_salon', role: 'owner' }] }));

    const response = await callRoute();

    expect(response.status).toBe(403);
    expect(requestDepositRefund).not.toHaveBeenCalled();
  });

  it('refuses the dev-role override before any identity or legacy refund work', async () => {
    isDevModeServer.mockReturnValue(true);
    readDevRoleFromCookies.mockResolvedValue('super_admin');

    const response = await callRoute();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'DEV_ROLE_BYPASS_FORBIDDEN' } });
    expect(db.select).not.toHaveBeenCalled();
    expect(requestDepositRefund).not.toHaveBeenCalled();
  });

  it('refuses an unimpersonated super admin before appointment/deposit reads', async () => {
    selectPlans(sessionPlans({ isSuperAdmin: true }));

    const response = await callRoute();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SUPER_ADMIN_MUST_IMPERSONATE' } });
    expect(loadAppointmentForSalon).not.toHaveBeenCalled();
    expect(requestDepositRefund).not.toHaveBeenCalled();
  });

  it('refuses a super admin whose impersonation is locked to another salon', async () => {
    selectPlans(sessionPlans({ isSuperAdmin: true }));
    getAdminImpersonationSession.mockResolvedValue({
      salonId: 'other_salon',
      salonSlug: 'other',
      salonName: 'Other Salon',
      adminUserId: 'admin_authority',
      startedAt: '2026-09-12T00:00:00.000Z',
    });
    getSalonById.mockResolvedValue({ id: 'other_salon', slug: 'other', name: 'Other Salon' });

    const response = await callRoute();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'IMPERSONATION_LOCKED' } });
    expect(requestDepositRefund).not.toHaveBeenCalled();
  });

  it('admits the legacy n5_admin_session owner and invokes only the legacy refund request seam', async () => {
    selectPlans(sessionPlans({ memberships: [{ salonId: SALON.id, role: 'owner' }] }));

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(resolveDepositActor).toHaveBeenCalledWith(expect.objectContaining({
      admin: expect.objectContaining({ id: 'admin_authority', isSuperAdmin: false }),
      impersonation: null,
      salonId: SALON.id,
    }));
    expect(requestDepositRefund).toHaveBeenCalledOnce();
    expect(requestDepositRefund).toHaveBeenCalledWith({
      depositId: DEPOSIT.id,
      salonId: SALON.id,
      actor: OWNER_ACTOR,
    });
  });

  it('admits a matching impersonated super admin and still invokes only legacy refund work', async () => {
    selectPlans(sessionPlans({ isSuperAdmin: true }));
    getAdminImpersonationSession.mockResolvedValue({
      salonId: SALON.id,
      salonSlug: SALON.slug,
      salonName: SALON.name,
      adminUserId: 'admin_authority',
      startedAt: '2026-09-12T00:00:00.000Z',
    });
    resolveDepositActor.mockReturnValue(SUPER_ADMIN_ACTOR);

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(resolveDepositActor).toHaveBeenCalledWith(expect.objectContaining({
      admin: expect.objectContaining({ id: 'admin_authority', isSuperAdmin: true }),
      impersonation: expect.objectContaining({
        adminUserId: 'admin_authority',
        salonId: SALON.id,
      }),
      salonId: SALON.id,
    }));
    expect(requestDepositRefund).toHaveBeenCalledOnce();
    expect(requestDepositRefund).toHaveBeenCalledWith(expect.objectContaining({
      depositId: DEPOSIT.id,
      salonId: SALON.id,
      actor: SUPER_ADMIN_ACTOR,
    }));
  });

  it('admits a current Clerk owner session with no legacy admin cookie', async () => {
    cookieGet.mockReturnValue(undefined);
    cookieGetAll.mockReturnValue([{ name: '__session', value: 'clerk-session-authority' }]);
    clerkAuth.mockResolvedValue({ userId: 'user_authority' });
    selectPlans([
      {
        kind: 'limit',
        rows: [{
          id: 'admin_authority',
          phoneE164: '+15551234567',
          name: 'Authority Admin',
          email: 'authority@example.test',
          clerkUserId: 'user_authority',
          emailVerifiedAt: new Date(),
          isSuperAdmin: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
      },
      {
        kind: 'memberships',
        rows: [{
          salonId: SALON.id,
          role: 'owner',
          salonSlug: SALON.slug,
          salonName: SALON.name,
          customDomain: null,
          salonStatus: 'active',
          freeSoloEnabled: false,
        }],
      },
      { kind: 'deposit', rows: [DEPOSIT] },
    ]);

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(clerkAuth).toHaveBeenCalledOnce();
    expect(requestDepositRefund).toHaveBeenCalledWith(expect.objectContaining({
      depositId: DEPOSIT.id,
      salonId: SALON.id,
      actor: OWNER_ACTOR,
    }));
  });
});
