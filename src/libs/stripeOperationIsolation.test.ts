import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStripeOperationGuard, StripeOperationIsolationError } from './stripeOperationIsolation';

vi.mock('server-only', () => ({}));

const fixture = vi.hoisted(() => ({
  env: {
    STRIPE_SECRET_KEY: 'sk_test_synthetic_operation',
    BILLING_PLAN_ENV: 'test',
    BILLING_TOPUPS_ENABLED: 'true',
    NEXT_PUBLIC_APP_URL: 'https://operation.example.invalid',
  },
  aiPlan: 'test',
  price: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
  customer: vi.fn(),
  purchase: vi.fn(),
  attach: vi.fn(),
  transaction: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('@/libs/Env', () => ({ Env: fixture.env }));
// Keep the real shared-client construction and operation guard; replace only
// the SDK transport. Every credential here is a fixed synthetic test value.
vi.mock('stripe', () => ({
  default: class Stripe {
    prices = { retrieve: fixture.price };
    checkout = { sessions: { create: fixture.create, retrieve: fixture.retrieve } };

    constructor(credential: string) {
      fixture.construct(credential);
    }
  },
}));
vi.mock('@/libs/DB', () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{
    id: 'salon_operation',
    name: 'Synthetic operation',
    slug: 'synthetic-operation',
    plan: 'single_salon',
  }] }) }) }),
  transaction: fixture.transaction,
} }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminOwner: async () => ({ ok: true, admin: { clerkUserId: 'user_operation' } }) }));
vi.mock('@/libs/rateLimit', () => ({ checkEndpointRateLimit: () => ({ allowed: true }), getClientIp: () => '127.0.0.1', rateLimitResponse: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/libs/billing/billingCustomer', () => ({ resolveOrCreateBillingCustomer: fixture.customer }));
vi.mock('@/libs/billing/stripePriceMap', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/billing/stripePriceMap')>(),
  resolveStripePriceIdForTopup: () => 'price_synthetic_operation',
}));
vi.mock('@/features/business-setup/ai-trial.server', () => ({ setupAiExpenseAvailable: async () => true }));
vi.mock('@/features/business-setup/drafts.server', () => ({ lockSetupSalon: async () => ({ id: 'salon_operation', slug: 'synthetic-operation', name: 'Synthetic operation' }) }));
vi.mock('@/features/ai-credits/config.server', () => ({
  aiCreditPurchasesEnabled: () => true,
  aiCreditPlanEnv: () => fixture.aiPlan,
  aiCreditStripePrice: () => 'price_synthetic_operation',
}));
vi.mock('@/features/ai-credits/wallet.server', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/ai-credits/wallet.server')>(),
  beginAiCreditPurchase: fixture.purchase,
  attachAiCreditCheckout: fixture.attach,
}));

function runtime(mode: 'preview' | 'production' = 'preview') {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VITEST', undefined);
  vi.stubEnv('GITHUB_ACTIONS', undefined);
  vi.stubEnv('CI', undefined);
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', mode);
  vi.stubEnv('APP_ENV', mode);
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  runtime();
  fixture.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_operation';
  fixture.env.BILLING_PLAN_ENV = 'test';
  fixture.aiPlan = 'test';
  fixture.customer.mockResolvedValue({ stripeCustomerId: 'cus_synthetic_operation', source: 'created' });
  fixture.transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work({}));
  fixture.price.mockResolvedValue({ active: true, type: 'one_time', currency: 'cad', unit_amount: 1000, livemode: false });
  fixture.purchase.mockResolvedValue({
    id: 'purchase_operation',
    status: 'creating',
    stripeCustomerId: 'cus_synthetic_operation',
    stripePriceId: 'price_synthetic_operation',
    packKey: 'ai_10_cad_v1',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
  });
  fixture.create.mockResolvedValue({ id: 'cs_synthetic_operation', status: 'open', url: 'https://checkout.example.invalid/synthetic' });
});

afterEach(() => vi.unstubAllEnvs());

describe('synchronous Stripe operation isolation', () => {
  it('accepts normal Vercel Preview TEST even with framework NODE_ENV=production', () => {
    expect(createStripeOperationGuard('sk_test_synthetic_operation')('test')).toBe(false);
  });

  it('accepts real Vercel Preview with generic CI=true', () => {
    vi.stubEnv('CI', 'true');

    expect(createStripeOperationGuard('sk_test_synthetic_operation')('test')).toBe(false);
  });

  it.each([
    ['NODE_ENV', 'test'],
    ['VITEST', 'true'],
    ['GITHUB_ACTIONS', 'true'],
  ])('refuses synthetic execution precedence %s=%s despite TEST credentials', (name, value) => {
    vi.stubEnv(name, value);

    expect(() => createStripeOperationGuard('sk_test_synthetic_operation')('test')).toThrow(StripeOperationIsolationError);
  });

  it('refuses generic CI without an attested Vercel runtime', () => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('CI', 'true');

    expect(() => createStripeOperationGuard('sk_test_synthetic_operation')('test')).toThrow(StripeOperationIsolationError);
  });

  it('accepts Production LIVE with the production plan', () => {
    runtime('production');

    expect(createStripeOperationGuard('sk_live_synthetic_operation')('prod')).toBe(true);
  });

  it('accepts explicit Development TEST with the development plan', () => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('APP_ENV', 'development');

    expect(createStripeOperationGuard('sk_test_synthetic_operation')('dev')).toBe(false);
  });

  it.each(['', 'sk_test_', 'sk_live_', 'invalid', ' sk_test_synthetic', 'sk_test_synthetic\n', 'sk_test_two words', undefined])('rejects malformed credentials without disclosing them', (key) => {
    expect(() => createStripeOperationGuard(key)('test')).toThrow(StripeOperationIsolationError);
    expect(() => createStripeOperationGuard(key)('test')).toThrow('Stripe checkout is unavailable in this environment.');
  });

  it('rejects unknown runtime instead of treating every non-production runtime as TEST', () => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('APP_ENV', undefined);

    expect(() => createStripeOperationGuard('sk_test_synthetic_operation')('test')).toThrow(StripeOperationIsolationError);
  });

  it('rejects contradictory authoritative markers', () => {
    vi.stubEnv('APP_ENV', 'production');

    expect(() => createStripeOperationGuard('sk_test_synthetic_operation')('test')).toThrow(StripeOperationIsolationError);
  });

  it.each(['dev', 'prod', undefined])('rejects a plan inconsistent with Preview: %s', (plan) => {
    expect(() => createStripeOperationGuard('sk_test_synthetic_operation')(plan)).toThrow(StripeOperationIsolationError);
  });

  it('rejects LIVE on Preview and TEST on Production', () => {
    expect(() => createStripeOperationGuard('sk_live_synthetic_operation')('test')).toThrow(StripeOperationIsolationError);

    runtime('production');

    expect(() => createStripeOperationGuard('sk_test_synthetic_operation')('prod')).toThrow(StripeOperationIsolationError);
  });
});

async function smsCheckout() {
  const { POST } = await import('@/app/api/billing/checkout/topup/route');
  const { NextRequest } = await import('next/server');
  return POST(new NextRequest('https://operation.example.invalid/api/billing/checkout/topup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ salonId: 'salon_operation', topupOfferKey: 'topup_100_2026_10' }),
  }));
}

async function aiCheckout() {
  const { createAiCreditCheckout } = await import('@/features/ai-credits/checkout.server');
  return createAiCreditCheckout({ salonId: 'salon_operation', adminId: 'admin_operation' }, {
    packKey: 'ai_10_cad_v1',
    operationId: '00dbfba1-268c-40e1-b53c-2f9f06c3e8fd',
    locale: 'en',
  });
}

describe('real constructor-bound guard at both checkout entry points', () => {
  it.each(['created', 'existing'])('rejects cached LIVE client before price, %s customer, purchase/attempt or session work', async (source) => {
    fixture.customer.mockResolvedValue({ stripeCustomerId: 'cus_synthetic_operation', source });
    fixture.env.STRIPE_SECRET_KEY = 'sk_live_synthetic_operation';
    const { assertStripeOperationIsolation } = await import('./stripe');

    expect(fixture.construct).toHaveBeenCalledWith('sk_live_synthetic_operation');

    // A later valid-looking process/env key cannot relabel this cached client.
    fixture.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_operation';
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_synthetic_operation');

    expect(() => assertStripeOperationIsolation('test')).toThrow('Stripe checkout is unavailable in this environment.');
    expect((await smsCheckout()).status).toBe(500);
    await expect(aiCheckout()).rejects.toMatchObject({ name: 'StripeOperationIsolationError', code: 'STRIPE_OPERATION_ISOLATION_REFUSED' });
    expect(fixture.price).not.toHaveBeenCalled();
    expect(fixture.customer).not.toHaveBeenCalled();
    expect(fixture.purchase).not.toHaveBeenCalled();
    expect(fixture.transaction).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.retrieve).not.toHaveBeenCalled();
  });

  it.each([true, undefined])('SMS TEST client rejects Price livemode=%s after only the price read', async (livemode) => {
    fixture.price.mockResolvedValue({ active: true, type: 'one_time', currency: 'cad', unit_amount: 2000, livemode });
    const response = await smsCheckout();

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('PRICE_MISMATCH');
    expect(fixture.price).toHaveBeenCalledTimes(1);
    expect(fixture.customer).not.toHaveBeenCalled();
    expect(fixture.purchase).not.toHaveBeenCalled();
    expect(fixture.transaction).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it('uses the separately resolved AI plan, not a substitute from cached Env', async () => {
    fixture.aiPlan = 'prod';

    await expect(aiCheckout()).rejects.toMatchObject({ name: 'StripeOperationIsolationError', code: 'STRIPE_OPERATION_ISOLATION_REFUSED' });
    expect(fixture.price).not.toHaveBeenCalled();
    expect(fixture.customer).not.toHaveBeenCalled();
    expect(fixture.purchase).not.toHaveBeenCalled();
  });

  it.each(['preview', 'production'] as const)('retains a successful %s AI checkout with matching actual client and Price modes', async (mode) => {
    runtime(mode);
    fixture.env.STRIPE_SECRET_KEY = mode === 'production' ? 'sk_live_synthetic_operation' : 'sk_test_synthetic_operation';
    fixture.aiPlan = mode === 'production' ? 'prod' : 'test';
    fixture.env.BILLING_PLAN_ENV = fixture.aiPlan;
    fixture.price.mockResolvedValue({ active: true, type: 'one_time', currency: 'cad', unit_amount: 1000, livemode: mode === 'production' });

    await expect(aiCheckout()).resolves.toMatchObject({ status: 'ready' });
    expect(fixture.price).toHaveBeenCalledTimes(1);
    expect(fixture.customer).toHaveBeenCalledTimes(1);
    expect(fixture.purchase).toHaveBeenCalledTimes(1);
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.attach).toHaveBeenCalledTimes(1);
  });
});
