export type PublicSentryRuntimeEnv = {
  NEXT_PUBLIC_SENTRY_DSN?: string;
  NEXT_PUBLIC_SENTRY_RELEASE?: string;
  NEXT_PUBLIC_SENTRY_ENVIRONMENT?: string;
};

type PublicSentryRuntimeEnvSource = PublicSentryRuntimeEnv | Record<string, string | undefined>;

/**
 * The subset of a Sentry event `beforeSend` needs to scrub. Deliberately a
 * structural subset with NO index signature, so Sentry's own `ErrorEvent`
 * satisfies it and the scrubber can be passed straight to `Sentry.init`.
 */
export type ScrubbableSentryEvent = {
  request?: {
    url?: string;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
  };
};

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
    beforeSend: <T extends ScrubbableSentryEvent>(event: T) => T;
  };

/**
 * Owner-assistant requests carry the owner's own words in the body and the
 * session cookie in the headers. An error report from those routes would ship
 * both to a third party, so both are removed before the event leaves the
 * process. Everything else about the event — the stack, the route, the status
 * — is untouched, and every other route is untouched too.
 */
export const OWNER_ASSISTANT_SCRUBBED_PATH = '/api/admin/owner-assistant/';

export function scrubSentryEvent<T extends ScrubbableSentryEvent>(event: T): T {
  if (event.request?.url?.includes(OWNER_ASSISTANT_SCRUBBED_PATH)) {
    delete event.request.data;
    delete event.request.cookies;
    // The raw `Cookie` header carries the admin session even when the parsed
    // cookies are dropped; `Authorization` would carry a bearer token.
    if (event.request.headers) {
      for (const name of Object.keys(event.request.headers)) {
        const lower = name.toLowerCase();
        if (lower === 'cookie' || lower === 'authorization') {
          delete event.request.headers[name];
        }
      }
    }
  }
  return event;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
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
    beforeSend: scrubSentryEvent,
  };
}
