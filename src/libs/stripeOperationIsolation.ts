import 'server-only';

import { expectedBillingPlanEnv, resolveRuntimeEnvironment } from '@/libs/environmentIsolation';

/** Contains no credential, runtime marker, or provider response in its message. */
export class StripeOperationIsolationError extends Error {
  readonly code = 'STRIPE_OPERATION_ISOLATION_REFUSED';

  constructor() {
    super('Stripe checkout is unavailable in this environment.');
    this.name = 'StripeOperationIsolationError';
  }
}

/**
 * Capture the mode of the credential used to construct a client, not the key
 * process.env happens to hold when a later request arrives. Retain only its
 * classification in the closure; malformed credentials remain fail-closed.
 */
export function createStripeOperationGuard(credential: string | undefined) {
  const validCredential = typeof credential === 'string' && !/\s/.test(credential);
  const credentialMode = validCredential && /^sk_test_\S+$/.test(credential)
    ? 'test'
    : validCredential && /^sk_live_\S+$/.test(credential) ? 'live' : null;

  return (planEnv: string | undefined): boolean => {
    try {
      const runtime = resolveRuntimeEnvironment();
      if ((runtime !== 'development' && runtime !== 'preview' && runtime !== 'production')
        || planEnv !== expectedBillingPlanEnv(runtime)
        || credentialMode !== (runtime === 'production' ? 'live' : 'test')) {
        throw new StripeOperationIsolationError();
      }
      return runtime === 'production';
    } catch {
      throw new StripeOperationIsolationError();
    }
  };
}
