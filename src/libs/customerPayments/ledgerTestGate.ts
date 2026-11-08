import { isCustomerPaymentPreparationEnabled } from './preparationGate';

/** Synthetic ledger fixture writes only. Never enables a real provider adapter. */
export function isCustomerPaymentLedgerTestEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED === 'true'
    && environment.NODE_ENV !== 'production'
    && isCustomerPaymentPreparationEnabled(environment);
}
