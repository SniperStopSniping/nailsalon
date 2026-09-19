// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';

import { startAnotherBooking } from './newBooking.client';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

it('requires resolved status and preserves all recovery state for ambiguous/payment bookings', () => {
  sessionStorage.setItem('luster.normal-confirm-handoff.v1.a', 'original');
  for (const status of ['not_created', 'unavailable', 'payment_processing', 'payment_required'] as const) {
    expect(() => startAnotherBooking('a', 'isla', status)).toThrow('BOOKING_STILL_UNRESOLVED');
    expect(sessionStorage.getItem('luster.normal-confirm-handoff.v1.a')).toBe('original');
  }
});

it('clears only the active tenant flow on an explicit new-booking action after recovery', () => {
  sessionStorage.setItem('luster.normal-confirm-handoff.v1.a', 'original');
  sessionStorage.setItem('luster.normal-confirm-handoff.v1.b', 'other-tenant');
  sessionStorage.setItem('luster.customer-assistant.conversation.isla', 'old-conversation');
  localStorage.setItem('luster.customer-booking.operation.a', 'legacy');
  localStorage.setItem('luster.normal-booking.operation.a.original', 'old-capability');
  startAnotherBooking('a', 'isla', 'confirmed');

  expect(sessionStorage.getItem('luster.normal-confirm-handoff.v1.a')).toBeNull();
  expect(sessionStorage.getItem('luster.normal-confirm-handoff.v1.b')).toBe('other-tenant');
  expect(sessionStorage.getItem('luster.customer-assistant.conversation.isla')).toBeNull();
  expect(localStorage.getItem('luster.customer-booking.operation.a')).toBeNull();
  expect(localStorage.getItem('luster.normal-booking.operation.a.original')).toBe('old-capability');
});
