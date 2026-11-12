import { describe, expect, it } from 'vitest';

import { isCustomerPaymentsRehearsalEnabled } from './rehearsal';

describe('customer payment rehearsal gate', () => {
  it('is disabled by default and refuses an unknown runtime', () => {
    expect(isCustomerPaymentsRehearsalEnabled({ APP_ENV: 'development' })).toBe(false);
    expect(isCustomerPaymentsRehearsalEnabled({ CUSTOMER_PAYMENTS_REHEARSAL_ENABLED: 'true' })).toBe(false);
  });

  it.each(['1', 'yes', 'false', 'TRUE', ''])('requires an exact explicit switch: %s', (flag) => {
    expect(isCustomerPaymentsRehearsalEnabled({ CUSTOMER_PAYMENTS_REHEARSAL_ENABLED: flag, APP_ENV: 'development' })).toBe(false);
  });

  it.each(['development', 'preview'])('permits an explicitly enabled %s rehearsal', (runtime) => {
    expect(isCustomerPaymentsRehearsalEnabled({ CUSTOMER_PAYMENTS_REHEARSAL_ENABLED: 'true', APP_ENV: runtime })).toBe(true);
  });

  it.each([
    { APP_ENV: 'production' },
    { VERCEL_ENV: 'production', VERCEL: '1' },
    { APP_ENV: 'development', VERCEL_ENV: 'production', VERCEL: '1' },
    { APP_ENV: 'production', NODE_ENV: 'test' },
    { APP_ENV: 'development', VERCEL_ENV: 'preview', VERCEL: '1' },
    { APP_ENV: 'banana' },
  ])('refuses production/conflicting/invalid environment %j', (environment) => {
    expect(isCustomerPaymentsRehearsalEnabled({ CUSTOMER_PAYMENTS_REHEARSAL_ENABLED: 'true', ...environment })).toBe(false);
  });
});
