import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

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

import {
  DEFAULT_BOOKING_NOTIFICATION_SETTINGS,
  mergeBookingNotificationSettings,
  resolveBookingNotificationCapabilities,
  resolveBookingNotificationSettingsFromSettings,
} from '@/libs/bookingNotificationSettings';

describe('bookingNotificationSettings', () => {
  it('applies defaults when notification settings are missing', () => {
    expect(resolveBookingNotificationSettingsFromSettings(null)).toEqual(DEFAULT_BOOKING_NOTIFICATION_SETTINGS);
  });

  it('merges partial updates on top of current settings', () => {
    const merged = mergeBookingNotificationSettings(DEFAULT_BOOKING_NOTIFICATION_SETTINGS, {
      newBooking: {
        ownerEnabled: true,
        ownerChannel: 'email',
      },
      appointmentCancelled: {
        ownerEnabled: true,
      },
    });

    expect(merged).toEqual({
      newBooking: {
        technicianEnabled: true,
        ownerEnabled: true,
        technicianChannel: 'sms',
        ownerChannel: 'email',
      },
      appointmentCancelled: {
        technicianEnabled: true,
        ownerEnabled: true,
        technicianChannel: 'sms',
        ownerChannel: 'both',
      },
    });
  });

  it('resolves booking notification capabilities from contact presence and effective SMS/email availability', () => {
    const capabilities = resolveBookingNotificationCapabilities({
      features: {
        marketing: {
          smsReminders: true,
        },
      },
      settings: {
        modules: {
          smsReminders: true,
        },
      },
      ownerPhone: '4169021427',
      ownerEmail: 'owner@example.com',
    });

    expect(capabilities).toEqual({
      ownerPhonePresent: true,
      ownerEmailPresent: true,
      smsChannelAvailable: true,
      emailChannelAvailable: true,
    });
  });
});
