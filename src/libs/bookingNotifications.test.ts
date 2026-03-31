import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { sendInternalBookingNotificationSms, sendInternalCancellationNotificationSms, sendTransactionalEmail } = vi.hoisted(() => ({
  sendInternalBookingNotificationSms: vi.fn(),
  sendInternalCancellationNotificationSms: vi.fn(),
  sendTransactionalEmail: vi.fn(),
}));

vi.mock('@/libs/Env', () => ({
  Env: {
    TWILIO_ACCOUNT_SID: 'twilio_sid',
    TWILIO_AUTH_TOKEN: 'twilio_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
    RESEND_API_KEY: 'resend_key',
    RESEND_FROM_EMAIL: 'bookings@example.com',
  },
}));

vi.mock('@/libs/featureGating', () => ({
  getEffectiveModuleEnabled: vi.fn(() => true),
}));

vi.mock('@/libs/SMS', () => ({
  sendInternalBookingNotificationSms,
  sendInternalCancellationNotificationSms,
}));

vi.mock('@/libs/email', () => ({
  sendTransactionalEmail,
}));

import {
  sendBookingNotificationsForAppointmentCancelled,
  sendBookingNotificationsForNewBooking,
} from '@/libs/bookingNotifications';

const baseSalon = {
  id: 'salon_1',
  name: 'Isla Nail Studio',
  ownerName: 'Daniela',
  ownerPhone: '4169021427',
  ownerEmail: 'milianbeltrandaniela@gmail.com',
  features: {
    marketing: {
      smsReminders: true,
    },
  },
  settings: {
    modules: {
      smsReminders: true,
    },
    notifications: {
      newBooking: {
        technicianEnabled: true,
        ownerEnabled: true,
        technicianChannel: 'both',
        ownerChannel: 'both',
      },
      appointmentCancelled: {
        technicianEnabled: true,
        ownerEnabled: true,
        technicianChannel: 'both',
        ownerChannel: 'both',
      },
    },
  },
} as const;

describe('bookingNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendInternalBookingNotificationSms.mockResolvedValue(true);
    sendInternalCancellationNotificationSms.mockResolvedValue(true);
    sendTransactionalEmail.mockResolvedValue(true);
  });

  it('deduplicates identical owner and technician destinations per channel for new bookings', async () => {
    await sendBookingNotificationsForNewBooking({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: 'milianbeltrandaniela@gmail.com',
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      totalDurationMinutes: 90,
      totalPrice: 8500,
    });

    expect(sendInternalBookingNotificationSms).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it('deduplicates identical owner and technician destinations per channel for cancellations', async () => {
    await sendBookingNotificationsForAppointmentCancelled({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: 'milianbeltrandaniela@gmail.com',
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      cancelReason: 'client_request',
    });

    expect(sendInternalCancellationNotificationSms).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });

  it('logs explicit delivery failures when email send returns false', async () => {
    sendTransactionalEmail.mockResolvedValue(false);

    await sendBookingNotificationsForNewBooking({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: null,
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      totalDurationMinutes: 90,
      totalPrice: 8500,
    });

    expect(console.error).toHaveBeenCalledWith(
      '[BOOKING NOTIFICATIONS] Internal notification failed:',
      expect.objectContaining({
        eventType: 'new_booking',
        channel: 'email',
        destination: 'milianbeltrandaniela@gmail.com',
        reason: 'send_returned_false',
      }),
    );
  });

  it('skips cancellation notifications for reschedules', async () => {
    await sendBookingNotificationsForAppointmentCancelled({
      salon: baseSalon,
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: null,
      },
      appointmentId: 'appt_1',
      clientName: 'Ava',
      clientPhone: '1111111111',
      services: ['BIAB Fill'],
      startTime: '2099-03-13T15:00:00.000Z',
      cancelReason: 'rescheduled',
    });

    expect(sendInternalCancellationNotificationSms).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
