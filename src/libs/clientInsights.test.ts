import { describe, expect, it } from 'vitest';

import {
  buildClientInsightsSnapshot,
  type ClientInsightsAppointmentSnapshot,
  type ClientInsightsClientSnapshot,
} from '@/libs/clientInsights';
import type { CommunicationSnapshot } from '@/libs/retentionAssistant';
import type { ClientInsightSegmentId } from '@/types/clientInsights';

const NOW = new Date('2026-07-15T16:00:00.000Z');
const TIME_ZONE = 'America/Toronto';

function client(
  id: string,
  overrides: Partial<ClientInsightsClientSnapshot> = {},
): ClientInsightsClientSnapshot {
  return {
    id,
    fullName: `Client ${id}`,
    phone: `41655501${id.padStart(2, '0')}`,
    email: `${id}@example.test`,
    rebookIntervalDays: 21,
    isBlocked: false,
    ...overrides,
  };
}

function appointment(
  id: string,
  clientId: string | null,
  status: string,
  startTime: string,
  overrides: Partial<ClientInsightsAppointmentSnapshot> = {},
): ClientInsightsAppointmentSnapshot {
  const start = new Date(startTime);
  return {
    id,
    salonClientId: clientId,
    clientName: clientId ? `Client ${clientId}` : 'Legacy client',
    clientPhone: clientId ? `41655501${clientId.padStart(2, '0')}` : '4165550199',
    startTime: start,
    endTime: new Date(start.getTime() + 3_600_000),
    status,
    updatedAt: start,
    ...overrides,
  };
}

function build(args: {
  clients: ClientInsightsClientSnapshot[];
  appointments?: ClientInsightsAppointmentSnapshot[];
  communications?: CommunicationSnapshot[];
  outstanding?: Array<{
    salonClientId: string | null;
    clientPhone: string;
    completedOutstandingCents: number;
  }>;
}) {
  return buildClientInsightsSnapshot({
    clients: args.clients,
    appointments: args.appointments ?? [],
    communications: args.communications ?? [],
    outstanding: args.outstanding ?? [],
    defaultRebookDays: 21,
    timeZone: TIME_ZONE,
    now: NOW,
  });
}

function ids(result: ReturnType<typeof build>, segment: ClientInsightSegmentId) {
  return result.clientIdsBySegment[segment];
}

describe('buildClientInsightsSnapshot', () => {
  it('uses first completed visits for new-this-month and salon-local lifecycle dates', () => {
    const result = build({
      clients: [client('1'), client('2'), client('3')],
      appointments: [
        appointment('old', '1', 'completed', '2026-06-30T23:30:00.000Z'),
        appointment('newer', '1', 'completed', '2026-07-10T15:00:00.000Z'),
        appointment('first-local-july', '2', 'completed', '2026-07-01T04:30:00.000Z'),
        appointment('first-local-june', '3', 'completed', '2026-07-01T03:30:00.000Z'),
      ],
    });

    expect(ids(result, 'new_this_month')).toEqual(['2']);
    expect(ids(result, 'active')).toEqual(['1', '2', '3']);
  });

  it('keeps due bands disjoint and makes Due to return equal due soon plus due now', () => {
    const result = build({
      clients: [client('1'), client('2'), client('3')],
      appointments: [
        appointment('due-soon', '1', 'completed', '2026-06-27T16:00:00.000Z'),
        appointment('due-now', '2', 'completed', '2026-06-24T16:00:00.000Z'),
        appointment('overdue', '3', 'completed', '2026-06-15T16:00:00.000Z'),
      ],
    });

    expect(ids(result, 'due_soon')).toEqual(['1']);
    expect(ids(result, 'due_now')).toEqual(['2']);
    expect(ids(result, 'overdue')).toEqual(['3']);
    expect(new Set(ids(result, 'due_to_return'))).toEqual(new Set(['1', '2']));
    expect(new Set(ids(result, 'needs_rebooking'))).toEqual(new Set(['1', '2', '3']));
  });

  it('uses salon-local due-day boundaries while sharing retention communication suppression', () => {
    const beforeOriginalVisitHour = new Date('2026-07-15T13:00:00.000Z');
    const dueTodayVisit = appointment(
      'due-today',
      '1',
      'completed',
      '2026-06-24T20:00:00.000Z',
    );

    const unsuppressed = buildClientInsightsSnapshot({
      clients: [client('1')],
      appointments: [dueTodayVisit],
      communications: [],
      outstanding: [],
      defaultRebookDays: 21,
      timeZone: TIME_ZONE,
      now: beforeOriginalVisitHour,
    });

    expect(ids(unsuppressed, 'due_now')).toEqual(['1']);
    expect(unsuppressed.data.attention.items[0]?.outreachStage).toBe('rebook');

    const suppressed = buildClientInsightsSnapshot({
      clients: [client('1')],
      appointments: [dueTodayVisit],
      communications: [{
        id: 'sent-this-cycle',
        salonClientId: '1',
        appointmentId: null,
        kind: 'rebook',
        status: 'marked_sent',
        snoozedUntil: null,
        createdAt: new Date('2026-07-10T16:00:00.000Z'),
      }],
      outstanding: [],
      defaultRebookDays: 21,
      timeZone: TIME_ZONE,
      now: beforeOriginalVisitHour,
    });

    expect(ids(suppressed, 'due_now')).toEqual([]);
  });

  it('suppresses blocked, future-booked, in-progress, snoozed, dismissed, sent, and converted outreach', () => {
    const clients = [
      client('1', { isBlocked: true }),
      client('2'),
      client('3'),
      client('4'),
      client('5'),
      client('6'),
      client('7'),
      client('8'),
    ];
    const completed = clients.map(entry =>
      appointment(`completed-${entry.id}`, entry.id, 'completed', '2026-06-01T16:00:00.000Z', {
        clientPhone: entry.phone,
      }));
    const communications: CommunicationSnapshot[] = (
      [
        ['4', 'snoozed'],
        ['5', 'dismissed'],
        ['6', 'marked_sent'],
        ['7', 'converted'],
      ] as const
    ).map(([clientId, status]) => ({
      id: `comm-${clientId}`,
      salonClientId: clientId,
      appointmentId: null,
      kind: 'promo_6w',
      status,
      snoozedUntil: status === 'snoozed'
        ? new Date('2026-07-20T16:00:00.000Z')
        : null,
      createdAt: new Date('2026-07-01T16:00:00.000Z'),
    }));

    const result = build({
      clients,
      appointments: [
        ...completed,
        appointment('future', '2', 'confirmed', '2026-07-20T16:00:00.000Z'),
        appointment('in-progress', '3', 'in_progress', '2026-07-15T15:00:00.000Z'),
      ],
      communications,
    });

    expect(ids(result, 'overdue')).toEqual(['8']);
    expect(ids(result, 'active')).toContain('2');
  });

  it('starts a new outreach cycle after a later completed visit', () => {
    const result = build({
      clients: [client('1')],
      appointments: [
        appointment('old', '1', 'completed', '2026-05-01T16:00:00.000Z'),
        appointment('latest', '1', 'completed', '2026-06-01T16:00:00.000Z'),
      ],
      communications: [{
        id: 'old-dismissal',
        salonClientId: '1',
        appointmentId: null,
        kind: 'promo_6w',
        status: 'dismissed',
        snoozedUntil: null,
        createdAt: new Date('2026-05-20T16:00:00.000Z'),
      }],
    });

    expect(ids(result, 'overdue')).toEqual(['1']);
  });

  it('uses normalized phone fallback only for legacy appointments without a stable client id', () => {
    const legacyClient = client('1', { phone: '4165550199' });
    const result = build({
      clients: [legacyClient],
      appointments: [
        appointment('legacy', null, 'completed', '2026-07-10T16:00:00.000Z', {
          clientPhone: '+1 (416) 555-0199',
        }),
      ],
    });

    expect(ids(result, 'active')).toEqual(['1']);
    expect(ids(result, 'no_future_appointment')).toEqual(['1']);
  });

  it('classifies first-time, cancellation, inactivity, and completed outstanding independently', () => {
    const result = build({
      clients: [client('1'), client('2')],
      appointments: [
        appointment('first', '1', 'completed', '2026-06-01T16:00:00.000Z'),
        appointment('cancelled', '1', 'cancelled', '2026-07-05T16:00:00.000Z', {
          updatedAt: new Date('2026-07-10T16:00:00.000Z'),
        }),
        appointment('inactive', '2', 'completed', '2026-03-01T16:00:00.000Z'),
      ],
      outstanding: [{
        salonClientId: '1',
        clientPhone: '4165550101',
        completedOutstandingCents: 2500,
      }],
    });

    expect(ids(result, 'first_time_no_return')).toEqual(['1', '2']);
    expect(ids(result, 'recent_cancellation')).toEqual(['1']);
    expect(ids(result, 'inactive_90')).toEqual(['2']);
    expect(ids(result, 'completed_outstanding')).toEqual(['1']);
    expect(result.data.attention.items[0]?.primaryReason).toBe('recent_cancellation');
  });
});
