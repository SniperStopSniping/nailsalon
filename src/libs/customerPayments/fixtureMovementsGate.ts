import { isCustomerPaymentFixtureApplicationEnabled } from './fixtureApplicationGate';

/** New offline movement writes only; never provider execution authority. */
export function isCustomerPaymentFixtureMovementsEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.CUSTOMER_PAYMENTS_FIXTURE_MOVEMENTS_ENABLED === 'true'
    && isCustomerPaymentFixtureApplicationEnabled(environment);
}
export function requireCustomerPaymentFixtureMovementsEnabled(): void {
  if (!isCustomerPaymentFixtureMovementsEnabled()) {
    throw new Error('CUSTOMER_PAYMENT_FIXTURE_MOVEMENTS_DISABLED');
  }
}
