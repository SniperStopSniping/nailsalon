import { beforeEach, expect, it, vi } from 'vitest';

import { AiCreditError } from '@/features/ai-credits/wallet.server';

import { GET, POST } from './route';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ enabled: vi.fn(), salon: vi.fn(), owner: vi.fn(), overview: vi.fn(), checkout: vi.fn(), reconcile: vi.fn(), cancel: vi.fn(), limit: vi.fn(), rows: [] as Array<{ id: string }> }));
vi.mock('@/features/ai-credits/config.server', () => ({ aiCreditsEnabled: mocks.enabled, aiCreditPurchasesEnabled: () => false, aiCreditPlanEnv: () => 'test' }));
vi.mock('@/features/ai-credits/checkout.server', () => ({ createAiCreditCheckout: mocks.checkout, reconcileAiCreditSession: mocks.reconcile, cancelAiCreditCheckout: mocks.cancel }));
vi.mock('@/features/ai-credits/wallet.server', async importOriginal => ({ ...await importOriginal<typeof import('@/features/ai-credits/wallet.server')>(), aiCreditOverview: mocks.overview }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalonForSlug: mocks.salon, requireRealSalonOwner: mocks.owner }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: mocks.limit, getClientIp: () => '127.0.0.1', rateLimitResponse: () => new Response(null, { status: 429 }) }));
vi.mock('@/libs/DB', () => ({ db: { select: () => ({ from: () => ({ where: async () => mocks.rows }) }) } }));

const url = 'https://test.example.invalid/api/admin/ai-credits';
const purchaseId = 'e89f36da-1331-4579-ae98-1a7a801380de';
const checkout = { salonSlug: 'my-salon', action: 'checkout', operationId: '75693c44-dfe5-44c3-89ab-cfd6fb398b81', packKey: 'ai_10_cad_v1', locale: 'en' };
const request = (body: unknown = checkout, origin = 'https://test.example.invalid') => new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [{ id: purchaseId }];
  mocks.limit.mockReturnValue({ allowed: true });
  mocks.enabled.mockReturnValue(true);
  mocks.salon.mockResolvedValue({ salon: { id: 'owned-salon' } });
  mocks.owner.mockResolvedValue({ ok: true, admin: { id: 'real-owner' } });
  mocks.overview.mockResolvedValue({ availableMicroCad: 10_000_000, reservedMicroCad: 0, history: [] });
  mocks.checkout.mockResolvedValue({ status: 'ready', url: 'https://checkout.stripe.com/fixture' });
  mocks.reconcile.mockResolvedValue({ status: 'paid', purchaseId });
});

it('fails closed when disabled and rejects CSRF before authentication or payment', async () => {
  mocks.enabled.mockReturnValue(false);

  expect((await POST(request())).status).toBe(404);
  expect((await GET(new Request(`${url}?salonSlug=my-salon`))).status).toBe(404);

  mocks.enabled.mockReturnValue(true);

  expect((await POST(request(checkout, 'https://foreign.invalid'))).status).toBe(403);
  expect(mocks.salon).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
});

it.each([401, 403])('denies unauthorized payment access with %s', async (status) => {
  mocks.salon.mockResolvedValue({ error: new Response(null, { status }) });

  expect((await POST(request())).status).toBe(status);
  expect(mocks.owner).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
});

it('requires a real salon owner, including for the balance', async () => {
  mocks.owner.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });

  expect((await GET(new Request(`${url}?salonSlug=my-salon`))).status).toBe(403);
  expect((await POST(request())).status).toBe(403);
  expect(mocks.overview).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
});

it('rate limits purchase attempts before accessing Stripe', async () => {
  mocks.limit.mockReturnValue({ allowed: false, retryAfterMs: 1000 });

  expect((await POST(request())).status).toBe(429);
  expect(mocks.checkout).not.toHaveBeenCalled();
});

it('rejects browser-supplied amounts, identities, prices and invalid packs', async () => {
  for (const change of [{ amountCents: 1 }, { salonId: 'foreign' }, { adminId: 'foreign' }, { stripePriceId: 'price_foreign' }, { packKey: 'unlimited' }]) {
    expect((await POST(request({ ...checkout, ...change }))).status).toBe(400);
  }

  expect(mocks.checkout).not.toHaveBeenCalled();
});

it('passes only the authenticated actor to the server checkout and disables caching', async () => {
  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(mocks.checkout).toHaveBeenCalledWith({ salonId: 'owned-salon', adminId: 'real-owner' }, checkout);
});

it('never reconciles a foreign purchase or uses the client callback to grant credits', async () => {
  mocks.rows = [];

  expect((await POST(request({ salonSlug: 'my-salon', action: 'reconcile', purchaseId }))).status).toBe(404);
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect((await POST(request({ salonSlug: 'my-salon', action: 'reconcile', purchaseId, paid: true }))).status).toBe(400);
});

it('returns a recoverable payment failure while keeping provider secrets out of responses', async () => {
  mocks.checkout.mockRejectedValue(new Error('sensitive provider detail'));
  const response = await POST(request());

  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('sensitive');

  mocks.checkout.mockRejectedValue(new AiCreditError('CHECKOUT_PENDING', 'Finish your earlier purchase.'));

  expect((await POST(request())).status).toBe(409);
});
