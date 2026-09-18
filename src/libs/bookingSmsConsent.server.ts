import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { BOOKING_SMS_SELECTIONS, type BookingSmsSelection } from '@/libs/bookingSmsConsent';
import { db } from '@/libs/DB';
import { hasGlobalSuppression, normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { readSharedSenderEnvConfig } from '@/libs/smsSender';
import { communicationConsentSchema, salonTwilioConnectionSchema } from '@/models/Schema';

export type AppointmentSmsPreference = {
  state: 'enabled' | 'customer_disabled' | 'opted_out' | 'salon_disabled' | 'unrecorded';
  selection: BookingSmsSelection | null;
};

/**
 * Reads the customer’s current appointment-reminder preference for a scoped
 * salon/client view. It deliberately does not consult a salon default: a
 * setting change must not rewrite or reinterpret historical customer events.
 */
export async function getAppointmentSmsPreference(
  salonId: string,
  phone: string,
  database: Pick<typeof db, 'select'> = db,
): Promise<AppointmentSmsPreference> {
  const recipient = normalizeConsentRecipient(phone);
  const [connection, providerEvent, latestReminderPreference, legacyPreference] = await Promise.all([
    database.select({ salonId: salonTwilioConnectionSchema.salonId }).from(salonTwilioConnectionSchema).where(eq(salonTwilioConnectionSchema.salonId, salonId)).limit(1),
    database.select({ status: communicationConsentSchema.status }).from(communicationConsentSchema).where(and(eq(communicationConsentSchema.salonId, salonId), eq(communicationConsentSchema.recipient, recipient), eq(communicationConsentSchema.channel, 'sms'), eq(communicationConsentSchema.purpose, 'appointment_transactional'), eq(communicationConsentSchema.source, 'twilio_inbound'))).orderBy(desc(communicationConsentSchema.createdAt)).limit(1),
    // A salon-disabled booking gates that one appointment only. It is never a
    // client preference and therefore cannot change the status of the
    // client's earlier appointments or their owner-visible preference.
    database.select({ status: communicationConsentSchema.status, metadata: communicationConsentSchema.metadata }).from(communicationConsentSchema).where(and(eq(communicationConsentSchema.salonId, salonId), eq(communicationConsentSchema.recipient, recipient), eq(communicationConsentSchema.channel, 'sms'), eq(communicationConsentSchema.purpose, 'appointment_reminders'), sql`coalesce(${communicationConsentSchema.metadata} ->> 'bookingSmsMode', '') <> 'disabled'`)).orderBy(desc(communicationConsentSchema.createdAt)).limit(1),
    database.select({ status: communicationConsentSchema.status, metadata: communicationConsentSchema.metadata }).from(communicationConsentSchema).where(and(eq(communicationConsentSchema.salonId, salonId), eq(communicationConsentSchema.recipient, recipient), eq(communicationConsentSchema.channel, 'sms'), eq(communicationConsentSchema.purpose, 'appointment_transactional'))).orderBy(desc(communicationConsentSchema.createdAt)).limit(1),
  ]);
  const sharedOptOut = connection.length === 0 && await hasGlobalSuppression(readSharedSenderEnvConfig().senderIdentity, recipient, database);
  if (sharedOptOut || providerEvent[0]?.status === 'revoked') {
    return { state: 'opted_out', selection: null };
  }
  const latestPreference = latestReminderPreference[0] ?? legacyPreference[0];
  const selection = latestPreference?.metadata?.selection;
  const validSelection = BOOKING_SMS_SELECTIONS.includes(selection as BookingSmsSelection) ? selection as BookingSmsSelection : null;
  if (latestPreference?.metadata?.bookingSmsMode === 'disabled') {
    return { state: 'salon_disabled', selection: validSelection };
  }
  if (latestPreference?.status === 'granted') {
    return { state: 'enabled', selection: validSelection };
  }
  if (latestPreference?.status === 'revoked') {
    return { state: 'customer_disabled', selection: validSelection };
  }
  return { state: 'unrecorded', selection: null };
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
  if (appointmentDecision?.status === 'revoked') {
    const selection = appointmentDecision.metadata?.selection;
    return { state: 'customer_disabled', selection: BOOKING_SMS_SELECTIONS.includes(selection as BookingSmsSelection) ? selection as BookingSmsSelection : null };
  }
  return preference;
}

export async function isAppointmentSmsEligible(input: Parameters<typeof getAppointmentSmsDeliveryPreference>[0]): Promise<boolean> {
  return (await getAppointmentSmsDeliveryPreference(input)).state === 'enabled';
}
