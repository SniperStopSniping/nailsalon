import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), transaction: vi.fn(), inspect: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireSuperAdmin: mocks.guard }));
vi.mock('@/libs/DB', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('@/libs/billing/starterIdentityReadiness', () => ({ inspectStarterIdentityReadiness: mocks.inspect }));

const { GET } = await import('./route');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, admin: { id: 'super-admin' } });
});

it('refuses unauthorized access before reading identity history', async () => {
  mocks.guard.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });

  expect((await GET()).status).toBe(403);
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it('returns an uncached count-only report', async () => {
  const report = { keysReady: true, totalClaims: 8, missingEmail: 2, missingPhone: 8, purgedClaims: 0, ready: false, newClaimsEnabled: false };
  mocks.transaction.mockResolvedValue(report);
  const response = await GET();

  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({ data: report });
});
