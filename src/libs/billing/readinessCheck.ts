/**
 * Billing production readiness harness — P8c.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §12,
 * §20, §4. Plan: docs/luster-billing-remaining-work-plan.md §5 "P8c".
 * Runbook: docs/BILLING_PRODUCTION_RUNBOOK.md.
 *
 * Two entry points, both PURE over their inputs — no network call, no
 * database call, no Stripe call, and no ambient `process.env` read:
 *
 *  - `runBillingReadinessCheck` (P8c) evaluates ONE environment record for
 *    internal consistency: the parsed `vercel.json` cron list, the webhook's
 *    handled-event-type list, and an optional snapshot of `/api/health`'s
 *    `billing` block. `scripts/billing-readiness-check.ts` now surfaces it
 *    only under `--developer` (a local shell is never deployment evidence).
 *  - `evaluateBillingReadiness` (PR-4, handoff §5) evaluates a named TARGET
 *    (`dark` / `rehearsal` / `activate-topups` / `activate-subscriptions`)
 *    against an explicit evidence bundle gathered from the deployment
 *    itself. See the "Per-target readiness" section at the bottom of this
 *    file.
 *
 * Every caller is responsible for supplying what it wants evaluated. This is a DIAGNOSTIC tool only: the actual boot-time isolation
 * enforcement remains `src/libs/environmentIsolation.ts` (which this harness
 * intentionally mirrors, not replaces) and `src/libs/billing/
 * stripePriceCarrier.ts` (which the live checkout/webhook code paths
 * actually consult). A bug in this harness can produce a wrong readiness
 * verdict; it can never itself turn a switch on or make an unconfigured
 * catalogue resolve.
 *
 * NEVER logs or returns a raw secret value, carrier id, or the raw
 * `BILLING_STRIPE_PRICE_IDS` JSON — every check below reports only booleans,
 * counts, and catalogue KEY names (never Stripe id VALUES).
 *
 * Deliberately NOT `import 'server-only'`, unlike the rest of `src/libs/
 * billing`. `scripts/billing-readiness-check.ts` (this module's CLI) has to
 * run under a plain `tsx` process — outside Next.js's server-component
 * bundling — and the `server-only` package's default export throws
 * unconditionally in that context (there is no "react-server" resolution
 * condition active), not only when something is actually bundled for the
 * browser. Every other file this module imports is chosen for the same
 * reason: `@/libs/environmentIsolation` carries zero imports of its own by
 * design (see that file's header), and `./billingWebhookEvents` is plain
 * literal data — neither throws under plain Node. This module is never
 * imported by client-bundled code (nothing under `src/app/**\/page.tsx`
 * or a Client Component references it), so the omission carries no bundling
 * risk in practice.
 *
 * The catalogue-key lists below (`KNOWN_OFFER_KEYS` / `KNOWN_TOPUP_KEYS` /
 * `KNOWN_COUPON_KEYS`) are a DELIBERATE, hand-maintained duplicate of the
 * keys in `billingOffers.ts` / `topupOffers.ts` / `promotions.ts` — those
 * modules are `server-only` and importing them here would reintroduce the
 * exact problem this file's header just explained. This is the same
 * trade-off `environmentIsolation.ts` already made for its own
 * `inspectBillingStripePriceIdsShape` (see that function's doc comment): a
 * minimal, import-free, structural check that is NOT the same function as
 * (and is never a substitute for) the catalogue-aware
 * `parseStripePriceCarrier`. A stale list here can only make this
 * diagnostic under- or over-report "still lacks an id" for a renamed
 * catalogue key; it never changes what the live boot check or checkout path
 * actually accepts.
 */

import { createHash } from 'node:crypto';

import {
  computeExpectedLivemode,
  expectedBillingPlanEnv,
  resolveRuntimeEnvironment,
} from '@/libs/environmentIsolation';

import { BILLING_WEBHOOK_HANDLED_TYPES } from './billingWebhookEvents';

/**
 * Local alias for the three billing plan environments. Deliberately NOT
 * imported from `./stripePriceCarrier` (which is `server-only` and pulls the
 * catalogue modules and `@/libs/Env` with it) — see the file header.
 */
export type BillingPlanEnvLiteral = 'dev' | 'test' | 'prod';

// Keep in sync with BillingOfferKey (billingOffers.ts), TopupOfferKey
// (topupOffers.ts) and PromotionKey (promotions.ts). See file header.
const KNOWN_OFFER_KEYS = [
  'starter_2026_08_monthly',
  'starter_2026_08_annual',
  'pro_2026_08_monthly',
  'pro_2026_08_annual',
  'elite_2026_08_monthly',
  'elite_2026_08_annual',
] as const;

const KNOWN_TOPUP_KEYS = [
  'topup_100_free_2026_08',
  'topup_250_free_2026_08',
  'topup_500_free_2026_08',
  'topup_100_paid_2026_08',
  'topup_250_paid_2026_08',
  'topup_500_paid_2026_08',
  'topup_1000_paid_2026_08',
] as const;

const KNOWN_COUPON_KEYS = ['founding_annual_2026'] as const;

const BILLING_CRON_PATHS = [
  '/api/billing/windows/evaluate',
  '/api/billing/reconcile',
] as const;

export type BillingReadinessEnv = Readonly<Record<string, string | undefined>>;

export type VercelCronEntry = { path: string; schedule?: string };

export type BillingReadinessHealthBilling = {
  dark: boolean;
  planEnvMatchesRuntime: boolean;
  schemaDrift?: 'ready';
};

export type ProvisionedBillingWebhookEndpoint = {
  id: string;
  url: string;
  livemode: boolean;
  status: string;
  enabled_events: readonly string[];
};

export type BillingReadinessCheckInput = {
  env: BillingReadinessEnv;
  vercelCrons: readonly VercelCronEntry[];
  /**
   * Event types read from the Stripe webhook endpoint configuration. This is
   * intentionally separate from the source constant: comparing a constant
   * to itself cannot prove Stripe's selected delivery types.
   */
  provisionedWebhookEndpoint?: ProvisionedBillingWebhookEndpoint;
  /** @deprecated Source event lists are never activation evidence. */
  provisionedWebhookEventTypes?: readonly string[];
  /** The exact deployed billing endpoint URL expected for this environment. */
  expectedWebhookUrl?: string;
  /** Optional snapshot of GET /api/health's `billing` block. */
  healthBilling?: BillingReadinessHealthBilling;
};

export type BillingReadinessCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type BillingReadinessCheckResult = {
  checks: BillingReadinessCheck[];
  /** Local configuration is safe to deploy while billing traffic controls stay dark. */
  readyForDarkDeploy: boolean;
  /** Activation prerequisites, including independently supplied endpoint evidence, pass. */
  readyForActivation: boolean;
};

const DARK_SWITCH_KEYS = [
  'BILLING_SUBSCRIPTIONS_ENABLED',
  'BILLING_TOPUPS_ENABLED',
  'PUBLIC_PRICING_ENABLED',
  'BILLING_TAX_COLLECTION_ENABLED',
] as const;

const WEBHOOK_SECRET_KEYS = [
  ['legacy', 'STRIPE_WEBHOOK_SECRET'],
  ['connect', 'STRIPE_CONNECT_WEBHOOK_SECRET'],
  ['billing', 'STRIPE_BILLING_WEBHOOK_SECRET'],
] as const;

function checkBillingPlanEnv(env: BillingReadinessEnv): BillingReadinessCheck {
  let runtimeEnvironment: ReturnType<typeof resolveRuntimeEnvironment>;
  try {
    runtimeEnvironment = resolveRuntimeEnvironment(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unresolvable runtime environment';
    return { id: 'billing_plan_env', ok: false, detail: `runtime environment could not be resolved: ${message}` };
  }
  const expected = expectedBillingPlanEnv(runtimeEnvironment);
  const actual = env.BILLING_PLAN_ENV;
  if (actual !== expected) {
    return {
      id: 'billing_plan_env',
      ok: false,
      detail: `BILLING_PLAN_ENV is "${actual ?? '(unset)'}"; runtime "${runtimeEnvironment}" expects "${expected}"`,
    };
  }
  return {
    id: 'billing_plan_env',
    ok: true,
    detail: `BILLING_PLAN_ENV="${actual}" matches runtime "${runtimeEnvironment}"`,
  };
}

function checkWebhookSecretDistinctness(env: BillingReadinessEnv): BillingReadinessCheck {
  const present: Array<{ label: string; value: string }> = [];
  for (const [label, key] of WEBHOOK_SECRET_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== '') {
      present.push({ label, value });
    }
  }

  const collisions: string[] = [];
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      if (present[i]!.value === present[j]!.value) {
        collisions.push(`${present[i]!.label} == ${present[j]!.label}`);
      }
    }
  }

  if (collisions.length > 0) {
    return {
      id: 'webhook_secret_distinctness',
      ok: false,
      detail: `secrets collide (values never shown): ${collisions.join(', ')}`,
    };
  }
  return {
    id: 'webhook_secret_distinctness',
    ok: true,
    detail: `${present.length}/3 webhook secrets present, all pairwise distinct`,
  };
}

export type CarrierShapeInspection =
  | { status: 'absent' }
  | { status: 'malformed' }
  | { status: 'env_mismatch'; carrierEnv: string }
  | {
    status: 'ok';
    carrierEnv: BillingPlanEnvLiteral;
    missingOfferKeys: string[];
    missingTopupKeys: string[];
    missingCouponKeys: string[];
    configuredCounts: { offers: number; topups: number; coupons: number };
    /**
     * Every configured Stripe id, sorted. NEVER returned to a caller that
     * prints — `evaluateBillingReadiness` uses it only to compute the
     * SHA-256 digest below, which is what the deployment and the pulled
     * env file are compared on.
     */
    ids: string[];
  };

const STRIPE_ID_SHAPE = /^(?:price|coupon|promo)_[A-Za-z0-9]{8,}$/;

/**
 * Minimal, import-free structural inspection — see the file header for why
 * this duplicates (rather than imports) the catalogue-aware parser.
 */
function inspectCarrier(raw: string | undefined, expectedEnv: string | undefined): CarrierShapeInspection {
  if (raw === undefined || raw.trim() === '') {
    return { status: 'absent' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'malformed' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'malformed' };
  }
  const record = parsed as Record<string, unknown>;
  const carrierEnv = record.env;
  if (carrierEnv !== 'dev' && carrierEnv !== 'test' && carrierEnv !== 'prod') {
    return { status: 'malformed' };
  }
  if (carrierEnv !== expectedEnv) {
    return { status: 'env_mismatch', carrierEnv };
  }

  const sections: Array<['offers' | 'topups' | 'coupons', readonly string[]]> = [
    ['offers', KNOWN_OFFER_KEYS],
    ['topups', KNOWN_TOPUP_KEYS],
    ['coupons', KNOWN_COUPON_KEYS],
  ];
  const missing: Record<'offers' | 'topups' | 'coupons', string[]> = { offers: [], topups: [], coupons: [] };
  const configuredCounts: Record<'offers' | 'topups' | 'coupons', number> = { offers: 0, topups: 0, coupons: 0 };
  const seenIds = new Set<string>();
  for (const [section, knownKeys] of sections) {
    const value = record[section];
    const configuredKeys = new Set<string>();
    if (value !== undefined) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { status: 'malformed' };
      }
      for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
        if (!knownKeys.includes(key) || typeof id !== 'string' || !STRIPE_ID_SHAPE.test(id) || seenIds.has(id)) {
          return { status: 'malformed' };
        }
        seenIds.add(id);
        configuredKeys.add(key);
      }
    }
    configuredCounts[section] = configuredKeys.size;
    for (const knownKey of knownKeys) {
      if (!configuredKeys.has(knownKey)) {
        missing[section].push(knownKey);
      }
    }
  }

  return {
    status: 'ok',
    carrierEnv,
    missingOfferKeys: missing.offers,
    missingTopupKeys: missing.topups,
    missingCouponKeys: missing.coupons,
    configuredCounts,
    ids: [...seenIds].sort(),
  };
}

function checkStripePriceCarrier(env: BillingReadinessEnv): BillingReadinessCheck {
  const inspection = inspectCarrier(env.BILLING_STRIPE_PRICE_IDS, env.BILLING_PLAN_ENV);
  switch (inspection.status) {
    case 'absent':
      return { id: 'stripe_price_carrier', ok: true, detail: 'no carrier provisioned (dark) — resolvers fall back to the committed null placeholder tables' };
    case 'malformed':
      return { id: 'stripe_price_carrier', ok: false, detail: 'BILLING_STRIPE_PRICE_IDS is present but not well-formed (fails closed at boot)' };
    case 'env_mismatch':
      return {
        id: 'stripe_price_carrier',
        ok: false,
        detail: `BILLING_STRIPE_PRICE_IDS.env="${inspection.carrierEnv}" does not match BILLING_PLAN_ENV="${env.BILLING_PLAN_ENV ?? '(unset)'}" (boot-fatal — environmentIsolation.ts rejects this)`,
      };
    case 'ok': {
      const totalMissing = inspection.missingOfferKeys.length
        + inspection.missingTopupKeys.length
        + inspection.missingCouponKeys.length;
      const totalKnown = KNOWN_OFFER_KEYS.length + KNOWN_TOPUP_KEYS.length + KNOWN_COUPON_KEYS.length;
      const parts = [
        `offers missing ids: ${inspection.missingOfferKeys.join(', ') || 'none'}`,
        `topups missing ids: ${inspection.missingTopupKeys.join(', ') || 'none'}`,
        `coupons missing ids: ${inspection.missingCouponKeys.join(', ') || 'none'}`,
      ];
      return {
        id: 'stripe_price_carrier',
        ok: true,
        detail: `carrier env matches; ${totalKnown - totalMissing}/${totalKnown} catalogue keys configured — ${parts.join('; ')}`,
      };
    }
    default: {
      const exhaustive: never = inspection;
      return exhaustive;
    }
  }
}

function checkActivationPriceCarrier(env: BillingReadinessEnv): BillingReadinessCheck {
  const inspection = inspectCarrier(env.BILLING_STRIPE_PRICE_IDS, env.BILLING_PLAN_ENV);
  if (inspection.status === 'absent') {
    return { id: 'activation_price_carrier', ok: false, detail: 'BILLING_STRIPE_PRICE_IDS is absent; activation requires every offer, top-up, and coupon id' };
  }
  if (inspection.status === 'malformed') {
    return { id: 'activation_price_carrier', ok: false, detail: 'BILLING_STRIPE_PRICE_IDS is malformed' };
  }
  if (inspection.status === 'env_mismatch') {
    return { id: 'activation_price_carrier', ok: false, detail: `BILLING_STRIPE_PRICE_IDS.env="${inspection.carrierEnv}" does not match BILLING_PLAN_ENV` };
  }
  const missing = [
    ...inspection.missingOfferKeys,
    ...inspection.missingTopupKeys,
    ...inspection.missingCouponKeys,
  ];
  if (missing.length > 0) {
    return { id: 'activation_price_carrier', ok: false, detail: `carrier is incomplete; missing catalogue keys: ${missing.join(', ')}` };
  }
  return { id: 'activation_price_carrier', ok: true, detail: 'carrier has every offer, top-up, and coupon id for this environment' };
}

function checkDarkSwitches(env: BillingReadinessEnv): BillingReadinessCheck {
  const enabled = DARK_SWITCH_KEYS.filter(key => env[key] === 'true');
  const secretSet = Boolean(env.STRIPE_BILLING_WEBHOOK_SECRET);
  if (enabled.length > 0 || secretSet) {
    const reasons = [
      ...enabled.map(key => `${key}=true`),
      ...(secretSet ? ['STRIPE_BILLING_WEBHOOK_SECRET is set'] : []),
    ];
    return { id: 'dark_switches_unset', ok: false, detail: `not dark: ${reasons.join(', ')}` };
  }
  return { id: 'dark_switches_unset', ok: true, detail: 'all four dark switches unset and the billing webhook secret is unset' };
}

function checkActivationSwitches(env: BillingReadinessEnv): BillingReadinessCheck {
  const enabled = DARK_SWITCH_KEYS.filter(key => env[key] === 'true');
  if (enabled.length > 0) {
    return { id: 'activation_switches_unset', ok: false, detail: `activation preparation requires switches to remain unset: ${enabled.join(', ')}` };
  }
  return { id: 'activation_switches_unset', ok: true, detail: 'all billing feature switches remain unset; the webhook secret is evaluated separately' };
}

function checkCronsRegistered(vercelCrons: readonly VercelCronEntry[]): BillingReadinessCheck {
  const registeredPaths = new Set(vercelCrons.map(entry => entry.path));
  const missing = BILLING_CRON_PATHS.filter(path => !registeredPaths.has(path));
  if (missing.length > 0) {
    return {
      id: 'billing_crons_registered',
      ok: false,
      detail: `missing from vercel.json: ${missing.join(', ')}`,
    };
  }
  return {
    id: 'billing_crons_registered',
    ok: true,
    detail: `both billing crons registered (${BILLING_CRON_PATHS.join(', ')})`,
  };
}

function checkProvisionedWebhookEndpoint(
  endpoint: ProvisionedBillingWebhookEndpoint | undefined,
  expectedUrl: string | undefined,
  env: BillingReadinessEnv,
): BillingReadinessCheck {
  if (endpoint === undefined || expectedUrl === undefined) {
    return {
      id: 'provisioned_webhook_endpoint',
      ok: false,
      detail: 'Stripe endpoint event selection was not supplied; source-code constants alone are not deployment evidence',
    };
  }
  let endpointPath: string | null = null;
  let expectedPath: string | null = null;
  let invalidEndpointUrl = false;
  try {
    const endpointUrl = new URL(endpoint.url);
    const expected = new URL(expectedUrl);
    if (endpointUrl.protocol !== 'https:' || endpointUrl.pathname !== '/api/webhooks/stripe-billing') {
      return { id: 'provisioned_webhook_endpoint', ok: false, detail: 'endpoint URL is not an HTTPS billing webhook URL' };
    }
    endpointPath = endpointUrl.origin + endpointUrl.pathname;
    expectedPath = expected.origin + expected.pathname;
  } catch {
    invalidEndpointUrl = true;
  }
  if (invalidEndpointUrl || !endpoint.id || endpoint.status !== 'enabled' || endpointPath !== expectedPath) {
    return { id: 'provisioned_webhook_endpoint', ok: false, detail: 'endpoint id, enabled status, or target URL is not the expected billing endpoint' };
  }
  const expectsLive = env.BILLING_PLAN_ENV === 'prod';
  if (endpoint.livemode !== expectsLive) {
    return { id: 'provisioned_webhook_endpoint', ok: false, detail: 'endpoint livemode does not match the billing environment' };
  }
  const expected = new Set<string>(BILLING_WEBHOOK_HANDLED_TYPES);
  const actual = new Set(endpoint.enabled_events);
  const missing = [...expected].filter(type => !actual.has(type));
  const extra = [...actual].filter(type => !expected.has(type));
  if (missing.length > 0 || extra.length > 0) {
    const parts = [
      ...(missing.length > 0 ? [`missing event types: ${missing.length}`] : []),
      ...(extra.length > 0 ? [`unexpected event types: ${extra.length}`] : []),
    ];
    return { id: 'provisioned_webhook_endpoint', ok: false, detail: parts.join('; ') };
  }
  return {
    id: 'provisioned_webhook_endpoint',
    ok: true,
    detail: `Stripe endpoint selection has exactly the ${BILLING_WEBHOOK_HANDLED_TYPES.length} contracted event types`,
  };
}

/**
 * Mode of a Stripe SECRET key, from its prefix only. Mirrors the private
 * `providerMode` in `environmentIsolation.ts`: a value with surrounding or
 * embedded whitespace, or nothing after the prefix, is not a key at all.
 * The prefix is a mode marker, never the secret — this function's RESULT is
 * safe to print, its input never is.
 */
export function resolveStripeKeyMode(value: string | undefined): 'test' | 'live' | null {
  if (value === undefined || value !== value.trim() || /\s/.test(value)) {
    return null;
  }
  if (value.startsWith('sk_live_') && value.length > 'sk_live_'.length) {
    return 'live';
  }
  if (value.startsWith('sk_test_') && value.length > 'sk_test_'.length) {
    return 'test';
  }
  return null;
}

/**
 * SHA-256 (hex) over the carrier's configured Stripe ids, sorted and
 * newline-joined. This is the ONLY carrier-content fact that crosses a
 * process boundary: the deployed readiness endpoint publishes the digest,
 * the CLI recomputes it from the pulled env file, and equality proves the
 * deployment runs the carrier the file shows — without any id ever being
 * transmitted, logged, or written to an evidence file.
 *
 * Both producers MUST call this one function; a second implementation would
 * silently turn the parity check into a tautology or a permanent failure.
 */
export function computeCarrierIdDigest(ids: readonly string[]): string | null {
  if (ids.length === 0) {
    return null;
  }
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex');
}

/**
 * Key-mode/`CRON_SECRET` coupling for activation.
 *
 * Uses `computeExpectedLivemode` (`environmentIsolation.ts`) — the
 * programme's single producer of expected Stripe livemode — rather than
 * re-deriving the rule here, then requires that expectation to agree with
 * `BILLING_PLAN_ENV`. `MODE_INDETERMINATE` (runtime markers and key prefix
 * disagreeing, or an unresolvable runtime) fails closed.
 */
function checkActivationRuntimeSecrets(env: BillingReadinessEnv): BillingReadinessCheck {
  const keyMode = resolveStripeKeyMode(env.STRIPE_SECRET_KEY);
  const expectedLivemode = computeExpectedLivemode(env as Record<string, string | undefined>);
  const planEnvExpectsLive = env.BILLING_PLAN_ENV === 'prod';
  if (keyMode === null) {
    return { id: 'activation_runtime_secrets', ok: false, detail: 'STRIPE_SECRET_KEY is absent or not a well-formed sk_test_/sk_live_ key' };
  }
  if (!expectedLivemode.ok) {
    return { id: 'activation_runtime_secrets', ok: false, detail: 'expected Stripe livemode is indeterminate (runtime markers and key mode disagree)' };
  }
  if (expectedLivemode.livemode !== planEnvExpectsLive) {
    return { id: 'activation_runtime_secrets', ok: false, detail: `expected livemode ${expectedLivemode.livemode} does not match BILLING_PLAN_ENV="${env.BILLING_PLAN_ENV ?? '(unset)'}"` };
  }
  if (!env.CRON_SECRET?.trim()) {
    return { id: 'activation_runtime_secrets', ok: false, detail: 'CRON_SECRET is absent or blank' };
  }
  return { id: 'activation_runtime_secrets', ok: true, detail: `Stripe key mode "${keyMode}" matches the runtime, and CRON_SECRET is present` };
}

/**
 * PRESENCE only — see handoff §5.2/§5.3 (finding B4). The previous
 * implementation regex-tested the `whsec_` VALUE, which made the activation
 * verdict require the operator's local shell to hold the deployment's
 * webhook secret: an evidence source the handoff explicitly rules out, and
 * a value-shape assertion that proves nothing about the deployed endpoint.
 * Whether the deployed secret is the RIGHT one is proven by the unsigned-POST
 * probe (`400 INVALID_SIGNATURE`) and the deployed readiness endpoint's
 * `webhookSecretConfigured`/`webhookSecretDistinct` booleans, never here.
 */
function checkActivationWebhookSecret(env: BillingReadinessEnv): BillingReadinessCheck {
  if (!env.STRIPE_BILLING_WEBHOOK_SECRET?.trim()) {
    return { id: 'activation_webhook_secret', ok: false, detail: 'STRIPE_BILLING_WEBHOOK_SECRET is absent or blank; activation requires the dedicated endpoint secret' };
  }
  return { id: 'activation_webhook_secret', ok: true, detail: 'dedicated billing webhook secret is present (value never read or shown)' };
}

function checkNoLiveStripeKeysOutsideProduction(env: BillingReadinessEnv): BillingReadinessCheck {
  let runtimeEnvironment: ReturnType<typeof resolveRuntimeEnvironment> | null;
  try {
    runtimeEnvironment = resolveRuntimeEnvironment(env);
  } catch {
    runtimeEnvironment = null;
  }
  if (runtimeEnvironment === null) {
    return { id: 'no_live_stripe_keys_outside_production', ok: false, detail: 'runtime environment unresolved; cannot verify key mode' };
  }
  if (runtimeEnvironment === 'production') {
    return { id: 'no_live_stripe_keys_outside_production', ok: true, detail: 'production runtime — live keys are expected here, not checked by this rule' };
  }
  const secretKey = env.STRIPE_SECRET_KEY;
  if (secretKey?.startsWith('sk_live_')) {
    return { id: 'no_live_stripe_keys_outside_production', ok: false, detail: `STRIPE_SECRET_KEY is a live key on a non-production runtime ("${runtimeEnvironment}")` };
  }
  return { id: 'no_live_stripe_keys_outside_production', ok: true, detail: `no live Stripe key on non-production runtime "${runtimeEnvironment}"` };
}

function checkHealthConsistency(
  healthBilling: BillingReadinessHealthBilling,
  localDark: boolean,
  localPlanEnvOk: boolean,
): BillingReadinessCheck {
  const mismatches: string[] = [];
  if (healthBilling.schemaDrift !== 'ready') {
    mismatches.push('health schemaDrift is not ready');
  }
  if (healthBilling.dark !== localDark) {
    mismatches.push(`health billing.dark=${healthBilling.dark} but local computation says ${localDark}`);
  }
  if (healthBilling.planEnvMatchesRuntime !== localPlanEnvOk) {
    mismatches.push(`health billing.planEnvMatchesRuntime=${healthBilling.planEnvMatchesRuntime} but local computation says ${localPlanEnvOk}`);
  }
  if (mismatches.length > 0) {
    return { id: 'health_endpoint_consistency', ok: false, detail: mismatches.join('; ') };
  }
  return { id: 'health_endpoint_consistency', ok: true, detail: 'deployed /api/health billing block agrees with local expectations' };
}

/**
 * Read-only, pure evaluation of the P8c activation preconditions. See the
 * file header for scope and the security caveat (this is a diagnostic, not
 * an enforcement boundary).
 */
export function runBillingReadinessCheck(
  input: BillingReadinessCheckInput,
): BillingReadinessCheckResult {
  const planEnvCheck = checkBillingPlanEnv(input.env);
  const secretDistinctnessCheck = checkWebhookSecretDistinctness(input.env);
  const carrierCheck = checkStripePriceCarrier(input.env);
  const activationCarrierCheck = checkActivationPriceCarrier(input.env);
  const darkSwitchesCheck = checkDarkSwitches(input.env);
  const activationSwitchesCheck = checkActivationSwitches(input.env);
  const activationWebhookSecretCheck = checkActivationWebhookSecret(input.env);
  const noLiveKeysCheck = checkNoLiveStripeKeysOutsideProduction(input.env);
  const cronsCheck = checkCronsRegistered(input.vercelCrons);
  const provisionedEndpointCheck = checkProvisionedWebhookEndpoint(input.provisionedWebhookEndpoint, input.expectedWebhookUrl, input.env);
  const activationRuntimeSecretsCheck = checkActivationRuntimeSecrets(input.env);

  const checks: BillingReadinessCheck[] = [
    planEnvCheck,
    secretDistinctnessCheck,
    carrierCheck,
    darkSwitchesCheck,
    noLiveKeysCheck,
    cronsCheck,
    provisionedEndpointCheck,
    activationRuntimeSecretsCheck,
    activationCarrierCheck,
    activationWebhookSecretCheck,
    activationSwitchesCheck,
  ];

  const healthCheck = input.healthBilling
    ? checkHealthConsistency(input.healthBilling, darkSwitchesCheck.ok, planEnvCheck.ok)
    : null;
  if (healthCheck !== null) {
    checks.push(healthCheck);
  }

  const readyForDarkDeploy = planEnvCheck.ok
    && secretDistinctnessCheck.ok
    && carrierCheck.ok
    && darkSwitchesCheck.ok
    && noLiveKeysCheck.ok
    && (healthCheck?.ok ?? true);
  // Activation is intentionally not derived from readyForDarkDeploy: a
  // dedicated webhook secret is required activation evidence, while its
  // presence correctly makes the deployment non-dark.
  const readyForActivation = planEnvCheck.ok
    && secretDistinctnessCheck.ok
    && activationCarrierCheck.ok
    && activationWebhookSecretCheck.ok
    && activationSwitchesCheck.ok
    && noLiveKeysCheck.ok
    && cronsCheck.ok
    && provisionedEndpointCheck.ok
    && activationRuntimeSecretsCheck.ok
    && (healthCheck?.ok ?? true);

  return { checks, readyForDarkDeploy, readyForActivation };
}

// ===========================================================================
// Per-target readiness (PR-4 — handoff §5.1/§5.2/§5.3)
// ===========================================================================
//
// `runBillingReadinessCheck` above answers "is this ONE environment record
// internally consistent". It cannot answer "is THIS deployment in the state
// target X requires", because a local environment record is never deployment
// evidence (handoff §5.2). `evaluateBillingReadiness` below takes an explicit
// EVIDENCE BUNDLE instead — facts read from a deployed health response, the
// deployed readiness endpoint, a pulled env file, and operator-saved provider
// exports — and evaluates the conjunction the named target requires.
//
// It is pure over that bundle: no fetch, no filesystem, no `process.env`, no
// Stripe, no database. `scripts/billing-readiness-check.ts` is the only thing
// that gathers evidence, and it records where every fact came from.
//
// Absent evidence is NEVER a pass. A required input that was not supplied is
// reported in `missingEvidence` (the CLI turns that into exit 5), which is
// deliberately distinct from a supplied input whose content is wrong (a
// failing check → exit 4) and from a source that cannot prove the target at
// all (`evidence_source` failing → exit 6).

export type BillingReadinessTarget
  = | 'dark'
  | 'rehearsal'
  | 'activate-topups'
  | 'activate-subscriptions';

export const BILLING_READINESS_TARGETS: readonly BillingReadinessTarget[] = [
  'dark',
  'rehearsal',
  'activate-topups',
  'activate-subscriptions',
] as const;

/**
 * `deployed` — facts read from the target deployment itself.
 * `env-file`  — a `vercel env pull` output for the target scope: provisioning
 *               evidence (names, and the carrier's content) but NOT proof of
 *               what the running deployment loaded.
 * `local`     — the operator's own shell. Never deployment evidence; accepted
 *               only behind `--developer` and never allowed to exit 0.
 */
export type BillingReadinessEvidenceSource = 'deployed' | 'env-file' | 'local';

export type BillingReadinessEnvironment = 'preview' | 'production';

export type BillingReadinessSwitches = {
  subscriptions: boolean;
  topups: boolean;
  publicPricing: boolean;
  taxCollection: boolean;
};

export type BillingReadinessCarrierFacts = {
  present: boolean;
  env: BillingPlanEnvLiteral | null;
  offers: number;
  topups: number;
  coupons: number;
  /** SHA-256 of the sorted id list — see `computeCarrierIdDigest`. */
  digest: string | null;
  /** `'absent'`, `'ok'`, or a non-secret rejection reason. */
  parse: string;
};

/**
 * The exact body `GET /api/billing/readiness` returns. Presence booleans and
 * non-secret facts only — never a secret, an id, or a URL with a token in it.
 */
export type BillingReadinessEndpointFacts = {
  planEnv: string | null;
  planEnvMatchesRuntime: boolean;
  vercelEnv: BillingReadinessEnvironment | null;
  gitSha: string | null;
  appOrigin: string | null;
  switches: BillingReadinessSwitches;
  webhookSecretConfigured: boolean;
  webhookSecretDistinct: boolean;
  stripeKeyMode: 'test' | 'live' | null;
  cronSecretConfigured: boolean;
  identityHmacConfigured: boolean;
  identityHmacVersion: number | null;
  carrier: BillingReadinessCarrierFacts;
  deploymentMarker: boolean;
  timestamp: string;
};

/** The billing-relevant subset of a deployed `GET /api/health` response. */
export type BillingReadinessHealthFacts = {
  httpStatus: number;
  status: string;
  dark: boolean;
  planEnvMatchesRuntime: boolean;
  schemaDrift: string;
  /** Short commit sha, as `/api/health` reports it; `null` when unset. */
  gitSha: string | null;
};

export type BillingCronInvocationProof = {
  invocations: readonly { path: string; status: number; body?: unknown }[];
  recordedAt: string;
};

export type BillingPortalConfigurationExport = {
  id: string;
  is_default: boolean;
  livemode?: boolean;
  features?: { subscription_update?: { enabled?: boolean } };
};

export type BillingIntegrityReport = {
  exitCode: number;
  violations: readonly unknown[];
};

/** The carrier as read from a pulled env file — ids stay inside this object. */
export type BillingReadinessEnvFileCarrier = {
  raw: CarrierShapeInspection;
  digest: string | null;
};

export type BillingReadinessEvidence = {
  source: BillingReadinessEvidenceSource;
  /** Declared target environment; drives the Preview-specific allowances. */
  environment: BillingReadinessEnvironment | null;
  /** The origin every URL-shaped fact is compared against. */
  origin: string | null;
  health?: BillingReadinessHealthFacts;
  readiness?: BillingReadinessEndpointFacts;
  /** Variable NAMES present in the pulled env file (values never carried). */
  envFileNames?: readonly string[];
  envFileCarrier?: BillingReadinessEnvFileCarrier;
  /** `vercel.json` crons AT THE DEPLOYED SHA — never the working tree's. */
  vercelCrons?: readonly VercelCronEntry[];
  cronProof?: BillingCronInvocationProof;
  webhookEndpoint?: ProvisionedBillingWebhookEndpoint;
  portalConfigurations?: readonly BillingPortalConfigurationExport[];
  integrityReport?: BillingIntegrityReport;
};

export type BillingReadinessEvaluation = {
  target: BillingReadinessTarget;
  evidenceSource: BillingReadinessEvidenceSource;
  checks: BillingReadinessCheck[];
  met: boolean;
  missingEvidence: string[];
};

function expectedPlanEnvForTarget(target: BillingReadinessTarget): BillingPlanEnvLiteral | null {
  switch (target) {
    case 'rehearsal':
      return 'test';
    case 'activate-topups':
    case 'activate-subscriptions':
      return 'prod';
    default:
      return null;
  }
}

function expectedEnvironmentForTarget(target: BillingReadinessTarget): BillingReadinessEnvironment | null {
  switch (target) {
    case 'rehearsal':
      return 'preview';
    case 'activate-topups':
    case 'activate-subscriptions':
      return 'production';
    default:
      return null;
  }
}

/**
 * D11: `PUBLIC_PRICING_ENABLED` and `BILLING_TAX_COLLECTION_ENABLED` are
 * blocked for every target. `activate-subscriptions` is the ONLY target that
 * tolerates an already-flipped `BILLING_TOPUPS_ENABLED` — activating
 * subscriptions after top-ups is the documented order, and requiring all four
 * switches unset is exactly the defect (#225 finding B2) that made that
 * sequence unprovable.
 */
function expectedSwitchesForTarget(target: BillingReadinessTarget): {
  subscriptions: boolean | 'any';
  topups: boolean | 'any';
  publicPricing: boolean;
  taxCollection: boolean;
} {
  switch (target) {
    case 'rehearsal':
      return { subscriptions: true, topups: true, publicPricing: false, taxCollection: false };
    case 'activate-subscriptions':
      return { subscriptions: false, topups: 'any', publicPricing: false, taxCollection: false };
    case 'activate-topups':
    case 'dark':
    default:
      return { subscriptions: false, topups: false, publicPricing: false, taxCollection: false };
  }
}

function switchSummary(switches: BillingReadinessSwitches): string {
  return `subscriptions=${switches.subscriptions}, topups=${switches.topups}, publicPricing=${switches.publicPricing}, taxCollection=${switches.taxCollection}`;
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

class CheckCollector {
  readonly checks: BillingReadinessCheck[] = [];
  readonly missingEvidence: string[] = [];

  add(id: string, ok: boolean, detail: string): void {
    this.checks.push({ id, ok, detail });
  }

  /** Records a required input that was not supplied at all (CLI exit 5). */
  missing(id: string, evidenceName: string, detail: string): void {
    if (!this.missingEvidence.includes(evidenceName)) {
      this.missingEvidence.push(evidenceName);
    }
    this.checks.push({ id, ok: false, detail });
  }
}

function evaluateEvidenceSource(
  collector: CheckCollector,
  target: BillingReadinessTarget,
  evidence: BillingReadinessEvidence,
): void {
  if (evidence.source === 'local') {
    collector.add(
      'evidence_source',
      false,
      'evidence source is the local developer shell — never deployment proof for any target (handoff §5.2)',
    );
    return;
  }
  if (target === 'dark') {
    collector.add(
      'evidence_source',
      true,
      `evidence source "${evidence.source}" is accepted for target "dark" (deployed health remains required)`,
    );
    return;
  }
  if (evidence.source !== 'deployed') {
    collector.add(
      'evidence_source',
      false,
      `target "${target}" requires evidence source "deployed" (a reachable readiness endpoint); "${evidence.source}" can supplement it but cannot prove it`,
    );
    return;
  }
  collector.add('evidence_source', true, `evidence source "deployed" satisfies target "${target}"`);
}

function evaluateDeployedHealth(
  collector: CheckCollector,
  target: BillingReadinessTarget,
  evidence: BillingReadinessEvidence,
): void {
  const health = evidence.health;
  if (health === undefined) {
    collector.missing('health_schema_drift_ready', 'deployed health (--health-url/--health-file)', 'deployed /api/health was not supplied');
    if (target === 'dark') {
      collector.missing('health_billing_dark', 'deployed health (--health-url/--health-file)', 'deployed /api/health was not supplied');
      collector.missing('health_plan_env_matches_runtime', 'deployed health (--health-url/--health-file)', 'deployed /api/health was not supplied');
    }
    return;
  }
  if (target === 'dark') {
    collector.add('health_billing_dark', health.dark, `deployed /api/health billing.dark=${health.dark}`);
    collector.add(
      'health_plan_env_matches_runtime',
      health.planEnvMatchesRuntime,
      `deployed /api/health billing.planEnvMatchesRuntime=${health.planEnvMatchesRuntime}`,
    );
  }
  collector.add('health_schema_drift_ready', health.schemaDrift === 'ready', `deployed /api/health schemaDrift="${health.schemaDrift}"`);
  // A Preview deployment is structurally `degraded` (redis / Resend / Google
  // Calendar are not provisioned on the branch scope), so the aggregate status
  // is REPORTED, never a term of the billing verdict — handoff §6 row X7.
  if (health.status !== 'ok') {
    collector.add(
      'health_aggregate_status_reported',
      true,
      `deployed /api/health status="${health.status}" (HTTP ${health.httpStatus}) — reported, not a billing-verdict term`,
    );
  }
}

function evaluateDarkEndpointFacts(collector: CheckCollector, readiness: BillingReadinessEndpointFacts): void {
  collector.add(
    'readiness_webhook_secret_absent',
    !readiness.webhookSecretConfigured,
    `deployment reports webhookSecretConfigured=${readiness.webhookSecretConfigured} (dark requires false)`,
  );
  const switchesUnset = !readiness.switches.subscriptions
    && !readiness.switches.topups
    && !readiness.switches.publicPricing
    && !readiness.switches.taxCollection;
  collector.add('readiness_switches_unset', switchesUnset, `deployment switches: ${switchSummary(readiness.switches)}`);
  const expectedMode = readiness.planEnv === 'prod' ? 'live' : 'test';
  collector.add(
    'readiness_key_mode_consistent',
    readiness.stripeKeyMode === expectedMode,
    `deployment stripeKeyMode="${readiness.stripeKeyMode ?? 'null'}"; planEnv="${readiness.planEnv ?? 'null'}" expects "${expectedMode}"`,
  );
}

function evaluateEnvFileDarkFacts(collector: CheckCollector, evidence: BillingReadinessEvidence): void {
  const names = evidence.envFileNames ?? [];
  const carrier = evidence.envFileCarrier;
  if (carrier === undefined) {
    collector.add('env_file_carrier_shape', true, 'pulled env file carries no BILLING_STRIPE_PRICE_IDS (expected while dark)');
  } else {
    const status = carrier.raw.status;
    collector.add(
      'env_file_carrier_shape',
      status === 'absent' || status === 'ok',
      `pulled env file carrier parse: ${status}`,
    );
  }
  const enabled = DARK_SWITCH_KEYS.filter(key => names.includes(key));
  collector.add(
    'env_file_switches_unset',
    enabled.length === 0,
    enabled.length === 0
      ? 'pulled env file declares none of the four billing switches'
      : `pulled env file declares: ${enabled.join(', ')}`,
  );
  const billingSecretDeclared = names.includes('STRIPE_BILLING_WEBHOOK_SECRET');
  collector.add(
    'env_file_billing_secret_absent',
    !billingSecretDeclared,
    billingSecretDeclared
      ? 'pulled env file declares STRIPE_BILLING_WEBHOOK_SECRET (name only) — the billing webhook is live in this scope'
      : 'pulled env file does not declare STRIPE_BILLING_WEBHOOK_SECRET',
  );
}

function evaluateActivationEndpointFacts(
  collector: CheckCollector,
  target: BillingReadinessTarget,
  evidence: BillingReadinessEvidence,
  readiness: BillingReadinessEndpointFacts,
): void {
  const expectedPlanEnv = expectedPlanEnvForTarget(target);
  const expectedEnvironment = expectedEnvironmentForTarget(target);
  const expectedKeyMode = expectedPlanEnv === 'prod' ? 'live' : 'test';

  collector.add(
    'readiness_plan_env',
    readiness.planEnv === expectedPlanEnv && readiness.planEnvMatchesRuntime,
    `deployment planEnv="${readiness.planEnv ?? 'null'}" (expected "${expectedPlanEnv}"), planEnvMatchesRuntime=${readiness.planEnvMatchesRuntime}`,
  );
  collector.add(
    'readiness_vercel_env',
    readiness.vercelEnv === expectedEnvironment,
    `deployment vercelEnv="${readiness.vercelEnv ?? 'null'}" (expected "${expectedEnvironment}")`,
  );
  collector.add(
    'readiness_stripe_key_mode',
    readiness.stripeKeyMode === expectedKeyMode,
    `deployment stripeKeyMode="${readiness.stripeKeyMode ?? 'null'}" (expected "${expectedKeyMode}")`,
  );

  const expectedSwitches = expectedSwitchesForTarget(target);
  const switchFailures: string[] = [];
  if (expectedSwitches.subscriptions !== 'any' && readiness.switches.subscriptions !== expectedSwitches.subscriptions) {
    switchFailures.push(`subscriptions must be ${expectedSwitches.subscriptions}`);
  }
  if (expectedSwitches.topups !== 'any' && readiness.switches.topups !== expectedSwitches.topups) {
    switchFailures.push(`topups must be ${expectedSwitches.topups}`);
  }
  if (readiness.switches.publicPricing !== expectedSwitches.publicPricing) {
    switchFailures.push('publicPricing must be false (D11)');
  }
  if (readiness.switches.taxCollection !== expectedSwitches.taxCollection) {
    switchFailures.push('taxCollection must be false (D11)');
  }
  collector.add(
    'readiness_switches',
    switchFailures.length === 0,
    switchFailures.length === 0
      ? `deployment switches match target "${target}": ${switchSummary(readiness.switches)}`
      : `${switchFailures.join('; ')} — observed ${switchSummary(readiness.switches)}`,
  );

  collector.add(
    'readiness_webhook_secret',
    readiness.webhookSecretConfigured && readiness.webhookSecretDistinct,
    `deployment webhookSecretConfigured=${readiness.webhookSecretConfigured}, webhookSecretDistinct=${readiness.webhookSecretDistinct} (values never read)`,
  );
  collector.add(
    'readiness_identity_hmac',
    readiness.identityHmacConfigured,
    `deployment identityHmacConfigured=${readiness.identityHmacConfigured}, version=${readiness.identityHmacVersion ?? 'null'}`,
  );
  collector.add(
    'readiness_cron_secret',
    readiness.cronSecretConfigured,
    `deployment cronSecretConfigured=${readiness.cronSecretConfigured}`,
  );

  const expectedOrigin = normalizeOrigin(evidence.origin);
  const reportedOrigin = normalizeOrigin(readiness.appOrigin);
  collector.add(
    'readiness_app_origin',
    expectedOrigin !== null && reportedOrigin === expectedOrigin,
    `deployment appOrigin="${readiness.appOrigin ?? 'null'}" vs target origin "${evidence.origin ?? 'null'}" (a localhost fallback here sends test-mode Checkout returns to the wrong host — handoff §6 row X5)`,
  );
}

function evaluateCarrier(
  collector: CheckCollector,
  target: BillingReadinessTarget,
  evidence: BillingReadinessEvidence,
  readiness: BillingReadinessEndpointFacts,
): void {
  const expectedPlanEnv = expectedPlanEnvForTarget(target);
  const deployed = readiness.carrier;
  const envFileCarrier = evidence.envFileCarrier;

  if (envFileCarrier === undefined) {
    collector.missing('carrier_complete', 'pulled env file (--env-file)', 'no pulled env file was supplied; catalogue completeness cannot be proven from the deployment alone (the endpoint publishes counts and a digest, never ids)');
    collector.missing('carrier_digest_parity', 'pulled env file (--env-file)', 'no pulled env file was supplied; digest parity cannot be computed');
    return;
  }

  const inspection = envFileCarrier.raw;
  if (inspection.status !== 'ok') {
    collector.add('carrier_complete', false, `pulled env file carrier parse: ${inspection.status}`);
    collector.add('carrier_digest_parity', false, 'pulled env file carrier did not parse; digest parity is not computable');
    return;
  }

  // §5.1 requires BOTH catalogues complete. The coupon is reported but not
  // required: the founding promotion is offered per owner decision, and its
  // redemption window is closed in code until separately configured.
  const missingKeys = [...inspection.missingOfferKeys, ...inspection.missingTopupKeys];
  const carrierEnvOk = inspection.carrierEnv === expectedPlanEnv && deployed.env === expectedPlanEnv;
  const parseOk = deployed.parse === 'ok';
  collector.add(
    'carrier_complete',
    missingKeys.length === 0 && carrierEnvOk && parseOk,
    `pulled env file carrier env="${inspection.carrierEnv}" (expected "${expectedPlanEnv}"), deployment carrier env="${deployed.env ?? 'null'}" parse="${deployed.parse}"; offers ${inspection.configuredCounts.offers}/${KNOWN_OFFER_KEYS.length}, topups ${inspection.configuredCounts.topups}/${KNOWN_TOPUP_KEYS.length}, coupons ${inspection.configuredCounts.coupons}/${KNOWN_COUPON_KEYS.length}${missingKeys.length > 0 ? `; missing catalogue keys: ${missingKeys.join(', ')}` : ''}`,
  );

  const localDigest = envFileCarrier.digest;
  collector.add(
    'carrier_digest_parity',
    localDigest !== null && deployed.digest !== null && localDigest === deployed.digest,
    localDigest === null || deployed.digest === null
      ? `digest parity not provable (pulled env file digest ${localDigest === null ? 'absent' : 'present'}, deployment digest ${deployed.digest === null ? 'absent' : 'present'})`
      : localDigest === deployed.digest
        ? 'the deployment runs the same carrier the pulled env file shows (SHA-256 id digests match; no id is transmitted)'
        : 'the deployment is running a DIFFERENT carrier than the pulled env file shows (SHA-256 id digests differ)',
  );
}

function evaluateCrons(
  collector: CheckCollector,
  evidence: BillingReadinessEvidence,
): void {
  if (evidence.vercelCrons === undefined) {
    collector.missing('billing_crons_registered', 'vercel.json at the deployed gitSha', 'vercel.json at the deployed gitSha was not available');
  } else {
    collector.checks.push(checkCronsRegistered(evidence.vercelCrons));
  }

  // Registration alone is not proof anywhere: Vercel never schedules Preview
  // crons at all (handoff §6 row X4), and a Production schedule still has to
  // be shown to have RUN. Both targets therefore require the invocation proof.
  const proof = evidence.cronProof;
  if (proof === undefined) {
    collector.missing('cron_invocation_proof', 'cron invocation proof (--cron-proof-file)', 'no cron-invocation proof was supplied; registration alone never proves the jobs ran');
    return;
  }
  const failures: string[] = [];
  for (const path of BILLING_CRON_PATHS) {
    const invocation = proof.invocations.find(entry => entry.path === path);
    if (invocation === undefined) {
      failures.push(`no recorded invocation of ${path}`);
    } else if (invocation.status !== 200) {
      failures.push(`${path} returned HTTP ${invocation.status}`);
    }
  }
  collector.add(
    'cron_invocation_proof',
    failures.length === 0,
    failures.length === 0
      ? `both billing crons recorded a 200 at ${proof.recordedAt}`
      : failures.join('; '),
  );
}

function evaluateWebhookEndpoint(
  collector: CheckCollector,
  target: BillingReadinessTarget,
  evidence: BillingReadinessEvidence,
): void {
  if (evidence.webhookEndpoint === undefined) {
    collector.missing('provisioned_webhook_endpoint', 'Stripe endpoint export (--webhook-endpoint-file)', 'no Stripe webhook-endpoint object export was supplied; source-code constants alone are not deployment evidence');
    return;
  }
  const origin = normalizeOrigin(evidence.origin);
  if (origin === null) {
    collector.missing('provisioned_webhook_endpoint', 'target origin (--health-url)', 'no target origin was supplied; the endpoint URL cannot be compared to anything');
    return;
  }
  // Reuses the #225 validator unchanged (URL/protocol/path/status/livemode and
  // the exact 13 event types); the target supplies the expected plan env, so
  // livemode is coupled to the TARGET rather than to a local env record.
  collector.checks.push(checkProvisionedWebhookEndpoint(
    evidence.webhookEndpoint,
    `${origin}/api/webhooks/stripe-billing`,
    { BILLING_PLAN_ENV: expectedPlanEnvForTarget(target) ?? undefined },
  ));
}

function evaluatePortalConfiguration(
  collector: CheckCollector,
  target: BillingReadinessTarget,
  evidence: BillingReadinessEvidence,
): void {
  const configurations = evidence.portalConfigurations;
  if (configurations === undefined) {
    collector.missing('portal_subscription_update_disabled', 'Stripe portal export (--portal-config-file)', 'no Billing Portal configuration export was supplied');
    return;
  }
  const expectsLive = expectedPlanEnvForTarget(target) === 'prod';
  const defaults = configurations.filter(configuration => configuration.is_default === true);
  if (defaults.length !== 1) {
    collector.add(
      'portal_subscription_update_disabled',
      false,
      `portal export contains ${defaults.length} default configurations; exactly one is required`,
    );
    return;
  }
  const configuration = defaults[0]!;
  const updateEnabled = configuration.features?.subscription_update?.enabled;
  const livemodeOk = configuration.livemode === undefined || configuration.livemode === expectsLive;
  collector.add(
    'portal_subscription_update_disabled',
    updateEnabled === false && livemodeOk,
    `default portal configuration features.subscription_update.enabled=${String(updateEnabled)} (D16 requires false), livemode=${String(configuration.livemode)} (expected ${expectsLive})`,
  );
}

function evaluateIntegrityReport(collector: CheckCollector, evidence: BillingReadinessEvidence): void {
  const report = evidence.integrityReport;
  if (report === undefined) {
    collector.missing('integrity_report_clean', 'integrity report (--integrity-report)', 'no billing-integrity report was supplied');
    return;
  }
  collector.add(
    'integrity_report_clean',
    report.exitCode === 0 && report.violations.length === 0,
    `integrity report exitCode=${report.exitCode}, violations=${report.violations.length}`,
  );
}

/**
 * Evaluate ONE named target against an explicit evidence bundle. Pure; see
 * the section header above for the evidence model and the three distinct
 * failure classes (`met: false`, non-empty `missingEvidence`, and a failing
 * `evidence_source` check).
 */
export function evaluateBillingReadiness(input: {
  target: BillingReadinessTarget;
  evidence: BillingReadinessEvidence;
}): BillingReadinessEvaluation {
  const { target, evidence } = input;
  const collector = new CheckCollector();

  evaluateEvidenceSource(collector, target, evidence);
  evaluateDeployedHealth(collector, target, evidence);

  if (target === 'dark') {
    if (evidence.readiness !== undefined) {
      evaluateDarkEndpointFacts(collector, evidence.readiness);
    }
    if (evidence.source === 'env-file' || evidence.envFileNames !== undefined) {
      evaluateEnvFileDarkFacts(collector, evidence);
    }
  } else {
    const readiness = evidence.readiness;
    if (readiness === undefined) {
      collector.missing(
        'readiness_endpoint_reachable',
        'deployed readiness endpoint (--readiness-url/--readiness-file)',
        `target "${target}" is proven from GET /api/billing/readiness on the target deployment; it was not readable`,
      );
    } else {
      collector.add('readiness_endpoint_reachable', true, `readiness endpoint reported at ${readiness.timestamp} (gitSha ${readiness.gitSha ?? 'null'})`);
      evaluateActivationEndpointFacts(collector, target, evidence, readiness);
      evaluateCarrier(collector, target, evidence, readiness);
    }
    evaluateCrons(collector, evidence);
    evaluateWebhookEndpoint(collector, target, evidence);
    evaluatePortalConfiguration(collector, target, evidence);
    evaluateIntegrityReport(collector, evidence);
  }

  const met = collector.missingEvidence.length === 0
    && collector.checks.every(check => check.ok);

  return {
    target,
    evidenceSource: evidence.source,
    checks: collector.checks,
    met,
    missingEvidence: collector.missingEvidence,
  };
}

/**
 * Inspect a carrier value read from a pulled env file, returning the shape
 * inspection plus the digest the deployment's `carrier.digest` is compared
 * against. The ids themselves never leave this function's return value, and
 * no caller prints it.
 */
export function inspectEnvFileCarrier(
  raw: string | undefined,
  expectedEnv: string | undefined,
): BillingReadinessEnvFileCarrier {
  const inspection = inspectCarrier(raw, expectedEnv);
  return {
    raw: inspection,
    digest: inspection.status === 'ok' ? computeCarrierIdDigest(inspection.ids) : null,
  };
}
