import { isCustomerPaymentLedgerTestEnabled } from './ledgerTestGate';
import { isCustomerPaymentProviderFixtureEnabled } from './providerTestGate';

/** New offline canonical test applications only. Never real provider authority. */
export function isCustomerPaymentFixtureApplicationEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED === 'true'
    && (environment.VERCEL !== '1' || ['development', 'preview'].includes(environment.VERCEL_ENV ?? ''))
    && isCustomerPaymentProviderFixtureEnabled(environment)
    && isCustomerPaymentLedgerTestEnabled(environment);
}
export function requireCustomerPaymentFixtureApplicationEnabled(): void {
  if (!isCustomerPaymentFixtureApplicationEnabled()) {
    throw new Error('CUSTOMER_PAYMENT_FIXTURE_APPLICATION_DISABLED');
  }
}
