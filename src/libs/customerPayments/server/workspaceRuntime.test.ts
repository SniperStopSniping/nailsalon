import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPaymentWorkspaceEnabled } from '../workspacePolicy';
import { workspaceRuntime } from './workspaceRuntime';

vi.mock('server-only', () => ({}));

beforeEach(() => {
  vi.stubEnv('CUSTOMER_PAYMENTS_WORKSPACE_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'preview');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VERCEL_URL', 'preview.example.invalid');
  vi.stubEnv('PUBLIC_APP_URL', 'https://production.example.invalid');
  vi.stubEnv('STRIPE_SECRET_KEY', ['sk', 'test', 'synthetic-not-a-credential'].join('_'));
  vi.stubEnv('STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET', 'synthetic-webhook-placeholder');
  vi.stubEnv('CUSTOMER_PAYMENTS_STRIPE_WEBHOOK_ENDPOINT_ID', 'we_synthetic');
  vi.stubEnv('CUSTOMER_PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID', 'acct_synthetic');
});

afterEach(() => vi.unstubAllEnvs());

describe('workspace environment boundaries', () => {
  it('returns test Checkout to the actual Preview deployment', () => {
    expect(workspaceRuntime()).toMatchObject({ executionEnabled: true, livemode: false, returnOrigin: 'https://preview.example.invalid' });
  });

  it.each(['CUSTOMER_PAYMENTS_WORKSPACE_ENABLED', 'CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED', 'STRIPE_SECRET_KEY', 'STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET', 'CUSTOMER_PAYMENTS_STRIPE_WEBHOOK_ENDPOINT_ID', 'CUSTOMER_PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID'])('refuses execution with missing %s', (key) => {
    vi.stubEnv(key, '');

    expect(workspaceRuntime().executionEnabled).toBe(false);
  });

  it('refuses a production/preview environment crossing and a test key in production', () => {
    vi.stubEnv('APP_ENV', 'production');

    expect(isPaymentWorkspaceEnabled()).toBe(false);
    expect(workspaceRuntime().executionEnabled).toBe(false);

    vi.stubEnv('VERCEL_ENV', 'production');

    expect(isPaymentWorkspaceEnabled()).toBe(true);
    expect(workspaceRuntime().executionEnabled).toBe(false);
  });
});
