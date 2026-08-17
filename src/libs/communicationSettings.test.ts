import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  channelModeIncludes,
  communicationSettingsSchema,
  communicationSettingsUpdateSchema,
  createReminderRuleId,
  DEFAULT_QUIET_HOURS_END,
  DEFAULT_QUIET_HOURS_START,
  DEFAULT_REMINDER_RULE_ID,
  MAX_REMINDER_RULES,
  mergeCommunicationSettings,
  resolveActiveReminderRules,
  resolveCommunicationSettingsFromSettings,
  resolveEventChannels,
  schedulingRelevantSettings,
} = await import('./communicationSettings');

const resolveDefaults = () => communicationSettingsSchema.parse({});

describe('contract defaults (§9.4 step 3, §11.1, §11.4)', () => {
  it('ships the shared SMS master DISABLED', () => {
    // Deploy-day silence must be structural, not configured.
    expect(resolveDefaults().sms.enabled).toBe(false);
  });

  it('ships email enabled and independently configurable (§3.6)', () => {
    expect(resolveDefaults().email.enabled).toBe(true);
  });

  it('ships the kill switch off', () => {
    expect(resolveDefaults().killSwitch).toBe(false);
  });

  it('ships quiet hours enabled at 21:00-09:00', () => {
    expect(resolveDefaults().quietHours).toEqual({
      enabled: true,
      start: DEFAULT_QUIET_HOURS_START,
      end: DEFAULT_QUIET_HOURS_END,
    });
    expect(DEFAULT_QUIET_HOURS_START).toBe('21:00');
    expect(DEFAULT_QUIET_HOURS_END).toBe('09:00');
  });

  it('ships exactly one 24-hour reminder rule on both channels, and NO 2-hour rule', () => {
    const rules = resolveDefaults().reminders.rules;

    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({
      id: DEFAULT_REMINDER_RULE_ID,
      offsetMinutes: 1440,
      channels: 'both',
      enabled: true,
    });
    expect(rules.some(r => r.offsetMinutes === 120)).toBe(false);
  });

  it('caps reminder rules at three', () => {
    expect(MAX_REMINDER_RULES).toBe(3);
  });
});

describe('resolver purity — no id minting, no clock, no writes', () => {
  it('gives the default rule a STABLE constant id across calls', () => {
    // A generated uuid here would mean the resolver mints identity on a read
    // path, so two concurrent requests would disagree about the dedupe key of
    // the same logical reminder.
    const a = resolveCommunicationSettingsFromSettings(null);
    const b = resolveCommunicationSettingsFromSettings(null);

    expect(a.reminders.rules[0]!.id).toBe(DEFAULT_REMINDER_RULE_ID);
    expect(b.reminders.rules[0]!.id).toBe(a.reminders.rules[0]!.id);
  });

  it('is deep-equal across repeated resolution of identical stored data', () => {
    const stored = { communications: { sms: { enabled: true } } };

    expect(resolveCommunicationSettingsFromSettings(stored as never))
      .toEqual(resolveCommunicationSettingsFromSettings(stored as never));
  });

  it('mints ids ONLY through the explicit write-path helper', () => {
    const id = createReminderRuleId();

    expect(id).toMatch(/^crule_[0-9a-f-]{36}$/);
    expect(id).not.toBe(createReminderRuleId());
  });
});

describe('resolveCommunicationSettingsFromSettings — never throws on a read path', () => {
  it.each([
    ['null settings', null],
    ['undefined settings', undefined],
    ['empty object', {}],
    ['missing namespace', { booking: { bufferMinutes: 5 } }],
    ['namespace of wrong type', { communications: 'nope' }],
    ['garbage quiet hours', { communications: { quietHours: { enabled: true, start: '99:99', end: 'x' } } }],
    ['rule with an out-of-range offset', { communications: { reminders: { rules: [{ id: 'a', offsetMinutes: 999999, channels: 'both', enabled: true }] } } }],
    ['four rules, over the cap', { communications: { reminders: { rules: [1, 2, 3, 4].map(n => ({ id: `r${n}`, offsetMinutes: n * 60, channels: 'sms', enabled: true })) } } }],
  ])('falls back to contract defaults for %s', (_label, stored) => {
    const resolved = resolveCommunicationSettingsFromSettings(stored as never);

    expect(resolved.sms.enabled).toBe(false);
    expect(resolved.quietHours.start).toBe('21:00');
    expect(resolved.reminders.rules).toHaveLength(1);
  });

  it('preserves valid stored overrides', () => {
    const resolved = resolveCommunicationSettingsFromSettings({
      communications: {
        sms: { enabled: true },
        quietHours: { enabled: false, start: '22:00', end: '08:00' },
        reminders: { rules: [{ id: 'crule_x', offsetMinutes: 120, channels: 'sms', enabled: true }] },
      },
    } as never);

    expect(resolved.sms.enabled).toBe(true);
    expect(resolved.quietHours).toEqual({ enabled: false, start: '22:00', end: '08:00' });
    expect(resolved.reminders.rules).toEqual([
      { id: 'crule_x', offsetMinutes: 120, channels: 'sms', enabled: true },
    ]);
  });

  it('distinguishes an explicitly empty rule list from an absent one', () => {
    // Deleting every rule is a legitimate owner choice and must not silently
    // resurrect the default 24-hour rule.
    const emptied = resolveCommunicationSettingsFromSettings({
      communications: { reminders: { rules: [] } },
    } as never);

    expect(emptied.reminders.rules).toEqual([]);
    expect(resolveCommunicationSettingsFromSettings(null).reminders.rules).toHaveLength(1);
  });

  it('fills events totally, so no call site can read undefined', () => {
    const resolved = resolveCommunicationSettingsFromSettings({
      communications: { events: { booking_confirmation: { enabled: false, channels: 'email' } } },
    } as never);

    expect(resolved.events.booking_confirmation).toEqual({ enabled: false, channels: 'email' });
    // An event absent from storage still resolves.
    expect(resolved.events.appointment_reminder).toBeDefined();
    expect(resolved.events.appointment_cancelled.enabled).toBe(true);
  });
});

describe('schema validation refusals', () => {
  it('rejects quiet hours whose start equals its end', () => {
    // Ambiguous between "never quiet" and "always quiet" — must not be storable.
    expect(communicationSettingsSchema.safeParse({
      quietHours: { enabled: true, start: '09:00', end: '09:00' },
    }).success).toBe(false);
  });

  it('rejects a fourth reminder rule', () => {
    expect(communicationSettingsSchema.safeParse({
      reminders: { rules: [1, 2, 3, 4].map(n => ({ id: `r${n}`, offsetMinutes: n * 60, channels: 'sms', enabled: true })) },
    }).success).toBe(false);
  });

  it('rejects duplicate rule ids', () => {
    expect(communicationSettingsSchema.safeParse({
      reminders: { rules: [
        { id: 'same', offsetMinutes: 60, channels: 'sms', enabled: true },
        { id: 'same', offsetMinutes: 120, channels: 'sms', enabled: true },
      ] },
    }).success).toBe(false);
  });

  it('rejects two ENABLED rules at the same lead time', () => {
    // Distinct ids cannot save us here: two rules at the same offset produce
    // two dedupe keys and text the client the same reminder twice.
    const result = communicationSettingsSchema.safeParse({
      reminders: { rules: [
        { id: 'a', offsetMinutes: 1440, channels: 'sms', enabled: true },
        { id: 'b', offsetMinutes: 1440, channels: 'email', enabled: true },
      ] },
    });

    expect(result.success).toBe(false);
  });

  it('ALLOWS a disabled duplicate offset — a parked rule sends nothing', () => {
    expect(communicationSettingsSchema.safeParse({
      reminders: { rules: [
        { id: 'a', offsetMinutes: 1440, channels: 'sms', enabled: true },
        { id: 'b', offsetMinutes: 1440, channels: 'sms', enabled: false },
      ] },
    }).success).toBe(true);
  });

  it('rejects an unknown key in the update schema (strict)', () => {
    expect(communicationSettingsUpdateSchema.safeParse({ smsEnabled: true }).success).toBe(false);
    expect(communicationSettingsUpdateSchema.safeParse({ sms: { enabled: true, extra: 1 } }).success).toBe(false);
  });

  it('accepts a well-formed partial update', () => {
    expect(communicationSettingsUpdateSchema.safeParse({ killSwitch: true }).success).toBe(true);
    expect(communicationSettingsUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe('mergeCommunicationSettings', () => {
  it('leaves unspecified branches untouched', () => {
    const current = resolveCommunicationSettingsFromSettings({
      communications: { sms: { enabled: true }, quietHours: { enabled: false, start: '22:00', end: '07:00' } },
    } as never);
    const merged = mergeCommunicationSettings(current, { killSwitch: true });

    expect(merged.killSwitch).toBe(true);
    expect(merged.sms.enabled).toBe(true);
    expect(merged.quietHours).toEqual({ enabled: false, start: '22:00', end: '07:00' });
  });

  it('replaces the rule array wholesale rather than patching by index', () => {
    const current = resolveDefaults();
    const merged = mergeCommunicationSettings(current, {
      reminders: { rules: [{ id: 'crule_new', offsetMinutes: 180, channels: 'email', enabled: true }] },
    });

    expect(merged.reminders.rules).toEqual([
      { id: 'crule_new', offsetMinutes: 180, channels: 'email', enabled: true },
    ]);
  });

  it('throws ZodError on an invalid merge result so the route can 400', () => {
    expect(() => mergeCommunicationSettings(resolveDefaults(), {
      quietHours: { enabled: true, start: '09:00', end: '09:00' },
    })).toThrow();
  });

  it('merges a single event without dropping the others', () => {
    const merged = mergeCommunicationSettings(resolveDefaults(), {
      events: { booking_confirmation: { enabled: false, channels: 'email' } },
    });

    expect(merged.events.booking_confirmation.enabled).toBe(false);
    expect(merged.events.appointment_reminder.enabled).toBe(true);
  });
});

describe('resolveEventChannels — email independence is structural (§7.6)', () => {
  const withSms = () => mergeCommunicationSettings(resolveDefaults(), { sms: { enabled: true } });

  it('returns nothing at all when the salon kill switch is on', () => {
    const killed = mergeCommunicationSettings(withSms(), { killSwitch: true });

    expect(resolveEventChannels(killed, 'booking_confirmation')).toEqual([]);
  });

  it('returns nothing for a disabled event', () => {
    const off = mergeCommunicationSettings(withSms(), {
      events: { booking_confirmation: { enabled: false, channels: 'both' } },
    });

    expect(resolveEventChannels(off, 'booking_confirmation')).toEqual([]);
  });

  it('yields email only while the shared SMS master is disabled (the dark default)', () => {
    expect(resolveEventChannels(resolveDefaults(), 'booking_confirmation')).toEqual(['email']);
  });

  it('yields both once SMS is enabled', () => {
    expect(resolveEventChannels(withSms(), 'booking_confirmation').sort()).toEqual(['email', 'sms']);
  });

  it('keeps email when SMS is turned off — an SMS problem cannot remove email', () => {
    const smsOff = mergeCommunicationSettings(withSms(), { sms: { enabled: false } });

    expect(resolveEventChannels(smsOff, 'appointment_reminder')).toEqual(['email']);
  });

  it('keeps SMS when email is turned off', () => {
    const emailOff = mergeCommunicationSettings(withSms(), { email: { enabled: false } });

    expect(resolveEventChannels(emailOff, 'appointment_reminder')).toEqual(['sms']);
  });

  it('honours an explicit per-rule channel override', () => {
    expect(resolveEventChannels(withSms(), 'appointment_reminder', 'sms')).toEqual(['sms']);
    expect(resolveEventChannels(withSms(), 'appointment_reminder', 'email')).toEqual(['email']);
  });

  it('defaults internal owner/tech alerts to sms', () => {
    expect(resolveDefaults().events.owner_new_booking.channels).toBe('sms');
    expect(resolveDefaults().events.tech_new_booking.channels).toBe('sms');
  });
});

describe('channelModeIncludes', () => {
  it.each([
    ['both', 'sms', true],
    ['both', 'email', true],
    ['sms', 'sms', true],
    ['sms', 'email', false],
    ['email', 'email', true],
    ['email', 'sms', false],
  ] as const)('%s includes %s => %s', (mode, channel, expected) => {
    expect(channelModeIncludes(mode, channel)).toBe(expected);
  });
});

describe('resolveActiveReminderRules', () => {
  it('drops disabled rules and sorts ascending by lead time', () => {
    const settings = mergeCommunicationSettings(resolveDefaults(), {
      reminders: { rules: [
        { id: 'c', offsetMinutes: 2880, channels: 'sms', enabled: true },
        { id: 'b', offsetMinutes: 120, channels: 'sms', enabled: false },
        { id: 'a', offsetMinutes: 60, channels: 'sms', enabled: true },
      ] },
    });

    expect(resolveActiveReminderRules(settings).map(r => r.offsetMinutes)).toEqual([60, 2880]);
  });
});

describe('schedulingRelevantSettings — the fingerprint surface', () => {
  it('exposes only scheduling-relevant values', () => {
    // Adding a key here forces rematerialization of every future intent, so the
    // shape is deliberately narrow: an unrelated settings edit must not churn
    // the queue.
    expect(Object.keys(schedulingRelevantSettings(resolveDefaults())).sort())
      .toEqual(['emailEnabled', 'killSwitch', 'quietHours', 'rules', 'smsEnabled']);
  });

  it('excludes disabled rules from the fingerprint surface', () => {
    const settings = mergeCommunicationSettings(resolveDefaults(), {
      reminders: { rules: [{ id: 'a', offsetMinutes: 60, channels: 'sms', enabled: false }] },
    });

    expect(schedulingRelevantSettings(settings).rules).toEqual([]);
  });
});
