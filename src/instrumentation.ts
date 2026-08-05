import * as Sentry from '@sentry/nextjs';

import { assertEnvironmentIsolation } from '@/libs/environmentIsolation';
import { getPublicSentryRuntimeConfig } from '@/libs/sentry/runtime';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' && process.env.NEXT_RUNTIME !== 'edge') {
    return;
  }

  assertEnvironmentIsolation(process.env);

  const config = getPublicSentryRuntimeConfig();

  if (!config.enabled) {
    return;
  }

  Sentry.init(config);
}
