import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDayBeforeReminderDue,
  isSameDayReminderDue,
  processAppointmentReminders,
} from './appointmentReminders';

vi.mock('server-only', () => ({}));

const {
  mintAppointmentManageLink,
  resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone,
  sendTransactionalEmail,
  getAppointmentServiceNames,
  getClientByPhone,
  sendAppointmentReminder,
  select,
  updateSet,
  updateWhere,
  queueSelectResults,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const queryResult = {
    innerJoin: vi.fn(() => queryResult),
    leftJoin: vi.fn(() => queryResult),
    where: vi.fn(() => queryResult),
    orderBy: vi.fn(() => queryResult),
    limit: vi.fn(() => queryResult),
    then: (resolve: (value: unknown[]) => void) => resolve(selectResults.shift() ?? []),
  };
  const from = vi.fn(() => queryResult);
  const select = vi.fn(() => ({ from }));

  const updateWhere = vi.fn(async () => []);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    mintAppointmentManageLink: vi.fn(),
    resolveOperationalSalonClientContact: vi.fn(),
    resolveOperationalSalonClientContactByPhone: vi.fn(),
    sendTransactionalEmail: vi.fn(),
    getAppointmentServiceNames: vi.fn(),
    getClientByPhone: vi.fn(),
    sendAppointmentReminder: vi.fn(),
    select,
    updateSet,
    updateWhere,
    queueSelectResults: (...rows: unknown[][]) => {
      selectResults.splice(0, selectResults.length, ...rows);
    },
    db: {
      select,
      update,
    },
  };
});

vi.mock('@/libs/email', () => ({
  sendTransactionalEmail,
}));

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone,
}));

vi.mock('@/libs/appointmentManageLink', () => ({
  mintAppointmentManageLink,
}));

vi.mock('@/libs/queries', () => ({
  getAppointmentServiceNames,
  getClientByPhone,
}));

vi.mock('@/libs/SMS', () => ({
  sendAppointmentReminder,
}));

vi.mock('@/libs/DB', () => ({
  db: {
    select,
    update: vi.fn(() => ({ set: updateSet })),
  },
}));

describe('appointment reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueSelectResults();
    getAppointmentServiceNames.mockResolvedValue(['BIAB Fill']);
    getClientByPhone.mockResolvedValue(null);
    sendTransactionalEmail.mockResolvedValue(true);
    sendAppointmentReminder.mockResolvedValue(true);
    mintAppointmentManageLink.mockResolvedValue(
      'https://app.luster.test/en/isla-nail-studio1/manage/TEST_TOKEN_NOT_A_REAL_CAPABILITY',
    );
    resolveOperationalSalonClientContact.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '4165550198',
      email: 'current@example.test',
      archivedAt: null,
      redirectedFromClientId: 'merged_source',
      lineagePath: ['merged_source', 'primary_client'],
    });
    resolveOperationalSalonClientContactByPhone.mockResolvedValue(null);
  });

  it('detects the day-before 6 PM local reminder window', () => {
    const due = isDayBeforeReminderDue({
      now: new Date('2026-03-31T22:05:00.000Z'),
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      timeZone: 'America/Toronto',
    });

    expect(due).toBe(true);
  });

  it('detects the 2-hour same-day reminder window', () => {
    const due = isSameDayReminderDue({
      now: new Date('2026-04-01T16:55:00.000Z'),
      startTime: new Date('2026-04-01T19:00:00.000Z'),
    });

    expect(due).toBe(true);
  });

  it('sends guaranteed day-before email and attempts consent-gated SMS', async () => {
    queueSelectResults([{
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ava@example.com',
      subject: 'Reminder: Your appointment tomorrow at Isla Nail Studio',
    }));
    expect(sendAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      kind: 'day_before',
      phone: '4165551234',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      dayBeforeReminderChannel: 'email',
    }));
    expect(result).toEqual({
      scanned: 1,
      dayBeforeSent: 1,
      dayBeforeEmail: 1,
      dayBeforeSms: 0,
      sameDaySent: 0,
      skipped: 0,
      failures: 0,
    });
  });

  it('falls back to SMS when the day-before email send fails', async () => {
    sendTransactionalEmail.mockResolvedValue(false);
    queueSelectResults([{
      appointmentId: 'appt_2',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      kind: 'day_before',
      phone: '4165551234',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      dayBeforeReminderChannel: 'sms',
    }));
    expect(result.dayBeforeSms).toBe(1);
    expect(result.failures).toBe(0);
  });

  it('uses terminal current phone without rewriting historical reminder email', async () => {
    queueSelectResults([{
      appointmentId: 'appt_merged',
      salonId: 'salon_1',
      salonClientId: 'merged_source',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '4165550100',
      appointmentEmail: 'historical@example.test',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'source@example.test',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(resolveOperationalSalonClientContact).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'merged_source',
      allowArchived: true,
    });
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'historical@example.test' }),
    );
    expect(sendAppointmentReminder).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4165550198' }),
    );
    expect(result.dayBeforeSent).toBe(1);
  });

  it('uses a unique same-salon alias for a null-ID appointment', async () => {
    resolveOperationalSalonClientContactByPhone.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '4165550198',
      email: 'current@example.test',
      archivedAt: null,
      redirectedFromClientId: 'merged_source',
      lineagePath: ['merged_source', 'primary_client'],
    });
    queueSelectResults([{
      appointmentId: 'appt_legacy',
      salonId: 'salon_1',
      salonClientId: null,
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '4165550100',
      appointmentEmail: 'historical@example.test',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(resolveOperationalSalonClientContactByPhone).toHaveBeenCalledWith({
      salonId: 'salon_1',
      phone: '4165550100',
      allowArchived: true,
    });
    expect(sendAppointmentReminder).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4165550198' }),
    );
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'historical@example.test' }),
    );
    expect(result.dayBeforeSent).toBe(1);
  });

  it('does not send or mark a null-ID reminder with ambiguous lifecycle contact', async () => {
    resolveOperationalSalonClientContactByPhone.mockRejectedValue(
      new Error('ambiguous lifecycle state'),
    );
    queueSelectResults([{
      appointmentId: 'appt_ambiguous',
      salonId: 'salon_1',
      salonClientId: null,
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '4165550100',
      appointmentEmail: null,
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      salonClientEmail: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendAppointmentReminder).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
    expect(result.failures).toBe(1);
  });

  it('fails closed without marking a reminder when terminal contact is invalid', async () => {
    resolveOperationalSalonClientContact.mockRejectedValueOnce(
      new Error('invalid lifecycle state'),
    );
    queueSelectResults([{
      appointmentId: 'appt_invalid',
      salonId: 'salon_1',
      salonClientId: 'merged_source',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '4165550100',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      salonClientEmail: null,
      appointmentEmail: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendAppointmentReminder).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
    expect(result.failures).toBe(1);
  });

  it('sends the 2-hour reminder by email and attempts consent-gated SMS', async () => {
    queueSelectResults([{
      appointmentId: 'appt_3',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: new Date('2026-03-31T22:05:00.000Z'),
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-04-01T16:55:00.000Z'),
    });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ava@example.com',
      subject: 'Your Isla Nail Studio appointment is today',
    }));
    expect(sendAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      kind: 'same_day',
      phone: '4165551234',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      sameDayReminderChannel: 'email',
    }));
    expect(result.sameDaySent).toBe(1);
  });

  it('uses the global client email fallback when the salon client email is missing', async () => {
    getClientByPhone.mockResolvedValue({ email: 'fallback@example.com' });
    queueSelectResults([{
      appointmentId: 'appt_4',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: null,
      salonClientEmail: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(getClientByPhone).toHaveBeenCalledWith('+14165551234');
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'fallback@example.com',
    }));
  });

  it('puts the canonical management link in both reminder emails', async () => {
    const candidate = {
      appointmentId: 'appt_link',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };

    queueSelectResults([candidate]);
    await processAppointmentReminders({ now: new Date('2026-03-31T22:05:00.000Z') });

    queueSelectResults([{ ...candidate, dayBeforeReminderSentAt: new Date('2026-03-31T22:05:00.000Z') }]);
    await processAppointmentReminders({ now: new Date('2026-04-01T16:55:00.000Z') });

    expect(mintAppointmentManageLink).toHaveBeenCalledWith({
      id: 'appt_link',
      salonId: 'salon_1',
      endTime: candidate.endTime,
    });

    const bodies = sendTransactionalEmail.mock.calls.map(call => (call[0] as { text: string }).text);

    expect(bodies).toHaveLength(2);

    for (const body of bodies) {
      expect(body).toContain('https://app.luster.test/en/isla-nail-studio1/manage/TEST_TOKEN_NOT_A_REAL_CAPABILITY');
      expect(body).not.toMatch(/\/book\//);
    }

    for (const [, reminder] of sendAppointmentReminder.mock.calls) {
      expect(reminder).toEqual(expect.objectContaining({
        manageUrl: 'https://app.luster.test/en/isla-nail-studio1/manage/TEST_TOKEN_NOT_A_REAL_CAPABILITY',
      }));
    }
  });

  it('still sends the reminder when the management link cannot be minted', async () => {
    mintAppointmentManageLink.mockRejectedValue(new Error('SALON_NOT_FOUND'));
    queueSelectResults([{
      appointmentId: 'appt_nolink',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({ now: new Date('2026-03-31T22:05:00.000Z') });

    expect(result.dayBeforeSent).toBe(1);
    expect((sendTransactionalEmail.mock.calls[0]![0] as { text: string }).text)
      .toContain('please contact the salon');
  });

  it('does not resend a day-before reminder that is already marked as sent', async () => {
    queueSelectResults([{
      appointmentId: 'appt_5',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: new Date('2026-03-31T22:00:00.000Z'),
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendAppointmentReminder).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
});
