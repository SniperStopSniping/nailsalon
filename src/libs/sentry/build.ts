export type SentryBuildEnv = {
  NEXT_PUBLIC_SENTRY_DSN?: string;
  SENTRY_ORG?: string;
  SENTRY_PROJECT?: string;
  SENTRY_AUTH_TOKEN?: string;
  SENTRY_RELEASE?: string;
  SENTRY_ENVIRONMENT?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  GITHUB_SHA?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  CI?: string;
  GITHUB_ACTIONS?: string;
  SENTRY_STRICT_BUILD?: string;
};

const REQUIRED_PRODUCTION_SENTRY_ENV = [
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_AUTH_TOKEN',
] as const;

type RequiredProductionSentryEnv = typeof REQUIRED_PRODUCTION_SENTRY_ENV[number];

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function resolveSentryRelease(env: SentryBuildEnv, packageVersion?: string): string | undefined {
  return clean(env.SENTRY_RELEASE)
    ?? clean(env.VERCEL_GIT_COMMIT_SHA)
    ?? clean(env.GITHUB_SHA)
    ?? clean(packageVersion);
}

export function resolveSentryEnvironment(env: SentryBuildEnv): string | undefined {
  return clean(env.SENTRY_ENVIRONMENT)
    ?? clean(env.VERCEL_ENV)
    ?? clean(env.NODE_ENV);
}

export function getMissingProductionSentryEnv(env: SentryBuildEnv): RequiredProductionSentryEnv[] {
  return REQUIRED_PRODUCTION_SENTRY_ENV.filter(key => !clean(env[key]));
}

export function shouldEnforceProductionSentryBuildEnv(env: SentryBuildEnv): boolean {
  return clean(env.SENTRY_STRICT_BUILD) === 'true';
}

export function assertProductionSentryBuildEnv(env: SentryBuildEnv): void {
  const missing = getMissingProductionSentryEnv(env);

  if (missing.length === 0) {
    return;
  }

  const message = `[Sentry] Production build missing Sentry env vars: ${missing.join(', ')}. `
    + 'Runtime Sentry and source-map upload will be disabled for this deploy.';

  throw new Error(`${message} Configure Sentry env vars or unset SENTRY_STRICT_BUILD to continue.`);
}

export function shouldEnableSentryWebpackPlugin(env: SentryBuildEnv): boolean {
  return getMissingProductionSentryEnv(env).length === 0;
}

export function getPublicSentryRuntimeEnv(env: SentryBuildEnv, packageVersion?: string): {
  NEXT_PUBLIC_SENTRY_RELEASE?: string;
  NEXT_PUBLIC_SENTRY_ENVIRONMENT?: string;
} {
  return {
    NEXT_PUBLIC_SENTRY_RELEASE: resolveSentryRelease(env, packageVersion),
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: resolveSentryEnvironment(env),
  };
}
