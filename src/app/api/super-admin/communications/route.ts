/**
 * Super-admin communications & billing operations report — Gate C4 (§10.6/§10.7).
 *
 * BOUNDED aggregates only: counts, sums and cost totals grouped by closed
 * vocabularies (status, bucket, channel) — never by recipient or by
 * unbounded salon dimensions, and never raw provider payloads or tokens.
 * Margin numbers are ESTIMATES for operations, not audited accounting, and
 * the response says so.
 */
import { sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { requireSuperAdmin } from '@/libs/adminAuth';
import { db } from '@/libs/DB';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function GET(_request: NextRequest): Promise<Response> {
  const access = await requireSuperAdmin();
  if (!access.ok) {
    return access.response;
  }

  const [intents, credits, deliveries, revenue, control] = await Promise.all([
    db.execute(sql`
      SELECT status, COUNT(*)::int AS n FROM communication_intent GROUP BY status
    `),
    db.execute(sql`
      SELECT bucket, entry_type, COALESCE(SUM(amount), 0)::int AS total
      FROM sms_credit_ledger GROUP BY bucket, entry_type
    `),
    db.execute(sql`
      SELECT channel,
             COUNT(*)::int AS n,
             COALESCE(SUM(provider_segments), 0)::int AS provider_segments,
             COALESCE(SUM(provider_cost_cad_micros), 0)::bigint AS cost_cad_micros,
             COUNT(*) FILTER (WHERE reconciled_at IS NULL AND provider_message_id IS NOT NULL)::int AS unreconciled
      FROM notification_delivery GROUP BY channel
    `),
    db.execute(sql`
      SELECT
        (SELECT COALESCE(SUM(amount_cents), 0)::int FROM sms_topup_purchase
          WHERE status IN ('fulfilled', 'partially_reversed')) AS topup_revenue_cents,
        (SELECT COUNT(*)::int FROM billing_subscription
          WHERE status IN ('active', 'past_due')) AS live_subscriptions,
        (SELECT COUNT(*)::int FROM communication_intent
          WHERE status = 'send_outcome_unknown') AS unknown_outcomes,
        (SELECT COUNT(*)::int FROM communication_intent
          WHERE status = 'blocked_no_credit') AS blocked_no_credit,
        (SELECT COUNT(*)::int FROM notification_delivery
          WHERE anomaly_code IS NOT NULL) AS segment_anomalies
    `),
    db.execute(sql`
      SELECT sms_enabled, disabled_event_types, daily_send_limit, daily_anomaly_threshold
      FROM platform_communication_control WHERE id = 'singleton'
    `),
  ]);

  const revenueRow = revenue.rows[0] as Record<string, unknown>;
  const outboundCostMicros = (deliveries.rows as Array<Record<string, unknown>>)
    .reduce((sum, row) => sum + Number(row.cost_cad_micros ?? 0), 0);
  const topupRevenueCents = Number(revenueRow.topup_revenue_cents ?? 0);

  return Response.json({
    data: {
      intentsByStatus: Object.fromEntries(
        (intents.rows as Array<Record<string, unknown>>).map(row => [row.status, Number(row.n)]),
      ),
      creditMovement: (credits.rows as Array<Record<string, unknown>>).map(row => ({
        bucket: row.bucket,
        entryType: row.entry_type,
        total: Number(row.total),
      })),
      deliveries: (deliveries.rows as Array<Record<string, unknown>>).map(row => ({
        channel: row.channel,
        count: Number(row.n),
        providerSegments: Number(row.provider_segments),
        costCadMicros: Number(row.cost_cad_micros),
        unreconciled: Number(row.unreconciled),
      })),
      billing: {
        liveSubscriptions: Number(revenueRow.live_subscriptions ?? 0),
        topupRevenueCents,
        unknownOutcomes: Number(revenueRow.unknown_outcomes ?? 0),
        blockedNoCredit: Number(revenueRow.blocked_no_credit ?? 0),
        segmentAnomalies: Number(revenueRow.segment_anomalies ?? 0),
      },
      margin: {
        disclaimer: 'Operational estimate, not audited accounting.',
        topupRevenueCents,
        providerCostCadMicros: outboundCostMicros,
        estimatedGrossCents: topupRevenueCents - Math.round(outboundCostMicros / 10_000),
      },
      platformControl: (control.rows[0] as Record<string, unknown> | undefined) ?? null,
    },
  }, NO_STORE);
}

export const dynamic = 'force-dynamic';
