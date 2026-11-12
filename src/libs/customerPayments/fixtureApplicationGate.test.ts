import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCustomerPaymentFixtureApplicationEnabled, requireCustomerPaymentFixtureApplicationEnabled } from './fixtureApplicationGate';

const enabled = { NODE_ENV: 'test', APP_ENV: 'development', VERCEL_ENV: '', VERCEL: '', CUSTOMER_PAYMENTS_PREPARATION_ENABLED: 'true', CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED: 'true', CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED: 'true', CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED: 'true' };

afterEach(() => vi.unstubAllEnvs());

describe('offline fixture application gate', () => {
  it('defaults off and requires every independent prerequisite', () => {
    expect(isCustomerPaymentFixtureApplicationEnabled({})).toBe(false);
    expect(isCustomerPaymentFixtureApplicationEnabled(enabled)).toBe(true);

    for (const key of ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED']) {
      expect(isCustomerPaymentFixtureApplicationEnabled({ ...enabled, [key]: 'false' })).toBe(false);
      expect(isCustomerPaymentFixtureApplicationEnabled({ ...enabled, [key]: undefined })).toBe(false);
    }
  });

  it.each([{ NODE_ENV: 'production' }, { NODE_ENV: 'development' }, { APP_ENV: 'production' }, { VERCEL_ENV: 'production' }, { VERCEL: '1', VERCEL_ENV: undefined }, { CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED: 'TRUE' }])('refuses production and ambiguous activation %j', (override) => {
    expect(isCustomerPaymentFixtureApplicationEnabled({ ...enabled, ...override })).toBe(false);
  });

  it('throws without activation, with no database dependency', () => {
    for (const [key, value] of Object.entries(enabled)) {
      vi.stubEnv(key, value);
    }

    expect(() => requireCustomerPaymentFixtureApplicationEnabled()).not.toThrow();

    vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false');

    expect(() => requireCustomerPaymentFixtureApplicationEnabled()).toThrow('CUSTOMER_PAYMENT_FIXTURE_APPLICATION_DISABLED');
  });
});
