import 'server-only';

import { createHmac } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { enqueueCommunicationIntent } from '@/libs/communicationIntent';
import { COMMUNICATION_TEMPLATES, MAX_SEGMENTS_BY_AUDIENCE } from '@/libs/communicationTemplates';
import { db } from '@/libs/DB';
import { buildSalonTenantPublicUrl } from '@/libs/publicUrl';
import { normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { resolveSmsDestination } from '@/libs/smsDestination';
import { calculateSmsSegments } from '@/libs/smsSegments';
import { communicationIntentSchema, customerBookingOperationSchema, salonSchema, voiceCallSchema } from '@/models/Schema';

import type { VoiceCallState } from './state';
import { redactVoiceDraft } from './storage.server';

export function voiceBookingLinkRecipientHash(recipient: string): string {
  const secret = process.env.VOICE_RECEPTIONIST_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('VOICE_BOOKING_LINK_SIGNING_SECRET_UNAVAILABLE');
  }
  return createHmac('sha256', secret).update(normalizeConsentRecipient(recipient)).digest('hex');
}

/** The call lease and a caller request own one public-link intent. */
export async function queueVoiceBookingLink(input: {
  salonId: string;
  callId: string;
  leaseToken: string;
  liveSessionId: string;
  pendingId?: string;
  callerId?: true;
  phone: string;
  isCurrent?: () => boolean;
}): Promise<{ intentId: string; created: boolean; authority: NonNullable<VoiceCallState['bookingLinkAuthority']> }> {
  const now = new Date();
  const recipient = normalizeConsentRecipient(input.phone);
  const destination = resolveSmsDestination({ rawPhone: recipient, storedCountry: 'CA' });
  if (!destination.supported) {
    throw new Error('VOICE_BOOKING_LINK_DESTINATION_UNSUPPORTED');
  }
  return db.transaction(async (tx) => {
    if (input.isCurrent && !input.isCurrent()) {
      throw new Error('VOICE_BOOKING_LINK_TURN_SUPERSEDED');
    }
    const [call] = await tx.select().from(voiceCallSchema).where(and(
      eq(voiceCallSchema.id, input.callId),
      eq(voiceCallSchema.salonId, input.salonId),
    )).for('update').limit(1);
    const draft = call?.draft as VoiceCallState | null;
    const confirmedNumber = input.callerId !== true && !!input.pendingId
      && draft?.bookingLinkPending?.id === input.pendingId
      && draft?.bookingLinkPending?.phone === recipient;
    const requestedCallerId = input.callerId === true && !input.pendingId
      && !draft?.bookingLinkPending
      && !draft?.bookingLinkAttempted
      && call?.callerNumber === destination.e164;
    if (!call || call.provider !== 'twilio' || call.liveSessionId !== input.liveSessionId
      || call.leaseToken !== input.leaseToken || !call.leaseExpiresAt || call.leaseExpiresAt <= now
      || call.endedAt || !['connected', 'in_progress'].includes(call.status)
      || call.appointmentId || draft?.bookingStatus?.appointment || draft?.consentHash || draft?.confirmation
      || (!confirmedNumber && !requestedCallerId)) {
      throw new Error('VOICE_BOOKING_LINK_CALL_STALE');
    }
    const operation = draft?.booking?.operation;
    if (operation) {
      // Checkpoint commits lock this voice call row before creating or linking an
      // appointment. Holding that same row means a concurrent commit either
      // finishes before this read or cannot pass its execution guard. Do not
      // lock the operation here: the commit path locks it first.
      const [canonicalOperation] = await tx.select({
        revision: customerBookingOperationSchema.revision,
        requestHash: customerBookingOperationSchema.requestHash,
        appointmentId: customerBookingOperationSchema.appointmentId,
        committedAt: customerBookingOperationSchema.committedAt,
      }).from(customerBookingOperationSchema).where(and(
        eq(customerBookingOperationSchema.salonId, input.salonId),
        eq(customerBookingOperationSchema.sessionId, call.id),
      )).limit(1);
      if (!canonicalOperation || canonicalOperation.revision !== operation.revision
        || canonicalOperation.requestHash !== operation.fingerprint
        || canonicalOperation.appointmentId || canonicalOperation.committedAt) {
        throw new Error('VOICE_BOOKING_LINK_CALL_STALE');
      }
    }
    const [salon] = await tx.select({ name: salonSchema.name, slug: salonSchema.slug, customDomain: salonSchema.customDomain, isActive: salonSchema.isActive, deletedAt: salonSchema.deletedAt })
      .from(salonSchema).where(eq(salonSchema.id, input.salonId)).limit(1);
    if (!salon || !salon.isActive || salon.deletedAt) {
      throw new Error('VOICE_BOOKING_LINK_SALON_UNAVAILABLE');
    }
    const bookingUrl = buildSalonTenantPublicUrl('/book/service', salon);
    if (new URL(bookingUrl).protocol !== 'https:' || calculateSmsSegments(COMMUNICATION_TEMPLATES.client_voice_booking_link!.render({ salonName: salon.name, bookingUrl })).segments > MAX_SEGMENTS_BY_AUDIENCE.client) {
      throw new Error('VOICE_BOOKING_LINK_URL_UNAVAILABLE');
    }
    const dedupeKey = `voice-booking-link:${input.salonId}:${input.callId}`;
    const [existing] = await tx.select().from(communicationIntentSchema).where(and(
      eq(communicationIntentSchema.salonId, input.salonId),
      eq(communicationIntentSchema.dedupeKey, dedupeKey),
    )).limit(1);
    if (existing && (existing.eventType !== 'voice_booking_link' || existing.recipient !== recipient
      || existing.variables.bookingUrl !== bookingUrl || existing.templateKey !== 'client_voice_booking_link')) {
      throw new Error('VOICE_BOOKING_LINK_ALREADY_REQUESTED_FOR_ANOTHER_NUMBER');
    }
    if (input.isCurrent && !input.isCurrent()) {
      throw new Error('VOICE_BOOKING_LINK_TURN_SUPERSEDED');
    }
    const queued = existing
      ? { intentId: existing.id, created: false }
      : await enqueueCommunicationIntent({
        database: tx,
        salonId: input.salonId,
        channel: 'sms',
        eventType: 'voice_booking_link',
        audience: 'client',
        dedupeKey,
        recipient,
        destinationCountry: 'CA',
        templateKey: 'client_voice_booking_link',
        templateVersion: 'v1',
        variables: { bookingUrl, callId: input.callId },
        schedulingRevision: `voice-booking-link:${input.callId}`,
        scheduledFor: now,
        notAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      });
    const authority = { intentId: queued.intentId, recipientHash: voiceBookingLinkRecipientHash(recipient) };
    await tx.update(voiceCallSchema).set({
      draft: redactVoiceDraft({ ...draft, bookingLinkPending: null, bookingLinkAuthority: authority, bookingLinkAttempted: true }),
      summary: 'Caller requested a public booking link by text; no appointment was created.',
      outcome: 'booking_link_requested',
      updatedAt: now,
    }).where(and(eq(voiceCallSchema.id, call.id), eq(voiceCallSchema.salonId, input.salonId)));
    if (input.isCurrent && !input.isCurrent()) {
      throw new Error('VOICE_BOOKING_LINK_TURN_SUPERSEDED');
    }
    return { ...queued, authority };
  });
}

/** A later correction revokes even when the provider already ended the call. */
export async function revokeVoiceBookingLinkAuthority(input: {
  salonId: string;
  callId: string;
  liveSessionId: string;
  intentId: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [call] = await tx.select().from(voiceCallSchema).where(and(eq(voiceCallSchema.id, input.callId), eq(voiceCallSchema.salonId, input.salonId))).for('update').limit(1);
    const draft = call?.draft as VoiceCallState | null;
    if (!call || call.liveSessionId !== input.liveSessionId || draft?.bookingLinkAuthority?.intentId !== input.intentId) {
      return false;
    }
    await tx.update(voiceCallSchema).set({
      draft: redactVoiceDraft({ ...draft, bookingLinkAuthority: null, bookingLinkAttempted: true }, !!call.endedAt),
      updatedAt: new Date(),
    }).where(and(eq(voiceCallSchema.id, call.id), eq(voiceCallSchema.salonId, input.salonId)));
    return true;
  });
}

/** Re-read one-time authority and call completion before provider dispatch. */
export async function voiceBookingLinkSendState(input: {
  salonId: string;
  intentId: string;
  callId: string;
  recipient: string;
}, now = new Date()): Promise<'pending' | 'authorized' | 'invalid'> {
  const [call] = await db.select({ provider: voiceCallSchema.provider, status: voiceCallSchema.status, endedAt: voiceCallSchema.endedAt, appointmentId: voiceCallSchema.appointmentId, draft: voiceCallSchema.draft })
    .from(voiceCallSchema).where(and(eq(voiceCallSchema.id, input.callId), eq(voiceCallSchema.salonId, input.salonId))).limit(1);
  const draft = call?.draft as VoiceCallState | null;
  if (call?.provider !== 'twilio' || call.appointmentId || draft?.bookingStatus?.appointment || draft?.consentHash || draft?.confirmation
    || draft?.bookingLinkAuthority?.intentId !== input.intentId
    || draft.bookingLinkAuthority.recipientHash !== voiceBookingLinkRecipientHash(input.recipient)) {
    return 'invalid';
  }
  const [canonicalOperation] = await db.select({
    revision: customerBookingOperationSchema.revision,
    requestHash: customerBookingOperationSchema.requestHash,
    appointmentId: customerBookingOperationSchema.appointmentId,
    committedAt: customerBookingOperationSchema.committedAt,
  }).from(customerBookingOperationSchema).where(and(
    eq(customerBookingOperationSchema.salonId, input.salonId),
    eq(customerBookingOperationSchema.sessionId, input.callId),
  )).limit(1);
  const operation = draft?.booking?.operation;
  if (canonicalOperation?.appointmentId || canonicalOperation?.committedAt
    || (operation && (!canonicalOperation || canonicalOperation.revision !== operation.revision
      || canonicalOperation.requestHash !== operation.fingerprint))) {
    return 'invalid';
  }
  if (call.status === 'completed' && call.endedAt) {
    return call.endedAt.getTime() + 30_000 <= now.getTime() ? 'authorized' : 'pending';
  }
  return !call.endedAt && ['connected', 'in_progress'].includes(call.status) ? 'pending' : 'invalid';
}

export async function hasVoiceBookingLinkAuthority(input: {
  salonId: string;
  intentId: string;
  callId: string;
  recipient: string;
}, now = new Date()): Promise<boolean> {
  return await voiceBookingLinkSendState(input, now) === 'authorized';
}
