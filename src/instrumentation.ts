import * as Sentry from '@sentry/nextjs';
import { getPublicSentryRuntimeConfig } from '@/libs/sentry/runtime';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' && process.env.NEXT_RUNTIME !== 'edge') {
    return;
  }

  const config = getPublicSentryRuntimeConfig();

  if (!config.enabled) {
    return;
  }

  Sentry.init(config);
}
