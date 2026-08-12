import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp } from '@/libs/rateLimit';
import { appointmentDepositSchema, appointmentSchema } from '@/models/Schema';

/**
 * GET /api/public/deposits/session-status?session_id=...
 *
 * The single data source for both deposit return/cancel pages.
 *
 * PUBLIC AND UNAUTHENTICATED, so the response is deliberately austere: no PII,
 * no tenant identifiers, no manage URL, no Stripe call and no writes. It looks
 * the deposit row up by its GLOBALLY UNIQUE Checkout Session id; an unknown id
 * is a flat 404.
 *
 * Returning the resume URL here grants NO new capability: the caller already
 * holds the globally-unguessable Checkout Session id — it IS the session that
 * URL opens — so handing back that same session's hosted URL confers nothing
 * they did not already have. It is gated on the hold still being live, and it is
 * the only data the cancel page has for its resume link.
 *
 * `checkoutUrl` is ABSENT (not null-valued) in every non-live state.
 *
 * It is ALSO a reconciliation driver. The `session_id` selects WHICH deposit to
 * reconcile; it never asserts that anything was paid. The evidence is always a
 * server-side retrieval on the deposit's own connected-account snapshot, so a
 * client arriving on a redirect URL proves nothing on its own.
 *
 * THE TENANT BOUNDARY IS THE DURABLE PER-DEPOSIT BUDGET, not the IP limiter.
 * The `cs_…` id is visible to the client, to anyone they forward it to, and to
 * the salon owner in their own Stripe Dashboard, so an IP-keyed cap is trivially
 * sidestepped. The IP limiter and the in-memory throttle below are defence in
 * depth.
 */

export const dynamic = 'force-dynamic';

type DepositSessionState = 'awaiting_payment' | 'confirmed' | 'expired' | 'cancelled';

type SessionStatusResponse = {
  state: DepositSessionState;
  holdExpiresAt: string | null;
  checkoutUrl?: string;
};

function notFound(): Response {
  return Response.json(
    { error: { code: 'NOT_FOUND', message: 'Unknown session' } },
    { status: 404 },
  );
}

/** In-window retrievals allowed per deposit. */
const POLL_WINDOW_CAP = 20;
/** Lifetime retrievals allowed per deposit. NEVER reset. */
const POLL_LIFETIME_CAP = 200;
/** How long a retrieval window lasts before it rolls. */
const POLL_WINDOW_MS = 10 * 60_000;
/** Cheap in-process guard against a tight redirect-refresh loop. */
const POLL_THROTTLE_MS = 5_000;

const recentPolls = new Map<string, number>();

/**
 * ONE conditional UPDATE that reads and writes all three counters ATOMICALLY.
 *
 * Three columns, not two, and that is not redundancy: one integer cannot both
 * reset on a window roll and never reset. `poll_window_retrievals` is the
 * in-window counter, `poll_retrievals` is the lifetime ceiling, and
 * `poll_window_started_at` is the anchor that decides which of them moves.
 *
 * Returns false when the budget is spent. THE CALLER ANSWERS 200 WITH LOCAL
 * STATE, never 429: the session id is visible to several parties by design, so
 * a 4xx on budget exhaustion is a denial primitive pointed at the payer.
 */
async function authorizeRetrieval(depositId: string, salonId: string): Promise<boolean> {
  const windowCutoff = new Date(Date.now() - POLL_WINDOW_MS);
  const rows = await db
    .update(appointmentDepositSchema)
    .set({
      pollWindowStartedAt: sql`CASE
        WHEN ${appointmentDepositSchema.pollWindowStartedAt} IS NULL
          OR ${appointmentDepositSchema.pollWindowStartedAt} < ${windowCutoff}
        THEN now()
        ELSE ${appointmentDepositSchema.pollWindowStartedAt}
      END`,
      pollWindowRetrievals: sql`CASE
        WHEN ${appointmentDepositSchema.pollWindowStartedAt} IS NULL
          OR ${appointmentDepositSchema.pollWindowStartedAt} < ${windowCutoff}
        THEN 1
        ELSE ${appointmentDepositSchema.pollWindowRetrievals} + 1
      END`,
      pollRetrievals: sql`${appointmentDepositSchema.pollRetrievals} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(appointmentDepositSchema.id, depositId),
      eq(appointmentDepositSchema.salonId, salonId),
      sql`${appointmentDepositSchema.pollRetrievals} < ${POLL_LIFETIME_CAP}`,
      sql`(${appointmentDepositSchema.pollWindowStartedAt} IS NULL
        OR ${appointmentDepositSchema.pollWindowStartedAt} < ${windowCutoff}
        OR ${appointmentDepositSchema.pollWindowRetrievals} < ${POLL_WINDOW_CAP})`,
    ))
    .returning();

  return rows.length > 0;
}

/**
 * Retrieves the session on the deposit's SNAPSHOT account and hands the result
 * to the single confirm routine.
 *
 * Never throws to the caller: a reconciliation attempt failing must still
 * return the client the local state they asked for.
 */
async function reconcileFromPoll(deposit: {
  id: string;
  salonId: string;
  status: string;
  stripeAccountId: string;
  stripeCheckoutSessionId: string;
}): Promise<void> {
  try {
    // Imported lazily, and deliberately. This is an UNAUTHENTICATED public
    // endpoint whose common case — a settled deposit — needs none of the
    // deposits money path or the Stripe SDK, so neither belongs in its static
    // import graph.
    const { stripe } = await import('@/libs/stripe');
    const { confirmDepositPayment } = await import('@/libs/deposits/confirmDepositPayment');
    const { DEPOSIT_STRIPE_CALL_TIMEOUT_MS, runLateDepositRecovery } = await import(
      '@/libs/deposits/lateDepositRecovery'
    );

    const session = await stripe.checkout.sessions.retrieve(
      deposit.stripeCheckoutSessionId,
      {
        // The SNAPSHOT, never a live binding lookup, and an explicit timeout
        // because the shared client sets none.
        stripeAccount: deposit.stripeAccountId,
        timeout: DEPOSIT_STRIPE_CALL_TIMEOUT_MS,
      },
    );

    const metadata = session.metadata ?? {};
    const result = await confirmDepositPayment({
      source: 'poll',
      connectedAccountId: deposit.stripeAccountId,
      sessionId: deposit.stripeCheckoutSessionId,
      paymentIntentId: typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null,
      paymentStatus: session.payment_status ?? null,
      amountTotal: session.amount_total ?? null,
      currency: session.currency ?? null,
      metadataAppointmentId: metadata.appointment_id ?? null,
      metadataSalonId: metadata.salon_id ?? null,
      metadataDepositId: metadata.deposit_id ?? null,
    });

    if (result.disposition === 'late_recovery_required' && result.depositId && result.salonId) {
      await runLateDepositRecovery({ depositId: result.depositId, salonId: result.salonId });
    }
  } catch (error) {
    console.error('[deposits] poll reconciliation failed:', error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const sessionId = new URL(request.url).searchParams.get('session_id')?.trim();
    if (!sessionId) {
      return notFound();
    }

    // Defence in depth only. `getClientIp` reads the leftmost X-Forwarded-For
    // value and is spoofable, which is exactly why the real boundary is the
    // durable per-deposit budget below.
    const limit = checkEndpointRateLimit('deposits-session-status', getClientIp(request), 'GENERAL');
    if (!limit.allowed) {
      return Response.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } },
      );
    }

    const [row] = await db
      .select({
        depositId: appointmentDepositSchema.id,
        salonId: appointmentDepositSchema.salonId,
        depositStatus: appointmentDepositSchema.status,
        stripeAccountId: appointmentDepositSchema.stripeAccountId,
        stripeCheckoutSessionId: appointmentDepositSchema.stripeCheckoutSessionId,
        checkoutUrl: appointmentDepositSchema.stripeCheckoutUrl,
        appointmentStatus: appointmentSchema.status,
        holdExpiresAt: appointmentSchema.depositHoldExpiresAt,
      })
      .from(appointmentDepositSchema)
      .innerJoin(appointmentSchema, and(
        eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
        eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
      ))
      .where(eq(appointmentDepositSchema.stripeCheckoutSessionId, sessionId))
      .limit(1);

    if (!row) {
      // A UNIFORM 404 for every unknown id: distinguishing "no such session"
      // from "not yours" would turn this endpoint into an existence oracle.
      return notFound();
    }

    // Only these three states have anything to reconcile. A paid or refunded
    // deposit is settled, and re-retrieving it would spend budget for nothing.
    const reconcilable = ['checkout_created', 'expired', 'canceled'].includes(row.depositStatus);
    const lastPolled = recentPolls.get(row.depositId) ?? 0;
    const throttled = Date.now() - lastPolled < POLL_THROTTLE_MS;

    if (reconcilable && !throttled && row.stripeCheckoutSessionId) {
      recentPolls.set(row.depositId, Date.now());
      if (await authorizeRetrieval(row.depositId, row.salonId)) {
        await reconcileFromPoll({
          id: row.depositId,
          salonId: row.salonId,
          status: row.depositStatus,
          stripeAccountId: row.stripeAccountId,
          stripeCheckoutSessionId: row.stripeCheckoutSessionId,
        });
      }
    }

    // Re-read AFTER the reconciliation attempt, so a client whose payment we
    // just confirmed sees the confirmation on this response rather than the
    // next one.
    const [current] = await db
      .select({
        depositStatus: appointmentDepositSchema.status,
        checkoutUrl: appointmentDepositSchema.stripeCheckoutUrl,
        appointmentStatus: appointmentSchema.status,
        holdExpiresAt: appointmentSchema.depositHoldExpiresAt,
      })
      .from(appointmentDepositSchema)
      .innerJoin(appointmentSchema, and(
        eq(appointmentSchema.id, appointmentDepositSchema.appointmentId),
        eq(appointmentSchema.salonId, appointmentDepositSchema.salonId),
      ))
      .where(eq(appointmentDepositSchema.id, row.depositId))
      .limit(1);

    const settled = current ?? row;
    const state = resolveState(settled.appointmentStatus, settled.depositStatus);
    const body: SessionStatusResponse = {
      state,
      holdExpiresAt: settled.holdExpiresAt?.toISOString() ?? null,
    };

    // ONLY while the hold is live. Present in any other state, this would keep
    // offering a payment link for a booking that is already settled or gone.
    // D5 adds NO field of its own here and must not re-narrow this shape: the
    // cancel page's resume link is the only thing it has.
    if (state === 'awaiting_payment' && (settled.checkoutUrl ?? row.checkoutUrl)) {
      body.checkoutUrl = (settled.checkoutUrl ?? row.checkoutUrl)!;
    }

    return Response.json(body);
  } catch (error) {
    console.error('[deposits] session-status lookup failed:', error);
    return Response.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Could not read the payment status' } },
      { status: 500 },
    );
  }
}

function resolveState(
  appointmentStatus: string,
  depositStatus: string,
): DepositSessionState {
  if (depositStatus === 'paid') {
    return 'confirmed';
  }
  if (appointmentStatus === 'awaiting_payment') {
    return 'awaiting_payment';
  }
  if (depositStatus === 'expired') {
    return 'expired';
  }
  if (depositStatus === 'canceled') {
    return 'cancelled';
  }
  // The appointment moved on without the deposit reaching a terminal state —
  // D5's confirm is the normal cause.
  return appointmentStatus === 'cancelled' ? 'cancelled' : 'confirmed';
}
