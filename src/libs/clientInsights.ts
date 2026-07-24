import {
  type CommunicationSnapshot,
  isRetentionStageSuppressed,
  normalizeRetentionPhone,
  resolveRetentionStage,
  type RetentionAppointmentSnapshot,
} from '@/libs/retentionAssistant';
import {
  getDateKeyInTimeZone,
  getZonedDayBounds,
} from '@/libs/timeZone';
import {
  CLIENT_INSIGHT_SEGMENT_IDS,
  CLIENT_INSIGHT_SEGMENT_LABELS,
  type ClientInsightAttentionItem,
  type ClientInsightsData,
  type ClientInsightSegmentId,
} from '@/types/clientInsights';
import type { RetentionStage } from '@/types/retention';

export const CLIENT_INSIGHTS_RULES_VERSION = '2026-07-24';
export const CLIENT_INSIGHTS_ATTENTION_LIMIT = 12;

export type ClientInsightsClientSnapshot = {
  id: string;
  fullName: string | null;
  phone: string;
  email: string | null;
  rebookIntervalDays: number | null;
  isBlocked: boolean | null;
};

export type ClientInsightsAppointmentSnapshot = RetentionAppointmentSnapshot & {
  updatedAt: Date;
};

export type ClientOutstandingSnapshot = {
  salonClientId: string | null;
  clientPhone: string;
  completedOutstandingCents: number;
};

export type ClientInsightsSnapshotResult = {
  data: ClientInsightsData;
  clientIdsBySegment: Record<ClientInsightSegmentId, string[]>;
};

type ClientHistory = {
  completed: ClientInsightsAppointmentSnapshot[];
  cancelled: ClientInsightsAppointmentSnapshot[];
  hasFutureAppointment: boolean;
  hasInProgressAppointment: boolean;
  completedOutstandingCents: number;
};

const ATTENTION_PRIORITY: ClientInsightSegmentId[] = [
  'recent_cancellation',
  'overdue',
  'due_now',
  'due_soon',
  'first_time_no_return',
  'completed_outstanding',
  'inactive_90',
  'no_future_appointment',
  'not_seen_60',
  'not_seen_30',
];

function toEpochDay(dateKey: string): number {
  const [year = 0, month = 1, day = 1] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date((toEpochDay(dateKey) + days) * 86_400_000);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function daysBetween(earlierKey: string, laterKey: string): number {
  return toEpochDay(laterKey) - toEpochDay(earlierKey);
}

function emptySegmentMap(): Record<ClientInsightSegmentId, Set<string>> {
  return Object.fromEntries(
    CLIENT_INSIGHT_SEGMENT_IDS.map(id => [id, new Set<string>()]),
  ) as Record<ClientInsightSegmentId, Set<string>>;
}

function clientIdForAppointment(
  appointment: ClientInsightsAppointmentSnapshot,
  clientsById: Map<string, ClientInsightsClientSnapshot>,
  clientsByPhone: Map<string, ClientInsightsClientSnapshot>,
): string | null {
  if (appointment.salonClientId && clientsById.has(appointment.salonClientId)) {
    return appointment.salonClientId;
  }
  return clientsByPhone.get(normalizeRetentionPhone(appointment.clientPhone))?.id ?? null;
}

function clientIdForOutstanding(
  row: ClientOutstandingSnapshot,
  clientsById: Map<string, ClientInsightsClientSnapshot>,
  clientsByPhone: Map<string, ClientInsightsClientSnapshot>,
): string | null {
  if (row.salonClientId && clientsById.has(row.salonClientId)) {
    return row.salonClientId;
  }
  return clientsByPhone.get(normalizeRetentionPhone(row.clientPhone))?.id ?? null;
}

function firstByStart(
  appointments: ClientInsightsAppointmentSnapshot[],
): ClientInsightsAppointmentSnapshot | null {
  return appointments.reduce<ClientInsightsAppointmentSnapshot | null>(
    (first, appointment) =>
      !first || appointment.startTime < first.startTime ? appointment : first,
    null,
  );
}

function lastByStart(
  appointments: ClientInsightsAppointmentSnapshot[],
): ClientInsightsAppointmentSnapshot | null {
  return appointments.reduce<ClientInsightsAppointmentSnapshot | null>(
    (last, appointment) =>
      !last || appointment.startTime > last.startTime ? appointment : last,
    null,
  );
}

function addSegment(
  segments: Record<ClientInsightSegmentId, Set<string>>,
  segment: ClientInsightSegmentId,
  clientId: string,
): void {
  segments[segment].add(clientId);
}

export function buildClientInsightsSnapshot(args: {
  clients: ClientInsightsClientSnapshot[];
  appointments: ClientInsightsAppointmentSnapshot[];
  communications: CommunicationSnapshot[];
  outstanding: ClientOutstandingSnapshot[];
  defaultRebookDays: number;
  timeZone: string;
  now?: Date;
}): ClientInsightsSnapshotResult {
  const now = args.now ?? new Date();
  const todayKey = getDateKeyInTimeZone(now, args.timeZone);
  const currentMonth = todayKey.slice(0, 7);
  const clientsById = new Map(args.clients.map(client => [client.id, client]));
  const clientsByPhone = new Map(
    args.clients.map(client => [normalizeRetentionPhone(client.phone), client]),
  );
  const histories = new Map<string, ClientHistory>(
    args.clients.map(client => [client.id, {
      completed: [],
      cancelled: [],
      hasFutureAppointment: false,
      hasInProgressAppointment: false,
      completedOutstandingCents: 0,
    }]),
  );

  for (const appointment of args.appointments) {
    const clientId = clientIdForAppointment(appointment, clientsById, clientsByPhone);
    if (!clientId) {
      continue;
    }
    const history = histories.get(clientId)!;
    if (appointment.status === 'completed') {
      history.completed.push(appointment);
    } else if (appointment.status === 'cancelled') {
      history.cancelled.push(appointment);
    } else if (
      appointment.startTime > now
      && (appointment.status === 'pending' || appointment.status === 'confirmed')
    ) {
      history.hasFutureAppointment = true;
    } else if (appointment.status === 'in_progress') {
      history.hasInProgressAppointment = true;
    }
  }

  for (const row of args.outstanding) {
    const clientId = clientIdForOutstanding(row, clientsById, clientsByPhone);
    if (!clientId || row.completedOutstandingCents <= 0) {
      continue;
    }
    histories.get(clientId)!.completedOutstandingCents
      += row.completedOutstandingCents;
  }

  const segments = emptySegmentMap();
  const attentionItems: ClientInsightAttentionItem[] = [];

  for (const client of args.clients) {
    const history = histories.get(client.id)!;
    const firstCompleted = firstByStart(history.completed);
    const lastCompleted = lastByStart(history.completed);
    const hasFuture = history.hasFutureAppointment;
    const outreachBlocked = Boolean(client.isBlocked)
      || hasFuture
      || history.hasInProgressAppointment;
    const reasonSet = new Set<ClientInsightSegmentId>();
    let expectedReturnAt: string | null = null;
    let daysUntilExpected: number | null = null;
    let daysSinceLastVisit: number | null = null;
    let outreachStage: RetentionStage | null = null;
    let retentionSuppressed = false;

    if (lastCompleted) {
      const lastVisitKey = getDateKeyInTimeZone(lastCompleted.startTime, args.timeZone);
      daysSinceLastVisit = daysBetween(lastVisitKey, todayKey);
      const interval = client.rebookIntervalDays ?? args.defaultRebookDays;
      const expectedKey = addCalendarDays(lastVisitKey, interval);
      daysUntilExpected = daysBetween(todayKey, expectedKey);
      expectedReturnAt = getZonedDayBounds(expectedKey, args.timeZone)
        .startOfDay
        .toISOString();

      // Client Insights owns salon-local calendar due bands. Marketing's
      // elapsed-time resolver still owns campaign-stage escalation. On the
      // first local due day, before the exact visit hour has elapsed, the
      // intended first stage is rebook.
      outreachStage = resolveRetentionStage({
        lastVisitAt: lastCompleted.startTime,
        now,
        rebookIntervalDays: client.rebookIntervalDays,
        defaultRebookDays: args.defaultRebookDays,
      })?.stage ?? (
        daysUntilExpected <= 7
          ? 'rebook'
          : null
      );
      retentionSuppressed = outreachStage
        ? isRetentionStageSuppressed({
          communications: args.communications,
          clientId: client.id,
          stage: outreachStage,
          lastVisitAt: lastCompleted.startTime,
          now,
        })
        : false;
    }

    if (
      hasFuture
      || (daysSinceLastVisit != null && daysSinceLastVisit >= 0 && daysSinceLastVisit < 90)
    ) {
      addSegment(segments, 'active', client.id);
    }

    if (
      firstCompleted
      && getDateKeyInTimeZone(firstCompleted.startTime, args.timeZone)
        .startsWith(currentMonth)
    ) {
      addSegment(segments, 'new_this_month', client.id);
    }

    if (hasFuture) {
      addSegment(segments, 'rebooked', client.id);
    }

    if (!outreachBlocked && lastCompleted) {
      addSegment(segments, 'no_future_appointment', client.id);
      reasonSet.add('no_future_appointment');

      if (daysSinceLastVisit != null && daysSinceLastVisit >= 30) {
        addSegment(segments, 'not_seen_30', client.id);
        reasonSet.add('not_seen_30');
      }
      if (daysSinceLastVisit != null && daysSinceLastVisit >= 60) {
        addSegment(segments, 'not_seen_60', client.id);
        reasonSet.add('not_seen_60');
      }
      if (daysSinceLastVisit != null && daysSinceLastVisit >= 90) {
        addSegment(segments, 'inactive_90', client.id);
        reasonSet.add('inactive_90');
      }

      if (
        history.completed.length === 1
        && daysSinceLastVisit != null
        && daysSinceLastVisit >= 28
      ) {
        addSegment(segments, 'first_time_no_return', client.id);
        reasonSet.add('first_time_no_return');
      }

      if (
        daysUntilExpected != null
        && daysUntilExpected >= 1
        && daysUntilExpected <= 7
        && !retentionSuppressed
      ) {
        addSegment(segments, 'due_soon', client.id);
        addSegment(segments, 'due_to_return', client.id);
        addSegment(segments, 'needs_rebooking', client.id);
        reasonSet.add('due_soon');
      } else if (
        daysUntilExpected != null
        && daysUntilExpected <= 0
        && daysUntilExpected >= -7
        && !retentionSuppressed
      ) {
        addSegment(segments, 'due_now', client.id);
        addSegment(segments, 'due_to_return', client.id);
        addSegment(segments, 'needs_rebooking', client.id);
        reasonSet.add('due_now');
      } else if (
        daysUntilExpected != null
        && daysUntilExpected < -7
        && !retentionSuppressed
      ) {
        addSegment(segments, 'overdue', client.id);
        addSegment(segments, 'needs_rebooking', client.id);
        reasonSet.add('overdue');
      }
    }

    if (!client.isBlocked && history.completedOutstandingCents > 0) {
      addSegment(segments, 'completed_outstanding', client.id);
      reasonSet.add('completed_outstanding');
    }

    if (!outreachBlocked && history.cancelled.length > 0) {
      const recentCancellation = history.cancelled.some((appointment) => {
        const cancellationKey = getDateKeyInTimeZone(appointment.updatedAt, args.timeZone);
        const cancellationAge = daysBetween(cancellationKey, todayKey);
        const laterCompleted = history.completed.some(
          completed => completed.startTime > appointment.updatedAt,
        );
        return cancellationAge >= 0 && cancellationAge <= 14 && !laterCompleted;
      });
      if (recentCancellation) {
        addSegment(segments, 'recent_cancellation', client.id);
        reasonSet.add('recent_cancellation');
      }
    }

    const reasons = ATTENTION_PRIORITY.filter(reason => reasonSet.has(reason));
    if (reasons.length > 0) {
      attentionItems.push({
        clientId: client.id,
        clientName: client.fullName,
        phone: client.phone,
        email: client.email,
        primaryReason: reasons[0]!,
        reasons,
        lastVisitAt: lastCompleted?.startTime.toISOString() ?? null,
        expectedReturnAt,
        completedOutstandingCents: history.completedOutstandingCents,
        outreachStage: reasons.some(reason =>
          ['due_soon', 'due_now', 'overdue'].includes(reason))
          ? outreachStage
          : null,
      });
    }
  }

  attentionItems.sort((left, right) => {
    const priority = ATTENTION_PRIORITY.indexOf(left.primaryReason)
      - ATTENTION_PRIORITY.indexOf(right.primaryReason);
    if (priority !== 0) {
      return priority;
    }
    const leftDue = left.expectedReturnAt
      ? new Date(left.expectedReturnAt).getTime()
      : Number.POSITIVE_INFINITY;
    const rightDue = right.expectedReturnAt
      ? new Date(right.expectedReturnAt).getTime()
      : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }
    return (left.clientName ?? '').localeCompare(right.clientName ?? '');
  });

  const counts = Object.fromEntries(
    CLIENT_INSIGHT_SEGMENT_IDS.map(id => [id, segments[id].size]),
  ) as Record<ClientInsightSegmentId, number>;
  const clientIdsBySegment = Object.fromEntries(
    CLIENT_INSIGHT_SEGMENT_IDS.map(id => [id, [...segments[id]]]),
  ) as Record<ClientInsightSegmentId, string[]>;

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
        total: attentionItems.length,
        items: attentionItems.slice(0, CLIENT_INSIGHTS_ATTENTION_LIMIT),
      },
    },
    clientIdsBySegment,
  };
}
