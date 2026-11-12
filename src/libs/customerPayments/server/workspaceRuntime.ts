import 'server-only';

import { getCanonicalAppOrigin } from '@/libs/publicUrl';

import { isPaymentWorkspaceEnabled } from '../workspacePolicy';
import { paymentReturnSigningKeyHash } from './paymentReturnToken';
import type { WorkspaceRuntime } from './workspacePolicyRepository';

export function workspaceRuntime(): WorkspaceRuntime {
  const livemode = process.env.APP_ENV === 'production';
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  const platformAccountId = process.env.CUSTOMER_PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID ?? '';
  // Test Checkout must return to the tested deployment, not a production URL
  // inherited through the project's public branding environment variables.
  const returnOrigin = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
    ? new URL(`https://${process.env.VERCEL_URL}`).origin
    : getCanonicalAppOrigin();
  return {
    executionEnabled: isPaymentWorkspaceEnabled()
      && process.env.CUSTOMER_PAYMENTS_PROVIDER_EXECUTION_ENABLED === 'true'
      && paymentReturnSigningKeyHash() !== null
      && (!livemode || process.env.NODE_ENV === 'production')
      && /^acct_[A-Za-z0-9]+$/.test(platformAccountId)
      && key.startsWith(livemode ? 'sk_live_' : 'sk_test_')
      && !!process.env.STRIPE_CUSTOMER_PAYMENTS_WEBHOOK_SECRET
      && /^we_[A-Za-z0-9]+$/.test(process.env.CUSTOMER_PAYMENTS_STRIPE_WEBHOOK_ENDPOINT_ID ?? ''),
    platformAccountId,
    livemode,
    returnOrigin,
  };
}
