#!/usr/bin/env tsx
/**
 * Idempotent Stripe **TEST-MODE** provisioning for the billing catalogue.
 *
 * Governing sources (every value below is copied from one of these, never
 * invented here):
 *   - `src/libs/billing/billingOffers.ts`   (`BILLING_OFFERS`, 6 recurring)
 *   - `src/libs/billing/topupOffers.ts`     (`TOPUP_OFFERS`, 7 one-time)
 *   - `src/libs/billing/promotions.ts`      (`PROMOTIONS`, 40% / `once`)
 *   - `src/libs/billing/billingWebhookEvents.ts` (the 13 handled types)
 *   - `src/libs/stripe.ts:36`               (`EXPECTED_STRIPE_API_VERSION`)
 *   - `docs/BILLING_PRODUCTION_RUNBOOK.md`  §2.1-§2.5
 *
 * ---------------------------------------------------------------------------
 * SAFETY GATES (all of them refuse rather than guess)
 * ---------------------------------------------------------------------------
 *  1. KEY SOURCE. The secret is read from `STRIPE_TEST_SECRET_KEY` ONLY —
 *     never from `STRIPE_SECRET_KEY`, so a shell that happens to carry a
 *     deployment key cannot be used by accident. It must start `sk_test_`
 *     or `rk_test_` and be longer than that prefix (the same shape rule
 *     `providerMode()` applies at `src/libs/environmentIsolation.ts:233-248`).
 *     Only a RECOGNISED prefix (`sk_test_` / `rk_test_`) is ever printed; a
 *     value that matches neither is refused without echoing any part of it.
 *  2. LIVEMODE. The Stripe **Account object carries no `livemode` field** in
 *     stripe@16.12.0 (it is absent from node_modules/stripe/types/
 *     Accounts.d.ts), so `accounts.retrieve()` is only refused when it
 *     explicitly reports `livemode === true`. The gate that actually settles
 *     the mode is per-object: EVERY object this script lists, creates,
 *     reuses, adopts or verifies must report `livemode === false`, and a
 *     single existing account object is sampled up front. Belt and braces
 *     against a spoofed prefix.
 *  3. PLAN ENV. `BILLING_PLAN_ENV` must be present and be exactly `test`.
 *     `prod` AND `dev` are both refused: Preview's expected value is `test`
 *     (`src/libs/environmentIsolation.ts` `expectedBillingPlanEnv`), and a
 *     carrier stamped `env:"dev"` is a hard boot rejection there
 *     (`BILLING_STRIPE_PRICE_IDS_ENV_MISMATCH`), not a fail-closed fallback.
 *     The carrier's `env` field comes from here, never from a flag.
 *  4. DRY RUN IS THE DEFAULT. `--plan` (also the default with no mode flag)
 *     performs reads only and prints the exact payloads it WOULD send.
 *     Nothing is written to Stripe without an explicit `--apply`.
 *  5. NO SECRET EVER REACHES A LOG. The API key, the `whsec_...` signing
 *     secret, the Vercel Protection-Bypass token carried in the
 *     `--webhook-url` query string and the raw carrier JSON are never written
 *     to stdout/stderr. `--webhook-url-env <NAME>` takes the NAME of an
 *     environment variable holding that url instead, so the bypass token stays
 *     out of this process's argv too — the same transport, and the same
 *     reasoning, as `--bypass-secret-env` in
 *     `scripts/billing-readiness-check.ts`, which likewise takes a variable
 *     NAME and never the value. The bypass token is registered with
 *     `registerSensitiveValue()` before the first Stripe call, and
 *     `redactSecrets()` also masks any `x-vercel-protection-bypass=<token>`
 *     substring whatever its source — including a `url` echoed back inside a
 *     Stripe error body. The `--webhook-url` string is NEVER used as an
 *     Idempotency-Key or in any other header: the webhook idempotency key is
 *     derived from `sha256('luster-billing-webhook:' + url)`. The signing
 *     secret goes to `--webhook-secret-out <path>` at mode 0600 (so it can be
 *     piped into `vercel env add`); it is printed only when
 *     `--print-webhook-secret` is passed explicitly, which is the one and
 *     only place a secret can reach stdout. Every other message is run
 *     through `redactSecrets()` before it is emitted. ORDER MATTERS (T7):
 *     `--print-webhook-secret` prints FIRST, before `--webhook-secret-out`
 *     gets its chance to refuse (an existing file with different bytes, a
 *     symlink, a directory). Stripe returns the signing secret exactly once,
 *     so a refusal in the file sink must never be what loses it —
 *     `deliverWebhookSecret()` orders the two and only rethrows the write
 *     failure when nothing else holds the value.
 *  6. OUTPUT PATHS LIVE OUTSIDE THE REPOSITORY, AND ARE NEVER CLOBBERED.
 *     `--carrier-out` and `--webhook-secret-out` are refused if they resolve
 *     inside this git worktree — contract §4 forbids committing Stripe ids
 *     (`src/libs/billing/stripePriceCarrier.ts:8-9`) — AND, more broadly, if
 *     any ancestor directory of the resolved path holds a `.git` entry (a
 *     directory in a normal clone, a file in a linked worktree). A mistyped
 *     path landing in ANOTHER checkout of this same repository, or in any
 *     unrelated repository, is refused too: `.gitignore` there covers
 *     `.env*`, not `whsec-test.txt` or `carrier-test.json`. The gate resolves
 *     symlinks (`fs.realpathSync` of the nearest existing ancestor), so a
 *     symlink pointing back into a checkout is caught too. Both files are
 *     created with `fs.openSync(path, 'wx', 0o600)` — O_EXCL, so the mode is
 *     atomic and a final symlink is never followed — and an existing path is
 *     REFUSED (a `whsec_` is shown exactly once and a clobbered copy cannot
 *     be recovered) unless the bytes are identical, which is what makes a
 *     re-run after a partial failure resumable, or `--force` is passed.
 *  6a. COLLISION DETECTION. Before anything is created, the account's
 *     existing test-mode Products, Prices, Coupons and webhook endpoints are
 *     listed EXHAUSTIVELY — `collectAllPages()` pages until Stripe reports
 *     `has_more: false` and REFUSES (never truncates) if the `LIST_MAX_PAGES`
 *     safety cap is reached, because a partial inventory would turn this gate
 *     into a silent no-op. An object that matches a planned one by name / amount +
 *     interval / percent-off + duration / webhook url but does NOT carry our
 *     metadata handle aborts the run (exit 3) naming the ids — so a
 *     catalogue created by hand from runbook §2.1-§2.3 is never silently
 *     duplicated. `--adopt-existing` stamps our metadata onto an EXACT match
 *     instead, and only where adoption cannot break a downstream invariant
 *     (see `classifyCatalogueCollisions`). It is off by default.
 *  7. NOTHING IS EVER DELETED OR ARCHIVED. No `coupons.del`, no
 *     `webhookEndpoints.del`, no product archive, no `active:false` write.
 *     The single `active` write this script can make is the REACTIVATION of
 *     an otherwise-correct Price. Rollback stays a human runbook action.
 *  8. WRONG-FIELD MATCHES REFUSE, THEY DO NOT DUPLICATE. An existing object
 *     found by its deterministic handle whose immutable fields disagree with
 *     the committed catalogue aborts the run (exit 4) naming the key, both
 *     values and the object id. It is never archived-and-recreated: the old
 *     id may already be on a live test subscription.
 *  9. NO DATABASE, NO VERCEL, NO DEPLOY. This module imports nothing from
 *     `@/libs/DB`, `@/libs/Env` or any route module and never shells out.
 *     Env provisioning stays a human step (runbook §4).
 * 10. THE DARK SWITCHES ARE NOT TOUCHED. `BILLING_SUBSCRIPTIONS_ENABLED`,
 *     `BILLING_TOPUPS_ENABLED`, `PUBLIC_PRICING_ENABLED` and
 *     `BILLING_TAX_COLLECTION_ENABLED` are never read, written or defaulted.
 *     Creating Stripe objects is orthogonal to them, and creating the Coupon
 *     does not open the promotion window (`promotions.ts:52-54`, runbook :68).
 * 11. HOST ALLOWLIST (T2). A webhook url is never accepted on the strength of
 *     its `https:` scheme alone. `--allow-host <hostname>` is REQUIRED
 *     alongside `--webhook-url`/`--webhook-url-env` and must equal the url's
 *     hostname, so the operator types the pilot host deliberately — the same
 *     reasoning as the seed script's `--expect-host`. Every known PRODUCTION
 *     host (`PRODUCTION_WEBHOOK_HOSTS`) is refused outright, whatever
 *     `--allow-host` says: this tool provisions TEST MODE for a Preview
 *     deployment and has no legitimate reason to point Stripe at the live
 *     salon. The url it will register, and the host it was allowed for, are
 *     printed before any endpoint write (T4) — through `redactSecrets()`, so
 *     the bypass token in the query string stays masked.
 * 12. SHARED-ACCOUNT EXPOSURE IS VISIBLE, THEN ACKNOWLEDGED (T3). At `--plan`
 *     and `--apply` every OTHER test-mode webhook endpoint on the account is
 *     listed (id, url origin+path, `enabled_events` count, Connect flag), because
 *     on a shared test account each of those endpoints receives the rehearsal's
 *     events too and turns the evidence unattributable (HANDOFF §7 T3, §6 X3).
 *     With at least one other endpoint present, `--apply` REFUSES unless
 *     `--acknowledge-shared-account` is passed — the documented O5
 *     "shared test account" path. A dedicated Sandbox (O5 recommended) simply
 *     shows an empty list and needs no flag.
 * 13. THE ENDPOINT IS A SEPARATE, FINAL INVOCATION (T6). `--apply` alone
 *     provisions the catalogue, the coupon and (with `--portal`) the portal
 *     configuration, then prints the secret-staging steps and STOPS: no
 *     endpoint is created, reused, re-enabled or re-pointed. Arming traffic
 *     needs the explicit `--create-webhook`, which the runbook sequences
 *     AFTER `BILLING_STRIPE_PRICE_IDS` is staged and the deployment rebuilt —
 *     otherwise the endpoint starts delivering into a deployment whose
 *     `STRIPE_BILLING_WEBHOOK_SECRET` is still unset, every delivery 503s and
 *     Stripe may auto-disable it before the secret lands.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CATALOGUE IS IMPORTED DYNAMICALLY
 * ---------------------------------------------------------------------------
 * `billingOffers.ts:15`, `topupOffers.ts:12` and `promotions.ts:23` all carry
 * `import 'server-only'`, whose package `exports` map resolves to a bare
 * `throw` outside Node's `react-server` condition. ES imports are hoisted, so
 * a top-level import would crash before argument parsing. This script
 * therefore keeps its top-level imports to tsx-safe modules only and pulls
 * the catalogue in with `await import(...)` AFTER
 * `ensureServerOnlyConditionOrReExec()` has re-execed the process with
 * `--conditions=react-server`. `billingWebhookEvents.ts` is deliberately not
 * `server-only` (see its header at :13-19) and is imported normally.
 *
 * `stripePriceCarrier.ts` is NOT imported at all: it imports `@/libs/Env`
 * (:26), which demands the full validated environment. Its id-shape regex is
 * duplicated below with a pointer at the canonical definition, and `--verify`
 * re-reads that line's text to prove the copies still agree.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   npx tsx scripts/billing-stripe-test-provision.ts --plan
 *   # Step 1 — catalogue, coupon, portal. NO endpoint is created here (T6).
 *   npx tsx scripts/billing-stripe-test-provision.ts --apply \
 *       --carrier-out /abs/path/outside/repo/carrier-test.json \
 *       [--portal] [--adopt-default] [--adopt-existing] [--force] \
 *       [--acknowledge-shared-account]
 *   # ... stage BILLING_STRIPE_PRICE_IDS on the branch scope, redeploy ...
 *   # Step 2 — arm the endpoint, last and deliberately.
 *   npx tsx scripts/billing-stripe-test-provision.ts --apply \
 *       --carrier-out /abs/path/outside/repo/carrier-test.json \
 *       --webhook-url-env PILOT_WEBHOOK_URL --allow-host <pilot hostname> \
 *       --create-webhook \
 *       --webhook-secret-out /abs/path/outside/repo/whsec-test.txt \
 *       [--print-webhook-secret] [--acknowledge-shared-account]
 *   npx tsx scripts/billing-stripe-test-provision.ts --verify \
 *       --carrier /abs/path/outside/repo/carrier-test.json \
 *       [--webhook-url '<exact url>' --allow-host <pilot hostname>] [--portal]
 *
 * ORDER OF WRITES under `--apply` (deliberate, and asserted by the unit test
 * "writes the carrier before the portal and webhook steps"): Products ->
 * recurring Prices -> one-time Prices -> Coupon -> **carrier file written** ->
 * portal configuration -> webhook endpoint last, and only under
 * `--create-webhook`. The carrier is the only record of the ids that were just
 * created, so it is persisted the moment the catalogue is complete, BEFORE the
 * two steps that can refuse. A re-run after a partial failure reuses every
 * object already created and rewrites the same bytes (a byte-identical carrier
 * file is accepted, not refused).
 *
 * Exit codes: 0 success / verify pass · 2 usage error · 3 safety-gate refusal
 * · 4 verification failure or immutable-field mismatch · 5 Stripe API error.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Stripe from 'stripe';

import { BILLING_WEBHOOK_HANDLED_TYPES } from '../src/libs/billing/billingWebhookEvents';
import { ensureServerOnlyConditionOrReExec } from './lib/reExecWithServerOnlyCondition';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROVISIONER = 'billing-stripe-test-provision';

/**
 * Product-level discriminator. Every object this script owns carries it, so a
 * foreign object that happens to collide on a deterministic id is detected
 * rather than mutated.
 */
export const CATALOG_MARKER = 'billing-2026-08';

/**
 * LOCAL DUPLICATE of the canonical shape check at
 * `src/libs/billing/stripePriceCarrier.ts:45` (`isConfiguredStripeId`).
 * Duplicated, not imported, because that module imports `@/libs/Env` at :26.
 * `--verify` re-reads the canonical line's TEXT and refuses on drift, which is
 * the same trade-off `src/libs/billing/readinessCheck.ts` already documents for
 * its own hand-maintained `KNOWN_OFFER_KEYS`/`KNOWN_TOPUP_KEYS`/
 * `KNOWN_COUPON_KEYS` duplicates (see that file's header): duplicate rather than
 * import a `server-only` module, and pin the duplicate against drift.
 */
export const STRIPE_ID_SHAPE = /^(?:price|coupon|promo)_[A-Za-z0-9]{8,}$/;

/** The exact canonical source line the drift check compares against. */
export const CANONICAL_STRIPE_ID_SHAPE_SOURCE
  = 'return /^(?:price|coupon|promo)_[A-Za-z0-9]{8,}$/.test(value);';

export function isConfiguredStripeId(value: string | null | undefined): value is string {
  if (value === null || value === undefined) {
    return false;
  }
  return STRIPE_ID_SHAPE.test(value);
}

export const PORTAL_CONFIG_MARKER = 'd16';
export const PORTAL_HEADLINE = 'Manage your Luster billing';

/** Runbook :136 asks for `subscription_pause`, which stripe@16.12.0 does not model. */
export const SUBSCRIPTION_PAUSE_DIVERGENCE
  = 'runbook §2.5 line 136 passes --features[subscription_pause][enabled]=false, but '
  + '`subscription_pause` is absent from stripe@16.12.0 '
  + '(node_modules/stripe/types/BillingPortal/Configurations.d.ts lists only customer_update, '
  + 'invoice_history, payment_method_update, subscription_cancel, subscription_update). '
  + 'Pause is off by default; no untyped cast is attempted.';

export type PlanEnv = 'dev' | 'test';
export type CatalogSection = 'offers' | 'topups' | 'coupons';

// ---------------------------------------------------------------------------
// Minimal catalogue shapes (structural — avoids importing the server-only
// modules for their TYPES, which `import type` would erase but eslint's
// resolver would still have to walk).
// ---------------------------------------------------------------------------

export type CatalogueBillingOffer = {
  key: string;
  planDefinitionKey: string;
  cadence: 'monthly' | 'annual';
  priceCents: number;
  currency: 'cad';
};

export type CatalogueTopupOffer = {
  key: string;
  credits: number;
  priceCents: number;
  currency: 'cad';
  audience: 'free_plan' | 'paid_plan';
};

export type CataloguePromotion = {
  key: string;
  percentOffAgainstAnnualPrice: number;
  duration: 'once';
  eligibleOfferKeys: readonly string[];
};

export type Catalogue = {
  offers: Readonly<Record<string, CatalogueBillingOffer>>;
  topups: Readonly<Record<string, CatalogueTopupOffer>>;
  promotions: Readonly<Record<string, CataloguePromotion>>;
};

// ---------------------------------------------------------------------------
// Narrow structural client — the unit test supplies a hand-written mock that
// satisfies exactly this and nothing else, so no test can reach the network.
// ---------------------------------------------------------------------------

export type StripePage<T> = { data: T[]; has_more: boolean };

export type ProvisionStripeClient = {
  accounts: {
    retrieve: (
      params?: Stripe.AccountRetrieveParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.Account>;
  };
  products: {
    list: (params: Stripe.ProductListParams) => Promise<StripePage<Stripe.Product>>;
    retrieve: (id: string) => Promise<Stripe.Product>;
    create: (
      params: Stripe.ProductCreateParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.Product>;
    update: (id: string, params: Stripe.ProductUpdateParams) => Promise<Stripe.Product>;
  };
  prices: {
    list: (params: Stripe.PriceListParams) => Promise<StripePage<Stripe.Price>>;
    retrieve: (id: string) => Promise<Stripe.Price>;
    create: (
      params: Stripe.PriceCreateParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.Price>;
    update: (id: string, params: Stripe.PriceUpdateParams) => Promise<Stripe.Price>;
  };
  coupons: {
    list: (params: Stripe.CouponListParams) => Promise<StripePage<Stripe.Coupon>>;
    retrieve: (id: string) => Promise<Stripe.Coupon>;
    create: (
      params: Stripe.CouponCreateParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.Coupon>;
    update: (id: string, params: Stripe.CouponUpdateParams) => Promise<Stripe.Coupon>;
  };
  webhookEndpoints: {
    list: (
      params: Stripe.WebhookEndpointListParams,
    ) => Promise<StripePage<Stripe.WebhookEndpoint>>;
    create: (
      params: Stripe.WebhookEndpointCreateParams,
      options?: Stripe.RequestOptions,
    ) => Promise<Stripe.WebhookEndpoint>;
    update: (
      id: string,
      params: Stripe.WebhookEndpointUpdateParams,
    ) => Promise<Stripe.WebhookEndpoint>;
  };
  billingPortal: {
    configurations: {
      list: (
        params: Stripe.BillingPortal.ConfigurationListParams,
      ) => Promise<StripePage<Stripe.BillingPortal.Configuration>>;
      retrieve: (id: string) => Promise<Stripe.BillingPortal.Configuration>;
      create: (
        params: Stripe.BillingPortal.ConfigurationCreateParams,
        options?: Stripe.RequestOptions,
      ) => Promise<Stripe.BillingPortal.Configuration>;
      update: (
        id: string,
        params: Stripe.BillingPortal.ConfigurationUpdateParams,
      ) => Promise<Stripe.BillingPortal.Configuration>;
    };
  };
};

// ---------------------------------------------------------------------------
// Secret redaction — applied to EVERY string this script emits
// ---------------------------------------------------------------------------

/**
 * Values that are secret but have no recognisable shape — above all the Vercel
 * Protection-Bypass token carried in the `--webhook-url` query string. `main()`
 * registers them before the first Stripe call, so nothing emitted afterwards
 * can contain one, whatever produced the string (a Stripe error echoing the
 * offending `url` included).
 */
const sensitiveValues = new Set<string>();

/**
 * Registers a literal value for masking. Short values are ignored: masking a
 * 3-character string would shred unrelated output for no benefit.
 */
export function registerSensitiveValue(value: string | null | undefined): void {
  if (typeof value === 'string' && value.trim().length >= 8) {
    sensitiveValues.add(value.trim());
  }
}

/** Test-only reset so the registry cannot leak between unit tests. */
export function resetSensitiveValues(): void {
  sensitiveValues.clear();
}

export const BYPASS_QUERY_PARAM = 'x-vercel-protection-bypass';

/**
 * The Vercel Protection-Bypass token lives in the `--webhook-url` query string
 * (that is what lets Stripe's POST past Deployment Protection). It is a
 * credential for the whole Preview deployment, so it is registered for
 * redaction and NEVER used as an Idempotency-Key or any other header value.
 */
export function extractBypassToken(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).searchParams.get(BYPASS_QUERY_PARAM);
  } catch {
    return null;
  }
}

/**
 * Stripe error bodies can echo a (partially masked) key or the offending
 * `url`, and an operator's shell can paste a secret into an argument. Nothing
 * leaves this script without passing through here first.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const value of sensitiveValues) {
    out = out.split(value).join('[redacted]');
  }
  // Belt to the registry's braces: masks the token even when it was never
  // registered (an endpoint listed from Stripe, a url echoed in an error).
  out = out.replace(
    new RegExp(`(${BYPASS_QUERY_PARAM}=)[^&\\s"'\\\\]+`, 'gi'),
    '$1[redacted]',
  );
  // The bare prefixes `sk_test_` / `rk_test_` / `whsec_` carry no secret and
  // must stay legible — they are what the key-mode refusal message is FOR — so
  // a token only redacts once it has real material after the prefix.
  return out
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[\w*-]{4,}/g, '[redacted]')
    .replace(/\bwhsec_[\w*-]{4,}/g, '[redacted]');
}

/**
 * Flattens an error — overwhelmingly a `Stripe.errors.StripeError` — into ONE
 * redacted line. Every field Stripe can echo an argument value through
 * (`message`, `raw.message`, `raw.param`, `raw.doc_url`, an echoed `url`) is
 * pulled out deliberately and then redacted, rather than left to an
 * unpredictable default `toString()`.
 */
export function describeErrorForOutput(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message);
  } else if (typeof error === 'string') {
    parts.push(error);
  } else {
    parts.push('unknown error');
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    for (const key of ['type', 'code', 'statusCode', 'requestId'] as const) {
      const value = record[key];
      if (typeof value === 'string' || typeof value === 'number') {
        parts.push(`${key}=${String(value)}`);
      }
    }
    const raw = record.raw;
    if (typeof raw === 'object' && raw !== null) {
      const rawRecord = raw as Record<string, unknown>;
      for (const key of ['message', 'param', 'code', 'doc_url', 'url'] as const) {
        const value = rawRecord[key];
        if (typeof value === 'string') {
          parts.push(`raw.${key}=${value}`);
        }
      }
    }
  }

  return redactSecrets(parts.join(' | '));
}

function emit(line: string): void {
  process.stdout.write(`${redactSecrets(line)}\n`);
}

function emitError(line: string): void {
  process.stderr.write(`${redactSecrets(line)}\n`);
}

// ---------------------------------------------------------------------------
// Errors / exit codes
// ---------------------------------------------------------------------------

export const EXIT = {
  ok: 0,
  usage: 2,
  refusal: 3,
  verification: 4,
  stripe: 5,
} as const;

export class ProvisionError extends Error {
  public readonly exitCode: number;

  constructor(exitCode: number, message: string) {
    super(message);
    this.name = 'ProvisionError';
    this.exitCode = exitCode;
  }
}

export class UsageError extends ProvisionError {
  constructor(message: string) {
    super(EXIT.usage, message);
    this.name = 'UsageError';
  }
}

export class RefusalError extends ProvisionError {
  constructor(message: string) {
    super(EXIT.refusal, message);
    this.name = 'RefusalError';
  }
}

export class VerificationError extends ProvisionError {
  constructor(message: string) {
    super(EXIT.verification, message);
    this.name = 'VerificationError';
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export type Mode = 'plan' | 'apply' | 'verify';

export type ParsedArgs = {
  mode: Mode;
  carrierOut: string | null;
  carrierIn: string | null;
  webhookUrl: string | null;
  /** The NAME of an environment variable holding the webhook url — never the url. */
  webhookUrlEnv: string | null;
  /** T2: the hostname the operator deliberately typed; the url must match it. */
  allowHost: string | null;
  /** T6: arming traffic is its own, final invocation. */
  createWebhook: boolean;
  /** T3: the documented O5 "shared test account" acknowledgement. */
  acknowledgeSharedAccount: boolean;
  webhookSecretOut: string | null;
  printWebhookSecret: boolean;
  portal: boolean;
  adoptDefault: boolean;
  adoptExisting: boolean;
  force: boolean;
};

export const USAGE = `Usage:
  npx tsx scripts/billing-stripe-test-provision.ts --plan
  npx tsx scripts/billing-stripe-test-provision.ts --apply --carrier-out <path outside the repo>
      [--portal] [--adopt-default] [--adopt-existing] [--force] [--acknowledge-shared-account]
  npx tsx scripts/billing-stripe-test-provision.ts --apply --carrier-out <path outside the repo>
      [--webhook-url <exact url, query string included> | --webhook-url-env <ENV_NAME>]
      --allow-host <hostname> --create-webhook
      [--webhook-secret-out <path outside the repo>] [--print-webhook-secret]
  npx tsx scripts/billing-stripe-test-provision.ts --verify --carrier <path>
      [--webhook-url <exact url> | --webhook-url-env <ENV_NAME>] [--allow-host <hostname>] [--portal]

  --plan                    Dry run (the default). Reads only; prints every payload it would send,
                            plus the shared-account endpoint inventory (T3).
  --apply                   Create or reuse objects. Requires --carrier-out. Re-runnable: a partial
                            run is resumed by re-running the same command. Without --create-webhook
                            it stops after the catalogue/coupon/portal and prints the staging steps.
  --verify                  Read-only re-check of every object against the committed catalogue.
  --carrier-out <path>      Where the carrier JSON is written (0600, must be outside the repo).
                            Written as soon as the catalogue is complete, BEFORE --portal and the
                            webhook endpoint. An existing file is refused unless its bytes are
                            identical or --force is given; a symlink is always refused.
  --carrier <path>          Carrier JSON to verify against.
  --webhook-url <url>       Exact https URL of /api/webhooks/stripe-billing, query string included.
                            Its x-vercel-protection-bypass token is masked in all output and is
                            never sent as a header or an Idempotency-Key. NOTE: the token is in
                            this process's argv, where ps and shell history can see it — prefer
                            --webhook-url-env. Requires --allow-host.
  --webhook-url-env <NAME>  The NAME of an environment variable holding that exact url. The url
                            (and the bypass token inside it) is read from the environment, so it
                            never appears in argv. Mutually exclusive with --webhook-url.
                            Requires --allow-host.
  --allow-host <hostname>   REQUIRED with a webhook url (T2): the hostname you deliberately type,
                            which must equal the url's hostname. Known production hosts are refused
                            outright whatever this says. Register against the immutable
                            per-deployment URL or a branch aliased 'pilot-isla' — the git-branch
                            alias truncates at 14 characters, so every agent/billing-* branch
                            collides on the same alias (T4).
  --create-webhook          Create/reuse the Stripe endpoint. Off by default (T6): arming traffic is
                            a deliberate final invocation, run only AFTER the carrier is staged in
                            Vercel and the deployment rebuilt, and followed by staging
                            STRIPE_BILLING_WEBHOOK_SECRET and one more redeploy.
  --acknowledge-shared-account
                            Proceed with --apply even though other test-mode endpoints exist on this
                            account and will receive the rehearsal's events too (the O5 shared-test-
                            account path). A dedicated Sandbox lists none and needs no flag.
  --webhook-secret-out <p>  Where the whsec_... signing secret is written (0600, outside the repo).
                            Same overwrite and symlink rules as --carrier-out.
  --print-webhook-secret    Print the signing secret to stdout. Off by default, on purpose. This is
                            the ONLY path on which a secret value is printed, and it prints BEFORE
                            --webhook-secret-out can refuse (T7).
  --portal                  Also provision/verify the D16 Customer Portal configuration.
  --adopt-default           Permit updating an existing default portal configuration that is not ours.
  --adopt-existing          Stamp our metadata onto an EXACT pre-existing match (e.g. a catalogue
                            created by hand from runbook §2) instead of refusing. Off by default.
  --force                   Overwrite an existing --carrier-out / --webhook-secret-out file whose
                            contents differ. Off by default: a whsec_ is shown exactly once.
  -h, --help                Print this and exit.

Secret key source: STRIPE_TEST_SECRET_KEY only (never STRIPE_SECRET_KEY).
BILLING_PLAN_ENV must be exactly 'test': this tool provisions TEST MODE for Preview only.`;

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} requires a value.`);
  }
  return value;
}

export function parseArguments(argv: readonly string[]): ParsedArgs {
  const known = new Set([
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
    '--help',
    '-h',
  ]);
  const valueFlags = new Set([
    '--carrier-out',
    '--carrier',
    '--webhook-url',
    '--webhook-url-env',
    '--allow-host',
    '--webhook-secret-out',
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token.startsWith('-')) {
      if (!known.has(token)) {
        throw new UsageError(`Unknown flag: ${token}`);
      }
      if (valueFlags.has(token)) {
        index += 1;
      }
    } else {
      throw new UsageError(`Unexpected positional argument: ${token}`);
    }
  }

  const apply = argv.includes('--apply');
  const verify = argv.includes('--verify');
  const plan = argv.includes('--plan');

  if ([apply, verify, plan].filter(Boolean).length > 1) {
    throw new UsageError('--plan, --apply and --verify are mutually exclusive.');
  }

  // Dry run is the default: with no mode flag at all we plan, never write.
  const mode: Mode = apply ? 'apply' : verify ? 'verify' : 'plan';

  const parsed: ParsedArgs = {
    mode,
    carrierOut: readFlagValue(argv, '--carrier-out'),
    carrierIn: readFlagValue(argv, '--carrier'),
    webhookUrl: readFlagValue(argv, '--webhook-url'),
    webhookUrlEnv: readFlagValue(argv, '--webhook-url-env'),
    allowHost: readFlagValue(argv, '--allow-host'),
    createWebhook: argv.includes('--create-webhook'),
    acknowledgeSharedAccount: argv.includes('--acknowledge-shared-account'),
    webhookSecretOut: readFlagValue(argv, '--webhook-secret-out'),
    printWebhookSecret: argv.includes('--print-webhook-secret'),
    portal: argv.includes('--portal'),
    adoptDefault: argv.includes('--adopt-default'),
    adoptExisting: argv.includes('--adopt-existing'),
    force: argv.includes('--force'),
  };

  if (mode === 'apply' && parsed.carrierOut === null) {
    throw new UsageError('--apply requires --carrier-out <path outside the repository>.');
  }
  if (mode === 'verify' && parsed.carrierIn === null) {
    throw new UsageError('--verify requires --carrier <path>.');
  }
  if (parsed.webhookUrl !== null && parsed.webhookUrlEnv !== null) {
    throw new UsageError('--webhook-url and --webhook-url-env are mutually exclusive: pass exactly one.');
  }

  // T2: a webhook url and a typed host travel together, in both directions. A
  // url without --allow-host is the hazard the flag exists to close; an
  // --allow-host without a url is an operator who thinks a host was checked.
  const hasWebhookUrlSource = parsed.webhookUrl !== null || parsed.webhookUrlEnv !== null;
  if (hasWebhookUrlSource && parsed.allowHost === null) {
    throw new UsageError(
      '--webhook-url/--webhook-url-env requires --allow-host <hostname> matching that url\'s host: '
      + 'https alone is not proof that the endpoint points at the Preview pilot rather than production.',
    );
  }
  if (!hasWebhookUrlSource && parsed.allowHost !== null) {
    throw new UsageError('--allow-host is only meaningful with --webhook-url or --webhook-url-env.');
  }

  // T6: arming traffic is its own invocation, and it needs a url to arm.
  if (parsed.createWebhook && !hasWebhookUrlSource) {
    throw new UsageError(
      '--create-webhook requires --webhook-url or --webhook-url-env: there is no endpoint to create without one.',
    );
  }
  if (mode === 'apply' && parsed.createWebhook
    && parsed.webhookSecretOut === null && !parsed.printWebhookSecret) {
    throw new UsageError(
      '--apply --create-webhook requires either --webhook-secret-out <path> or --print-webhook-secret: '
      + 'Stripe returns the signing secret exactly once and it must not be lost.',
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Safety gates
// ---------------------------------------------------------------------------

export type SecretKeyCheck =
  | { ok: true; prefix: 'sk_test_' | 'rk_test_' }
  | { ok: false; reason: string };

/**
 * Mirrors the shape rule of `providerMode()` at
 * `src/libs/environmentIsolation.ts:233-248`: an untrimmed value is refused,
 * and the value must be strictly longer than the prefix it matches.
 * `sk_live_` is the live marker there (:224) and is refused here outright.
 */
export function checkSecretKeyMode(raw: string | undefined): SecretKeyCheck {
  if (raw === undefined || raw === '') {
    return { ok: false, reason: 'STRIPE_TEST_SECRET_KEY is not set.' };
  }
  if (raw !== raw.trim()) {
    return { ok: false, reason: 'STRIPE_TEST_SECRET_KEY has leading or trailing whitespace.' };
  }
  for (const prefix of ['sk_test_', 'rk_test_'] as const) {
    if (raw.startsWith(prefix) && raw.length > prefix.length) {
      return { ok: true, prefix };
    }
  }
  // NOTHING derived from `raw` is echoed. A value that reaches this branch is
  // by definition NOT a recognised key prefix, so any window of it is simply an
  // arbitrary slice of whatever secret the operator mis-pasted (a
  // `whsec_`, the Protection-Bypass token — all three land in the same
  // `.env.pilot.local`), and this refusal is raised BEFORE
  // `registerSensitiveValue()` arms the redaction registry.
  return {
    ok: false,
    reason: 'STRIPE_TEST_SECRET_KEY does not start with sk_test_ or rk_test_. '
      + 'This script is test-mode only and refuses live keys. The offending value is not echoed, '
      + 'not even in part: check the variable in your shell.',
  };
}

/**
 * `test` and nothing else.
 *
 * `prod` is refused because this script provisions TEST MODE only
 * (docs/BILLING_PRODUCTION_RUNBOOK.md §2); live-mode provisioning stays a
 * human runbook step. `dev` is refused because the carrier this script writes
 * is stamped with the value returned here and is destined for Vercel Preview,
 * whose expected value is `test` — a carrier stamped `env:"dev"` is rejected
 * at boot (`BILLING_STRIPE_PRICE_IDS_ENV_MISMATCH`,
 * src/libs/environmentIsolation.ts), which is a hard failure of the whole
 * deployment rather than a fail-closed fallback to the placeholder tables.
 */
export function requirePlanEnv(raw: string | undefined): PlanEnv {
  if (raw === 'test') {
    return raw;
  }
  if (raw === 'prod') {
    throw new RefusalError(
      'BILLING_PLAN_ENV=prod is refused unconditionally: this script provisions TEST MODE only '
      + '(docs/BILLING_PRODUCTION_RUNBOOK.md §2). Live-mode provisioning stays a human runbook step.',
    );
  }
  if (raw === 'dev') {
    throw new RefusalError(
      'BILLING_PLAN_ENV=dev is refused: the carrier this script writes is stamped with that value and is '
      + 'destined for Vercel Preview, which expects env="test" (src/libs/environmentIsolation.ts '
      + 'expectedBillingPlanEnv). A dev-stamped carrier is rejected at boot as '
      + 'BILLING_STRIPE_PRICE_IDS_ENV_MISMATCH — a hard rejection of the deployment, not a fallback. '
      + 'Export BILLING_PLAN_ENV=test to provision the Preview catalogue.',
    );
  }
  throw new RefusalError(
    `BILLING_PLAN_ENV must be set to exactly 'test' (src/libs/Env.ts:29 allows dev|test|prod; this `
    + `test-mode Preview tool accepts only 'test'); saw ${raw === undefined ? 'nothing' : `'${raw}'`}.`,
  );
}

/**
 * `fs.realpathSync` of the deepest ancestor of `target` that exists, with the
 * not-yet-existing tail re-appended. `path.resolve` alone performs NO symlink
 * resolution, so it cannot see a path that leaves the repository on paper and
 * lands back inside it through a link.
 */
export function realpathOfNearestExistingAncestor(target: string): string {
  const absolute = path.resolve(target);
  const tail: string[] = [];
  let current = absolute;

  for (let depth = 0; depth < 128; depth += 1) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...[...tail].reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return absolute;
    }
    tail.push(path.basename(current));
    current = parent;
  }
  return absolute;
}

/**
 * The deepest ancestor DIRECTORY of `resolved` that holds a `.git` entry, or
 * `null`. `.git` is a directory in an ordinary clone and a FILE in a linked
 * worktree (`gitdir: …`), so both shapes count — `fs.lstatSync` is used rather
 * than a directory test, and it does not follow a symlinked `.git` either.
 *
 * The path's own basename is never treated as a directory to search: only
 * ancestors are walked, starting at the parent of the output file.
 */
export function enclosingGitCheckout(resolved: string): string | null {
  let current = path.dirname(resolved);

  for (let depth = 0; depth < 128; depth += 1) {
    try {
      fs.lstatSync(path.join(current, '.git'));
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

/**
 * Contract §4 forbids committing Stripe ids (`stripePriceCarrier.ts:8-9`), so
 * neither the carrier nor the signing secret may land anywhere inside this
 * worktree — including via `..` traversal, a symlinked parent or a symlink AT
 * the output path itself. Both sides are compared after `realpathSync`, which
 * is what makes the symlink half of that sentence true rather than decorative.
 *
 * Knowing only THIS worktree is not enough. The machine carries several
 * checkouts of this same repository (the primary working copy plus every
 * `nailsalon-worktrees/*` sibling), and a mistyped `--webhook-secret-out`
 * landing in one of them would write a `whsec_` into a live checkout that
 * passes the worktree test. `.gitignore:59` covers `.env*`, not
 * `whsec-test.txt` or `carrier-test.json`. So a second, broader gate refuses
 * any path with a `.git` entry in ANY ancestor directory — that is, any path
 * inside any git checkout at all, this repository's or anyone's.
 */
export function assertOutputPathOutsideRepository(
  candidate: string,
  repositoryRoot: string,
  label: string,
): string {
  const resolved = realpathOfNearestExistingAncestor(candidate);
  const root = realpathOfNearestExistingAncestor(repositoryRoot);
  const relative = path.relative(root, resolved);
  const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (inside) {
    throw new RefusalError(
      `${label} resolves inside the git worktree (${resolved}). Stripe identifiers and signing secrets `
      + 'must never be written into the repository (contract §4, src/libs/billing/stripePriceCarrier.ts:8-9). '
      + 'Choose a path outside it.',
    );
  }

  const checkout = enclosingGitCheckout(resolved);
  if (checkout !== null) {
    throw new RefusalError(
      `${label} resolves inside a git checkout (${resolved} — the checkout root is ${checkout}, which holds a `
      + '.git entry). Stripe identifiers and signing secrets must never be written into ANY repository, not just '
      + 'this worktree (contract §4, src/libs/billing/stripePriceCarrier.ts:8-9): another checkout of this same '
      + 'repository ignores .env* but not carrier-test.json or whsec-test.txt. Choose a path outside every '
      + 'git checkout.',
    );
  }

  return resolved;
}

export type SecureWriteOutcome = 'created' | 'unchanged' | 'overwritten';

/**
 * The only writer in this script.
 *
 *  - REFUSES a symlink at the target (`fs.lstatSync`, which does not follow
 *    it): the real destination could be inside the repository, world-readable
 *    or another user's file.
 *  - REFUSES an existing regular file whose contents differ, unless `force`.
 *    A Stripe webhook signing secret is shown exactly once; a clobbered copy
 *    cannot be recovered, only rolled.
 *  - ACCEPTS an existing file whose bytes are already identical and reports
 *    `unchanged`. That is what makes `--apply` resumable: re-running after a
 *    partial failure rewrites the same carrier rather than refusing.
 *  - Creates with `fs.openSync(path, 'wx', 0o600)` — O_EXCL, so the file is
 *    created with mode 0600 ATOMICALLY (Node ignores the `mode` option of
 *    `writeFileSync` when the file already exists, which previously left a
 *    window between the write and the `chmod`) and a final symlink created
 *    between the stat and the open is refused by the kernel, not followed.
 */
export function writeSecureFile(
  targetPath: string,
  contents: string,
  options: { force?: boolean } = {},
): SecureWriteOutcome {
  const force = options.force === true;

  let existing: fs.Stats | null = null;
  try {
    existing = fs.lstatSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  if (existing !== null) {
    if (existing.isSymbolicLink()) {
      throw new RefusalError(
        `${targetPath} is a symbolic link. Refusing to write a Stripe identifier or signing secret `
        + 'through a link: its real target may be inside the repository, world-readable, or owned by '
        + 'someone else. Remove the link or choose another path.',
      );
    }
    if (!existing.isFile()) {
      throw new RefusalError(
        `${targetPath} exists and is not a regular file. Refusing to write to it.`,
      );
    }

    let current: string | null = null;
    try {
      current = fs.readFileSync(targetPath, 'utf8');
    } catch {
      current = null;
    }
    if (current === contents) {
      fs.chmodSync(targetPath, 0o600);
      return 'unchanged';
    }
    if (!force) {
      throw new RefusalError(
        `${targetPath} already exists with different contents. Refusing to overwrite it: a Stripe `
        + 'webhook signing secret is shown exactly once, so a clobbered copy cannot be recovered — only '
        + 'rolled in the Stripe Dashboard. Pass --force to overwrite deliberately, or choose another path.',
      );
    }
    fs.rmSync(targetPath);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const handle = fs.openSync(targetPath, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, contents);
  } finally {
    fs.closeSync(handle);
  }
  fs.chmodSync(targetPath, 0o600);
  return existing === null ? 'created' : 'overwritten';
}

// ---------------------------------------------------------------------------
// T7 — the signing secret reaches its sinks in a survivable order
// ---------------------------------------------------------------------------

export type SecretDelivery = {
  printed: boolean;
  written: SecureWriteOutcome | null;
  /** A redacted description of a `--webhook-secret-out` failure the print survived. */
  writeFailure: string | null;
};

/**
 * Stripe returns the webhook signing secret EXACTLY ONCE, at creation. Both
 * sinks can refuse — `--webhook-secret-out` on an existing file with different
 * bytes, a symlink or a directory — so the order in which they are tried
 * decides whether a refusal costs the operator the secret.
 *
 * T7: `--print-webhook-secret` therefore goes FIRST. If the file sink then
 * refuses, the value is already in the operator's terminal and the refusal is
 * reported rather than thrown; if nothing printed it, the refusal is rethrown
 * so the run fails loudly with the recovery instructions.
 *
 * The write is injectable purely so the ordering can be unit-tested without
 * touching the filesystem; production passes `writeSecureFile`.
 */
export function deliverWebhookSecret(options: {
  secret: string;
  print: boolean;
  outPath: string | null;
  force: boolean;
  stdout?: (text: string) => void;
  writeFile?: (target: string, contents: string, opts: { force?: boolean }) => SecureWriteOutcome;
}): SecretDelivery {
  const stdout = options.stdout ?? ((text: string) => {
    process.stdout.write(text);
  });
  const writeFile = options.writeFile ?? writeSecureFile;

  let printed = false;
  if (options.print) {
    // Explicit operator opt-in. Bypasses redaction deliberately and is the
    // ONLY place a secret value can reach stdout.
    stdout(`${options.secret}\n`);
    printed = true;
  }

  let written: SecureWriteOutcome | null = null;
  let writeFailure: string | null = null;
  if (options.outPath !== null) {
    try {
      written = writeFile(options.outPath, `${options.secret}\n`, { force: options.force });
    } catch (error) {
      if (!printed) {
        throw error;
      }
      writeFailure = describeErrorForOutput(error);
    }
  }

  if (!printed && written === null) {
    throw new RefusalError(
      'THE WEBHOOK SIGNING SECRET COULD NOT BE PERSISTED: neither --webhook-secret-out nor '
      + '--print-webhook-secret was given. Stripe returns it exactly once, at creation, so the copy in this '
      + 'process is the only one that ever existed. Roll the secret in the Stripe Dashboard (test mode) -> '
      + 'Developers -> Webhooks -> that endpoint -> "Roll secret" and stage the new value yourself. '
      + 'The value is deliberately NOT printed here.',
    );
  }

  return { printed, written, writeFailure };
}

// ---------------------------------------------------------------------------
// EXPECTED_STRIPE_API_VERSION extraction + id-shape drift check
// ---------------------------------------------------------------------------

/**
 * `src/libs/stripe.ts:36` holds the pinned version, but importing that module
 * executes :43 (`new Stripe(Env.STRIPE_SECRET_KEY, ...)`), which triggers full
 * t3-env validation. The header at :33-34 forbids renaming or re-homing the
 * symbol, so reading the literal out of the source text is stable by contract.
 */
export function extractExpectedStripeApiVersion(sourceText: string): string | null {
  const match = /EXPECTED_STRIPE_API_VERSION\s*=\s*'(\d{4}-\d{2}-\d{2})'/.exec(sourceText);
  return match === null ? null : (match[1] as string);
}

export function canonicalIdShapeMatches(carrierSourceText: string): boolean {
  return carrierSourceText.includes(CANONICAL_STRIPE_ID_SHAPE_SOURCE);
}

// ---------------------------------------------------------------------------
// Webhook URL validation
// ---------------------------------------------------------------------------

export const WEBHOOK_PATHNAME = '/api/webhooks/stripe-billing';

/**
 * Resolves WHERE the webhook url comes from, before it is validated.
 *
 * `--webhook-url` puts the url — and therefore the Vercel Protection-Bypass
 * token in its query string — into this process's argv, visible to `ps` and to
 * shell history. That is the exact hazard `--bypass-secret-env` exists to avoid
 * in `scripts/billing-readiness-check.ts`: it takes the NAME of the variable, so
 * the bypass value travels in a header and never through that process's argv.
 * This flag's env-name sibling gives the same transport here — the operator
 * exports the url and passes only the VARIABLE NAME.
 *
 * The NAME is safe to echo; the value never is.
 */
export function resolveWebhookUrlSource(
  parsed: Pick<ParsedArgs, 'webhookUrl' | 'webhookUrlEnv'>,
  env: Record<string, string | undefined>,
): string | null {
  if (parsed.webhookUrl !== null) {
    return parsed.webhookUrl;
  }
  if (parsed.webhookUrlEnv === null) {
    return null;
  }
  const value = env[parsed.webhookUrlEnv];
  if (value === undefined || value === '') {
    throw new UsageError(
      `--webhook-url-env named ${parsed.webhookUrlEnv}, which is unset or empty in this shell. `
      + 'Export the exact webhook url under that name (the value is never printed), or pass --webhook-url.',
    );
  }
  if (value !== value.trim()) {
    throw new UsageError(
      `the url in ${parsed.webhookUrlEnv} has leading or trailing whitespace; Stripe stores the url `
      + 'byte-for-byte and a stray newline would make every delivery 404.',
    );
  }
  return value;
}

/**
 * Validates on a PARSED COPY and returns the RAW string. `parsed.toString()`
 * is deliberately never used: percent-encoding normalisation would mangle the
 * `?x-vercel-protection-bypass=<token>` query that lets Stripe's POST past
 * Vercel Deployment Protection on a Preview origin.
 */
export function validateWebhookUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UsageError(`--webhook-url is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new UsageError(`--webhook-url must use https: (saw "${parsed.protocol}").`);
  }
  if (parsed.pathname !== WEBHOOK_PATHNAME) {
    throw new UsageError(
      `--webhook-url pathname must be exactly ${WEBHOOK_PATHNAME} (saw "${parsed.pathname}"). `
      + 'The billing endpoint is distinct from /api/webhooks/stripe and /api/webhooks/stripe-connect.',
    );
  }
  return raw;
}

// ---------------------------------------------------------------------------
// T2 — host allowlist
// ---------------------------------------------------------------------------

/**
 * Hosts this tool refuses outright, whatever `--allow-host` claims.
 *
 * `www.lustergel.app` is the LIVE domain (memory: islanailsalon.com now 404s,
 * both are kept here because DNS can be repointed and a refusal costs nothing).
 * Production activation is an owner-executed runbook procedure with live-mode
 * keys — it is categorically not something this TEST-MODE provisioner performs,
 * so there is no flag that unlocks these.
 */
export const PRODUCTION_WEBHOOK_HOSTS: readonly string[] = [
  'lustergel.app',
  'www.lustergel.app',
  'islanailsalon.com',
  'www.islanailsalon.com',
];

/**
 * Same normalisation the seed script applies to `--expect-host`
 * (`scripts/billing-preview-rehearsal-seed.ts` `normalizeHost`): ASCII
 * lowercase, trailing dot dropped, IPv6 brackets stripped. A host is compared,
 * never a url.
 */
export function normalizeHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withoutTrailingDot = trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailingDot.startsWith('[') && withoutTrailingDot.endsWith(']')) {
    return withoutTrailingDot.slice(1, -1);
  }
  return withoutTrailingDot;
}

/**
 * T2. `validateWebhookUrl` proves the SHAPE (https + the billing pathname);
 * this proves the DESTINATION. Returns the normalised hostname so the caller
 * can print it (T4) — a hostname is public, unlike the query string beside it.
 */
export function assertWebhookHostAllowed(url: string, allowHost: string | null): string {
  let host: string;
  try {
    host = normalizeHostname(new URL(url).hostname);
  } catch {
    throw new UsageError('--webhook-url is not a valid URL.');
  }
  if (allowHost === null) {
    throw new UsageError(
      `a webhook url requires --allow-host ${host}: the host must be typed deliberately, not inferred from the url.`,
    );
  }
  const allowed = normalizeHostname(allowHost);
  if (PRODUCTION_WEBHOOK_HOSTS.includes(host) || PRODUCTION_WEBHOOK_HOSTS.includes(allowed)) {
    throw new RefusalError(
      `refusing a production host (${PRODUCTION_WEBHOOK_HOSTS.includes(host) ? host : allowed}). `
      + 'This tool provisions Stripe TEST MODE for a Preview rehearsal; production activation is an '
      + 'owner-executed live-mode runbook procedure and no flag here unlocks it.',
    );
  }
  if (allowed !== host) {
    throw new RefusalError(
      `--allow-host ${allowed} does not match the webhook url's host ${host}. `
      + 'Refusing to register an endpoint against a host the operator did not type.',
    );
  }
  return host;
}

/**
 * T4. The confirmation block the operator reads before any endpoint write: the
 * exact url that will be registered, the host it was allowed for, and the
 * branch-alias rule. The url is returned VERBATIM — callers emit it through
 * `redactSecrets()`, which masks the `x-vercel-protection-bypass` token and
 * nothing else, so what reaches the terminal is byte-for-byte the string
 * Stripe will store apart from the one value that must never be echoed.
 */
export function describeWebhookRegistrationTarget(
  url: string,
  allowedHost: string,
  createWebhook: boolean,
): string[] {
  return [
    `webhook url to register: ${url}`,
    `webhook host allowed by --allow-host: ${allowedHost}`,
    'T4 rule: register against the IMMUTABLE per-deployment URL, or a branch aliased `pilot-isla`. '
    + 'The Vercel git-branch alias truncates at 14 characters, so every agent/billing-* branch resolves to '
    + 'the same alias and would steal each other\'s deliveries.',
    createWebhook
      ? 'webhook endpoint creation: ARMED for this run (--create-webhook).'
      : 'webhook endpoint creation: NOT armed (--create-webhook absent) — nothing will be registered (T6).',
  ];
}

// ---------------------------------------------------------------------------
// Plan construction (pure)
// ---------------------------------------------------------------------------

export type PlannedProduct = {
  id: string;
  name: string;
  description: string;
  metadata: Record<string, string>;
};

export type PlannedPrice = {
  key: string;
  section: 'offers' | 'topups';
  productId: string;
  unitAmount: number;
  currency: 'cad';
  recurring: { interval: 'month' | 'year'; interval_count: 1 } | null;
  lookupKey: string;
  nickname: string;
  taxBehavior: 'exclusive';
  metadata: Record<string, string>;
};

export type PlannedCoupon = {
  id: string;
  percentOff: number;
  duration: 'once';
  name: string;
  metadata: Record<string, string>;
};

export type PlannedWebhook = {
  url: string;
  enabledEvents: readonly string[];
  apiVersion: string;
  description: string;
  metadata: Record<string, string>;
};

export type PlannedPortal = {
  features: Stripe.BillingPortal.ConfigurationCreateParams.Features;
  businessProfile: { headline: string };
  metadata: Record<string, string>;
};

export type ProvisionPlan = {
  env: PlanEnv;
  products: PlannedProduct[];
  prices: PlannedPrice[];
  coupon: PlannedCoupon;
  webhook: PlannedWebhook | null;
  portal: PlannedPortal | null;
};

export function planProductId(env: PlanEnv, planDefinitionKey: string): string {
  return `luster_${env}_plan_${planDefinitionKey}`;
}

export function topupProductId(env: PlanEnv): string {
  return `luster_${env}_topups_2026_08`;
}

export function couponId(env: PlanEnv): string {
  // The suffix must be ALPHANUMERIC ONLY: STRIPE_ID_SHAPE forbids underscores
  // after the prefix, so `coupon_founding_annual_2026` would be rejected as
  // INVALID_ID by parseStripePriceCarrier (stripePriceCarrier.ts:122-124),
  // failing the WHOLE carrier closed. Fixture precedent for the accepted
  // shape: src/libs/billing/stripePriceMap.test.ts:45.
  return `coupon_lusterfoundingannual2026${env}`;
}

export function lookupKeyFor(env: PlanEnv, offerKey: string): string {
  return `luster_${env}_${offerKey}`;
}

export function intervalFor(cadence: 'monthly' | 'annual'): 'month' | 'year' {
  return cadence === 'monthly' ? 'month' : 'year';
}

/** Display names come from `planDefinitions.ts:68/78/88`. */
const PLAN_DISPLAY_NAME: Readonly<Record<string, string>> = {
  starter_2026_08: 'Starter',
  pro_2026_08: 'Pro',
  elite_2026_08: 'Elite',
};

export function buildProvisionPlan(input: {
  env: PlanEnv;
  catalogue: Catalogue;
  apiVersion: string;
  webhookUrl: string | null;
  includePortal: boolean;
}): ProvisionPlan {
  const { env, catalogue, apiVersion, webhookUrl, includePortal } = input;

  const planKeys = [...new Set(
    Object.values(catalogue.offers).map(offer => offer.planDefinitionKey),
  )].sort();

  const products: PlannedProduct[] = planKeys.map((planKey) => {
    const display = PLAN_DISPLAY_NAME[planKey];
    if (display === undefined) {
      throw new ProvisionError(
        EXIT.verification,
        `No display name is known for plan definition key '${planKey}'. `
        + 'src/libs/billing/planDefinitions.ts has gained a paid plan this script does not model.',
      );
    }
    return {
      id: planProductId(env, planKey),
      name: `Luster ${display}`,
      description: `Luster ${display} plan`,
      metadata: {
        luster_catalog: CATALOG_MARKER,
        luster_plan_env: env,
        luster_plan_definition_key: planKey,
        luster_provisioner: PROVISIONER,
      },
    };
  });

  products.push({
    id: topupProductId(env),
    // Name and description are script-chosen: the runbook names the Product
    // only as `<topup_prod_id>` (:87) and never gives it a display name.
    name: 'Luster SMS credits',
    description: 'Luster SMS credit top-ups',
    metadata: {
      luster_catalog: CATALOG_MARKER,
      luster_plan_env: env,
      luster_catalog_section: 'topups',
      luster_provisioner: PROVISIONER,
    },
  });

  const prices: PlannedPrice[] = [];

  for (const offer of Object.values(catalogue.offers)) {
    prices.push({
      key: offer.key,
      section: 'offers',
      productId: planProductId(env, offer.planDefinitionKey),
      unitAmount: offer.priceCents,
      currency: 'cad',
      recurring: { interval: intervalFor(offer.cadence), interval_count: 1 },
      lookupKey: lookupKeyFor(env, offer.key),
      nickname: offer.key,
      taxBehavior: 'exclusive',
      metadata: {
        // `luster_key` is the idempotency discriminator this script looks up by;
        // `luster_offer_key` is the human-facing mirror asserted by --verify.
        luster_key: offer.key,
        luster_offer_key: offer.key,
        luster_catalog: CATALOG_MARKER,
        luster_catalog_section: 'offers',
        luster_plan_env: env,
        luster_price_cents: String(offer.priceCents),
        luster_currency: 'cad',
        luster_plan_definition_key: offer.planDefinitionKey,
        luster_provisioner: PROVISIONER,
      },
    });
  }

  for (const offer of Object.values(catalogue.topups)) {
    prices.push({
      key: offer.key,
      section: 'topups',
      productId: topupProductId(env),
      unitAmount: offer.priceCents,
      currency: 'cad',
      // No `recurring` block at all: a recurring top-up Price would silently
      // open a subscription at Checkout (runbook :85, :89).
      recurring: null,
      lookupKey: lookupKeyFor(env, offer.key),
      nickname: offer.key,
      taxBehavior: 'exclusive',
      metadata: {
        luster_key: offer.key,
        luster_offer_key: offer.key,
        luster_catalog: CATALOG_MARKER,
        luster_catalog_section: 'topups',
        luster_plan_env: env,
        luster_price_cents: String(offer.priceCents),
        luster_currency: 'cad',
        luster_topup_credits: String(offer.credits),
        luster_topup_audience: offer.audience,
        luster_provisioner: PROVISIONER,
      },
    });
  }

  const promotion = catalogue.promotions.founding_annual_2026;
  if (promotion === undefined) {
    throw new ProvisionError(
      EXIT.verification,
      'PROMOTIONS.founding_annual_2026 is missing from src/libs/billing/promotions.ts.',
    );
  }
  if (promotion.percentOffAgainstAnnualPrice !== 40 || promotion.duration !== 'once') {
    throw new ProvisionError(
      EXIT.verification,
      'The founding promotion is no longer 40% / once. Contract §3.4 is binding '
      + '(a 50%-off coupon is explicitly rejected); refusing to provision a coupon that disagrees.',
    );
  }

  const coupon: PlannedCoupon = {
    id: couponId(env),
    percentOff: 40,
    duration: 'once',
    name: 'Founding annual (40% off, first term)',
    metadata: {
      luster_key: promotion.key,
      luster_promotion_key: promotion.key,
      luster_catalog: CATALOG_MARKER,
      luster_catalog_section: 'coupons',
      luster_plan_env: env,
      luster_provisioner: PROVISIONER,
    },
  };

  const webhook: PlannedWebhook | null = webhookUrl === null
    ? null
    : {
        url: webhookUrl,
        enabledEvents: [...BILLING_WEBHOOK_HANDLED_TYPES],
        apiVersion,
        description: `Luster billing (${env})`,
        metadata: {
          luster_endpoint: 'stripe-billing',
          luster_plan_env: env,
          luster_provisioner: PROVISIONER,
        },
      };

  const portal: PlannedPortal | null = includePortal
    ? {
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
          subscription_cancel: {
            enabled: true,
            // Set EXPLICITLY rather than relying on the API default:
            // 'immediately' would strand a prepaid annual subscriber, and the
            // PREPAID_ENTITLEMENT_REMAINS path in billingSubscriptionProjection.ts
            // assumes period-end semantics.
            mode: 'at_period_end',
            proration_behavior: 'none',
          },
          // D16 (runbook :124, binding): no plan or price switching. The two
          // companion fields are REQUIRED by ConfigurationCreateParams even
          // when the feature is off (ConfigurationsResource.d.ts:180-193), and
          // an empty allow-list is what "not updateable" means there.
          subscription_update: {
            enabled: false,
            default_allowed_updates: [],
            products: null,
          },
          customer_update: { enabled: false, allowed_updates: [] },
        },
        businessProfile: { headline: PORTAL_HEADLINE },
        metadata: {
          luster_portal_config: PORTAL_CONFIG_MARKER,
          luster_plan_env: env,
          luster_provisioner: PROVISIONER,
        },
      }
    : null;

  return { env, products, prices, coupon, webhook, portal };
}

// ---------------------------------------------------------------------------
// Carrier assembly + self-validation
// ---------------------------------------------------------------------------

export type Carrier = {
  env: string;
  offers: Record<string, string>;
  topups: Record<string, string>;
  coupons: Record<string, string>;
};

/**
 * Reimplements every check in `parseStripePriceCarrier`
 * (`src/libs/billing/stripePriceCarrier.ts:78-133`) so the script refuses to
 * emit a carrier its own copy of the parser would reject. Adds the exact-count
 * rule the live parser does not have: `readinessCheck.ts`'s
 * `checkStripePriceCarrier` reports `ok: true` for a carrier that parses but is
 * missing catalogue keys (it counts them into its detail string instead), so
 * nothing downstream catches a short carrier — it just resolves
 * PRICE_UNCONFIGURED -> HTTP 503 at runtime.
 */
export function validateCarrier(
  carrier: Carrier,
  expectedEnv: PlanEnv,
  catalogue: Catalogue,
): string[] {
  const failures: string[] = [];

  if (!['dev', 'test', 'prod'].includes(carrier.env)) {
    failures.push(`carrier.env '${carrier.env}' is not one of dev|test|prod (MALFORMED).`);
  }
  if (carrier.env !== expectedEnv) {
    failures.push(`carrier.env '${carrier.env}' !== BILLING_PLAN_ENV '${expectedEnv}' (ENV_MISMATCH).`);
  }

  const known: Record<CatalogSection, Set<string>> = {
    offers: new Set(Object.keys(catalogue.offers)),
    topups: new Set(Object.keys(catalogue.topups)),
    coupons: new Set(Object.keys(catalogue.promotions)),
  };
  const sections: CatalogSection[] = ['offers', 'topups', 'coupons'];

  for (const section of sections) {
    const table = carrier[section];
    if (table === null || typeof table !== 'object' || Array.isArray(table)) {
      failures.push(`carrier.${section} must be an object, never an array (MALFORMED).`);
      continue;
    }
    for (const key of Object.keys(table)) {
      if (!known[section].has(key)) {
        failures.push(`carrier.${section}.${key} is not a known catalogue key (UNKNOWN_KEY).`);
      }
    }
    for (const key of known[section]) {
      if (!Object.prototype.hasOwnProperty.call(table, key)) {
        failures.push(`carrier.${section} is missing catalogue key '${key}'.`);
      }
    }
    const expectedCount = known[section].size;
    const actualCount = Object.keys(table).length;
    if (actualCount !== expectedCount) {
      failures.push(`carrier.${section} has ${actualCount} keys, expected exactly ${expectedCount}.`);
    }
  }

  const seen = new Set<string>();
  for (const section of sections) {
    const table = carrier[section];
    if (table === null || typeof table !== 'object' || Array.isArray(table)) {
      continue;
    }
    for (const [key, value] of Object.entries(table)) {
      if (!isConfiguredStripeId(value)) {
        failures.push(`carrier.${section}.${key} does not match the Stripe id shape (INVALID_ID).`);
        continue;
      }
      if (seen.has(value)) {
        failures.push(`carrier.${section}.${key} repeats an id already used elsewhere (DUPLICATE_ID).`);
      }
      seen.add(value);
    }
  }

  return failures;
}

export function buildCarrier(
  env: PlanEnv,
  resolved: ReadonlyMap<string, { section: 'offers' | 'topups'; id: string }>,
  couponStripeId: string,
  promotionKey: string,
): Carrier {
  const carrier: Carrier = { env, offers: {}, topups: {}, coupons: {} };
  for (const [key, entry] of resolved) {
    carrier[entry.section][key] = entry.id;
  }
  carrier.coupons[promotionKey] = couponStripeId;
  return carrier;
}

/** `promotions.ts:97-106`: exactly 60% of the standard annual price. */
export function computeFoundingFirstTermCents(annualCents: number, percentOff: number): number {
  const scaled = annualCents * (100 - percentOff);
  if (scaled % 100 !== 0) {
    throw new VerificationError(
      `Founding promotion math is not integer-exact for ${annualCents} cents at ${percentOff}% off.`,
    );
  }
  return scaled / 100;
}

// ---------------------------------------------------------------------------
// Stripe helpers
// ---------------------------------------------------------------------------

function isResourceMissing(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === 'resource_missing';
}

function metadataValue(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | undefined {
  if (metadata === null || metadata === undefined) {
    return undefined;
  }
  const value = metadata[key];
  return typeof value === 'string' ? value : undefined;
}

export function idempotencyKeyFor(env: PlanEnv, kind: string, key: string): string {
  return `luster-provision-${env}-${kind}-${key}-v1`;
}

/**
 * The webhook url carries the Vercel Protection-Bypass token, which is a
 * credential for the entire Preview deployment. An Idempotency-Key is a header
 * Stripe persists for 24h and renders in its request logs, so the url must
 * NEVER be one. This hashes a stable handle instead: the same url always
 * yields the same 64-char key (so a retry is still idempotent), and the key
 * discloses nothing. It is also comfortably inside Stripe's 255-char cap,
 * which a ~205-char preview alias was not.
 */
export const WEBHOOK_HANDLE_PREFIX = 'luster-billing-webhook:';

export function webhookIdempotencyHandle(url: string): string {
  return crypto.createHash('sha256').update(`${WEBHOOK_HANDLE_PREFIX}${url}`).digest('hex');
}

/**
 * Stripe's `limit` caps at 100, so a page is at most 100 objects.
 */
export const LIST_PAGE_LIMIT = 100;

/**
 * Hard safety cap on pagination, expressed in PAGES. It exists only so a
 * pathological account cannot spin forever; it is NOT a silent truncation
 * point. Hitting it THROWS (see `collectAllPages`), because a partial list
 * would silently disable safety gate 6a — `classifyCatalogueCollisions` can
 * only refuse on objects that are actually present in the array it is given,
 * so a truncated inventory reports "no collision" and duplicates a hand-built
 * catalogue. Refusing is the only safe answer.
 */
export const LIST_MAX_PAGES = 1000;

export type StripeListPage<T> = { data: T[]; has_more: boolean };

/**
 * Pages a Stripe list endpoint to EXHAUSTION.
 *
 * Returns only when Stripe itself says there is nothing left (`has_more`
 * false, or an empty page). If the page cap is reached while Stripe still
 * reports `has_more`, this throws a `RefusalError` naming the resource and the
 * number of objects collected — it never returns a partial list, and no caller
 * has to remember to check for truncation.
 */
export async function collectAllPages<T extends { id: string }>(
  resource: string,
  fetchPage: (startingAfter: string | undefined) => Promise<StripeListPage<T>>,
): Promise<T[]> {
  const all: T[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const result = await fetchPage(startingAfter);
    all.push(...result.data);
    if (!result.has_more || result.data.length === 0) {
      return all;
    }
    const last = result.data[result.data.length - 1];
    if (last === undefined) {
      return all;
    }
    startingAfter = last.id;
  }

  throw new RefusalError(
    `Stripe still reports has_more after ${LIST_MAX_PAGES} pages of ${resource} `
    + `(${all.length} objects collected, ${LIST_PAGE_LIMIT} per page). Returning a partial list would `
    + 'silently disable the collision scan (safety gate 6a), which can only refuse on objects it was '
    + 'actually given — so this run refuses instead. Provision against an account whose '
    + `${resource} list is enumerable, or raise LIST_MAX_PAGES deliberately.`,
  );
}

async function listAllPrices(
  client: ProvisionStripeClient,
  productId: string,
): Promise<Stripe.Price[]> {
  // `prices.list` is strongly consistent; `prices.search` is NOT (its index
  // lags by up to a minute), so a re-run seconds later could miss a
  // just-created Price and duplicate it.
  return collectAllPages<Stripe.Price>(`Prices of ${productId}`, async (startingAfter) => {
    const params: Stripe.PriceListParams = { product: productId, limit: LIST_PAGE_LIMIT };
    if (startingAfter !== undefined) {
      params.starting_after = startingAfter;
    }
    return client.prices.list(params);
  });
}

/**
 * Account-wide Price listing, used by the collision scan (and by the
 * account-mode probe's single-object sample).
 */
async function listAllAccountPrices(client: ProvisionStripeClient): Promise<Stripe.Price[]> {
  return collectAllPages<Stripe.Price>('account Prices', async (startingAfter) => {
    const params: Stripe.PriceListParams = { limit: LIST_PAGE_LIMIT };
    if (startingAfter !== undefined) {
      params.starting_after = startingAfter;
    }
    return client.prices.list(params);
  });
}

async function listAllProducts(client: ProvisionStripeClient): Promise<Stripe.Product[]> {
  return collectAllPages<Stripe.Product>('account Products', async (startingAfter) => {
    const params: Stripe.ProductListParams = { limit: LIST_PAGE_LIMIT };
    if (startingAfter !== undefined) {
      params.starting_after = startingAfter;
    }
    return client.products.list(params);
  });
}

async function listAllCoupons(client: ProvisionStripeClient): Promise<Stripe.Coupon[]> {
  return collectAllPages<Stripe.Coupon>('account Coupons', async (startingAfter) => {
    const params: Stripe.CouponListParams = { limit: LIST_PAGE_LIMIT };
    if (startingAfter !== undefined) {
      params.starting_after = startingAfter;
    }
    return client.coupons.list(params);
  });
}

async function listAllWebhookEndpoints(
  client: ProvisionStripeClient,
): Promise<Stripe.WebhookEndpoint[]> {
  return collectAllPages<Stripe.WebhookEndpoint>('account webhook endpoints', async (startingAfter) => {
    const params: Stripe.WebhookEndpointListParams = { limit: LIST_PAGE_LIMIT };
    if (startingAfter !== undefined) {
      params.starting_after = startingAfter;
    }
    return client.webhookEndpoints.list(params);
  });
}

async function listAllPortalConfigurations(
  client: ProvisionStripeClient,
): Promise<Stripe.BillingPortal.Configuration[]> {
  return collectAllPages<Stripe.BillingPortal.Configuration>('billing portal configurations', async (startingAfter) => {
    const params: Stripe.BillingPortal.ConfigurationListParams = { limit: LIST_PAGE_LIMIT };
    if (startingAfter !== undefined) {
      params.starting_after = startingAfter;
    }
    return client.billingPortal.configurations.list(params);
  });
}

function assertTestLivemode(livemode: boolean, what: string): void {
  if (livemode !== false) {
    throw new RefusalError(
      `${what} reports livemode=true. This script provisions TEST MODE only; refusing to continue.`,
    );
  }
}

/**
 * Account-level mode probe, run before anything is written.
 *
 * `accounts.retrieve()` proves connectivity and names the account, but the
 * Stripe **Account object carries no `livemode` field** (it is absent from
 * node_modules/stripe/types/Accounts.d.ts), so it cannot itself settle the
 * mode — hence the second read: one account-wide Price. Any object Stripe
 * returns is stamped with the mode of the key that fetched it, so a single
 * existing Price is a definitive answer. On a brand-new account with no
 * objects at all there is nothing to sample, and the per-object
 * `assertTestLivemode` on everything this script creates carries the gate.
 */
async function assertAccountIsTestMode(client: ProvisionStripeClient): Promise<string> {
  const account = await client.accounts.retrieve();
  const accountLivemode = (account as { livemode?: unknown }).livemode;
  if (accountLivemode === true) {
    throw new RefusalError(
      'the Stripe account reports livemode=true. This script provisions TEST MODE only; refusing to continue.',
    );
  }
  emit(`account: ${account.id}`);

  const sample = await client.prices.list({ limit: 1 });
  const sampled = sample.data[0];
  if (sampled !== undefined) {
    assertTestLivemode(sampled.livemode, 'the sampled account object');
    emit('livemode=false');
  } else {
    emit('livemode=false (no existing object to sample; every object created below is asserted individually)');
  }

  return account.id;
}

// ---------------------------------------------------------------------------
// Price reconciliation (the immutable-field gate)
// ---------------------------------------------------------------------------

export type PriceMismatch = { field: string; expected: string; actual: string };

/**
 * `unit_amount`, `currency`, `recurring.*` and `product` cannot be changed
 * after creation (`PriceUpdateParams`, node_modules/stripe/types/
 * PricesResource.d.ts:347-388 exposes only active/lookup_key/metadata/
 * nickname/tax_behavior/transfer_lookup_key/currency_options), so a
 * disagreement here is a refusal, never an archive-and-recreate: the old id
 * may already sit on a live test subscription and stripePriceMap's reverse
 * lookups map exactly one id per key per env.
 */
export function findImmutablePriceMismatches(
  planned: PlannedPrice,
  existing: Stripe.Price,
): PriceMismatch[] {
  const mismatches: PriceMismatch[] = [];

  if (existing.unit_amount !== planned.unitAmount) {
    mismatches.push({
      field: 'unit_amount',
      expected: String(planned.unitAmount),
      actual: String(existing.unit_amount),
    });
  }
  if (existing.currency !== planned.currency) {
    mismatches.push({ field: 'currency', expected: planned.currency, actual: existing.currency });
  }

  const existingProductId = typeof existing.product === 'string'
    ? existing.product
    : existing.product.id;
  if (existingProductId !== planned.productId) {
    mismatches.push({ field: 'product', expected: planned.productId, actual: existingProductId });
  }

  if (planned.recurring === null) {
    if (existing.type !== 'one_time' || existing.recurring !== null) {
      mismatches.push({
        field: 'type',
        expected: 'one_time (no recurring block)',
        actual: `${existing.type} (recurring ${existing.recurring === null ? 'absent' : 'present'})`,
      });
    }
  } else {
    if (existing.type !== 'recurring' || existing.recurring === null) {
      mismatches.push({ field: 'type', expected: 'recurring', actual: existing.type });
    } else {
      if (existing.recurring.interval !== planned.recurring.interval) {
        mismatches.push({
          field: 'recurring.interval',
          expected: planned.recurring.interval,
          actual: existing.recurring.interval,
        });
      }
      if (existing.recurring.interval_count !== planned.recurring.interval_count) {
        mismatches.push({
          field: 'recurring.interval_count',
          expected: String(planned.recurring.interval_count),
          actual: String(existing.recurring.interval_count),
        });
      }
    }
  }

  // `tax_behavior` is settable exactly once, only from 'unspecified'.
  if (existing.tax_behavior === 'inclusive') {
    mismatches.push({ field: 'tax_behavior', expected: 'exclusive', actual: 'inclusive' });
  }

  return mismatches;
}

// ---------------------------------------------------------------------------
// Collision detection (pure)
// ---------------------------------------------------------------------------

export type CollisionKind = 'product' | 'price' | 'coupon' | 'webhook';

export type CatalogueCollision = {
  kind: CollisionKind;
  /** The catalogue key (or planned handle) whose creation this blocks. */
  plannedKey: string;
  /** The id of the EXISTING object that collides. */
  id: string;
  detail: string;
  /** True when `--adopt-existing` can resolve it by stamping our metadata. */
  adoptable: boolean;
};

export type AccountInventory = {
  products: readonly Stripe.Product[];
  prices: readonly Stripe.Price[];
  coupons: readonly Stripe.Coupon[];
  webhookEndpoints: readonly Stripe.WebhookEndpoint[];
};

export function carriesOurCatalogMarker(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadataValue(metadata, 'luster_catalog') === CATALOG_MARKER;
}

export function carriesOurProvisioner(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadataValue(metadata, 'luster_provisioner') === PROVISIONER;
}

/**
 * Amount + currency + interval shape — the fields a hand-run
 * `stripe prices create` from runbook §2.1/§2.3 would reproduce exactly.
 */
export function priceShapeMatches(planned: PlannedPrice, price: Stripe.Price): boolean {
  if (price.currency !== planned.currency || price.unit_amount !== planned.unitAmount) {
    return false;
  }
  if (planned.recurring === null) {
    return price.recurring === null || price.recurring === undefined;
  }
  return price.recurring !== null
    && price.recurring !== undefined
    && price.recurring.interval === planned.recurring.interval
    && price.recurring.interval_count === planned.recurring.interval_count;
}

/**
 * Everything the script is about to create, checked against what the account
 * already holds — BY VALUE, not by our deterministic handles.
 *
 * The idempotency of the rest of this script is keyed entirely on handles we
 * invent (`luster_<env>_plan_<key>`, `metadata.luster_key`,
 * `coupon_lusterfoundingannual2026<env>`). Objects created by hand from
 * docs/BILLING_PRODUCTION_RUNBOOK.md §2.1-§2.3 carry Stripe-generated ids and
 * no `luster_*` metadata, so every one of those lookups misses them and the
 * script would cheerfully create a SECOND catalogue — two active recurring
 * Prices per offer, two 40%/once coupons — silently. This scan is what turns
 * that into a refusal.
 *
 * `adoptable` marks the cases `--adopt-existing` can settle by stamping our
 * metadata onto the existing object. It is deliberately narrow: adoption is
 * offered only where the adopted id is the one this script would have used
 * anyway, because `Price.product` is immutable (a Price cannot be re-homed
 * onto our Product) and a Stripe-generated coupon id does not match the
 * carrier's id shape (`stripePriceCarrier.ts:45`), so adopting either would
 * simply move the failure downstream.
 */
export function classifyCatalogueCollisions(
  plan: ProvisionPlan,
  inventory: AccountInventory,
): CatalogueCollision[] {
  const collisions: CatalogueCollision[] = [];
  const plannedProductIds = new Set(plan.products.map(product => product.id));

  for (const planned of plan.products) {
    for (const product of inventory.products) {
      if (carriesOurCatalogMarker(product.metadata)) {
        continue;
      }
      if (product.name !== planned.name) {
        continue;
      }
      collisions.push(
        product.id === planned.id
          ? {
              kind: 'product',
              plannedKey: planned.id,
              id: product.id,
              detail: `a Product already occupies our deterministic id '${planned.id}' with name `
                + `"${product.name}" but carries no metadata.luster_catalog='${CATALOG_MARKER}'`,
              adoptable: true,
            }
          : {
              kind: 'product',
              plannedKey: planned.id,
              id: product.id,
              detail: `Product ${product.id} is already named "${planned.name}" (ours would be `
                + `'${planned.id}'). Creating ours would leave two Products with the same name. `
                + 'Not adoptable: Price.product is immutable, so its Prices cannot be re-homed',
              adoptable: false,
            },
      );
    }
  }

  for (const planned of plan.prices) {
    for (const price of inventory.prices) {
      if (carriesOurCatalogMarker(price.metadata)) {
        continue;
      }
      if (price.active !== true || !priceShapeMatches(planned, price)) {
        continue;
      }
      const productId = typeof price.product === 'string' ? price.product : price.product.id;
      const adoptable = productId === planned.productId && plannedProductIds.has(productId);
      collisions.push({
        kind: 'price',
        plannedKey: planned.key,
        id: price.id,
        detail: `an active Price already has unit_amount=${planned.unitAmount} currency=`
          + `${planned.currency} ${planned.recurring === null ? 'one_time' : `${planned.recurring.interval}/1`} `
          + `on product ${productId} without our metadata${
            adoptable
              ? ''
              : ' — not adoptable: it sits on a Product that is not the one this script provisions, '
                + 'and Price.product is immutable'}`,
        adoptable,
      });
    }
  }

  for (const coupon of inventory.coupons) {
    if (carriesOurCatalogMarker(coupon.metadata)) {
      continue;
    }
    if (coupon.percent_off !== plan.coupon.percentOff || coupon.duration !== plan.coupon.duration) {
      continue;
    }
    const adoptable = coupon.id === plan.coupon.id;
    collisions.push({
      kind: 'coupon',
      plannedKey: plan.coupon.id,
      id: coupon.id,
      detail: `a Coupon already offers percent_off=${plan.coupon.percentOff} duration=`
        + `${plan.coupon.duration} without our metadata${
          adoptable
            ? ''
            : ` — not adoptable: its id is not '${plan.coupon.id}' and a Stripe-generated coupon id does `
              + 'not match the carrier id shape (src/libs/billing/stripePriceCarrier.ts:45)'}`,
      adoptable,
    });
  }

  if (plan.webhook !== null) {
    const plannedWebhook = plan.webhook;
    for (const endpoint of inventory.webhookEndpoints) {
      if (endpoint.url !== plannedWebhook.url || carriesOurProvisioner(endpoint.metadata)) {
        continue;
      }
      collisions.push({
        kind: 'webhook',
        plannedKey: 'stripe-billing',
        id: endpoint.id,
        detail: 'an endpoint already targets this exact url without our metadata',
        adoptable: true,
      });
    }
  }

  return collisions;
}

export function describeCollisions(collisions: readonly CatalogueCollision[]): string {
  const lines = collisions.map(
    collision => `  - ${collision.kind} ${collision.id} (blocks '${collision.plannedKey}'): ${collision.detail}`,
  );
  const allAdoptable = collisions.every(collision => collision.adoptable);
  return [
    `${collisions.length} existing Stripe object(s) collide with the catalogue this script would create:`,
    ...lines,
    allAdoptable
      ? 'Every one of them is an exact match this script can adopt: re-run with --adopt-existing to stamp '
      + 'our metadata onto them instead of creating duplicates.'
      : 'At least one of them cannot be adopted (see above). Resolve it by hand — archive the duplicate or '
        + 'point this script at a clean test account — before re-running. Nothing was created.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// T3 — shared-account endpoint exposure
// ---------------------------------------------------------------------------

export type WebhookEndpointSummary = {
  id: string;
  /**
   * Origin + pathname ONLY. The query string is dropped and flagged: our own
   * url carries a Vercel Protection-Bypass token there, and a foreign
   * endpoint's query can carry someone else's — `redactSecrets()` only knows
   * about the token shapes this process registered.
   */
  url: string;
  queryStringPresent: boolean;
  enabledEventCount: number;
  /**
   * stripe@16.12.0 models the Connect association as `application`
   * (`node_modules/stripe/types/WebhookEndpoints.d.ts:52`), not as the
   * `connect` boolean that WebhookEndpointCreateParams accepts, so this is
   * derived: a non-null application id means the endpoint is a Connect one.
   */
  connect: boolean;
  status: string;
};

function displayableEndpointUrl(raw: string): { url: string; queryStringPresent: boolean } {
  try {
    const parsed = new URL(raw);
    return {
      url: `${parsed.origin}${parsed.pathname}`,
      queryStringPresent: parsed.search.length > 0,
    };
  } catch {
    // An unparseable url is never echoed: it could be anything.
    return { url: '<unparseable url>', queryStringPresent: false };
  }
}

/**
 * Every test-mode endpoint on the account EXCEPT the one this run manages.
 *
 * On a shared test account each of these receives the rehearsal's events as
 * well, which is what makes `billing_stripe_event` evidence unattributable
 * (HANDOFF §7 T3, FINAL handoff §6 X3). A dedicated Sandbox (O5) returns [].
 */
export function summarizeOtherWebhookEndpoints(
  endpoints: readonly Stripe.WebhookEndpoint[],
  ourUrl: string | null,
): WebhookEndpointSummary[] {
  return endpoints
    .filter(endpoint => ourUrl === null || endpoint.url !== ourUrl)
    .map((endpoint) => {
      const { url, queryStringPresent } = displayableEndpointUrl(endpoint.url);
      return {
        id: endpoint.id,
        url,
        queryStringPresent,
        enabledEventCount: endpoint.enabled_events.length,
        connect: typeof endpoint.application === 'string' && endpoint.application.length > 0,
        status: String(endpoint.status),
      };
    });
}

export function describeSharedAccountExposure(
  summaries: readonly WebhookEndpointSummary[],
): string[] {
  if (summaries.length === 0) {
    return [
      'endpoint inventory: no OTHER test-mode webhook endpoint exists on this account '
      + '(a dedicated Stripe Sandbox, per owner decision O5 — the rehearsal\'s events reach nothing else).',
    ];
  }
  return [
    `endpoint inventory: ${summaries.length} OTHER test-mode webhook endpoint(s) on this account. `
    + 'Each of them receives the rehearsal\'s events too, so billing_stripe_event evidence from a shared '
    + 'account cannot be attributed to this rehearsal alone (HANDOFF §7 T3, owner decision O5).',
    ...summaries.map(
      summary => `  - ${summary.id} ${summary.url}${summary.queryStringPresent ? ' ?<query omitted>' : ''} `
        + `events=${summary.enabledEventCount} connect=${String(summary.connect)} status=${summary.status}`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type CatalogueResolution = {
  priceIds: ReadonlyMap<string, ResolvedPriceEntry>;
  couponStripeId: string;
};

export type RunOptions = {
  mode: Mode;
  adoptDefault: boolean;
  /** Defaults to FALSE: an unrecognised pre-existing object is a refusal. */
  adoptExisting?: boolean;
  /**
   * T6. Defaults to FALSE: the webhook step is skipped entirely — nothing is
   * created, reused, re-enabled or re-pointed — and the staging steps are
   * printed instead. Arming traffic is the deliberate final invocation.
   */
  createWebhook?: boolean;
  /**
   * T3. Defaults to FALSE: with other test-mode endpoints on the account,
   * `--apply` refuses until the operator acknowledges the shared-account
   * exposure (owner decision O5).
   */
  acknowledgeSharedAccount?: boolean;
  /**
   * Invoked the instant the catalogue (Products, Prices, Coupon) is complete
   * and BEFORE the portal and webhook steps, which are the two that can
   * refuse. `main()` writes the carrier file here, so a later refusal can
   * never leave created Stripe ids unrecorded. Only called under `--apply`.
   */
  onCatalogueResolved?: (resolution: CatalogueResolution) => Promise<void> | void;
};

export type ResolvedPriceEntry = { section: 'offers' | 'topups'; id: string };

export type ProvisionResult = {
  accountId: string;
  productIds: string[];
  priceIds: ReadonlyMap<string, ResolvedPriceEntry>;
  couponStripeId: string;
  webhookEndpointId: string | null;
  webhookSecret: string | null;
  portalConfigurationId: string | null;
  notes: string[];
};

export async function runProvision(
  client: ProvisionStripeClient,
  plan: ProvisionPlan,
  options: RunOptions,
): Promise<ProvisionResult> {
  const writing = options.mode === 'apply';
  const notes: string[] = [];

  const accountId = await assertAccountIsTestMode(client);

  // --- 0. Collision scan, before a single object is created ------------
  // Every object listed here is also livemode-asserted, which is the gate that
  // actually settles the mode (the Account object carries no `livemode`).
  const inventory: AccountInventory = {
    products: await listAllProducts(client),
    prices: await listAllAccountPrices(client),
    coupons: await listAllCoupons(client),
    // T3: listed unconditionally now. The shared-account exposure exists
    // whether or not THIS run manages an endpoint — every endpoint on the
    // account receives the rehearsal's events — so the inventory is evidence
    // the operator needs at --plan and --apply alike.
    webhookEndpoints: await listAllWebhookEndpoints(client),
  };
  for (const product of inventory.products) {
    assertTestLivemode(product.livemode, `product ${product.id}`);
  }
  for (const price of inventory.prices) {
    assertTestLivemode(price.livemode, `price ${price.id}`);
  }
  for (const coupon of inventory.coupons) {
    assertTestLivemode(coupon.livemode, `coupon ${coupon.id}`);
  }
  for (const endpoint of inventory.webhookEndpoints) {
    assertTestLivemode(endpoint.livemode, `webhook endpoint ${endpoint.id}`);
  }

  // --- 0a. T3: shared-account exposure, printed before anything is created --
  const otherEndpoints = summarizeOtherWebhookEndpoints(
    inventory.webhookEndpoints,
    plan.webhook === null ? null : plan.webhook.url,
  );
  for (const line of describeSharedAccountExposure(otherEndpoints)) {
    emit(line);
  }
  if (writing && otherEndpoints.length > 0 && options.acknowledgeSharedAccount !== true) {
    throw new RefusalError(
      `${otherEndpoints.length} other test-mode webhook endpoint(s) share this Stripe account (listed above). `
      + 'Owner decision O5 recommends a DEDICATED Stripe Sandbox for the rehearsal precisely so the evidence is '
      + 'attributable. To proceed on the shared account anyway, re-run with --acknowledge-shared-account and '
      + 'record the pre/post billing_stripe_event inventory the runbook asks for. Nothing was created.',
    );
  }

  const collisions = classifyCatalogueCollisions(plan, inventory);
  const adoptedIds = new Set<string>();
  if (collisions.length > 0) {
    emit(`collision scan: ${collisions.length} pre-existing object(s) match the planned catalogue by value`);
    if (options.adoptExisting !== true || collisions.some(collision => !collision.adoptable)) {
      throw new RefusalError(describeCollisions(collisions));
    }
    for (const collision of collisions) {
      adoptedIds.add(collision.id);
      emit(`adopting ${collision.kind} ${collision.id} (--adopt-existing): our metadata will be stamped onto it`);
    }
  }

  // --- 1. Products -----------------------------------------------------
  const productIds: string[] = [];
  for (const product of plan.products) {
    let existing: Stripe.Product | null = null;
    try {
      existing = await client.products.retrieve(product.id);
    } catch (error) {
      if (!isResourceMissing(error)) {
        throw error;
      }
    }

    if (existing === null) {
      if (!writing) {
        emit(`product PLAN-CREATE ${product.id} name="${product.name}" description="${product.description}"`);
        productIds.push(product.id);
        continue;
      }
      const created = await client.products.create(
        {
          id: product.id,
          name: product.name,
          description: product.description,
          metadata: product.metadata,
        },
        { idempotencyKey: idempotencyKeyFor(plan.env, 'product', product.id) },
      );
      assertTestLivemode(created.livemode, `product ${created.id}`);
      emit(`product CREATED ${created.id}`);
      productIds.push(created.id);
      continue;
    }

    assertTestLivemode(existing.livemode, `product ${existing.id}`);
    const marker = metadataValue(existing.metadata, 'luster_catalog');
    if (marker !== CATALOG_MARKER && !adoptedIds.has(existing.id)) {
      throw new VerificationError(
        `Product ${existing.id} already exists but is not ours `
        + `(metadata.luster_catalog is ${marker === undefined ? 'absent' : `'${marker}'`}, expected '${CATALOG_MARKER}'). `
        + 'Refusing to mutate a foreign Product. If it is an exact match of the planned Product, '
        + 're-run with --adopt-existing to stamp our metadata onto it.',
      );
    }
    if (!writing) {
      emit(`product PLAN-REUSE ${existing.id} (name/description/metadata would be refreshed in place)`);
    } else {
      const updated = await client.products.update(existing.id, {
        name: product.name,
        description: product.description,
        metadata: product.metadata,
      });
      emit(`product REUSED ${updated.id}`);
    }
    productIds.push(existing.id);
  }

  // --- 2. Prices (recurring first, then one-time) -----------------------
  const priceIds = new Map<string, ResolvedPriceEntry>();
  const consumedAdoptions = new Set<string>();
  const orderedPrices = [
    ...plan.prices.filter(price => price.section === 'offers'),
    ...plan.prices.filter(price => price.section === 'topups'),
  ];

  const pricesByProduct = new Map<string, Stripe.Price[]>();
  for (const productId of new Set(orderedPrices.map(price => price.productId))) {
    // In --plan mode a not-yet-created Product has no Prices to list.
    try {
      pricesByProduct.set(productId, await listAllPrices(client, productId));
    } catch (error) {
      if (isResourceMissing(error)) {
        pricesByProduct.set(productId, []);
      } else {
        throw error;
      }
    }
  }

  for (const planned of orderedPrices) {
    const onProduct = pricesByProduct.get(planned.productId) ?? [];
    let candidates = onProduct.filter(
      price => metadataValue(price.metadata, 'luster_key') === planned.key,
    );

    if (candidates.length === 0 && adoptedIds.size > 0) {
      // --adopt-existing: a by-value match on OUR Product, flagged by the
      // collision scan, is taken over rather than duplicated. The reuse path
      // below rewrites `metadata` wholesale, which is what stamps it.
      const adoptable = onProduct.filter(
        price => adoptedIds.has(price.id)
          && !consumedAdoptions.has(price.id)
          && price.active === true
          && priceShapeMatches(planned, price),
      );
      if (adoptable.length === 1) {
        candidates = adoptable;
        consumedAdoptions.add((adoptable[0] as Stripe.Price).id);
        emit(`price ADOPTING ${planned.key} -> ${(adoptable[0] as Stripe.Price).id}`);
      }
    }

    if (candidates.length > 1) {
      throw new VerificationError(
        `${planned.key}: ${candidates.length} Prices on ${planned.productId} carry `
        + `metadata.luster_key='${planned.key}' (${candidates.map(price => price.id).join(', ')}). `
        + 'Refusing to guess which one the carrier should point at.',
      );
    }

    const existing = candidates[0];

    if (existing === undefined) {
      if (!writing) {
        emit(
          `price PLAN-CREATE ${planned.key} product=${planned.productId} `
          + `unit_amount=${planned.unitAmount} currency=cad `
          + `${planned.recurring === null ? 'one_time' : `recurring=${planned.recurring.interval}/1`} `
          + `tax_behavior=exclusive lookup_key=${planned.lookupKey}`,
        );
        continue;
      }
      const params: Stripe.PriceCreateParams = {
        product: planned.productId,
        currency: planned.currency,
        unit_amount: planned.unitAmount,
        tax_behavior: planned.taxBehavior,
        lookup_key: planned.lookupKey,
        nickname: planned.nickname,
        active: true,
        metadata: planned.metadata,
      };
      if (planned.recurring !== null) {
        params.recurring = {
          interval: planned.recurring.interval,
          interval_count: planned.recurring.interval_count,
        };
      }
      const created = await client.prices.create(params, {
        idempotencyKey: idempotencyKeyFor(plan.env, 'price', planned.key),
      });
      assertTestLivemode(created.livemode, `price ${created.id}`);
      emit(`price CREATED ${planned.key} -> ${created.id}`);
      priceIds.set(planned.key, { section: planned.section, id: created.id });
      continue;
    }

    assertTestLivemode(existing.livemode, `price ${existing.id}`);

    const mismatches = findImmutablePriceMismatches(planned, existing);
    if (mismatches.length > 0) {
      const detail = mismatches
        .map(mismatch => `${mismatch.field}: expected ${mismatch.expected}, actual ${mismatch.actual}`)
        .join('; ');
      throw new VerificationError(
        `${planned.key}: existing Price ${existing.id} disagrees with the committed catalogue (${detail}). `
        + 'These fields are immutable in Stripe. Refusing — this Price is NOT archived and NOT recreated; '
        + 'resolve it deliberately by hand (runbook §2.1 rollback).',
      );
    }

    const repairs: string[] = [];
    if (existing.active !== true) {
      repairs.push('active=true (reactivate)');
    }
    if (existing.lookup_key !== planned.lookupKey) {
      repairs.push(`lookup_key=${planned.lookupKey}`);
    }
    if (existing.nickname !== planned.nickname) {
      repairs.push(`nickname=${planned.nickname}`);
    }
    if (existing.tax_behavior !== 'exclusive') {
      repairs.push('tax_behavior=exclusive');
    }

    if (!writing) {
      emit(
        `price PLAN-REUSE ${planned.key} -> ${existing.id}${
          repairs.length > 0 ? ` (would repair: ${repairs.join(', ')})` : ''}`,
      );
      priceIds.set(planned.key, { section: planned.section, id: existing.id });
      continue;
    }

    if (repairs.length > 0) {
      const update: Stripe.PriceUpdateParams = { metadata: planned.metadata };
      if (existing.active !== true) {
        update.active = true;
      }
      if (existing.lookup_key !== planned.lookupKey) {
        update.lookup_key = planned.lookupKey;
      }
      if (existing.nickname !== planned.nickname) {
        update.nickname = planned.nickname;
      }
      if (existing.tax_behavior !== 'exclusive') {
        update.tax_behavior = 'exclusive';
      }
      const updated = await client.prices.update(existing.id, update);
      emit(`price REUSED ${planned.key} -> ${updated.id} (repaired: ${repairs.join(', ')})`);
    } else {
      await client.prices.update(existing.id, { metadata: planned.metadata });
      emit(`price REUSED ${planned.key} -> ${existing.id}`);
    }
    priceIds.set(planned.key, { section: planned.section, id: existing.id });
  }

  // --- 3. Coupon -------------------------------------------------------
  let couponStripeId = plan.coupon.id;
  let existingCoupon: Stripe.Coupon | null = null;
  try {
    existingCoupon = await client.coupons.retrieve(plan.coupon.id);
  } catch (error) {
    if (!isResourceMissing(error)) {
      throw error;
    }
  }

  if (existingCoupon === null) {
    if (!writing) {
      emit(
        `coupon PLAN-CREATE ${plan.coupon.id} percent_off=40 duration=once `
        + 'name="Founding annual (40% off, first term)" '
        + '(currency, max_redemptions, redeem_by and applies_to deliberately unset)',
      );
    } else {
      const created = await client.coupons.create(
        {
          id: plan.coupon.id,
          percent_off: plan.coupon.percentOff,
          duration: plan.coupon.duration,
          name: plan.coupon.name,
          metadata: plan.coupon.metadata,
        },
        { idempotencyKey: idempotencyKeyFor(plan.env, 'coupon', plan.coupon.id) },
      );
      assertTestLivemode(created.livemode, `coupon ${created.id}`);
      couponStripeId = created.id;
      emit(`coupon CREATED ${created.id}`);
    }
  } else {
    assertTestLivemode(existingCoupon.livemode, `coupon ${existingCoupon.id}`);
    // Immutable fields first: a coupon at our id with the wrong percent_off is
    // a harder failure than an unstamped one, and its message is the useful one.
    if (existingCoupon.percent_off !== plan.coupon.percentOff
      || existingCoupon.duration !== plan.coupon.duration) {
      throw new VerificationError(
        `coupon ${existingCoupon.id} exists with percent_off=${existingCoupon.percent_off} `
        + `duration=${existingCoupon.duration}, expected percent_off=40 duration=once. `
        + 'Both fields are immutable in Stripe. Refusing — it is NOT deleted and NOT recreated.',
      );
    }
    if (!carriesOurCatalogMarker(existingCoupon.metadata) && !adoptedIds.has(existingCoupon.id)) {
      throw new VerificationError(
        `Coupon ${existingCoupon.id} already occupies our deterministic id but carries no `
        + `metadata.luster_catalog='${CATALOG_MARKER}'. Refusing to reuse a coupon this script did not `
        + 'create. Re-run with --adopt-existing if it is an exact match (40% / once) you want adopted.',
      );
    }
    if (existingCoupon.applies_to !== null && existingCoupon.applies_to !== undefined) {
      throw new VerificationError(
        `coupon ${existingCoupon.id} carries applies_to, which cannot express "annual only" under the `
        + 'one-Product-per-plan shape (monthly and annual share a Product). Annual eligibility is enforced '
        + 'server-side by promotions.ts:45-49 / checkout/route.ts:130-132. Refusing.',
      );
    }
    couponStripeId = existingCoupon.id;
    if (writing && adoptedIds.has(existingCoupon.id)
      && !carriesOurCatalogMarker(existingCoupon.metadata)) {
      await client.coupons.update(existingCoupon.id, { metadata: plan.coupon.metadata });
      emit(`coupon ADOPTED ${existingCoupon.id} (our metadata stamped on)`);
    } else {
      emit(`coupon ${writing ? 'REUSED' : 'PLAN-REUSE'} ${existingCoupon.id}`);
    }
  }

  notes.push(SUBSCRIPTION_PAUSE_DIVERGENCE);

  // --- 3a. CARRIER CHECKPOINT -----------------------------------------
  // The catalogue is complete and its ids exist ONLY in this process. Hand
  // them to the caller NOW, before the portal and webhook steps — both of
  // which can refuse — so a later refusal can never strand created objects
  // with no record of their ids. See the header's ORDER OF WRITES.
  if (writing && options.onCatalogueResolved !== undefined) {
    await options.onCatalogueResolved({ priceIds, couponStripeId });
  }

  // --- 4. Portal configuration -----------------------------------------
  let portalConfigurationId: string | null = null;
  if (plan.portal !== null) {
    const configurations = await listAllPortalConfigurations(client);
    const currentDefault = configurations.find(configuration => configuration.is_default === true) ?? null;
    const ours = configurations.find(
      configuration => metadataValue(configuration.metadata, 'luster_portal_config') === PORTAL_CONFIG_MARKER,
    ) ?? null;

    for (const configuration of configurations) {
      // Every configuration this script can even see must be test-mode — not
      // just the default, since `ours` is the write target when no default
      // exists and was previously never asserted.
      assertTestLivemode(configuration.livemode, `portal configuration ${configuration.id}`);
    }

    const isOurDefault = currentDefault !== null
      && metadataValue(currentDefault.metadata, 'luster_portal_config') === PORTAL_CONFIG_MARKER;

    if (currentDefault !== null && !isOurDefault && !options.adoptDefault) {
      emit(`portal DEFAULT-IS-FOREIGN ${currentDefault.id}`);
      emit(
        '  would set features.payment_method_update.enabled=true, invoice_history.enabled=true, '
        + 'subscription_cancel.enabled=true mode=at_period_end proration_behavior=none, '
        + 'subscription_update.enabled=false, customer_update.enabled=false, '
        + `business_profile.headline="${PORTAL_HEADLINE}"`,
      );
      throw new RefusalError(
        `The account's default portal configuration (${currentDefault.id}) is not ours. `
        + 'This script holds a TEST-MODE key, so the only thing updating it can change is the experience of '
        + 'TEST-mode portal sessions on this account — no live customer is reachable from here. It is still '
        + 'refused by default because the configuration was created by someone else and this script cannot '
        + 'know what test flow depends on it. The LIVE-mode default configuration is a separate object and a '
        + 'separate, owner-only decision, precisely because it does serve the live legacy-flow customers that '
        + 'src/app/api/billing/portal/route.ts keeps served regardless of BILLING_* state. '
        + 'Pass --adopt-default to update the TEST-mode default anyway.',
      );
    }

    const target = currentDefault ?? ours;

    if (target !== null) {
      assertTestLivemode(target.livemode, `portal configuration ${target.id}`);
      if (!writing) {
        emit(`portal PLAN-UPDATE ${target.id} (is_default=${String(target.is_default)})`);
      } else {
        const updated = await client.billingPortal.configurations.update(target.id, {
          features: plan.portal.features,
          business_profile: plan.portal.businessProfile,
          metadata: plan.portal.metadata,
        });
        assertTestLivemode(updated.livemode, `portal configuration ${updated.id}`);
        emit(`portal UPDATED ${updated.id}`);
      }
      if (target.is_default !== true) {
        emit(
          `MANUAL STEP REQUIRED: portal configuration ${target.id} is not the account default for this mode. `
          + 'src/app/api/billing/portal/route.ts creates sessions with no `configuration` id, so only the '
          + 'DEFAULT configuration is ever used, and `is_default` is read-only with no create/update '
          + 'parameter. Mark it default in the Stripe Dashboard (test mode) -> Settings -> Billing -> '
          + 'Customer portal, before running --verify --portal, which checks the DEFAULT configuration and '
          + 'will otherwise fail.',
        );
        notes.push(`portal configuration ${target.id} is not the account default — Stripe Dashboard step required.`);
      }
      portalConfigurationId = target.id;
    } else if (!writing) {
      emit('portal PLAN-CREATE (no default configuration exists yet)');
    } else {
      const created = await client.billingPortal.configurations.create(
        {
          features: plan.portal.features,
          business_profile: plan.portal.businessProfile,
          metadata: plan.portal.metadata,
        },
        { idempotencyKey: idempotencyKeyFor(plan.env, 'portal', PORTAL_CONFIG_MARKER) },
      );
      assertTestLivemode(created.livemode, `portal configuration ${created.id}`);
      portalConfigurationId = created.id;
      emit(`portal CREATED ${created.id}`);

      const reread = await client.billingPortal.configurations.retrieve(created.id);
      assertTestLivemode(reread.livemode, `portal configuration ${reread.id}`);
      if (reread.is_default !== true) {
        emit(
          `MANUAL STEP REQUIRED: portal configuration ${created.id} is not the account default for this mode. `
          + 'src/app/api/billing/portal/route.ts creates sessions with no `configuration` id, so only the '
          + 'DEFAULT configuration is ever used, and `is_default` is read-only with no create/update parameter. '
          + 'Mark it default in the Stripe Dashboard (test mode) -> Settings -> Billing -> Customer portal, '
          + 'before running --verify --portal, which checks the DEFAULT configuration and will otherwise fail.',
        );
        notes.push(`portal configuration ${created.id} is not yet the account default — Stripe Dashboard step required.`);
      }
    }
    emit(`portal note: ${SUBSCRIPTION_PAUSE_DIVERGENCE}`);
  }

  // --- 5. Webhook endpoint LAST, and only under --create-webhook (T6) ---
  let webhookEndpointId: string | null = null;
  let webhookSecret: string | null = null;

  if (plan.webhook !== null && options.createWebhook !== true) {
    // Deliberately BEFORE any endpoint read or write: without --create-webhook
    // this step does not exist. An endpoint armed before the secret is staged
    // 503s every delivery (route.ts WEBHOOK_NOT_CONFIGURED) and Stripe may
    // auto-disable it, which is exactly the failure T6 removes.
    emit('webhook step SKIPPED: --create-webhook was not passed (T6).');
    emit(
      'Next, in this order: (1) stage the carrier — vercel env add BILLING_STRIPE_PRICE_IDS preview <branch> — '
      + '(2) redeploy so the build inlines it, (3) re-run this script with --create-webhook to arm the endpoint, '
      + '(4) stage STRIPE_BILLING_WEBHOOK_SECRET on the same branch scope, (5) redeploy again. '
      + 'Only after step 5 does a delivery find a configured secret.',
    );
    notes.push('webhook endpoint not created: --create-webhook was not passed (T6).');
  } else if (plan.webhook !== null) {
    const plannedWebhook = plan.webhook;
    // Re-listed rather than reusing `inventory.webhookEndpoints`: the portal
    // step above can take a while, and this is the object whose duplication
    // would double-deliver every event.
    const endpoints = await listAllWebhookEndpoints(client);
    for (const endpoint of endpoints) {
      assertTestLivemode(endpoint.livemode, `webhook endpoint ${endpoint.id}`);
    }
    // Exact string equality: a near-match (same origin + path, different query)
    // is a CONFLICT, not something to silently update. The
    // ?x-vercel-protection-bypass=<token> query is what lets Stripe's POST past
    // Vercel Deployment Protection; dropping it yields an endpoint that 401s
    // every delivery.
    const exact = endpoints.find(endpoint => endpoint.url === plannedWebhook.url) ?? null;
    const nearMatches = endpoints.filter((endpoint) => {
      if (endpoint.url === plannedWebhook.url) {
        return false;
      }
      try {
        const candidate = new URL(endpoint.url);
        const wanted = new URL(plannedWebhook.url);
        return candidate.origin === wanted.origin && candidate.pathname === wanted.pathname;
      } catch {
        return false;
      }
    });

    for (const near of nearMatches) {
      emit(
        `webhook CONFLICT ${near.id} shares this origin and path but its url string differs `
        + '(query string mismatch). Not updated. Resolve by hand before the rehearsal.',
      );
    }
    if (exact === null && nearMatches.length > 0) {
      throw new VerificationError(
        `${nearMatches.length} existing endpoint(s) target ${WEBHOOK_PATHNAME} on this origin with a different `
        + 'url string. Refusing to create a second endpoint that would double-deliver every event.',
      );
    }

    if (exact === null) {
      if (!writing) {
        emit(
          `webhook PLAN-CREATE url=<supplied verbatim> enabled_events=${plan.webhook.enabledEvents.length} `
          + `api_version=${plan.webhook.apiVersion} connect=false description="${plan.webhook.description}"`,
        );
      } else {
        const created = await client.webhookEndpoints.create(
          {
            url: plan.webhook.url,
            enabled_events: [
              ...BILLING_WEBHOOK_HANDLED_TYPES,
            ] as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
            api_version: plan.webhook.apiVersion as Stripe.WebhookEndpointCreateParams.ApiVersion,
            description: plan.webhook.description,
            connect: false,
            metadata: plan.webhook.metadata,
          },
          // NOT the url: it carries the Vercel Protection-Bypass token, and an
          // Idempotency-Key is a header Stripe stores and renders in its
          // request logs. A sha256 of a stable handle is just as idempotent.
          {
            idempotencyKey: idempotencyKeyFor(
              plan.env,
              'webhook',
              webhookIdempotencyHandle(plan.webhook.url),
            ),
          },
        );
        assertTestLivemode(created.livemode, `webhook endpoint ${created.id}`);
        webhookEndpointId = created.id;
        webhookSecret = created.secret ?? null;
        emit(`webhook CREATED ${created.id}`);
        emit(`webhook_secret_captured: ${String(webhookSecret !== null)}`);
      }
    } else {
      assertTestLivemode(exact.livemode, `webhook endpoint ${exact.id}`);
      if (!carriesOurProvisioner(exact.metadata) && !adoptedIds.has(exact.id)) {
        throw new RefusalError(
          `webhook endpoint ${exact.id} already targets this exact url but carries no `
          + `metadata.luster_provisioner='${PROVISIONER}'. Refusing to take over an endpoint this script did `
          + 'not create — its signing secret is held by whoever made it. Re-run with --adopt-existing to '
          + 'stamp our metadata onto it (its secret is NOT re-issued and will not be captured).',
        );
      }
      if (exact.api_version !== plan.webhook.apiVersion) {
        throw new VerificationError(
          `webhook endpoint ${exact.id} has api_version=${String(exact.api_version)}, expected `
          + `${plan.webhook.apiVersion}. api_version is fixed at creation and absent from `
          + 'WebhookEndpointUpdateParams (node_modules/stripe/types/WebhookEndpointsResource.d.ts:395-424). '
          + 'Create a NEW endpoint with the correct version by hand; this script will not delete this one.',
        );
      }
      const wanted = new Set<string>(BILLING_WEBHOOK_HANDLED_TYPES);
      const actual = new Set<string>(exact.enabled_events);
      const missing = [...wanted].filter(type => !actual.has(type));
      const extra = [...actual].filter(type => !wanted.has(type));

      // A disabled endpoint delivers nothing. Previously only --verify caught
      // that, after the rehearsal had already been declared provisioned.
      const disabled = exact.status !== 'enabled';
      const repairs: string[] = [];
      if (missing.length + extra.length > 0) {
        repairs.push('enabled_events narrowed to the 13 handled types');
      }
      if (disabled) {
        repairs.push(`status ${String(exact.status)} -> enabled`);
      }

      if (!writing) {
        emit(
          `webhook PLAN-REUSE ${exact.id}${
            repairs.length > 0 ? ` (would repair: ${repairs.join(', ')})` : ''}`,
        );
      } else {
        const update: Stripe.WebhookEndpointUpdateParams = {
          description: plan.webhook.description,
          metadata: plan.webhook.metadata,
        };
        if (missing.length + extra.length > 0) {
          update.enabled_events = [
            ...BILLING_WEBHOOK_HANDLED_TYPES,
          ] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[];
        }
        if (disabled) {
          update.disabled = false;
        }
        const updated = await client.webhookEndpoints.update(exact.id, update);
        emit(
          `webhook ${adoptedIds.has(exact.id) ? 'ADOPTED' : 'REUSED'} ${updated.id}${
            repairs.length > 0 ? ` (repaired: ${repairs.join(', ')})` : ''}`,
        );
      }
      webhookEndpointId = exact.id;
      if (exact.secret === undefined || exact.secret === null) {
        notes.push(
          `webhook endpoint ${exact.id} already existed, so Stripe did not return its signing secret `
          + '(it is shown once, at creation). Read it from the Stripe Dashboard if STRIPE_BILLING_WEBHOOK_SECRET '
          + 'is not already provisioned in Vercel.',
        );
      } else {
        webhookSecret = exact.secret;
      }
    }
  }

  return {
    accountId,
    productIds,
    priceIds,
    couponStripeId,
    webhookEndpointId,
    webhookSecret,
    portalConfigurationId,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Verification (read-only; makes no writes even if --apply were also present)
// ---------------------------------------------------------------------------

export type VerifyInput = {
  env: PlanEnv;
  catalogue: Catalogue;
  carrier: Carrier;
  plan: ProvisionPlan;
  apiVersion: string;
  checkPortal: boolean;
};

export async function runVerify(
  client: ProvisionStripeClient,
  input: VerifyInput,
): Promise<string[]> {
  const failures: string[] = [];
  const fail = (key: string, expected: string, actual: string, objectId: string): void => {
    failures.push(`${key}: expected ${expected}, actual ${actual} (object ${objectId})`);
  };

  try {
    await assertAccountIsTestMode(client);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : 'the account mode probe failed');
  }

  failures.push(...validateCarrier(input.carrier, input.env, input.catalogue));

  // --- recurring offers -------------------------------------------------
  const annualCentsByPlan = new Map<string, number>();
  for (const offer of Object.values(input.catalogue.offers)) {
    const id = input.carrier.offers[offer.key];
    if (id === undefined) {
      failures.push(`${offer.key}: absent from carrier.offers`);
      continue;
    }
    const price = await client.prices.retrieve(id);
    const productId = typeof price.product === 'string' ? price.product : price.product.id;
    const wantedInterval = intervalFor(offer.cadence);

    if (price.id !== id) {
      fail(offer.key, `id ${id}`, `id ${price.id}`, price.id);
    }
    if (price.active !== true) {
      fail(offer.key, 'active=true', `active=${String(price.active)}`, price.id);
    }
    if (price.livemode !== false) {
      fail(offer.key, 'livemode=false', 'livemode=true', price.id);
    }
    if (price.currency !== 'cad') {
      fail(offer.key, 'currency=cad', `currency=${price.currency}`, price.id);
    }
    if (price.unit_amount !== offer.priceCents) {
      fail(offer.key, `unit_amount=${offer.priceCents}`, `unit_amount=${String(price.unit_amount)}`, price.id);
    }
    if (price.type !== 'recurring') {
      fail(offer.key, 'type=recurring', `type=${price.type}`, price.id);
    }
    if (price.recurring === null) {
      fail(offer.key, `recurring.interval=${wantedInterval}`, 'recurring=null', price.id);
    } else {
      if (price.recurring.interval !== wantedInterval) {
        fail(offer.key, `recurring.interval=${wantedInterval}`, `recurring.interval=${price.recurring.interval}`, price.id);
      }
      if (price.recurring.interval_count !== 1) {
        fail(offer.key, 'recurring.interval_count=1', `recurring.interval_count=${price.recurring.interval_count}`, price.id);
      }
    }
    if (price.tax_behavior !== 'exclusive') {
      fail(offer.key, 'tax_behavior=exclusive', `tax_behavior=${String(price.tax_behavior)}`, price.id);
    }
    const wantedProduct = planProductId(input.env, offer.planDefinitionKey);
    if (productId !== wantedProduct) {
      fail(offer.key, `product=${wantedProduct}`, `product=${productId}`, price.id);
    }
    if (metadataValue(price.metadata, 'luster_offer_key') !== offer.key) {
      fail(offer.key, `metadata.luster_offer_key=${offer.key}`, String(metadataValue(price.metadata, 'luster_offer_key')), price.id);
    }
    if (metadataValue(price.metadata, 'luster_plan_env') !== input.env) {
      fail(offer.key, `metadata.luster_plan_env=${input.env}`, String(metadataValue(price.metadata, 'luster_plan_env')), price.id);
    }

    if (offer.cadence === 'annual' && price.unit_amount !== null) {
      annualCentsByPlan.set(offer.planDefinitionKey, price.unit_amount);
    }
  }

  // --- one-time top-ups -------------------------------------------------
  const topupProduct = topupProductId(input.env);
  for (const offer of Object.values(input.catalogue.topups)) {
    const id = input.carrier.topups[offer.key];
    if (id === undefined) {
      failures.push(`${offer.key}: absent from carrier.topups`);
      continue;
    }
    const price = await client.prices.retrieve(id);
    const productId = typeof price.product === 'string' ? price.product : price.product.id;

    if (price.active !== true) {
      fail(offer.key, 'active=true', `active=${String(price.active)}`, price.id);
    }
    if (price.type !== 'one_time') {
      fail(offer.key, 'type=one_time', `type=${price.type}`, price.id);
    }
    if (price.recurring !== null) {
      fail(offer.key, 'recurring=null', 'recurring present', price.id);
    }
    if (price.currency !== 'cad') {
      fail(offer.key, 'currency=cad', `currency=${price.currency}`, price.id);
    }
    if (price.unit_amount !== offer.priceCents) {
      fail(offer.key, `unit_amount=${offer.priceCents}`, `unit_amount=${String(price.unit_amount)}`, price.id);
    }
    if (price.tax_behavior !== 'exclusive') {
      fail(offer.key, 'tax_behavior=exclusive', `tax_behavior=${String(price.tax_behavior)}`, price.id);
    }
    if (price.livemode !== false) {
      fail(offer.key, 'livemode=false', 'livemode=true', price.id);
    }
    if (productId !== topupProduct) {
      fail(offer.key, `product=${topupProduct}`, `product=${productId}`, price.id);
    }
    if (metadataValue(price.metadata, 'luster_offer_key') !== offer.key) {
      fail(offer.key, `metadata.luster_offer_key=${offer.key}`, String(metadataValue(price.metadata, 'luster_offer_key')), price.id);
    }
  }

  // --- coupon -----------------------------------------------------------
  const promotionKey = 'founding_annual_2026';
  const couponStripeId = input.carrier.coupons[promotionKey];
  if (couponStripeId === undefined) {
    failures.push(`${promotionKey}: absent from carrier.coupons`);
  } else {
    const coupon = await client.coupons.retrieve(couponStripeId);
    if (!isConfiguredStripeId(couponStripeId)) {
      fail(promotionKey, 'an id matching the carrier regex', couponStripeId, couponStripeId);
    }
    if (coupon.percent_off !== 40) {
      fail(promotionKey, 'percent_off=40', `percent_off=${String(coupon.percent_off)}`, coupon.id);
    }
    if (coupon.duration !== 'once') {
      fail(promotionKey, 'duration=once', `duration=${coupon.duration}`, coupon.id);
    }
    if (coupon.valid !== true) {
      fail(promotionKey, 'valid=true', `valid=${String(coupon.valid)}`, coupon.id);
    }
    if (coupon.applies_to !== null && coupon.applies_to !== undefined) {
      fail(promotionKey, 'applies_to=null', 'applies_to present', coupon.id);
    }
    if (coupon.max_redemptions !== null) {
      fail(promotionKey, 'max_redemptions=null', String(coupon.max_redemptions), coupon.id);
    }
    if (coupon.redeem_by !== null) {
      fail(promotionKey, 'redeem_by=null', String(coupon.redeem_by), coupon.id);
    }
    if (coupon.livemode !== false) {
      fail(promotionKey, 'livemode=false', 'livemode=true', coupon.id);
    }

    // Founding math recomputed from LIVE unit_amount and LIVE percent_off.
    const expectedFirstTerm: Record<string, number> = {
      starter_2026_08: 8994,
      pro_2026_08: 14994,
      elite_2026_08: 26994,
    };
    const percentOff = coupon.percent_off;
    if (typeof percentOff === 'number') {
      for (const [planKey, wanted] of Object.entries(expectedFirstTerm)) {
        const annual = annualCentsByPlan.get(planKey);
        if (annual === undefined) {
          failures.push(`founding math ${planKey}: the live annual Price could not be read`);
          continue;
        }
        const computed = computeFoundingFirstTermCents(annual, percentOff);
        if (computed !== wanted) {
          fail(`founding math ${planKey}`, `${wanted} cents`, `${computed} cents`, coupon.id);
        }
      }
    }
  }

  // --- webhook endpoint -------------------------------------------------
  if (input.plan.webhook !== null) {
    const plannedWebhook = input.plan.webhook;
    const endpoints = await listAllWebhookEndpoints(client);
    const exact = endpoints.find(endpoint => endpoint.url === plannedWebhook.url) ?? null;
    if (exact === null) {
      failures.push('webhook endpoint: no endpoint has a url string-identical to --webhook-url');
    } else {
      const wanted = new Set<string>(BILLING_WEBHOOK_HANDLED_TYPES);
      const actual = new Set<string>(exact.enabled_events);
      const sameSet = wanted.size === actual.size && [...wanted].every(type => actual.has(type));
      if (actual.size !== 13 || !sameSet) {
        fail(
          'webhook enabled_events',
          'exactly the 13 handled types (order-independent)',
          `${actual.size} types, ${[...actual].filter(type => !wanted.has(type)).length} unexpected`,
          exact.id,
        );
      }
      if (exact.api_version !== input.apiVersion) {
        fail('webhook api_version', input.apiVersion, String(exact.api_version), exact.id);
      }
      if (exact.status !== 'enabled') {
        fail('webhook status', 'enabled', String(exact.status), exact.id);
      }
      if (exact.livemode !== false) {
        fail('webhook livemode', 'false', 'true', exact.id);
      }
    }
  }

  // --- portal configuration --------------------------------------------
  if (input.checkPortal) {
    const configurations = await listAllPortalConfigurations(client);
    const currentDefault = configurations.find(configuration => configuration.is_default === true) ?? null;
    const ours = configurations.find(
      configuration => metadataValue(configuration.metadata, 'luster_portal_config') === PORTAL_CONFIG_MARKER,
    ) ?? null;

    if (currentDefault === null) {
      failures.push(
        `portal: no configuration is marked default for this mode; `
        + `src/app/api/billing/portal/route.ts creates sessions without a \`configuration\` id, `
        + `so a non-default configuration is never used${
          ours === null
            ? '. Run --apply --portal first.'
            : `. Our configuration ${ours.id} exists but is not the default: mark it default in the Stripe `
              + 'Dashboard (test mode) -> Settings -> Billing -> Customer portal. `is_default` is read-only '
              + 'over the API, so this is the one step no script can take.'}`,
      );
    }

    // Checked on EVERY path: the default (what portal sessions actually use)
    // and, when it is a different object, ours — so an --adopt-default or
    // reuse run cannot leave a configuration unverified.
    const targets = [currentDefault, ours === null || ours.id === currentDefault?.id ? null : ours]
      .filter((configuration): configuration is Stripe.BillingPortal.Configuration => configuration !== null);

    for (const configuration of targets) {
      const label = configuration.id === currentDefault?.id ? 'portal' : 'portal (ours, not default)';
      const features = configuration.features;
      if (features.subscription_update.enabled !== false) {
        fail(`${label} subscription_update.enabled`, 'false (D16)', 'true', configuration.id);
      }
      if (features.subscription_cancel.enabled !== true) {
        fail(`${label} subscription_cancel.enabled`, 'true', 'false', configuration.id);
      }
      if (features.subscription_cancel.mode !== 'at_period_end') {
        fail(`${label} subscription_cancel.mode`, 'at_period_end', String(features.subscription_cancel.mode), configuration.id);
      }
      if (features.payment_method_update.enabled !== true) {
        fail(`${label} payment_method_update.enabled`, 'true', 'false', configuration.id);
      }
      if (features.invoice_history.enabled !== true) {
        fail(`${label} invoice_history.enabled`, 'true', 'false', configuration.id);
      }
      // D16 (runbook §2.5 :135): the customer may not self-edit billing
      // details in the portal. Never checked before, so a legacy configuration
      // adopted via --adopt-default passed --verify with it on.
      if (features.customer_update.enabled !== false) {
        fail(`${label} customer_update.enabled`, 'false (D16)', 'true', configuration.id);
      }
      // `subscription_pause` is NOT in stripe@16.12.0's Configuration type
      // (see SUBSCRIPTION_PAUSE_DIVERGENCE), so it is read defensively off the
      // untyped payload: absent = the API default = off, which passes.
      const pause = (features as unknown as Record<string, unknown>).subscription_pause;
      if (typeof pause === 'object' && pause !== null
        && (pause as { enabled?: unknown }).enabled === true) {
        fail(`${label} subscription_pause.enabled`, 'false (runbook §2.5 :136)', 'true', configuration.id);
      }
      if (configuration.business_profile.headline !== PORTAL_HEADLINE) {
        fail(
          `${label} business_profile.headline`,
          `"${PORTAL_HEADLINE}"`,
          String(configuration.business_profile.headline),
          configuration.id,
        );
      }
      if (configuration.livemode !== false) {
        fail(`${label} livemode`, 'false', 'true', configuration.id);
      }
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function loadCatalogue(): Promise<Catalogue> {
  // Dynamic, AFTER the react-server condition is in place — see the header.
  const [offersModule, topupsModule, promotionsModule] = await Promise.all([
    import('../src/libs/billing/billingOffers'),
    import('../src/libs/billing/topupOffers'),
    import('../src/libs/billing/promotions'),
  ]);
  return {
    offers: offersModule.BILLING_OFFERS,
    topups: topupsModule.TOPUP_OFFERS,
    promotions: promotionsModule.PROMOTIONS,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const args = parseArguments(argv);

  const scriptPath = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

  // Re-exec with `--conditions=react-server` BEFORE anything is printed, so
  // the child (not this process) produces the entire transcript exactly once.
  // Usage errors above have already been raised here, without a spawn.
  ensureServerOnlyConditionOrReExec(scriptPath);

  // Path gates BEFORE any Stripe call, so a bad path never costs an API round trip.
  const carrierOutPath = args.carrierOut === null
    ? null
    : assertOutputPathOutsideRepository(args.carrierOut, repositoryRoot, '--carrier-out');
  const webhookSecretOutPath = args.webhookSecretOut === null
    ? null
    : assertOutputPathOutsideRepository(args.webhookSecretOut, repositoryRoot, '--webhook-secret-out');

  const keyCheck = checkSecretKeyMode(process.env.STRIPE_TEST_SECRET_KEY);
  if (!keyCheck.ok) {
    throw new RefusalError(keyCheck.reason);
  }
  emit(`stripe key prefix: ${keyCheck.prefix}`);

  const env = requirePlanEnv(process.env.BILLING_PLAN_ENV);
  emit(`BILLING_PLAN_ENV=${env}`);

  const stripeSourcePath = path.join(repositoryRoot, 'src', 'libs', 'stripe.ts');
  const apiVersion = extractExpectedStripeApiVersion(fs.readFileSync(stripeSourcePath, 'utf8'));
  if (apiVersion === null) {
    throw new RefusalError(
      `EXPECTED_STRIPE_API_VERSION could not be extracted from ${stripeSourcePath}. `
      + 'That symbol is contractually un-renameable (src/libs/stripe.ts:33-34); refusing to guess a version.',
    );
  }
  emit(`EXPECTED_STRIPE_API_VERSION=${apiVersion}`);

  const carrierSourcePath = path.join(repositoryRoot, 'src', 'libs', 'billing', 'stripePriceCarrier.ts');
  if (!canonicalIdShapeMatches(fs.readFileSync(carrierSourcePath, 'utf8'))) {
    throw new RefusalError(
      'The local copy of isConfiguredStripeId has drifted from the canonical definition at '
      + 'src/libs/billing/stripePriceCarrier.ts:45. Re-sync STRIPE_ID_SHAPE before provisioning.',
    );
  }
  emit('id-shape drift check: ok');

  const webhookUrlSource = resolveWebhookUrlSource(args, process.env);
  const webhookUrl = webhookUrlSource === null ? null : validateWebhookUrl(webhookUrlSource);
  // T2: the destination gate runs before the token is even registered — a
  // production host is refused without this process holding anything.
  const allowedHost = webhookUrl === null ? null : assertWebhookHostAllowed(webhookUrl, args.allowHost);

  // Registered BEFORE the first Stripe call, so no later output — not a
  // refusal, not a Stripe error body echoing the offending `url` — can carry
  // the Vercel Protection-Bypass token or the API key.
  registerSensitiveValue(process.env.STRIPE_TEST_SECRET_KEY);
  if (webhookUrl !== null) {
    const bypassToken = extractBypassToken(webhookUrl);
    registerSensitiveValue(bypassToken);
    emit(`webhook url: accepted (${bypassToken === null ? 'no' : 'a'} ${BYPASS_QUERY_PARAM} token; it is masked in all output and never sent as a header)`);
    // T4: the operator sees the exact url that will be registered and the host
    // it was allowed for. `emit` redacts the bypass token on the way out, so
    // the lines are verbatim apart from the one value that must not be echoed.
    for (const line of describeWebhookRegistrationTarget(webhookUrl, allowedHost as string, args.createWebhook)) {
      emit(line);
    }
  }

  const catalogue = await loadCatalogue();

  const plan = buildProvisionPlan({
    env,
    catalogue,
    apiVersion,
    webhookUrl,
    includePortal: args.portal,
  });

  // The client is built here and nowhere else; src/libs/stripe.ts is never
  // imported (it constructs its own client at module scope from Env).
  const client: ProvisionStripeClient = new Stripe(
    process.env.STRIPE_TEST_SECRET_KEY as string,
    { apiVersion: apiVersion as Stripe.StripeConfig['apiVersion'], typescript: true },
  );

  if (args.mode === 'verify') {
    const carrierPath = path.resolve(args.carrierIn as string);
    let carrier: Carrier;
    try {
      carrier = JSON.parse(fs.readFileSync(carrierPath, 'utf8')) as Carrier;
    } catch {
      throw new UsageError(`--carrier could not be read or parsed as JSON: ${carrierPath}`);
    }
    const failures = await runVerify(client, {
      env,
      catalogue,
      carrier,
      plan,
      apiVersion,
      checkPortal: args.portal,
    });
    if (failures.length > 0) {
      for (const failure of failures) {
        emitError(`FAIL ${failure}`);
      }
      throw new VerificationError(`${failures.length} verification failure(s).`);
    }
    emit('verify: PASS');
    return;
  }

  // The carrier is written from INSIDE runProvision, the moment the catalogue
  // is complete and before the portal and webhook steps — see the header's
  // ORDER OF WRITES. A refusal in either of those steps therefore still
  // leaves a complete record of the ids that were created.
  const result = await runProvision(client, plan, {
    mode: args.mode,
    adoptDefault: args.adoptDefault,
    adoptExisting: args.adoptExisting,
    createWebhook: args.createWebhook,
    acknowledgeSharedAccount: args.acknowledgeSharedAccount,
    onCatalogueResolved: ({ priceIds, couponStripeId }) => {
      const carrier = buildCarrier(env, priceIds, couponStripeId, 'founding_annual_2026');
      const carrierFailures = validateCarrier(carrier, env, catalogue);
      if (carrierFailures.length > 0) {
        for (const failure of carrierFailures) {
          emitError(`FAIL ${failure}`);
        }
        throw new VerificationError(
          'Refusing to write a carrier that this script\'s own copy of parseStripePriceCarrier would reject: '
          + 'the live parser fails CLOSED to null (stripePriceCarrier.ts:146-161), silently dropping every Price '
          + 'back to the committed placeholder tables.',
        );
      }
      const outcome = writeSecureFile(
        carrierOutPath as string,
        `${JSON.stringify(carrier)}\n`,
        { force: args.force },
      );
      emit(`carrier ${outcome === 'unchanged' ? 'already present, identical' : `written (0600, ${outcome})`}: ${carrierOutPath as string}`);
      emit(`carrier keys: offers=${Object.keys(carrier.offers).length} topups=${Object.keys(carrier.topups).length} coupons=${Object.keys(carrier.coupons).length}`);
    },
  });

  if (args.mode === 'plan') {
    emit('');
    emit('DRY RUN — nothing was written to Stripe. Re-run with --apply --carrier-out <path outside the repo>.');
    for (const note of result.notes) {
      emit(`note: ${note}`);
    }
    return;
  }

  // The signing secret is returned exactly once, by webhookEndpoints.create.
  // Nothing may sit between that call and this block, and a failure to
  // persist it has to say what the operator must do about it. T7: the print
  // sink goes first, so a refusing file sink is never what loses the value.
  if (result.webhookSecret !== null) {
    registerSensitiveValue(result.webhookSecret);
    try {
      const delivery = deliverWebhookSecret({
        secret: result.webhookSecret,
        print: args.printWebhookSecret,
        outPath: webhookSecretOutPath,
        force: args.force,
      });
      if (delivery.written !== null) {
        emit(`webhook_secret_captured: true (${delivery.written === 'unchanged' ? 'already present, identical' : `written 0600, ${delivery.written}`} at ${webhookSecretOutPath as string})`);
      }
      if (delivery.writeFailure !== null) {
        emitError(
          `--webhook-secret-out could not be written (${delivery.writeFailure}). The secret was PRINTED above `
          + '(--print-webhook-secret), so it is not lost — save it now, by hand, then stage it as '
          + 'STRIPE_BILLING_WEBHOOK_SECRET on the branch scope.',
        );
      }
    } catch (error) {
      emitError(
        'THE WEBHOOK SIGNING SECRET COULD NOT BE PERSISTED. Stripe returns it exactly once, at creation, '
        + `so the copy in this process is the only one that ever existed and it is now lost. The endpoint (${
          result.webhookEndpointId ?? 'just created'}) is fine; only the secret is. Roll it in the Stripe `
          + 'Dashboard (test mode) -> Developers -> Webhooks -> that endpoint -> "Roll secret", then put the new '
          + 'value into STRIPE_BILLING_WEBHOOK_SECRET yourself. The value is deliberately NOT printed here.',
      );
      throw error;
    }
  }

  if (result.webhookEndpointId !== null) {
    emit(`webhook endpoint id: ${result.webhookEndpointId}`);
  }
  if (result.portalConfigurationId !== null) {
    emit(`portal configuration id: ${result.portalConfigurationId}`);
  }
  for (const note of result.notes) {
    emit(`note: ${note}`);
  }
  emit('');
  emit(
    'Next step is a HUMAN one, in this order (T6): (1) paste the carrier into `vercel env add '
    + 'BILLING_STRIPE_PRICE_IDS preview <git-branch>`, (2) redeploy so the build inlines it, (3) re-run this '
    + 'script with --create-webhook to register the endpoint, (4) paste the signing secret into `vercel env add '
    + 'STRIPE_BILLING_WEBHOOK_SECRET preview <git-branch>`, (5) redeploy again. Scope both variables to the '
    + 'rehearsal branch, not to Preview at large: an unscoped add applies to EVERY Preview deployment of this '
    + 'project. This script never touches Vercel, the database, or the BILLING_* switches.',
  );
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error: unknown) => {
    if (error instanceof ProvisionError) {
      emitError(`ERROR ${error.message}`);
      process.exit(error.exitCode);
    }
    // Everything that is not a deliberate refusal lands here — overwhelmingly
    // a Stripe API error. `describeErrorForOutput` pulls out every field
    // Stripe can echo an argument through (message, raw.message, raw.param,
    // an echoed url) and redacts them, rather than trusting a default
    // `toString()` not to carry the bypass token or a key.
    emitError(`ERROR (unhandled — most likely the Stripe API) ${describeErrorForOutput(error)}`);
    process.exit(EXIT.stripe);
  });
}
