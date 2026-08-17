/**
 * Owner usage + message history — Gate C4 (§10.1–§10.4).
 *
 * One tenant-authorized, no-store GET serving both the credit meter and the
 * cursor-paginated message history. Ledger implementation details stay
 * server-side: the response speaks in the owner's vocabulary (monthly /
 * starter / purchased / bonus credits, reset date, plan) — never lot ids,
 * reservations, entry types or raw provider payloads.
 *
 * History pagination uses a COMPOUND (createdAt, id) cursor — the first in
 * this repo — because batch dispatch legitimately creates identical
 * timestamps and a bare-timestamp cursor would skip or repeat rows.
 */
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { requireAdminSalon } from '@/libs/adminAuth';
import { computeAvailableBalance } from '@/libs/billing/creditLedger';
import { resolveTopupAudienceForLegacyPlan } from '@/libs/billing/legacyPlanAdapter';
import { getPlanDefinition } from '@/libs/billing/planDefinitions';
import { listActiveTopupOffersForAudience } from '@/libs/billing/topupOffers';
import { friendlyFailureReason, maskRecipient } from '@/libs/communicationMasking';
import { db } from '@/libs/DB';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import {
  billingSubscriptionSchema,
  communicationIntentSchema,
} from '@/models/Schema';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };
const PAGE_SIZE = 25;

export async function GET(request: NextRequest): Promise<Response> {
  const ip = getClientIp(request);
  const rateLimit = checkEndpointRateLimit('communications/usage', ip, 'GENERAL');
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit.retryAfterMs);
  }
  const salonSlug = request.nextUrl.searchParams.get('salonSlug');
  if (!salonSlug) {
    return Response.json(
      { error: { code: 'SALON_SLUG_REQUIRED', message: 'salonSlug is required.' } },
      { status: 400, ...NO_STORE },
    );
  }
  const guard = await requireAdminSalon(salonSlug);
  if (guard.error !== null || guard.salon === null) {
    return guard.error ?? Response.json({ error: { code: 'SALON_NOT_FOUND' } }, { status: 404 });
  }
  const salonId = guard.salon.id;
  const now = new Date();
  // Server-resolved, audience-correct Buy More offers (§9.1): the client
  // never sees the other audience's pricing, let alone chooses it.
  const topupAudience = resolveTopupAudienceForLegacyPlan(guard.salon.plan ?? null);
  const topupOffers = listActiveTopupOffersForAudience(topupAudience)
    .map(offer => ({ key: offer.key, credits: offer.credits, priceCents: offer.priceCents }));

  // --- Credit meter -------------------------------------------------------
  const balance = await db.transaction(async tx => computeAvailableBalance(tx, salonId, now));
  const [subscription] = await db
    .select({
      planDefinitionKey: billingSubscriptionSchema.planDefinitionKey,
      billingCadence: billingSubscriptionSchema.billingCadence,
      status: billingSubscriptionSchema.status,
      paidThrough: billingSubscriptionSchema.paidThrough,
      currentCreditWindowEnd: billingSubscriptionSchema.currentCreditWindowEnd,
      cancelAtPeriodEnd: billingSubscriptionSchema.cancelAtPeriodEnd,
      rateProtectedThrough: billingSubscriptionSchema.rateProtectedThrough,
    })
    .from(billingSubscriptionSchema)
    .where(and(
      eq(billingSubscriptionSchema.salonId, salonId),
      inArray(billingSubscriptionSchema.status, ['active', 'past_due', 'canceled']),
    ))
    .limit(1);
  const plan = subscription !== undefined
    ? getPlanDefinition(subscription.planDefinitionKey)
    : null;

  const blockedRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM communication_intent
    WHERE salon_id = ${salonId} AND status = 'blocked_no_credit'
  `);

  // Owner vocabulary: promotional + delivery_recovery + administrative fold
  // into one "bonus" bucket — the distinction is operator detail.
  const byBucket = balance.byBucket;
  const usage = {
    availableCredits: balance.available,
    monthlyCredits: byBucket.monthly ?? 0,
    starterCredits: byBucket.starter ?? 0,
    purchasedCredits: byBucket.purchased ?? 0,
    bonusCredits: (byBucket.promotional ?? 0)
      + (byBucket.delivery_recovery ?? 0)
      + (byBucket.administrative ?? 0),
    monthlyAllowance: plan?.monthlySmsCredits ?? 0,
    resetsAt: subscription?.currentCreditWindowEnd?.toISOString() ?? null,
    blockedMessages: Number((blockedRows.rows[0] as Record<string, unknown>).n),
    plan: plan === null
      ? null
      : {
          key: plan.key,
          displayName: plan.displayName,
          cadence: subscription!.billingCadence,
          status: subscription!.status,
          paidThrough: subscription!.paidThrough.toISOString(),
          cancelAtPeriodEnd: subscription!.cancelAtPeriodEnd,
          rateProtectedThrough: subscription!.rateProtectedThrough?.toISOString() ?? null,
        },
  };

  // --- Message history (compound cursor) ----------------------------------
  const cursorParam = request.nextUrl.searchParams.get('cursor');
  let cursorFilter;
  if (cursorParam !== null) {
    // Split on the FIRST underscore only: intent ids themselves contain
    // underscores (ci_<uuid>), so a naive split corrupts the id half.
    const separator = cursorParam.indexOf('_');
    const cursorTime = separator > 0 ? cursorParam.slice(0, separator) : '';
    const cursorId = separator > 0 ? cursorParam.slice(separator + 1) : '';
    const cursorDate = new Date(Number(cursorTime));
    if (Number.isNaN(cursorDate.getTime()) || !cursorId) {
      return Response.json(
        { error: { code: 'INVALID_CURSOR', message: 'The history cursor is not valid.' } },
        { status: 400, ...NO_STORE },
      );
    }
    cursorFilter = or(
      lt(communicationIntentSchema.createdAt, cursorDate),
      and(
        eq(communicationIntentSchema.createdAt, cursorDate),
        lt(communicationIntentSchema.id, cursorId),
      ),
    );
  }
  const rows = await db
    .select({
      id: communicationIntentSchema.id,
      channel: communicationIntentSchema.channel,
      eventType: communicationIntentSchema.eventType,
      appointmentId: communicationIntentSchema.appointmentId,
      recipient: communicationIntentSchema.recipient,
      status: communicationIntentSchema.status,
      scheduledFor: communicationIntentSchema.scheduledFor,
      resolvedAt: communicationIntentSchema.resolvedAt,
      segmentCount: communicationIntentSchema.segmentCount,
      lastError: communicationIntentSchema.lastError,
      blockedReason: communicationIntentSchema.blockedReason,
      createdAt: communicationIntentSchema.createdAt,
    })
    .from(communicationIntentSchema)
    .where(cursorFilter === undefined
      ? eq(communicationIntentSchema.salonId, salonId)
      : and(eq(communicationIntentSchema.salonId, salonId), cursorFilter))
    .orderBy(desc(communicationIntentSchema.createdAt), desc(communicationIntentSchema.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const nextCursor = rows.length > PAGE_SIZE
    ? `${page[page.length - 1]!.createdAt.getTime()}_${page[page.length - 1]!.id}`
    : null;

  const history = page.map(row => ({
    id: row.id,
    channel: row.channel,
    eventType: row.eventType,
    appointmentId: row.appointmentId,
    recipient: maskRecipient(row.channel, row.recipient),
    status: row.status,
    scheduledFor: row.scheduledFor.toISOString(),
    sentAt: row.status === 'sent' ? row.resolvedAt?.toISOString() ?? null : null,
    creditsUsed: row.channel === 'sms' && row.status === 'sent' ? row.segmentCount ?? 1 : 0,
    failureReason: ['failed', 'expired', 'suppressed', 'blocked_no_credit', 'canceled'].includes(row.status)
      ? friendlyFailureReason(row.blockedReason ?? row.lastError)
      : null,
  }));

  return Response.json({ data: { salonId, usage, history, nextCursor, topupOffers } }, NO_STORE);
}

export const dynamic = 'force-dynamic';
