import 'server-only';

import { z } from 'zod';

import type { SalonSettings } from '@/types/salonPolicy';

/**
 * Salon-facing appointment notification emails.
 *
 * Deliberately separate from the client-facing confirmation/reminder settings
 * and from `settings.notifications.newBooking|appointmentCancelled` (which now
 * only drives SMS to the owner and the assigned technician). The salon's own
 * "someone booked / moved / cancelled" alerts live here and nowhere else.
 */

export const SALON_EMAIL_NOTIFICATION_EVENTS = [
  'newBooking',
  'rescheduled',
  'cancelled',
] as const;

export type SalonEmailNotificationEvent
  = (typeof SALON_EMAIL_NOTIFICATION_EVENTS)[number];

export const DEFAULT_SALON_EMAIL_NOTIFICATION_SETTINGS = {
  newBooking: true,
  rescheduled: true,
  cancelled: true,
  recipientEmail: null,
} as const;

const emailSchema = z.string().trim().toLowerCase().email();

export const salonEmailNotificationSettingsSchema = z.object({
  newBooking: z.boolean().default(DEFAULT_SALON_EMAIL_NOTIFICATION_SETTINGS.newBooking),
  rescheduled: z.boolean().default(DEFAULT_SALON_EMAIL_NOTIFICATION_SETTINGS.rescheduled),
  cancelled: z.boolean().default(DEFAULT_SALON_EMAIL_NOTIFICATION_SETTINGS.cancelled),
  // Stored lowercase; `null` means "fall back to the owner / account email".
  recipientEmail: emailSchema.nullable().default(null),
});

export const salonEmailNotificationSettingsUpdateSchema = z.object({
  newBooking: z.boolean().optional(),
  rescheduled: z.boolean().optional(),
  cancelled: z.boolean().optional(),
  // An empty string clears the override rather than failing validation: the
  // settings form submits "" when the owner blanks the field.
  recipientEmail: z
    .union([emailSchema, z.literal(''), z.null()])
    .transform(value => (value || null))
    .optional(),
});

export type SalonEmailNotificationSettings = z.infer<
  typeof salonEmailNotificationSettingsSchema
>;
export type SalonEmailNotificationSettingsUpdate = z.infer<
  typeof salonEmailNotificationSettingsUpdateSchema
>;

export function resolveSalonEmailNotificationSettings(
  settings: SalonSettings | null | undefined,
): SalonEmailNotificationSettings {
  const parsed = salonEmailNotificationSettingsSchema.safeParse(
    settings?.notifications?.salonEmail ?? {},
  );

  return parsed.success
    ? parsed.data
    : salonEmailNotificationSettingsSchema.parse({});
}

export function mergeSalonEmailNotificationSettings(
  current: SalonEmailNotificationSettings,
  updates: SalonEmailNotificationSettingsUpdate,
): SalonEmailNotificationSettings {
  return salonEmailNotificationSettingsSchema.parse({
    ...current,
    ...updates,
  });
}

export type SalonNotificationRecipientSource
  = | 'configured'
  | 'owner'
  | 'salon_account';

export type SalonNotificationRecipient =
  | { email: string; source: SalonNotificationRecipientSource }
  | { email: null; source: null; reason: 'NO_SALON_NOTIFICATION_RECIPIENT' };

/**
 * Recipient priority: configured booking-notification email, then the salon
 * owner email, then the salon's verified account email. Every candidate is
 * validated the same way the settings form validates, so a malformed legacy
 * value falls through instead of producing a guaranteed provider bounce.
 */
export function resolveSalonNotificationRecipient(input: {
  recipientEmail?: string | null;
  ownerEmail?: string | null;
  salonEmail?: string | null;
}): SalonNotificationRecipient {
  const candidates: Array<[SalonNotificationRecipientSource, string | null | undefined]> = [
    ['configured', input.recipientEmail],
    ['owner', input.ownerEmail],
    ['salon_account', input.salonEmail],
  ];

  for (const [source, value] of candidates) {
    const parsed = emailSchema.safeParse(value ?? '');
    if (parsed.success) {
      return { email: parsed.data, source };
    }
  }

  return {
    email: null,
    source: null,
    reason: 'NO_SALON_NOTIFICATION_RECIPIENT',
  };
}

export function isSalonEmailNotificationEnabled(
  settings: SalonEmailNotificationSettings,
  event: SalonEmailNotificationEvent,
): boolean {
  return settings[event];
}
