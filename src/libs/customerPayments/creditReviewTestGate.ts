import { isCustomerPaymentLedgerTestEnabled } from './ledgerTestGate';

/** Internal synthetic review writes only; historical reads must not use this switch. */
export function isCustomerPaymentCreditReviewTestEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED === 'true'
    && isCustomerPaymentLedgerTestEnabled(environment);
}
