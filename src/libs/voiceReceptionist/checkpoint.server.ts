import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { after } from 'next/server';
import twilio from 'twilio';

import { readCustomerBookingStatus } from '@/libs/customerAssistant/bookingStatus.server';
import { readCustomerBookingOperation } from '@/libs/customerAssistant/operationStore.server';
import { db } from '@/libs/DB';
import { getSalonById } from '@/libs/queries';
import { voiceCallSchema, voiceReceptionistSettingsSchema } from '@/models/Schema';

import { commitVoiceBooking, runVoiceConsultation, type VoiceSalon } from './authority.server';
import { finalizedVoiceSmsChoice, formatVoiceCheckpointReview, isFinalizedVoiceConsent, verifyVoiceCheckpointToken, type VoiceCheckpointPhase, voiceCheckpointToken, voiceCheckpointTwiml } from './checkpoint';
import { getVoiceRuntimeConfig, VOICE_CALL_LIMIT_SECONDS, type VoiceRuntimeConfig } from './config.server';
import { correctVoiceContact } from './conversation';
import { sendVoiceDepositLink } from './depositDelivery.server';
import { reconcileVoiceCallBooking } from './recovery.server';
import { readVoiceBody, verifyVoiceTwilio, voiceRouteToken, voiceTokenHash } from './security.server';
import type { VoiceCallState } from './state';
import { claimVoiceLease, getVoiceCall, redactVoiceDraft, releaseVoiceLease, renewVoiceLease, saveVoiceCall } from './storage.server';
import { voiceDialTwiml } from './transport.server';

type VoiceCall = NonNullable<Awaited<ReturnType<typeof getVoiceCall>>>;

function xml(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function finish(message: string, language: 'en' | 'es' = 'en') {
  const response = new twilio.twiml.VoiceResponse();
  response.say({ voice: language === 'es' ? 'Polly.Lupe' : 'Polly.Joanna', language: language === 'es' ? 'es-US' : 'en-US' }, message);
  response.hangup();
  return xml(response.toString());
}

/** Replaces only this active parent call; no account/number routing is changed. */
export async function requestVoiceCheckpoint(args: { call: VoiceCall; state: VoiceCallState; config: VoiceRuntimeConfig; leaseToken: string; language: 'en' | 'es' }): Promise<void> {
  const { call, state, config } = args;
  if (call.provider !== 'twilio' || !state.booking.operation || !state.booking.review || !state.booking.contact) {
    throw new Error('VOICE_CHECKPOINT_UNAVAILABLE');
  }
  const text = formatVoiceCheckpointReview(state.booking.review, args.language, state.booking.contact);
  const remainingSeconds = Math.floor((call.createdAt.getTime() + VOICE_CALL_LIMIT_SECONDS * 1000 - Date.now()) / 1000);
  if (remainingSeconds < text.split(/\s+/).length / 2 + 20) {
    throw new Error('VOICE_CALL_DEADLINE');
  }
  state.confirmation = { id: randomUUID(), revision: state.booking.operation.revision, fingerprint: state.booking.operation.fingerprint, expiresAt: state.booking.operation.expiresAt, language: args.language, stage: 'pending' };
  const saved = await saveVoiceCall(call.id, call.salonId, args.leaseToken, { status: 'awaiting_confirmation', draft: redactVoiceDraft(state) });
  if (!saved) {
    throw new Error('VOICE_LEASE_LOST');
  }
  // The finalized Gather route takes a new fenced lease; the Live transcript
  // connection no longer has booking authority or ownership of call state.
  await releaseVoiceLease(call.id, call.salonId, args.leaseToken);
  try {
    await twilio(config.twilioAccountSid, config.twilioAuthToken, { timeout: 7000, autoRetry: false })
      .calls(call.providerCallId).update({ twiml: voiceCheckpointTwiml(call, state.confirmation, state.booking.review, config.origin, config.signingSecret, state.booking.contact), timeLimit: VOICE_CALL_LIMIT_SECONDS });
  } catch {
    // A saved checkpoint without its TwiML handoff is unusable. Revoke it and
    // terminate this parent call so no awaiting-confirmation zombie remains.
    state.confirmation = { ...state.confirmation, stage: 'revoked' };
    await db.update(voiceCallSchema).set({ draft: redactVoiceDraft(state, true), status: 'failed', endedAt: new Date(), outcome: 'checkpoint_handoff_failed', updatedAt: new Date() }).where(and(
      eq(voiceCallSchema.id, call.id),
      eq(voiceCallSchema.salonId, call.salonId),
      eq(voiceCallSchema.status, 'awaiting_confirmation'),
      isNull(voiceCallSchema.endedAt),
      sql`${voiceCallSchema.draft}->'confirmation'->>'id' = ${state.confirmation.id}`,
      sql`${voiceCallSchema.draft}->'confirmation'->>'stage' = 'pending'`,
    ));
    await twilio(config.twilioAccountSid, config.twilioAuthToken, { timeout: 5000, autoRetry: false })
      .calls(call.providerCallId).update({ status: 'completed' }).catch(() => undefined);
    throw new Error('VOICE_CHECKPOINT_HANDOFF_FAILED');
  }
}

function waiting(call: VoiceCall, state: VoiceCallState, config: VoiceRuntimeConfig, initial = false): Response {
  const checkpoint = state.confirmation!;
  const response = new twilio.twiml.VoiceResponse();
  if (initial) {
    const message = checkpoint.stage === 'resuming'
      ? checkpoint.language === 'es' ? 'Revisemos ese cambio.' : 'Let\'s check that change.'
      : checkpoint.language === 'es' ? 'Estoy procesando tu reserva.' : 'I am processing your booking.';
    response.say({ voice: checkpoint.language === 'es' ? 'Polly.Lupe' : 'Polly.Joanna', language: checkpoint.language === 'es' ? 'es-US' : 'en-US' }, message);
  }
  response.pause({ length: 2 });
  response.redirect({ method: 'POST' }, `${config.origin}/api/voice/twilio/booking-status?call=${encodeURIComponent(call.id)}&token=${voiceCheckpointToken(call, checkpoint, 'booking-status', config.signingSecret)}`);
  return xml(response.toString());
}

function completed(state: VoiceCallState): Response {
  const language = state.confirmation!.language;
  const es = language === 'es';
  const status = state.bookingStatus?.status;
  if (status === 'confirmed') {
    return finish(es ? 'Tu cita está reservada. Luster enviará la confirmación habitual. Gracias.' : 'Your appointment is booked. Luster will send the usual confirmation. Thank you.', language);
  }
  if (status === 'awaiting_approval') {
    return finish(es ? 'El salón ha recibido tu solicitud. Debe aprobarla antes de que la cita esté confirmada.' : 'Your appointment request has been received. The salon must approve it before it is confirmed.', language);
  }
  if (status === 'payment_required' || status === 'payment_processing') {
    const message = state.depositDelivery === 'accepted'
      ? es ? 'Tu cita está pendiente del depósito. Hemos enviado el enlace de pago seguro por correo. Revisa tu correo y completa el pago antes de que venza la reserva.' : 'Your appointment is waiting for the deposit. We have sent the secure payment link by email. Please check your email and pay before the hold expires.'
      : es ? 'Tu cita sigue pendiente del depósito y no he podido confirmar el envío del enlace. Contacta con el salón antes de hacer otra reserva.' : 'Your appointment is still waiting for the deposit, and I could not confirm the payment link was sent. Please contact the salon before making another booking.';
    return finish(message, language);
  }
  if (status === 'not_created' || status === 'expired' || status === 'cancelled') {
    return finish(es ? 'Esta reserva no está confirmada. Usa la página de reservas o contacta con el salón para elegir otra hora.' : 'This booking is not confirmed. Please use the booking page or contact the salon to choose another time.', language);
  }
  return finish(es ? 'No pude confirmar el resultado con seguridad. Consulta con el salón antes de hacer otra reserva.' : 'I could not safely confirm the result. Please check with the salon before making another booking.', language);
}

async function resumeVoice(call: VoiceCall, state: VoiceCallState, leaseToken: string, config: VoiceRuntimeConfig, message: string, smsChoice?: NonNullable<ReturnType<typeof finalizedVoiceSmsChoice>>): Promise<void> {
  const salon = await getSalonById(call.salonId);
  if (!salon) {
    throw new Error('VOICE_SALON_UNAVAILABLE');
  }
  if (smsChoice && state.contact) {
    // A signed deterministic choice invalidates the old review. Do not send
    // this narrowly-scoped correction to Luna or treat it as booking assent.
    state.contact = { ...state.contact, smsConsent: smsChoice, step: 'complete' };
    state.booking.contact = null;
    state.booking.review = null;
  } else if (message && message.length <= 1200) {
    const contact = correctVoiceContact(state.contact, message);
    if (contact) {
      state.contact = contact;
      state.booking.contact = null;
    } else {
      const result = await runVoiceConsultation({ salon: salon as VoiceSalon, draft: state.booking, message, voiceApiKey: config.apiKey });
      state.booking = result.draft;
    }
  }
  if (state.contact?.step === 'complete') {
    state.contact = { ...state.contact, step: 'verify' };
  }
  const routeExpiresAt = new Date(Math.min(Date.now() + 180_000, call.createdAt.getTime() + VOICE_CALL_LIMIT_SECONDS * 1000));
  const token = voiceRouteToken({ ...call, routeExpiresAt }, config.signingSecret);
  state.confirmation = { ...state.confirmation!, stage: 'resumed' };
  const [reset] = await db.update(voiceCallSchema).set({ draft: redactVoiceDraft(state), status: 'created', liveSessionId: null, routeTokenHash: voiceTokenHash(token), routeExpiresAt, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(voiceCallSchema.id, call.id), eq(voiceCallSchema.salonId, call.salonId), eq(voiceCallSchema.leaseToken, leaseToken), gt(voiceCallSchema.leaseExpiresAt, new Date()), isNull(voiceCallSchema.endedAt), sql`${voiceCallSchema.draft}->'confirmation'->>'id' = ${state.confirmation.id}`, sql`${voiceCallSchema.draft}->'confirmation'->>'stage' = 'resuming'`)).returning();
  if (!reset) {
    throw new Error('VOICE_LEASE_LOST');
  }
}

async function commitCheckpoint(call: VoiceCall, state: VoiceCallState, leaseToken: string, config: VoiceRuntimeConfig, request: Request): Promise<void> {
  const draft = state.booking;
  const checkpoint = state.confirmation!;
  const salon = await getSalonById(call.salonId);
  if (!salon || !draft.operation) {
    throw new Error('VOICE_SALON_UNAVAILABLE');
  }
  let status;
  const started = performance.now();
  try {
    status = await commitVoiceBooking({ salon, draft, request, secret: config.signingSecret, policyAccepted: true, executionGuard: async (tx) => {
      const [row] = await tx.select({ draft: voiceCallSchema.draft }).from(voiceCallSchema).where(and(eq(voiceCallSchema.id, call.id), eq(voiceCallSchema.salonId, call.salonId), eq(voiceCallSchema.leaseToken, leaseToken), eq(voiceCallSchema.status, 'awaiting_confirmation'), gt(voiceCallSchema.leaseExpiresAt, new Date()), isNull(voiceCallSchema.endedAt))).for('update');
      const [permission] = await tx.select().from(voiceReceptionistSettingsSchema).where(eq(voiceReceptionistSettingsSchema.salonId, call.salonId)).for('share');
      const saved = row?.draft as VoiceCallState | null;
      const savedCheckpoint = saved?.confirmation;
      if (!row || !permission?.enabled || !permission.bookingEnabled || !getVoiceRuntimeConfig('phone') || !saved?.consentHash || savedCheckpoint?.id !== checkpoint.id || savedCheckpoint.stage !== 'committing' || savedCheckpoint.revision !== draft.operation!.revision || savedCheckpoint.fingerprint !== draft.operation!.fingerprint || Date.parse(savedCheckpoint.expiresAt) <= Date.now() || Date.now() >= call.createdAt.getTime() + VOICE_CALL_LIMIT_SECONDS * 1000) {
        throw new Error('VOICE_CHECKPOINT_REVOKED');
      }
    } });
  } catch {
    const operation = await readCustomerBookingOperation({ salonId: call.salonId, capability: draft.operation.capability, secret: config.signingSecret });
    if (!operation.appointmentId) {
      throw new Error('VOICE_BOOKING_UNRESOLVED');
    }
    status = await readCustomerBookingStatus(operation, config.signingSecret);
  }
  state.bookingStatus = status;
  state.depositDelivery = 'not_required';
  if (status.status === 'payment_required') {
    state.depositDelivery = await sendVoiceDepositLink({ salonId: call.salonId, capability: draft.operation.capability, secret: config.signingSecret });
  }
  checkpoint.stage = 'committed';
  const outcome = status.status === 'confirmed' ? 'booked' : status.status === 'payment_required' || status.status === 'payment_processing' ? 'deposit_pending' : status.status;
  if (!await saveVoiceCall(call.id, call.salonId, leaseToken, { draft: state, status: 'completed', endedAt: new Date(), appointmentId: status.appointment?.id ?? null, outcome, metrics: { ...(call.metrics as Record<string, unknown> ?? {}), bookingAndDeliveryMs: Math.round(performance.now() - started) }, durationSeconds: Math.ceil((Date.now() - call.createdAt.getTime()) / 1000), summary: `${draft.review?.services.map(service => service.name).join(', ') ?? 'Booking'}; ${draft.review?.date ?? ''} ${draft.review?.time ?? ''}; ${outcome}; deposit link ${state.depositDelivery}.` })) {
    throw new Error('VOICE_LEASE_LOST');
  }
}

async function runCheckpointJob(call: VoiceCall, state: VoiceCallState, leaseToken: string, config: VoiceRuntimeConfig, request: Request, correction: string | null, smsChoice?: NonNullable<ReturnType<typeof finalizedVoiceSmsChoice>>): Promise<void> {
  const heartbeat = setInterval(() => {
    void renewVoiceLease(call.id, call.salonId, leaseToken, 90_000, { checkpointId: state.confirmation!.id }).catch(() => null);
  }, 20_000);
  try {
    if (correction !== null) {
      await resumeVoice(call, state, leaseToken, config, correction, smsChoice);
    } else {
      await commitCheckpoint(call, state, leaseToken, config, request);
    }
  } catch {
    // The same durable operation remains available for owner reconciliation;
    // an ambiguous result is never retried with a new booking identity.
    state.confirmation = { ...state.confirmation!, stage: 'revoked' };
    await saveVoiceCall(call.id, call.salonId, leaseToken, { draft: state, status: 'failed', endedAt: new Date(), outcome: state.bookingStatus?.appointment ? 'booking_result_unresolved' : 'step_unresolved', appointmentId: state.bookingStatus?.appointment?.id ?? null, summary: 'Could not safely complete the phone step. Check the linked booking before retrying.' }).catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
    await releaseVoiceLease(call.id, call.salonId, leaseToken).catch(() => undefined);
  }
}

export async function handleVoiceCheckpoint(request: Request, phase: VoiceCheckpointPhase): Promise<Response> {
  const config = getVoiceRuntimeConfig('phone');
  if (!config) {
    return new Response(null, { status: 503 });
  }
  const body = await readVoiceBody(request, 16_384);
  if (body === null) {
    return new Response(null, { status: 400 });
  }
  const form = new URLSearchParams(body);
  if ([...form.keys()].some(key => form.getAll(key).length !== 1)) {
    return new Response(null, { status: 400 });
  }
  const params = Object.fromEntries(form);
  if (!verifyVoiceTwilio(request, params, config)) {
    return new Response(null, { status: 403 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('call');
  const token = url.searchParams.get('token');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !token) {
    return new Response(null, { status: 400 });
  }
  const call = await getVoiceCall(id);
  const state = call?.draft as VoiceCallState | null;
  const checkpoint = state?.confirmation;
  if (!call || call.provider !== 'twilio' || call.providerAccountSid !== params.AccountSid || call.providerCallId !== params.CallSid || !checkpoint || !verifyVoiceCheckpointToken(token, call, checkpoint, phase, config.signingSecret)) {
    return new Response(null, { status: 403 });
  }
  if (checkpoint.stage === 'committed') {
    return completed(state!);
  }
  if (['committing', 'revoked'].includes(checkpoint.stage) && (!call.leaseExpiresAt || call.leaseExpiresAt <= new Date())) {
    const recovered = await reconcileVoiceCallBooking(call.id, call.salonId, config.signingSecret).catch(() => null);
    return completed(recovered ?? state!);
  }
  if (call.endedAt || checkpoint.stage === 'revoked' || Date.now() >= call.createdAt.getTime() + VOICE_CALL_LIMIT_SECONDS * 1000) {
    return completed(state!);
  }
  if (phase === 'booking-status' && checkpoint.stage === 'resumed') {
    return xml(voiceDialTwiml(call, config));
  }
  if (checkpoint.stage === 'committing' || checkpoint.stage === 'resuming') {
    // A replay or status poll cannot enqueue work or refresh booking consent.
    if (!call.leaseExpiresAt || call.leaseExpiresAt <= new Date()) {
      return completed(state!);
    }
    return waiting(call, state!, config);
  }
  if (phase === 'booking-status' || call.status !== 'awaiting_confirmation' || checkpoint.stage !== 'pending' || Date.parse(checkpoint.expiresAt) <= Date.now()) {
    return completed(state!);
  }
  const leaseToken = randomUUID();
  const claimed = await claimVoiceLease(call.id, leaseToken, 90_000);
  if (!claimed) {
    return waiting(call, state!, config);
  }
  let queued = false;
  try {
    // Revalidate the leased snapshot, including phase-scoped capability. No
    // delayed interruption can replace a newer draft or a newer checkpoint.
    const freshState = claimed.draft as VoiceCallState | null;
    const freshCheckpoint = freshState?.confirmation;
    if (claimed.providerAccountSid !== params.AccountSid || claimed.providerCallId !== params.CallSid || claimed.salonId !== call.salonId || !freshCheckpoint || !verifyVoiceCheckpointToken(token, claimed, freshCheckpoint, phase, config.signingSecret) || claimed.status !== 'awaiting_confirmation' || claimed.endedAt || freshCheckpoint.stage !== 'pending' || freshCheckpoint.id !== checkpoint.id || Date.parse(freshCheckpoint.expiresAt) <= Date.now()) {
      return completed(state!);
    }
    const smsChoice = finalizedVoiceSmsChoice(params);
    const correction = smsChoice || phase === 'review-interrupted' || !isFinalizedVoiceConsent(params)
      ? (smsChoice ? '' : (params.SpeechResult ?? '').slice(0, 1200))
      : null;
    if (correction !== null) {
      freshCheckpoint.stage = 'resuming';
      freshState!.booking.review = null;
      freshState!.consentHash = null;
      if (smsChoice && freshState!.contact) {
        freshState!.contact = { ...freshState!.contact, smsConsent: smsChoice, step: 'complete' };
        freshState!.booking.contact = null;
      }
    } else {
      const operation = freshState!.booking.operation;
      if (!operation || operation.revision !== freshCheckpoint.revision || operation.fingerprint !== freshCheckpoint.fingerprint) {
        return completed(freshState!);
      }
      freshCheckpoint.stage = 'committing';
      freshState!.consentHash = createHash('sha256').update(JSON.stringify([freshCheckpoint.id, params.CallSid, params.SpeechResult ?? null, params.Digits ?? null])).digest('hex');
    }
    if (!await saveVoiceCall(call.id, call.salonId, leaseToken, { draft: freshState })) {
      throw new Error('VOICE_LEASE_LOST');
    }
    // Next waits for this promise after responding to Twilio. No detached work
    // and no raw transcript stored in the database; correction stays in RAM.
    after(() => runCheckpointJob(claimed, freshState!, leaseToken, config, request, correction, smsChoice ?? undefined));
    queued = true;
    return waiting(claimed, freshState!, config, true);
  } catch {
    return completed(state!);
  } finally {
    if (!queued) {
      await releaseVoiceLease(call.id, call.salonId, leaseToken).catch(() => undefined);
    }
  }
}
