import { and, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
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
 * D5 later extends this same route into a reconciliation driver with a rate
 * limit, a durable per-deposit retrieval budget and a Stripe retrieve. This PR
 * ships none of those.
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

export async function GET(request: Request): Promise<Response> {
  try {
    const sessionId = new URL(request.url).searchParams.get('session_id')?.trim();
    if (!sessionId) {
      return notFound();
    }

    const [row] = await db
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
      .where(eq(appointmentDepositSchema.stripeCheckoutSessionId, sessionId))
      .limit(1);

    if (!row) {
      return notFound();
    }

    const state = resolveState(row.appointmentStatus, row.depositStatus);
    const body: SessionStatusResponse = {
      state,
      holdExpiresAt: row.holdExpiresAt?.toISOString() ?? null,
    };

    // ONLY while the hold is live. Present in any other state, this would keep
    // offering a payment link for a booking that is already settled or gone.
    if (state === 'awaiting_payment' && row.checkoutUrl) {
      body.checkoutUrl = row.checkoutUrl;
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
