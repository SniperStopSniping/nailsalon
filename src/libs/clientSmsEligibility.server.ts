import 'server-only';

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  BOOKING_SMS_AUTHORITATIVE_WORDING_VERSIONS,
  type BookingSmsSelection,
  usesAuthoritativeBookingSmsChoice,
} from '@/libs/bookingSmsConsent';
import { db } from '@/libs/DB';
import { isValidPhone } from '@/libs/phone';
import { hasGlobalSuppression, normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { readSharedSenderEnvConfig } from '@/libs/smsSender';
import { communicationConsentSchema, salonClientSchema, salonTwilioConnectionSchema, smsGlobalConsentEventSchema } from '@/models/Schema';

export type ClientSmsPurpose = 'appointment_reminders' | 'appointment_transactional' | 'salon_promotions';
export type ClientSmsEligibility = {
  state: 'enabled' | 'customer_disabled' | 'opted_out' | 'unrecorded';
  selection: BookingSmsSelection | null;
};

type ConsentChoice = {
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  wordingVersion: string;
};

function resolveEligibility(input: {
  purpose: ClientSmsPurpose;
  purposeChoice?: ConsentChoice;
  reminderChoice?: ConsentChoice;
  transactionalChoice?: ConsentChoice;
  explicitChoice?: { selection: string; createdAt: Date };
  hasActiveClient: boolean;
  providerStopped: boolean;
  sharedStopped: boolean;
}): ClientSmsEligibility {
  if (input.sharedStopped || input.providerStopped) {
    return { state: 'opted_out', selection: null };
  }
  const independentlyRecordedChoice = input.purposeChoice !== undefined
    && usesAuthoritativeBookingSmsChoice(input.purposeChoice.wordingVersion)
    && !(input.explicitChoice?.selection === 'explicit_off'
      && input.explicitChoice.createdAt.getTime() > input.purposeChoice.createdAt.getTime());
  if (independentlyRecordedChoice && input.purposeChoice) {
    const recordedSelection = input.purposeChoice.metadata?.selection;
    return {
      state: input.purposeChoice.status === 'granted' ? 'enabled' : 'customer_disabled',
      selection: ['default_on', 'default_off', 'explicit_on', 'explicit_off'].includes(String(recordedSelection))
        ? recordedSelection as BookingSmsSelection
        : null,
    };
  }
  if (input.explicitChoice?.selection === 'explicit_off') {
    return { state: 'customer_disabled', selection: 'explicit_off' };
  }

  const purposeChoice = input.purposeChoice
    ?? (input.purpose === 'appointment_reminders' ? input.transactionalChoice : undefined)
    ?? (input.purpose === 'salon_promotions' ? input.transactionalChoice : undefined);
  const reminderChoice = input.purpose === 'appointment_reminders' ? purposeChoice : input.reminderChoice;
  const reminderExplicitlyOff = reminderChoice?.status === 'revoked'
    && (reminderChoice.metadata?.selection === 'explicit_off' || reminderChoice.metadata?.selectionWasExplicit === true);
  const reminderIsCurrent = !purposeChoice || (reminderChoice?.createdAt.getTime() ?? 0) > purposeChoice.createdAt.getTime();
  if (input.purpose !== 'appointment_reminders' && reminderExplicitlyOff && reminderIsCurrent) {
    return { state: 'customer_disabled', selection: 'explicit_off' };
  }

  const transactionalRevokedAfterPurpose = input.purpose !== 'appointment_transactional'
    && input.transactionalChoice?.status === 'revoked'
    && input.transactionalChoice.metadata?.selection !== 'default_off'
    && (!input.purposeChoice || input.transactionalChoice.createdAt.getTime() > input.purposeChoice.createdAt.getTime());
  if (transactionalRevokedAfterPurpose) {
    return { state: 'customer_disabled', selection: null };
  }

  const selection = purposeChoice?.metadata?.selection;
  const validSelection = ['default_on', 'default_off', 'explicit_on', 'explicit_off'].includes(String(selection))
    ? selection as BookingSmsSelection
    : null;
  if (purposeChoice?.status === 'revoked' && !(validSelection === 'default_off' && purposeChoice.metadata?.selectionWasExplicit !== true)) {
    return { state: 'customer_disabled', selection: validSelection };
  }
  if (purposeChoice?.status === 'granted' || input.hasActiveClient) {
    return { state: 'enabled', selection: validSelection ?? (input.hasActiveClient ? 'default_on' : null) };
  }
  return { state: 'unrecorded', selection: null };
}

/**
 * A usable active client profile supplies the platform's default-on choice
 * when no customer choice is recorded. This applies to profiles created before
 * or after the one-time backfill, including owner-created clients. Explicit
 * choices and provider STOP always take precedence over that default.
 */
export async function getClientSmsPurposeEligibility(input: {
  salonId: string;
  phone: string;
  purpose: ClientSmsPurpose;
  database?: Pick<typeof db, 'select'>;
}): Promise<ClientSmsEligibility> {
  const database = input.database ?? db;
  const recipient = normalizeConsentRecipient(input.phone);
  if (!isValidPhone(recipient)) {
    return { state: 'unrecorded', selection: null };
  }
  const consentWhere = (purpose: ClientSmsPurpose) => and(
    eq(communicationConsentSchema.salonId, input.salonId),
    eq(communicationConsentSchema.recipient, recipient),
    eq(communicationConsentSchema.channel, 'sms'),
    eq(communicationConsentSchema.purpose, purpose),
    sql`${communicationConsentSchema.source} <> 'twilio_inbound'`,
    sql`coalesce(${communicationConsentSchema.metadata} ->> 'bookingSmsMode', '') <> 'disabled'`,
  );
  const [connection, provider, purposeRows, reminderRows, transactionalRows, explicitChoices, clients] = await Promise.all([
    database.select({ salonId: salonTwilioConnectionSchema.salonId }).from(salonTwilioConnectionSchema)
      .where(eq(salonTwilioConnectionSchema.salonId, input.salonId)).limit(1),
    database.select({ status: communicationConsentSchema.status }).from(communicationConsentSchema)
      .where(and(
        eq(communicationConsentSchema.salonId, input.salonId),
        eq(communicationConsentSchema.recipient, recipient),
        eq(communicationConsentSchema.channel, 'sms'),
        eq(communicationConsentSchema.purpose, 'appointment_transactional'),
        eq(communicationConsentSchema.source, 'twilio_inbound'),
      )).orderBy(desc(communicationConsentSchema.createdAt), desc(communicationConsentSchema.id)).limit(1),
    database.select({ status: communicationConsentSchema.status, metadata: communicationConsentSchema.metadata, createdAt: communicationConsentSchema.createdAt, wordingVersion: communicationConsentSchema.wordingVersion })
      .from(communicationConsentSchema).where(consentWhere(input.purpose))
      .orderBy(desc(communicationConsentSchema.createdAt), desc(communicationConsentSchema.id)).limit(1),
    database.select({ status: communicationConsentSchema.status, metadata: communicationConsentSchema.metadata, createdAt: communicationConsentSchema.createdAt, wordingVersion: communicationConsentSchema.wordingVersion })
      .from(communicationConsentSchema).where(consentWhere(input.purpose === 'appointment_reminders' ? 'appointment_transactional' : 'appointment_reminders'))
      .orderBy(desc(communicationConsentSchema.createdAt), desc(communicationConsentSchema.id)).limit(1),
    input.purpose === 'salon_promotions'
      ? database.select({ status: communicationConsentSchema.status, metadata: communicationConsentSchema.metadata, createdAt: communicationConsentSchema.createdAt, wordingVersion: communicationConsentSchema.wordingVersion })
        .from(communicationConsentSchema).where(consentWhere('appointment_transactional'))
        .orderBy(desc(communicationConsentSchema.createdAt), desc(communicationConsentSchema.id)).limit(1)
      : Promise.resolve([]),
    database.select({ selection: sql<string>`${communicationConsentSchema.metadata} ->> 'selection'`, createdAt: communicationConsentSchema.createdAt })
      .from(communicationConsentSchema)
      .where(and(
        eq(communicationConsentSchema.salonId, input.salonId),
        eq(communicationConsentSchema.recipient, recipient),
        eq(communicationConsentSchema.channel, 'sms'),
        sql`${communicationConsentSchema.metadata} ->> 'selection' in ('explicit_on', 'explicit_off')`,
        sql`${communicationConsentSchema.source} <> 'twilio_inbound'`,
        sql`${communicationConsentSchema.wordingVersion} <> ${BOOKING_SMS_AUTHORITATIVE_WORDING_VERSIONS[0]}`,
        sql`${communicationConsentSchema.wordingVersion} <> ${BOOKING_SMS_AUTHORITATIVE_WORDING_VERSIONS[1]}`,
      ))
      .orderBy(desc(communicationConsentSchema.createdAt), desc(communicationConsentSchema.id)).limit(1),
    database.select({ id: salonClientSchema.id }).from(salonClientSchema)
      .where(and(
        eq(salonClientSchema.salonId, input.salonId),
        or(
          eq(salonClientSchema.phone, recipient),
          sql`regexp_replace(${salonClientSchema.phone}, '[^0-9]', '', 'g') in (${recipient}, ${`1${recipient}`})`,
        ),
        isNull(salonClientSchema.archivedAt),
        isNull(salonClientSchema.mergedIntoClientId),
      )).limit(1),
  ]);
  const sharedStopped = connection.length === 0
    && await hasGlobalSuppression(readSharedSenderEnvConfig().senderIdentity, recipient, database);
  return resolveEligibility({
    purpose: input.purpose,
    purposeChoice: purposeRows[0],
    reminderChoice: input.purpose === 'appointment_reminders' ? undefined : reminderRows[0],
    transactionalChoice: input.purpose === 'appointment_transactional'
      ? purposeRows[0]
      : input.purpose === 'appointment_reminders' ? reminderRows[0] : transactionalRows[0],
    explicitChoice: explicitChoices[0],
    hasActiveClient: clients.length > 0,
    providerStopped: provider[0]?.status === 'revoked',
    sharedStopped,
  });
}

/** Bulk version for owner dashboards: a fixed number of scoped queries per page. */
export async function getClientSmsPurposeEligibilityBatch(input: {
  salonId: string;
  phones: string[];
  purpose: ClientSmsPurpose;
}): Promise<Map<string, boolean>> {
  const recipients = [...new Set(input.phones.map(normalizeConsentRecipient).filter(isValidPhone))];
  const result = new Map<string, boolean>();
  if (recipients.length === 0) {
    return result;
  }
  const recipientSet = new Set(recipients);
  const [connection, choices, explicitChoices, providerEvents, clients] = await Promise.all([
    db.select({ salonId: salonTwilioConnectionSchema.salonId }).from(salonTwilioConnectionSchema)
      .where(eq(salonTwilioConnectionSchema.salonId, input.salonId)).limit(1),
    db.selectDistinctOn([communicationConsentSchema.recipient, communicationConsentSchema.purpose], {
      recipient: communicationConsentSchema.recipient,
      purpose: communicationConsentSchema.purpose,
      status: communicationConsentSchema.status,
      metadata: communicationConsentSchema.metadata,
      createdAt: communicationConsentSchema.createdAt,
      wordingVersion: communicationConsentSchema.wordingVersion,
    }).from(communicationConsentSchema).where(and(
      eq(communicationConsentSchema.salonId, input.salonId),
      eq(communicationConsentSchema.channel, 'sms'),
      inArray(communicationConsentSchema.recipient, recipients),
      inArray(communicationConsentSchema.purpose, ['appointment_reminders', 'appointment_transactional', 'salon_promotions']),
      sql`${communicationConsentSchema.source} <> 'twilio_inbound'`,
      sql`coalesce(${communicationConsentSchema.metadata} ->> 'bookingSmsMode', '') <> 'disabled'`,
    )).orderBy(communicationConsentSchema.recipient, communicationConsentSchema.purpose, desc(communicationConsentSchema.createdAt), desc(communicationConsentSchema.id)),
    db.selectDistinctOn([communicationConsentSchema.recipient], {
      recipient: communicationConsentSchema.recipient,
      selection: sql<string>`${communicationConsentSchema.metadata} ->> 'selection'`,
      createdAt: communicationConsentSchema.createdAt,
    }).from(communicationConsentSchema).where(and(
      eq(communicationConsentSchema.salonId, input.salonId),
      eq(communicationConsentSchema.channel, 'sms'),
      inArray(communicationConsentSchema.recipient, recipients),
      sql`${communicationConsentSchema.metadata} ->> 'selection' in ('explicit_on', 'explicit_off')`,
      sql`${communicationConsentSchema.source} <> 'twilio_inbound'`,
      sql`${communicationConsentSchema.wordingVersion} <> ${BOOKING_SMS_AUTHORITATIVE_WORDING_VERSIONS[0]}`,
      sql`${communicationConsentSchema.wordingVersion} <> ${BOOKING_SMS_AUTHORITATIVE_WORDING_VERSIONS[1]}`,
    )).orderBy(communicationConsentSchema.recipient, desc(communicationConsentSchema.createdAt), desc(communicationConsentSchema.id)),
    db.selectDistinctOn([communicationConsentSchema.recipient], {
      recipient: communicationConsentSchema.recipient,
      status: communicationConsentSchema.status,
    }).from(communicationConsentSchema).where(and(
      eq(communicationConsentSchema.salonId, input.salonId),
      eq(communicationConsentSchema.channel, 'sms'),
      inArray(communicationConsentSchema.recipient, recipients),
      eq(communicationConsentSchema.purpose, 'appointment_transactional'),
      eq(communicationConsentSchema.source, 'twilio_inbound'),
    )).orderBy(communicationConsentSchema.recipient, desc(communicationConsentSchema.createdAt), desc(communicationConsentSchema.id)),
    db.select({ phone: salonClientSchema.phone }).from(salonClientSchema).where(and(
      eq(salonClientSchema.salonId, input.salonId),
      isNull(salonClientSchema.archivedAt),
      isNull(salonClientSchema.mergedIntoClientId),
    )),
  ]);
  const globalEvents = connection.length === 0
    ? await db.selectDistinctOn([smsGlobalConsentEventSchema.recipient], {
      recipient: smsGlobalConsentEventSchema.recipient,
      state: smsGlobalConsentEventSchema.state,
    }).from(smsGlobalConsentEventSchema).where(and(
      eq(smsGlobalConsentEventSchema.senderIdentity, readSharedSenderEnvConfig().senderIdentity),
      inArray(smsGlobalConsentEventSchema.recipient, recipients),
    )).orderBy(smsGlobalConsentEventSchema.recipient, desc(smsGlobalConsentEventSchema.seq))
    : [];
  const choiceMap = new Map(choices.map(row => [`${row.recipient}:${row.purpose}`, row]));
  const explicitMap = new Map(explicitChoices.map(row => [row.recipient, { selection: row.selection, createdAt: row.createdAt }]));
  const providerMap = new Map(providerEvents.map(row => [row.recipient, row.status]));
  const globalMap = new Map(globalEvents.map(row => [row.recipient, row.state]));
  const activePhones = new Set(clients.map(row => normalizeConsentRecipient(row.phone)).filter(phone => recipientSet.has(phone)));
  for (const recipient of recipients) {
    result.set(recipient, resolveEligibility({
      purpose: input.purpose,
      purposeChoice: choiceMap.get(`${recipient}:${input.purpose}`),
      reminderChoice: choiceMap.get(`${recipient}:appointment_reminders`),
      transactionalChoice: choiceMap.get(`${recipient}:appointment_transactional`),
      explicitChoice: explicitMap.get(recipient),
      hasActiveClient: activePhones.has(recipient),
      providerStopped: providerMap.get(recipient) === 'revoked',
      sharedStopped: globalMap.get(recipient) === 'suppressed',
    }).state === 'enabled');
  }
  return result;
}
