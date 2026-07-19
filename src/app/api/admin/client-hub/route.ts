import { and, eq, gt, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireAdminSalon } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import {
  buildRetentionQueue,
  type RetentionClientSnapshot,
} from '@/libs/retentionAssistant';
import { getRetentionSettingsForSalon } from '@/libs/retentionSettings.server';
import { revenueCentsSql } from '@/libs/revenueSql';
import {
  appointmentSchema,
  appointmentServicesSchema,
  communicationConsentSchema,
  retentionCampaignSchema,
  salonClientSchema,
} from '@/models/Schema';

export const dynamic = 'force-dynamic';

// =============================================================================
// GET /api/admin/client-hub — Overview, Segments and Reports for the Client
// Hub, computed ONLY from persisted data. Money comes from the finalized
// checkout values (revenueCentsSql: net of tax, comp = 0); tax/tips/paid are
// reported separately and tax is never counted as revenue or client spending.
// Follow-up definitions are NOT recomputed here beyond reusing the shared
// retention engine (same one as Marketing/Today). Admin-only; salon-scoped.
// Segments without reliable backing data (birthdays, client source) are
// deliberately absent — nothing here is estimated.
// =============================================================================

const querySchema = z.object({
  salonSlug: z.string().trim().min(1).max(200),
});

const DAY = 86_400_000;

export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return Response.json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid client hub query.' },
    }, { status: 400 });
  }

  const { salon, error } = await requireAdminSalon(parsed.data.salonSlug);
  if (error || !salon) {
    return error!;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [settings, clientRows, futureRows, apptStats, moneyStats, topServices, categoryRows, consentRows, redemptionStats, recentCancelledRows] = await Promise.all([
    getRetentionSettingsForSalon(salon.id),
    db
      .select({
        id: salonClientSchema.id,
        fullName: salonClientSchema.fullName,
        phone: salonClientSchema.phone,
        lastVisitAt: salonClientSchema.lastVisitAt,
        rebookIntervalDays: salonClientSchema.rebookIntervalDays,
        isBlocked: salonClientSchema.isBlocked,
        totalVisits: salonClientSchema.totalVisits,
        noShowCount: salonClientSchema.noShowCount,
        createdAt: salonClientSchema.createdAt,
        preferredTechnicianId: salonClientSchema.preferredTechnicianId,
      })
      .from(salonClientSchema)
      .where(eq(salonClientSchema.salonId, salon.id))
      .limit(5000),
    db
      .select({
        salonClientId: appointmentSchema.salonClientId,
        clientPhone: appointmentSchema.clientPhone,
        id: appointmentSchema.id,
        clientName: appointmentSchema.clientName,
        startTime: appointmentSchema.startTime,
        endTime: appointmentSchema.endTime,
        status: appointmentSchema.status,
      })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, salon.id),
        isNull(appointmentSchema.deletedAt),
        or(
          and(
            gt(appointmentSchema.startTime, now),
            inArray(appointmentSchema.status, ['pending', 'confirmed', 'in_progress']),
          ),
          eq(appointmentSchema.status, 'in_progress'),
        ),
      ))
      .limit(5000),
    db
      .select({
        completed: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'completed')::int`,
        cancelled: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'cancelled')::int`,
        noShows: sql<number>`count(*) FILTER (WHERE ${appointmentSchema.status} = 'no_show')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(appointmentSchema)
      .where(and(eq(appointmentSchema.salonId, salon.id), isNull(appointmentSchema.deletedAt))),
    db
      .select({
        serviceRevenueCents: sql<number>`COALESCE(sum(${revenueCentsSql()}) FILTER (WHERE ${appointmentSchema.status} = 'completed'), 0)::int`,
        discountCents: sql<number>`COALESCE(sum(COALESCE(${appointmentSchema.finalDiscountCents}, ${appointmentSchema.discountAmountCents}, 0)) FILTER (WHERE ${appointmentSchema.status} = 'completed'), 0)::int`,
        taxCents: sql<number>`COALESCE(sum(${appointmentSchema.taxAmountCents}) FILTER (WHERE ${appointmentSchema.status} = 'completed'), 0)::int`,
        tipCents: sql<number>`COALESCE(sum(${appointmentSchema.tipCents}) FILTER (WHERE ${appointmentSchema.status} = 'completed'), 0)::int`,
        amountPaidCents: sql<number>`COALESCE(sum(${appointmentSchema.amountPaidCents}) FILTER (WHERE ${appointmentSchema.status} = 'completed'), 0)::int`,
        // Balance is only computable where a checkout recorded payments
        // (amount_paid IS NOT NULL); legacy rows are honestly excluded.
        outstandingCents: sql<number>`COALESCE(sum(GREATEST(COALESCE(${appointmentSchema.finalPriceCents}, ${appointmentSchema.totalPrice}) + COALESCE(${appointmentSchema.taxAmountCents}, 0) + COALESCE(${appointmentSchema.tipCents}, 0) - ${appointmentSchema.amountPaidCents}, 0)) FILTER (WHERE ${appointmentSchema.status} = 'completed' AND ${appointmentSchema.amountPaidCents} IS NOT NULL AND ${appointmentSchema.paymentStatus} != 'comp'), 0)::int`,
      })
      .from(appointmentSchema)
      .where(eq(appointmentSchema.salonId, salon.id)),
    db
      .select({
        name: appointmentServicesSchema.nameSnapshot,
        count: sql<number>`count(*)::int`,
      })
      .from(appointmentServicesSchema)
      .innerJoin(appointmentSchema, eq(appointmentSchema.id, appointmentServicesSchema.appointmentId))
      .where(and(
        eq(appointmentSchema.salonId, salon.id),
        eq(appointmentSchema.status, 'completed'),
      ))
      .groupBy(appointmentServicesSchema.nameSnapshot)
      .orderBy(sql`count(*) DESC`)
      .limit(5),
    db
      .select({
        salonClientId: appointmentSchema.salonClientId,
        category: appointmentServicesSchema.categorySnapshot,
      })
      .from(appointmentServicesSchema)
      .innerJoin(appointmentSchema, eq(appointmentSchema.id, appointmentServicesSchema.appointmentId))
      .where(and(
        eq(appointmentSchema.salonId, salon.id),
        eq(appointmentSchema.status, 'completed'),
      ))
      .limit(10000),
    db
      .select({ recipient: communicationConsentSchema.recipient, status: communicationConsentSchema.status })
      .from(communicationConsentSchema)
      .where(and(
        eq(communicationConsentSchema.salonId, salon.id),
        eq(communicationConsentSchema.channel, 'sms'),
      )),
    db
      .select({
        redeemed: sql<number>`count(*) FILTER (WHERE ${retentionCampaignSchema.redeemedAt} IS NOT NULL)::int`,
        minted: sql<number>`count(*)::int`,
      })
      .from(retentionCampaignSchema)
      .where(eq(retentionCampaignSchema.salonId, salon.id)),
    db
      .select({ salonClientId: appointmentSchema.salonClientId })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.salonId, salon.id),
        eq(appointmentSchema.status, 'cancelled'),
        gte(appointmentSchema.updatedAt, new Date(now.getTime() - 30 * DAY)),
      ))
      .limit(5000),
  ]);

  // Shared follow-up definitions — the SAME engine as Marketing/Today.
  const clients: RetentionClientSnapshot[] = clientRows;
  const retention = buildRetentionQueue({
    clients,
    futureAppointments: futureRows,
    communications: [],
    defaultRebookDays: settings.defaultRebookDays,
    now,
  });
  const dueCount = retention.filter(item => item.stage === 'rebook').length;
  const overdueCount = retention.filter(item => item.stage !== 'rebook').length;

  const clientsWithFuture = new Set(futureRows.map(row => row.salonClientId).filter(Boolean));
  const noFutureCount = clientRows.filter(client => !clientsWithFuture.has(client.id)).length;

  const notSeen = (days: number) => clientRows.filter(client =>
    client.lastVisitAt && now.getTime() - client.lastVisitAt.getTime() >= days * DAY).length;

  const categoryClients = new Map<string, Set<string>>();
  for (const row of categoryRows) {
    if (!row.salonClientId || !row.category) {
      continue;
    }
    if (!categoryClients.has(row.category)) {
      categoryClients.set(row.category, new Set());
    }
    categoryClients.get(row.category)!.add(row.salonClientId);
  }
  const categoryCount = (categories: string[]) =>
    new Set(categories.flatMap(category => [...(categoryClients.get(category) ?? [])])).size;

  const consentGranted = new Set(
    consentRows.filter(row => row.status === 'granted').map(row => row.recipient),
  ).size;

  const stats = apptStats[0]!;
  const money = moneyStats[0]!;
  const finishedTotal = stats.completed + stats.cancelled + stats.noShows;
  const returningCount = clientRows.filter(client => (client.totalVisits ?? 0) >= 2).length;
  const visitedCount = clientRows.filter(client => (client.totalVisits ?? 0) >= 1).length;

  const rate = (numerator: number, denominator: number) =>
    denominator > 0 ? Math.round((numerator / denominator) * 100) : null;

  return Response.json({
    data: {
      overview: {
        totalClients: clientRows.length,
        newClientsThisMonth: clientRows.filter(client => client.createdAt >= monthStart).length,
        returningClients: returningCount,
        dueToReturn: dueCount,
        overdue: overdueCount,
        noFutureAppointment: noFutureCount,
        completedAppointments: stats.completed,
        // Rates are null (UI: "Not enough data yet") until real data exists.
        cancellationRate: rate(stats.cancelled, finishedTotal),
        noShowRate: rate(stats.noShows, finishedTotal),
        rebookingRate: rate(returningCount, visitedCount),
        topServices,
        serviceRevenueCents: money.serviceRevenueCents,
        outstandingCents: money.outstandingCents,
      },
      segments: [
        { id: 'new_this_month', label: 'New this month', count: clientRows.filter(client => client.createdAt >= monthStart).length },
        { id: 'returning', label: 'Returning', count: returningCount },
        { id: 'due_to_return', label: 'Due to return', count: dueCount },
        { id: 'overdue', label: 'Overdue', count: overdueCount },
        { id: 'no_future_appointment', label: 'No future appointment', count: noFutureCount },
        { id: 'not_seen_60d', label: 'Not seen in 60 days', count: notSeen(60) },
        { id: 'not_seen_90d', label: 'Not seen in 90 days', count: notSeen(90) },
        { id: 'recently_cancelled', label: 'Cancelled in the last 30 days', count: new Set(recentCancelledRows.map(row => row.salonClientId).filter(Boolean)).size },
        { id: 'previous_no_shows', label: 'Previous no-shows', count: clientRows.filter(client => (client.noShowCount ?? 0) > 0).length },
        { id: 'builder_gel', label: 'Builder gel clients', count: categoryCount(['builder_gel']) },
        { id: 'manicure', label: 'Manicure clients', count: categoryCount(['manicure', 'hands']) },
        { id: 'pedicure', label: 'Pedicure clients', count: categoryCount(['pedicure', 'feet']) },
        { id: 'extensions', label: 'Extension clients', count: categoryCount(['extensions']) },
        { id: 'sms_consent', label: 'Text consent on file (transactional)', count: consentGranted },
      ],
      reports: {
        finishedAppointments: finishedTotal,
        completed: stats.completed,
        cancelled: stats.cancelled,
        noShows: stats.noShows,
        cancellationRate: rate(stats.cancelled, finishedTotal),
        noShowRate: rate(stats.noShows, finishedTotal),
        rebookingRate: rate(returningCount, visitedCount),
        // Finalized money — tax/tips reported separately, never as revenue.
        serviceRevenueCents: money.serviceRevenueCents,
        discountCents: money.discountCents,
        taxCollectedCents: money.taxCents,
        tipsCents: money.tipCents,
        amountPaidCents: money.amountPaidCents,
        outstandingCents: money.outstandingCents,
        promotionsMinted: redemptionStats[0]?.minted ?? 0,
        promotionsRedeemed: redemptionStats[0]?.redeemed ?? 0,
        topServices,
      },
    },
  });
}
