/**
 * Deployed billing readiness evidence — PR-4 (handoff §5.2/§5.3 item 2).
 *
 * The problem this endpoint exists to solve: every pre-activation verdict the
 * readiness harness could previously reach was computed from the OPERATOR'S
 * OWN SHELL — a local `process.env` and the working tree's `vercel.json`.
 * That proves nothing about the deployment the rehearsal or the activation
 * would actually run against, and it required the operator to hold the
 * deployment's secrets locally to "prove" they were provisioned. This route
 * is the trusted source instead: it reports what the RUNNING deployment
 * actually loaded.
 *
 * WHAT IT RETURNS: presence booleans, bounded enums, counts, a digest, and
 * the public application origin. NEVER a secret, never a Stripe id, never the
 * raw carrier JSON, never a URL carrying a bypass token. `route.test.ts` pins
 * that the serialized body contains no `whsec_`/`sk_`/`rk_`/`price_`/
 * `coupon_`/`promo_` substring under a fully populated fake environment.
 *
 * AUTHORIZATION: `isAuthorizedCronRequest` — the SAME `Authorization: Bearer
 * <CRON_SECRET>` / `x-cron-secret` the two billing crons already accept, and
 * the same credential the operator already uses to invoke Preview crons
 * manually. Deliberately NOT cookie/session auth and NOT super-admin: the
 * harness is a CLI with no browser session, and making readiness depend on
 * the super-admin stack would make it unusable on exactly the Preview
 * deployment where the super-admin bootstrap is itself an open prerequisite.
 * `CRON_SECRET` unset ⇒ 401 by construction (`cronAuth.ts` fails closed), so
 * `cronSecretConfigured` is `true` whenever this body is reachable at all.
 *
 * Public `/api/health` is deliberately UNCHANGED: it keeps exactly its two
 * billing booleans (its G23/G34 comment explains why granular state must not
 * be on an unauthenticated surface). This endpoint is the authenticated
 * granular surface that comment anticipates.
 *
 * Reads `process.env` directly rather than `Env`, for the same reason
 * `/api/health`'s billing block does: this is a PROVISIONING diagnostic, and
 * it must report what was actually set — including a value that `Env`'s
 * schema would coerce or reject — rather than a validated projection of it.
 */
import { isAuthorizedCronRequest } from '@/libs/billing/cronAuth';
import {
  type BillingReadinessCarrierFacts,
  type BillingReadinessEndpointFacts,
  computeCarrierIdDigest,
  resolveStripeKeyMode,
} from '@/libs/billing/readinessCheck';
import { parseStripePriceCarrier } from '@/libs/billing/stripePriceCarrier';
import { expectedBillingPlanEnv, resolveRuntimeEnvironment } from '@/libs/environmentIsolation';

export const dynamic = 'force-dynamic';

function isPlanEnv(value: string | undefined): value is 'dev' | 'test' | 'prod' {
  return value === 'dev' || value === 'test' || value === 'prod';
}

/**
 * Parses with the SAME catalogue-aware parser the checkout and webhook paths
 * consult, so a carrier this reports as `ok` is a carrier the runtime can
 * actually resolve. Only the section COUNTS and a digest of the id list
 * escape; the ids themselves never leave this function.
 */
function describeCarrier(): BillingReadinessCarrierFacts {
  const raw = process.env.BILLING_STRIPE_PRICE_IDS;
  const absent = raw === undefined || raw.trim() === '';
  const planEnv = process.env.BILLING_PLAN_ENV;
  const empty: BillingReadinessCarrierFacts = {
    present: !absent,
    env: null,
    offers: 0,
    topups: 0,
    coupons: 0,
    digest: null,
    parse: absent ? 'absent' : 'PLAN_ENV_INVALID',
  };
  if (absent) {
    return empty;
  }
  if (!isPlanEnv(planEnv)) {
    return empty;
  }
  const result = parseStripePriceCarrier(raw, planEnv);
  if (!result.ok) {
    return { ...empty, parse: result.reason };
  }
  const carrier = result.carrier;
  if (carrier === null) {
    return { ...empty, parse: 'absent' };
  }
  const ids = [
    ...Object.values(carrier.offers),
    ...Object.values(carrier.topups),
    ...Object.values(carrier.coupons),
  ];
  return {
    present: true,
    env: carrier.env,
    offers: Object.keys(carrier.offers).length,
    topups: Object.keys(carrier.topups).length,
    coupons: Object.keys(carrier.coupons).length,
    digest: computeCarrierIdDigest(ids),
    parse: 'ok',
  };
}

/**
 * Compared in-process; the values never leave it. A billing secret shared
 * with the legacy or Connect endpoint means one endpoint's signatures verify
 * at the other, which is precisely the isolation the billing track rests on.
 * An unset billing secret is vacuously distinct (and is separately reported
 * by `webhookSecretConfigured: false`).
 */
function isBillingWebhookSecretDistinct(): boolean {
  const billing = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!billing) {
    return true;
  }
  return billing !== process.env.STRIPE_WEBHOOK_SECRET
    && billing !== process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
}

function normalizedAppOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) {
    return null;
  }
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function identityHmacVersion(): number | null {
  const raw = process.env.BILLING_IDENTITY_HMAC_VERSION;
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCronRequest(request, process.env.CRON_SECRET)) {
    // `no-store` on the refusal too: a cached 401 at an intermediary would be
    // replayed to an authorized caller, and a cached anything from this
    // endpoint is a stale claim about a deployment's configuration.
    return Response.json({ error: 'Unauthorized' }, {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // Never let a diagnostic throw: an unresolvable/conflicting runtime reads
  // as a mismatch — exactly as a real misprovisioning would — rather than
  // taking the endpoint down. Same rule `/api/health` applies.
  let planEnvMatchesRuntime = false;
  try {
    planEnvMatchesRuntime
      = process.env.BILLING_PLAN_ENV === expectedBillingPlanEnv(resolveRuntimeEnvironment());
  } catch {
    planEnvMatchesRuntime = false;
  }

  const vercelEnv = process.env.VERCEL_ENV;
  const rawPlanEnv = process.env.BILLING_PLAN_ENV;
  const body: BillingReadinessEndpointFacts = {
    // Clamped to the enum: an out-of-range value is reported as `null` (with
    // `planEnvMatchesRuntime: false`) rather than echoed. This endpoint must
    // not become a way to read back an arbitrary environment variable's value.
    planEnv: isPlanEnv(rawPlanEnv) ? rawPlanEnv : null,
    planEnvMatchesRuntime,
    vercelEnv: vercelEnv === 'preview' || vercelEnv === 'production' ? vercelEnv : null,
    // The same source `/api/health` reports, truncated identically, so a
    // `gitSha` from either endpoint names the same commit for
    // `git show <sha>:vercel.json`.
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA
      ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
      : null,
    appOrigin: normalizedAppOrigin(),
    switches: {
      subscriptions: process.env.BILLING_SUBSCRIPTIONS_ENABLED === 'true',
      topups: process.env.BILLING_TOPUPS_ENABLED === 'true',
      publicPricing: process.env.PUBLIC_PRICING_ENABLED === 'true',
      taxCollection: process.env.BILLING_TAX_COLLECTION_ENABLED === 'true',
    },
    webhookSecretConfigured: Boolean(process.env.STRIPE_BILLING_WEBHOOK_SECRET),
    webhookSecretDistinct: isBillingWebhookSecretDistinct(),
    stripeKeyMode: resolveStripeKeyMode(process.env.STRIPE_SECRET_KEY),
    // True by construction: an unset CRON_SECRET cannot reach this line.
    cronSecretConfigured: Boolean(process.env.CRON_SECRET),
    identityHmacConfigured: Boolean(process.env.BILLING_IDENTITY_HMAC_SECRET),
    identityHmacVersion: identityHmacVersion(),
    carrier: describeCarrier(),
    deploymentMarker: Boolean(process.env.BILLING_DEPLOYMENT_MARKER),
    timestamp: new Date().toISOString(),
  };

  return Response.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
