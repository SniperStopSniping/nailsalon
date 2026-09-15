/**
 * Billing production readiness harness — P8c.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §12,
 * §20, §4. Plan: docs/luster-billing-remaining-work-plan.md §5 "P8c".
 * Runbook: docs/BILLING_PRODUCTION_RUNBOOK.md.
 *
 * Pure over its inputs: `runBillingReadinessCheck` takes an explicit
 * environment record, the parsed `vercel.json` cron list, the webhook's
 * handled-event-type list, and an optional snapshot of `/api/health`'s
 * `billing` block. It makes no network call, no database call, no Stripe
 * call, and reads no ambient `process.env` on its own — every caller (the
 * unit tests, and the CLI below) is responsible for supplying what it wants
 * evaluated. This is a DIAGNOSTIC tool only: the actual boot-time isolation
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

import {
  expectedBillingPlanEnv,
  resolveRuntimeEnvironment,
} from '@/libs/environmentIsolation';

import { BILLING_WEBHOOK_HANDLED_TYPES } from './billingWebhookEvents';

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

type CarrierShapeInspection =
  | { status: 'absent' }
  | { status: 'malformed' }
  | { status: 'env_mismatch'; carrierEnv: string }
  | {
    status: 'ok';
    missingOfferKeys: string[];
    missingTopupKeys: string[];
    missingCouponKeys: string[];
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
    for (const knownKey of knownKeys) {
      if (!configuredKeys.has(knownKey)) {
        missing[section].push(knownKey);
      }
    }
  }

  return {
    status: 'ok',
    missingOfferKeys: missing.offers,
    missingTopupKeys: missing.topups,
    missingCouponKeys: missing.coupons,
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

function checkActivationRuntimeSecrets(env: BillingReadinessEnv): BillingReadinessCheck {
  const key = env.STRIPE_SECRET_KEY;
  const expectedKey = env.BILLING_PLAN_ENV === 'prod' ? /^sk_live_\S+$/ : /^sk_test_\S+$/;
  if (!expectedKey.test(key ?? '') || !env.CRON_SECRET?.trim()) {
    return { id: 'activation_runtime_secrets', ok: false, detail: 'mode-matched Stripe secret key and nonblank CRON_SECRET are required' };
  }
  return { id: 'activation_runtime_secrets', ok: true, detail: 'mode-matched Stripe key and CRON_SECRET are present' };
}

function checkActivationWebhookSecret(env: BillingReadinessEnv): BillingReadinessCheck {
  if (!/^whsec_\S+$/.test(env.STRIPE_BILLING_WEBHOOK_SECRET ?? '')) {
    return { id: 'activation_webhook_secret', ok: false, detail: 'STRIPE_BILLING_WEBHOOK_SECRET is absent; activation requires the dedicated endpoint secret' };
  }
  return { id: 'activation_webhook_secret', ok: true, detail: 'dedicated billing webhook secret is present (value not shown)' };
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
