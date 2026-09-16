/**
 * RD-8 — deployed billing readiness evidence endpoint (handoff §5.3 item 2).
 *
 * Pins the three properties that make this endpoint safe to point a harness
 * at: it is CRON_SECRET-authorized and fails closed (401) without the secret;
 * its body carries presence booleans and non-secret facts ONLY, with no
 * value-shaped substring under a fully populated fake environment; and those
 * booleans actually track the environment rather than being hard-coded.
 *
 * Every credential below is an obviously synthetic placeholder in the shape
 * the repo's existing billing tests already use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/Env', () => ({ Env: { BILLING_PLAN_ENV: 'test' } }));

const MANAGED_KEYS = [
  'BILLING_PLAN_ENV',
  'BILLING_STRIPE_PRICE_IDS',
  'BILLING_SUBSCRIPTIONS_ENABLED',
  'BILLING_TOPUPS_ENABLED',
  'PUBLIC_PRICING_ENABLED',
  'BILLING_TAX_COLLECTION_ENABLED',
  'BILLING_IDENTITY_HMAC_SECRET',
  'BILLING_IDENTITY_HMAC_VERSION',
  'BILLING_DEPLOYMENT_MARKER',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_CONNECT_WEBHOOK_SECRET',
  'STRIPE_BILLING_WEBHOOK_SECRET',
  'CRON_SECRET',
  'NEXT_PUBLIC_APP_URL',
  'VERCEL_ENV',
  'VERCEL_GIT_COMMIT_SHA',
] as const;

const saved = new Map<string, string | undefined>();

const CRON_SECRET = 'cron_readiness_test_secret';

const COMPLETE_CARRIER = JSON.stringify({
  env: 'test',
  offers: Object.fromEntries([
    'starter_2026_08_monthly',
    'starter_2026_08_annual',
    'pro_2026_08_monthly',
    'pro_2026_08_annual',
    'elite_2026_08_monthly',
    'elite_2026_08_annual',
  ].map((key, index) => [key, `price_test${String(index).padStart(8, '0')}`])),
  topups: Object.fromEntries([
    'topup_100_free_2026_08',
    'topup_250_free_2026_08',
    'topup_500_free_2026_08',
    'topup_100_paid_2026_08',
    'topup_250_paid_2026_08',
    'topup_500_paid_2026_08',
    'topup_1000_paid_2026_08',
  ].map((key, index) => [key, `price_topup${String(index).padStart(8, '0')}`])),
  coupons: { founding_annual_2026: 'coupon_test12345678' },
});

/** A fully populated, obviously synthetic Preview-rehearsal environment. */
function populateRehearsalEnvironment(): void {
  process.env.BILLING_PLAN_ENV = 'test';
  process.env.BILLING_STRIPE_PRICE_IDS = COMPLETE_CARRIER;
  process.env.BILLING_SUBSCRIPTIONS_ENABLED = 'true';
  process.env.BILLING_TOPUPS_ENABLED = 'true';
  process.env.BILLING_IDENTITY_HMAC_SECRET = 'identity-hmac-placeholder-not-a-secret';
  process.env.BILLING_IDENTITY_HMAC_VERSION = '1';
  process.env.BILLING_DEPLOYMENT_MARKER = 'preview-rehearsal';
  process.env.STRIPE_SECRET_KEY = 'sk_test_readinessroutefake';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_placeholder_legacy';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test_placeholder_connect';
  process.env.STRIPE_BILLING_WEBHOOK_SECRET = 'whsec_test_placeholder_billing';
  process.env.NEXT_PUBLIC_APP_URL = 'https://preview.example/';
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_GIT_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
}

beforeEach(() => {
  saved.clear();
  for (const key of MANAGED_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.BILLING_PLAN_ENV = 'test';
  process.env.CRON_SECRET = CRON_SECRET;
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function call(headers: Record<string, string> = { authorization: `Bearer ${CRON_SECRET}` }) {
  const { GET } = await import('./route');
  return GET(new Request('https://preview.example/api/billing/readiness', { method: 'GET', headers }));
}

describe('GET /api/billing/readiness — authorization', () => {
  it('refuses an unauthenticated request', async () => {
    const response = await call({});

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('refuses a wrong secret and accepts either accepted header form', async () => {
    expect((await call({ authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await call({ 'x-cron-secret': 'wrong' })).status).toBe(401);
    expect((await call({ 'x-cron-secret': CRON_SECRET })).status).toBe(200);
    expect((await call({ authorization: `Bearer ${CRON_SECRET}` })).status).toBe(200);
  });

  it('fails closed when CRON_SECRET is unset on the deployment', async () => {
    delete process.env.CRON_SECRET;

    expect((await call({ authorization: 'Bearer ' })).status).toBe(401);
    expect((await call({})).status).toBe(401);
  });

  it('is never cached', async () => {
    const response = await call();

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('GET /api/billing/readiness — no value-shaped strings', () => {
  it('never serializes a secret, key, price, coupon or promotion id', async () => {
    populateRehearsalEnvironment();

    const body = await (await call()).text();

    for (const shape of ['whsec_', 'sk_', 'rk_', 'price_', 'coupon_', 'promo_']) {
      expect(body).not.toContain(shape);
    }

    expect(body).not.toContain('readinessroutefake');
    expect(body).not.toContain('placeholder');
    expect(body).not.toContain(CRON_SECRET);
  });
});

describe('GET /api/billing/readiness — presence facts', () => {
  it('reports a fully populated rehearsal environment correctly', async () => {
    populateRehearsalEnvironment();

    const body = await (await call()).json() as Record<string, unknown>;

    expect(body).toMatchObject({
      planEnv: 'test',
      planEnvMatchesRuntime: true,
      vercelEnv: 'preview',
      gitSha: '0123456',
      appOrigin: 'https://preview.example',
      switches: { subscriptions: true, topups: true, publicPricing: false, taxCollection: false },
      webhookSecretConfigured: true,
      webhookSecretDistinct: true,
      stripeKeyMode: 'test',
      cronSecretConfigured: true,
      identityHmacConfigured: true,
      identityHmacVersion: 1,
      deploymentMarker: true,
    });
    expect(body.carrier).toEqual({
      present: true,
      env: 'test',
      offers: 6,
      topups: 7,
      coupons: 1,
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      parse: 'ok',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('reports a dark deployment as unconfigured rather than as an error', async () => {
    const body = await (await call()).json() as Record<string, unknown>;

    expect(body).toMatchObject({
      switches: { subscriptions: false, topups: false, publicPricing: false, taxCollection: false },
      webhookSecretConfigured: false,
      webhookSecretDistinct: true,
      identityHmacConfigured: false,
      identityHmacVersion: null,
      deploymentMarker: false,
      appOrigin: null,
      vercelEnv: null,
      gitSha: null,
    });
    expect(body.carrier).toMatchObject({ present: false, parse: 'absent', digest: null });
  });

  it('reports a billing secret shared with the legacy or Connect endpoint as not distinct', async () => {
    populateRehearsalEnvironment();
    process.env.STRIPE_BILLING_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

    const shared = await (await call()).json() as Record<string, unknown>;

    expect(shared).toMatchObject({ webhookSecretConfigured: true, webhookSecretDistinct: false });

    process.env.STRIPE_BILLING_WEBHOOK_SECRET = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

    const sharedWithConnect = await (await call()).json() as Record<string, unknown>;

    expect(sharedWithConnect).toMatchObject({ webhookSecretDistinct: false });
  });

  it('reports a rejected carrier by reason, with no counts and no digest', async () => {
    populateRehearsalEnvironment();
    process.env.BILLING_STRIPE_PRICE_IDS = JSON.stringify({ env: 'prod', offers: {}, topups: {}, coupons: {} });

    const body = await (await call()).json() as { carrier: Record<string, unknown> };

    expect(body.carrier).toMatchObject({ present: true, parse: 'ENV_MISMATCH', env: null, digest: null, offers: 0 });
  });

  it('reports a live-mode key and a plan-env mismatch without throwing', async () => {
    populateRehearsalEnvironment();
    process.env.STRIPE_SECRET_KEY = 'sk_live_readinessroutefake';
    process.env.BILLING_PLAN_ENV = 'prod';

    const body = await (await call()).json() as Record<string, unknown>;

    expect(body).toMatchObject({ planEnv: 'prod', planEnvMatchesRuntime: false, stripeKeyMode: 'live' });
  });
});
