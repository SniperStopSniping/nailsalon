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
 *
 * P7 addition (§3 G19/G21, §5 P7): `capabilities` tells the client which
 * dark switches are live (never per-switch detail beyond what the owner
 * surface itself needs), and `catalog` carries the public, ID-free plan /
 * offer / founding-promotion projections so `ChoosePlanPanel` never mirrors
 * prices client-side. Both are built from the same public projection
 * functions the checkout route validates against, so drift is impossible.
 */
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { requireAdminSalon } from '@/libs/adminAuth';
import { getPublicBillingOffers } from '@/libs/billing/billingOffers';
import { computeAvailableBalance } from '@/libs/billing/creditLedger';
import { describeBillingState, resolveTopupAudienceForLegacyPlan } from '@/libs/billing/legacyPlanAdapter';
import { getPlanDefinition, getPublicPlanCatalog, type PlanDefinitionKey } from '@/libs/billing/planDefinitions';
import { getPromotion, isPromotionWindowOpen } from '@/libs/billing/promotions';
import { BillingCatalogError, resolveStripePriceIdForTopup } from '@/libs/billing/stripePriceMap';
import { listActiveTopupOffersForAudience } from '@/libs/billing/topupOffers';
import { friendlyFailureReason, maskRecipient, ownerSmsDeliveryStatus } from '@/libs/communicationMasking';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { checkEndpointRateLimit, getClientIp, rateLimitResponse } from '@/libs/rateLimit';
import {
  billingSubscriptionSchema,
  communicationIntentSchema,
  notificationDeliverySchema,
  smsCreditReservationLotSchema,
  smsCreditReservationSchema,
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
  const topupOffers = Env.BILLING_TOPUPS_ENABLED === 'true'
    ? listActiveTopupOffersForAudience(topupAudience)
      .filter((offer) => {
        try {
          resolveStripePriceIdForTopup(offer.key);
          return true;
        } catch (error) {
          if (error instanceof BillingCatalogError) {
            return false;
          }
          throw error;
        }
      })
      .map(offer => ({ key: offer.key, credits: offer.credits, priceCents: offer.priceCents }))
    : [];
  // Configuration readiness only: never contact Stripe from this read path.
  const creditPurchasesAvailable = topupOffers.length > 0;

  // --- P7: capabilities + catalog (ChoosePlanPanel) -----------------------
  // Server-side dark switches only (§12) — no per-switch detail beyond what
  // ChoosePlanPanel needs to decide "informational cards" vs "live Choose
  // buttons"; granular switch/secret state is P8b's authenticated panel.
  const capabilities = {
    subscriptions: Env.BILLING_SUBSCRIPTIONS_ENABLED === 'true',
    topups: Env.BILLING_TOPUPS_ENABLED === 'true',
    pricingPublic: Env.PUBLIC_PRICING_ENABLED === 'true',
  };
  // Founding promotion (§3.9): a public, ID-free projection, present only
  // while its redemption window is actually open — closed (both bounds
  // null) is the committed default and MUST stay that way until §12's seven
  // publication approvals land.
  const foundingPromotion = getPromotion('founding_annual_2026');
  const founding = foundingPromotion !== null && isPromotionWindowOpen(foundingPromotion, now)
    ? {
        key: foundingPromotion.key,
        percentOff: foundingPromotion.percentOffAgainstAnnualPrice,
        rateProtectionMonths: foundingPromotion.rateProtectionMonths,
        eligibleOfferKeys: foundingPromotion.eligibleOfferKeys,
        endsAt: foundingPromotion.endsAt,
      }
    : null;
  const catalog = {
    plans: getPublicPlanCatalog(),
    offers: getPublicBillingOffers(),
    founding,
  };

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
    .where(eq(billingSubscriptionSchema.salonId, salonId))
    // G18 (§6.5a): every status must render truthfully — unpaid, incomplete,
    // incomplete_expired and paused used to fall out of the old
    // active/past_due/canceled filter and render as "No subscription".
    // When more than one row exists for a salon (a canceled/expired history
    // row alongside a live one), prefer the LIVE row (status not in
    // canceled/incomplete_expired); among ties, the most recently updated
    // row wins.
    .orderBy(
      sql`(${billingSubscriptionSchema.status} not in ('canceled', 'incomplete_expired')) desc`,
      desc(billingSubscriptionSchema.updatedAt),
    )
    .limit(1);
  const plan = subscription !== undefined
    ? getPlanDefinition(subscription.planDefinitionKey)
    : null;
  // G16: the usage route and describeBillingState share ONE entitlement
  // computation (subscriptionEntitlement.ts) so the owner surface and the
  // legacy/billing adapter can never disagree about what a status means.
  const entitlement = describeBillingState({
    salon: { plan: guard.salon.plan ?? null },
    subscription: subscription === undefined
      ? null
      : { ...subscription, planDefinitionKey: subscription.planDefinitionKey as PlanDefinitionKey },
    now,
  }).entitlement;

  const blockedRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM communication_intent
    WHERE salon_id = ${salonId} AND status = 'blocked_no_credit'
  `);

  // Owner vocabulary: promotional + delivery_recovery + administrative fold
  // into one "bonus" bucket — the distinction is operator detail.
  const byBucket = balance.byBucket;
  const usage = {
    availableCredits: balance.available,
    // Owner-facing counterpart to the ledger's `reserved` bucket: credits
    // held for texts that are queued/sending but not yet settled.
    pendingCredits: balance.reserved,
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
          // G18/§6.5a: plain-English status truth for every subscription
          // status, not just active/past_due/canceled. Never null when
          // `plan` itself is non-null (a resolved plan implies a
          // subscription row, which always has a status).
          entitlement,
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
      variables: communicationIntentSchema.variables,
      recipient: communicationIntentSchema.recipient,
      status: communicationIntentSchema.status,
      scheduledFor: communicationIntentSchema.scheduledFor,
      resolvedAt: communicationIntentSchema.resolvedAt,
      segmentCount: communicationIntentSchema.segmentCount,
      lastError: communicationIntentSchema.lastError,
      blockedReason: communicationIntentSchema.blockedReason,
      createdAt: communicationIntentSchema.createdAt,
      deliveryStatus: notificationDeliverySchema.status,
      deliveryErrorCode: notificationDeliverySchema.errorCode,
      settlementState: notificationDeliverySchema.settlementState,
      chargedCredits: notificationDeliverySchema.segmentCount,
      creditReservationId: notificationDeliverySchema.creditReservationId,
    })
    .from(communicationIntentSchema)
    .leftJoin(notificationDeliverySchema, and(
      eq(notificationDeliverySchema.id, communicationIntentSchema.deliveryId),
      eq(notificationDeliverySchema.salonId, salonId),
    ))
    .where(cursorFilter === undefined
      ? eq(communicationIntentSchema.salonId, salonId)
      : and(eq(communicationIntentSchema.salonId, salonId), cursorFilter))
    .orderBy(desc(communicationIntentSchema.createdAt), desc(communicationIntentSchema.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const nextCursor = rows.length > PAGE_SIZE
    ? `${page[page.length - 1]!.createdAt.getTime()}_${page[page.length - 1]!.id}`
    : null;

  // Net SMS credits actually charged, after partial/full refunds — reads the
  // same settled reservation lots the ledger itself trusts, scoped to this
  // salon. Rows predating the reservation link (creditReservationId null)
  // keep the legacy chargedCredits/segmentCount estimate below.
  const reservationIds = page.flatMap(row => (row.creditReservationId ? [row.creditReservationId] : []));
  const charges = reservationIds.length === 0
    ? []
    : await db
      .select({
        id: smsCreditReservationSchema.id,
        credits: sql<number>`COALESCE(SUM(CASE
          WHEN ${smsCreditReservationLotSchema.refundedAt} IS NOT NULL THEN 0
          ELSE ${smsCreditReservationLotSchema.segments} - ${smsCreditReservationLotSchema.refundedSegments}
        END), 0)::int`,
      })
      .from(smsCreditReservationSchema)
      .innerJoin(smsCreditReservationLotSchema, and(
        eq(smsCreditReservationLotSchema.reservationId, smsCreditReservationSchema.id),
        eq(smsCreditReservationLotSchema.salonId, salonId),
      ))
      .where(and(
        eq(smsCreditReservationSchema.salonId, salonId),
        eq(smsCreditReservationSchema.status, 'settled'),
        inArray(smsCreditReservationSchema.id, reservationIds),
      ))
      .groupBy(smsCreditReservationSchema.id);
  const netCreditsByReservation = new Map(charges.map(charge => [charge.id, Number(charge.credits)]));

  const history = page.map((row) => {
    // §11.1 reminder rules persist their lead time on the intent's
    // variables at materialization time (communicationMaterialization.ts);
    // clamp to the same [15m, 7d] range the settings schema enforces so a
    // corrupt/legacy value can never masquerade as a real category.
    const parsedReminderLead = Number(row.variables.reminderLeadMinutes);
    const reminderLeadMinutes = row.eventType === 'appointment_reminder'
      && Number.isInteger(parsedReminderLead)
      && parsedReminderLead >= 15
      && parsedReminderLead <= 7 * 24 * 60
      ? parsedReminderLead
      : null;
    return {
      id: row.id,
      channel: row.channel,
      eventType: row.eventType,
      appointmentId: row.appointmentId,
      recipient: maskRecipient(row.channel, row.recipient),
      status: row.channel === 'sms'
        ? ownerSmsDeliveryStatus(row.status === 'sent' && row.deliveryStatus ? row.deliveryStatus : row.status, row.blockedReason, row.deliveryErrorCode, row.lastError)
        : row.status === 'sent' && row.deliveryStatus ? row.deliveryStatus : row.status,
      scheduledFor: row.scheduledFor.toISOString(),
      sentAt: row.status === 'sent' ? row.resolvedAt?.toISOString() ?? null : null,
      // Partial refunds leave the original delivery segment count
      // unchanged — read settled/refunded evidence when a reservation link
      // exists, and fall back to the legacy estimate for rows without one.
      creditsUsed: row.channel === 'sms' && row.settlementState === 'settled'
        ? row.creditReservationId
          ? netCreditsByReservation.get(row.creditReservationId) ?? 0
          : row.chargedCredits ?? row.segmentCount ?? 1
        : 0,
      reminderLeadMinutes,
      failureReason: ['failed', 'undelivered'].includes(row.deliveryStatus ?? '')
        ? friendlyFailureReason(row.deliveryErrorCode ?? 'DELIVERY_FAILED')
        : ['failed', 'expired', 'suppressed', 'blocked_no_credit', 'canceled'].includes(row.status)
            ? friendlyFailureReason(row.blockedReason ?? row.lastError)
            : null,
    };
  });

  return Response.json({
    data: { salonId, usage, history, nextCursor, topupOffers, creditPurchasesAvailable, capabilities, catalog },
  }, NO_STORE);
}

export const dynamic = 'force-dynamic';
