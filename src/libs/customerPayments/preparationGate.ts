import { resolveRuntimeEnvironment } from '@/libs/environmentIsolation';

/** Controls test-only draft/quote persistence. It never enables collection. */
export function isCustomerPaymentPreparationEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (environment.CUSTOMER_PAYMENTS_PREPARATION_ENABLED !== 'true'
    || environment.APP_ENV === 'production' || environment.VERCEL_ENV === 'production') {
    return false;
  }
  try {
    return ['development', 'preview', 'test'].includes(resolveRuntimeEnvironment(environment));
  } catch {
    return false;
  }
}
