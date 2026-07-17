import { describe, expect, it } from 'vitest';

import type { RetentionPromotionSettings } from '@/types/retention';

import {
  buildAppointmentReminderQueue,
  buildRetentionQueue,
  canTransitionCommunicationStatus,
  communicationMutationSchema,
  DEFAULT_RETENTION_SETTINGS,
  getReminderSnoozedUntil,
  getSnoozedUntil,
  mergeRetentionSettings,
  resolveRetentionStage,
  retentionSettingsPatchSchema,
  retentionSettingsSchema,
  sanitizeCommunicationMessageSnapshot,
} from './retentionAssistant';

const NOW = new Date('2026-07-17T16:00:00.000Z');
const DAY_MS = 86_400_000;

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    id: 'client_1',
    fullName: 'Bob',
    phone: '4373705050',
    lastVisitAt: daysAgo(21),
    rebookIntervalDays: null,
    isBlocked: false,
    ...overrides,
  };
}

describe('retention stage resolution', () => {
  it('uses the salon default and per-client rebooking override before win-back stages', () => {
    expect(resolveRetentionStage({ lastVisitAt: daysAgo(20), now: NOW })).toBeNull();
    expect(resolveRetentionStage({ lastVisitAt: daysAgo(21), now: NOW })?.stage).toBe('rebook');
    expect(resolveRetentionStage({
      lastVisitAt: daysAgo(14),
      now: NOW,
      rebookIntervalDays: 14,
    })).toMatchObject({ stage: 'rebook', rebookIntervalDays: 14 });
  });

  it('escalates to exactly one six- or eight-week stage', () => {
    expect(resolveRetentionStage({ lastVisitAt: daysAgo(42), now: NOW })?.stage).toBe('promo_6w');
    expect(resolveRetentionStage({ lastVisitAt: daysAgo(55), now: NOW })?.stage).toBe('promo_6w');
    expect(resolveRetentionStage({ lastVisitAt: daysAgo(56), now: NOW })?.stage).toBe('promo_8w');
  });

  it('measures elapsed time, not calendar days, so timezone and DST shifts cannot skew a stage', () => {
    // Intended semantics: a stage begins exactly N*24h after the last visit
    // instant, regardless of the salon's timezone or the wall-clock date.
    const justUnder = new Date(NOW.getTime() - (21 * DAY_MS - 60_000));

    expect(resolveRetentionStage({ lastVisitAt: justUnder, now: NOW })).toBeNull();

    const justOver = new Date(NOW.getTime() - (21 * DAY_MS + 60_000));

    expect(resolveRetentionStage({ lastVisitAt: justOver, now: NOW })?.stage).toBe('rebook');

    // A window that spans the 2026-11-01 North-American fall-back (an extra
    // wall-clock hour) still flips exactly at 42*24h of elapsed time.
    const dstNow = new Date('2026-11-15T16:00:00.000Z');
    const acrossDstJustUnder = new Date(dstNow.getTime() - (42 * DAY_MS - 60_000));
    const acrossDstJustOver = new Date(dstNow.getTime() - (42 * DAY_MS + 60_000));

    expect(resolveRetentionStage({ lastVisitAt: acrossDstJustUnder, now: dstNow })?.stage).toBe('rebook');
    expect(resolveRetentionStage({ lastVisitAt: acrossDstJustOver, now: dstNow })?.stage).toBe('promo_6w');
  });
});

describe('retention queue', () => {
  it('suppresses blocked clients and clients with future appointments', () => {
    const queue = buildRetentionQueue({
      clients: [
        client({ id: 'blocked', isBlocked: true }),
        client({ id: 'booked' }),
        client({ id: 'due' }),
      ],
      futureAppointments: [{
        id: 'appointment_1',
        salonClientId: 'booked',
        clientName: 'Booked',
        clientPhone: '4161111111',
        startTime: new Date(NOW.getTime() + DAY_MS),
        endTime: new Date(NOW.getTime() + DAY_MS + 3_600_000),
        status: 'confirmed',
      }],
      communications: [],
      now: NOW,
    });

    expect(queue.map(item => item.clientId)).toEqual(['due']);
  });

  it('suppresses clients whose appointment is in progress, even one started early or running late', () => {
    const queue = buildRetentionQueue({
      clients: [
        client({ id: 'started_early' }),
        client({ id: 'running_late' }),
        client({ id: 'due' }),
      ],
      futureAppointments: [
        {
          // Tech tapped Start ahead of the scheduled time: startTime is
          // still in the future but the client is in the chair right now.
          id: 'appointment_early',
          salonClientId: 'started_early',
          clientName: 'Early',
          clientPhone: '4162222222',
          startTime: new Date(NOW.getTime() + 3_600_000),
          endTime: new Date(NOW.getTime() + 2 * 3_600_000),
          status: 'in_progress',
        },
        {
          // Visit running past its scheduled slot: startTime already passed.
          id: 'appointment_late',
          salonClientId: 'running_late',
          clientName: 'Late',
          clientPhone: '4163333333',
          startTime: new Date(NOW.getTime() - 3_600_000),
          endTime: new Date(NOW.getTime() - 1_800_000),
          status: 'in_progress',
        },
      ],
      communications: [],
      now: NOW,
    });

    expect(queue.map(item => item.clientId)).toEqual(['due']);
  });

  it('suppresses legacy future appointments by normalized phone when salonClientId is missing', () => {
    const queue = buildRetentionQueue({
      clients: [client({ phone: '(437) 370-5050' })],
      futureAppointments: [{
        id: 'legacy_appointment',
        salonClientId: null,
        clientName: 'Bob',
        clientPhone: '+1 437-370-5050',
        startTime: new Date(NOW.getTime() + DAY_MS),
        endTime: new Date(NOW.getTime() + DAY_MS + 3_600_000),
        status: 'confirmed',
      }],
      communications: [],
      now: NOW,
    });

    expect(queue).toEqual([]);
  });

  it('suppresses the current stage after marked sent but permits later escalation', () => {
    const currentStage = buildRetentionQueue({
      clients: [client()],
      futureAppointments: [],
      communications: [{
        id: 'comm_1',
        salonClientId: 'client_1',
        appointmentId: null,
        kind: 'rebook',
        status: 'marked_sent',
        snoozedUntil: null,
        createdAt: daysAgo(1),
      }],
      now: NOW,
    });

    expect(currentStage).toEqual([]);

    const escalated = buildRetentionQueue({
      clients: [client({ lastVisitAt: daysAgo(42) })],
      futureAppointments: [],
      communications: [{
        id: 'comm_1',
        salonClientId: 'client_1',
        appointmentId: null,
        kind: 'rebook',
        status: 'marked_sent',
        snoozedUntil: null,
        createdAt: daysAgo(20),
      }],
      now: NOW,
    });

    expect(escalated).toHaveLength(1);
    expect(escalated[0]?.stage).toBe('promo_6w');
  });

  it.each([
    { daysSinceVisit: 21, stage: 'rebook' as const },
    { daysSinceVisit: 42, stage: 'promo_6w' as const },
    { daysSinceVisit: 56, stage: 'promo_8w' as const },
  ])('starts a new $stage outreach cycle after a newer completed visit', ({ daysSinceVisit, stage }) => {
    const lastVisitAt = daysAgo(daysSinceVisit);
    const queue = buildRetentionQueue({
      clients: [client({ lastVisitAt })],
      futureAppointments: [],
      communications: [{
        id: `old_${stage}`,
        salonClientId: 'client_1',
        appointmentId: null,
        kind: stage,
        status: 'marked_sent',
        snoozedUntil: null,
        createdAt: new Date(lastVisitAt.getTime() - DAY_MS),
      }],
      now: NOW,
    });

    expect(queue).toEqual([
      expect.objectContaining({ clientId: 'client_1', stage }),
    ]);
  });

  it('honors a seven-day snooze and restores the alert after it expires', () => {
    expect(getSnoozedUntil(NOW).toISOString()).toBe('2026-07-24T16:00:00.000Z');

    const base = {
      clients: [client()],
      futureAppointments: [],
      communications: [{
        id: 'comm_1',
        salonClientId: 'client_1',
        appointmentId: null,
        kind: 'rebook' as const,
        status: 'snoozed' as const,
        snoozedUntil: new Date('2026-07-18T16:00:00.000Z'),
        createdAt: daysAgo(1),
      }],
    };

    expect(buildRetentionQueue({ ...base, now: NOW })).toEqual([]);
    expect(buildRetentionQueue({ ...base, now: new Date('2026-07-19T16:00:00.000Z') })).toHaveLength(1);
  });
});

describe('appointment reminders', () => {
  const appointment = {
    id: 'appointment_1',
    salonClientId: 'new_client',
    clientName: 'New Client',
    clientPhone: '4165551111',
    startTime: new Date('2026-07-18T15:00:00.000Z'),
    endTime: new Date('2026-07-18T16:00:00.000Z'),
    status: 'confirmed',
  };

  it('snoozes for three hours without ever crossing appointment start', () => {
    expect(getReminderSnoozedUntil(
      NOW,
      new Date('2026-07-17T23:00:00.000Z'),
    ).toISOString()).toBe('2026-07-17T19:00:00.000Z');

    expect(getReminderSnoozedUntil(
      NOW,
      new Date('2026-07-17T18:00:00.000Z'),
    ).toISOString()).toBe('2026-07-17T17:59:59.999Z');
  });

  it('includes first-time clients even when they have no completed visit', () => {
    const queue = buildAppointmentReminderQueue({
      clients: [client({ id: 'new_client', lastVisitAt: null })],
      appointments: [appointment],
      communications: [],
      reminderLeadHours: 24,
      now: NOW,
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      appointmentId: 'appointment_1',
      clientId: 'new_client',
    });
  });

  it('resolves legacy appointments to their client by normalized phone', () => {
    const queue = buildAppointmentReminderQueue({
      clients: [client({
        id: 'new_client',
        phone: '(416) 555-1111',
        lastVisitAt: null,
      })],
      appointments: [{
        ...appointment,
        salonClientId: null,
        clientPhone: '+1 416-555-1111',
      }],
      communications: [],
      reminderLeadHours: 24,
      now: NOW,
    });

    expect(queue).toEqual([
      expect.objectContaining({ appointmentId: 'appointment_1', clientId: 'new_client' }),
    ]);
  });

  it('suppresses automated, marked-sent, and actively snoozed reminders', () => {
    expect(buildAppointmentReminderQueue({
      clients: [client({ id: 'new_client', lastVisitAt: null })],
      appointments: [{ ...appointment, reminderSentAt: NOW }],
      communications: [],
      now: NOW,
    })).toEqual([]);

    expect(buildAppointmentReminderQueue({
      clients: [client({ id: 'new_client', lastVisitAt: null })],
      appointments: [appointment],
      communications: [{
        id: 'comm_1',
        salonClientId: 'new_client',
        appointmentId: 'appointment_1',
        kind: 'reminder',
        status: 'marked_sent',
        snoozedUntil: null,
        createdAt: NOW,
      }],
      now: NOW,
    })).toEqual([]);
  });
});

describe('retention settings and communication transitions', () => {
  it('accepts reminder-hour snoozes but rejects seven-day reminder snoozes', () => {
    const reminder = {
      salonSlug: 'isla',
      clientId: 'client_1',
      appointmentId: 'appointment_1',
      kind: 'reminder' as const,
      status: 'snoozed' as const,
    };

    expect(communicationMutationSchema.safeParse({
      ...reminder,
      snoozeHours: 3,
    }).success).toBe(true);
    expect(communicationMutationSchema.safeParse({
      ...reminder,
      snoozeDays: 7,
    }).success).toBe(false);
    expect(communicationMutationSchema.safeParse({
      ...reminder,
      kind: 'rebook',
      appointmentId: undefined,
      snoozeHours: 3,
    }).success).toBe(false);
  });

  it('redacts bearer tokens before communication copy is persisted', () => {
    expect(sanitizeCommunicationMessageSnapshot(
      'Manage: https://example.com/en/salon/manage/secret_ABC-123 Offer: https://example.com/book?campaign=opaque_token-1',
    )).toBe(
      'Manage: https://example.com/en/salon/manage/[redacted] Offer: https://example.com/book?campaign=[redacted]',
    );
    expect(sanitizeCommunicationMessageSnapshot('See you tomorrow!')).toBe('See you tomorrow!');
  });

  it('validates HTTPS review links and enabled campaign requirements', () => {
    expect(retentionSettingsPatchSchema.safeParse({ googleReviewUrl: 'http://example.com/review' }).success).toBe(false);
    expect(retentionSettingsSchema.safeParse({
      ...DEFAULT_RETENTION_SETTINGS,
      sixWeekPromotion: {
        ...DEFAULT_RETENTION_SETTINGS.sixWeekPromotion,
        enabled: true,
        value: 10,
        messageTemplate: 'No link here',
      },
    }).success).toBe(false);
  });

  it('rejects mixed discount types when both win-back promotions are enabled', () => {
    expect(retentionSettingsSchema.safeParse({
      ...DEFAULT_RETENTION_SETTINGS,
      sixWeekPromotion: {
        ...DEFAULT_RETENTION_SETTINGS.sixWeekPromotion,
        enabled: true,
        value: 15,
      },
      eightWeekPromotion: {
        ...DEFAULT_RETENTION_SETTINGS.eightWeekPromotion,
        enabled: true,
        discountType: 'fixed',
        value: 2000,
      },
    }).success).toBe(false);
  });

  it('merges partial promotion settings without dropping existing fields', () => {
    const currentPromotion: RetentionPromotionSettings = {
      ...DEFAULT_RETENTION_SETTINGS.sixWeekPromotion,
      name: 'Welcome back',
      eligibleServiceIds: ['service_1'],
    };
    const settings = mergeRetentionSettings({
      ...DEFAULT_RETENTION_SETTINGS,
      sixWeekPromotion: currentPromotion,
    }, {
      sixWeekPromotion: { expiryDays: 30 },
    });

    expect(settings.sixWeekPromotion).toMatchObject({
      name: 'Welcome back',
      expiryDays: 30,
      eligibleServiceIds: ['service_1'],
    });
  });

  it('keeps sent/dismissed/converted states terminal except sent-to-converted attribution', () => {
    expect(canTransitionCommunicationStatus('prepared', 'snoozed')).toBe(true);
    expect(canTransitionCommunicationStatus('marked_sent', 'converted')).toBe(true);
    expect(canTransitionCommunicationStatus('marked_sent', 'prepared')).toBe(false);
    expect(canTransitionCommunicationStatus('dismissed', 'prepared')).toBe(false);
    expect(canTransitionCommunicationStatus('converted', 'marked_sent')).toBe(false);
  });
});
