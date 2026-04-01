import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
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

import {
  isDayBeforeReminderDue,
  isSameDayReminderDue,
  processAppointmentReminders,
} from './appointmentReminders';

describe('appointment reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueSelectResults();
    getAppointmentServiceNames.mockResolvedValue(['BIAB Fill']);
    getClientByPhone.mockResolvedValue(null);
    sendTransactionalEmail.mockResolvedValue(true);
    sendAppointmentReminder.mockResolvedValue(true);
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

  it('sends a day-before reminder email and marks it as sent', async () => {
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
    expect(sendAppointmentReminder).not.toHaveBeenCalled();
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

  it('sends the 2-hour reminder by SMS only', async () => {
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

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      kind: 'same_day',
      phone: '4165551234',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      sameDayReminderChannel: 'sms',
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
