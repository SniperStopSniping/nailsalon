import { createHmac, timingSafeEqual } from 'node:crypto';

import twilio from 'twilio';

import type { BookingSmsConsentInput } from '@/libs/bookingSmsConsent';
import type { CustomerReadyReviewSnapshot } from '@/libs/customerAssistant/reviewContracts';

import { isExplicitVoiceBookingConsent, normalizedSpeech } from './conversation';
import type { VoiceCheckpoint } from './state';

type CheckpointCall = { id: string; salonId: string; providerCallId: string; providerAccountSid: string | null };
export type VoiceCheckpointPhase = 'confirm' | 'review-interrupted' | 'booking-status';

export function voiceCheckpointToken(call: CheckpointCall, checkpoint: VoiceCheckpoint, phase: VoiceCheckpointPhase, secret: string): string {
  return createHmac('sha256', secret).update(JSON.stringify(['luster.voice.confirmation.v1', call.id, call.salonId, call.providerAccountSid, call.providerCallId, checkpoint.id, checkpoint.revision, checkpoint.fingerprint, checkpoint.expiresAt, phase])).digest('base64url');
}

export function verifyVoiceCheckpointToken(token: string, call: CheckpointCall, checkpoint: VoiceCheckpoint, phase: VoiceCheckpointPhase, secret: string): boolean {
  const expected = Buffer.from(voiceCheckpointToken(call, checkpoint, phase, secret));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isFinalVoiceBookingAffirmation(text: string): boolean {
  const speech = normalizedSpeech(text);
  return /^(?:(?:yes|yeah|yep)(?: please)?(?: book (?:it|that|the appointment))?|si(?: por favor)?)$/.test(speech)
    || isExplicitVoiceBookingConsent(text);
}

export function isFinalizedVoiceConsent(params: Record<string, string>): boolean {
  // Digits and SpeechResult are finalized Twilio Gather results from a signed
  // callback, never Live fragments, model output or a client JSON boolean.
  if (params.Digits === '1' && !params.SpeechResult) {
    return true;
  }
  if (params.Digits || !params.SpeechResult || !params.Confidence) {
    return false;
  }
  const confidence = Number(params.Confidence);
  if (!Number.isFinite(confidence) || confidence < 0.8 || confidence > 1) {
    return false;
  }
  // The signed confirm Gather follows a completed, separate booking review and
  // asks a direct yes/no question. A standalone affirmative is explicit here,
  // but remains insufficient in Live speech or during the review Gather.
  return isFinalVoiceBookingAffirmation(params.SpeechResult);
}

/** A signed, high-confidence Twilio correction is the only voice SMS choice. */
export function finalizedVoiceSmsChoice(params: Record<string, string>): BookingSmsConsentInput | null {
  if (params.Digits || !params.SpeechResult || !params.Confidence) {
    return null;
  }
  const confidence = Number(params.Confidence);
  if (!Number.isFinite(confidence) || confidence < 0.8 || confidence > 1) {
    return null;
  }
  const speech = normalizedSpeech(params.SpeechResult.replace(/[’']/g, ''));
  const selection = /^(?:no texts(?: please)?|dont text me|do not text me|no me mandes textos|no me envies textos|no textos(?: por favor)?)$/.test(speech)
    ? 'explicit_off' as const
    : /^(?:yes texts please|yes text me|si textos por favor|si mandame textos|si enviame textos)$/.test(speech)
      ? 'explicit_on' as const
      : null;
  return selection
    ? { granted: selection === 'explicit_on', selection, wordingVersion: 'booking-sms-reminders-v1' }
    : null;
}

function reminderDisclosure(review: CustomerReadyReviewSnapshot, language: 'en' | 'es'): string {
  const reminders = review.reminders;
  if (!reminders || reminders.mode === 'disabled') {
    return language === 'es' ? 'Los recordatorios por texto están desactivados para este salón.' : 'Text reminders are disabled for this salon.';
  }
  if (reminders.selection === 'explicit_on') {
    return language === 'es' ? 'Enviaré confirmación y recordatorios por texto a este número. Puedes responder STOP para dejar de recibir textos.' : 'Appointment confirmation and reminder texts are enabled for this number. You can reply STOP to stop texts.';
  }
  if (reminders.selection === 'explicit_off') {
    return language === 'es' ? 'Los recordatorios por texto están desactivados para esta cita.' : 'Text reminders are off for this appointment.';
  }
  if (reminders.requestedEnabled) {
    return language === 'es' ? 'La configuración actual del salón activa las confirmaciones y recordatorios por texto. Puedes responder STOP para dejar de recibir textos.' : 'The salon’s current default enables appointment confirmation and reminder texts. You can reply STOP to stop texts.';
  }
  return language === 'es' ? 'La configuración actual del salón no activa recordatorios por texto para esta cita.' : 'The salon’s current default does not enable text reminders for this appointment.';
}

export function formatVoiceCheckpointReview(review: CustomerReadyReviewSnapshot, language: 'en' | 'es', contact?: { name: string; email: string; phone: string }): string {
  const es = language === 'es';
  const money = (amount: number) => new Intl.NumberFormat(es ? 'es-US' : 'en-CA', { style: 'currency', currency: review.financial.currency }).format(amount / 100);
  const items = [...review.services.map(item => `${item.name}${item.priceDisplayText ? `, ${item.priceDisplayText}` : ''}`), ...review.addOns.map(item => `${item.name}${item.quantity > 1 ? `, ${item.quantity}` : ''}${item.priceDisplayText ? `, ${item.priceDisplayText}` : ''}`)].join(', ');
  const date = new Intl.DateTimeFormat(es ? 'es-US' : 'en-CA', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${review.date}T12:00:00Z`));
  const text = [
    es ? `Confirmemos los detalles: ${items}. ${date}, a las ${review.time}. Duración: ${review.durationMinutes} minutos.` : `Let's confirm the details: ${items}. ${date} at ${review.time}. Duration: ${review.durationMinutes} minutes.`,
    review.location ? `${es ? 'Lugar' : 'Location'}: ${review.location.name}${review.location.address ? `, ${review.location.address}` : ''}.` : '',
    review.technician.kind === 'specific' ? `${es ? 'Profesional' : 'Technician'}: ${review.technician.name}.` : '',
    contact ? es ? `Reserva para ${contact.name}; correo ${contact.email.replace(/@/g, ' arroba ').replace(/\./g, ' punto ')}.` : `Booking for ${contact.name}; email ${contact.email.replace(/@/g, ' at ').replace(/\./g, ' dot ')}.` : '',
    contact ? es ? `Número de contacto terminado en ${contact.phone.slice(-4).split('').join(' ')}.` : `Callback number ending in ${contact.phone.slice(-4).split('').join(' ')}.` : '',
    es ? `Total actual con impuestos: ${money(review.financial.totalDueCents)}.` : `Current total including tax: ${money(review.financial.totalDueCents)}.`,
    review.financial.discountAmountCents > 0 ? `${es ? 'Descuento' : 'Discount'}: ${money(review.financial.discountAmountCents)}. ${review.financial.discountLabel ?? ''}.` : '',
    ...(review.manualConfirmationItems ?? []).map(item => es ? `${item.name}${item.priceDisplayText ? `, ${item.priceDisplayText}` : ''}: el precio lo confirmará la profesional y no está incluido en este total.` : `${item.name}${item.priceDisplayText ? `, ${item.priceDisplayText}` : ''}: the technician will confirm the price; it is not included in this total.`),
    review.deposit.status === 'required' ? es ? `Se requiere un depósito de ${money(review.deposit.amountCents)}. Te enviaremos el enlace de pago seguro por correo. La cita no está confirmada hasta completar el pago.` : `A deposit of ${money(review.deposit.amountCents)} is required. We will email the secure payment link. The appointment is not confirmed until payment is complete.` : '',
    review.confirmationMode === 'request_approval' ? es ? 'Esta solicitud requiere la aprobación del salón.' : 'This request requires the salon to approve it.' : '',
    review.bookingPolicy.required ? `${review.bookingPolicy.title}. ${review.bookingPolicy.text}. ${es ? 'Al confirmar aceptas esta política.' : 'Confirming accepts this policy.'}` : '',
    reminderDisclosure(review, language),
  ].filter(Boolean).join(' ');
  if (text.length > 5000 || review.deposit.status === 'undetermined') {
    throw new Error('VOICE_REVIEW_REQUIRES_MANUAL_BOOKING');
  }
  return text;
}

export function voiceCheckpointTwiml(call: CheckpointCall, checkpoint: VoiceCheckpoint, review: CustomerReadyReviewSnapshot, origin: string, secret: string, contact?: { name: string; email: string; phone: string }): string {
  const response = new twilio.twiml.VoiceResponse();
  const url = (phase: VoiceCheckpointPhase) => `${origin}/api/voice/twilio/${phase}?call=${encodeURIComponent(call.id)}&token=${voiceCheckpointToken(call, checkpoint, phase, secret)}`;
  const es = checkpoint.language === 'es';
  const language = es ? 'es-US' : 'en-US';
  const voice = es ? 'Polly.Lupe-Neural' : 'Polly.Joanna-Neural';
  // Interruptible review checkpoint. Its action CANNOT book. With no input,
  // Twilio completes the review and falls through to the separate confirmation.
  const reviewGather = response.gather({ input: ['speech', 'dtmf'], action: url('review-interrupted'), method: 'POST', timeout: 1, speechTimeout: 'auto', numDigits: 1, language, actionOnEmptyResult: false });
  reviewGather.say({ voice, language }, formatVoiceCheckpointReview(review, checkpoint.language, contact));
  const confirmation = response.gather({ input: ['speech', 'dtmf'], action: url('confirm'), method: 'POST', timeout: 8, speechTimeout: 'auto', numDigits: 1, language, actionOnEmptyResult: true });
  confirmation.say({ voice, language }, es ? '¿Quieres reservar esta cita? Di sí o pulsa uno para confirmar. Si quieres cambiar algo, dímelo.' : 'Would you like me to book this appointment? Say yes or press one to confirm. To change anything, tell me what to change.');
  response.hangup();
  return response.toString();
}
