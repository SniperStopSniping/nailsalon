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
 * The billing endpoint and the Connect endpoint are two distinct Stripe webhook
 * endpoints, so they have two distinct signing secrets. Sharing one means either
 * the Connect endpoint verifies billing deliveries or the reverse — and the
 * billing handler resolves its tenant from `session.metadata.salonId` without
 * ever reading `event.account`, so a Connect-scoped delivery reaching it is a
 * cross-tenant billing takeover.
 *
 * Deployment branch ONLY. In ci/test both are the same approved placeholder by
 * design, so evaluating this before the ci/test early return would reject every
 * CI job and every vitest run.
 */
function requireDistinctStripeWebhookSecrets(environment: Environment): void {
  const connectSecret = environment.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (connectSecret && connectSecret === environment.STRIPE_WEBHOOK_SECRET) {
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

  requireBillingEnvironment(
    environment,
    runtimeEnvironment === 'production'
      ? 'prod'
      : runtimeEnvironment === 'preview'
        ? 'test'
        : 'dev',
  );

  return runtimeEnvironment;
}

export function assertEnvironmentIsolation(
  environment: Environment = process.env,
): RuntimeEnvironment {
  return assertProviderEnvironmentIsolation(environment);
}
