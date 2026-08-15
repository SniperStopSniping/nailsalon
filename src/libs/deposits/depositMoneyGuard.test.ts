import fs from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertNoDevRoleBypass,
  requireDepositMoneyActor,
  requireDepositReadActor,
} from './depositMoneyGuard';

vi.mock('server-only', () => ({}));

const {
  checkEndpointRateLimit,
  db,
  getAdminImpersonationForAdmin,
  getSalonBySlug,
  isDevModeServer,
  loadAppointmentForSalon,
  logAuditEvent,
  readDevRoleFromCookies,
  requireAdmin,
  resolveDepositActor,
  selectedDeposits,
} = vi.hoisted(() => {
  const selectedDeposits: unknown[][] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => selectedDeposits.shift() ?? []),
          })),
        })),
      })),
    })),
  };
  return {
    checkEndpointRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
    db,
    getAdminImpersonationForAdmin: vi.fn(async (): Promise<unknown> => null),
    getSalonBySlug: vi.fn(),
    isDevModeServer: vi.fn(() => false),
    loadAppointmentForSalon: vi.fn(),
    logAuditEvent: vi.fn(async () => undefined),
    readDevRoleFromCookies: vi.fn((): string | null => null),
    requireAdmin: vi.fn(),
    resolveDepositActor: vi.fn(() => ({ requestedBy: 'admin_1' })),
    selectedDeposits,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  getAdminImpersonationForAdmin,
  requireAdmin,
}));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/devRole.server', () => ({
  isDevModeServer,
  readDevRoleFromCookies,
}));
vi.mock('@/libs/queries', () => ({ getSalonBySlug }));
vi.mock('@/libs/rateLimit', () => ({
  checkEndpointRateLimit,
  getClientIp: vi.fn(() => '203.0.113.1'),
  rateLimitResponse: vi.fn(() => new Response('limited', { status: 429 })),
}));
vi.mock('@/libs/routeAccessGuards', () => ({ loadAppointmentForSalon }));
vi.mock('./depositLifecycle', () => ({ resolveDepositActor }));

const salon = {
  id: 'salon_1',
  slug: 'salon-one',
  name: 'Salon One',
};
const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
};
const deposit = {
  id: 'dep_1',
  salonId: 'salon_1',
  appointmentId: 'appt_1',
};
const admin = {
  id: 'admin_1',
  name: 'Admin One',
  isSuperAdmin: false,
};

function request(): Request {
  return new Request('https://example.test/api/admin/deposits');
}

describe('deposit money guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectedDeposits.length = 0;
    checkEndpointRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    isDevModeServer.mockReturnValue(false);
    readDevRoleFromCookies.mockReturnValue(null);
    getSalonBySlug.mockResolvedValue(salon);
    requireAdmin.mockResolvedValue({ ok: true, admin });
    getAdminImpersonationForAdmin.mockResolvedValue(null);
    loadAppointmentForSalon.mockResolvedValue(appointment);
  });

  it('rejects the development-role override mechanism with no test exemption', async () => {
    isDevModeServer.mockReturnValue(true);
    readDevRoleFromCookies.mockReturnValue('super_admin');

    const response = await assertNoDevRoleBypass();

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: 'DEV_ROLE_BYPASS_FORBIDDEN',
        message: 'Development role overrides cannot access deposit money routes.',
      },
    });
  });

  it('rate-limits before resolving a salon and passes the 429 through unchanged', async () => {
    checkEndpointRateLimit.mockReturnValue({ allowed: false, retryAfterMs: 1_000 });

    const result = await requireDepositMoneyActor({
      request: request(),
      rateLimitKey: 'deposit-refund',
      salonSlug: 'salon-one',
      appointmentId: 'appt_1',
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.response.status).toBe(429);
    }

    expect(getSalonBySlug).not.toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('returns the same 404 for a missing or unknown required salon slug', async () => {
    const missing = await requireDepositMoneyActor({
      request: request(),
      rateLimitKey: 'deposit-refund',
      salonSlug: null,
      appointmentId: 'appt_1',
    });

    expect(missing.ok).toBe(false);

    if (!missing.ok) {
      expect(missing.response.status).toBe(404);
    }

    getSalonBySlug.mockResolvedValue(null);
    const unknown = await requireDepositMoneyActor({
      request: request(),
      rateLimitKey: 'deposit-refund',
      salonSlug: 'unknown',
      appointmentId: 'appt_1',
    });

    expect(unknown.ok).toBe(false);

    if (!unknown.ok) {
      expect(unknown.response.status).toBe(404);
    }

    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it('requires a super-admin to impersonate before appointment or deposit reads', async () => {
    requireAdmin.mockResolvedValue({
      ok: true,
      admin: { ...admin, isSuperAdmin: true },
    });

    const result = await requireDepositMoneyActor({
      request: request(),
      rateLimitKey: 'deposit-waive',
      salonSlug: 'salon-one',
      appointmentId: 'appt_1',
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toEqual({
        error: {
          code: 'SUPER_ADMIN_MUST_IMPERSONATE',
          message: 'Super administrators must impersonate this salon before accessing deposit records.',
        },
      });
    }

    expect(loadAppointmentForSalon).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('delegates the tenant-safe appointment load and scopes the deposit lookup', async () => {
    selectedDeposits.push([deposit]);

    const result = await requireDepositMoneyActor({
      request: request(),
      rateLimitKey: 'deposit-release',
      salonSlug: 'salon-one',
      appointmentId: 'appt_1',
    });

    expect(result).toMatchObject({
      ok: true,
      salon,
      appointment,
      deposit,
    });
    expect(loadAppointmentForSalon).toHaveBeenCalledWith('appt_1', 'salon_1');
    expect(resolveDepositActor).toHaveBeenCalledWith({
      admin,
      impersonation: null,
      salonId: 'salon_1',
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('keeps cross-salon health mode to the BILLING limit and nothing else', async () => {
    const result = await requireDepositReadActor({
      request: request(),
      rateLimitKey: 'deposit-health',
      crossSalon: true,
    });

    expect(result).toEqual({ ok: true, crossSalon: true });
    expect(checkEndpointRateLimit).toHaveBeenCalledTimes(1);
    expect(getSalonBySlug).not.toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(loadAppointmentForSalon).not.toHaveBeenCalled();
  });

  it('writes the read audit only for an impersonated salon-scoped GET', async () => {
    const impersonation = {
      salonId: 'salon_1',
      salonSlug: 'salon-one',
      salonName: 'Salon One',
      adminUserId: 'super_1',
      adminPhone: '+15550000000',
      startedAt: '2026-08-14T12:00:00.000Z',
    };
    requireAdmin.mockResolvedValue({
      ok: true,
      admin: { ...admin, id: 'super_1', isSuperAdmin: true },
    });
    getAdminImpersonationForAdmin.mockResolvedValue(impersonation);

    const result = await requireDepositReadActor({
      request: request(),
      rateLimitKey: 'deposit-panel',
      salonSlug: 'salon-one',
      appointmentId: 'appt_1',
    });

    expect(result.ok).toBe(true);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      actorType: 'super_admin',
      actorId: 'super_1',
      action: 'deposit_records_viewed',
      entityType: 'appointment',
      entityId: 'appt_1',
    }));
  });
});

describe('deposit guard structure', () => {
  it('imports the exported appointment loader and no deprecated money guard', () => {
    const source = fs.readFileSync(new URL('./depositMoneyGuard.ts', import.meta.url), 'utf8');

    expect(source).toContain('import { loadAppointmentForSalon } from \'@/libs/routeAccessGuards\'');
    expect(source).not.toContain('appointmentSchema');
    expect(source).not.toContain('requireAdminSalon');
    expect(source).not.toContain('requireAppointmentManagerAccess');
    expect(source).not.toContain('process.env.NODE_ENV');
    expect(source).not.toContain('SKIP_');
  });
});
