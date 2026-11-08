import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCustomerPaymentProviderFixtureEnabled, requireCustomerPaymentProviderFixtureEnabled } from './providerTestGate';

const enabled = { NODE_ENV: 'test', APP_ENV: 'development', CUSTOMER_PAYMENTS_PREPARATION_ENABLED: 'true', CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED: 'true' };

afterEach(() => vi.unstubAllEnvs());

describe('offline provider fixture gate', () => {
  it('defaults off and requires explicit fixture and preparation switches', () => {
    expect(isCustomerPaymentProviderFixtureEnabled({})).toBe(false);
    expect(isCustomerPaymentProviderFixtureEnabled(enabled)).toBe(true);

    for (const key of ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED']) {
      for (const value of [undefined, 'false', 'TRUE', '1']) {
        expect(isCustomerPaymentProviderFixtureEnabled({ ...enabled, [key]: value })).toBe(false);
      }
    }
  });

  it.each([undefined, 'development', 'production', 'preview', 'Test'])('refuses NODE_ENV %s even when explicitly enabled', (NODE_ENV) => {
    expect(isCustomerPaymentProviderFixtureEnabled({ ...enabled, NODE_ENV })).toBe(false);
  });

  it.each(['APP_ENV', 'VERCEL_ENV'])('independently refuses production marker %s', (key) => {
    expect(isCustomerPaymentProviderFixtureEnabled({ ...enabled, [key]: 'production' })).toBe(false);
  });

  it('cannot enable synthetic ledger or refund authority', () => {
    expect(isCustomerPaymentProviderFixtureEnabled({ ...enabled, CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED: 'false', CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED: 'false' })).toBe(true);
  });

  it('throws before a caller can perform fixture work', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
    vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');

    expect(requireCustomerPaymentProviderFixtureEnabled).toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
  });
});
