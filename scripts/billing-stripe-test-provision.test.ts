/**
 * Unit tests for `scripts/billing-stripe-test-provision.ts`.
 *
 * THE STRIPE CLIENT IS FULLY MOCKED. Every test drives a hand-written object
 * that satisfies `ProvisionStripeClient` and nothing else; the real `Stripe`
 * constructor is never invoked here and no test performs any network, file or
 * database I/O. `main()` is never called either — it is gated behind a
 * direct-invocation check in the script, so importing the module runs no
 * argument parsing, no re-exec and no client construction.
 *
 * The committed catalogue modules ARE imported for real, so the amount and
 * cadence assertions below are checked against the live source of truth
 * (`src/libs/billing/{billingOffers,topupOffers,promotions}.ts`) rather than
 * against a copy that could drift.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BILLING_WEBHOOK_HANDLED_TYPES } from '../src/libs/billing/billingWebhookEvents';
import type {
  AccountInventory,
  Carrier,
  Catalogue,
  PlannedPrice,
  ProvisionPlan,
  ProvisionStripeClient,
} from './billing-stripe-test-provision';
import {
  assertOutputPathOutsideRepository,
  assertWebhookHostAllowed,
  buildCarrier,
  buildProvisionPlan,
  BYPASS_QUERY_PARAM,
  CANONICAL_STRIPE_ID_SHAPE_SOURCE,
  canonicalIdShapeMatches,
  CATALOG_MARKER,
  checkSecretKeyMode,
  classifyCatalogueCollisions,
  collectAllPages,
  computeFoundingFirstTermCents,
  couponId,
  deliverWebhookSecret,
  describeErrorForOutput,
  describeSharedAccountExposure,
  describeWebhookRegistrationTarget,
  enclosingGitCheckout,
  extractBypassToken,
  extractExpectedStripeApiVersion,
  findImmutablePriceMismatches,
  idempotencyKeyFor,
  isConfiguredStripeId,
  isProductionWebhookHost,
  LIST_MAX_PAGES,
  LIST_PAGE_LIMIT,
  normalizeHostname,
  parseArguments,
  planProductId,
  priceShapeMatches,
  PRODUCTION_VERCEL_ALIASES,
  PRODUCTION_WEBHOOK_DOMAINS,
  PRODUCTION_WEBHOOK_HOSTS,
  PROVISIONER,
  redactSecrets,
  RefusalError,
  registerSensitiveValue,
  requirePlanEnv,
  resetSensitiveValues,
  resolveWebhookUrlSource,
  runProvision,
  runVerify,
  summarizeOtherWebhookEndpoints,
  topupProductId,
  USAGE,
  validateCarrier,
  validateWebhookUrl,
  webhookIdempotencyHandle,
  writeSecureFile,
} from './billing-stripe-test-provision';

// Repo convention for reaching a `server-only`-marked module from Vitest
// (see src/libs/billing/promotions.test.ts:3). The script under test never
// imports those modules statically — it loads them with `await import(...)`
// after re-execing under the `react-server` condition — so only this test
// file needs the marker stubbed, and only for the three catalogue modules
// pulled in dynamically below.
vi.mock('server-only', () => ({}));

const { BILLING_OFFERS } = await import('../src/libs/billing/billingOffers');
const { TOPUP_OFFERS } = await import('../src/libs/billing/topupOffers');
const { PROMOTIONS } = await import('../src/libs/billing/promotions');

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const catalogue: Catalogue = {
  offers: BILLING_OFFERS,
  topups: TOPUP_OFFERS,
  promotions: PROMOTIONS,
};

const API_VERSION = '2024-06-20';
/**
 * What an endpoint THIS SCRIPT created carries; without it the endpoint is a
 * collision to be refused, not an endpoint to reuse.
 */
const OUR_WEBHOOK_METADATA = {
  luster_endpoint: 'stripe-billing',
  luster_plan_env: 'test',
  luster_provisioner: 'billing-stripe-test-provision',
} as const;
/**
 * Scanner-safe fake secret shapes.
 *
 * `scripts/check-secret-leaks.mjs` (the CI job "Scan built client assets and
 * runtime credentials") flags `whsec_` or `sk_(live|test)_` followed by 16 or
 * more ALPHANUMERIC characters. Every fake secret in this file therefore keeps
 * its alphanumeric run short, exactly as the existing `whsec_deadbeefcafe` /
 * `sk_test_abcd1234` fixtures below already do. Do not inline a longer literal:
 * it fails that CI job rather than merely looking unsafe.
 */
const MOCK_WEBHOOK_SECRET = 'whsec_test_placeholder';
const FAKE_LIVE_KEY_TAIL = 'SUPERSECRET';
const FAKE_LIVE_KEY = `sk_live_${FAKE_LIVE_KEY_TAIL}`;

const WEBHOOK_HOST = 'isla-nail-studio-git-pilot-i-abc123-sniperstopsnipings-projects.vercel.app';
const WEBHOOK_URL
  = `https://${WEBHOOK_HOST}/api/webhooks/stripe-billing?x-vercel-protection-bypass=TOKEN`;

function makePlan(overrides: { webhookUrl?: string | null; includePortal?: boolean } = {}): ProvisionPlan {
  return buildProvisionPlan({
    env: 'test',
    catalogue,
    apiVersion: API_VERSION,
    webhookUrl: overrides.webhookUrl === undefined ? null : overrides.webhookUrl,
    includePortal: overrides.includePortal ?? false,
  });
}

// ---------------------------------------------------------------------------
// Mock Stripe client
// ---------------------------------------------------------------------------

type MockState = {
  accountLivemode: boolean;
  products: Map<string, Stripe.Product>;
  prices: Stripe.Price[];
  coupons: Map<string, Stripe.Coupon>;
  webhookEndpoints: Stripe.WebhookEndpoint[];
  portalConfigurations: Stripe.BillingPortal.Configuration[];
};

type MockClient = ProvisionStripeClient & {
  calls: string[];
  state: MockState;
  /**
   * Every Idempotency-Key this client was handed, so a test can prove the
   * webhook url (which carries the bypass token) is never one.
   */
  idempotencyKeys: string[];
};

function resourceMissing(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = 'resource_missing';
  return error;
}

function makePrice(partial: Partial<Stripe.Price> & { id: string }): Stripe.Price {
  return {
    id: partial.id,
    object: 'price',
    active: partial.active ?? true,
    billing_scheme: 'per_unit',
    created: 0,
    currency: partial.currency ?? 'cad',
    custom_unit_amount: null,
    livemode: partial.livemode ?? false,
    lookup_key: partial.lookup_key ?? null,
    metadata: partial.metadata ?? {},
    nickname: partial.nickname ?? null,
    product: partial.product ?? 'prod_x',
    recurring: partial.recurring ?? null,
    tax_behavior: partial.tax_behavior ?? 'exclusive',
    tiers_mode: null,
    transform_quantity: null,
    type: partial.type ?? 'one_time',
    unit_amount: partial.unit_amount ?? null,
    unit_amount_decimal: null,
  } as Stripe.Price;
}

function makeCoupon(partial: Partial<Stripe.Coupon> & { id: string }): Stripe.Coupon {
  return {
    id: partial.id,
    object: 'coupon',
    amount_off: null,
    created: 0,
    currency: null,
    duration: partial.duration ?? 'once',
    duration_in_months: null,
    livemode: partial.livemode ?? false,
    max_redemptions: partial.max_redemptions ?? null,
    metadata: partial.metadata ?? {},
    name: partial.name ?? null,
    percent_off: partial.percent_off ?? 40,
    redeem_by: partial.redeem_by ?? null,
    times_redeemed: 0,
    valid: partial.valid ?? true,
    applies_to: partial.applies_to,
  } as Stripe.Coupon;
}

function makePortalConfiguration(
  partial: Partial<Stripe.BillingPortal.Configuration> & { id: string },
): Stripe.BillingPortal.Configuration {
  return {
    id: partial.id,
    object: 'billing_portal.configuration',
    active: true,
    application: null,
    business_profile: partial.business_profile ?? {
      headline: null,
      privacy_policy_url: null,
      terms_of_service_url: null,
    },
    created: 0,
    default_return_url: null,
    features: partial.features ?? {
      customer_update: { enabled: false, allowed_updates: [] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        proration_behavior: 'none',
        cancellation_reason: { enabled: false, options: [] },
      },
      subscription_update: { enabled: false, default_allowed_updates: [], products: null, proration_behavior: 'none' },
    },
    is_default: partial.is_default ?? false,
    livemode: partial.livemode ?? false,
    login_page: { enabled: false, url: null },
    metadata: partial.metadata ?? {},
    updated: 0,
  } as Stripe.BillingPortal.Configuration;
}

function makeMockClient(initial: Partial<MockState> = {}): MockClient {
  const state: MockState = {
    accountLivemode: initial.accountLivemode ?? false,
    products: initial.products ?? new Map(),
    prices: initial.prices ?? [],
    coupons: initial.coupons ?? new Map(),
    webhookEndpoints: initial.webhookEndpoints ?? [],
    portalConfigurations: initial.portalConfigurations ?? [],
  };
  const calls: string[] = [];
  const idempotencyKeys: string[] = [];
  let sequence = 0;
  const nextId = (prefix: string): string => {
    sequence += 1;
    return `${prefix}_mock${String(sequence).padStart(8, '0')}`;
  };

  const client: MockClient = {
    calls,
    state,
    idempotencyKeys,
    accounts: {
      retrieve: async () => {
        calls.push('accounts.retrieve');
        return {
          id: 'acct_mock',
          object: 'account',
          livemode: state.accountLivemode,
        } as unknown as Stripe.Account;
      },
    },
    products: {
      list: async (params) => {
        calls.push('products.list');
        return { data: [...state.products.values()].slice(0, params.limit ?? 10), has_more: false };
      },
      retrieve: async (id) => {
        calls.push(`products.retrieve:${id}`);
        const found = state.products.get(id);
        if (found === undefined) {
          throw resourceMissing(`No such product: ${id}`);
        }
        return found;
      },
      create: async (params) => {
        calls.push(`products.create:${String(params.id)}`);
        const created = {
          id: String(params.id),
          object: 'product',
          active: true,
          livemode: false,
          name: params.name,
          description: params.description ?? null,
          metadata: params.metadata ?? {},
        } as Stripe.Product;
        state.products.set(created.id, created);
        return created;
      },
      update: async (id, params) => {
        calls.push(`products.update:${id}`);
        const existing = state.products.get(id) as Stripe.Product;
        const updated = { ...existing, ...params } as Stripe.Product;
        state.products.set(id, updated);
        return updated;
      },
    },
    prices: {
      list: async (params) => {
        calls.push(`prices.list:${String(params.product)}`);
        if (params.product === undefined) {
          // The account-wide mode probe.
          return { data: state.prices.slice(0, params.limit ?? 10), has_more: false };
        }
        if (!state.products.has(String(params.product))) {
          throw resourceMissing(`No such product: ${String(params.product)}`);
        }
        return {
          data: state.prices.filter(price => price.product === params.product),
          has_more: false,
        };
      },
      retrieve: async (id) => {
        calls.push(`prices.retrieve:${id}`);
        const found = state.prices.find(price => price.id === id);
        if (found === undefined) {
          throw resourceMissing(`No such price: ${id}`);
        }
        return found;
      },
      create: async (params, options) => {
        calls.push(`prices.create:${String(params.lookup_key)}`);
        if (options?.idempotencyKey !== undefined) {
          idempotencyKeys.push(options.idempotencyKey);
        }
        const created = makePrice({
          id: nextId('price'),
          active: params.active ?? true,
          currency: params.currency,
          lookup_key: params.lookup_key ?? null,
          metadata: (params.metadata ?? {}) as Stripe.Metadata,
          nickname: params.nickname ?? null,
          product: String(params.product),
          recurring: params.recurring === undefined
            ? null
            : ({
                interval: params.recurring.interval,
                interval_count: params.recurring.interval_count ?? 1,
              } as Stripe.Price.Recurring),
          tax_behavior: params.tax_behavior as Stripe.Price.TaxBehavior,
          type: params.recurring === undefined ? 'one_time' : 'recurring',
          unit_amount: params.unit_amount ?? null,
        });
        state.prices.push(created);
        return created;
      },
      update: async (id, params) => {
        calls.push(`prices.update:${id}`);
        const index = state.prices.findIndex(price => price.id === id);
        const updated = { ...state.prices[index], ...params } as Stripe.Price;
        state.prices[index] = updated;
        return updated;
      },
    },
    coupons: {
      list: async (params) => {
        calls.push('coupons.list');
        return { data: [...state.coupons.values()].slice(0, params.limit ?? 10), has_more: false };
      },
      retrieve: async (id) => {
        calls.push(`coupons.retrieve:${id}`);
        const found = state.coupons.get(id);
        if (found === undefined) {
          throw resourceMissing(`No such coupon: ${id}`);
        }
        return found;
      },
      create: async (params) => {
        calls.push(`coupons.create:${String(params.id)}`);
        const created = makeCoupon({
          id: String(params.id),
          percent_off: params.percent_off,
          duration: params.duration as Stripe.Coupon.Duration,
          name: params.name ?? null,
          metadata: (params.metadata ?? {}) as Stripe.Metadata,
        });
        state.coupons.set(created.id, created);
        return created;
      },
      update: async (id, params) => {
        calls.push(`coupons.update:${id}`);
        const existing = state.coupons.get(id) as Stripe.Coupon;
        const updated = {
          ...existing,
          metadata: (params.metadata ?? existing.metadata) as Stripe.Metadata,
        } as Stripe.Coupon;
        state.coupons.set(id, updated);
        return updated;
      },
    },
    webhookEndpoints: {
      list: async () => {
        calls.push('webhookEndpoints.list');
        return { data: state.webhookEndpoints, has_more: false };
      },
      create: async (params, options) => {
        calls.push('webhookEndpoints.create');
        if (options?.idempotencyKey !== undefined) {
          idempotencyKeys.push(options.idempotencyKey);
        }
        const created = {
          id: nextId('we'),
          object: 'webhook_endpoint',
          api_version: params.api_version ?? null,
          created: 0,
          description: params.description ?? null,
          enabled_events: params.enabled_events,
          livemode: false,
          metadata: params.metadata ?? {},
          secret: MOCK_WEBHOOK_SECRET,
          status: 'enabled',
          url: params.url,
        } as unknown as Stripe.WebhookEndpoint;
        state.webhookEndpoints.push(created);
        return created;
      },
      update: async (id, params) => {
        calls.push(`webhookEndpoints.update:${id}`);
        const index = state.webhookEndpoints.findIndex(endpoint => endpoint.id === id);
        const updated = { ...state.webhookEndpoints[index], ...params } as Stripe.WebhookEndpoint;
        state.webhookEndpoints[index] = updated;
        return updated;
      },
    },
    billingPortal: {
      configurations: {
        list: async () => {
          calls.push('billingPortal.configurations.list');
          return { data: state.portalConfigurations, has_more: false };
        },
        retrieve: async (id) => {
          calls.push(`billingPortal.configurations.retrieve:${id}`);
          return state.portalConfigurations.find(
            configuration => configuration.id === id,
          ) as Stripe.BillingPortal.Configuration;
        },
        create: async (params) => {
          calls.push('billingPortal.configurations.create');
          const created = makePortalConfiguration({
            id: nextId('bpc'),
            business_profile: {
              headline: params.business_profile?.headline ?? null,
              privacy_policy_url: null,
              terms_of_service_url: null,
            },
            metadata: (params.metadata ?? {}) as Stripe.Metadata,
            is_default: false,
          });
          state.portalConfigurations.push(created);
          return created;
        },
        update: async (id, params) => {
          calls.push(`billingPortal.configurations.update:${id}`);
          const index = state.portalConfigurations.findIndex(configuration => configuration.id === id);
          const updated = {
            ...state.portalConfigurations[index],
            metadata: (params.metadata ?? {}) as Stripe.Metadata,
          } as Stripe.BillingPortal.Configuration;
          state.portalConfigurations[index] = updated;
          return updated;
        },
      },
    },
  };

  return client;
}

/** The exact object graph an already-provisioned, correct test account holds. */
function seedProvisionedState(): MockState {
  const plan = makePlan();
  const products = new Map<string, Stripe.Product>();
  for (const product of plan.products) {
    products.set(product.id, {
      id: product.id,
      object: 'product',
      active: true,
      livemode: false,
      name: product.name,
      description: product.description,
      metadata: product.metadata,
    } as Stripe.Product);
  }
  const prices = plan.prices.map((planned, index) => makePrice({
    id: `price_seed${String(index).padStart(8, '0')}`,
    active: true,
    currency: 'cad',
    lookup_key: planned.lookupKey,
    metadata: planned.metadata as Stripe.Metadata,
    nickname: planned.nickname,
    product: planned.productId,
    recurring: planned.recurring === null
      ? null
      : ({ interval: planned.recurring.interval, interval_count: 1 } as Stripe.Price.Recurring),
    tax_behavior: 'exclusive',
    type: planned.recurring === null ? 'one_time' : 'recurring',
    unit_amount: planned.unitAmount,
  }));
  const coupons = new Map<string, Stripe.Coupon>();
  // Carries our metadata, because this represents an account THIS SCRIPT
  // provisioned. An unstamped 40%/once coupon is a collision, not a reuse.
  coupons.set(plan.coupon.id, makeCoupon({
    id: plan.coupon.id,
    metadata: plan.coupon.metadata as Stripe.Metadata,
  }));

  return {
    accountLivemode: false,
    products,
    prices,
    coupons,
    webhookEndpoints: [],
    portalConfigurations: [],
  };
}

function carrierFromState(state: MockState): Carrier {
  const carrier: Carrier = { env: 'test', offers: {}, topups: {}, coupons: {} };
  for (const price of state.prices) {
    const key = (price.metadata as Stripe.Metadata).luster_key as string;
    const section = (price.metadata as Stripe.Metadata).luster_catalog_section as 'offers' | 'topups';
    carrier[section][key] = price.id;
  }
  carrier.coupons.founding_annual_2026 = [...state.coupons.keys()][0] as string;
  return carrier;
}

// ---------------------------------------------------------------------------

describe('argument parsing', () => {
  it('defaults to a dry run when no mode flag is given', () => {
    expect(parseArguments([]).mode).toBe('plan');
  });

  it('accepts --plan, --apply and --verify', () => {
    expect(parseArguments(['--plan']).mode).toBe('plan');
    expect(parseArguments(['--apply', '--carrier-out', '/tmp/x.json']).mode).toBe('apply');
    expect(parseArguments(['--verify', '--carrier', '/tmp/x.json']).mode).toBe('verify');
  });

  it('refuses two mode flags at once', () => {
    expect(() => parseArguments(['--apply', '--verify'])).toThrow(/mutually exclusive/);
  });

  it('refuses --apply without --carrier-out', () => {
    expect(() => parseArguments(['--apply'])).toThrow(/--carrier-out/);
  });

  it('refuses --verify without --carrier', () => {
    expect(() => parseArguments(['--verify'])).toThrow(/--carrier/);
  });

  it('refuses --apply --create-webhook with nowhere to put the signing secret', () => {
    expect(() => parseArguments([
      '--apply',
      '--carrier-out',
      '/tmp/x.json',
      '--webhook-url',
      WEBHOOK_URL,
      '--allow-host',
      WEBHOOK_HOST,
      '--create-webhook',
    ])).toThrow(/--webhook-secret-out/);
  });

  it('accepts --webhook-url once a host and a secret sink are given', () => {
    const parsed = parseArguments([
      '--apply',
      '--carrier-out',
      '/tmp/x.json',
      '--webhook-url',
      WEBHOOK_URL,
      '--allow-host',
      WEBHOOK_HOST,
      '--create-webhook',
      '--webhook-secret-out',
      '/tmp/whsec.txt',
    ]);

    expect(parsed.webhookUrl).toBe(WEBHOOK_URL);
    expect(parsed.allowHost).toBe(WEBHOOK_HOST);
    expect(parsed.createWebhook).toBe(true);
    expect(parsed.printWebhookSecret).toBe(false);
  });

  it('rejects unknown flags and positional arguments', () => {
    expect(() => parseArguments(['--wat'])).toThrow(/Unknown flag/);
    expect(() => parseArguments(['oops'])).toThrow(/positional/);
  });

  it('rejects a value flag with no value', () => {
    expect(() => parseArguments(['--carrier-out', '--apply'])).toThrow(/requires a value/);
  });
});

describe('safety gates', () => {
  it('accepts sk_test_ and rk_test_ and reports only the prefix', () => {
    expect(checkSecretKeyMode('sk_test_abcdef')).toEqual({ ok: true, prefix: 'sk_test_' });
    expect(checkSecretKeyMode('rk_test_abcdef')).toEqual({ ok: true, prefix: 'rk_test_' });
  });

  it('refuses live keys, bare prefixes, whitespace and absence', () => {
    expect(checkSecretKeyMode('sk_live_abcdef').ok).toBe(false);
    expect(checkSecretKeyMode('rk_live_abcdef').ok).toBe(false);
    expect(checkSecretKeyMode('sk_test_').ok).toBe(false);
    expect(checkSecretKeyMode(' sk_test_abcdef ').ok).toBe(false);
    expect(checkSecretKeyMode(undefined).ok).toBe(false);
    expect(checkSecretKeyMode('').ok).toBe(false);
  });

  it('never echoes the key material in a refusal', () => {
    const result = checkSecretKeyMode(FAKE_LIVE_KEY);

    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.reason : '').not.toContain(FAKE_LIVE_KEY_TAIL);
  });

  it('redacts every secret-shaped token before it is emitted', () => {
    const redacted = redactSecrets('Invalid API Key provided: sk_test_abcd1234 and whsec_deadbeefcafe');

    expect(redacted).not.toContain('abcd1234');
    expect(redacted).not.toContain('deadbeefcafe');
    expect(redacted).toContain('[redacted]');
    expect(redactSecrets('rk_live_0123456789abcdef')).toBe('[redacted]');
  });

  it('leaves the bare key prefixes legible so refusal messages stay useful', () => {
    expect(redactSecrets('must start with sk_test_ or rk_test_'))
      .toBe('must start with sk_test_ or rk_test_');
  });

  it('refuses an output path inside the repository worktree', () => {
    expect(() => assertOutputPathOutsideRepository(
      path.join(repositoryRoot, 'carrier.json'),
      repositoryRoot,
      '--carrier-out',
    )).toThrow(/inside the git worktree/);
    expect(() => assertOutputPathOutsideRepository(
      path.join(repositoryRoot, 'scripts', '..', 'src', 'carrier.json'),
      repositoryRoot,
      '--carrier-out',
    )).toThrow(/inside the git worktree/);
  });

  it('accepts an output path outside the repository worktree', () => {
    const resolved = assertOutputPathOutsideRepository(
      '/var/tmp/luster/carrier-test.json',
      repositoryRoot,
      '--carrier-out',
    );

    // The gate now resolves symlinks, so the answer is the REAL path: on macOS
    // /var is itself a link to /private/var. That is the point of the change —
    // a path that only looks outside the worktree no longer passes.
    expect(resolved).toBe(`${fs.realpathSync('/var/tmp')}/luster/carrier-test.json`);
  });

  it('requires https and the exact billing webhook pathname', () => {
    expect(validateWebhookUrl(WEBHOOK_URL)).toBe(WEBHOOK_URL);
    expect(() => validateWebhookUrl('http://x.test/api/webhooks/stripe-billing')).toThrow(/https/);
    expect(() => validateWebhookUrl('https://x.test/api/webhooks/stripe')).toThrow(/pathname/);
    expect(() => validateWebhookUrl('not a url')).toThrow(/valid URL/);
  });

  it('returns the webhook url byte-for-byte, never a normalised copy', () => {
    const awkward = 'https://x.test/api/webhooks/stripe-billing?x-vercel-protection-bypass=a%2Bb~c';

    expect(validateWebhookUrl(awkward)).toBe(awkward);
  });
});

describe('source-of-truth extraction', () => {
  it('extracts EXPECTED_STRIPE_API_VERSION from the real src/libs/stripe.ts', () => {
    const source = fs.readFileSync(path.join(repositoryRoot, 'src', 'libs', 'stripe.ts'), 'utf8');

    expect(extractExpectedStripeApiVersion(source)).toBe('2024-06-20');
  });

  it('returns null rather than guessing when the literal is gone', () => {
    expect(extractExpectedStripeApiVersion('export const SOMETHING_ELSE = 1;')).toBeNull();
  });

  it('confirms the duplicated id regex still matches the canonical one', () => {
    const source = fs.readFileSync(
      path.join(repositoryRoot, 'src', 'libs', 'billing', 'stripePriceCarrier.ts'),
      'utf8',
    );

    expect(canonicalIdShapeMatches(source)).toBe(true);
    expect(source).toContain(CANONICAL_STRIPE_ID_SHAPE_SOURCE);
  });

  it('flags drift when the canonical line changes', () => {
    expect(canonicalIdShapeMatches('return /^price_.+$/.test(value);')).toBe(false);
  });

  it('applies the same id shape as the canonical checker', () => {
    expect(isConfiguredStripeId('price_1AbCdEfGhIjK')).toBe(true);
    expect(isConfiguredStripeId('coupon_lusterfoundingannual2026test')).toBe(true);
    expect(isConfiguredStripeId('coupon_founding_annual_2026')).toBe(false);
    expect(isConfiguredStripeId('IMlbfWKM')).toBe(false);
    expect(isConfiguredStripeId('price_123')).toBe(false);
    expect(isConfiguredStripeId(null)).toBe(false);
  });
});

describe('plan construction against the committed catalogue', () => {
  it('plans four Products: three plans plus one top-up Product', () => {
    const plan = makePlan();

    expect(plan.products.map(product => product.id)).toEqual([
      'luster_test_plan_elite_2026_08',
      'luster_test_plan_pro_2026_08',
      'luster_test_plan_starter_2026_08',
      'luster_test_topups_2026_08',
    ]);
    expect(plan.products.every(product => product.metadata.luster_catalog === CATALOG_MARKER)).toBe(true);
    expect(plan.products.every(product => product.metadata.luster_plan_env === 'test')).toBe(true);
  });

  it('plans exactly six recurring Prices at the committed amounts and intervals', () => {
    const plan = makePlan();
    const offers = plan.prices.filter(price => price.section === 'offers');
    const byKey = new Map(offers.map(price => [price.key, price]));

    expect(offers).toHaveLength(6);
    expect(byKey.get('starter_2026_08_monthly')?.unitAmount).toBe(1499);
    expect(byKey.get('starter_2026_08_annual')?.unitAmount).toBe(14990);
    expect(byKey.get('pro_2026_08_monthly')?.unitAmount).toBe(2499);
    expect(byKey.get('pro_2026_08_annual')?.unitAmount).toBe(24990);
    expect(byKey.get('elite_2026_08_monthly')?.unitAmount).toBe(4499);
    expect(byKey.get('elite_2026_08_annual')?.unitAmount).toBe(44990);
    expect(byKey.get('starter_2026_08_monthly')?.recurring).toEqual({ interval: 'month', interval_count: 1 });
    expect(byKey.get('elite_2026_08_annual')?.recurring).toEqual({ interval: 'year', interval_count: 1 });
  });

  it('plans exactly seven one-time Prices with NO recurring block', () => {
    const plan = makePlan();
    const topups = plan.prices.filter(price => price.section === 'topups');
    const byKey = new Map(topups.map(price => [price.key, price]));

    expect(topups).toHaveLength(7);
    expect(topups.every(price => price.recurring === null)).toBe(true);
    expect(topups.every(price => price.productId === 'luster_test_topups_2026_08')).toBe(true);
    expect(byKey.get('topup_100_free_2026_08')?.unitAmount).toBe(699);
    expect(byKey.get('topup_250_free_2026_08')?.unitAmount).toBe(1599);
    expect(byKey.get('topup_500_free_2026_08')?.unitAmount).toBe(2999);
    expect(byKey.get('topup_100_paid_2026_08')?.unitAmount).toBe(599);
    expect(byKey.get('topup_250_paid_2026_08')?.unitAmount).toBe(1399);
    expect(byKey.get('topup_500_paid_2026_08')?.unitAmount).toBe(2699);
    expect(byKey.get('topup_1000_paid_2026_08')?.unitAmount).toBe(4999);
  });

  it('gives every Price cad, exclusive tax behaviour and an env-scoped lookup key', () => {
    const plan = makePlan();

    expect(plan.prices.every(price => price.currency === 'cad')).toBe(true);
    expect(plan.prices.every(price => price.taxBehavior === 'exclusive')).toBe(true);
    expect(plan.prices.every(price => price.lookupKey === `luster_test_${price.key}`)).toBe(true);
    expect(plan.prices.every(price => price.metadata.luster_key === price.key)).toBe(true);
  });

  it('keeps dev and test object handles apart', () => {
    const devPlan = buildProvisionPlan({
      env: 'dev',
      catalogue,
      apiVersion: API_VERSION,
      webhookUrl: null,
      includePortal: false,
    });

    expect(planProductId('dev', 'starter_2026_08')).toBe('luster_dev_plan_starter_2026_08');
    expect(topupProductId('dev')).toBe('luster_dev_topups_2026_08');
    expect(couponId('dev')).not.toBe(couponId('test'));
    expect(devPlan.prices.every(price => price.lookupKey.startsWith('luster_dev_'))).toBe(true);
  });

  it('plans a coupon whose custom id satisfies the carrier regex', () => {
    const plan = makePlan();

    expect(plan.coupon.id).toBe('coupon_lusterfoundingannual2026test');
    expect(isConfiguredStripeId(plan.coupon.id)).toBe(true);
    expect(plan.coupon.percentOff).toBe(40);
    expect(plan.coupon.duration).toBe('once');
    expect(plan.coupon.name).toBe('Founding annual (40% off, first term)');
  });

  it('plans the webhook endpoint with exactly the 13 handled event types', () => {
    const plan = makePlan({ webhookUrl: WEBHOOK_URL });

    expect(plan.webhook?.enabledEvents).toHaveLength(13);
    expect(new Set(plan.webhook?.enabledEvents)).toEqual(new Set(BILLING_WEBHOOK_HANDLED_TYPES));
    expect(plan.webhook?.apiVersion).toBe('2024-06-20');
    expect(plan.webhook?.url).toBe(WEBHOOK_URL);
  });

  it('plans the D16 portal feature set with cancellation pinned to at_period_end', () => {
    const plan = makePlan({ includePortal: true });
    const features = plan.portal?.features;

    expect(features?.subscription_update).toEqual({
      enabled: false,
      default_allowed_updates: [],
      products: null,
    });
    expect(features?.customer_update).toEqual({ enabled: false, allowed_updates: [] });
    expect(features?.subscription_cancel).toEqual({
      enabled: true,
      mode: 'at_period_end',
      proration_behavior: 'none',
    });
    expect(features?.payment_method_update).toEqual({ enabled: true });
    expect(features?.invoice_history).toEqual({ enabled: true });
    expect(plan.portal?.businessProfile.headline).toBe('Manage your Luster billing');
  });

  it('omits the portal plan unless --portal is passed', () => {
    expect(makePlan().portal).toBeNull();
  });

  it('never models subscription_pause, which stripe@16.12.0 does not support', () => {
    const plan = makePlan({ includePortal: true });

    expect(Object.keys(plan.portal?.features ?? {})).not.toContain('subscription_pause');
  });

  it('builds a stable, versioned idempotency key', () => {
    expect(idempotencyKeyFor('test', 'price', 'pro_2026_08_annual'))
      .toBe('luster-provision-test-price-pro_2026_08_annual-v1');
  });
});

describe('founding promotion math', () => {
  it('reproduces the runbook first-term amounts from live values', () => {
    expect(computeFoundingFirstTermCents(14990, 40)).toBe(8994);
    expect(computeFoundingFirstTermCents(24990, 40)).toBe(14994);
    expect(computeFoundingFirstTermCents(44990, 40)).toBe(26994);
  });

  it('refuses the contract-rejected 50% variant amounts', () => {
    expect(computeFoundingFirstTermCents(14990, 50)).not.toBe(8994);
  });

  it('throws rather than emit fractional cents', () => {
    expect(() => computeFoundingFirstTermCents(1499, 33)).toThrow(/integer-exact/);
  });
});

describe('carrier assembly and self-validation', () => {
  it('accepts a complete, distinct, env-matched carrier', () => {
    const state = seedProvisionedState();

    expect(validateCarrier(carrierFromState(state), 'test', catalogue)).toEqual([]);
  });

  it('produces a 6/7/1 carrier from resolved ids', () => {
    const resolved = new Map<string, { section: 'offers' | 'topups'; id: string }>();
    makePlan().prices.forEach((price, index) => {
      resolved.set(price.key, { section: price.section, id: `price_res${String(index).padStart(8, '0')}` });
    });
    const carrier = buildCarrier('test', resolved, 'coupon_lusterfoundingannual2026test', 'founding_annual_2026');

    expect(Object.keys(carrier.offers)).toHaveLength(6);
    expect(Object.keys(carrier.topups)).toHaveLength(7);
    expect(Object.keys(carrier.coupons)).toEqual(['founding_annual_2026']);
    expect(validateCarrier(carrier, 'test', catalogue)).toEqual([]);
  });

  it('rejects an env mismatch', () => {
    const carrier = carrierFromState(seedProvisionedState());
    carrier.env = 'prod';

    expect(validateCarrier(carrier, 'test', catalogue).join(' ')).toContain('ENV_MISMATCH');
  });

  it('rejects an unknown key', () => {
    const carrier = carrierFromState(seedProvisionedState());
    carrier.offers.not_a_real_offer = 'price_aaaaaaaaaa';

    expect(validateCarrier(carrier, 'test', catalogue).join(' ')).toContain('UNKNOWN_KEY');
  });

  it('rejects an id that fails the shape check', () => {
    const carrier = carrierFromState(seedProvisionedState());
    carrier.offers.pro_2026_08_annual = 'IMlbfWKM';

    expect(validateCarrier(carrier, 'test', catalogue).join(' ')).toContain('INVALID_ID');
  });

  it('rejects an id repeated across two sections', () => {
    const carrier = carrierFromState(seedProvisionedState());
    carrier.topups.topup_100_free_2026_08 = carrier.offers.pro_2026_08_annual as string;

    expect(validateCarrier(carrier, 'test', catalogue).join(' ')).toContain('DUPLICATE_ID');
  });

  it('rejects a short carrier that the live parser would happily accept', () => {
    const carrier = carrierFromState(seedProvisionedState());
    delete carrier.topups.topup_1000_paid_2026_08;
    const failures = validateCarrier(carrier, 'test', catalogue).join(' ');

    expect(failures).toContain('topup_1000_paid_2026_08');
    expect(failures).toContain('expected exactly 7');
  });

  it('rejects a section supplied as an array', () => {
    const carrier = carrierFromState(seedProvisionedState());
    (carrier as unknown as { offers: unknown }).offers = [];

    expect(validateCarrier(carrier, 'test', catalogue).join(' ')).toContain('never an array');
  });
});

describe('immutable price fields', () => {
  const plannedAnnual = makePlan().prices.find(
    price => price.key === 'pro_2026_08_annual',
  ) as PlannedPrice;

  function matchingPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
    return makePrice({
      id: 'price_existing0001',
      product: plannedAnnual.productId,
      unit_amount: plannedAnnual.unitAmount,
      currency: 'cad',
      type: 'recurring',
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price.Recurring,
      tax_behavior: 'exclusive',
      ...overrides,
    });
  }

  it('reports no mismatch for a correct Price', () => {
    expect(findImmutablePriceMismatches(plannedAnnual, matchingPrice())).toEqual([]);
  });

  it('catches a wrong amount', () => {
    const mismatches = findImmutablePriceMismatches(plannedAnnual, matchingPrice({ unit_amount: 24999 }));

    expect(mismatches).toEqual([{ field: 'unit_amount', expected: '24990', actual: '24999' }]);
  });

  it('catches a wrong interval, a wrong currency and a wrong product', () => {
    const mismatches = findImmutablePriceMismatches(plannedAnnual, matchingPrice({
      currency: 'usd',
      product: 'prod_someone_elses',
      recurring: { interval: 'month', interval_count: 1 } as Stripe.Price.Recurring,
    }));

    expect(mismatches.map(mismatch => mismatch.field)).toEqual(['currency', 'product', 'recurring.interval']);
  });

  it('catches an inclusive tax behaviour, which Stripe cannot change back', () => {
    const mismatches = findImmutablePriceMismatches(plannedAnnual, matchingPrice({ tax_behavior: 'inclusive' }));

    expect(mismatches).toEqual([{ field: 'tax_behavior', expected: 'exclusive', actual: 'inclusive' }]);
  });

  it('catches a recurring block on a planned one-time top-up Price', () => {
    const plannedTopup = makePlan().prices.find(
      price => price.key === 'topup_500_paid_2026_08',
    ) as PlannedPrice;
    const mismatches = findImmutablePriceMismatches(plannedTopup, makePrice({
      id: 'price_topup0001',
      product: plannedTopup.productId,
      unit_amount: plannedTopup.unitAmount,
      type: 'recurring',
      recurring: { interval: 'month', interval_count: 1 } as Stripe.Price.Recurring,
    }));

    expect(mismatches.map(mismatch => mismatch.field)).toEqual(['type']);
  });

  it('does not treat an inactive-but-correct Price as a mismatch', () => {
    expect(findImmutablePriceMismatches(plannedAnnual, matchingPrice({ active: false }))).toEqual([]);
  });
});

describe('runProvision — dry run', () => {
  it('writes nothing to Stripe on an empty account', async () => {
    const client = makeMockClient();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL, includePortal: true }), {
      mode: 'plan',
      adoptDefault: false,
      createWebhook: true,
    });
    writeSpy.mockRestore();
    const mutations = client.calls.filter(call => /\.(?:create|update)/.test(call));

    expect(mutations).toEqual([]);
    expect(client.state.prices).toEqual([]);
    expect(client.state.coupons.size).toBe(0);
    expect(client.state.webhookEndpoints).toEqual([]);
  });
});

describe('runProvision — apply', () => {
  it('creates 4 Products, 13 Prices, 1 Coupon and 1 webhook endpoint', async () => {
    const client = makeMockClient();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result = await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
    });
    writeSpy.mockRestore();

    expect(client.state.products.size).toBe(4);
    expect(client.state.prices).toHaveLength(13);
    expect(client.state.coupons.size).toBe(1);
    expect(client.state.webhookEndpoints).toHaveLength(1);
    expect(result.priceIds.size).toBe(13);
    expect(result.couponStripeId).toBe('coupon_lusterfoundingannual2026test');
    expect(result.webhookSecret).toBe(MOCK_WEBHOOK_SECRET);
  });

  it('creates the webhook endpoint LAST, after every Price exists', async () => {
    const client = makeMockClient();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
    });
    writeSpy.mockRestore();
    const webhookIndex = client.calls.indexOf('webhookEndpoints.create');
    const lastPriceIndex = client.calls.map((call, index) => (call.startsWith('prices.create') ? index : -1))
      .reduce((max, index) => Math.max(max, index), -1);

    expect(webhookIndex).toBeGreaterThan(lastPriceIndex);
  });

  it('is idempotent: a second apply creates nothing new', async () => {
    const client = makeMockClient(seedProvisionedState());
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result = await runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false });
    writeSpy.mockRestore();

    expect(client.calls.filter(call => call.startsWith('prices.create'))).toEqual([]);
    expect(client.calls.filter(call => call.startsWith('products.create'))).toEqual([]);
    expect(client.calls.filter(call => call.startsWith('coupons.create'))).toEqual([]);
    expect(client.state.prices).toHaveLength(13);
    expect(result.priceIds.size).toBe(13);
  });

  it('reactivates an archived but otherwise correct Price instead of recreating it', async () => {
    const state = seedProvisionedState();
    const target = state.prices.find(
      price => (price.metadata as Stripe.Metadata).luster_key === 'pro_2026_08_monthly',
    ) as Stripe.Price;
    (target as { active: boolean }).active = false;
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false });
    writeSpy.mockRestore();
    const after = client.state.prices.find(price => price.id === target.id) as Stripe.Price;

    expect(client.calls.filter(call => call.startsWith('prices.create'))).toEqual([]);
    expect(after.active).toBe(true);
    expect(client.state.prices).toHaveLength(13);
  });

  it('REFUSES a wrong-amount Price rather than duplicating or archiving it', async () => {
    const state = seedProvisionedState();
    const target = state.prices.find(
      price => (price.metadata as Stripe.Metadata).luster_key === 'elite_2026_08_annual',
    ) as Stripe.Price;
    (target as { unit_amount: number }).unit_amount = 39990;
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(/expected 44990, actual 39990/);

    writeSpy.mockRestore();

    expect(client.calls.filter(call => call.startsWith('prices.create'))).toEqual([]);
    expect(client.state.prices).toHaveLength(13);
  });

  it('REFUSES an existing coupon whose percent_off disagrees', async () => {
    const state = seedProvisionedState();
    const plan = makePlan();
    state.coupons.set(plan.coupon.id, makeCoupon({ id: plan.coupon.id, percent_off: 50 }));
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, plan, { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(/percent_off=50/);

    writeSpy.mockRestore();
  });

  it('REFUSES a foreign Product occupying one of our deterministic ids', async () => {
    const state = seedProvisionedState();
    state.products.set('luster_test_plan_pro_2026_08', {
      id: 'luster_test_plan_pro_2026_08',
      object: 'product',
      active: true,
      livemode: false,
      name: 'Someone else',
      metadata: {},
    } as Stripe.Product);
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(/not ours/);

    writeSpy.mockRestore();
  });

  it('REFUSES when an account-wide sampled object reports livemode=true', async () => {
    // The Stripe Account object carries no `livemode` field, so the mode probe
    // samples one real object instead. A live-mode Price must stop the run even
    // when the account read itself looks innocent.
    const state = seedProvisionedState();
    (state.prices[0] as { livemode: boolean }).livemode = true;
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(/sampled account object reports livemode=true/);

    writeSpy.mockRestore();

    expect(client.calls.filter(call => /\.(?:create|update)/.test(call))).toEqual([]);
  });

  it('REFUSES a livemode account outright', async () => {
    const client = makeMockClient({ accountLivemode: true });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), { mode: 'plan', adoptDefault: false }))
      .rejects.toThrow(/livemode=true/);

    writeSpy.mockRestore();
  });

  it('REFUSES a near-match webhook url whose query string differs', async () => {
    const state = seedProvisionedState();
    state.webhookEndpoints = [{
      id: 'we_existing',
      object: 'webhook_endpoint',
      api_version: '2024-06-20',
      enabled_events: [...BILLING_WEBHOOK_HANDLED_TYPES],
      livemode: false,
      metadata: {},
      status: 'enabled',
      url: 'https://isla-nail-studio-git-pilot-i-abc123-sniperstopsnipings-projects.vercel.app/api/webhooks/stripe-billing',
    } as unknown as Stripe.WebhookEndpoint];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
      // The near-match endpoint is, by definition, an endpoint at a DIFFERENT
      // url, so T3 counts it as a shared-account occupant first. Acknowledge
      // that here so the assertion below is about the url guard, not T3.
      acknowledgeSharedAccount: true,
    })).rejects.toThrow(/different\s+url string/);

    writeSpy.mockRestore();

    expect(client.calls).not.toContain('webhookEndpoints.create');
  });

  it('REFUSES an existing endpoint pinned to the wrong api_version', async () => {
    const state = seedProvisionedState();
    state.webhookEndpoints = [{
      id: 'we_existing',
      object: 'webhook_endpoint',
      api_version: '2025-03-31',
      enabled_events: [...BILLING_WEBHOOK_HANDLED_TYPES],
      livemode: false,
      metadata: OUR_WEBHOOK_METADATA,
      status: 'enabled',
      url: WEBHOOK_URL,
    } as unknown as Stripe.WebhookEndpoint];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
    })).rejects.toThrow(/api_version is fixed at creation/);

    writeSpy.mockRestore();
  });

  it('narrows an over-broad enabled_events list back to the 13 handled types', async () => {
    const state = seedProvisionedState();
    state.webhookEndpoints = [{
      id: 'we_existing',
      object: 'webhook_endpoint',
      api_version: '2024-06-20',
      enabled_events: ['*'],
      livemode: false,
      metadata: OUR_WEBHOOK_METADATA,
      status: 'enabled',
      url: WEBHOOK_URL,
    } as unknown as Stripe.WebhookEndpoint];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
    });
    writeSpy.mockRestore();

    expect(client.state.webhookEndpoints[0]?.enabled_events).toHaveLength(13);
    expect(client.calls).not.toContain('webhookEndpoints.create');
  });

  it('REFUSES a foreign default portal configuration without --adopt-default', async () => {
    const state = seedProvisionedState();
    state.portalConfigurations = [makePortalConfiguration({ id: 'bpc_legacy', is_default: true })];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan({ includePortal: true }), {
      mode: 'apply',
      adoptDefault: false,
    })).rejects.toThrow(/Pass --adopt-default/);

    writeSpy.mockRestore();

    expect(client.calls).not.toContain('billingPortal.configurations.update:bpc_legacy');
  });

  it('adopts a foreign default portal configuration when explicitly told to', async () => {
    const state = seedProvisionedState();
    state.portalConfigurations = [makePortalConfiguration({ id: 'bpc_legacy', is_default: true })];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result = await runProvision(client, makePlan({ includePortal: true }), {
      mode: 'apply',
      adoptDefault: true,
    });
    writeSpy.mockRestore();

    expect(result.portalConfigurationId).toBe('bpc_legacy');
    expect(client.calls).toContain('billingPortal.configurations.update:bpc_legacy');
  });

  it('warns loudly when a newly created portal configuration is not the default', async () => {
    const client = makeMockClient(seedProvisionedState());
    const emitted: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      emitted.push(String(chunk));
      return true;
    });
    const result = await runProvision(client, makePlan({ includePortal: true }), {
      mode: 'apply',
      adoptDefault: false,
    });
    writeSpy.mockRestore();

    expect(emitted.join('')).toContain('MANUAL STEP REQUIRED');
    expect(result.notes.some(note => note.includes('not yet the account default'))).toBe(true);
  });

  it('records the subscription_pause divergence from the runbook', async () => {
    const client = makeMockClient(seedProvisionedState());
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result = await runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false });
    writeSpy.mockRestore();

    expect(result.notes.some(note => note.includes('subscription_pause'))).toBe(true);
  });

  it('never deletes or archives anything', async () => {
    const client = makeMockClient(seedProvisionedState());
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL, includePortal: true }), {
      mode: 'apply',
      adoptDefault: true,
      createWebhook: true,
    });
    writeSpy.mockRestore();

    expect(client.calls.some(call => call.includes('del'))).toBe(false);
    expect(client.state.prices.every(price => price.active !== false)).toBe(true);
  });
});

describe('runVerify', () => {
  async function provisionedClientAndCarrier(): Promise<{ client: MockClient; carrier: Carrier }> {
    const client = makeMockClient(seedProvisionedState());
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result = await runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false });
    writeSpy.mockRestore();
    const carrier = buildCarrier('test', result.priceIds, result.couponStripeId, 'founding_annual_2026');
    return { client, carrier };
  }

  it('passes against a correctly provisioned account', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan(),
      apiVersion: API_VERSION,
      checkPortal: false,
    });
    writeSpy.mockRestore();

    expect(failures).toEqual([]);
  });

  it('makes no writes even against a fully mutable client', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    client.calls.length = 0;
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan(),
      apiVersion: API_VERSION,
      checkPortal: false,
    });
    writeSpy.mockRestore();

    expect(client.calls.filter(call => /\.(?:create|update)/.test(call))).toEqual([]);
  });

  it('fails on a drifted unit_amount, naming key, expected, actual and id', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    const target = client.state.prices.find(
      price => price.id === carrier.offers.starter_2026_08_monthly,
    ) as Stripe.Price;
    (target as { unit_amount: number }).unit_amount = 1599;
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan(),
      apiVersion: API_VERSION,
      checkPortal: false,
    });
    writeSpy.mockRestore();

    expect(failures.join('\n')).toContain('starter_2026_08_monthly: expected unit_amount=1499, actual unit_amount=1599');
    expect(failures.join('\n')).toContain(target.id);
  });

  it('fails when a top-up Price has gained a recurring block', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    const target = client.state.prices.find(
      price => price.id === carrier.topups.topup_250_paid_2026_08,
    ) as Stripe.Price;
    (target as { recurring: unknown; type: string }).recurring = { interval: 'month', interval_count: 1 };
    (target as { type: string }).type = 'recurring';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan(),
      apiVersion: API_VERSION,
      checkPortal: false,
    });
    writeSpy.mockRestore();

    expect(failures.join('\n')).toContain('type=one_time');
    expect(failures.join('\n')).toContain('recurring=null');
  });

  it('fails when the coupon drifts to 50% off', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    const coupon = client.state.coupons.get(carrier.coupons.founding_annual_2026 as string) as Stripe.Coupon;
    (coupon as { percent_off: number }).percent_off = 50;
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan(),
      apiVersion: API_VERSION,
      checkPortal: false,
    });
    writeSpy.mockRestore();

    expect(failures.join('\n')).toContain('percent_off=40');
    expect(failures.join('\n')).toContain('founding math starter_2026_08');
  });

  it('fails when the default portal configuration allows plan switching', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    client.state.portalConfigurations = [makePortalConfiguration({
      id: 'bpc_bad',
      is_default: true,
      business_profile: { headline: 'Manage your Luster billing', privacy_policy_url: null, terms_of_service_url: null },
      features: {
        customer_update: { enabled: false, allowed_updates: [] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: {
          enabled: true,
          mode: 'at_period_end',
          proration_behavior: 'none',
          cancellation_reason: { enabled: false, options: [] },
        },
        subscription_update: {
          enabled: true,
          default_allowed_updates: [],
          products: null,
          proration_behavior: 'none',
        },
      } as Stripe.BillingPortal.Configuration.Features,
    })];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan(),
      apiVersion: API_VERSION,
      checkPortal: true,
    });
    writeSpy.mockRestore();

    expect(failures.join('\n')).toContain('portal subscription_update.enabled: expected false (D16)');
  });

  it('fails when subscription_cancel would cancel immediately', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    const configuration = makePortalConfiguration({
      id: 'bpc_immediate',
      is_default: true,
      business_profile: { headline: 'Manage your Luster billing', privacy_policy_url: null, terms_of_service_url: null },
    });
    (configuration.features.subscription_cancel as { mode: string }).mode = 'immediately';
    client.state.portalConfigurations = [configuration];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan(),
      apiVersion: API_VERSION,
      checkPortal: true,
    });
    writeSpy.mockRestore();

    expect(failures.join('\n')).toContain('subscription_cancel.mode: expected at_period_end');
  });

  it('fails when no portal configuration is marked default', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    client.state.portalConfigurations = [makePortalConfiguration({ id: 'bpc_orphan', is_default: false })];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan(),
      apiVersion: API_VERSION,
      checkPortal: true,
    });
    writeSpy.mockRestore();

    expect(failures.join('\n')).toContain('no configuration is marked default');
  });

  it('fails when the webhook endpoint carries fewer than the 13 handled types', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    client.state.webhookEndpoints = [{
      id: 'we_short',
      object: 'webhook_endpoint',
      api_version: '2024-06-20',
      enabled_events: ['checkout.session.completed'],
      livemode: false,
      metadata: {},
      status: 'enabled',
      url: WEBHOOK_URL,
    } as unknown as Stripe.WebhookEndpoint];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan({ webhookUrl: WEBHOOK_URL }),
      apiVersion: API_VERSION,
      checkPortal: false,
    });
    writeSpy.mockRestore();

    expect(failures.join('\n')).toContain('webhook enabled_events');
  });

  it('fails when no endpoint matches the url string exactly', async () => {
    const { client, carrier } = await provisionedClientAndCarrier();
    client.state.webhookEndpoints = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan({ webhookUrl: WEBHOOK_URL }),
      apiVersion: API_VERSION,
      checkPortal: false,
    });
    writeSpy.mockRestore();

    expect(failures.join('\n')).toContain('string-identical to --webhook-url');
  });
});

// ---------------------------------------------------------------------------
// Regression suites for the two adversarial reviews
// ---------------------------------------------------------------------------

describe('--help and flag surface stay accurate', () => {
  it('documents every flag the parser accepts, and accepts every flag it documents', () => {
    const documented = [...USAGE.matchAll(/^\s{2}(--[a-z-]+)/gm)].map(match => match[1] as string);
    const expected = [
      '--plan',
      '--apply',
      '--verify',
      '--carrier-out',
      '--carrier',
      '--webhook-url',
      '--webhook-url-env',
      '--allow-host',
      '--create-webhook',
      '--acknowledge-shared-account',
      '--webhook-secret-out',
      '--print-webhook-secret',
      '--portal',
      '--adopt-default',
      '--adopt-existing',
      '--force',
    ];

    expect(documented).toEqual(expected);

    // Each documented flag, exercised with the companions the parser requires
    // of it — so this test proves the documented surface is also a USABLE one,
    // not merely free of unknown-flag errors.
    const standalone: Record<string, string[]> = {
      '--plan': ['--plan'],
      '--apply': ['--apply', '--carrier-out', '/tmp/x.json'],
      '--verify': ['--verify', '--carrier', '/tmp/x.json'],
    };
    const companions: Record<string, string[]> = {
      '--carrier-out': ['/tmp/x.json'],
      '--carrier': ['/tmp/x.json'],
      '--webhook-url': [WEBHOOK_URL, '--allow-host', WEBHOOK_HOST],
      '--webhook-url-env': ['PILOT_WEBHOOK_URL', '--allow-host', WEBHOOK_HOST],
      '--allow-host': [WEBHOOK_HOST, '--webhook-url', WEBHOOK_URL],
      '--create-webhook': ['--webhook-url', WEBHOOK_URL, '--allow-host', WEBHOOK_HOST],
      '--webhook-secret-out': ['/tmp/whsec.txt'],
    };
    for (const flag of expected) {
      const argv = standalone[flag] ?? ['--plan', flag, ...(companions[flag] ?? [])];

      expect(() => parseArguments(argv)).not.toThrow();
    }
  });

  it('parses --force and --adopt-existing, both off by default', () => {
    const bare = parseArguments(['--apply', '--carrier-out', '/tmp/x.json']);

    expect(bare.force).toBe(false);
    expect(bare.adoptExisting).toBe(false);

    const loud = parseArguments(['--apply', '--carrier-out', '/tmp/x.json', '--force', '--adopt-existing']);

    expect(loud.force).toBe(true);
    expect(loud.adoptExisting).toBe(true);
  });

  it('says in the usage text that BILLING_PLAN_ENV must be test', () => {
    expect(USAGE).toContain('BILLING_PLAN_ENV must be exactly \'test\'');
  });
});

describe('BILLING_PLAN_ENV gate', () => {
  it('accepts only test', () => {
    expect(requirePlanEnv('test')).toBe('test');
  });

  it('refuses prod, dev and absence, naming the consequence', () => {
    expect(() => requirePlanEnv('prod')).toThrow(/TEST MODE only/);
    expect(() => requirePlanEnv('dev')).toThrow(/BILLING_STRIPE_PRICE_IDS_ENV_MISMATCH/);
    expect(() => requirePlanEnv(undefined)).toThrow(/must be set to exactly 'test'/);
    expect(() => requirePlanEnv('preview')).toThrow(/must be set to exactly 'test'/);
  });
});

describe('bypass-token redaction', () => {
  afterEach(() => {
    resetSensitiveValues();
  });

  it('extracts the token from the webhook url', () => {
    expect(extractBypassToken(WEBHOOK_URL)).toBe('TOKEN');
    expect(extractBypassToken('https://x.test/api/webhooks/stripe-billing')).toBeNull();
    expect(extractBypassToken('not a url')).toBeNull();
  });

  it('masks a registered token anywhere it appears, including a bare echo', () => {
    registerSensitiveValue('ZmFrZWJ5cGFzc3Rva2Vu1234');
    const line = 'endpoint url=https://x.vercel.app/api/webhooks/stripe-billing?x-vercel-protection-bypass=ZmFrZWJ5cGFzc3Rva2Vu1234 rejected';

    expect(redactSecrets(line)).not.toContain('ZmFrZWJ5cGFzc3Rva2Vu1234');
    expect(redactSecrets('bare ZmFrZWJ5cGFzc3Rva2Vu1234 echo')).toContain('[redacted]');
  });

  it('masks the query parameter even when the token was never registered', () => {
    const line = `https://x.vercel.app/api/webhooks/stripe-billing?${BYPASS_QUERY_PARAM}=UNREGISTERED9876&x=1`;
    const redacted = redactSecrets(line);

    expect(redacted).not.toContain('UNREGISTERED9876');
    expect(redacted).toContain(`${BYPASS_QUERY_PARAM}=[redacted]`);
    expect(redacted).toContain('&x=1');
  });

  it('ignores values too short to mask safely', () => {
    registerSensitiveValue('abc');

    expect(redactSecrets('abc def')).toBe('abc def');
  });

  it('redacts a Stripe error that echoes the offending url, param and key', () => {
    registerSensitiveValue('TOKENTOKENTOKEN');
    const error = Object.assign(new Error('Invalid url: https://x.vercel.app/a?x-vercel-protection-bypass=TOKENTOKENTOKEN'), {
      type: 'StripeInvalidRequestError',
      requestId: 'req_123',
      raw: {
        message: 'Invalid API Key provided: sk_test_abcd1234efgh',
        param: 'url',
        url: 'https://x.vercel.app/api/webhooks/stripe-billing?x-vercel-protection-bypass=TOKENTOKENTOKEN',
      },
    });
    const described = describeErrorForOutput(error);

    expect(described).not.toContain('TOKENTOKENTOKEN');
    expect(described).not.toContain('abcd1234efgh');
    expect(described).toContain('req_123');
    expect(described).toContain('raw.param=url');
  });

  it('describes a non-Error rejection without throwing', () => {
    expect(describeErrorForOutput('plain string')).toBe('plain string');
    expect(describeErrorForOutput(undefined)).toBe('unknown error');
  });
});

describe('webhook idempotency key', () => {
  it('hashes a stable handle instead of carrying the url', () => {
    const handle = webhookIdempotencyHandle(WEBHOOK_URL);
    const key = idempotencyKeyFor('test', 'webhook', handle);

    expect(handle).toMatch(/^[0-9a-f]{64}$/);
    expect(handle).toBe(webhookIdempotencyHandle(WEBHOOK_URL));
    expect(handle).not.toBe(webhookIdempotencyHandle(`${WEBHOOK_URL}&other=1`));
    expect(key).not.toContain('TOKEN');
    expect(key).not.toContain('vercel');
    expect(key.length).toBeLessThan(255);
  });

  it('never hands Stripe an Idempotency-Key containing the url', async () => {
    const client = makeMockClient();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
    });
    writeSpy.mockRestore();

    expect(client.idempotencyKeys.length).toBeGreaterThan(0);

    for (const key of client.idempotencyKeys) {
      expect(key).not.toContain('TOKEN');
      expect(key).not.toContain('https://');
      expect(key.length).toBeLessThan(255);
    }
  });
});

describe('writeSecureFile', () => {
  const made: string[] = [];
  const tempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luster-provision-'));
    made.push(dir);
    return dir;
  };

  afterEach(() => {
    while (made.length > 0) {
      fs.rmSync(made.pop() as string, { recursive: true, force: true });
    }
  });

  it('creates the file 0600 and reports created', () => {
    const target = path.join(tempDir(), 'nested', 'carrier.json');

    expect(writeSecureFile(target, 'one\n')).toBe('created');
    expect(fs.readFileSync(target, 'utf8')).toBe('one\n');
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it('REFUSES to overwrite an existing file with different contents', () => {
    const target = path.join(tempDir(), 'whsec.txt');
    writeSecureFile(target, 'whsec_first\n');

    expect(() => writeSecureFile(target, 'whsec_second\n')).toThrow(/Refusing to overwrite/);
    expect(fs.readFileSync(target, 'utf8')).toBe('whsec_first\n');
  });

  it('accepts a byte-identical rewrite, which is what makes --apply resumable', () => {
    const target = path.join(tempDir(), 'carrier.json');
    writeSecureFile(target, 'same\n');

    expect(writeSecureFile(target, 'same\n')).toBe('unchanged');
  });

  it('overwrites only when --force is passed through', () => {
    const target = path.join(tempDir(), 'carrier.json');
    writeSecureFile(target, 'old\n');

    expect(writeSecureFile(target, 'new\n', { force: true })).toBe('overwritten');
    expect(fs.readFileSync(target, 'utf8')).toBe('new\n');
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it('REFUSES a symlinked target rather than writing through it', () => {
    const dir = tempDir();
    const real = path.join(dir, 'real.txt');
    const link = path.join(dir, 'link.txt');
    fs.writeFileSync(real, 'untouched\n');
    fs.symlinkSync(real, link);

    expect(() => writeSecureFile(link, 'secret\n')).toThrow(/symbolic link/);
    expect(() => writeSecureFile(link, 'secret\n', { force: true })).toThrow(/symbolic link/);
    expect(fs.readFileSync(real, 'utf8')).toBe('untouched\n');
  });

  it('REFUSES a dangling symlink too (the O_EXCL open would otherwise follow it)', () => {
    const dir = tempDir();
    const link = path.join(dir, 'dangling.txt');
    fs.symlinkSync(path.join(dir, 'missing.txt'), link);

    expect(() => writeSecureFile(link, 'secret\n')).toThrow(/symbolic link/);
  });

  it('REFUSES a target that is a directory', () => {
    const dir = tempDir();

    expect(() => writeSecureFile(dir, 'x')).toThrow(/not a regular file/);
  });
});

describe('output path gate resolves symlinks', () => {
  const made: string[] = [];

  afterEach(() => {
    while (made.length > 0) {
      fs.rmSync(made.pop() as string, { recursive: true, force: true });
    }
  });

  it('catches a path outside the worktree that links back INTO it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luster-link-'));
    made.push(dir);
    const link = path.join(dir, 'into-repo');
    fs.symlinkSync(repositoryRoot, link);

    expect(() => assertOutputPathOutsideRepository(
      path.join(link, 'carrier.json'),
      repositoryRoot,
      '--carrier-out',
    )).toThrow(/inside the git worktree/);
  });

  it('still accepts a genuinely outside path that does not yet exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luster-out-'));
    made.push(dir);
    const target = path.join(dir, 'deep', 'carrier.json');

    expect(assertOutputPathOutsideRepository(target, repositoryRoot, '--carrier-out'))
      .toBe(path.join(fs.realpathSync(dir), 'deep', 'carrier.json'));
  });
});

describe('collision detection against a hand-built catalogue', () => {
  const emptyInventory: AccountInventory = {
    products: [],
    prices: [],
    coupons: [],
    webhookEndpoints: [],
  };

  it('matches a Price by amount, currency and interval shape', () => {
    const planned = makePlan().prices.find(price => price.key === 'pro_2026_08_annual') as PlannedPrice;
    const same = makePrice({
      id: 'price_manual',
      unit_amount: planned.unitAmount,
      currency: 'cad',
      type: 'recurring',
      recurring: { interval: 'year', interval_count: 1 } as Stripe.Price.Recurring,
    });

    expect(priceShapeMatches(planned, same)).toBe(true);
    expect(priceShapeMatches(planned, makePrice({ id: 'p', unit_amount: 1 }))).toBe(false);
  });

  it('finds nothing on an empty account', () => {
    expect(classifyCatalogueCollisions(makePlan({ webhookUrl: WEBHOOK_URL }), emptyInventory)).toEqual([]);
  });

  it('flags a runbook-created Product/Price/Coupon that carries no metadata handle', () => {
    const plan = makePlan();
    const planned = plan.prices.find(price => price.key === 'starter_2026_08_monthly') as PlannedPrice;
    const collisions = classifyCatalogueCollisions(plan, {
      ...emptyInventory,
      products: [{
        id: 'prod_ManualStarter',
        object: 'product',
        active: true,
        livemode: false,
        name: 'Luster Starter',
        metadata: {},
      } as Stripe.Product],
      prices: [makePrice({
        id: 'price_ManualStarter',
        unit_amount: planned.unitAmount,
        currency: 'cad',
        type: 'recurring',
        recurring: { interval: 'month', interval_count: 1 } as Stripe.Price.Recurring,
        product: 'prod_ManualStarter',
      })],
      coupons: [makeCoupon({ id: '2Ib6JHhL', percent_off: 40, duration: 'once' })],
    });

    expect(collisions.map(collision => collision.id).sort()).toEqual([
      '2Ib6JHhL',
      'price_ManualStarter',
      'prod_ManualStarter',
    ]);
    expect(collisions.every(collision => collision.adoptable)).toBe(false);
  });

  it('ignores objects that already carry our metadata', () => {
    const plan = makePlan();
    const state = seedProvisionedState();

    expect(classifyCatalogueCollisions(plan, {
      products: [...state.products.values()],
      prices: state.prices,
      coupons: [...state.coupons.values()],
      webhookEndpoints: [],
    })).toEqual([]);
  });

  it('ignores an archived Price: it can never be the one Checkout resolves', () => {
    const plan = makePlan();
    const planned = plan.prices.find(price => price.key === 'starter_2026_08_monthly') as PlannedPrice;

    expect(classifyCatalogueCollisions(plan, {
      ...emptyInventory,
      prices: [makePrice({
        id: 'price_archived',
        active: false,
        unit_amount: planned.unitAmount,
        currency: 'cad',
        type: 'recurring',
        recurring: { interval: 'month', interval_count: 1 } as Stripe.Price.Recurring,
        product: planned.productId,
      })],
    })).toEqual([]);
  });

  it('flags a foreign endpoint on our exact webhook url, and marks it adoptable', () => {
    const collisions = classifyCatalogueCollisions(makePlan({ webhookUrl: WEBHOOK_URL }), {
      ...emptyInventory,
      webhookEndpoints: [{
        id: 'we_manual',
        object: 'webhook_endpoint',
        api_version: API_VERSION,
        enabled_events: [...BILLING_WEBHOOK_HANDLED_TYPES],
        livemode: false,
        metadata: {},
        status: 'enabled',
        url: WEBHOOK_URL,
      } as unknown as Stripe.WebhookEndpoint],
    });

    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.kind).toBe('webhook');
    expect(collisions[0]?.adoptable).toBe(true);
  });

  it('REFUSES the run, naming the ids, and creates nothing', async () => {
    const plan = makePlan();
    const planned = plan.prices.find(price => price.key === 'starter_2026_08_monthly') as PlannedPrice;
    const client = makeMockClient({
      products: new Map([['prod_ManualStarter', {
        id: 'prod_ManualStarter',
        object: 'product',
        active: true,
        livemode: false,
        name: 'Luster Starter',
        metadata: {},
      } as Stripe.Product]]),
      prices: [makePrice({
        id: 'price_ManualStarter',
        unit_amount: planned.unitAmount,
        currency: 'cad',
        type: 'recurring',
        recurring: { interval: 'month', interval_count: 1 } as Stripe.Price.Recurring,
        product: 'prod_ManualStarter',
      })],
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, plan, { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(/prod_ManualStarter/);

    writeSpy.mockRestore();

    expect(client.calls.filter(call => /\.(?:create|update)/.test(call))).toEqual([]);
  });

  it('refuses in --plan too, so the dry run surfaces it before any write', async () => {
    const client = makeMockClient({
      coupons: new Map([['2Ib6JHhL', makeCoupon({ id: '2Ib6JHhL' })]]),
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), { mode: 'plan', adoptDefault: false }))
      .rejects.toThrow(/2Ib6JHhL/);

    writeSpy.mockRestore();
  });

  it('will not adopt an unadoptable collision even with --adopt-existing', async () => {
    const client = makeMockClient({
      coupons: new Map([['2Ib6JHhL', makeCoupon({ id: '2Ib6JHhL' })]]),
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), {
      mode: 'apply',
      adoptDefault: false,
      adoptExisting: true,
    })).rejects.toThrow(/not adoptable/);

    writeSpy.mockRestore();
  });

  it('adopts an exact match with --adopt-existing instead of duplicating it', async () => {
    const plan = makePlan();
    const state = seedProvisionedState();
    // An unstamped Price sitting on OUR Product: exactly what an earlier
    // hand-run `stripe prices create --product luster_test_plan_...` leaves.
    const target = state.prices.find(
      price => (price.metadata as Stripe.Metadata).luster_key === 'starter_2026_08_monthly',
    ) as Stripe.Price;
    (target as { metadata: Stripe.Metadata }).metadata = {};
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, plan, { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(new RegExp(target.id));

    const adopted = await runProvision(client, plan, {
      mode: 'apply',
      adoptDefault: false,
      adoptExisting: true,
    });
    writeSpy.mockRestore();

    expect(client.calls.filter(call => call.startsWith('prices.create'))).toEqual([]);
    expect(client.state.prices).toHaveLength(13);
    expect(adopted.priceIds.get('starter_2026_08_monthly')?.id).toBe(target.id);
    expect((client.state.prices.find(price => price.id === target.id)
      ?.metadata as Stripe.Metadata).luster_catalog).toBe(CATALOG_MARKER);
  });

  it('stamps our metadata onto an adopted coupon at our deterministic id', async () => {
    const plan = makePlan();
    const state = seedProvisionedState();
    state.coupons.set(plan.coupon.id, makeCoupon({ id: plan.coupon.id, metadata: {} }));
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, plan, { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(new RegExp(plan.coupon.id));

    await runProvision(client, plan, { mode: 'apply', adoptDefault: false, adoptExisting: true });
    writeSpy.mockRestore();

    expect(client.calls).toContain(`coupons.update:${plan.coupon.id}`);
    expect((client.state.coupons.get(plan.coupon.id)?.metadata as Stripe.Metadata).luster_catalog)
      .toBe(CATALOG_MARKER);
    expect(client.calls.filter(call => call.startsWith('coupons.create'))).toEqual([]);
  });
});

describe('write ordering and resumability', () => {
  it('hands the carrier to the caller BEFORE the portal and webhook steps', async () => {
    const client = makeMockClient();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    let callsAtCarrierTime: string[] = [];
    const result = await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL, includePortal: true }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
      onCatalogueResolved: ({ priceIds, couponStripeId }) => {
        callsAtCarrierTime = [...client.calls];

        expect(priceIds.size).toBe(13);
        expect(couponStripeId).toBe('coupon_lusterfoundingannual2026test');
      },
    });
    writeSpy.mockRestore();

    expect(callsAtCarrierTime).not.toContain('webhookEndpoints.create');
    expect(callsAtCarrierTime.some(call => call.startsWith('billingPortal.configurations.create'))).toBe(false);
    expect(callsAtCarrierTime.some(call => call.startsWith('billingPortal.configurations.update'))).toBe(false);
    expect(client.calls).toContain('webhookEndpoints.create');
    expect(result.webhookSecret).toBe(MOCK_WEBHOOK_SECRET);
  });

  it('does not call back in --plan, where there is nothing to record', async () => {
    const client = makeMockClient();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const onCatalogueResolved = vi.fn();
    await runProvision(client, makePlan(), { mode: 'plan', adoptDefault: false, onCatalogueResolved });
    writeSpy.mockRestore();

    expect(onCatalogueResolved).not.toHaveBeenCalled();
  });

  it('resumes after a portal refusal: the second run creates nothing new', async () => {
    const client = makeMockClient({
      portalConfigurations: [makePortalConfiguration({ id: 'bpc_legacy', is_default: true })],
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const carriers: string[] = [];
    const record = ({ priceIds, couponStripeId }: {
      priceIds: ReadonlyMap<string, { section: 'offers' | 'topups'; id: string }>;
      couponStripeId: string;
    }): void => {
      carriers.push(JSON.stringify(buildCarrier('test', priceIds, couponStripeId, 'founding_annual_2026')));
    };

    await expect(runProvision(client, makePlan({ includePortal: true }), {
      mode: 'apply',
      adoptDefault: false,
      onCatalogueResolved: record,
    })).rejects.toThrow(/--adopt-default/);

    const createdFirst = client.calls.filter(call => /\.create/.test(call)).length;

    await runProvision(client, makePlan({ includePortal: true }), {
      mode: 'apply',
      adoptDefault: true,
      onCatalogueResolved: record,
    });
    writeSpy.mockRestore();

    // The catalogue was already written on the failed run, and the re-run
    // resolves the identical ids — the byte-identical carrier that
    // writeSecureFile accepts rather than refuses.
    expect(carriers).toHaveLength(2);
    expect(carriers[0]).toBe(carriers[1]);
    // The second run creates NOTHING: every catalogue object is reused and the
    // portal step updates the adopted default rather than creating one.
    expect(client.calls.filter(call => /\.create/.test(call)).length).toBe(createdFirst);
    expect(client.calls).toContain('billingPortal.configurations.update:bpc_legacy');
    expect(client.state.prices).toHaveLength(13);
  });
});

describe('webhook endpoint hygiene', () => {
  function endpoint(partial: Partial<Stripe.WebhookEndpoint> & { id: string }): Stripe.WebhookEndpoint {
    return {
      id: partial.id,
      object: 'webhook_endpoint',
      api_version: partial.api_version ?? API_VERSION,
      created: 0,
      description: null,
      enabled_events: partial.enabled_events ?? [...BILLING_WEBHOOK_HANDLED_TYPES],
      livemode: partial.livemode ?? false,
      metadata: partial.metadata ?? OUR_WEBHOOK_METADATA,
      status: partial.status ?? 'enabled',
      url: partial.url ?? WEBHOOK_URL,
    } as unknown as Stripe.WebhookEndpoint;
  }

  it('re-enables a disabled endpoint instead of leaving it dead until --verify', async () => {
    const state = seedProvisionedState();
    state.webhookEndpoints = [endpoint({ id: 'we_disabled', status: 'disabled' })];
    const client = makeMockClient(state);
    const emitted: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      emitted.push(String(chunk));
      return true;
    });
    await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
    });
    writeSpy.mockRestore();

    expect(emitted.join('')).toContain('status disabled -> enabled');
    expect((client.state.webhookEndpoints[0] as unknown as { disabled?: boolean }).disabled).toBe(false);
  });

  it('REFUSES an endpoint on our url that this script did not create', async () => {
    const state = seedProvisionedState();
    state.webhookEndpoints = [endpoint({ id: 'we_foreign', metadata: {} })];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
    })).rejects.toThrow(/we_foreign/);

    writeSpy.mockRestore();

    expect(client.calls).not.toContain('webhookEndpoints.create');
  });

  it('adopts that endpoint with --adopt-existing, stamping our metadata', async () => {
    const state = seedProvisionedState();
    state.webhookEndpoints = [endpoint({ id: 'we_foreign', metadata: {} })];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
      createWebhook: true,
      adoptExisting: true,
    });
    writeSpy.mockRestore();

    expect(client.calls).toContain('webhookEndpoints.update:we_foreign');
    expect(client.calls).not.toContain('webhookEndpoints.create');
    expect((client.state.webhookEndpoints[0]?.metadata as Stripe.Metadata).luster_provisioner)
      .toBe(PROVISIONER);
  });
});

describe('D16 portal verification holes', () => {
  async function verifyPortal(
    configurations: Stripe.BillingPortal.Configuration[],
  ): Promise<string[]> {
    const client = makeMockClient(seedProvisionedState());
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const result = await runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false });
    const carrier = buildCarrier('test', result.priceIds, result.couponStripeId, 'founding_annual_2026');
    client.state.portalConfigurations = configurations;
    const failures = await runVerify(client, {
      env: 'test',
      catalogue,
      carrier,
      plan: makePlan(),
      apiVersion: API_VERSION,
      checkPortal: true,
    });
    writeSpy.mockRestore();
    return failures;
  }

  function ourConfiguration(
    partial: Partial<Stripe.BillingPortal.Configuration> & { id: string },
  ): Stripe.BillingPortal.Configuration {
    return makePortalConfiguration({
      business_profile: {
        headline: 'Manage your Luster billing',
        privacy_policy_url: null,
        terms_of_service_url: null,
      },
      metadata: { luster_portal_config: 'd16', luster_plan_env: 'test', luster_provisioner: PROVISIONER },
      ...partial,
    });
  }

  it('fails a default configuration that lets the customer edit billing details', async () => {
    const configuration = ourConfiguration({ id: 'bpc_customer_update', is_default: true });
    (configuration.features.customer_update as { enabled: boolean }).enabled = true;

    expect((await verifyPortal([configuration])).join('\n'))
      .toContain('portal customer_update.enabled: expected false (D16)');
  });

  it('fails a default configuration that has subscription_pause enabled', async () => {
    const configuration = ourConfiguration({ id: 'bpc_paused', is_default: true });
    (configuration.features as unknown as Record<string, unknown>).subscription_pause = { enabled: true };

    expect((await verifyPortal([configuration])).join('\n'))
      .toContain('portal subscription_pause.enabled');
  });

  it('passes when subscription_pause is simply absent, as stripe@16.12.0 models it', async () => {
    const failures = await verifyPortal([ourConfiguration({ id: 'bpc_ok', is_default: true })]);

    expect(failures.join('\n')).not.toContain('subscription_pause');
    expect(failures).toEqual([]);
  });

  it('checks OUR configuration too when a different one is the default', async () => {
    const foreignDefault = makePortalConfiguration({
      id: 'bpc_legacy_default',
      is_default: true,
      business_profile: {
        headline: 'Manage your Luster billing',
        privacy_policy_url: null,
        terms_of_service_url: null,
      },
    });
    const ours = ourConfiguration({ id: 'bpc_ours', is_default: false });
    (ours.features.subscription_update as { enabled: boolean }).enabled = true;
    const failures = await verifyPortal([foreignDefault, ours]);

    expect(failures.join('\n')).toContain('portal (ours, not default) subscription_update.enabled');
    expect(failures.join('\n')).toContain('bpc_ours');
  });

  it('names the Dashboard remedy when ours exists but nothing is default', async () => {
    const failures = await verifyPortal([ourConfiguration({ id: 'bpc_orphan', is_default: false })]);

    expect(failures.join('\n')).toContain('bpc_orphan');
    expect(failures.join('\n')).toContain('Stripe Dashboard');
  });

  it('refuses a foreign TEST-mode default for the right reason, not a live-customer one', async () => {
    const client = makeMockClient({
      portalConfigurations: [makePortalConfiguration({ id: 'bpc_legacy', is_default: true })],
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    let message = '';
    try {
      await runProvision(client, makePlan({ includePortal: true }), {
        mode: 'apply',
        adoptDefault: false,
      });
    } catch (caught) {
      message = caught instanceof Error ? caught.message : String(caught);
    }
    writeSpy.mockRestore();

    expect(message).toContain('TEST-mode portal sessions');
    expect(message).toContain('LIVE-mode default configuration is a separate object');
    expect(message).not.toMatch(/Mutating it changes the portal experience of live legacy-flow customers/);
  });

  it('REFUSES a livemode portal configuration on the non-default path too', async () => {
    const client = makeMockClient({
      portalConfigurations: [makePortalConfiguration({
        id: 'bpc_live',
        is_default: false,
        livemode: true,
        metadata: { luster_portal_config: 'd16' },
      })],
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan({ includePortal: true }), {
      mode: 'apply',
      adoptDefault: false,
    })).rejects.toThrow(/livemode=true/);

    writeSpy.mockRestore();
  });
});

describe('collectAllPages — exhaustive listing, or a refusal', () => {
  const page = (ids: string[], hasMore: boolean) => ({
    data: ids.map(id => ({ id })),
    has_more: hasMore,
  });

  it('pages until Stripe itself says has_more is false', async () => {
    const seen: Array<string | undefined> = [];
    const pages = [page(['a', 'b'], true), page(['c', 'd'], true), page(['e'], false)];

    const all = await collectAllPages<{ id: string }>('account Prices', async (startingAfter) => {
      seen.push(startingAfter);
      return pages[seen.length - 1] as { data: Array<{ id: string }>; has_more: boolean };
    });

    expect(all.map(item => item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // The cursor is always the LAST id of the previous page, never an offset.
    expect(seen).toEqual([undefined, 'b', 'd']);
  });

  it('stops on an empty page even when has_more is still true', async () => {
    const all = await collectAllPages<{ id: string }>('account Coupons', async () => page([], true));

    expect(all).toEqual([]);
  });

  it('THROWS instead of returning a truncated list when the page cap is reached', async () => {
    let calls = 0;
    const attempt = collectAllPages<{ id: string }>('account Prices', async () => {
      calls += 1;
      return page([`price_${calls}`], true);
    });

    await expect(attempt).rejects.toThrow(RefusalError);
    // The resource and the object count are both named, so the operator can see
    // how big the account actually is.
    await expect(attempt).rejects.toThrow(/account Prices/);
    await expect(attempt).rejects.toThrow(new RegExp(`${LIST_MAX_PAGES} objects collected`));
    expect(calls).toBe(LIST_MAX_PAGES);
  });

  it('refuses with the safety-gate exit code, not a silent success', async () => {
    const error = await collectAllPages<{ id: string }>('account Products', async () => page(['x'], true))
      .then(() => null, (thrown: unknown) => thrown as RefusalError);

    expect(error).toBeInstanceOf(RefusalError);
    expect(error?.exitCode).toBe(3);
    expect(error?.message).toMatch(/collision scan/);
  });

  it('asks Stripe for the maximum page size Stripe allows', () => {
    expect(LIST_PAGE_LIMIT).toBe(100);
  });
});

describe('the collision scan is complete or the run refuses', () => {
  it('aborts the whole run when the account Product list cannot be enumerated', async () => {
    const client = makeMockClient();
    let served = 0;
    client.products.list = async () => {
      served += 1;
      return {
        data: [{ id: `prod_flood_${served}`, livemode: false } as unknown as Stripe.Product],
        has_more: true,
      };
    };
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    // `--plan` too: a partial inventory makes the dry run's "no collision"
    // verdict just as wrong as the apply's.
    await expect(runProvision(client, makePlan(), { mode: 'plan', adoptDefault: false }))
      .rejects.toThrow(/still reports has_more/);

    writeSpy.mockRestore();

    expect(client.state.products.size).toBe(0);
    expect(client.state.prices).toEqual([]);
  });
});

describe('output paths are refused inside ANY git checkout', () => {
  const made: string[] = [];

  afterEach(() => {
    while (made.length > 0) {
      fs.rmSync(made.pop() as string, { recursive: true, force: true });
    }
  });

  it('finds the nearest ancestor holding a .git directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luster-checkout-'));
    made.push(dir);
    const checkout = path.join(dir, 'some-clone');
    fs.mkdirSync(path.join(checkout, 'nested', 'deeper'), { recursive: true });
    fs.mkdirSync(path.join(checkout, '.git'));

    expect(enclosingGitCheckout(path.join(checkout, 'nested', 'deeper', 'whsec-test.txt')))
      .toBe(checkout);
    expect(enclosingGitCheckout(path.join(dir, 'whsec-test.txt'))).toBeNull();
  });

  it('treats a .git FILE as a checkout too — that is what a linked worktree has', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luster-worktree-'));
    made.push(dir);
    const worktree = path.join(dir, 'linked-worktree');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: /somewhere/.git/worktrees/linked\n');

    expect(enclosingGitCheckout(path.join(worktree, 'carrier-test.json'))).toBe(worktree);
  });

  it('refuses a path in a DIFFERENT checkout of this repository, which the worktree test alone allows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luster-other-checkout-'));
    made.push(dir);
    const otherCheckout = path.join(dir, 'nail-salon-copy');
    fs.mkdirSync(path.join(otherCheckout, '.git'), { recursive: true });
    const target = path.join(otherCheckout, 'whsec-test.txt');

    // It is genuinely outside THIS worktree — the old gate passed it.
    expect(path.relative(repositoryRoot, target).startsWith('..')).toBe(true);
    expect(() => assertOutputPathOutsideRepository(target, repositoryRoot, '--webhook-secret-out'))
      .toThrow(/inside a git checkout/);
    expect(() => assertOutputPathOutsideRepository(target, repositoryRoot, '--webhook-secret-out'))
      .toThrow(RefusalError);
  });

  it('still accepts a path with no .git anywhere above it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luster-clean-'));
    made.push(dir);
    const target = path.join(dir, 'pilot', 'carrier-test.json');

    expect(assertOutputPathOutsideRepository(target, repositoryRoot, '--carrier-out'))
      .toBe(path.join(fs.realpathSync(dir), 'pilot', 'carrier-test.json'));
  });
});

describe('checkSecretKeyMode refuses without echoing anything', () => {
  it('echoes no window of a mis-pasted value, not even a filtered one', () => {
    // The realistic mistake: a whsec_ or the Protection-Bypass token pasted
    // into the STRIPE_TEST_SECRET_KEY line of the same .env.pilot.local.
    for (const value of [
      'whsec_abcdefghijkl',
      'aBcDeFgH12345678xyz',
      FAKE_LIVE_KEY,
      'pk_test_notasecretkey',
    ]) {
      const result = checkSecretKeyMode(value);

      expect(result.ok).toBe(false);

      const reason = result.ok === false ? result.reason : '';

      // The whole value, and the 8-character window the old code printed,
      // are both absent. (The equality below is the stronger statement: the
      // refusal is a CONSTANT, so nothing derived from the value can survive
      // in it at all.)
      expect(reason).not.toContain(value);
      expect(reason).not.toContain(value.slice(0, 8));
      expect(reason).toBe(
        'STRIPE_TEST_SECRET_KEY does not start with sk_test_ or rk_test_. '
        + 'This script is test-mode only and refuses live keys. The offending value is not echoed, '
        + 'not even in part: check the variable in your shell.',
      );
    }
  });

  it('still names the two acceptable prefixes so the refusal is actionable', () => {
    const result = checkSecretKeyMode('nonsense');

    expect(result.ok === false ? result.reason : '').toContain('sk_test_ or rk_test_');
  });
});

describe('--webhook-url-env keeps the bypass token out of argv', () => {
  const URL_WITH_TOKEN = `${WEBHOOK_URL}?${BYPASS_QUERY_PARAM}=tokentokentoken`;

  it('parses the flag as a NAME and refuses it alongside --webhook-url', () => {
    const parsed = parseArguments([
      '--verify',
      '--carrier',
      '/tmp/x.json',
      '--webhook-url-env',
      'PILOT_WEBHOOK_URL',
      '--allow-host',
      WEBHOOK_HOST,
    ]);

    expect(parsed.webhookUrlEnv).toBe('PILOT_WEBHOOK_URL');
    expect(parsed.webhookUrl).toBeNull();
    expect(() => parseArguments([
      '--verify',
      '--carrier',
      '/tmp/x.json',
      '--webhook-url',
      URL_WITH_TOKEN,
      '--webhook-url-env',
      'PILOT_WEBHOOK_URL',
      '--allow-host',
      WEBHOOK_HOST,
    ])).toThrow(/mutually exclusive/);
  });

  it('accepts --webhook-url-env where --webhook-url is accepted, including the secret-out requirement', () => {
    expect(() => parseArguments([
      '--apply',
      '--carrier-out',
      '/tmp/x.json',
      '--webhook-url-env',
      'PILOT_WEBHOOK_URL',
      '--allow-host',
      WEBHOOK_HOST,
      '--create-webhook',
    ])).toThrow(/--webhook-secret-out/);
    expect(parseArguments([
      '--apply',
      '--carrier-out',
      '/tmp/x.json',
      '--webhook-url-env',
      'PILOT_WEBHOOK_URL',
      '--allow-host',
      WEBHOOK_HOST,
      '--create-webhook',
      '--webhook-secret-out',
      '/tmp/whsec.txt',
    ]).webhookUrlEnv).toBe('PILOT_WEBHOOK_URL');
  });

  it('reads the url from the named variable, never from argv', () => {
    const resolved = resolveWebhookUrlSource(
      { webhookUrl: null, webhookUrlEnv: 'PILOT_WEBHOOK_URL' },
      { PILOT_WEBHOOK_URL: URL_WITH_TOKEN },
    );

    expect(resolved).toBe(URL_WITH_TOKEN);
    expect(validateWebhookUrl(resolved as string)).toBe(URL_WITH_TOKEN);
  });

  it('names the VARIABLE, never the value, when it is unset or empty', () => {
    for (const env of [{}, { PILOT_WEBHOOK_URL: '' }]) {
      const thrown = (() => {
        try {
          resolveWebhookUrlSource({ webhookUrl: null, webhookUrlEnv: 'PILOT_WEBHOOK_URL' }, env);
          return null;
        } catch (error) {
          return error as Error;
        }
      })();

      expect(thrown?.message).toContain('PILOT_WEBHOOK_URL');
      expect(thrown?.message).not.toContain('tokentokentoken');
    }
  });

  it('refuses a url with stray whitespace rather than storing it byte-for-byte', () => {
    expect(() => resolveWebhookUrlSource(
      { webhookUrl: null, webhookUrlEnv: 'PILOT_WEBHOOK_URL' },
      { PILOT_WEBHOOK_URL: `${URL_WITH_TOKEN}\n` },
    )).toThrow(/whitespace/);
  });

  it('still honours --webhook-url, and returns null when neither is given', () => {
    expect(resolveWebhookUrlSource({ webhookUrl: URL_WITH_TOKEN, webhookUrlEnv: null }, {}))
      .toBe(URL_WITH_TOKEN);
    expect(resolveWebhookUrlSource({ webhookUrl: null, webhookUrlEnv: null }, {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T1–T7 (HANDOFF §7, FINAL handoff §6 row X8)
// ---------------------------------------------------------------------------

function makeEndpoint(partial: Partial<Stripe.WebhookEndpoint> & { id: string; url: string }): Stripe.WebhookEndpoint {
  return {
    id: partial.id,
    object: 'webhook_endpoint',
    api_version: partial.api_version ?? API_VERSION,
    application: partial.application ?? null,
    created: 0,
    description: partial.description ?? null,
    enabled_events: partial.enabled_events ?? [...BILLING_WEBHOOK_HANDLED_TYPES],
    livemode: partial.livemode ?? false,
    metadata: partial.metadata ?? {},
    status: partial.status ?? 'enabled',
    url: partial.url,
  } as Stripe.WebhookEndpoint;
}

describe('T2 — --allow-host gates the destination, not just the scheme', () => {
  it('normalises case, a trailing dot and IPv6 brackets before comparing', () => {
    expect(normalizeHostname('  Example.COM.  ')).toBe('example.com');
    expect(normalizeHostname('[::1]')).toBe('::1');
  });

  it('accepts a matching host and returns it for printing', () => {
    expect(assertWebhookHostAllowed(WEBHOOK_URL, WEBHOOK_HOST)).toBe(WEBHOOK_HOST);
    expect(assertWebhookHostAllowed(WEBHOOK_URL, WEBHOOK_HOST.toUpperCase())).toBe(WEBHOOK_HOST);
  });

  it('REFUSES a host the operator did not type, naming both', () => {
    expect(() => assertWebhookHostAllowed(WEBHOOK_URL, 'some-other-deployment.vercel.app'))
      .toThrow(/does not match the webhook url's host/);
    expect(() => assertWebhookHostAllowed(WEBHOOK_URL, null)).toThrow(/requires --allow-host/);
  });

  it('REFUSES every known production host outright, even when --allow-host names it', () => {
    for (const host of PRODUCTION_WEBHOOK_HOSTS) {
      const url = `https://${host}/api/webhooks/stripe-billing`;

      expect(() => assertWebhookHostAllowed(url, host)).toThrow(RefusalError);
      expect(() => assertWebhookHostAllowed(url, host)).toThrow(/refusing a production host/);
    }

    // And the reverse direction: a Preview url can never be laundered through a
    // production --allow-host either.
    expect(() => assertWebhookHostAllowed(WEBHOOK_URL, 'www.lustergel.app'))
      .toThrow(/refusing a production host/);
  });

  it('names the live domain and the legacy one', () => {
    expect(PRODUCTION_WEBHOOK_HOSTS).toContain('www.lustergel.app');
    expect(PRODUCTION_WEBHOOK_HOSTS).toContain('www.islanailsalon.com');
  });

  it('couples the flag to a webhook url in both directions', () => {
    expect(() => parseArguments(['--plan', '--webhook-url', WEBHOOK_URL])).toThrow(/requires --allow-host/);
    expect(() => parseArguments(['--plan', '--webhook-url-env', 'PILOT_WEBHOOK_URL']))
      .toThrow(/requires --allow-host/);
    expect(() => parseArguments(['--plan', '--allow-host', WEBHOOK_HOST]))
      .toThrow(/only meaningful with --webhook-url/);
  });
});

describe('T3 — the shared test account is visible, then acknowledged', () => {
  it('lists every OTHER endpoint with its event count and Connect flag, and drops the query string', () => {
    const summaries = summarizeOtherWebhookEndpoints(
      [
        makeEndpoint({ id: 'we_ours', url: WEBHOOK_URL }),
        makeEndpoint({
          id: 'we_foreign',
          url: 'https://another-app.example.com/hook?secret-ish=value',
          enabled_events: ['charge.succeeded', 'customer.created'],
          application: 'ca_connect_app',
          status: 'disabled',
        }),
      ],
      WEBHOOK_URL,
    );

    expect(summaries).toEqual([{
      id: 'we_foreign',
      url: 'https://another-app.example.com/hook',
      queryStringPresent: true,
      enabledEventCount: 2,
      connect: true,
      status: 'disabled',
    }]);
    // The foreign query string never reaches the transcript: redactSecrets only
    // knows the token shapes THIS process registered.
    expect(describeSharedAccountExposure(summaries).join('\n')).not.toContain('secret-ish=value');
  });

  it('counts every endpoint as OTHER when this run manages none', () => {
    const summaries = summarizeOtherWebhookEndpoints([makeEndpoint({ id: 'we_a', url: WEBHOOK_URL })], null);

    expect(summaries.map(summary => summary.id)).toEqual(['we_a']);
  });

  it('says so explicitly when the list is empty (the dedicated Sandbox, O5)', () => {
    expect(describeSharedAccountExposure([]).join('\n')).toMatch(/no OTHER test-mode webhook endpoint/);
    expect(describeSharedAccountExposure([]).join('\n')).toContain('O5');
  });

  it('REFUSES --apply on a shared account and creates nothing', async () => {
    const state = seedProvisionedState();
    state.products = new Map();
    state.prices = [];
    state.coupons = new Map();
    state.webhookEndpoints = [makeEndpoint({ id: 'we_someone_else', url: 'https://another-app.example.com/hook' })];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(/--acknowledge-shared-account/);

    writeSpy.mockRestore();

    expect(client.calls).not.toContain('products.create:luster_plan_test_starter');
    expect(client.calls.some(call => call.startsWith('prices.create'))).toBe(false);
    expect(client.calls.some(call => call.startsWith('coupons.create'))).toBe(false);
  });

  it('proceeds once the exposure is acknowledged', async () => {
    const state = seedProvisionedState();
    state.webhookEndpoints = [makeEndpoint({ id: 'we_someone_else', url: 'https://another-app.example.com/hook' })];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const result = await runProvision(client, makePlan(), {
      mode: 'apply',
      adoptDefault: false,
      acknowledgeSharedAccount: true,
    });

    writeSpy.mockRestore();

    expect(result.accountId).toBe('acct_mock');
  });

  it('lists the inventory at --plan without refusing, even with no webhook planned', async () => {
    const state = seedProvisionedState();
    state.webhookEndpoints = [makeEndpoint({ id: 'we_someone_else', url: 'https://another-app.example.com/hook' })];
    const client = makeMockClient(state);
    const lines: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    await runProvision(client, makePlan(), { mode: 'plan', adoptDefault: false });

    writeSpy.mockRestore();

    expect(client.calls).toContain('webhookEndpoints.list');
    expect(lines.join('')).toContain('we_someone_else');
    expect(lines.join('')).toMatch(/OTHER test-mode webhook endpoint/);
  });
});

describe('T4 — the exact registration target is confirmed before any write', () => {
  it('prints the url verbatim, the allowed host, and the branch-alias rule', () => {
    const lines = describeWebhookRegistrationTarget(WEBHOOK_URL, WEBHOOK_HOST, true);

    expect(lines[0]).toBe(`webhook url to register: ${WEBHOOK_URL}`);
    expect(lines[1]).toContain(WEBHOOK_HOST);
    expect(lines.join('\n')).toContain('pilot-isla');
    expect(lines.join('\n')).toContain('14 characters');
    expect(lines[3]).toContain('ARMED');
  });

  it('says plainly when nothing will be registered', () => {
    expect(describeWebhookRegistrationTarget(WEBHOOK_URL, WEBHOOK_HOST, false)[3])
      .toMatch(/NOT armed/);
  });

  it('still masks the bypass token when the line is emitted', () => {
    resetSensitiveValues();
    registerSensitiveValue('tokentokentoken');
    const url = `https://${WEBHOOK_HOST}/api/webhooks/stripe-billing?${BYPASS_QUERY_PARAM}=tokentokentoken`;
    const emitted = describeWebhookRegistrationTarget(url, WEBHOOK_HOST, true).map(redactSecrets).join('\n');

    expect(emitted).not.toContain('tokentokentoken');
    expect(emitted).toContain('/api/webhooks/stripe-billing');

    resetSensitiveValues();
  });

  it('documents the same rule in the usage text', () => {
    expect(USAGE).toContain('pilot-isla');
    expect(USAGE).toContain('14 characters');
  });
});

describe('T6 — the endpoint is armed by its own, final invocation', () => {
  it('creates the catalogue but no endpoint without --create-webhook', async () => {
    const client = makeMockClient();
    const lines: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    const result = await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
    });

    writeSpy.mockRestore();

    expect(client.calls).not.toContain('webhookEndpoints.create');
    expect(client.calls).not.toContain('webhookEndpoints.update');
    expect(result.webhookEndpointId).toBeNull();
    expect(result.webhookSecret).toBeNull();
    expect(client.calls.filter(call => call.startsWith('prices.create'))).toHaveLength(13);
    expect(lines.join('')).toContain('webhook step SKIPPED');
    expect(lines.join('')).toContain('STRIPE_BILLING_WEBHOOK_SECRET');
    expect(result.notes.join('\n')).toContain('--create-webhook was not passed');
  });

  it('does not even re-enable a disabled endpoint without the flag', async () => {
    const state = seedProvisionedState();
    state.webhookEndpoints = [makeEndpoint({
      id: 'we_ours',
      url: WEBHOOK_URL,
      status: 'disabled',
      metadata: { ...OUR_WEBHOOK_METADATA },
    })];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await runProvision(client, makePlan({ webhookUrl: WEBHOOK_URL }), {
      mode: 'apply',
      adoptDefault: false,
    });

    writeSpy.mockRestore();

    expect(client.calls).not.toContain('webhookEndpoints.update');
    expect(state.webhookEndpoints[0]?.status).toBe('disabled');
  });

  it('refuses --create-webhook with no url to arm', () => {
    expect(() => parseArguments(['--apply', '--carrier-out', '/tmp/x.json', '--create-webhook']))
      .toThrow(/--create-webhook requires --webhook-url/);
  });
});

describe('T7 — the signing secret reaches stdout before the file sink can refuse', () => {
  it('prints FIRST, then writes', () => {
    const order: string[] = [];
    const delivery = deliverWebhookSecret({
      secret: 'whsec_test_placeholder',
      print: true,
      outPath: '/tmp/never-written.txt',
      force: false,
      stdout: () => {
        order.push('stdout');
      },
      writeFile: () => {
        order.push('writeFile');
        return 'created';
      },
    });

    expect(order).toEqual(['stdout', 'writeFile']);
    expect(delivery).toEqual({ printed: true, written: 'created', writeFailure: null });
  });

  it('survives a refusing file sink when the value was already printed', () => {
    const printed: string[] = [];
    const delivery = deliverWebhookSecret({
      secret: 'whsec_test_placeholder',
      print: true,
      outPath: '/tmp/occupied.txt',
      force: false,
      stdout: (text) => {
        printed.push(text);
      },
      writeFile: () => {
        throw new RefusalError('/tmp/occupied.txt already exists with different contents.');
      },
    });

    expect(printed).toEqual(['whsec_test_placeholder\n']);
    expect(delivery.printed).toBe(true);
    expect(delivery.written).toBeNull();
    expect(delivery.writeFailure).toContain('already exists with different contents');
  });

  it('rethrows the refusal when nothing else holds the value', () => {
    expect(() => deliverWebhookSecret({
      secret: 'whsec_test_placeholder',
      print: false,
      outPath: '/tmp/occupied.txt',
      force: false,
      stdout: () => {
        throw new Error('stdout must not be used when --print-webhook-secret is absent');
      },
      writeFile: () => {
        throw new RefusalError('/tmp/occupied.txt already exists with different contents.');
      },
    })).toThrow(/already exists with different contents/);
  });

  it('refuses, without echoing the value, when neither sink was requested', () => {
    let thrown: Error | null = null;
    try {
      deliverWebhookSecret({
        secret: 'whsec_test_placeholder',
        print: false,
        outPath: null,
        force: false,
        stdout: () => {
          throw new Error('nothing may be printed here');
        },
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeInstanceOf(RefusalError);
    expect(thrown?.message).toContain('Roll the secret');
    expect(thrown?.message).not.toContain('whsec_test_placeholder');
  });

  it('writes without printing when only the file sink is given', () => {
    const delivery = deliverWebhookSecret({
      secret: 'whsec_test_placeholder',
      print: false,
      outPath: '/tmp/ok.txt',
      force: true,
      stdout: () => {
        throw new Error('nothing may be printed here');
      },
      writeFile: (target, contents, opts) => {
        expect(target).toBe('/tmp/ok.txt');
        expect(contents).toBe('whsec_test_placeholder\n');
        expect(opts.force).toBe(true);

        return 'overwritten';
      },
    });

    expect(delivery).toEqual({ printed: false, written: 'overwritten', writeFailure: null });
  });
});

describe('structural gates hold in the source text', () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, 'scripts', 'billing-stripe-test-provision.ts'),
    'utf8',
  );

  it('imports no child_process, no database and no Vercel SDK', () => {
    const imports = [...source.matchAll(/^import[^;]*?from\s+'([^']+)';/gm)].map(match => match[1] as string);

    expect(imports).not.toContain('node:child_process');
    expect(imports).not.toContain('child_process');
    expect(imports.some(specifier => specifier.includes('libs/DB'))).toBe(false);
    expect(imports.some(specifier => specifier.includes('libs/Env'))).toBe(false);
    expect(imports.some(specifier => specifier.startsWith('@vercel/'))).toBe(false);
    expect(source).not.toMatch(/\brequire\(\s*'(?:node:)?child_process'\s*\)/);
    expect(source).not.toMatch(/\bexecSync\b|\bspawnSync\b/);

    // A DYNAMIC import would slip past the static allowlist above, and the
    // three modules that matter most are exactly the ones this script must
    // never pull in: a Drizzle pool, the validated Env, or the app's own
    // module-scope Stripe client.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/import\(['"][^'"]*libs\/(DB|Env|stripe)/);
  });

  it('imports ONLY from the allowlist, so a new dependency cannot slip past the denylist', () => {
    // A denylist only refuses what it was told about. This is the positive
    // form: every static import must be a Node builtin, the Stripe SDK, the
    // handled-event list, or the re-exec helper — nothing else, ever.
    const allowed = /^node:|^stripe$|billingWebhookEvents$|reExecWithServerOnlyCondition$/;
    const imports = [...source.matchAll(/^import[^;]*?from\s+'([^']+)';/gm)].map(match => match[1] as string);

    expect(imports.length).toBeGreaterThan(0);

    for (const specifier of imports) {
      expect(specifier).toMatch(allowed);
    }
  });

  it('pulls the server-only catalogue through dynamic import only', () => {
    // The three catalogue modules are `server-only`; a STATIC import would be
    // hoisted and crash before argument parsing. They may appear only as
    // dynamic `import(...)` calls, awaited after the react-server re-exec.
    for (const catalogueModule of ['billingOffers', 'topupOffers', 'promotions']) {
      expect(source).toMatch(
        new RegExp(`(?<!^import[^\\n]*)\\bimport\\('\\.\\./src/libs/billing/${catalogueModule}'\\)`, 'm'),
      );
      expect(source).not.toMatch(new RegExp(`^import[^;]*?from '[^']*${catalogueModule}';`, 'm'));
    }
  });

  it('never deletes or archives a Stripe object', () => {
    // Comments are stripped first: the header documents the prohibition in
    // prose ("no `webhookEndpoints.del`"), and prose is not a call site.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toMatch(/\.del\(/);
    expect(code).not.toMatch(/webhookEndpoints\.del\b/);
    expect(code).not.toMatch(/active:\s*false/);
  });

  it('reads the key from STRIPE_TEST_SECRET_KEY and never from STRIPE_SECRET_KEY', () => {
    expect(source).toContain('process.env.STRIPE_TEST_SECRET_KEY');
    expect(source).not.toContain('process.env.STRIPE_SECRET_KEY');
  });
});

describe('T2 — the production denylist covers subdomains and the Vercel production aliases', () => {
  const PREVIEW_HOSTS = [
    WEBHOOK_HOST,
    // `-<hash>-<scope>`: the immutable per-deployment URL T4 asks for.
    'isla-nail-studio-abc123-sniperstopsnipings-projects.vercel.app',
    'isla-nail-studio-abc123def-sniperstopsnipings-projects.vercel.app',
    // `-git-<branch>-<scope>` for any branch that is not `main`.
    'isla-nail-studio-git-pilot-isla-sniperstopsnipings-projects.vercel.app',
  ];
  const REFUSED_HOSTS = [
    'lustergel.app',
    'www.lustergel.app',
    'app.lustergel.app',
    'islanailsalon.com',
    'www.islanailsalon.com',
    'staging.islanailsalon.com',
    'isla-nail-studio.vercel.app',
    // Vercel's `<project>-<scope>.vercel.app` production domain — no hash, no
    // `-git-` segment, and never a Preview host.
    'isla-nail-studio-sniperstopsnipings-projects.vercel.app',
    'isla-nail-studio-git-main-sniperstopsnipings-projects.vercel.app',
  ];

  it('classifies every production shape as production', () => {
    for (const host of REFUSED_HOSTS) {
      expect(isProductionWebhookHost(host)).toBe(true);
      // Normalisation must not be a way past it.
      expect(isProductionWebhookHost(`${host.toUpperCase()}.`)).toBe(true);
    }
  });

  it('does NOT classify a Preview deployment host as production', () => {
    for (const host of PREVIEW_HOSTS) {
      expect(isProductionWebhookHost(host)).toBe(false);
    }
  });

  it('REFUSES each production shape at the gate, in both directions', () => {
    for (const host of REFUSED_HOSTS) {
      const url = `https://${host}/api/webhooks/stripe-billing`;

      expect(() => assertWebhookHostAllowed(url, host)).toThrow(RefusalError);
      expect(() => assertWebhookHostAllowed(url, host)).toThrow(/refusing a production host/);
      // A production --allow-host can never launder a preview url either.
      expect(() => assertWebhookHostAllowed(WEBHOOK_URL, host)).toThrow(/refusing a production host/);
    }
  });

  it('still accepts a Preview deployment url with its matching host', () => {
    for (const host of PREVIEW_HOSTS) {
      expect(assertWebhookHostAllowed(`https://${host}/api/webhooks/stripe-billing`, host)).toBe(host);
    }
  });

  it('keeps the flat host list in step with the domain list', () => {
    for (const domain of PRODUCTION_WEBHOOK_DOMAINS) {
      expect(PRODUCTION_WEBHOOK_HOSTS).toContain(domain);
      expect(PRODUCTION_WEBHOOK_HOSTS).toContain(`www.${domain}`);
    }
    for (const alias of PRODUCTION_VERCEL_ALIASES) {
      expect(PRODUCTION_WEBHOOK_HOSTS).toContain(alias);
    }
  });
});

describe('livemode is proven, never assumed', () => {
  it('REFUSES a sampled account Price whose livemode is undefined', async () => {
    // `assertTestLivemode` tests `!== false`, so a MISSING field is refused
    // exactly like `true`: an object that does not say it is test-mode is not
    // evidence that it is.
    const state = seedProvisionedState();
    delete (state.prices[0] as { livemode?: boolean }).livemode;
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(/sampled account object reports livemode=true/);

    writeSpy.mockRestore();

    expect(client.calls.filter(call => /\.(?:create|update)/.test(call))).toEqual([]);
  });

  it('REFUSES a CREATED object whose livemode is undefined', async () => {
    const client = makeMockClient();
    const original = client.products.create;
    client.products.create = async (params, options) => {
      const created = await original(params, options);
      delete (created as { livemode?: boolean }).livemode;
      return created;
    };
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), { mode: 'apply', adoptDefault: false }))
      .rejects.toThrow(/reports livemode=true/);

    writeSpy.mockRestore();

    // It stopped at the first created Product: no Price was ever created.
    expect(client.calls.filter(call => call.startsWith('prices.create'))).toEqual([]);
  });

  it('REFUSES a listed webhook endpoint whose livemode is undefined', async () => {
    const state = seedProvisionedState();
    const endpoint = makeEndpoint({ id: 'we_unknown_mode', url: 'https://another-app.example.com/hook' });
    delete (endpoint as { livemode?: boolean }).livemode;
    state.webhookEndpoints = [endpoint];
    const client = makeMockClient(state);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runProvision(client, makePlan(), { mode: 'plan', adoptDefault: false }))
      .rejects.toThrow(/webhook endpoint we_unknown_mode reports livemode=true/);

    writeSpy.mockRestore();
  });
});
