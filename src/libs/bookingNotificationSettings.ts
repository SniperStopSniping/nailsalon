import 'server-only';

import { z } from 'zod';

import { Env } from '@/libs/Env';
import { getEffectiveModuleEnabled } from '@/libs/featureGating';
import type { SalonSettings, SalonFeatures } from '@/types/salonPolicy';

export const BOOKING_NOTIFICATION_CHANNELS = ['sms', 'email', 'both'] as const;

export const DEFAULT_BOOKING_NOTIFICATION_SETTINGS = {
  newBooking: {
    technicianEnabled: true,
    ownerEnabled: false,
    technicianChannel: 'sms',
    ownerChannel: 'both',
  },
  appointmentCancelled: {
    technicianEnabled: true,
    ownerEnabled: false,
    technicianChannel: 'sms',
    ownerChannel: 'both',
  },
} as const;

const bookingNotificationEventSettingsSchema = z.object({
  technicianEnabled: z.boolean().default(DEFAULT_BOOKING_NOTIFICATION_SETTINGS.newBooking.technicianEnabled),
  ownerEnabled: z.boolean().default(DEFAULT_BOOKING_NOTIFICATION_SETTINGS.newBooking.ownerEnabled),
  technicianChannel: z.enum(BOOKING_NOTIFICATION_CHANNELS).default(DEFAULT_BOOKING_NOTIFICATION_SETTINGS.newBooking.technicianChannel),
  ownerChannel: z.enum(BOOKING_NOTIFICATION_CHANNELS).default(DEFAULT_BOOKING_NOTIFICATION_SETTINGS.newBooking.ownerChannel),
});

export const bookingNotificationSettingsSchema = z.object({
  newBooking: bookingNotificationEventSettingsSchema.default(DEFAULT_BOOKING_NOTIFICATION_SETTINGS.newBooking),
  appointmentCancelled: bookingNotificationEventSettingsSchema.default(DEFAULT_BOOKING_NOTIFICATION_SETTINGS.appointmentCancelled),
});

export const bookingNotificationSettingsUpdateSchema = z.object({
  newBooking: z.object({
    technicianEnabled: z.boolean().optional(),
    ownerEnabled: z.boolean().optional(),
    technicianChannel: z.enum(BOOKING_NOTIFICATION_CHANNELS).optional(),
    ownerChannel: z.enum(BOOKING_NOTIFICATION_CHANNELS).optional(),
  }).optional(),
  appointmentCancelled: z.object({
    technicianEnabled: z.boolean().optional(),
    ownerEnabled: z.boolean().optional(),
    technicianChannel: z.enum(BOOKING_NOTIFICATION_CHANNELS).optional(),
    ownerChannel: z.enum(BOOKING_NOTIFICATION_CHANNELS).optional(),
  }).optional(),
});

export type BookingNotificationSettings = z.infer<typeof bookingNotificationSettingsSchema>;
export type BookingNotificationSettingsUpdate = z.infer<typeof bookingNotificationSettingsUpdateSchema>;

type BookingNotificationCapabilitiesInput = {
  features: SalonFeatures | null | undefined;
  settings: SalonSettings | null | undefined;
  ownerPhone?: string | null;
  ownerEmail?: string | null;
};

export type BookingNotificationCapabilities = {
  ownerPhonePresent: boolean;
  ownerEmailPresent: boolean;
  smsChannelAvailable: boolean;
  emailChannelAvailable: boolean;
};

export function resolveBookingNotificationSettingsFromSettings(
  settings: SalonSettings | null | undefined,
): BookingNotificationSettings {
  const parsed = bookingNotificationSettingsSchema.safeParse(settings?.notifications ?? {});
  if (parsed.success) {
    return parsed.data;
  }

  return bookingNotificationSettingsSchema.parse({});
}

export function mergeBookingNotificationSettings(
  current: BookingNotificationSettings,
  updates: BookingNotificationSettingsUpdate,
): BookingNotificationSettings {
  return bookingNotificationSettingsSchema.parse({
    newBooking: {
      ...current.newBooking,
      ...(updates.newBooking ?? {}),
    },
    appointmentCancelled: {
      ...current.appointmentCancelled,
      ...(updates.appointmentCancelled ?? {}),
    },
  });
}

export function resolveBookingNotificationCapabilities(
  input: BookingNotificationCapabilitiesInput,
): BookingNotificationCapabilities {
  return {
    ownerPhonePresent: Boolean(input.ownerPhone?.trim()),
    ownerEmailPresent: Boolean(input.ownerEmail?.trim()),
    smsChannelAvailable: hasSmsInfrastructure() && getEffectiveModuleEnabled({
      features: input.features,
      settings: input.settings,
      module: 'smsReminders',
    }),
    emailChannelAvailable: hasEmailInfrastructure(),
  };
}

export function hasSmsInfrastructure(): boolean {
  return Boolean(Env.TWILIO_ACCOUNT_SID && Env.TWILIO_AUTH_TOKEN && Env.TWILIO_PHONE_NUMBER);
}

export function hasEmailInfrastructure(): boolean {
  return Boolean(Env.RESEND_API_KEY && Env.RESEND_FROM_EMAIL);
}
