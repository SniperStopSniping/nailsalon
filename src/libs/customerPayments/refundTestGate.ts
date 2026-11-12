import { isCustomerPaymentLedgerTestEnabled } from './ledgerTestGate';

/** Internal synthetic evidence only; never authorizes a provider operation. */
export function isCustomerPaymentRefundTestEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED === 'true'
    && isCustomerPaymentLedgerTestEnabled(environment);
}
