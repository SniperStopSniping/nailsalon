import { describe, expect, it } from 'vitest';

import {
  type ActiveAppointmentMatch,
  classifyDuplicateBooking,
  resolveBookingSubject,
} from './bookingIdentity';

const PHONE = '4165550101';
const OTHER_PHONE = '4165559999';
const EMAIL = 'ava@example.com';

function match(overrides: Partial<ActiveAppointmentMatch> = {}): ActiveAppointmentMatch {
  return {
    id: overrides.id ?? 'appt_1',
    clientPhone: 'clientPhone' in overrides ? overrides.clientPhone! : PHONE,
    clientEmail: 'clientEmail' in overrides ? overrides.clientEmail! : EMAIL,
  };
}

describe('classifyDuplicateBooking', () => {
  it('allows a booking with no matches at all', () => {
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: EMAIL,
      phoneMatches: [],
      emailMatches: [],
    })).toEqual({ decision: 'allow' });
  });

  it('blocks on an exact phone match — the primary signal', () => {
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: EMAIL,
      phoneMatches: [match()],
      emailMatches: [],
    })).toEqual({ decision: 'block', signal: 'phone' });
  });

  it('still blocks on phone when the customer changed their email', () => {
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: 'brand-new@example.com',
      phoneMatches: [match({ clientEmail: EMAIL })],
      emailMatches: [],
    })).toEqual({ decision: 'block', signal: 'phone' });
  });

  it('blocks on email for a legacy row that has no phone', () => {
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: EMAIL,
      phoneMatches: [],
      emailMatches: [match({ clientPhone: null })],
    })).toEqual({ decision: 'block', signal: 'email' });
  });

  it('blocks on email when the matched row carries the same phone', () => {
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: EMAIL,
      phoneMatches: [],
      emailMatches: [match({ clientPhone: `+1${PHONE}` })],
    })).toEqual({ decision: 'block', signal: 'email' });
  });

  it('does NOT block a household sharing one email with different phones', () => {
    // Partner already has an appointment under the shared address.
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: EMAIL,
      phoneMatches: [],
      emailMatches: [match({ clientPhone: OTHER_PHONE })],
    })).toEqual({ decision: 'allow' });
  });

  it('reports an identity conflict when phone and email point at different people', () => {
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: EMAIL,
      phoneMatches: [match({ id: 'appt_phone', clientEmail: 'someone@example.com' })],
      emailMatches: [match({ id: 'appt_email', clientPhone: OTHER_PHONE })],
    })).toEqual({ decision: 'identity_conflict' });
  });

  it('is not a conflict when both signals point at the same appointment', () => {
    const same = match({ id: 'appt_same' });

    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: EMAIL,
      phoneMatches: [same],
      emailMatches: [same],
    })).toEqual({ decision: 'block', signal: 'phone' });
  });

  it('ignores email entirely when the booking has none', () => {
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: null,
      phoneMatches: [],
      emailMatches: [match({ clientPhone: null })],
    })).toEqual({ decision: 'allow' });
  });

  it('treats email matching as case- and whitespace-insensitive', () => {
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: '  AVA@Example.COM ',
      phoneMatches: [],
      emailMatches: [match({ clientPhone: null })],
    })).toEqual({ decision: 'block', signal: 'email' });
  });

  it('matches phones across stored formats', () => {
    expect(classifyDuplicateBooking({
      normalizedPhone: PHONE,
      email: EMAIL,
      phoneMatches: [],
      emailMatches: [match({ clientPhone: '(416) 555-0101' })],
    })).toEqual({ decision: 'block', signal: 'email' });
  });
});

describe('resolveBookingSubject', () => {
  it('treats a visitor with no session as a guest', () => {
    expect(resolveBookingSubject({
      hasClientSession: false,
      sessionPhone: null,
      requestedMode: undefined,
      typedPhone: PHONE,
    })).toEqual({ ok: true, mode: 'guest' });
  });

  it('honours an explicit self mode', () => {
    expect(resolveBookingSubject({
      hasClientSession: true,
      sessionPhone: PHONE,
      requestedMode: 'self',
      typedPhone: PHONE,
    })).toEqual({ ok: true, mode: 'self' });
  });

  it('honours an explicit guest mode even from a signed-in browser', () => {
    expect(resolveBookingSubject({
      hasClientSession: true,
      sessionPhone: PHONE,
      requestedMode: 'guest',
      typedPhone: OTHER_PHONE,
    })).toEqual({ ok: true, mode: 'guest' });
  });

  it('infers self when the typed phone is the account phone', () => {
    expect(resolveBookingSubject({
      hasClientSession: true,
      sessionPhone: PHONE,
      requestedMode: undefined,
      typedPhone: `+1${PHONE}`,
    })).toEqual({ ok: true, mode: 'self' });
  });

  it('infers self when no phone was typed at all', () => {
    expect(resolveBookingSubject({
      hasClientSession: true,
      sessionPhone: PHONE,
      requestedMode: undefined,
      typedPhone: null,
    })).toEqual({ ok: true, mode: 'self' });
  });

  /**
   * The regression that started all of this: a signed-in browser submitting a
   * different phone used to be silently rebound to the account. Older clients
   * that send no mode now get a conflict they can act on instead.
   */
  it('refuses to guess when a signed-in browser submits a different phone', () => {
    expect(resolveBookingSubject({
      hasClientSession: true,
      sessionPhone: PHONE,
      requestedMode: undefined,
      typedPhone: OTHER_PHONE,
    })).toEqual({ ok: false, reason: 'identity_conflict' });
  });
});
