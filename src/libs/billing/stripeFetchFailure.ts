/**
 * Classification-fetch failure taxonomy for the billing webhook (D19c §2.1,
 * §2.3 item 1).
 *
 * `/api/webhooks/stripe-billing` decides ownership of an object it did not
 * create by asking Stripe about it. That question has exactly two useful
 * answers when it FAILS:
 *
 *   foreign    Stripe decoded the request and said the object is not there
 *              (`resource_missing`, and every other plain
 *              `StripeInvalidRequestError`). On a platform account shared
 *              with the legacy flow and with every other deployment of this
 *              codebase, that is a DEFINITE "not mine" — terminal
 *              `ignored_foreign`, no alert, no retry (§2.6).
 *   retryable  everything else — 429, 5xx, a connection reset, a bare
 *              AbortError, and also authentication/permission failures. The
 *              first three are transient; the last two are CONFIGURATION
 *              faults that must surface as failed_retryable → poison →
 *              Sentry rather than be swallowed as "foreign", because a wrong
 *              or deauthorized key would otherwise silently classify every
 *              real subscription as somebody else's and drop it.
 *
 * WHY THE TAXONOMY IS COPIED, NOT IMPORTED. The authoritative version is
 * deposits' `classifyStripeFailure` in `src/libs/depositCheckout.ts`
 * (predicates `isSessionNotOpenError` / `isDeauthorizedOrAccountInvalid`
 * included), and importing it was the first choice. It is not importable
 * here: that module imports `EXPECTED_STRIPE_API_VERSION` from
 * `@/libs/stripe`, and every suite that drives this webhook mocks
 * `@/libs/stripe` as a bare Stripe-client double — pulling deposits into the
 * route's import graph makes those suites fail at module load. So the
 * decision structure below is reproduced FAITHFULLY, in the same order,
 * collapsing that function's six classes onto this endpoint's two:
 *
 *   'definite'                       ⇒ foreign
 *   'retryable' | 'ambiguous'
 *     | 'permanent' | 'session_not_open' ⇒ retryable
 *
 * Keep the two in step: a change to deposits' classification is a change
 * here. `depositCheckout.create.test.ts` pins that side; this module's own
 * suite pins the same error classes against these two outcomes.
 */

import 'server-only';

import Stripe from 'stripe';

export type StripeFetchFailureClass = 'foreign' | 'retryable';

/**
 * depositCheckout.ts's `isSessionNotOpenError`, reproduced verbatim.
 * Unreachable through the retrieves this module guards (only
 * `checkout.sessions.expire` produces it), and kept anyway so the copy has no
 * behavioural difference from its source.
 */
function isSessionNotOpenError(error: Stripe.errors.StripeInvalidRequestError): boolean {
  const message = error.message ?? '';
  return /only\s+checkout\s+sessions\s+with\s+a\s+status\s+in\s+[^.]{0,20}can\s+be\s+expired/i.test(message)
    || /not\s+open|already\s+(?:expired|complete)|cannot\s+be\s+expired/i.test(message);
}

/**
 * depositCheckout.ts's `isDeauthorizedOrAccountInvalid`, reproduced verbatim:
 * an invalid-request error that is really about the KEY or the ACCOUNT, not
 * about the object being asked for. Deposits classes these 'permanent'; here
 * they are retryable, because a deauthorized key must become a visible poison
 * alert rather than a silent "everything is foreign".
 */
function isDeauthorizedOrAccountInvalid(error: Stripe.errors.StripeInvalidRequestError): boolean {
  const code = error.code ?? '';
  const message = error.message ?? '';
  return code === 'account_invalid'
    || code === 'account_inactive'
    || /deauthorized|does not have access to (?:the )?account|application access/i.test(message);
}

/**
 * Narrow a failed classification fetch to the billing endpoint's two
 * outcomes. Fails toward RETRYABLE: only a decoded invalid-request about the
 * OBJECT is treated as proof it is not ours.
 */
export function classifyStripeFetchFailure(error: unknown): StripeFetchFailureClass {
  // Order mirrors depositCheckout.ts's: the specific error classes are tested
  // before StripeInvalidRequestError, and the raw-status fallback last.
  if (error instanceof Stripe.errors.StripeConnectionError) {
    return 'retryable'; // deposits: 'ambiguous' — the request may never have reached Stripe.
  }
  if (error instanceof Stripe.errors.StripeAPIError
    || error instanceof Stripe.errors.StripeRateLimitError
    || error instanceof Stripe.errors.StripeIdempotencyError) {
    return 'retryable';
  }
  if (error instanceof Stripe.errors.StripeAuthenticationError
    || error instanceof Stripe.errors.StripePermissionError) {
    // deposits: 'permanent'. A configuration fault must SURFACE, never be
    // read as evidence that the object belongs to somebody else.
    return 'retryable';
  }
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    if (isSessionNotOpenError(error) || isDeauthorizedOrAccountInvalid(error)) {
      return 'retryable';
    }
    return 'foreign'; // deposits: 'definite' — `resource_missing` and friends.
  }
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof status === 'number' && status >= 500) {
    return 'retryable';
  }
  // A raw AbortError, a socket reset, or anything else without a decoded
  // Stripe error body: we do NOT know whether the request reached Stripe.
  return 'retryable';
}

/**
 * Run one classification fetch: `null` means Stripe definitively does not
 * have this object (the caller treats that as foreign), anything else
 * rethrows so the poison ladder owns it.
 */
export async function fetchOrForeign<T>(fetch: () => Promise<T>): Promise<T | null> {
  try {
    return await fetch();
  } catch (error) {
    if (classifyStripeFetchFailure(error) === 'foreign') {
      return null;
    }
    throw error;
  }
}
