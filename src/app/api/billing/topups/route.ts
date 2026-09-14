/**
 * SMS top-up purchase history — G17 (contract §15 row C3).
 *
 * Dark-gated exactly like the top-up checkout route it reads back from
 * (`checkout/topup/route.ts`): `BILLING_TOPUPS_ENABLED` is checked FIRST,
 * before rate limiting, before auth, before any database read. `requireAdmin`
 * gives tenant scoping (membership -> 403) the same way every other billing
 * route under this tree does.
 *
 * The response speaks in the owner's vocabulary: `sms_topup_purchase`'s own
 * status column (SMS_TOPUP_PURCHASE_STATUSES in Schema.ts) is mapped down to
 * a small owner-facing set, and no Stripe id (`cs_`/`pi_`/`price_`/`ch_`)
 * ever leaves this route.
 */
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import {
  billingCheckoutAttemptSchema,
  smsCreditLedgerSchema,
  smsTopupPurchaseSchema,
  type SmsTopupPurchaseStatus,
} from '@/models/Schema';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// Mirrors the "held" candidate definition the plan's topup reconciler (G06)
// uses: an attempt is still open while it has neither succeeded nor been
// resolved.
const OPEN_ATTEMPT_STATUSES = ['creating', 'checkout_created'] as const;

type OwnerTopupStatus = 'pending' | 'fulfilled' | 'expired' | 'refunded' | 'disputed' | 'reversed';

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, ...NO_STORE });
}

/**
 * Owner-facing status, mapped from `SMS_TOPUP_PURCHASE_STATUSES`
 * (Schema.ts): `checkout_created`/`paid` haven't granted credits yet
 * (pending — the same "still pending" test `holdState` below uses);
 * `fulfilled` is the terminal success state; `expired`/`canceled` never
 * charged the owner for anything (`canceled` currently has zero writers —
 * verified by grep across `src/libs/billing` and `src/app/api/billing` —
 * but is mapped defensively rather than falling through to a guess);
 * `refunded` is a full reversal; `partially_reversed` is presented as the
 * simpler "reversed" (the owner does not need the proportional-refund
 * arithmetic, only that some value came back); `disputed` keeps its own
 * status because it MAY suspend sending (§6.7) and needs the owner's
 * attention.
 */
function toOwnerStatus(status: SmsTopupPurchaseStatus): OwnerTopupStatus {
  switch (status) {
    case 'checkout_created':
    case 'paid':
      return 'pending';
    case 'fulfilled':
      return 'fulfilled';
    case 'expired':
    case 'canceled':
      return 'expired';
    case 'refunded':
      return 'refunded';
    case 'partially_reversed':
      return 'reversed';
    case 'disputed':
      return 'disputed';
    default:
      return 'pending';
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.getTime()}_${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = raw.indexOf('_');
  if (separator <= 0) {
    return null;
  }
  const ms = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (!Number.isFinite(ms) || !id) {
    return null;
  }
  return { createdAt: new Date(ms), id };
}

function parseLimit(param: string | null): number {
  if (param === null) {
    return DEFAULT_LIMIT;
  }
  const requested = Number(param);
  if (!Number.isFinite(requested)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(requested)));
}

export async function GET(request: NextRequest): Promise<Response> {
  // Dark switch FIRST — before rate limiting, auth or any database read
  // (same ordering as checkout/topup/route.ts).
  if (Env.BILLING_TOPUPS_ENABLED !== 'true') {
    return NextResponse.json({ available: false, items: [], nextCursor: null }, NO_STORE);
  }

  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit('billing/topups', ip, 'BILLING');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfterMs);
  }

  const salonId = request.nextUrl.searchParams.get('salonId');
  if (!salonId) {
    return errorJson(400, 'SALON_ID_REQUIRED', 'salonId is required.');
  }
  const authResult = await requireAdmin(salonId);
  if (!authResult.ok) {
    return authResult.response;
  }

  const limit = parseLimit(request.nextUrl.searchParams.get('limit'));

  const cursorParam = request.nextUrl.searchParams.get('cursor');
  let cursorFilter;
  if (cursorParam !== null) {
    const decoded = decodeCursor(cursorParam);
    if (decoded === null) {
      return errorJson(400, 'INVALID_CURSOR', 'The topups cursor is not valid.');
    }
    cursorFilter = or(
      lt(smsTopupPurchaseSchema.createdAt, decoded.createdAt),
      and(
        eq(smsTopupPurchaseSchema.createdAt, decoded.createdAt),
        lt(smsTopupPurchaseSchema.id, decoded.id),
      ),
    );
  }

  const rows = await db
    .select({
      id: smsTopupPurchaseSchema.id,
      topupOfferKey: smsTopupPurchaseSchema.topupOfferKey,
      credits: smsTopupPurchaseSchema.credits,
      amountCents: smsTopupPurchaseSchema.amountCents,
      currency: smsTopupPurchaseSchema.currency,
      status: smsTopupPurchaseSchema.status,
      createdAt: smsTopupPurchaseSchema.createdAt,
      refundedAt: smsTopupPurchaseSchema.refundedAt,
      // The purchased-lot ledger row is append-only and its id never
      // changes after fulfilment, so its createdAt is the exact fulfilment
      // instant — durable even if the purchase is later refunded/disputed
      // and its own status/updatedAt move on.
      fulfilledAt: smsCreditLedgerSchema.createdAt,
      attemptExpiresAt: billingCheckoutAttemptSchema.expiresAt,
    })
    .from(smsTopupPurchaseSchema)
    .leftJoin(smsCreditLedgerSchema, eq(smsCreditLedgerSchema.id, smsTopupPurchaseSchema.grantLedgerId))
    .leftJoin(billingCheckoutAttemptSchema, and(
      eq(billingCheckoutAttemptSchema.stripeCheckoutSessionId, smsTopupPurchaseSchema.stripeCheckoutSessionId),
      eq(billingCheckoutAttemptSchema.salonId, smsTopupPurchaseSchema.salonId),
      eq(billingCheckoutAttemptSchema.purpose, 'sms_topup'),
    ))
    .where(cursorFilter === undefined
      ? eq(smsTopupPurchaseSchema.salonId, salonId)
      : and(eq(smsTopupPurchaseSchema.salonId, salonId), cursorFilter))
    .orderBy(desc(smsTopupPurchaseSchema.createdAt), desc(smsTopupPurchaseSchema.id))
    .limit(limit + 1);

  // Salon-level "more than one open top-up attempt" (G06's held-candidate
  // definition) — computed once, applied to every still-pending item on the
  // page, not just the one that happens to own a given attempt.
  const openAttempts = await db
    .select({ id: billingCheckoutAttemptSchema.id })
    .from(billingCheckoutAttemptSchema)
    .where(and(
      eq(billingCheckoutAttemptSchema.salonId, salonId),
      eq(billingCheckoutAttemptSchema.purpose, 'sms_topup'),
      inArray(billingCheckoutAttemptSchema.status, [...OPEN_ATTEMPT_STATUSES]),
    ));
  const hasMultipleOpenAttempts = openAttempts.length > 1;

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit
    ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.id)
    : null;

  const now = Date.now();
  const items = page.map((row) => {
    const status = toOwnerStatus(row.status);
    const attemptPastExpiry = row.attemptExpiresAt !== null && row.attemptExpiresAt.getTime() < now;
    const holdState = status === 'pending' && (attemptPastExpiry || hasMultipleOpenAttempts)
      ? 'held' as const
      : null;
    return {
      id: row.id,
      offerKey: row.topupOfferKey,
      credits: row.credits,
      priceCents: row.amountCents,
      currency: row.currency,
      status,
      holdState,
      createdAt: row.createdAt.toISOString(),
      fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
      reversedAt: row.refundedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ available: true, items, nextCursor }, NO_STORE);
}

export const dynamic = 'force-dynamic';
