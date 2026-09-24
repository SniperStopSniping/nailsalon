import { describe, expect, it } from 'vitest';

import type { CustomerReadyReviewSnapshot } from '@/libs/customerAssistant/reviewContracts';

import { finalizedVoiceSmsChoice, formatVoiceCheckpointReview, isFinalizedVoiceConsent, verifyVoiceCheckpointToken, voiceCheckpointToken, voiceCheckpointTwiml } from './checkpoint';

const call = { id: 'b883cdd1-f08e-41c4-a9f0-90fa5c946630', salonId: 'salon-a', providerCallId: 'CA123', providerAccountSid: 'AC123' };
const checkpoint = { id: 'c1', revision: 2, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z', language: 'en' as const, stage: 'pending' as const };
const secret = 's'.repeat(32);

describe('voice checkpoint proof', () => {
  it('accepts exact high-confidence assent only at the final checkpoint', () => {
    for (const speech of ['yes, book it', 'yes', 'yeah', 'yeah, book it', 'yep', 'yes please', 'sí', 'sí por favor']) {
      expect(isFinalizedVoiceConsent({ SpeechResult: speech, Confidence: '0.9' })).toBe(true);
    }

    const rejected: Record<string, string>[] = [
      { SpeechResult: 'yes, but change it to Friday', Confidence: '0.99' },
      { SpeechResult: 'yes, no texts', Confidence: '0.99' },
      { SpeechResult: 'I guess so', Confidence: '0.99' },
      { SpeechResult: 'yes', Confidence: '0.79' },
      { SpeechResult: 'yes' },
      { Digits: '1', SpeechResult: 'yes' },
      { Digits: '2' },
    ];
    for (const params of rejected) {
      expect(isFinalizedVoiceConsent(params)).toBe(false);
    }
  });

  it('recognizes only exact finalized SMS corrections, never a delayed Live-style compound assent', () => {
    expect(finalizedVoiceSmsChoice({ SpeechResult: 'no texts', Confidence: '0.8' })).toMatchObject({ granted: false, selection: 'explicit_off' });
    expect(finalizedVoiceSmsChoice({ SpeechResult: 'don’t text me', Confidence: '0.99' })).toMatchObject({ granted: false, selection: 'explicit_off' });
    expect(finalizedVoiceSmsChoice({ SpeechResult: 'no texts please', Confidence: '0.99' })).toMatchObject({ granted: false, selection: 'explicit_off' });
    expect(finalizedVoiceSmsChoice({ SpeechResult: 'sí textos por favor', Confidence: '0.99' })).toMatchObject({ granted: true, selection: 'explicit_on' });
    expect(finalizedVoiceSmsChoice({ SpeechResult: 'yes, actually no texts', Confidence: '0.99' })).toBeNull();
    expect(finalizedVoiceSmsChoice({ SpeechResult: 'no texts', Confidence: '0.79' })).toBeNull();
  });

  it('binds checkpoint tokens to salon, provider account/call, revision, and phase', () => {
    const token = voiceCheckpointToken(call, checkpoint, 'confirm', secret);

    expect(verifyVoiceCheckpointToken(token, call, checkpoint, 'confirm', secret)).toBe(true);
    expect(verifyVoiceCheckpointToken(token, { ...call, salonId: 'salon-b' }, checkpoint, 'confirm', secret)).toBe(false);
    expect(verifyVoiceCheckpointToken(token, { ...call, providerAccountSid: 'AC999' }, checkpoint, 'confirm', secret)).toBe(false);
    expect(verifyVoiceCheckpointToken(token, call, { ...checkpoint, revision: 3 }, 'confirm', secret)).toBe(false);
    expect(verifyVoiceCheckpointToken(token, call, checkpoint, 'review-interrupted', secret)).toBe(false);
  });

  it('keeps the interruptible review Gather separate from the confirm action', () => {
    const review: CustomerReadyReviewSnapshot = { status: 'READY', salon: { id: 'salon-a', name: 'Isla', slug: 'isla' }, services: [{ id: 'svc-1', name: 'BIAB overlay', priceCents: 7000, priceDisplayText: 'from $70' }], addOns: [], manualConfirmationItems: [{ id: 'assessment', name: 'Existing product assessment', quantity: 1, durationMinutes: 20, priceStatus: 'to_be_confirmed', priceDisplayText: 'price confirmed in salon' }], date: '2030-01-01', time: '4:00 PM', timeZone: 'America/Toronto', durationMinutes: 80, location: null, technician: { kind: 'any_artist' }, financial: { subtotalCents: 7000, taxAmountCents: 910, totalDueCents: 7910, currency: 'CAD', discountAmountCents: 0, discountLabel: null }, reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true }, deposit: { status: 'required', amountCents: 2000, currency: 'CAD', label: 'deposit' }, confirmationMode: 'request_approval', bookingPolicy: { required: true, title: 'Appointment agreement', text: 'Please arrive on time and cancel promptly.', acknowledgmentText: 'I agree.', version: 'v1' }, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' };
    const xml = voiceCheckpointTwiml(call, checkpoint, review, 'https://voice.example.test', secret, { name: 'Ava Client', email: 'ava@example.test', phone: '4165550100' });

    expect(xml.indexOf('/review-interrupted?')).toBeLessThan(xml.indexOf('/confirm?'));
    expect(xml).toContain('/review-interrupted?');
    expect(xml).toContain('/confirm?');
    expect(xml).toContain('voice="Polly.Joanna-Neural"');
    expect(xml).toContain('Booking for Ava Client');
    expect(xml).toContain('ava at example dot test');
    expect(xml).not.toContain('callback number');
    expect(xml).toContain('BIAB overlay, from $70');
    expect(xml).toContain('80 minutes');
    expect(xml).toContain('Current total including tax');
    expect(xml).toContain('Existing product assessment, price confirmed in salon');
    expect(xml).toContain('it is not included in this total');
    expect(xml).toContain('The appointment is not confirmed until payment is complete');
    expect(xml).toContain('This request requires the salon to approve it');
    expect(xml).toContain('Appointment agreement. Please arrive on time and cancel promptly.');
    expect(xml).toContain('salon’s current default enables');
    expect(xml).toContain('STOP');
    expect(xml).toContain('Say yes or press one to confirm');
    expect(formatVoiceCheckpointReview({ ...review, reminders: { mode: 'default_off', selection: 'default_off', requestedEnabled: false } }, 'en')).toContain('salon’s current default does not enable');

    const spanish = formatVoiceCheckpointReview(review, 'es');
    const spanishXml = voiceCheckpointTwiml(call, { ...checkpoint, language: 'es' }, review, 'https://voice.example.test', secret);

    expect(spanishXml).toContain('voice="Polly.Lupe-Neural"');
    expect(spanish).toContain('Total actual con impuestos');
    expect(spanish).toContain('Please arrive on time and cancel promptly.');
    expect(spanish).toContain('no está confirmada hasta completar el pago');
  });
});
