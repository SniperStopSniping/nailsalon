import { describe, expect, it } from 'vitest';

import type { CustomerReadyReviewSnapshot } from '@/libs/customerAssistant/reviewContracts';

import { finalizedVoiceSmsChoice, formatVoiceCheckpointReview, isFinalizedVoiceConsent, verifyVoiceCheckpointToken, voiceCheckpointToken, voiceCheckpointTwiml } from './checkpoint';

const call = { id: 'b883cdd1-f08e-41c4-a9f0-90fa5c946630', salonId: 'salon-a', providerCallId: 'CA123', providerAccountSid: 'AC123' };
const checkpoint = { id: 'c1', revision: 2, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z', language: 'en' as const, stage: 'pending' as const };
const secret = 's'.repeat(32);

describe('voice checkpoint proof', () => {
  it('requires finalized high-confidence speech and rejects mixed DTMF/speech', () => {
    expect(isFinalizedVoiceConsent({ SpeechResult: 'yes, book it', Confidence: '0.9' })).toBe(true);

    const rejected: Record<string, string>[] = [{ SpeechResult: 'yes', Confidence: '0.99' }, { SpeechResult: 'yes, book it', Confidence: '0.79' }, { Digits: '1', SpeechResult: 'yes, book it' }, { Digits: '2' }];
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
    const review: CustomerReadyReviewSnapshot = { status: 'READY', salon: { id: 'salon-a', name: 'Isla', slug: 'isla' }, services: [], addOns: [], date: '2030-01-01', time: '4:00 PM', timeZone: 'America/Toronto', durationMinutes: 60, location: null, technician: { kind: 'any_artist' }, financial: { subtotalCents: 0, taxAmountCents: 0, totalDueCents: 0, currency: 'CAD', discountAmountCents: 0, discountLabel: null }, reminders: { mode: 'default_on', selection: 'default_on', requestedEnabled: true }, deposit: { status: 'not_required', reason: 'none' }, confirmationMode: 'instant', bookingPolicy: { required: false }, fingerprint: 'a'.repeat(64), expiresAt: '2030-01-01T00:00:00.000Z' };
    const xml = voiceCheckpointTwiml(call, checkpoint, review, 'https://voice.example.test', secret, { name: 'Ava Client', email: 'ava@example.test', phone: '4165550100' });

    expect(xml.indexOf('/review-interrupted?')).toBeLessThan(xml.indexOf('/confirm?'));
    expect(xml).toContain('/review-interrupted?');
    expect(xml).toContain('/confirm?');
    expect(xml).toContain('Appointment contact: Ava Client');
    expect(xml).toContain('salon’s current default enables');
    expect(xml).toContain('STOP');
    expect(formatVoiceCheckpointReview({ ...review, reminders: { mode: 'default_off', selection: 'default_off', requestedEnabled: false } }, 'en')).toContain('salon’s current default does not enable');
  });
});
