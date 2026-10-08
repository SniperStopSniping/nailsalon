import 'server-only';

import { sql } from 'drizzle-orm';

import { smsCreditStatus } from '@/libs/smsCreditStatus';
import { getDateKeyInTimeZone, zonedTimeToUtc } from '@/libs/timeZone';

import { type BillingDbTransaction, computeAvailableBalance } from './creditLedger';

/** Read under one repeatable-read snapshot, without mutating credits or claims. */
export async function readSmsCreditOverview(tx: BillingDbTransaction, salonId: string, timeZone: string, now: Date) {
  const balance = await computeAvailableBalance(tx, salonId, now);
  const monthStart = zonedTimeToUtc({ date: `${getDateKeyInTimeZone(now, timeZone).slice(0, 7)}-01`, time: '00:00', timeZone });
  const facts = await tx.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(amount), 0)::int FROM sms_credit_ledger
       WHERE salon_id = ${salonId} AND bucket = 'purchased' AND entry_type = 'grant'
         AND reason = 'topup_fulfillment') AS purchased,
      (SELECT COALESCE(SUM(CASE WHEN rl.refunded_at IS NOT NULL THEN 0
         ELSE rl.segments - rl.refunded_segments END), 0)::int
       FROM sms_credit_reservation r JOIN sms_credit_reservation_lot rl
         ON rl.reservation_id = r.id AND rl.salon_id = r.salon_id
       WHERE r.salon_id = ${salonId} AND r.status = 'settled'
         AND r.settled_at >= ${monthStart} AND r.settled_at <= ${now}) AS used,
      (SELECT topup_offer_key FROM sms_topup_purchase
       WHERE salon_id = ${salonId} AND status = 'fulfilled' AND grant_ledger_id IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT 1) AS last_offer,
      (SELECT credits FROM sms_topup_purchase
       WHERE salon_id = ${salonId} AND status = 'fulfilled' AND grant_ledger_id IS NOT NULL
       ORDER BY created_at DESC, id DESC LIMIT 1) AS last_credits
  `);
  // A single unexpired, unreversed grant is a provable allocation. Mixed
  // lots, refunds and historical expiry cannot support an honest denominator.
  const allocationRows = await tx.execute(sql`
    SELECT CASE WHEN COUNT(*) FILTER (WHERE amount > 0) = 1
      AND COUNT(*) FILTER (WHERE entry_type IN ('sms_refund', 'expiry', 'purchase_reversal')) = 0
      THEN MAX(amount) FILTER (WHERE amount > 0 AND (expires_at IS NULL OR expires_at > ${now}))
      ELSE NULL END AS allocation FROM sms_credit_ledger WHERE salon_id = ${salonId}
  `);
  const fact = facts.rows[0] as Record<string, unknown>;
  const allocation = (allocationRows.rows[0] as Record<string, unknown>).allocation;
  const allocationCredits = allocation === null || allocation === undefined ? null : Number(allocation);
  return {
    availableCredits: balance.available,
    pendingCredits: balance.reserved,
    allocationCredits: allocationCredits !== null && allocationCredits >= balance.available ? allocationCredits : null,
    status: smsCreditStatus(balance.available),
    totalPurchased: Number(fact.purchased),
    usedThisMonth: Number(fact.used),
    monthStart: monthStart.toISOString(),
    timeZone,
    lastPurchaseCredits: fact.last_credits === null || fact.last_credits === undefined ? null : Number(fact.last_credits),
    lastPurchaseOfferKey: typeof fact.last_offer === 'string' ? fact.last_offer : null,
  };
}

export const CREDIT_ACTIVITY_PAGE_SIZE = 25;

export function decodeCreditActivityCursor(cursor: string | null): { at: Date; id: string } | null {
  if (cursor === null) {
    return null;
  }
  const separator = cursor.indexOf('_');
  const time = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (separator < 1 || !Number.isSafeInteger(time) || !id || id.length > 200 || Number.isNaN(new Date(time).getTime())) {
    throw new Error('INVALID_CURSOR');
  }
  return { at: new Date(time), id };
}

/** Chronological credit facts; no recipient, message body or provider IDs. */
export async function readSmsCreditActivity(tx: BillingDbTransaction, salonId: string, cursor: ReturnType<typeof decodeCreditActivityCursor>) {
  const rows = await tx.execute(sql`
    WITH activity AS (
      SELECT CASE WHEN l.entry_type = 'debit' AND l.reservation_id IS NOT NULL
        THEN l.reservation_id ELSE l.id END AS id,
        MAX(l.created_at) AS created_at, l.entry_type, MAX(l.bucket) AS bucket,
        SUM(l.amount)::int AS credits,
        MAX(r.delivery_id) AS delivery_id
      FROM sms_credit_ledger l
      LEFT JOIN sms_credit_reservation r ON r.id = l.reservation_id AND r.salon_id = l.salon_id
      WHERE l.salon_id = ${salonId}
      GROUP BY 1, l.entry_type
    ), page AS (SELECT * FROM activity
      WHERE ${cursor ? sql`(created_at, id) < (${cursor.at}, ${cursor.id})` : sql`true`}
      ORDER BY created_at DESC, id DESC LIMIT ${CREDIT_ACTIVITY_PAGE_SIZE + 1}
    ) SELECT page.*, (SELECT ci.event_type FROM communication_intent ci
      WHERE ci.salon_id = ${salonId} AND ci.delivery_id = page.delivery_id
      ORDER BY ci.created_at DESC LIMIT 1) AS event_type
    FROM page ORDER BY created_at DESC, id DESC
  `);
  const items = (rows.rows as Array<Record<string, unknown>>).slice(0, CREDIT_ACTIVITY_PAGE_SIZE).map(row => ({
    id: String(row.id),
    createdAt: new Date(row.created_at as string).toISOString(),
    type: String(row.entry_type),
    bucket: String(row.bucket),
    credits: Number(row.credits),
    eventType: typeof row.event_type === 'string' ? row.event_type : null,
  }));
  const last = items[items.length - 1];
  return { items, nextCursor: rows.rows.length > CREDIT_ACTIVITY_PAGE_SIZE && last ? `${new Date(last.createdAt).getTime()}_${last.id}` : null };
}
