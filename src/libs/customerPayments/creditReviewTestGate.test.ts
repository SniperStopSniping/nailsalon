import { describe, expect, it } from 'vitest';

import { isCustomerPaymentCreditReviewTestEnabled } from './creditReviewTestGate';

const enabled = { NODE_ENV: 'test', APP_ENV: 'development', CUSTOMER_PAYMENTS_PREPARATION_ENABLED: 'true', CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED: 'true', CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED: 'true' };

describe('synthetic credit review gate', () => {
  it('defaults off and requires every upstream gate', () => {
    expect(isCustomerPaymentCreditReviewTestEnabled({})).toBe(false);
    expect(isCustomerPaymentCreditReviewTestEnabled(enabled)).toBe(true);

    for (const key of ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED']) {
      expect(isCustomerPaymentCreditReviewTestEnabled({ ...enabled, [key]: 'false' })).toBe(false);
    }
  });

  it.each(['NODE_ENV', 'APP_ENV', 'VERCEL_ENV'])('refuses production marker %s', (key) => {
    expect(isCustomerPaymentCreditReviewTestEnabled({ ...enabled, [key]: 'production' })).toBe(false);
  });

  it('does not require future refund writes to remain enabled', () => {
    expect(isCustomerPaymentCreditReviewTestEnabled({ ...enabled, CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED: 'false' })).toBe(true);
  });
});
