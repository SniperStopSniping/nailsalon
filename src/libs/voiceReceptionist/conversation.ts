import type { BookingSmsConsentInput } from '@/libs/bookingSmsConsent';
import { normalizeCustomerContact } from '@/libs/customerAssistant/contact';
import type { CustomerReadyReviewSnapshot } from '@/libs/customerAssistant/reviewContracts';

export type VoiceContactState = {
  // `sms` remains readable for calls persisted by an earlier pilot, but Live
  // conversation never asks for or interprets an SMS preference.
  step: 'name' | 'email' | 'phone' | 'verify' | 'sms' | 'complete';
  name: string;
  email: string;
  phone: string;
  smsConsent?: BookingSmsConsentInput;
};

export function normalizedSpeech(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase().replace(/[^\p{L}\p{N}@.+' -]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
}

/** No model boolean or general assent is booking consent. Corrections never match. */
export function isExplicitVoiceBookingConsent(text: string): boolean {
  return /^(?:(?:yes|yes please|please|si|si por favor) )?(?:book (?:it|that|the appointment)|confirm (?:my |the )?(?:booking|appointment)|reserva (?:la cita|eso)|reservalo|confirma (?:mi |la )?cita)(?: please| por favor)?$/.test(normalizedSpeech(text));
}

export function isVoiceContactAffirmation(text: string): boolean {
  return /^(?:yes|yes please|yes that'?s (?:right|correct|my number)|that'?s (?:right|correct|my number)|correct|si|si correcto|si es correcto|es correcto)$/.test(normalizedSpeech(text));
}

export function isVoiceNo(text: string): boolean {
  return /^(?:no|no thanks|no thank you|no please|no gracias|no por favor)$/.test(normalizedSpeech(text));
}

/** Only an explicit request can start a one-time public booking-link text. */
export function isVoiceBookingLinkRequest(text: string): boolean {
  const words = normalizedSpeech(text).split(' ');
  const sendIndex = words.findIndex(word => ['text', 'send', 'sms', 'message'].includes(word));
  const bookingIndex = words.findIndex(word => ['booking', 'book', 'appointment'].includes(word));
  const linkIndex = words.findIndex(word => ['link', 'page'].includes(word));
  if (sendIndex < 0 || bookingIndex < 0 || linkIndex < 0
    || words.slice(Math.max(0, sendIndex - 5), sendIndex).some(word => ['not', 'dont', 'don\'t', 'never', 'already'].includes(word))) {
    return false;
  }
  return true;
}

/** A destination named in the link request takes priority over caller ID. */
export function spokenVoiceLinkDestination(text: string): string | null {
  if (!isVoiceBookingLinkRequest(text)) {
    return null;
  }
  const speech = normalizedSpeech(text);
  const to = speech.lastIndexOf(' to ');
  const at = speech.lastIndexOf(' at ');
  const offset = Math.max(to, at);
  if (offset < 0) {
    return null;
  }
  let destination = speech.slice(offset + 4);
  for (const prefix of ['my ', 'phone ', 'mobile ', 'number ', 'is ']) {
    if (destination.startsWith(prefix)) {
      destination = destination.slice(prefix.length);
    }
  }
  return spokenPhone(destination.replace(/ please$/, ''));
}

export function isVoiceBookingLinkAffirmation(text: string): boolean {
  return isVoiceContactAffirmation(text)
    || /^(?:yes|yeah|yep|si)(?: please)? (?:text|send)(?: me)? (?:it|the link|the booking link)(?: please)?$/.test(normalizedSpeech(text));
}

/** Confirm that the voice actually read back the same number the backend will text. */
export function containsVoicePhoneReadback(output: string, phone: string): boolean {
  const digits: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', cero: '0', uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9' };
  const rendered = normalizedSpeech(output).split(' ').map(word => digits[word] ?? word).join(' ').replace(/\D/g, '');
  return /^\d{10}$/.test(phone) && rendered.includes(phone);
}

export function spokenPhoneCorrection(text: string): string | null {
  const speech = normalizedSpeech(text)
    .replace(/^no\s+/, '')
    .replace(/^(?:use|its|it's|my number is|the number is|text it to|send it to)\s+/, '');
  return spokenPhone(text) ?? spokenPhone(speech);
}

/** Incomplete dictated digits must not cancel a pending text request. */
export function isVoicePhoneFragment(text: string): boolean {
  const speech = normalizedSpeech(text)
    .replace(/^no\s+/, '')
    .replace(/^(?:use|its|it's|my number is|the number is|text it to|send it to)\s+/, '');
  const parts = speech.split(' ').filter(Boolean);
  return parts.length > 0 && parts.every(part => /^\d+$/.test(part)
    || /^(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)$/.test(part));
}

export function isVoiceBookingLinkRevocation(text: string): boolean {
  const speech = normalizedSpeech(text);
  return /\b(?:cancel|stop|dont|don't|do not|never)\b.+\b(?:text|sms|message|link|send)\b/.test(speech)
    || /\b(?:wrong|different|change|changed|correct|actually|not my)\b.+\b(?:phone|number|mobile)\b/.test(speech)
    || /\b(?:phone|number|mobile)\b.+\b(?:wrong|different|change|changed)\b/.test(speech)
    || /\b(?:my|the)\s+(?:phone|number|mobile)\s+(?:is|should be)\b/.test(speech)
    || /^(?:cancel it|never mind|forget it|wait|hold on)$/.test(speech);
}

/** Only these complete acknowledgments cannot change the queued text request. */
export function isVoiceBookingLinkHarmlessAcknowledgment(text: string): boolean {
  return /^(?:ok|okay|thanks|thank you|thanks so much|thank you so much|bye|goodbye|good bye|ok thanks|okay thanks|perfect thanks|perfect thank you|great thanks|great thank you|sounds good thanks|alright thanks|all right thanks|thanks bye|thank you bye|thanks goodbye|thank you goodbye)$/.test(normalizedSpeech(text));
}

/** Matches only one of Luster's offered slots, preserving ambiguity. */
export function matchVoiceOfferedSlot(offered: { time: string; startTime: string }[], message: string): string | null {
  const hours: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
  const input = message.toLowerCase().replace(/[.!?,]/g, '').trim()
    .replace(/^(?:i'll take |i will take |let's do |at |a las |the )/, '')
    .replace(/(?: please| por favor)$/, '')
    .replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/g, word => String(hours[word]))
    .replace(/(?: thirty| y media)\b/g, ':30');
  const requested = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(input);
  if (!requested) {
    return null;
  }
  const requestedHour = Number(requested[1]);
  const requestedMinute = Number(requested[2] ?? 0);
  if (requestedHour > 23 || requestedMinute > 59 || (requested[3] && (requestedHour < 1 || requestedHour > 12))) {
    return null;
  }
  const matches = offered.filter((slot) => {
    const parsed = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(slot.time);
    if (!parsed) {
      return false;
    }
    const hour = parsed[3] ? Number(parsed[1]) % 12 + (parsed[3].toLowerCase() === 'pm' ? 12 : 0) : Number(parsed[1]);
    const target = requested[3] ? requestedHour % 12 + (requested[3] === 'pm' ? 12 : 0) : requestedHour;
    return Number(parsed[2]) === requestedMinute && (hour === target || (!requested[3] && requestedHour <= 12 && hour % 12 === requestedHour % 12));
  });
  return matches.length === 1 ? matches[0]!.startTime : null;
}

export function spokenEmail(text: string): string | null {
  const value = text.toLowerCase().trim()
    .replace(/^(?:my (?:email|email address) is|mi (?:correo|email) es)\s+/i, '')
    .replace(/\s+(?:at|arroba)\s+/g, '@')
    .replace(/\s+(?:dot|punto)\s+/g, '.')
    .replace(/\s+(?:underscore|guion bajo)\s+/g, '_')
    .replace(/\s+(?:dash|hyphen|guion)\s+/g, '-')
    .replace(/\s+/g, '').replace(/[.,]$/, '');
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value) && value.length <= 254 ? value : null;
}

export function spokenPhone(text: string): string | null {
  const digits: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', cero: '0', uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9' };
  const input = normalizedSpeech(text).replace(/\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, token => digits[token]!);
  if (/[a-z]/i.test(input)) {
    return null;
  }
  const numbers = input.replace(/\D/g, '');
  return numbers.length === 10 ? numbers : numbers.length === 11 && numbers.startsWith('1') ? numbers.slice(1) : null;
}

export function contactPrompt(state: VoiceContactState): string {
  switch (state.step) {
    case 'name': return 'Ask for the name for this appointment. Do not infer it from caller ID.';
    case 'email': return `Name received: ${state.name}. Ask for the email address for the normal appointment confirmation. Ask them to spell ambiguous parts.`;
    case 'phone': return state.phone ? `Ask whether ${state.phone.split('').join(' ')} is the correct callback number. Caller ID is unverified; they can provide a different number.` : 'Ask for the callback phone number, with area code.';
    case 'verify': return `Carefully read back the complete contact: name ${state.name}; email ${state.email.replace(/@/g, ' at ').replace(/\./g, ' dot ')}; callback ${state.phone.split('').join(' ')}. Ask whether these are correct. Do not proceed until they confirm.`;
    case 'sms': return 'The legacy text-preference step is complete. Prepare the authoritative review using the salon’s normal reminder setting.';
    case 'complete': return 'Contact details are complete. Prepare the authoritative review using the salon’s normal reminder setting.';
  }
}

export function advanceVoiceContact(state: VoiceContactState, text: string): VoiceContactState {
  const next = { ...state };
  if (state.step === 'name') {
    const name = text.replace(/^(?:my name is|i am|i'm|me llamo|mi nombre es)\s+/i, '').trim().replace(/[.!?]+$/, '');
    if (/^[\p{L}\p{M}' .-]{1,100}$/u.test(name) && !isVoiceContactAffirmation(name) && !isVoiceNo(name)) {
      next.name = name;
      next.step = 'email';
    }
  } else if (state.step === 'email') {
    const email = spokenEmail(text);
    if (email) {
      next.email = email;
      next.step = 'phone';
    }
  } else if (state.step === 'phone') {
    const phone = spokenPhone(text) ?? (isVoiceContactAffirmation(text) ? state.phone : null);
    if (phone) {
      next.phone = phone;
      if (phone !== state.phone) {
        delete next.smsConsent;
      }
      next.step = 'verify';
    }
  } else if (state.step === 'verify') {
    if (isVoiceContactAffirmation(text)) {
      next.step = 'complete';
    } else if (isVoiceNo(text)) {
      next.step = 'name';
    }
  } else if (state.step === 'sms') {
    // Legacy state had already presented a prompt whose wording cannot be
    // reconstructed safely. Keep the canonical salon default instead.
    delete next.smsConsent;
    next.step = 'complete';
  }
  return next;
}

export function completedVoiceContact(state: VoiceContactState) {
  return state.step === 'complete' ? normalizeCustomerContact(state) : null;
}

/** Contact corrections are channel state, never a catalogue interpretation. */
export function correctVoiceContact(state: VoiceContactState | null, message: string): VoiceContactState | null {
  const input = message.replace(/^(?:actually|sorry|en realidad|perdon|perdón)[, ]+/i, '');
  const field = /^(?:my |mi )?(?:email|e-mail|correo)(?: address| electrónico)?(?: is| es| should be| debe ser)?[: ]/i.test(input) ? 'email' : /^(?:my |mi )?(?:phone(?: number)?|number|numero|número|telefono|teléfono)(?: is| es| should be| debe ser)?[: ]/i.test(input) ? 'phone' : /^(?:my name|mi nombre|me llamo)\b/i.test(input) ? 'name' : null;
  if (!field) {
    return null;
  }
  const base: VoiceContactState = state ?? { step: 'name', name: '', email: '', phone: '' };
  const correctionBase = field === 'phone' ? { ...base, smsConsent: undefined } : base;
  let value = input;
  value = value.replace(/^(?:my |mi )?(?:email(?: address)?|e-mail|correo(?: electrónico)?|phone(?: number)?|number|numero|número|teléfono|telefono|name|nombre)(?: is| es| should be| debe ser)?[: ]+/i, '');
  const updated = advanceVoiceContact({ ...correctionBase, step: field, [field]: '' }, value);
  if (!updated[field]) {
    return { ...correctionBase, [field]: '', step: field };
  }
  return {
    ...updated,
    // A different callback number cannot inherit a prior number's choice.
    step: !updated.name ? 'name' : !updated.email ? 'email' : !updated.phone ? 'phone' : 'verify',
  };
}

export function voiceReviewText(review: CustomerReadyReviewSnapshot): string {
  const money = (cents: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: review.financial.currency }).format(cents / 100);
  const items = [...review.services.map(item => `${item.name}${item.priceDisplayText ? ` (${item.priceDisplayText})` : ''}`), ...review.addOns.map(item => `${item.name}${item.quantity > 1 ? ` times ${item.quantity}` : ''}${item.priceDisplayText ? ` (${item.priceDisplayText})` : ''}`)].join(', ');
  return [
    `Please read this complete booking review, translating naturally if needed: ${items}.`,
    `Date ${review.date}, time ${review.time}, timezone ${review.timeZone}; ${review.durationMinutes} minutes.`,
    review.location ? `Location: ${review.location.name}${review.location.address ? `, ${review.location.address}` : ''}.` : '',
    review.technician.kind === 'specific' ? `Technician: ${review.technician.name}.` : 'Any available qualified technician.',
    `Current service subtotal ${money(review.financial.subtotalCents)}. Tax ${money(review.financial.taxAmountCents)}. Current total ${money(review.financial.totalDueCents)}.`,
    review.financial.discountAmountCents ? `Discount ${money(review.financial.discountAmountCents)}: ${review.financial.discountLabel ?? 'applicable discount'}.` : '',
    (review.manualConfirmationItems?.length ?? 0) > 0 ? `Price to be confirmed by the technician for: ${review.manualConfirmationItems!.map(item => `${item.name}${item.priceDisplayText ? ` (${item.priceDisplayText})` : ''}`).join(', ')}. These amounts are not included in the current total; it is not a final price.` : '',
    review.deposit.status === 'required' ? `A deposit of ${money(review.deposit.amountCents)} is required using Luster's secure payment link. The appointment is not confirmed until the required payment completes. Never collect card details.` : review.deposit.status === 'undetermined' ? 'Deposit requirements are not yet available. Booking cannot proceed.' : 'No deposit is required for this reviewed booking.',
    review.confirmationMode === 'request_approval' ? 'The salon must approve this appointment request.' : '',
    review.bookingPolicy.required ? `Required salon policy: ${review.bookingPolicy.title}. ${review.bookingPolicy.text}. Confirming the booking also accepts this policy.` : '',
    'End by asking: Would you like me to book this appointment? Please say yes, book it to confirm. In Spanish: ¿Quieres que reserve esta cita? Di sí, reserva la cita para confirmar.',
  ].filter(Boolean).join(' ');
}

/** Transcript evidence is not a claim that the caller heard every audio sample. */
export class VoiceConsentGate {
  private review: { fingerprint: string; revision: number; expiresAt: number; armedAt: number; questionEnd: number | null } | null = null;
  private output = '';

  arm(fingerprint: string, revision: number, expiresAt: string, sessionOffset: number) {
    this.review = { fingerprint, revision, expiresAt: Date.parse(expiresAt), armedAt: sessionOffset, questionEnd: null };
    this.output = '';
  }

  invalidate() {
    this.review = null;
    this.output = '';
  }

  observeOutput(delta: string, startMs: number, endMs: number) {
    if (!this.review || startMs < this.review.armedAt) {
      return;
    }
    this.output = (this.output + delta).slice(-12_000);
    if (/would you like me to book this appointment|yes book it to confirm|quieres que reserve esta cita|reserva la cita para confirmar/.test(normalizedSpeech(this.output))) {
      this.review.questionEnd = endMs;
    }
  }

  accepts(text: string, inputStartMs: number, fingerprint: string, revision: number, now = Date.now()): boolean {
    return !!this.review && this.review.fingerprint === fingerprint && this.review.revision === revision
      && this.review.expiresAt > now && this.review.questionEnd !== null
      && inputStartMs > this.review.questionEnd && isExplicitVoiceBookingConsent(text);
  }
}
