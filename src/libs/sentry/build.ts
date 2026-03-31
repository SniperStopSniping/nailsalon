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
  return trimmed ? trimmed : undefined;
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

export function assertProductionSentryBuildEnv(env: SentryBuildEnv): void {
  const missing = getMissingProductionSentryEnv(env);

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    `[Sentry] Production build blocked. Missing required Sentry env vars: ${missing.join(', ')}. `
    + 'These variables are required to initialize runtime Sentry, create releases, and upload source maps safely in production.',
  );
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
