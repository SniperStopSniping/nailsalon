import { describe, expect, it } from 'vitest';

import { isCustomerPaymentPreparationEnabled } from './preparationGate';

describe('persisted customer payment preparation gate', () => {
  it('is off by default, independent of the display rehearsal', () => {
    expect(isCustomerPaymentPreparationEnabled({ APP_ENV: 'development', CUSTOMER_PAYMENTS_REHEARSAL_ENABLED: 'true' })).toBe(false);
  });

  it.each(['development', 'preview'])('requires explicit preparation enablement in %s', (APP_ENV) => {
    expect(isCustomerPaymentPreparationEnabled({ APP_ENV, CUSTOMER_PAYMENTS_PREPARATION_ENABLED: 'true' })).toBe(true);
  });

  it.each([
    {},
    { NODE_ENV: 'production' },
    { APP_ENV: 'production', NODE_ENV: 'test' },
    { APP_ENV: 'production', VITEST: 'true' },
    { APP_ENV: 'unknown' },
    { VERCEL: '1', VERCEL_ENV: 'production', APP_ENV: 'production' },
    { VERCEL: '1', VERCEL_ENV: 'preview', APP_ENV: 'development' },
    { CI: '1' },
  ])('fails closed for production, conflicting or unknown runtime %j', (environment) => {
    expect(isCustomerPaymentPreparationEnabled({ ...environment, CUSTOMER_PAYMENTS_PREPARATION_ENABLED: 'true' })).toBe(false);
  });

  it.each(['1', 'TRUE', 'yes', 'false', ''])('rejects nonliteral enablement %s', (flag) => {
    expect(isCustomerPaymentPreparationEnabled({ APP_ENV: 'development', CUSTOMER_PAYMENTS_PREPARATION_ENABLED: flag })).toBe(false);
  });
});
