import { describe, expect, it } from 'vitest';

import { friendlyFailureReason, ownerSmsDeliveryStatus } from './communicationMasking';

describe('owner appointment SMS delivery states', () => {
  it.each([
    ['suppressed', 'CUSTOMER_DISABLED', 'customer_disabled'],
    ['suppressed', 'GLOBAL_OPT_OUT', 'opted_out'],
    ['failed', '21610', 'opted_out'],
    ['undelivered', '30007', 'provider_blocked'],
    ['failed', '30003', 'failed'],
    ['sent', null, 'sent'],
    ['delivered', null, 'delivered'],
  ])('classifies %s with %s as %s', (status, code, expected) => {
    expect(ownerSmsDeliveryStatus(status!, code)).toBe(expected);
  });

  it('keeps provider error copy separate from customer preference', () => {
    expect(friendlyFailureReason('21610')).toContain('opted out');
    expect(friendlyFailureReason('30007')).toContain('provider or carrier blocked');
    expect(friendlyFailureReason('CUSTOMER_DISABLED')).toContain('disabled by the customer');
    expect(friendlyFailureReason('private provider text')).toBe('This message could not be delivered.');
  });
});
