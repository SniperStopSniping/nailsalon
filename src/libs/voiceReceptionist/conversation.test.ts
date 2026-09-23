import { describe, expect, it } from 'vitest';

import { advanceVoiceContact, correctVoiceContact, isExplicitVoiceBookingConsent, matchVoiceOfferedSlot, voiceReviewText } from './conversation';

describe('voice conversation safety', () => {
  it('requires an exact booking command and rejects vague, negative, and correction speech', () => {
    expect(isExplicitVoiceBookingConsent('yes, book it')).toBe(true);
    expect(isExplicitVoiceBookingConsent('sí, reserva la cita')).toBe(true);

    for (const phrase of ['yes', 'sounds good', 'actually make them short', 'do not book it', 'no, book it', 'book it maybe']) {
      expect(isExplicitVoiceBookingConsent(phrase)).toBe(false);
    }
  });

  it('matches exactly one offered twelve-hour slot and preserves ambiguity', () => {
    const offered = [
      { time: '4:00 PM', startTime: '2030-01-01T21:00:00.000Z' },
      { time: '4:00 AM', startTime: '2030-01-01T09:00:00.000Z' },
      { time: '12:30 PM', startTime: '2030-01-01T17:30:00.000Z' },
    ];

    expect(matchVoiceOfferedSlot(offered, 'four pm')).toBe(offered[0]!.startTime);
    expect(matchVoiceOfferedSlot(offered, 'doce y media')).toBe(offered[2]!.startTime);
    expect(matchVoiceOfferedSlot(offered, '4:00')).toBeNull();
  });

  it('corrects English and Spanish contact fields without caller-ID inference', () => {
    const state = { step: 'complete' as const, name: 'Ava', email: 'old@example.test', phone: '4165550100', smsConsent: { granted: true, selection: 'explicit_on' as const, wordingVersion: 'booking-sms-reminders-v1' as const } };

    expect(correctVoiceContact(state, 'actually my email is ava at example dot test')).toMatchObject({ email: 'ava@example.test', step: 'verify' });
    expect(correctVoiceContact(state, 'en realidad mi teléfono es cuatro uno seis cinco cinco cinco cero uno cero uno')).toMatchObject({ phone: '4165550101', step: 'verify' });
    expect(correctVoiceContact(state, 'en realidad mi teléfono es cuatro uno seis cinco cinco cinco cero uno cero uno')?.smsConsent).toBeUndefined();
  });

  it('does not grant texts from a Live affirmation and completes contact after verification', () => {
    const verified = advanceVoiceContact({ step: 'verify', name: 'Ava', email: 'ava@example.test', phone: '4165550100' }, 'yes');

    expect(verified).toMatchObject({ step: 'complete' });
    expect(verified.smsConsent).toBeUndefined();
    expect(advanceVoiceContact({ ...verified, step: 'sms' }, 'yes')).toMatchObject({ step: 'complete' });
    expect(advanceVoiceContact({ ...verified, step: 'sms' }, 'yes').smsConsent).toBeUndefined();
  });

  it('clears a prior SMS choice for invalid and re-entered callback-number corrections', () => {
    const contact = {
      step: 'complete' as const,
      name: 'Ava',
      email: 'ava@example.test',
      phone: '4165550100',
      smsConsent: { granted: true, selection: 'explicit_on' as const, wordingVersion: 'booking-sms-reminders-v1' as const },
    };
    const invalidCorrection = correctVoiceContact(contact, 'actually my phone is maybe later');

    expect(invalidCorrection).toMatchObject({ step: 'phone', phone: '' });
    expect(invalidCorrection?.smsConsent).toBeUndefined();

    const correctedNumber = advanceVoiceContact(invalidCorrection!, '4165550101');

    expect(correctedNumber).toMatchObject({ phone: '4165550101' });
    expect(correctedNumber.smsConsent).toBeUndefined();

    const reentered = advanceVoiceContact({ ...contact, step: 'verify' }, 'no');
    const newNumber = advanceVoiceContact({ ...reentered, step: 'phone' }, '4165550101');

    expect(reentered).toMatchObject({ step: 'name' });
    expect(newNumber).toMatchObject({ phone: '4165550101' });
    expect(newNumber.smsConsent).toBeUndefined();
  });

  it('reads configured qualifiers, manual pricing, discounts, deposits, and policy from the review', () => {
    const review = {
      services: [{ name: 'Gel-X', priceDisplayText: 'From $70' }],
      addOns: [{ name: 'French', quantity: 1, priceDisplayText: '$10+' }],
      manualConfirmationItems: [{ name: 'Removal', priceDisplayText: '$15+' }],
      date: '2030-01-01',
      time: '4:00 PM',
      timeZone: 'America/Toronto',
      durationMinutes: 90,
      location: null,
      technician: { kind: 'any_artist' },
      financial: { subtotalCents: 8000, taxAmountCents: 1040, totalDueCents: 8115, currency: 'CAD', discountAmountCents: 925, discountLabel: 'Next Visit' },
      deposit: { status: 'required', amountCents: 2500, currency: 'CAD', label: '$25 deposit' },
      confirmationMode: 'request_approval',
      bookingPolicy: { required: true, title: 'Policy', text: 'No-show policy.', acknowledgmentText: 'Agree', version: 'v1' },
    } as never;
    const text = voiceReviewText(review);
    for (const phrase of ['From $70', '$10+', '$15+', 'Discount', 'deposit', 'approve', 'No-show policy']) {
      expect(text).toContain(phrase);
    }
  });
});
