// Read-only provider attestation for a protected Preview build. No database,
// payment, refund, account creation, webhook creation or environment mutation.
import Stripe from 'stripe';

async function main() {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (process.env.VERCEL_ENV !== 'preview' || !key.startsWith('sk_test_')) {
    throw new Error('PREVIEW_TEST_CREDENTIAL_REQUIRED');
  }
  const stripe = new Stripe(key, { apiVersion: '2024-06-20', maxNetworkRetries: 0, timeout: 10000, telemetry: false });
  const platform = await stripe.accounts.retrieve();
  const balance = await stripe.balance.retrieve();
  if (!/^acct_[A-Za-z0-9]+$/.test(platform.id) || balance.livemode !== false) {
    throw new Error('PREVIEW_PROVIDER_MODE_REJECTED');
  }
  const accounts = await stripe.accounts.list({ limit: 100 });
  const ready = accounts.data.filter(account => account.country === 'CA' && account.default_currency === 'cad'
    && account.charges_enabled && account.payouts_enabled && account.details_submitted
    && account.capabilities?.card_payments === 'active' && account.controller?.stripe_dashboard?.type === 'full'
    && account.controller?.fees?.payer === 'account' && account.controller?.losses?.payments === 'stripe'
    && account.controller?.requirement_collection === 'stripe'
    && account.requirements && !account.requirements.disabled_reason && !account.requirements.currently_due?.length
    && !account.requirements.past_due?.length && !account.requirements.pending_verification?.length && !account.requirements.errors?.length);
  // Neither credentials nor customer/account profile fields are included.
  process.stdout.write(`CUSTOMER_PAYMENT_PREVIEW_PROVIDER ${JSON.stringify({
    authenticated: true,
    livemode: false,
    platformAccountId: platform.id,
    connectedAccountsObserved: accounts.data.length,
    additionalAccountsExist: accounts.has_more,
    readyCanadianStandardAccountsObserved: ready.length,
  })}\n`);
}

try {
  await main();
} catch (error) {
  const known = new Set(['PREVIEW_TEST_CREDENTIAL_REQUIRED', 'PREVIEW_PROVIDER_MODE_REJECTED']);
  const code = known.has(error?.message)
    ? error.message
    : error instanceof Stripe.errors.StripeAuthenticationError
      ? 'PREVIEW_STRIPE_AUTHENTICATION_FAILED'
      : error instanceof Stripe.errors.StripePermissionError
        ? 'PREVIEW_STRIPE_PERMISSION_DENIED'
        : 'PREVIEW_PROVIDER_CHECK_FAILED';
  console.error(code);
  process.exitCode = 1;
}
