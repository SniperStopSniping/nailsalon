import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { sendInternalBookingNotificationSms, sendTransactionalEmail } = vi.hoisted(() => ({
  sendInternalBookingNotificationSms: vi.fn(),
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
}));

vi.mock('@/libs/email', () => ({
  sendTransactionalEmail,
}));

import { sendBookingNotificationsForNewBooking } from '@/libs/bookingNotifications';

describe('bookingNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('deduplicates identical owner and technician destinations per channel', async () => {
    await sendBookingNotificationsForNewBooking({
      salon: {
        id: 'salon_1',
        name: 'Isla Nail Studio',
        ownerName: 'Daniela',
        ownerPhone: '4169021427',
        ownerEmail: 'daniela@example.com',
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
          },
        },
      },
      technician: {
        id: 'tech_1',
        name: 'Daniela',
        phone: '4169021427',
        email: 'daniela@example.com',
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

  it('uses owner email when technician email is missing and still deduplicates SMS for Isla-like data', async () => {
    await sendBookingNotificationsForNewBooking({
      salon: {
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
          },
        },
      },
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

    expect(sendInternalBookingNotificationSms).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'milianbeltrandaniela@gmail.com',
    }));
  });
});
