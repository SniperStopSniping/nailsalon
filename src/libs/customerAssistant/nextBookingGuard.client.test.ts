// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { captureNextBookingGuard } from './nextBookingGuard.client';

describe('next booking storage guard', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('permits an unchanged manual booking and blocks a newly started AI flow', () => {
    const assertUnchanged = captureNextBookingGuard('salon', 'slug');

    expect(assertUnchanged).not.toThrow();

    sessionStorage.setItem('luster.normal-confirm-handoff.v1.salon', JSON.stringify({ flowToken: 'v1.new-flow.token' }));

    expect(assertUnchanged).toThrow('BOOKING_RECOVERY_CHANGED');
    expect(sessionStorage.getItem('luster.normal-confirm-handoff.v1.salon')).not.toBeNull();
  });

  it.each(['handoff', 'operation', 'legacy', 'confirming'])('blocks changed AI %s without clearing it', (changed) => {
    const handoffKey = 'luster.normal-confirm-handoff.v1.salon';
    const operationKey = 'luster.normal-booking.operation.salon.flow';
    sessionStorage.setItem(handoffKey, JSON.stringify({ flowToken: 'v1.flow.token' }));
    localStorage.setItem(operationKey, JSON.stringify({ capability: 'old', revision: 1 }));
    const assertUnchanged = captureNextBookingGuard('salon', 'slug', 'old');

    expect(assertUnchanged).not.toThrow();

    if (changed === 'handoff') {
      sessionStorage.setItem(handoffKey, JSON.stringify({ flowToken: 'v1.new.token' }));
    } else if (changed === 'legacy') {
      localStorage.setItem('luster.customer-booking.operation.salon', JSON.stringify({ capability: 'new' }));
    } else if (changed === 'confirming') {
      localStorage.setItem(`${operationKey}.confirming`, '1');
    } else {
      localStorage.setItem(operationKey, JSON.stringify({ capability: 'old', revision: 2 }));
    }

    expect(assertUnchanged).toThrow('BOOKING_RECOVERY_CHANGED');
    expect(localStorage.getItem(operationKey)).not.toBeNull();
  });

  it('rejects an already different active capability before starting the handoff', () => {
    localStorage.setItem('luster.customer-booking.operation.salon', JSON.stringify({ capability: 'new' }));

    expect(() => captureNextBookingGuard('salon', 'slug', 'old')).toThrow('BOOKING_RECOVERY_CHANGED');
    expect(() => captureNextBookingGuard('salon', 'slug')).toThrow('BOOKING_RECOVERY_CHANGED');
  });
});
