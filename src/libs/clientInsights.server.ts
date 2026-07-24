import 'server-only';

import { type SQL, sql } from 'drizzle-orm';

import {
  CLIENT_INSIGHTS_ATTENTION_LIMIT,
  CLIENT_INSIGHTS_ATTENTION_PRIORITY,
  CLIENT_INSIGHTS_RULES_VERSION,
} from '@/libs/clientInsights';
import { db } from '@/libs/DB';
import { buildFinancialBalanceSql } from '@/libs/financialReportingServer';
import {
  RETENTION_PROMO_6W_DAYS,
  RETENTION_PROMO_8W_DAYS,
  RETENTION_TERMINAL_SUPPRESSION_STATUSES,
} from '@/libs/retentionAssistant';
import { getDateKeyInTimeZone } from '@/libs/timeZone';
import {
  CLIENT_INSIGHT_SEGMENT_IDS,
  CLIENT_INSIGHT_SEGMENT_LABELS,
  type ClientInsightAttentionItem,
  type ClientInsightsData,
  type ClientInsightSegmentId,
} from '@/types/clientInsights';

export type ClientInsightsSnapshotResult = {
  data: ClientInsightsData;
};

export type ClientInsightsDirectoryClient = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  birthday: string | null;
  archivedAt: Date | null;
  mergedIntoClientId: string | null;
  updatedAt: Date;
  preferredTechnician: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
  lastVisitAt: Date | null;
  totalVisits: number;
  totalSpent: number;
  noShowCount: number;
  loyaltyPoints: number;
  notes: string | null;
  createdAt: Date;
};

export type ClientInsightsDirectoryResult = {
  clients: ClientInsightsDirectoryClient[];
  total: number;
  generatedAt: Date;
  rulesVersion: string;
};

export type ClientInsightsQueryContext = {
  salonId: string;
  timeZone: string;
  now: Date;
};

export type ClientInsightsDirectoryQueryInput = ClientInsightsQueryContext & {
  segment: ClientInsightSegmentId;
  search?: string;
  sortBy: 'recent' | 'visits' | 'spent' | 'name';
  sortOrder: 'asc' | 'desc';
  page: number;
  limit: number;
};

type QueryRow = Record<string, unknown>;

function assertContext(input: ClientInsightsQueryContext): void {
  if (!input.salonId.trim()) {
    throw new TypeError('salonId is required');
  }
  if (!input.timeZone.trim()) {
    throw new TypeError('timeZone is required');
  }
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
}

/** node-postgres returns { rows }, while PGlite returns the array directly. */
function readRows(result: unknown): QueryRow[] {
  const resultWithRows = result as { rows?: QueryRow[] };
  if (Array.isArray(resultWithRows?.rows)) {
    return resultWithRows.rows;
  }
  return Array.isArray(result) ? result as QueryRow[] : [];
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function dateValue(value: unknown): Date | null {
  if (value == null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value == null ? fallback : value as T;
}

function projectionContext(input: ClientInsightsQueryContext) {
  assertContext(input);
  const todayKey = getDateKeyInTimeZone(input.now, input.timeZone);
  return {
    ...input,
    todayKey,
    monthStartKey: `${todayKey.slice(0, 7)}-01`,
  };
}

/**
 * Canonical one-row-per-client lifecycle projection.
 *
 * The identity rules are deliberately encoded before any appointment
 * aggregation:
 * - a non-null stable client ID may resolve only to that tenant's client;
 * - a stale non-null ID never falls back to phone;
 * - legacy phone fallback is valid only for a unique, well-formed phone inside
 *   the authorized salon.
 *
 * Every KPI, attention count, filtered total and paginated list consumes the
 * boolean segment columns produced by this CTE chain.
 */
export function buildClientInsightsProjectionSql(
  rawInput: ClientInsightsQueryContext,
): SQL {
  const input = projectionContext(rawInput);
  const terminalSuppressionStatuses = sql.join(
    RETENTION_TERMINAL_SUPPRESSION_STATUSES.map(status => sql`${status}`),
    sql`, `,
  );
  const balance = buildFinancialBalanceSql(input.now, {
    status: sql`a.status`,
    deletedAt: sql`a.deleted_at`,
    paymentStatus: sql`a.payment_status`,
    startTime: sql`a.start_time`,
    finalPriceCents: sql`a.final_price_cents`,
    totalPrice: sql`a.total_price`,
    taxAmountCents: sql`a.tax_amount_cents`,
    tipCents: sql`a.tip_cents`,
    amountPaidCents: sql`a.amount_paid_cents`,
    paymentsCents: sql<number>`COALESCE(a.positive_payment_cents, 0)`,
    hasPaymentHistory: sql`COALESCE(a.has_payment_history, false)`,
  });

  return sql`
    WITH
    insight_params AS (
      SELECT
        ${input.salonId}::text AS salon_id,
        ${input.now}::timestamptz AS as_of,
        ${input.timeZone}::text AS time_zone,
        ${input.todayKey}::date AS today,
        ${input.monthStartKey}::date AS month_start
    ),
    client_digits AS (
      SELECT
        sc.id,
        sc.salon_id,
        sc.full_name,
        sc.phone,
        sc.email,
        sc.birthday,
        sc.archived_at,
        sc.merged_into_client_id,
        sc.preferred_technician_id,
        sc.notes,
        sc.rebook_interval_days,
        sc.is_blocked,
        sc.last_visit_at,
        sc.total_visits,
        sc.total_spent,
        sc.no_show_count,
        sc.loyalty_points,
        sc.created_at,
        sc.updated_at,
        regexp_replace(COALESCE(sc.phone, ''), '[^0-9]', '', 'g') AS phone_digits
      FROM salon_client sc
      INNER JOIN insight_params p ON p.salon_id = sc.salon_id
      WHERE sc.archived_at IS NULL
        AND sc.merged_into_client_id IS NULL
    ),
    client_base AS (
      SELECT
        cd.*,
        CASE
          WHEN length(cd.phone_digits) = 10 THEN cd.phone_digits
          WHEN length(cd.phone_digits) = 11 AND left(cd.phone_digits, 1) = '1'
            THEN right(cd.phone_digits, 10)
          ELSE NULL
        END AS normalized_phone
      FROM client_digits cd
    ),
    client_phone_candidates AS (
      SELECT
        cb.salon_id,
        cb.normalized_phone,
        cb.id AS client_id
      FROM client_base cb
      WHERE cb.normalized_phone IS NOT NULL
      UNION
      SELECT
        alias.salon_id,
        alias.normalized_value AS normalized_phone,
        alias.salon_client_id AS client_id
      FROM salon_client_contact_alias alias
      INNER JOIN client_base cb
        ON cb.salon_id = alias.salon_id
       AND cb.id = alias.salon_client_id
      WHERE alias.kind = 'phone'
    ),
    unique_client_phone AS (
      SELECT
        candidate.salon_id,
        candidate.normalized_phone,
        min(candidate.client_id) AS client_id
      FROM client_phone_candidates candidate
      GROUP BY candidate.salon_id, candidate.normalized_phone
      HAVING count(DISTINCT candidate.client_id) = 1
    ),
    appointment_digits AS (
      SELECT
        a.id,
        a.salon_id,
        a.salon_client_id,
        a.client_phone,
        a.start_time,
        a.status,
        a.updated_at,
        a.deleted_at,
        a.total_price,
        a.final_price_cents,
        a.tax_amount_cents,
        a.tip_cents,
        a.amount_paid_cents,
        a.payment_status,
        regexp_replace(COALESCE(a.client_phone, ''), '[^0-9]', '', 'g') AS phone_digits
      FROM appointment a
      INNER JOIN insight_params p ON p.salon_id = a.salon_id
      WHERE a.deleted_at IS NULL
        AND a.status IN ('completed', 'cancelled', 'pending', 'confirmed', 'in_progress')
    ),
    appointment_candidates AS (
      SELECT
        ad.*,
        CASE
          WHEN length(ad.phone_digits) = 10 THEN ad.phone_digits
          WHEN length(ad.phone_digits) = 11 AND left(ad.phone_digits, 1) = '1'
            THEN right(ad.phone_digits, 10)
          ELSE NULL
        END AS normalized_phone
      FROM appointment_digits ad
    ),
    payment_aggregate AS (
      SELECT
        ap.appointment_id,
        COALESCE(sum(ap.amount_cents) FILTER (
          WHERE ap.voided_at IS NULL AND ap.amount_cents > 0
        ), 0)::bigint AS positive_payment_cents,
        true AS has_payment_history
      FROM appointment_payment ap
      INNER JOIN insight_params p
        ON p.salon_id = ap.salon_id
       AND ap.recorded_at <= p.as_of
      GROUP BY ap.appointment_id
    ),
    resolved_appointments AS (
      SELECT
        ac.*,
        CASE
          WHEN ac.salon_client_id IS NOT NULL THEN stable.id
          ELSE legacy.client_id
        END AS resolved_client_id,
        COALESCE(pa.positive_payment_cents, 0)::bigint AS positive_payment_cents,
        COALESCE(pa.has_payment_history, false) AS has_payment_history
      FROM appointment_candidates ac
      LEFT JOIN client_base stable
        ON ac.salon_client_id IS NOT NULL
       AND stable.salon_id = ac.salon_id
       AND stable.id = ac.salon_client_id
      LEFT JOIN unique_client_phone legacy
        ON ac.salon_client_id IS NULL
       AND legacy.salon_id = ac.salon_id
       AND legacy.normalized_phone = ac.normalized_phone
      LEFT JOIN payment_aggregate pa ON pa.appointment_id = ac.id
    ),
    appointment_facts AS (
      SELECT
        a.*,
        CASE
          WHEN ${balance.finalizedResolved} THEN ${balance.finalizedDueCents}
          WHEN ${balance.legacyResolved} THEN ${balance.legacyDueCents}
          ELSE 0
        END::bigint AS completed_outstanding_cents
      FROM resolved_appointments a
    ),
    client_history AS (
      SELECT
        cb.id AS client_id,
        cb.salon_id,
        cb.full_name,
        cb.phone,
        cb.email,
        cb.birthday,
        cb.archived_at,
        cb.merged_into_client_id,
        cb.preferred_technician_id,
        cb.notes,
        cb.rebook_interval_days,
        COALESCE(cb.is_blocked, false) AS is_blocked,
        cb.last_visit_at AS cached_last_visit_at,
        COALESCE(cb.total_visits, 0)::int AS cached_total_visits,
        COALESCE(cb.total_spent, 0)::int AS cached_total_spent,
        COALESCE(cb.no_show_count, 0)::int AS no_show_count,
        COALESCE(cb.loyalty_points, 0)::int AS loyalty_points,
        cb.created_at,
        cb.updated_at,
        min(af.start_time) FILTER (
          WHERE af.status = 'completed' AND af.start_time <= p.as_of
        ) AS first_completed_at,
        max(af.start_time) FILTER (
          WHERE af.status = 'completed' AND af.start_time <= p.as_of
        ) AS last_completed_at,
        count(*) FILTER (
          WHERE af.status = 'completed' AND af.start_time <= p.as_of
        )::int AS completed_visit_count,
        COALESCE(bool_or(
          af.status IN ('pending', 'confirmed') AND af.start_time > p.as_of
        ), false) AS has_future_appointment,
        COALESCE(bool_or(af.status = 'in_progress'), false)
          AS has_in_progress_appointment,
        COALESCE(sum(af.completed_outstanding_cents) FILTER (
          WHERE af.status = 'completed' AND af.start_time <= p.as_of
        ), 0)::bigint AS completed_outstanding_cents
      FROM client_base cb
      CROSS JOIN insight_params p
      LEFT JOIN appointment_facts af ON af.resolved_client_id = cb.id
      GROUP BY
        cb.id,
        cb.salon_id,
        cb.full_name,
        cb.phone,
        cb.email,
        cb.birthday,
        cb.archived_at,
        cb.merged_into_client_id,
        cb.preferred_technician_id,
        cb.notes,
        cb.rebook_interval_days,
        cb.is_blocked,
        cb.last_visit_at,
        cb.total_visits,
        cb.total_spent,
        cb.no_show_count,
        cb.loyalty_points,
        cb.created_at,
        cb.updated_at
    ),
    recent_cancellation AS (
      SELECT DISTINCT cancelled.resolved_client_id AS client_id
      FROM appointment_facts cancelled
      INNER JOIN client_history history
        ON history.client_id = cancelled.resolved_client_id
      CROSS JOIN insight_params p
      WHERE cancelled.status = 'cancelled'
        AND timezone(p.time_zone, cancelled.updated_at)::date
          BETWEEN (p.today - 14) AND p.today
        AND (
          history.last_completed_at IS NULL
          OR history.last_completed_at <= cancelled.updated_at
        )
    ),
    lifecycle_dates AS (
      SELECT
        history.*,
        COALESCE(history.rebook_interval_days, settings.default_rebook_days, 21)
          AS effective_rebook_days,
        timezone(p.time_zone, history.first_completed_at)::date
          AS first_completed_date,
        timezone(p.time_zone, history.last_completed_at)::date
          AS last_completed_date,
        p.as_of,
        p.time_zone,
        p.today,
        p.month_start,
        recent.client_id IS NOT NULL AS has_recent_cancellation
      FROM client_history history
      CROSS JOIN insight_params p
      LEFT JOIN salon_retention_settings settings
        ON settings.salon_id = history.salon_id
      LEFT JOIN recent_cancellation recent ON recent.client_id = history.client_id
    ),
    lifecycle AS (
      SELECT
        dates.*,
        dates.today - dates.last_completed_date AS days_since_last_visit,
        dates.last_completed_date + dates.effective_rebook_days
          AS expected_return_date,
        (dates.last_completed_date + dates.effective_rebook_days) - dates.today
          AS days_until_expected
      FROM lifecycle_dates dates
    ),
    lifecycle_stage AS (
      SELECT
        lifecycle.*,
        CASE
          WHEN lifecycle.last_completed_at IS NULL THEN NULL
          WHEN extract(epoch FROM lifecycle.as_of)
            - extract(epoch FROM lifecycle.last_completed_at)
              >= ${RETENTION_PROMO_8W_DAYS} * 86400
            THEN 'promo_8w'
          WHEN extract(epoch FROM lifecycle.as_of)
            - extract(epoch FROM lifecycle.last_completed_at)
              >= ${RETENTION_PROMO_6W_DAYS} * 86400
            THEN 'promo_6w'
          WHEN extract(epoch FROM lifecycle.as_of)
            - extract(epoch FROM lifecycle.last_completed_at)
              >= lifecycle.effective_rebook_days * 86400
            THEN 'rebook'
          WHEN lifecycle.days_until_expected <= 7 THEN 'rebook'
          ELSE NULL
        END AS outreach_stage,
        lifecycle.expected_return_date::timestamp
          AT TIME ZONE lifecycle.time_zone AS expected_return_at
      FROM lifecycle
    ),
    communication_ranked AS (
      SELECT
        lifecycle.client_id,
        communication.status,
        communication.snoozed_until,
        row_number() OVER (
          PARTITION BY lifecycle.client_id
          ORDER BY communication.created_at DESC, communication.id DESC
        ) AS communication_rank
      FROM lifecycle_stage lifecycle
      INNER JOIN client_communication communication
        ON communication.salon_id = lifecycle.salon_id
       AND communication.salon_client_id = lifecycle.client_id
       AND communication.kind = lifecycle.outreach_stage
       AND communication.created_at >= lifecycle.last_completed_at
      WHERE lifecycle.outreach_stage IS NOT NULL
    ),
    classification_inputs AS (
      SELECT
        lifecycle.*,
        NOT lifecycle.is_blocked
          AND NOT lifecycle.has_future_appointment
          AND NOT lifecycle.has_in_progress_appointment
          AND lifecycle.last_completed_at IS NOT NULL AS is_proactive,
        CASE
          WHEN communication.status IN (${terminalSuppressionStatuses})
            THEN true
          WHEN communication.status = 'snoozed'
            AND communication.snoozed_until > lifecycle.as_of THEN true
          ELSE false
        END AS communication_suppressed
      FROM lifecycle_stage lifecycle
      LEFT JOIN communication_ranked communication
        ON communication.client_id = lifecycle.client_id
       AND communication.communication_rank = 1
    ),
    classified_base AS (
      SELECT
        input.*,
        (
          input.has_future_appointment
          OR input.days_since_last_visit BETWEEN 0 AND 89
        ) AS segment_active,
        (
          input.first_completed_date >= input.month_start
          AND input.first_completed_date <= input.today
        ) AS segment_new_this_month,
        input.has_future_appointment AS segment_rebooked,
        (
          input.is_proactive
          AND NOT input.communication_suppressed
          AND input.days_until_expected BETWEEN 1 AND 7
        ) AS segment_due_soon,
        (
          input.is_proactive
          AND NOT input.communication_suppressed
          AND input.days_until_expected BETWEEN -7 AND 0
        ) AS segment_due_now,
        (
          input.is_proactive
          AND NOT input.communication_suppressed
          AND input.days_until_expected < -7
        ) AS segment_overdue,
        input.is_proactive AS segment_no_future_appointment,
        (
          input.is_proactive
          AND input.completed_visit_count = 1
          AND input.days_since_last_visit >= 28
        ) AS segment_first_time_no_return,
        (
          input.is_proactive
          AND input.has_recent_cancellation
        ) AS segment_recent_cancellation,
        (
          input.is_proactive
          AND input.days_since_last_visit >= 30
        ) AS segment_not_seen_30,
        (
          input.is_proactive
          AND input.days_since_last_visit >= 60
        ) AS segment_not_seen_60,
        (
          input.is_proactive
          AND input.days_since_last_visit >= 90
        ) AS segment_inactive_90,
        (
          NOT input.is_blocked
          AND input.completed_outstanding_cents > 0
        ) AS segment_completed_outstanding
      FROM classification_inputs input
    ),
    classified AS (
      SELECT
        base.*,
        (base.segment_due_soon OR base.segment_due_now)
          AS segment_due_to_return,
        (base.segment_due_soon OR base.segment_due_now OR base.segment_overdue)
          AS segment_needs_rebooking,
        (
          base.segment_recent_cancellation
          OR base.segment_overdue
          OR base.segment_due_now
          OR base.segment_due_soon
          OR base.segment_completed_outstanding
          OR (
            NOT base.communication_suppressed
            AND (
              base.segment_first_time_no_return
              OR base.segment_inactive_90
              OR base.segment_no_future_appointment
              OR base.segment_not_seen_60
              OR base.segment_not_seen_30
            )
          )
        ) AS is_attention
      FROM classified_base base
    )
  `;
}

const SEGMENT_SQL: Record<ClientInsightSegmentId, SQL> = {
  active: sql`segment_active`,
  new_this_month: sql`segment_new_this_month`,
  rebooked: sql`segment_rebooked`,
  due_to_return: sql`segment_due_to_return`,
  due_soon: sql`segment_due_soon`,
  due_now: sql`segment_due_now`,
  overdue: sql`segment_overdue`,
  needs_rebooking: sql`segment_needs_rebooking`,
  no_future_appointment: sql`segment_no_future_appointment`,
  first_time_no_return: sql`segment_first_time_no_return`,
  recent_cancellation: sql`segment_recent_cancellation`,
  not_seen_30: sql`segment_not_seen_30`,
  not_seen_60: sql`segment_not_seen_60`,
  inactive_90: sql`segment_inactive_90`,
  completed_outstanding: sql`segment_completed_outstanding`,
};

export function buildClientInsightsSummaryQuery(
  input: ClientInsightsQueryContext,
): SQL {
  const projection = buildClientInsightsProjectionSql(input);
  return sql`
    ${projection},
    insight_counts AS (
      SELECT
        count(*) FILTER (WHERE segment_active)::int AS active,
        count(*) FILTER (WHERE segment_new_this_month)::int AS new_this_month,
        count(*) FILTER (WHERE segment_rebooked)::int AS rebooked,
        count(*) FILTER (WHERE segment_due_to_return)::int AS due_to_return,
        count(*) FILTER (WHERE segment_due_soon)::int AS due_soon,
        count(*) FILTER (WHERE segment_due_now)::int AS due_now,
        count(*) FILTER (WHERE segment_overdue)::int AS overdue,
        count(*) FILTER (WHERE segment_needs_rebooking)::int AS needs_rebooking,
        count(*) FILTER (WHERE segment_no_future_appointment)::int
          AS no_future_appointment,
        count(*) FILTER (WHERE segment_first_time_no_return)::int
          AS first_time_no_return,
        count(*) FILTER (WHERE segment_recent_cancellation)::int
          AS recent_cancellation,
        count(*) FILTER (WHERE segment_not_seen_30)::int AS not_seen_30,
        count(*) FILTER (WHERE segment_not_seen_60)::int AS not_seen_60,
        count(*) FILTER (WHERE segment_inactive_90)::int AS inactive_90,
        count(*) FILTER (WHERE segment_completed_outstanding)::int
          AS completed_outstanding
      FROM classified
    ),
    attention_candidates AS (
      SELECT
        classified.*,
        CASE
          WHEN segment_recent_cancellation THEN 1
          WHEN segment_overdue THEN 2
          WHEN segment_due_now THEN 3
          WHEN segment_due_soon THEN 4
          WHEN NOT communication_suppressed AND segment_first_time_no_return THEN 5
          WHEN segment_completed_outstanding THEN 6
          WHEN NOT communication_suppressed AND segment_inactive_90 THEN 7
          WHEN NOT communication_suppressed AND segment_no_future_appointment THEN 8
          WHEN NOT communication_suppressed AND segment_not_seen_60 THEN 9
          WHEN NOT communication_suppressed AND segment_not_seen_30 THEN 10
          ELSE 99
        END AS attention_priority,
        CASE
          WHEN segment_recent_cancellation THEN 'recent_cancellation'
          WHEN segment_overdue THEN 'overdue'
          WHEN segment_due_now THEN 'due_now'
          WHEN segment_due_soon THEN 'due_soon'
          WHEN NOT communication_suppressed AND segment_first_time_no_return
            THEN 'first_time_no_return'
          WHEN segment_completed_outstanding THEN 'completed_outstanding'
          WHEN NOT communication_suppressed AND segment_inactive_90
            THEN 'inactive_90'
          WHEN NOT communication_suppressed AND segment_no_future_appointment
            THEN 'no_future_appointment'
          WHEN NOT communication_suppressed AND segment_not_seen_60
            THEN 'not_seen_60'
          WHEN NOT communication_suppressed AND segment_not_seen_30
            THEN 'not_seen_30'
          ELSE NULL
        END AS primary_reason,
        array_remove(ARRAY[
          CASE WHEN segment_recent_cancellation THEN 'recent_cancellation' END,
          CASE WHEN segment_overdue THEN 'overdue' END,
          CASE WHEN segment_due_now THEN 'due_now' END,
          CASE WHEN segment_due_soon THEN 'due_soon' END,
          CASE
            WHEN NOT communication_suppressed AND segment_first_time_no_return
              THEN 'first_time_no_return'
          END,
          CASE WHEN segment_completed_outstanding THEN 'completed_outstanding' END,
          CASE
            WHEN NOT communication_suppressed AND segment_inactive_90
              THEN 'inactive_90'
          END,
          CASE
            WHEN NOT communication_suppressed AND segment_no_future_appointment
              THEN 'no_future_appointment'
          END,
          CASE
            WHEN NOT communication_suppressed AND segment_not_seen_60
              THEN 'not_seen_60'
          END,
          CASE
            WHEN NOT communication_suppressed AND segment_not_seen_30
              THEN 'not_seen_30'
          END
        ], NULL) AS reasons
      FROM classified
      WHERE is_attention
    ),
    attention_ranked AS (
      SELECT
        attention.*,
        row_number() OVER (
          ORDER BY
            attention.attention_priority,
            attention.expected_return_at NULLS LAST,
            attention.full_name NULLS LAST,
            attention.client_id
        ) AS attention_rank
      FROM attention_candidates attention
    ),
    attention_aggregate AS (
      SELECT
        count(*)::int AS attention_total,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'clientId', client_id,
              'clientName', full_name,
              'phone', phone,
              'email', email,
              'primaryReason', primary_reason,
              'reasons', reasons,
              'lastVisitAt', last_completed_at,
              'expectedReturnAt', expected_return_at,
              'completedOutstandingCents', completed_outstanding_cents,
              'outreachStage',
                CASE
                  WHEN segment_due_soon OR segment_due_now OR segment_overdue
                    THEN outreach_stage
                  ELSE NULL
                END
            )
            ORDER BY attention_rank
          ) FILTER (WHERE attention_rank <= ${CLIENT_INSIGHTS_ATTENTION_LIMIT}),
          '[]'::jsonb
        ) AS attention_items
      FROM attention_ranked
    )
    SELECT counts.*, attention.attention_total, attention.attention_items
    FROM insight_counts counts
    CROSS JOIN attention_aggregate attention
  `;
}

function directoryOrderSql(
  sortBy: ClientInsightsDirectoryQueryInput['sortBy'],
  sortOrder: ClientInsightsDirectoryQueryInput['sortOrder'],
): SQL {
  const ascending = sortOrder === 'asc';
  switch (sortBy) {
    case 'visits':
      return ascending
        ? sql`cached_total_visits ASC, client_id ASC`
        : sql`cached_total_visits DESC, client_id ASC`;
    case 'spent':
      return ascending
        ? sql`cached_total_spent ASC, client_id ASC`
        : sql`cached_total_spent DESC, client_id ASC`;
    case 'name':
      return ascending
        ? sql`full_name ASC NULLS LAST, client_id ASC`
        : sql`full_name DESC NULLS LAST, client_id ASC`;
    case 'recent':
    default:
      return ascending
        ? sql`last_completed_at ASC NULLS LAST, client_id ASC`
        : sql`last_completed_at DESC NULLS LAST, client_id ASC`;
  }
}

export function buildClientInsightsDirectoryQuery(
  input: ClientInsightsDirectoryQueryInput,
): SQL {
  const projection = buildClientInsightsProjectionSql(input);
  const segmentPredicate = SEGMENT_SQL[input.segment];
  const search = input.search?.trim();
  const searchPredicate = search
    ? sql`AND (
        full_name ILIKE ${`%${search}%`}
        OR phone ILIKE ${`%${search}%`}
        OR email ILIKE ${`%${search}%`}
      )`
    : sql``;
  const orderBy = directoryOrderSql(input.sortBy, input.sortOrder);
  const offset = (input.page - 1) * input.limit;

  return sql`
    ${projection},
    filtered_clients AS (
      SELECT
        client_id,
        salon_id,
        phone,
        full_name,
        email,
        birthday,
        archived_at,
        merged_into_client_id,
        preferred_technician_id,
        last_completed_at,
        cached_total_visits,
        cached_total_spent,
        no_show_count,
        loyalty_points,
        notes,
        created_at,
        updated_at
      FROM classified
      WHERE ${segmentPredicate}
      ${searchPredicate}
    ),
    filtered_count AS (
      SELECT count(*)::int AS total FROM filtered_clients
    ),
    paged_clients AS (
      SELECT
        filtered.*,
        row_number() OVER (ORDER BY ${orderBy}) AS page_order
      FROM filtered_clients filtered
      ORDER BY ${orderBy}
      LIMIT ${input.limit}
      OFFSET ${offset}
    )
    SELECT
      total.total,
      page.client_id,
      page.phone,
      page.full_name,
      page.email,
      page.birthday,
      page.archived_at,
      page.merged_into_client_id,
      page.preferred_technician_id,
      page.last_completed_at,
      page.cached_total_visits,
      page.cached_total_spent,
      page.no_show_count,
      page.loyalty_points,
      page.notes,
      page.created_at,
      page.updated_at,
      technician.name AS technician_name,
      technician.avatar_url AS technician_avatar_url,
      page.page_order
    FROM filtered_count total
    LEFT JOIN paged_clients page ON true
    LEFT JOIN technician
      ON technician.id = page.preferred_technician_id
     AND technician.salon_id = ${input.salonId}
    ORDER BY page.page_order NULLS LAST
  `;
}

export async function getClientInsightsSnapshot(args: {
  salonId: string;
  timeZone: string;
  now?: Date;
}): Promise<ClientInsightsSnapshotResult> {
  const now = args.now ?? new Date();
  const context = { salonId: args.salonId, timeZone: args.timeZone, now };
  const rows = readRows(await db.execute(buildClientInsightsSummaryQuery(context)));
  const row = rows[0] ?? {};
  const counts = Object.fromEntries(
    CLIENT_INSIGHT_SEGMENT_IDS.map(id => [id, numberValue(row[id])]),
  ) as Record<ClientInsightSegmentId, number>;
  const attentionItems = jsonValue<ClientInsightAttentionItem[]>(
    row.attention_items,
    [],
  );

  // Guard the SQL priority definition against accidental drift from the
  // product ordering declared in clientInsights.ts.
  const priority = new Map(
    CLIENT_INSIGHTS_ATTENTION_PRIORITY.map((segment, index) => [segment, index]),
  );
  attentionItems.sort((left, right) =>
    (priority.get(left.primaryReason) ?? Number.MAX_SAFE_INTEGER)
    - (priority.get(right.primaryReason) ?? Number.MAX_SAFE_INTEGER));

  return {
    data: {
      generatedAt: now.toISOString(),
      timeZone: args.timeZone,
      rulesVersion: CLIENT_INSIGHTS_RULES_VERSION,
      kpis: {
        active: counts.active,
        new_this_month: counts.new_this_month,
        due_to_return: counts.due_to_return,
        overdue: counts.overdue,
      },
      segments: CLIENT_INSIGHT_SEGMENT_IDS.map(id => ({
        id,
        label: CLIENT_INSIGHT_SEGMENT_LABELS[id],
        count: counts[id],
      })),
      attention: {
        total: numberValue(row.attention_total),
        items: attentionItems,
      },
    },
  };
}

export async function getClientInsightsDirectoryPage(
  input: Omit<ClientInsightsDirectoryQueryInput, 'now'> & { now?: Date },
): Promise<ClientInsightsDirectoryResult> {
  const now = input.now ?? new Date();
  const queryInput = { ...input, now };
  const rows = readRows(await db.execute(buildClientInsightsDirectoryQuery(queryInput)));
  const total = numberValue(rows[0]?.total);
  const clients = rows
    .filter(row => typeof row.client_id === 'string')
    .map((row): ClientInsightsDirectoryClient => ({
      id: String(row.client_id),
      phone: String(row.phone ?? ''),
      fullName: row.full_name == null ? null : String(row.full_name),
      email: row.email == null ? null : String(row.email),
      birthday: row.birthday == null ? null : String(row.birthday),
      archivedAt: dateValue(row.archived_at),
      mergedIntoClientId: row.merged_into_client_id == null
        ? null
        : String(row.merged_into_client_id),
      updatedAt: dateValue(row.updated_at) ?? now,
      preferredTechnician: row.preferred_technician_id == null
        ? null
        : {
            id: String(row.preferred_technician_id),
            name: String(row.technician_name ?? ''),
            avatarUrl: row.technician_avatar_url == null
              ? null
              : String(row.technician_avatar_url),
          },
      lastVisitAt: dateValue(row.last_completed_at),
      totalVisits: numberValue(row.cached_total_visits),
      totalSpent: numberValue(row.cached_total_spent),
      noShowCount: numberValue(row.no_show_count),
      loyaltyPoints: numberValue(row.loyalty_points),
      notes: row.notes == null ? null : String(row.notes),
      createdAt: dateValue(row.created_at) ?? now,
    }));

  return {
    clients,
    total,
    generatedAt: now,
    rulesVersion: CLIENT_INSIGHTS_RULES_VERSION,
  };
}
