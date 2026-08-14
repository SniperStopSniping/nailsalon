import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertNoDevRoleBypass,
  getClientIp,
  loadDepositHealth,
  logAuditEvent,
  requireDepositReadActor,
  requireSuperAdmin,
} = vi.hoisted(() => ({
  assertNoDevRoleBypass: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  loadDepositHealth: vi.fn(),
  logAuditEvent: vi.fn(),
  requireDepositReadActor: vi.fn(),
  requireSuperAdmin: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent }));
vi.mock('@/libs/deposits/depositLifecycle', () => ({ loadDepositHealth }));
vi.mock('@/libs/deposits/depositMoneyGuard', () => ({
  assertNoDevRoleBypass,
  requireDepositReadActor,
}));
vi.mock('@/libs/rateLimit', () => ({ getClientIp }));

/* eslint-disable import/first */
import { dynamic, GET } from './route';
/* eslint-enable import/first */

const health = {
  generatedAt: '2026-08-14T12:00:00.000Z',
  sentryDsnConfigured: false,
  lastReconcileObservedAt: null,
  totals: {},
  unattributed: {},
  salonsOmitted: 0,
  salons: [],
};

describe('GET /api/super-admin/payment-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertNoDevRoleBypass.mockResolvedValue(null);
    requireDepositReadActor.mockResolvedValue({ ok: true, crossSalon: true });
    requireSuperAdmin.mockResolvedValue({
      ok: true,
      admin: { id: 'super_1', isSuperAdmin: true },
    });
    logAuditEvent.mockResolvedValue(undefined);
    loadDepositHealth.mockResolvedValue(health);
  });

  it('is private, force-dynamic, and blocks dev-role bypass before auth or audit', async () => {
    expect(dynamic).toBe('force-dynamic');

    assertNoDevRoleBypass.mockResolvedValue(Response.json({}, { status: 403 }));

    const response = await GET(new Request('http://localhost/api/super-admin/payment-health'));

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(requireDepositReadActor).not.toHaveBeenCalled();
    expect(requireSuperAdmin).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(loadDepositHealth).not.toHaveBeenCalled();
  });

  it('rate-limits in cross-salon mode, requires super-admin, audits, then loads health', async () => {
    const request = new Request('http://localhost/api/super-admin/payment-health', {
      headers: { 'user-agent': 'vitest' },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(requireDepositReadActor).toHaveBeenCalledWith({
      request,
      rateLimitKey: 'super-admin-payment-health',
      crossSalon: true,
    });
    expect(requireSuperAdmin).toHaveBeenCalledOnce();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'super_admin',
      actorId: 'super_1',
      action: 'payment_health_viewed',
    }));
    expect(loadDepositHealth).toHaveBeenCalledWith(null);
    expect(requireDepositReadActor.mock.invocationCallOrder[0]).toBeLessThan(
      requireSuperAdmin.mock.invocationCallOrder[0]!,
    );
    expect(requireSuperAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      logAuditEvent.mock.invocationCallOrder[0]!,
    );
    await expect(response.json()).resolves.toEqual(health);
  });

  it('does not audit or query counters when super-admin auth fails', async () => {
    requireSuperAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({}, { status: 403 }),
    });

    const response = await GET(new Request('http://localhost/api/super-admin/payment-health'));

    expect(response.status).toBe(403);
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(loadDepositHealth).not.toHaveBeenCalled();
  });
});
