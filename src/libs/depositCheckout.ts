import 'server-only';

import Stripe from 'stripe';

import { DEPOSIT_CURRENCY } from '@/libs/depositPolicy';
import { Env } from '@/libs/Env';
// IMPORT, NEVER EDIT. src/libs/stripe.ts is D2's file.
import { EXPECTED_STRIPE_API_VERSION } from '@/libs/stripe';

/**
 * TWO CONSTANTS, ONE PINNED VERSION.
 *
 * This is an ALIAS of D2's export, never a second literal. D2 provisions the
 * Connect webhook endpoint at `EXPECTED_STRIPE_API_VERSION` and D5 reads every
 * delivery's `event.api_version` back against that same constant. A free-standing
 * `DEPOSIT_STRIPE_API_VERSION = '<literal>'` would let this module create every
 * Checkout Session at version X while the endpoint delivered at version Y, and
 * NO TEST COULD SEE IT — `apiVersion === DEPOSIT_STRIPE_API_VERSION` compares a
 * constant against itself and is satisfied by any value. It is re-exported under
 * this name because the deployment gate and D5 register the endpoint by it.
 *
 * Note the import edge, stated honestly: importing this symbol evaluates
 * `src/libs/stripe.ts`, whose module scope constructs the SaaS-billing singleton
 * from the same `Env.STRIPE_SECRET_KEY`. That is an import edge, not an edit,
 * and the client below remains a separate instance with its own `apiVersion`,
 * `timeout` and `maxNetworkRetries`.
 */
export const DEPOSIT_STRIPE_API_VERSION = EXPECTED_STRIPE_API_VERSION;

/**
 * The hold window, in minutes.
 *
 * 35 is >= Stripe's 30-minute `expires_at` floor with ~5 minutes of margin for
 * the rest of the booking transaction, the commit, and one bounded Stripe round
 * trip. It MUST stay below `MIN_LEAD_TIME_MINUTES` (120) — a hold that could
 * outlive the earliest bookable slot would reserve time nobody can book.
 * Client-facing copy says "30 minutes"; the extra 5 is server-side slack.
 */
export const DEPOSIT_HOLD_WINDOW_MINUTES = 35;

/**
 * 6 000 ms, NOT 8 000. `maxNetworkRetries: 0` plus one manual retry means at
 * most two attempts: at 6 s that is <= 12 s, inside `BOOKING_POLL_WINDOW_MS`
 * (13 s) and `TTL.BOOKING_LOCK` (15 s). At 8 s two attempts reach ~16 s and a
 * polling duplicate tab would resolve against nothing.
 */
export const DEPOSIT_STRIPE_TIMEOUT_MS = 6_000;

/**
 * Everything the Checkout call needs, and nothing that is runtime-mutable.
 *
 * DETERMINISM RULE (merge-blocking): every parameter derives from the COMMITTED
 * deposit row, never from a mutable salon field (`name`, `slug`, `customDomain`
 * can all change) and never from a wall clock. Stripe compares incoming
 * parameters against the original request under an idempotency key and errors if
 * they differ, so a mutable input turns a retry — or the reaper's probe — into a
 * hard `idempotency_error`.
 *
 * `holdExpiresAt` is read from the committed APPOINTMENT row (the appointment IS
 * the hold); it is equally immutable for the life of the hold.
 */
export type DepositCheckoutRow = {
  id: string;
  salonId: string;
  appointmentId: string;
  amountCents: number;
  stripeAccountId: string;
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
  holdExpiresAt: Date;
};

/** Stable per appointment; `appointment.id` is a globally unique text PK. */
export function buildDepositCheckoutIdempotencyKey(appointmentId: string): string {
  return `deposit-checkout:v1:${appointmentId}`;
}

export function depositHoldExpiresAtEpochSeconds(holdExpiresAt: Date): number {
  return Math.floor(holdExpiresAt.getTime() / 1000);
}

/**
 * PURE. Builds the exact `POST /v1/checkout/sessions` body.
 *
 * Extracted so a test can build it twice — and again after mutating `salon.name`
 * and `salon.slug` — and assert the two are `toEqual`.
 */
export function buildDepositCheckoutParams(
  deposit: DepositCheckoutRow,
): Stripe.Checkout.SessionCreateParams {
  const metadata = {
    appointment_id: deposit.appointmentId,
    salon_id: deposit.salonId,
    deposit_id: deposit.id,
  };

  return {
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          // The SAME imported symbol the DB insert uses, so the provider call
          // and the persisted row cannot drift. 0065 ships CHECK (currency =
          // 'cad') — lowercase, because Stripe's currency parameters are
          // lowercase ISO codes and one literal must serve both.
          currency: DEPOSIT_CURRENCY,
          unit_amount: deposit.amountCents,
          // A FIXED literal: Checkout renders the connected account's own
          // branding, and the salon name is runtime-mutable.
          product_data: { name: 'Booking deposit' },
        },
      },
    ],
    // Deliberate: excludes delayed-notification methods such as `acss_debit`,
    // whose 2-14 day settlement cannot fit a 35-minute hold.
    payment_method_types: ['card'],
    // The session dies at exactly the instant the hold does.
    expires_at: depositHoldExpiresAtEpochSeconds(deposit.holdExpiresAt),
    // NO `application_fee_amount`: the pilot is 0%, and the parameter must be
    // positive if present, so omission is the documented-safe encoding of 0%.
    client_reference_id: deposit.appointmentId,
    metadata,
    payment_intent_data: { metadata },
    // THE TEMPLATE IS REQUIRED ON BOTH URLS. Stripe substitutes
    // {CHECKOUT_SESSION_ID} on cancel URLs exactly as on success URLs; without
    // it the cancel page arrives with no query parameter at all and cannot call
    // the session-status endpoint, render the hold expiry, or offer a resume
    // link — one of the four durable re-entry paths would simply not exist.
    success_url: `${deposit.checkoutSuccessUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${deposit.checkoutCancelUrl}?session_id={CHECKOUT_SESSION_ID}`,
  };
}

/** The subset of the Stripe SDK this module uses, so tests can inject a stub. */
export type DepositStripeClient = {
  checkout: {
    sessions: {
      create: (
        params: Stripe.Checkout.SessionCreateParams,
        options: Stripe.RequestOptions,
      ) => Promise<Stripe.Checkout.Session>;
      expire: (
        id: string,
        params?: Record<string, never>,
        options?: Stripe.RequestOptions,
      ) => Promise<Stripe.Checkout.Session>;
      retrieve: (
        id: string,
        params?: Record<string, never>,
        options?: Stripe.RequestOptions,
      ) => Promise<Stripe.Checkout.Session>;
    };
  };
};

let cachedClient: DepositStripeClient | null = null;

/**
 * The deposit Checkout client — a SEPARATE `new Stripe(...)` instance, not the
 * SaaS-billing singleton, because it needs its own timeout and retry policy.
 */
export function getDepositStripeClient(): DepositStripeClient {
  if (!cachedClient) {
    cachedClient = new Stripe(Env.STRIPE_SECRET_KEY, {
      apiVersion: DEPOSIT_STRIPE_API_VERSION,
      timeout: DEPOSIT_STRIPE_TIMEOUT_MS,
      // 0 because the retry policy is explicit and bounded above (exactly one
      // manual retry, same key, identical params), and because SDK-level
      // retries would make the two-attempt latency budget unpredictable.
      maxNetworkRetries: 0,
      typescript: true,
    }) as unknown as DepositStripeClient;
  }
  return cachedClient;
}

/** Test seam only. */
export function __setDepositStripeClientForTests(client: DepositStripeClient | null): void {
  cachedClient = client;
}

// =============================================================================
// FAILURE TAXONOMY
// =============================================================================

export type StripeFailureClass
  = | 'definite'
  | 'retryable'
  | 'ambiguous'
  | 'permanent'
  | 'session_not_open';

/**
 * PURE, and deliberately exported rather than living behind the module mock that
 * the route and reaper tests replace — otherwise the taxonomy that decides
 * whether a client's booking survives would have no direct test.
 *
 *   definite         — Stripe decoded the request and rejected it. Retrying is
 *                      pointless; the hold is compensating-cancelled.
 *   permanent        — auth / permission / deauthorised. Same treatment on the
 *                      create path; the reaper uses it to finalise immediately.
 *   retryable        — 429, concurrent idempotency conflict, 5xx, lock timeouts.
 *                      Retried ONCE with the same key, then treated as ambiguous.
 *                      NEVER cancelled: cancelling on a 429 destroys valid
 *                      bookings during exactly the traffic spikes deposits exist
 *                      for, and cancelling on a concurrent 409 can strand a
 *                      payable session created by the in-flight original.
 *   ambiguous        — timeout, connection reset, any post-dispatch outcome with
 *                      no decoded Stripe error body. The hold stands and the
 *                      reaper resolves it.
 *   session_not_open — the reaper's `expire` found a session that is no longer
 *                      open. Not a failure; it means "go and GET the status".
 */
export function classifyStripeFailure(error: unknown): StripeFailureClass {
  if (error instanceof Stripe.errors.StripeConnectionError) {
    return 'ambiguous';
  }
  if (error instanceof Stripe.errors.StripeAPIError) {
    return 'retryable';
  }
  if (error instanceof Stripe.errors.StripeRateLimitError) {
    return 'retryable';
  }
  if (error instanceof Stripe.errors.StripeIdempotencyError) {
    return 'retryable';
  }
  if (error instanceof Stripe.errors.StripeAuthenticationError) {
    return 'permanent';
  }
  if (error instanceof Stripe.errors.StripePermissionError) {
    return 'permanent';
  }
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    if (isSessionNotOpenError(error)) {
      return 'session_not_open';
    }
    if (isDeauthorizedOrAccountInvalid(error)) {
      return 'permanent';
    }
    return 'definite';
  }

  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof status === 'number' && status >= 500) {
    return 'retryable';
  }

  // A raw AbortError, a socket reset, or anything else without a decoded Stripe
  // error body: we do NOT know whether the request reached Stripe.
  return 'ambiguous';
}

/** Create-path helper: these two classes both mean "stop and release the hold". */
export function isCancellableCreateFailure(failure: StripeFailureClass): boolean {
  return failure === 'definite' || failure === 'permanent';
}

function isSessionNotOpenError(error: Stripe.errors.StripeInvalidRequestError): boolean {
  const message = error.message ?? '';
  return /not\s+open|already\s+(?:expired|complete)|cannot\s+be\s+expired/i.test(message);
}

function isDeauthorizedOrAccountInvalid(
  error: Stripe.errors.StripeInvalidRequestError,
): boolean {
  const code = error.code ?? '';
  const message = error.message ?? '';
  return code === 'account_invalid'
    || code === 'account_inactive'
    || /deauthorized|does not have access to (?:the )?account|application access/i.test(message);
}

// =============================================================================
// CREATE
// =============================================================================

export type DepositCheckoutCreateResult
  = | { ok: true; session: Stripe.Checkout.Session }
  | { ok: false; failure: StripeFailureClass; error: unknown };

/**
 * Create the Checkout Session on the CONNECTED account.
 *
 * `stripeAccount` is required: these are direct charges, and a platform-scoped
 * lookup would 404. A `retryable` outcome is retried exactly once with the SAME
 * idempotency key and identical params, then falls through to `ambiguous` —
 * never to cancel.
 */
export async function createDepositCheckoutSession(args: {
  deposit: DepositCheckoutRow;
  client?: DepositStripeClient;
}): Promise<DepositCheckoutCreateResult> {
  const client = args.client ?? getDepositStripeClient();
  const params = buildDepositCheckoutParams(args.deposit);
  const options: Stripe.RequestOptions = {
    stripeAccount: args.deposit.stripeAccountId,
    idempotencyKey: buildDepositCheckoutIdempotencyKey(args.deposit.appointmentId),
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const session = await client.checkout.sessions.create(params, options);
      return { ok: true, session };
    } catch (error) {
      lastError = error;
      const failure = classifyStripeFailure(error);
      if (failure === 'retryable' && attempt === 0) {
        continue;
      }
      // A retryable failure that survives its one retry is AMBIGUOUS, not
      // definite: a saved result — including a saved 500 — is replayed under the
      // same key for >= 24 h, so a session may well exist that we cannot see.
      return {
        ok: false,
        failure: failure === 'retryable' ? 'ambiguous' : failure,
        error,
      };
    }
  }

  return { ok: false, failure: 'ambiguous', error: lastError };
}
