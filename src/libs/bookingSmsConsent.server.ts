import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { BOOKING_SMS_SELECTIONS, type BookingSmsSelection } from '@/libs/bookingSmsConsent';
import { getClientSmsPurposeEligibility } from '@/libs/clientSmsEligibility.server';
import { db } from '@/libs/DB';
import { normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { communicationConsentSchema } from '@/models/Schema';

export type AppointmentSmsPreference = {
  state: 'enabled' | 'customer_disabled' | 'opted_out' | 'salon_disabled' | 'unrecorded';
  selection: BookingSmsSelection | null;
};

/**
 * Reads the customer's current appointment-reminder preference for a scoped
 * salon/client view. A profile without a recorded choice uses the platform
 * default; a recorded explicit choice and STOP remain authoritative.
 */
export async function getAppointmentSmsPreference(
  salonId: string,
  phone: string,
  database: Pick<typeof db, 'select'> = db,
): Promise<AppointmentSmsPreference> {
  return getClientSmsPurposeEligibility({ salonId, phone, purpose: 'appointment_reminders', database });
}

/**
 * Delivery predicate for an appointment lifecycle. An appointment-specific
 * booking decision wins over an older or newer preference for another booking;
 * this is what keeps a disabled-at-booking deposit from being texted later.
 */
export async function getAppointmentSmsDeliveryPreference(input: {
  salonId: string;
  phone: string;
  appointmentId: string;
  /** A caller already holding a booking/payment transaction can pass its handle. */
  database?: Pick<typeof db, 'select'>;
}): Promise<AppointmentSmsPreference> {
  const database = input.database ?? db;
  const recipient = normalizeConsentRecipient(input.phone);
  const preference = await getAppointmentSmsPreference(input.salonId, recipient, database);
  if (preference.state === 'opted_out') {
    return preference;
  }
  const [appointmentDecision] = await database.select({ status: communicationConsentSchema.status, metadata: communicationConsentSchema.metadata })
    .from(communicationConsentSchema)
    .where(and(
      eq(communicationConsentSchema.salonId, input.salonId),
      eq(communicationConsentSchema.recipient, recipient),
      eq(communicationConsentSchema.channel, 'sms'),
      eq(communicationConsentSchema.purpose, 'appointment_reminders'),
      sql`${communicationConsentSchema.metadata} ->> 'appointmentId' = ${input.appointmentId}`,
    ))
    .orderBy(desc(communicationConsentSchema.createdAt))
    .limit(1);
  // Historic appointments predate per-booking decision metadata. Preserve
  // their current consent behavior until a scoped booking record exists.
  if (appointmentDecision?.metadata?.bookingSmsMode === 'disabled') {
    return { state: 'salon_disabled', selection: null };
  }
  if (appointmentDecision?.status === 'revoked'
    && !(appointmentDecision.metadata?.selection === 'default_off' && appointmentDecision.metadata?.selectionWasExplicit !== true)) {
    const selection = appointmentDecision.metadata?.selection;
    return { state: 'customer_disabled', selection: BOOKING_SMS_SELECTIONS.includes(selection as BookingSmsSelection) ? selection as BookingSmsSelection : null };
  }
  return preference;
}

export async function isAppointmentSmsEligible(input: Parameters<typeof getAppointmentSmsDeliveryPreference>[0]): Promise<boolean> {
  return (await getAppointmentSmsDeliveryPreference(input)).state === 'enabled';
}
