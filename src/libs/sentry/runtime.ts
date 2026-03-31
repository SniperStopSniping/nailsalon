export type PublicSentryRuntimeEnv = {
  NEXT_PUBLIC_SENTRY_DSN?: string;
  NEXT_PUBLIC_SENTRY_RELEASE?: string;
  NEXT_PUBLIC_SENTRY_ENVIRONMENT?: string;
};

type PublicSentryRuntimeEnvSource = PublicSentryRuntimeEnv | Record<string, string | undefined>;

export type SentryRuntimeConfig =
  | {
    enabled: false;
  }
  | {
    enabled: true;
    dsn: string;
    release?: string;
    environment?: string;
    tracesSampleRate: number;
    debug: boolean;
  };

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getPublicSentryRuntimeConfig(env: PublicSentryRuntimeEnvSource = process.env): SentryRuntimeConfig {
  const dsn = clean(env.NEXT_PUBLIC_SENTRY_DSN);

  if (!dsn) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: true,
    dsn,
    release: clean(env.NEXT_PUBLIC_SENTRY_RELEASE),
    environment: clean(env.NEXT_PUBLIC_SENTRY_ENVIRONMENT),
    tracesSampleRate: 1,
    debug: false,
  };
}
