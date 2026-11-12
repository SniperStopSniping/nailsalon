import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';

/**
 * Presentation-only rehearsal. This gate never enables a payment, a live salon
 * setting or a provider call. Production is refused even with the flag set.
 * Keep this separate from the eventual collection/receipt processing gates.
 */
export function isCustomerPaymentsRehearsalEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (environment.CUSTOMER_PAYMENTS_REHEARSAL_ENABLED !== 'true'
    || environment.VERCEL_ENV === 'production'
    || environment.APP_ENV === 'production') {
    return false;
  }
  try {
    const runtime = resolveRuntimeEnvironment(environment);
    return runtime === 'development' || runtime === 'preview' || runtime === 'test';
  } catch {
    // Conflicting/unknown deployment identity cannot expose the preview.
    return false;
  }
}
