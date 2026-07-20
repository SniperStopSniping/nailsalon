import { describe, expect, it, vi } from 'vitest';

import {
  mergeSalonEmailNotificationSettings,
  resolveSalonEmailNotificationSettings,
  resolveSalonNotificationRecipient,
  salonEmailNotificationSettingsUpdateSchema,
} from '@/libs/salonNotificationEmailSettings';

vi.mock('server-only', () => ({}));

describe('resolveSalonEmailNotificationSettings', () => {
  it('defaults every notification type to on', () => {
    expect(resolveSalonEmailNotificationSettings(null)).toEqual({
      newBooking: true,
      rescheduled: true,
      cancelled: true,
      recipientEmail: null,
    });
  });

  it('reads stored values and normalises the recipient to lowercase', () => {
    const settings = resolveSalonEmailNotificationSettings({
      notifications: {
        salonEmail: {
          newBooking: false,
          recipientEmail: 'Front.Desk@Example.COM',
        },
      },
    });

    expect(settings.newBooking).toBe(false);
    expect(settings.rescheduled).toBe(true);
    expect(settings.recipientEmail).toBe('front.desk@example.com');
  });

  it('falls back to defaults when the stored block is malformed', () => {
    const settings = resolveSalonEmailNotificationSettings({
      notifications: {
        salonEmail: { newBooking: 'yes', recipientEmail: 'not-an-email' },
      },
    } as never);

    expect(settings).toEqual({
      newBooking: true,
      rescheduled: true,
      cancelled: true,
      recipientEmail: null,
    });
  });
});

describe('salonEmailNotificationSettingsUpdateSchema', () => {
  it('rejects an invalid email', () => {
    const parsed = salonEmailNotificationSettingsUpdateSchema.safeParse({
      recipientEmail: 'nope@',
    });

    expect(parsed.success).toBe(false);
  });

  it('treats an empty string as clearing the override', () => {
    const parsed = salonEmailNotificationSettingsUpdateSchema.parse({
      recipientEmail: '',
    });

    expect(parsed.recipientEmail).toBeNull();
  });
});

describe('mergeSalonEmailNotificationSettings', () => {
  it('preserves fields the update does not touch', () => {
    const merged = mergeSalonEmailNotificationSettings(
      {
        newBooking: true,
        rescheduled: false,
        cancelled: true,
        recipientEmail: 'alerts@example.com',
      },
      { cancelled: false },
    );

    expect(merged).toEqual({
      newBooking: true,
      rescheduled: false,
      cancelled: false,
      recipientEmail: 'alerts@example.com',
    });
  });
});

describe('resolveSalonNotificationRecipient', () => {
  it('prefers the configured notification email', () => {
    expect(resolveSalonNotificationRecipient({
      recipientEmail: 'alerts@example.com',
      ownerEmail: 'owner@example.com',
      salonEmail: 'salon@example.com',
    })).toEqual({ email: 'alerts@example.com', source: 'configured' });
  });

  it('falls back to the owner email', () => {
    expect(resolveSalonNotificationRecipient({
      recipientEmail: null,
      ownerEmail: 'Owner@Example.com',
      salonEmail: 'salon@example.com',
    })).toEqual({ email: 'owner@example.com', source: 'owner' });
  });

  it('falls back to the salon account email last', () => {
    expect(resolveSalonNotificationRecipient({
      ownerEmail: '   ',
      salonEmail: 'salon@example.com',
    })).toEqual({ email: 'salon@example.com', source: 'salon_account' });
  });

  it('skips malformed candidates instead of returning a guaranteed bounce', () => {
    expect(resolveSalonNotificationRecipient({
      recipientEmail: 'broken@',
      ownerEmail: 'owner@example.com',
    })).toEqual({ email: 'owner@example.com', source: 'owner' });
  });

  it('reports when nothing valid is configured', () => {
    expect(resolveSalonNotificationRecipient({
      recipientEmail: null,
      ownerEmail: null,
      salonEmail: null,
    })).toEqual({
      email: null,
      source: null,
      reason: 'NO_SALON_NOTIFICATION_RECIPIENT',
    });
  });
});
