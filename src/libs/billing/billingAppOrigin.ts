/**
 * Billing redirect origin — final handoff §6 row X5 (unpinned half).
 *
 * `NEXT_PUBLIC_APP_URL` is a `NEXT_PUBLIC_*` variable, so Next.js inlines it
 * at BUILD time. A deployment built before the variable was provisioned
 * keeps whatever it saw then — which, with the previous inline
 * `Env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'` fallback, meant a
 * paying customer's post-payment `success_url` / `cancel_url` pointed at
 * `http://localhost:3000` on a real hosted deployment and dead-ended after
 * the money moved. On a hosted runtime that is not a recoverable default:
 * refuse to start the checkout instead, loudly and before anything durable
 * is written.
 *
 * Deliberately NOT `getCanonicalAppOrigin()` (`src/libs/publicUrl.ts:26-42`):
 * that helper falls back to `VERCEL_PROJECT_PRODUCTION_URL`
 * (`publicUrl.ts:30`) and then `VERCEL_URL` (`:31`) before throwing, so a
 * Preview deployment without `NEXT_PUBLIC_APP_URL` would send a test-mode
 * Checkout success/cancel redirect to the PRODUCTION domain — a rehearsal
 * customer landing on the live site holding a test-mode receipt. A money
 * redirect gets the deployment's own configured origin or no checkout at
 * all; it never gets a guess.
 *
 * Only the SMS top-up checkout (`src/app/api/billing/checkout/topup/route.ts`)
 * uses this today. The subscription checkout
 * (`src/app/api/billing/checkout/route.ts:271`) and the Billing Portal
 * (`src/app/api/billing/portal/route.ts:142`) still carry the inline
 * localhost fallback, because both files are pinned to reviewed-postimage
 * blobs in `.github/workflows/CI.yml` (Gate C2 and the D18 P5b pin): editing
 * either one fails CI until the owner ratifies a new postimage (owner
 * decision O10). The next PR that refreshes those pins must finish the job
 * and delete both inline fallbacks.
 */

import 'server-only';

import { Env } from '@/libs/Env';

export type BillingAppOriginErrorCode = 'APP_ORIGIN_UNCONFIGURED';

export class BillingAppOriginError extends Error {
  readonly code: BillingAppOriginErrorCode;

  constructor(code: BillingAppOriginErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'BillingAppOriginError';
    this.code = code;
  }
}

/**
 * Vercel sets `VERCEL=1` in every build and every runtime it owns
 * (Production, Preview and `vercel dev`), which is the same marker
 * `isHostedDeployment()` style checks elsewhere in this repository rely on.
 * Read through bare `process.env` on purpose: `VERCEL` is not part of the
 * validated `Env` schema, and adding it there would be a schema change this
 * PR has no mandate for.
 */
function isHostedRuntime(): boolean {
  return process.env.VERCEL === '1';
}

/**
 * The absolute origin every billing redirect (Stripe `success_url`,
 * `cancel_url`, portal `return_url`) must be built from.
 *
 * - Configured and parseable as an absolute `http(s)` URL → its ORIGIN only.
 *   `URL.origin` drops any path, query or fragment, so a deployment
 *   -protection bypass token accidentally left in the variable can never
 *   ride out to Stripe inside a redirect url.
 * - Not usable (unset, blank, relative, or a non-`http(s)` scheme) on a
 *   HOSTED runtime → throws `APP_ORIGIN_UNCONFIGURED`. Callers mask it; the
 *   operator sees it in Sentry.
 * - Not usable off a hosted runtime → `http://localhost:3000`, which is a
 *   correct origin for local development and only for local development.
 *
 * @throws {BillingAppOriginError} code `APP_ORIGIN_UNCONFIGURED`.
 */
export function resolveBillingAppOrigin(): string {
  const configured = Env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.origin;
      }
    } catch {
      // Unparseable is treated exactly like unset: the hosted branch below
      // refuses, and local development still gets its localhost origin.
    }
  }

  if (isHostedRuntime()) {
    throw new BillingAppOriginError(
      'APP_ORIGIN_UNCONFIGURED',
      'NEXT_PUBLIC_APP_URL must be set to an absolute http(s) URL BEFORE the build on a hosted deployment',
    );
  }

  return 'http://localhost:3000';
}
