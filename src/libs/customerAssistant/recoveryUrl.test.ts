import { describe, expect, it } from 'vitest';

import { customerBookingRecoveryUrl } from './recoveryUrl';

describe('server-authorized recovery links', () => {
  it('accepts canonical tenant guest links even when their host differs from the booking alias', () => {
    expect(customerBookingRecoveryUrl('https://salon.example/manage/opaque_capability', 'manage')).toBe('https://salon.example/manage/opaque_capability');
    expect(customerBookingRecoveryUrl('https://app.example/en/synthetic-salon/manage/opaque_capability', 'manage')).toBe('https://app.example/en/synthetic-salon/manage/opaque_capability');
  });

  it.each(['javascript:alert(1)', 'http://app.example/manage/opaque', 'https://user@app.example/manage/opaque', 'https://app.example/owner', 'https://app.example/manage/opaque?redirect=external', '//app.example/manage/opaque'])('rejects unsafe or non-management URL %s', (url) => {
    expect(customerBookingRecoveryUrl(url, 'manage')).toBeNull();
  });

  it('restricts payment navigation to Stripe Checkout', () => {
    expect(customerBookingRecoveryUrl('https://checkout.stripe.com/c/pay/cs_test_synthetic', 'resume')).not.toBeNull();
    expect(customerBookingRecoveryUrl('https://checkout.stripe.com.evil.example/c/pay/cs_test_synthetic', 'resume')).toBeNull();
  });
});
