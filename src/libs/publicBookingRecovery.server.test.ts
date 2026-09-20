import { describe, expect, it, vi } from 'vitest';

import {
  getPublicBookingRecoveryKeyHash,
  hashPublicBookingRecoveryKey,
  readPublicBookingRecoveryReceipt,
} from './publicBookingRecovery.server';

vi.mock('server-only', () => ({}));

const RECOVERY_KEY = 'c04fbd4c-2492-4be5-835f-e55b207a1b1f';

function receipt(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    statusCode: 201,
    recoveryKeyHash: hashPublicBookingRecoveryKey(RECOVERY_KEY),
    responseBody: {
      data: {
        appointmentId: 'appointment_123',
        appointment: { id: 'appointment_123', status: 'confirmed' },
        deposit: {
          required: true,
          checkoutUrl: 'https://checkout.example/session',
          amountCents: 2500,
        },
      },
      meta: { timestamp: '2026-09-19T12:00:00.000Z' },
    },
    ...overrides,
  });
}

describe('public booking recovery receipt', () => {
  it('returns the original successful receipt including checkout data after exact proof verification', () => {
    expect(readPublicBookingRecoveryReceipt(receipt(), RECOVERY_KEY)).toEqual({
      data: {
        appointmentId: 'appointment_123',
        appointment: { id: 'appointment_123', status: 'confirmed' },
        deposit: {
          required: true,
          checkoutUrl: 'https://checkout.example/session',
          amountCents: 2500,
        },
      },
      meta: { timestamp: '2026-09-19T12:00:00.000Z' },
    });
  });

  it('does not resolve a wrong recovery key, absent proof, or an unsuccessful cache value', () => {
    expect(readPublicBookingRecoveryReceipt(receipt(), '278944e5-f461-4548-8147-ea9164b4340d')).toBeNull();
    expect(readPublicBookingRecoveryReceipt(receipt({ recoveryKeyHash: undefined }), RECOVERY_KEY)).toBeNull();
    expect(readPublicBookingRecoveryReceipt(receipt({ statusCode: 204 }), RECOVERY_KEY)).toBeNull();
  });

  it('fails closed for malformed or mismatched cached responses', () => {
    expect(readPublicBookingRecoveryReceipt(null, RECOVERY_KEY)).toBeNull();
    expect(readPublicBookingRecoveryReceipt('{bad json', RECOVERY_KEY)).toBeNull();
    expect(readPublicBookingRecoveryReceipt(receipt({
      responseBody: {
        data: { appointmentId: 'one', appointment: { id: 'two', status: 'confirmed' } },
        meta: { timestamp: '2026-09-19T12:00:00.000Z' },
      },
    }), RECOVERY_KEY)).toBeNull();
  });

  it('accepts only a UUID recovery header and never returns the supplied secret', () => {
    const request = new Request('https://app.test/api/appointments', {
      headers: { 'X-Booking-Recovery-Key': RECOVERY_KEY },
    });

    expect(getPublicBookingRecoveryKeyHash(request)).toBe(hashPublicBookingRecoveryKey(RECOVERY_KEY));
    expect(getPublicBookingRecoveryKeyHash(new Request('https://app.test/api/appointments', {
      headers: { 'X-Booking-Recovery-Key': 'not-a-uuid' },
    }))).toBeNull();
  });
});
