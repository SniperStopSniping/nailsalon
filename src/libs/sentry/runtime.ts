export type PublicSentryRuntimeEnv = {
  NEXT_PUBLIC_SENTRY_DSN?: string;
  NEXT_PUBLIC_SENTRY_RELEASE?: string;
  NEXT_PUBLIC_SENTRY_ENVIRONMENT?: string;
};

type PublicSentryRuntimeEnvSource = PublicSentryRuntimeEnv | Record<string, string | undefined>;

/**
 * Structural subsets let the same privacy rules cover SDK error events,
 * transactions and spans without coupling the app to private SDK types.
 */
export type ScrubbableSentrySpan = {
  op?: string;
  data?: Record<string, unknown>;
};

export type ScrubbableSentryEvent = {
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
  };
  contexts?: { trace?: { data?: Record<string, unknown> } };
  spans?: ScrubbableSentrySpan[];
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
    beforeSendTransaction: <T extends ScrubbableSentryEvent>(event: T) => T;
    beforeSendSpan: <T extends ScrubbableSentrySpan>(span: T) => T;
  };

/**
 * Assistant and customer-booking requests can contain private words and bearer
 * state. Preserve the established request redaction for those routes in both
 * errors and transactions; remove database usernames from trace attributes.
 * Stacks, route names, status codes and span timing remain available.
 */
export const OWNER_ASSISTANT_SCRUBBED_PATH = '/api/admin/owner-assistant/';
export const CUSTOMER_ASSISTANT_SCRUBBED_PATH = '/api/public/customer-assistant/';
export const CUSTOMER_BOOKING_SCRUBBED_PATH = '/api/public/customer-booking/';

function isScrubbedCustomerUrl(url: unknown): url is string {
  return typeof url === 'string'
    && (url.includes(CUSTOMER_ASSISTANT_SCRUBBED_PATH) || url.includes(CUSTOMER_BOOKING_SCRUBBED_PATH));
}

function scrubSpanData(data: Record<string, unknown> | undefined, protectedPublicRequest = false): void {
  if (!data) {
    return;
  }
  // Database account names are not needed for request performance diagnostics.
  delete data['db.user'];
  let protectedUrl = protectedPublicRequest;
  for (const key of ['http.url', 'url.full', 'http.target']) {
    const url = data[key];
    if (isScrubbedCustomerUrl(url)) {
      data[key] = url.split('?')[0];
      protectedUrl = true;
    }
  }
  if (protectedUrl) {
    delete data['url.query'];
  }
}

export function scrubSentrySpan<T extends ScrubbableSentrySpan>(span: T): T {
  scrubSpanData(span.data);
  return span;
}

export function scrubSentryEvent<T extends ScrubbableSentryEvent>(event: T): T {
  const protectedPublicRequest = isScrubbedCustomerUrl(event.request?.url);
  // The SDK uses separate hooks for errors, root transactions and child spans.
  // Cover root and child attributes here too, including query-only attributes
  // whose protected route is identified by the transaction request.
  scrubSpanData(event.contexts?.trace?.data, protectedPublicRequest);
  for (const span of event.spans ?? []) {
    scrubSpanData(span.data, protectedPublicRequest);
  }
  if (protectedPublicRequest && event.request) {
    // Customer utterances and bearer conversation state are never telemetry.
    delete event.request.query_string;
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    event.request.url = event.request.url?.split('?')[0];
  }
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
    beforeSendTransaction: scrubSentryEvent,
    beforeSendSpan: scrubSentrySpan,
  };
}
