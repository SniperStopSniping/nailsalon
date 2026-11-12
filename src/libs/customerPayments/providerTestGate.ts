import { isCustomerPaymentPreparationEnabled } from './preparationGate';

/** Offline signed fixtures only. This switch cannot enable a provider integration. */
export function isCustomerPaymentProviderFixtureEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return environment.NODE_ENV === 'test'
    && environment.CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED === 'true'
    && isCustomerPaymentPreparationEnabled(environment);
}

export function requireCustomerPaymentProviderFixtureEnabled(): void {
  if (!isCustomerPaymentProviderFixtureEnabled()) {
    throw new Error('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
  }
}
