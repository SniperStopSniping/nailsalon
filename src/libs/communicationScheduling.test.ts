import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  applyQuietHours,
  computeReminderInstant,
  computeSchedulingRevision,
  confirmationDedupeKey,
  isWithinQuietHours,
  planReminders,
  QUIET_HOURS_STALE,
  reminderDedupeKey,
  resolveNotAfter,
} = await import('./communicationScheduling');
const { DEFAULT_REMINDER_RULE_ID } = await import('./communicationSettings');

const TZ = 'America/Toronto';

/**
 * America/Toronto 2026 transitions:
 *   spring forward — Sun Mar 8, 02:00 EST becomes 03:00 EDT (02:00-02:59 local
 *                    does not exist); offset -5 => -4
 *   fall back      — Sun Nov 1, 02:00 EDT becomes 01:00 EST (01:00-01:59 local
 *                    occurs twice); offset -4 => -5
 */
const QUIET_DEFAULT = { enabled: true, start: '21:00', end: '09:00' } as const;
const QUIET_OFF = { enabled: false, start: '21:00', end: '09:00' } as const;

const rule = (over: Partial<{ id: string; offsetMinutes: number; channels: 'sms' | 'email' | 'both'; enabled: boolean }> = {}) => ({
  id: DEFAULT_REMINDER_RULE_ID,
  offsetMinutes: 1440,
  channels: 'both' as const,
  enabled: true,
  ...over,
});

describe('computeReminderInstant — absolute, therefore DST-immune', () => {
  it('subtracts real elapsed time across a spring-forward boundary', () => {
    // Appointment Sun Mar 8 2026 12:00 EDT (16:00Z). The 24h reminder must be
    // exactly 24h of REAL time earlier, which is Sat Mar 7 11:00 EST — a
    // DIFFERENT local wall time, because an hour was skipped in between. That
    // is the correct meaning of "remind me 24 hours before".
    const start = new Date('2026-03-08T16:00:00.000Z');
    const at = computeReminderInstant(start, 1440);

    expect(at.toISOString()).toBe('2026-03-07T16:00:00.000Z');
    expect(start.getTime() - at.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('subtracts real elapsed time across a fall-back boundary', () => {
    const start = new Date('2026-11-01T16:00:00.000Z');
    const at = computeReminderInstant(start, 1440);

    expect(at.toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(start.getTime() - at.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('isWithinQuietHours — wrapping window', () => {
  it.each([
    // [instantZ, localDescription, expected]
    ['2026-08-20T02:00:00.000Z', 'Aug 19 22:00 EDT — evening head', true],
    ['2026-08-20T07:00:00.000Z', 'Aug 20 03:00 EDT — pre-dawn tail', true],
    ['2026-08-20T18:00:00.000Z', 'Aug 20 14:00 EDT — midday', false],
    ['2026-08-20T13:00:00.000Z', 'Aug 20 09:00 EDT — exactly the end bound', false],
    ['2026-08-20T01:00:00.000Z', 'Aug 19 21:00 EDT — exactly the start bound', true],
  ])('%s (%s) => %s', (instantZ, _label, expected) => {
    expect(isWithinQuietHours(new Date(instantZ), QUIET_DEFAULT, TZ)).toBe(expected);
  });

  it('is never quiet when disabled', () => {
    expect(isWithinQuietHours(new Date('2026-08-20T02:00:00.000Z'), QUIET_OFF, TZ)).toBe(false);
  });

  it('handles a non-wrapping window (daytime quiet hours)', () => {
    const daytime = { enabled: true, start: '09:00', end: '17:00' };

    // Aug 20 14:00 EDT is inside 09:00-17:00.
    expect(isWithinQuietHours(new Date('2026-08-20T18:00:00.000Z'), daytime, TZ)).toBe(true);
    // Aug 19 22:00 EDT is outside it.
    expect(isWithinQuietHours(new Date('2026-08-20T02:00:00.000Z'), daytime, TZ)).toBe(false);
  });
});

describe('applyQuietHours', () => {
  const farFuture = new Date('2027-01-01T00:00:00.000Z');

  it('shifts an evening instant to the NEXT local 09:00', () => {
    // Aug 19 22:00 EDT -> Aug 20 09:00 EDT == 13:00Z
    const decision = applyQuietHours({
      instant: new Date('2026-08-20T02:00:00.000Z'),
      quietHours: QUIET_DEFAULT,
      timeZone: TZ,
      notAfter: farFuture,
    });

    expect(decision.kind).toBe('shifted');
    expect(decision.kind === 'shifted' && decision.sendAt.toISOString())
      .toBe('2026-08-20T13:00:00.000Z');
  });

  it('shifts a pre-dawn instant to the SAME local day 09:00', () => {
    // Aug 20 03:00 EDT -> Aug 20 09:00 EDT == 13:00Z
    const decision = applyQuietHours({
      instant: new Date('2026-08-20T07:00:00.000Z'),
      quietHours: QUIET_DEFAULT,
      timeZone: TZ,
      notAfter: farFuture,
    });

    expect(decision.kind === 'shifted' && decision.sendAt.toISOString())
      .toBe('2026-08-20T13:00:00.000Z');
  });

  it('leaves an instant outside quiet hours untouched', () => {
    const instant = new Date('2026-08-20T18:00:00.000Z');
    const decision = applyQuietHours({
      instant,
      quietHours: QUIET_DEFAULT,
      timeZone: TZ,
      notAfter: farFuture,
    });

    expect(decision).toEqual({ kind: 'unchanged', sendAt: instant });
  });

  it('bypasses entirely for client-triggered confirmations (§11.4)', () => {
    const instant = new Date('2026-08-20T02:00:00.000Z');
    const decision = applyQuietHours({
      instant,
      quietHours: QUIET_DEFAULT,
      timeZone: TZ,
      notAfter: farFuture,
      bypass: true,
    });

    expect(decision).toEqual({ kind: 'unchanged', sendAt: instant });
  });

  it('expires as stale when the shift would land past notAfter', () => {
    // Quiet at Aug 19 22:00 EDT; the appointment starts before the next 09:00,
    // so a shifted reminder would arrive after the appointment began.
    const decision = applyQuietHours({
      instant: new Date('2026-08-20T02:00:00.000Z'),
      quietHours: QUIET_DEFAULT,
      timeZone: TZ,
      notAfter: new Date('2026-08-20T11:00:00.000Z'),
    });

    expect(decision).toEqual({ kind: 'stale', reason: QUIET_HOURS_STALE });
  });

  it('expires as stale when already past notAfter without shifting', () => {
    const decision = applyQuietHours({
      instant: new Date('2026-08-20T18:00:00.000Z'),
      quietHours: QUIET_DEFAULT,
      timeZone: TZ,
      notAfter: new Date('2026-08-20T17:00:00.000Z'),
    });

    expect(decision).toEqual({ kind: 'stale', reason: QUIET_HOURS_STALE });
  });

  it('shifts correctly across spring forward (the shifted target is real time, not +N minutes)', () => {
    // Sat Mar 7 2026 23:00 EST == 2026-03-08T04:00Z, inside quiet hours.
    // Target is Sun Mar 8 09:00 EDT == 2026-03-08T13:00Z. Note the elapsed gap
    // is 9h, not the 10h a naive wall-clock difference would suggest, because
    // the 02:00 hour does not exist that day.
    const instant = new Date('2026-03-08T04:00:00.000Z');
    const decision = applyQuietHours({
      instant,
      quietHours: QUIET_DEFAULT,
      timeZone: TZ,
      notAfter: farFuture,
    });

    expect(decision.kind === 'shifted' && decision.sendAt.toISOString())
      .toBe('2026-03-08T13:00:00.000Z');
    expect(decision.kind === 'shifted'
      && decision.sendAt.getTime() - instant.getTime()).toBe(9 * 60 * 60 * 1000);
  });

  it('shifts correctly across fall back', () => {
    // Sat Oct 31 2026 23:00 EDT == 2026-11-01T03:00Z, inside quiet hours.
    // Target Sun Nov 1 09:00 EST == 2026-11-01T14:00Z — 11h elapsed, because an
    // hour repeats that day.
    const instant = new Date('2026-11-01T03:00:00.000Z');
    const decision = applyQuietHours({
      instant,
      quietHours: QUIET_DEFAULT,
      timeZone: TZ,
      notAfter: farFuture,
    });

    expect(decision.kind === 'shifted' && decision.sendAt.toISOString())
      .toBe('2026-11-01T14:00:00.000Z');
    expect(decision.kind === 'shifted'
      && decision.sendAt.getTime() - instant.getTime()).toBe(11 * 60 * 60 * 1000);
  });

  it('degrades to stale rather than scheduling backwards for a nonexistent quiet-hours end', () => {
    // DOCUMENTED REPO BEHAVIOR, pinned deliberately.
    //
    // `zonedTimeToUtc` resolves a nonexistent local wall time (02:00-02:59 on
    // spring-forward day) BACKWARD to just before the gap, not forward past it.
    // A salon whose quiet-hours end lands in the gap would therefore compute a
    // shift target earlier than the instant being shifted. applyQuietHours
    // refuses to schedule backwards and expires the intent instead, so the
    // worst case is a reminder that is never sent — never one sent at 01:30.
    const decision = applyQuietHours({
      instant: new Date('2026-03-08T06:45:00.000Z'), // Mar 8 01:45 EST, quiet
      quietHours: { enabled: true, start: '21:00', end: '02:30' },
      timeZone: TZ,
      notAfter: farFuture,
    });

    expect(decision).toEqual({ kind: 'stale', reason: QUIET_HOURS_STALE });
  });
});

describe('resolveNotAfter', () => {
  const start = new Date('2026-08-20T18:00:00.000Z');
  const enqueuedAt = new Date('2026-08-18T12:00:00.000Z');

  it.each(['appointment_reminder', 'booking_confirmation', 'balance_reminder', 'manual_reminder'] as const)(
    '%s expires at appointment start — a late one is spam, not a reminder',
    (eventType) => {
      expect(resolveNotAfter({ eventType, appointmentStart: start, enqueuedAt }))
        .toEqual(start);
    },
  );

  it.each(['appointment_cancelled', 'appointment_rescheduled', 'owner_new_booking', 'deposit_received'] as const)(
    '%s expires 24h after enqueue',
    (eventType) => {
      expect(resolveNotAfter({ eventType, appointmentStart: start, enqueuedAt }).toISOString())
        .toBe('2026-08-19T12:00:00.000Z');
    },
  );

  it('falls back to enqueue+24h when there is no appointment', () => {
    expect(resolveNotAfter({
      eventType: 'appointment_reminder',
      appointmentStart: null,
      enqueuedAt,
    }).toISOString()).toBe('2026-08-19T12:00:00.000Z');
  });
});

describe('computeSchedulingRevision', () => {
  const base = {
    timeZone: TZ,
    quietHours: QUIET_DEFAULT,
    rule: rule(),
    appointmentStart: new Date('2026-08-20T18:00:00.000Z'),
    appointmentUpdatedAt: new Date('2026-08-18T12:00:00.000Z'),
    smsEnabled: true,
    emailEnabled: true,
  };

  it('is deterministic and 16 hex chars', () => {
    const a = computeSchedulingRevision(base);

    expect(a).toBe(computeSchedulingRevision(base));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it.each([
    ['timezone', { timeZone: 'America/Vancouver' }],
    ['quiet hours', { quietHours: { enabled: true, start: '22:00', end: '08:00' } }],
    ['quiet hours disabled', { quietHours: QUIET_OFF }],
    ['rule offset', { rule: rule({ offsetMinutes: 120 }) }],
    ['rule channels', { rule: rule({ channels: 'sms' as const }) }],
    ['rule id', { rule: rule({ id: 'crule_other' }) }],
    ['appointment start', { appointmentStart: new Date('2026-08-20T19:00:00.000Z') }],
    ['appointment updatedAt', { appointmentUpdatedAt: new Date('2026-08-18T12:00:01.000Z') }],
    ['sms enabled', { smsEnabled: false }],
    ['email enabled', { emailEnabled: false }],
  ])('changes when %s changes', (_label, patch) => {
    expect(computeSchedulingRevision({ ...base, ...patch }))
      .not.toBe(computeSchedulingRevision(base));
  });

  it('changing appointment updatedAt is what makes reschedule-back-to-original safe', () => {
    // The dedupe unique index has no status predicate, so the canceled T1 intent
    // holds key K(T1) forever. Rescheduling T1 -> T2 -> T1 must NOT recompute
    // K(T1), or ON CONFLICT DO NOTHING silently drops the new reminder.
    const atT1 = computeSchedulingRevision(base);
    const backToT1 = computeSchedulingRevision({
      ...base,
      appointmentUpdatedAt: new Date('2026-08-18T12:05:00.000Z'),
    });

    expect(backToT1).not.toBe(atT1);
  });
});

describe('dedupe identities', () => {
  it('embeds the salon id, because dedupe_key is globally unique', () => {
    const key = reminderDedupeKey({
      salonId: 'salon_a',
      appointmentId: 'appt_1',
      ruleId: DEFAULT_REMINDER_RULE_ID,
      channel: 'sms',
      schedulingRevision: 'deadbeefdeadbeef',
    });

    expect(key).toBe(`salon_a:appt_1:${DEFAULT_REMINDER_RULE_ID}:sms:deadbeefdeadbeef`);
    expect(key.startsWith('salon_a:')).toBe(true);
  });

  it('separates two salons that share every other component', () => {
    const shared = {
      appointmentId: 'appt_1',
      ruleId: DEFAULT_REMINDER_RULE_ID,
      channel: 'sms' as const,
      schedulingRevision: 'deadbeefdeadbeef',
    };

    expect(reminderDedupeKey({ ...shared, salonId: 'salon_a' }))
      .not.toBe(reminderDedupeKey({ ...shared, salonId: 'salon_b' }));
  });

  it('separates channels so email and sms never collapse onto one intent', () => {
    const shared = {
      salonId: 'salon_a',
      appointmentId: 'appt_1',
      ruleId: DEFAULT_REMINDER_RULE_ID,
      schedulingRevision: 'deadbeefdeadbeef',
    };

    expect(reminderDedupeKey({ ...shared, channel: 'sms' }))
      .not.toBe(reminderDedupeKey({ ...shared, channel: 'email' }));
  });

  it('keys confirmations on the TRANSITION, collapsing every replay path', () => {
    // Stripe return page, browser refresh, duplicate webhook, reaper and client
    // retry all describe the SAME transition, so they must produce one key.
    const fromWebhook = confirmationDedupeKey({
      salonId: 'salon_a',
      appointmentId: 'appt_1',
      transitionEventId: 'dep_123',
      channel: 'sms',
    });
    const fromRetry = confirmationDedupeKey({
      salonId: 'salon_a',
      appointmentId: 'appt_1',
      transitionEventId: 'dep_123',
      channel: 'sms',
    });

    expect(fromWebhook).toBe(fromRetry);
    expect(fromWebhook).toBe('salon_a:appt_1:confirm:dep_123:sms');
  });
});

describe('planReminders', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');
  const start = new Date('2026-08-20T18:00:00.000Z'); // Aug 20 14:00 EDT

  const basePlan = {
    salonId: 'salon_a',
    appointmentId: 'appt_1',
    appointmentStart: start,
    appointmentUpdatedAt: now,
    timeZone: TZ,
    quietHours: QUIET_DEFAULT,
    allowedChannels: ['sms', 'email'] as Array<'sms' | 'email'>,
    smsEnabled: true,
    emailEnabled: true,
    now,
  };

  it('plans one intent per (rule, channel) for a both-channel rule', () => {
    const planned = planReminders({ ...basePlan, rules: [rule()] });

    expect(planned).toHaveLength(2);
    expect(planned.map(p => p.kind)).toEqual(['scheduled', 'scheduled']);
    expect(planned.map(p => p.channel).sort()).toEqual(['email', 'sms']);
  });

  it('respects a single-channel rule', () => {
    const planned = planReminders({ ...basePlan, rules: [rule({ channels: 'sms' })] });

    expect(planned).toHaveLength(1);
    expect(planned[0]!.channel).toBe('sms');
  });

  it('gives each channel a distinct dedupe key', () => {
    const planned = planReminders({ ...basePlan, rules: [rule()] });
    const keys = planned.flatMap(p => (p.kind === 'scheduled' ? [p.dedupeKey] : []));

    expect(new Set(keys).size).toBe(2);
  });

  it('skips a rule whose lead time already passed (last-minute booking)', () => {
    // 1440 minutes before a start only ~30h away is fine, but a 7-day rule is
    // already in the past and must be skipped, never fired immediately.
    const planned = planReminders({
      ...basePlan,
      rules: [rule({ id: 'crule_week', offsetMinutes: 7 * 24 * 60 })],
    });

    expect(planned.every(p => p.kind === 'skipped')).toBe(true);
    expect(planned[0]).toMatchObject({ kind: 'skipped', reason: 'REMINDER_TIME_PASSED' });
  });

  it('plans multiple rules in ascending lead time independently', () => {
    const planned = planReminders({
      ...basePlan,
      rules: [rule({ channels: 'sms' }), rule({ id: 'crule_2h', offsetMinutes: 120, channels: 'sms' })],
    });

    expect(planned).toHaveLength(2);
    expect(planned.every(p => p.kind === 'scheduled')).toBe(true);
  });

  it('quiet-hours-shifts an overnight reminder forward to the morning', () => {
    // Appointment Aug 21 18:00 EDT (22:00Z). A 20h rule lands Aug 20 22:00 EDT
    // (Aug 21 02:00Z) which is inside quiet hours, so it shifts to Aug 21 09:00
    // EDT (13:00Z) — comfortably before the appointment.
    const planned = planReminders({
      ...basePlan,
      appointmentStart: new Date('2026-08-21T22:00:00.000Z'),
      rules: [rule({ offsetMinutes: 20 * 60, channels: 'sms' })],
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ kind: 'scheduled', quietHoursShifted: true });
    expect(planned[0]!.kind === 'scheduled' && planned[0]!.scheduledFor.toISOString())
      .toBe('2026-08-21T13:00:00.000Z');
  });

  it('expires an overnight reminder whose shift would land at the appointment itself', () => {
    // Appointment Aug 21 09:00 EDT (13:00Z) — an early slot. A 11h rule lands
    // Aug 20 22:00 EDT, inside quiet hours; the shift target is the next local
    // 09:00, which IS the appointment start. notAfter is exclusive, so this is
    // correctly stale: contract §11.4 says never send late, and a reminder
    // arriving as the client sits down is late.
    const planned = planReminders({
      ...basePlan,
      appointmentStart: new Date('2026-08-21T13:00:00.000Z'),
      rules: [rule({ offsetMinutes: 11 * 60, channels: 'sms' })],
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ kind: 'skipped', reason: QUIET_HOURS_STALE });
  });

  it('reports nothing for an empty rule set', () => {
    expect(planReminders({ ...basePlan, rules: [] })).toEqual([]);
  });

  it('honours allowedChannels — a settings-level SMS block cannot leak an SMS intent', () => {
    const planned = planReminders({ ...basePlan, allowedChannels: ['email'], rules: [rule()] });

    expect(planned).toHaveLength(1);
    expect(planned[0]!.channel).toBe('email');
  });
});
