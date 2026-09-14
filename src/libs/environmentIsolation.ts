export type RuntimeEnvironment
  = | 'development'
  | 'preview'
  | 'production'
  | 'test'
  | 'ci'
  | 'unknown';

export type EnvironmentIsolationErrorCode
  = | 'APP_ENV_INVALID'
  | 'BILLING_PLAN_ENV_INVALID'
  | 'BILLING_STRIPE_PRICE_IDS_ENV_MISMATCH'
  | 'BILLING_STRIPE_PRICE_IDS_INVALID'
  | 'CI_PROVIDER_PLACEHOLDER_REQUIRED'
  | 'CLERK_KEY_MODE_INVALID'
  | 'CLERK_KEY_MODE_MISMATCH'
  | 'CLERK_KEYS_REQUIRED'
  | 'ENVIRONMENT_CONFLICT'
  | 'PRODUCTION_PLATFORM_REQUIRED'
  | 'RUNTIME_ENVIRONMENT_UNKNOWN'
  | 'STRIPE_KEY_MODE_INVALID'
  | 'STRIPE_KEY_MODE_MISMATCH'
  | 'STRIPE_KEYS_REQUIRED'
  | 'STRIPE_WEBHOOK_SECRET_COLLISION'
  | 'VERCEL_APPLICATION_MARKER_REQUIRED'
  | 'VERCEL_ENV_INVALID';

const ERROR_MESSAGES: Record<EnvironmentIsolationErrorCode, string> = {
  APP_ENV_INVALID:
    'Environment isolation rejected: APP_ENV is not an approved environment marker.',
  BILLING_PLAN_ENV_INVALID:
    'Environment isolation rejected: the billing plan environment does not match the runtime environment.',
  BILLING_STRIPE_PRICE_IDS_ENV_MISMATCH:
    'Environment isolation rejected: the Stripe price-id carrier is scoped to a different billing environment than this runtime.',
  BILLING_STRIPE_PRICE_IDS_INVALID:
    'Environment isolation rejected: the Stripe price-id carrier is not well-formed.',
  CI_PROVIDER_PLACEHOLDER_REQUIRED:
    'Environment isolation rejected: CI and test runs require the approved synthetic provider placeholders.',
  CLERK_KEY_MODE_INVALID:
    'Environment isolation rejected: Clerk keys do not use an approved environment mode.',
  CLERK_KEY_MODE_MISMATCH:
    'Environment isolation rejected: Clerk publishable and secret key modes do not match.',
  CLERK_KEYS_REQUIRED:
    'Environment isolation rejected: the Clerk key pair is incomplete.',
  ENVIRONMENT_CONFLICT:
    'Environment isolation rejected: explicit deployment environment markers conflict.',
  PRODUCTION_PLATFORM_REQUIRED:
    'Environment isolation rejected: Production is allowed only on the explicit hosting platform deployment.',
  RUNTIME_ENVIRONMENT_UNKNOWN:
    'Environment isolation rejected: the runtime environment is not explicit.',
  STRIPE_KEY_MODE_INVALID:
    'Environment isolation rejected: Stripe keys do not use an approved environment mode.',
  STRIPE_KEY_MODE_MISMATCH:
    'Environment isolation rejected: Stripe publishable and secret key modes do not match.',
  STRIPE_KEYS_REQUIRED:
    'Environment isolation rejected: the Stripe key pair or webhook secret is incomplete.',
  STRIPE_WEBHOOK_SECRET_COLLISION:
    'Environment isolation rejected: the billing and Connect webhook secrets must be distinct endpoint secrets.',
  VERCEL_APPLICATION_MARKER_REQUIRED:
    'Environment isolation rejected: the hosting platform deployment markers are incomplete.',
  VERCEL_ENV_INVALID:
    'Environment isolation rejected: VERCEL_ENV is not an approved environment marker.',
};

export class EnvironmentIsolationError extends Error {
  readonly code: EnvironmentIsolationErrorCode;

  constructor(code: EnvironmentIsolationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'EnvironmentIsolationError';
    this.code = code;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;
type ProviderMode = 'test' | 'live';

const APPROVED_CI_PROVIDER_VALUES = {
  BILLING_PLAN_ENV: new Set(['test']),
  CLERK_SECRET_KEY: new Set(['ci-placeholder-not-a-secret']),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: new Set([
    'ci-placeholder-not-a-secret',
    'pk_test_Y2kubHVzdGVyLmludmFsaWQk',
  ]),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: new Set(['ci-placeholder-not-a-secret']),
  STRIPE_SECRET_KEY: new Set(['ci-placeholder-not-a-secret']),
  STRIPE_WEBHOOK_SECRET: new Set(['ci-placeholder-not-a-secret']),
  // Deliberately the SAME literal as the billing webhook secret. The two
  // secrets must differ in a deployment, but in CI/test they are both the
  // approved placeholder — which is exactly why the collision check below sits
  // in the deployment branch only.
  STRIPE_CONNECT_WEBHOOK_SECRET: new Set(['ci-placeholder-not-a-secret']),
} as const;

function reject(code: EnvironmentIsolationErrorCode): never {
  throw new EnvironmentIsolationError(code);
}

function explicitVercelEnvironment(
  value: string | undefined,
): Exclude<RuntimeEnvironment, 'test' | 'ci' | 'unknown'> | null {
  if (value === undefined || value === '') {
    return null;
  }
  if (value === 'development' || value === 'preview' || value === 'production') {
    return value;
  }
  reject('VERCEL_ENV_INVALID');
}

function explicitApplicationEnvironment(
  value: string | undefined,
): Exclude<RuntimeEnvironment, 'test' | 'ci' | 'unknown'> | null {
  if (value === undefined || value === '') {
    return null;
  }
  if (value === 'staging') {
    return 'preview';
  }
  if (value === 'development' || value === 'preview' || value === 'production') {
    return value;
  }
  reject('APP_ENV_INVALID');
}

function enabled(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/**
 * Resolves the deployment environment without treating Next.js production-mode
 * compilation as proof of a Production deployment. Explicit Vercel and app
 * markers must agree when both are present.
 */
export function resolveRuntimeEnvironment(
  environment: Environment = process.env,
): RuntimeEnvironment {
  const vercelEnvironment = explicitVercelEnvironment(environment.VERCEL_ENV);
  const applicationEnvironment = explicitApplicationEnvironment(environment.APP_ENV);

  if (
    vercelEnvironment
    && applicationEnvironment
    && vercelEnvironment !== applicationEnvironment
  ) {
    reject('ENVIRONMENT_CONFLICT');
  }

  if (environment.NODE_ENV === 'test' || enabled(environment.VITEST)) {
    return 'test';
  }
  // GitHub Actions and Vitest are never deployment environments, even if a
  // future workflow accidentally injects Production-shaped app/Vercel markers.
  if (enabled(environment.GITHUB_ACTIONS)) {
    return 'ci';
  }
  // VERCEL_ENV is authoritative only when Vercel's separate platform marker is
  // present. A pulled user-variable file can contain APP_ENV=production, but it
  // cannot turn `next dev` into a Production runtime.
  if (environment.VERCEL === '1') {
    if (!vercelEnvironment || !applicationEnvironment) {
      reject('VERCEL_APPLICATION_MARKER_REQUIRED');
    }
    return vercelEnvironment;
  }
  // Vercel may set generic CI during a real Preview/Production build, so this
  // fallback comes after the platform-attested Vercel marker.
  if (enabled(environment.CI)) {
    return 'ci';
  }
  if (vercelEnvironment) {
    reject('VERCEL_APPLICATION_MARKER_REQUIRED');
  }
  if (applicationEnvironment === 'production') {
    reject('PRODUCTION_PLATFORM_REQUIRED');
  }
  if (applicationEnvironment) {
    return applicationEnvironment;
  }
  if (environment.NODE_ENV === 'development') {
    return 'development';
  }

  return 'unknown';
}

export type ExpectedLivemode
  = | { ok: true; livemode: boolean }
  | { ok: false; code: 'MODE_INDETERMINATE' };

/**
 * The programme's SINGLE PRODUCER of expected Stripe livemode.
 *
 * PURE. Reads only the passed environment record. Never throws, never calls
 * `reject()`, never touches Stripe, and adds no member to
 * `EnvironmentIsolationErrorCode` — `MODE_INDETERMINATE` is a *return* code that
 * callers surface on their own error type, not an isolation rejection.
 *
 * Two agreeing offline legs, because `acct_…` ids carry no mode marker and this
 * module already states that a webhook secret's mode cannot be inferred from its
 * format. The key-prefix leg is the operationally meaningful one — an event we
 * could not act on with the key we hold must not be processed — while the
 * environment leg is what the deployment markers attest. A disagreement, or an
 * environment that cannot be resolved at all, is indeterminate and callers must
 * fail closed rather than guess a default.
 *
 * SITING IS A PUBLISHED INTERFACE. This function lives here, in a file with ZERO
 * import statements, so that an unauthenticated public page graph can consume it
 * without pulling in the Stripe SDK. Do not relocate it into the stripeConnect
 * modules "where it belongs".
 */
export function computeExpectedLivemode(
  environment: Record<string, string | undefined>,
): ExpectedLivemode {
  let runtimeEnvironment: RuntimeEnvironment;
  try {
    runtimeEnvironment = resolveRuntimeEnvironment(environment);
  } catch {
    // ENVIRONMENT_CONFLICT / APP_ENV_INVALID / VERCEL_ENV_INVALID etc.
    return { ok: false, code: 'MODE_INDETERMINATE' };
  }

  const environmentSaysLive = runtimeEnvironment === 'production';
  const keySaysLive = environment.STRIPE_SECRET_KEY?.startsWith('sk_live_') === true;

  if (environmentSaysLive !== keySaysLive) {
    return { ok: false, code: 'MODE_INDETERMINATE' };
  }

  return { ok: true, livemode: environmentSaysLive };
}

function providerMode(
  value: string,
  testPrefix: string,
  livePrefix: string,
): ProviderMode | null {
  if (value !== value.trim()) {
    return null;
  }
  if (value.startsWith(testPrefix) && value.length > testPrefix.length) {
    return 'test';
  }
  if (value.startsWith(livePrefix) && value.length > livePrefix.length) {
    return 'live';
  }
  return null;
}

function requireClerkMode(environment: Environment): ProviderMode {
  const secretKey = environment.CLERK_SECRET_KEY;
  const publishableKey = environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) {
    reject('CLERK_KEYS_REQUIRED');
  }

  const secretMode = providerMode(secretKey, 'sk_test_', 'sk_live_');
  const publishableMode = providerMode(publishableKey, 'pk_test_', 'pk_live_');
  if (!secretMode || !publishableMode) {
    reject('CLERK_KEY_MODE_INVALID');
  }
  if (secretMode !== publishableMode) {
    reject('CLERK_KEY_MODE_MISMATCH');
  }
  return secretMode;
}

function requireStripeMode(environment: Environment): ProviderMode {
  const secretKey = environment.STRIPE_SECRET_KEY;
  const publishableKey = environment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey || !environment.STRIPE_WEBHOOK_SECRET) {
    reject('STRIPE_KEYS_REQUIRED');
  }

  const secretMode = providerMode(secretKey, 'sk_test_', 'sk_live_');
  const publishableMode = providerMode(publishableKey, 'pk_test_', 'pk_live_');
  if (!secretMode || !publishableMode) {
    reject('STRIPE_KEY_MODE_INVALID');
  }
  if (secretMode !== publishableMode) {
    reject('STRIPE_KEY_MODE_MISMATCH');
  }
  return secretMode;
}

function requireExactCiProviderPlaceholders(environment: Environment): void {
  for (const [key, approvedValues] of Object.entries(APPROVED_CI_PROVIDER_VALUES)) {
    const value = environment[key];
    if (!approvedValues.has(value as never)) {
      reject('CI_PROVIDER_PLACEHOLDER_REQUIRED');
    }
  }
}

/**
 * The legacy, Connect, and billing endpoints are three distinct Stripe webhook
 * endpoints, so they have three distinct signing secrets. Sharing one means one
 * endpoint could verify another's deliveries — and the billing handler resolves
 * its tenant from `session.metadata.salonId` without ever reading
 * `event.account`, so a Connect- or legacy-scoped delivery reaching it is a
 * cross-tenant billing takeover.
 *
 * The billing secret (`STRIPE_BILLING_WEBHOOK_SECRET`) is OPTIONAL — it stays
 * unset while the billing endpoint is dark (§12) — so every comparison
 * involving it MUST be guarded by its truthiness first. A bare
 * `billing === connect` (or `billing === legacy`) check would reject every
 * deployment where the billing secret is simply unset, including today's
 * production shape where Connect is also unset: `undefined === undefined` is
 * `true`, and that must never reject.
 *
 * Deployment branch ONLY. In ci/test all three are the same approved
 * placeholder by design, so evaluating this before the ci/test early return
 * would reject every CI job and every vitest run.
 */
function requireDistinctStripeWebhookSecrets(environment: Environment): void {
  const connectSecret = environment.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (connectSecret && connectSecret === environment.STRIPE_WEBHOOK_SECRET) {
    reject('STRIPE_WEBHOOK_SECRET_COLLISION');
  }

  const billingSecret = environment.STRIPE_BILLING_WEBHOOK_SECRET;
  if (
    billingSecret
    && (billingSecret === environment.STRIPE_WEBHOOK_SECRET
      || (connectSecret && billingSecret === connectSecret))
  ) {
    reject('STRIPE_WEBHOOK_SECRET_COLLISION');
  }
}

function requireBillingEnvironment(
  environment: Environment,
  expected: 'dev' | 'test' | 'prod',
): void {
  if (environment.BILLING_PLAN_ENV !== expected) {
    reject('BILLING_PLAN_ENV_INVALID');
  }
}

const CONFIGURED_STRIPE_ID_SHAPE = /^(?:price|coupon|promo)_[A-Za-z0-9]{8,}$/;
const BILLING_STRIPE_PRICE_IDS_TOP_LEVEL_KEYS = new Set(['env', 'offers', 'topups', 'coupons']);

type BillingStripePriceIdsShapeInspection = 'ok' | 'env_mismatch' | 'invalid';

/**
 * G40/D19a (contract §4, §12) — a minimal, dependency-free structural check
 * for the optional BILLING_STRIPE_PRICE_IDS carrier. Deliberately NOT the
 * same function as parseStripePriceCarrier
 * (src/libs/billing/stripePriceCarrier.ts), which is the single source of
 * truth for catalogue-key membership (BILLING_OFFERS/TOPUP_OFFERS/
 * PROMOTIONS) and is what every real resolution in stripePriceMap.ts goes
 * through. This module carries ZERO import statements by construction — see
 * computeExpectedLivemode's siting note above and
 * src/libs/stripeConnect/stripeConnect.boundaries.test.ts "31(a)", which
 * fails the build the moment this file gains one — so it cannot reach the
 * committed catalogue to validate individual keys. It therefore checks only
 * what is verifiable without any import: the env-isolation property this
 * module already owns for BILLING_PLAN_ENV itself, plus generic JSON shape,
 * id format and cross-map uniqueness. Catalogue-key validation, and the full
 * fail-closed guarantee before any Stripe call, live in
 * getStripePriceCarrier() — every resolver in stripePriceMap.ts consults it
 * first and never returns an id this check alone approved.
 */
function inspectBillingStripePriceIdsShape(
  raw: string,
  expectedEnv: 'dev' | 'test' | 'prod',
): BillingStripePriceIdsShapeInspection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'invalid';
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'invalid';
  }
  const record = parsed as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!BILLING_STRIPE_PRICE_IDS_TOP_LEVEL_KEYS.has(key)) {
      return 'invalid';
    }
  }

  if (record.env !== 'dev' && record.env !== 'test' && record.env !== 'prod') {
    return 'invalid';
  }
  if (record.env !== expectedEnv) {
    return 'env_mismatch';
  }

  const seenIds = new Set<string>();
  for (const section of ['offers', 'topups', 'coupons'] as const) {
    const value = record[section];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return 'invalid';
    }
    for (const [mapKey, mapValue] of Object.entries(value as Record<string, unknown>)) {
      if (mapKey.length === 0 || typeof mapValue !== 'string') {
        return 'invalid';
      }
      if (!CONFIGURED_STRIPE_ID_SHAPE.test(mapValue)) {
        return 'invalid';
      }
      if (seenIds.has(mapValue)) {
        return 'invalid';
      }
      seenIds.add(mapValue);
    }
  }

  return 'ok';
}

/**
 * The SINGLE PRODUCER of "what BILLING_PLAN_ENV should read for this runtime
 * environment" (G34). PURE, never throws. `ci`/`test` map to `'test'` — the
 * same literal `APPROVED_CI_PROVIDER_VALUES.BILLING_PLAN_ENV` requires below
 * — because a real deployment (development/preview/production) is the only
 * place `assertProviderEnvironmentIsolation` calls `requireBillingEnvironment`
 * with this mapping; ci/test enforce the placeholder value through the exact
 * CI-placeholder check instead. Exported so callers outside this module (the
 * public, unauthenticated `/api/health` informational surface) can ask
 * "does BILLING_PLAN_ENV match this runtime" without re-deriving the mapping.
 */
export function expectedBillingPlanEnv(
  runtimeEnvironment: RuntimeEnvironment,
): 'dev' | 'test' | 'prod' {
  if (runtimeEnvironment === 'ci' || runtimeEnvironment === 'test') {
    return 'test';
  }
  return runtimeEnvironment === 'production'
    ? 'prod'
    : runtimeEnvironment === 'preview'
      ? 'test'
      : 'dev';
}

/**
 * Verifies that provider credentials are coupled to the resolved deployment.
 * Values are never included in errors. Webhook secret mode cannot be inferred
 * from its format, so this verifies presence while owner provisioning remains
 * responsible for assigning the correct endpoint-specific secret.
 */
export function assertProviderEnvironmentIsolation(
  environment: Environment = process.env,
): RuntimeEnvironment {
  const runtimeEnvironment = resolveRuntimeEnvironment(environment);
  if (runtimeEnvironment === 'unknown') {
    reject('RUNTIME_ENVIRONMENT_UNKNOWN');
  }

  if (runtimeEnvironment === 'ci' || runtimeEnvironment === 'test') {
    requireExactCiProviderPlaceholders(environment);
    return runtimeEnvironment;
  }

  const clerkMode = requireClerkMode(environment);
  const stripeMode = requireStripeMode(environment);
  requireDistinctStripeWebhookSecrets(environment);
  const expectedProviderMode = runtimeEnvironment === 'production' ? 'live' : 'test';
  if (clerkMode !== expectedProviderMode) {
    reject('CLERK_KEY_MODE_INVALID');
  }
  if (stripeMode !== expectedProviderMode) {
    reject('STRIPE_KEY_MODE_INVALID');
  }

  requireBillingEnvironment(environment, expectedBillingPlanEnv(runtimeEnvironment));

  // G40/D19a — optional and UNSET MEANS IGNORED: this never runs unless
  // BILLING_STRIPE_PRICE_IDS is actually set, and it stays unset in every
  // environment while billing is dark (contract §7). See
  // inspectBillingStripePriceIdsShape's doc comment for why this check is
  // structural-only rather than catalogue-aware.
  if (environment.BILLING_STRIPE_PRICE_IDS) {
    const inspection = inspectBillingStripePriceIdsShape(
      environment.BILLING_STRIPE_PRICE_IDS,
      expectedBillingPlanEnv(runtimeEnvironment),
    );
    if (inspection === 'env_mismatch') {
      reject('BILLING_STRIPE_PRICE_IDS_ENV_MISMATCH');
    }
    if (inspection === 'invalid') {
      reject('BILLING_STRIPE_PRICE_IDS_INVALID');
    }
  }

  return runtimeEnvironment;
}

export function assertEnvironmentIsolation(
  environment: Environment = process.env,
): RuntimeEnvironment {
  return assertProviderEnvironmentIsolation(environment);
}
