/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, isSmsEnabled, twilio, db, queueSelectResults } = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(async () => selectResults.shift() ?? []),
  };

  return {
    create: vi.fn(async () => ({ sid: 'SM_referral' })),
    isSmsEnabled: vi.fn(),
    twilio: vi.fn(() => ({
      messages: {
        create: vi.fn(async () => ({ sid: 'SM_referral' })),
      },
    })),
    db: {
      select: vi.fn(() => query),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ catch: vi.fn(async () => undefined) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ catch: vi.fn(async () => undefined) })) })) })),
    },
    queueSelectResults: (...rows: unknown[][]) => {
      selectResults.splice(0, selectResults.length, ...rows);
    },
  };
});

vi.mock('@/libs/DB', () => ({ db }));

vi.mock('twilio', () => ({
  default: twilio,
}));

vi.mock('@/libs/Env', () => ({
  Env: {
    TWILIO_ACCOUNT_SID: 'twilio_sid',
    TWILIO_AUTH_TOKEN: 'twilio_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
  },
}));

vi.mock('@/libs/salonStatus', () => ({
  isSmsEnabled,
}));

import {
  buildAppointmentReminderMessage,
  sendBookingConfirmationToClient,
  sendInternalBookingNotificationSms,
  sendReferralInvite,
} from './SMS';

describe('SMS templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSmsEnabled.mockResolvedValue(true);
    twilio.mockReturnValue({
      messages: {
        create,
      },
    });
    queueSelectResults([], [{ freeSoloEnabled: false }]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('sends clean internal booking summaries without emoji-heavy copy', async () => {
    const sent = await sendInternalBookingNotificationSms('salon_1', {
      phone: '4165550198',
      salonName: 'Isla Nail Studio',
      clientName: 'Bob',
      clientPhone: '4165550198',
      services: ['Gel Manicure'],
      startTime: '2026-06-10T17:45:00.000Z',
      totalDurationMinutes: 60,
      totalPrice: 4000,
      technicianName: 'Daniela',
      timeZone: 'America/Toronto',
    });

    expect(sent).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: [
        'New booking at Isla Nail Studio',
        '',
        'Gel Manicure with Daniela',
        'Wed, Jun 10, 1:45 PM-2:45 PM',
        '',
        'Client: Bob',
        'Phone: 4165550198',
        'Duration: 60 min',
        'Total: $40',
      ].join('\n'),
      to: '+14165550198',
    }));
  });

  it('sends clean customer booking confirmations', async () => {
    queueSelectResults([{ status: 'granted' }], [], [{ freeSoloEnabled: false }]);
    await sendBookingConfirmationToClient('salon_1', {
      phone: '4165550198',
      clientName: 'Bob',
      appointmentId: 'appt_1',
      salonName: 'Isla Nail Studio',
      services: ['Gel Manicure'],
      technicianName: 'Daniela',
      startTime: '2026-06-10T17:45:00.000Z',
      totalPrice: 4000,
      timeZone: 'America/Toronto',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: [
        'Isla Nail Studio',
        'Appointment confirmed',
        '',
        'Hi Bob,',
        '',
        'Gel Manicure with Daniela',
        'Wed, Jun 10, 1:45 PM',
        'Total: $40',
        '',
        'Reply STOP to opt out. Reply to this text if you need help.',
      ].join('\n'),
      to: '+14165550198',
    }));
  });

  it('does not send customer appointment texts without salon-scoped consent', async () => {
    queueSelectResults([]);

    const sent = await sendBookingConfirmationToClient('salon_1', {
      phone: '4165550198',
      clientName: 'Bob',
      appointmentId: 'appt_1',
      salonName: 'Isla Nail Studio',
      services: ['Gel Manicure'],
      technicianName: 'Daniela',
      startTime: '2026-06-10T17:45:00.000Z',
      totalPrice: 4000,
      timeZone: 'America/Toronto',
    });

    expect(sent).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('builds staff-triggered reminders with full appointment details and the secure link', () => {
    const message = buildAppointmentReminderMessage({
      phone: '4165550198',
      clientName: 'Bob',
      appointmentId: 'appt_1',
      salonName: 'Isla Nail Studio',
      startTime: '2026-07-22T21:00:00.000Z',
      hoursUntil: 3,
      kind: 'manual',
      services: ['BIAB Fill'],
      technicianName: 'Daniela',
      timeZone: 'America/Toronto',
      manageUrl: 'https://islanailsalon.com/en/isla/manage/token',
    });

    expect(message).toContain('Wed, Jul 22 at 5:00 PM');
    expect(message).toContain('Service: BIAB Fill');
    expect(message).toContain('Artist: Daniela');
    expect(message).toContain(
      'View, reschedule, or cancel: https://islanailsalon.com/en/isla/manage/token',
    );
  });

  it('sends referral invite links on the salon custom domain', async () => {
    queueSelectResults([], [{ freeSoloEnabled: false }]);
    const sent = await sendReferralInvite('salon_1', {
      refereePhone: '2223334444',
      referrerName: 'Ava',
      salonName: 'Isla Nail Studio',
      salonCustomDomain: 'islanailsalon.com',
      referralId: 'ref_123',
    });

    expect(sent).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('https://islanailsalon.com/referral/ref_123'),
      to: '+12223334444',
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('Ava sent you $10 off your first appointment at Isla Nail Studio.'),
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.not.stringContaining('localhost'),
    }));
  });
});
