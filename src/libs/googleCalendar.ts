import 'server-only';

import { createHash, createSign } from 'node:crypto';

import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import {
  classifyApiFailure,
  classifyDecryptFailure,
  classifyMissingClientConfig,
  classifyNetworkFailure,
  classifyTokenRefreshFailure,
  formatPersistedError,
  type GoogleFailureClassification,
  statusForClassification,
} from '@/libs/googleCalendarFailure';
import type { GoogleCalendarAttendee } from '@/libs/googleEventAutofill';
import { decryptIntegrationSecret, encryptIntegrationSecret } from '@/libs/lusterSecurity';
import {
  appointmentSchema,
  googleCalendarEventSchema,
  integrationOutboxSchema,
  salonGoogleCalendarConnectionSchema,
} from '@/models/Schema';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_REFRESH_SAFETY_SECONDS = 60;
const GOOGLE_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;
const GOOGLE_EVENT_LIST_TIMEOUT_MS = 45_000;
const GOOGLE_EVENT_LIST_MAX_PAGES = 10;

type GoogleCalendarConfig = {
  calendarId: string;
  clientEmail: string;
  privateKey: string;
};

type GoogleCalendarRequestContext = {
  accessToken: string;
  calendarId: string;
  busyCalendarIds: string[];
  connectionType: 'oauth' | 'legacy';
  connectionRevision?: string;
};

type GoogleCalendarConnectionUpdate
  = Partial<typeof salonGoogleCalendarConnectionSchema.$inferInsert>;

export type GoogleCalendarBusyWindow = {
  startTime: Date;
  endTime: Date;
};

export type GoogleCalendarAppointmentEventInput = {
  appointmentId: string;
  salonId: string;
  salonName: string;
  clientName?: string | null;
  clientPhone: string;
  serviceNames: string[];
  technicianName?: string | null;
  startTime: Date;
  endTime: Date;
  totalPrice: number;
  /**
   * Financial copy is opt-in and provenance-bound. Legacy callers that only
   * provide `totalPrice` receive a money-free review line rather than a
   * guessed CAD invoice amount.
   */
  pricePresentation?:
    | {
      state: 'booked_service_subtotal';
      amountCents: number;
      currency: string;
    }
    | { state: 'under_review' };
  totalDurationMinutes: number;
  timeZone: string;
  locationName?: string | null;
  locationAddress?: string | null;
  notes?: string | null;
  googleCalendarEventId?: string | null;
  /** Immutable local appointment revision represented by this provider write. */
  mutationVersion?: string;
};

export type GoogleCalendarSyncResult =
  | { status: 'disabled' }
  | { status: 'synced'; eventId: string; calendarId?: string }
  | { status: 'deleted'; eventId?: string; calendarId?: string }
  | {
    status: 'failed';
    error: string;
    eventId?: string | null;
    calendarId?: string;
    /** True once this invocation entered deterministic create dispatch. */
    createAttempted?: boolean;
  };

export type GoogleCalendarProviderOptions = {
  /** Aborts token acquisition and the Calendar request for this operation. */
  signal?: AbortSignal;
  /**
   * The outbox worker owns attempt-fenced bookkeeping, so it disables the
   * legacy appointment/event writes while retaining the provider result.
   */
  persistResult?: boolean;
  /** May shorten, but never extend, the 30-second request ceiling. */
  requestTimeoutMs?: number;
  /** Admin copy intentionally creates in the configured destination calendar. */
  useDestinationCalendar?: boolean;
  /** Stable appointment/calendar lifecycle lane used for an idempotent event id. */
  idempotencyKey?: string;
  /** Durable destination captured by the claiming outbox attempt. */
  targetCalendarId?: string;
  /** Immutable local-mirror proof captured by reconciliation discovery. */
  reconciliationMirrorId?: string;
  reconciliationExpectedAppointmentId?: string | null;
  /** Inbound deletion barrier for an exact same-owner mirror already marked deleted. */
  authoritativeTerminalDelete?: boolean;
  /**
   * Outbox-only final request gate. It must perform the synchronized current
   * intent/attempt checks and retain provider-attempt liveness until the
   * concrete Calendar transport promise settles.
   */
  dispatchFence?: <T>(operation: () => Promise<T>) => Promise<T>;
  /** Exact durable attempt allowed to publish shared connection state. */
  attemptFence?: { jobId: string; claimedAttempt: number };
  /** Durable appointment revision represented by a conditional delete. */
  mutationVersion?: string;
};

export class GoogleCalendarDispatchFenceError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('Google Calendar dispatch fence rejected the request');
    this.name = 'GoogleCalendarDispatchFenceError';
    this.cause = cause;
  }
}

export class GoogleCalendarConnectionWriteFenceError extends Error {
  constructor() {
    super('GOOGLE_CALENDAR_CONNECTION_WRITE_FENCE_LOST');
    this.name = 'GoogleCalendarConnectionWriteFenceError';
  }
}

export type GoogleCalendarListOptions = Pick<
  GoogleCalendarProviderOptions,
  'requestTimeoutMs' | 'signal'
> & {
  /** Aggregate ceiling for context acquisition and every events.list page. */
  timeoutMs?: number;
  /** May shorten, but never extend, the ten-page ceiling per selected calendar. */
  maxPages?: number;
};

type GoogleCalendarRequestOptions = Pick<
  GoogleCalendarProviderOptions,
  'attemptFence' | 'dispatchFence' | 'requestTimeoutMs' | 'signal'
>;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  /** Present only when Google rotates the refresh token. */
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleFreeBusyResponse = {
  calendars?: Record<string, {
    busy?: Array<{ start: string; end: string }>;
    errors?: Array<{ reason?: string; message?: string }>;
  }>;
};

type GoogleCalendarEventResponse = {
  etag?: string;
  extendedProperties?: { private?: Record<string, string> };
  id?: string;
};

export type GoogleCalendarRemoteEvent = {
  id: string;
  calendarId: string;
  status: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  recurringEventId: string | null;
  transparency: 'busy' | 'free';
  isAllDay: boolean;
  startTime: Date | null;
  endTime: Date | null;
  updatedAt: Date | null;
  appointmentId: string | null;
  salonId: string | null;
  mutationVersion?: string | null;
  attendees?: GoogleCalendarAttendee[];
};

type GoogleCalendarEventListResponse = {
  items?: Array<{
    id?: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    recurringEventId?: string;
    transparency?: string;
    updated?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
    extendedProperties?: { private?: Record<string, string> };
    attendees?: Array<{
      email?: string;
      displayName?: string;
      organizer?: boolean;
      self?: boolean;
    }>;
  }>;
  nextPageToken?: string;
};

class GoogleCalendarApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class GoogleCalendarRequestAbortedError extends Error {
  constructor(message = 'Google provider request was aborted') {
    super(message);
    this.name = 'GoogleCalendarRequestAbortedError';
  }
}

class GoogleCalendarRequestTimeoutError extends Error {
  constructor() {
    super('Google provider request timed out');
    this.name = 'GoogleCalendarRequestTimeoutError';
  }
}

class GoogleCalendarListLimitError extends Error {
  constructor() {
    super('Google Calendar event list page limit exceeded');
    this.name = 'GoogleCalendarListLimitError';
  }
}

class GoogleCalendarConnectionError extends Error {
  reconnectRequired: boolean;

  constructor(reconnectRequired: boolean) {
    super(reconnectRequired
      ? 'Google Calendar reconnect is required'
      : 'Google Calendar is temporarily unavailable');
    this.name = 'GoogleCalendarConnectionError';
    this.reconnectRequired = reconnectRequired;
  }
}

export class GoogleCalendarAvailabilityError extends Error {
  readonly reconnectRequired: boolean;

  constructor(reconnectRequired = false) {
    super(reconnectRequired
      ? 'Google Calendar reconnect is required before availability can be checked'
      : 'Google Calendar availability is temporarily unavailable');
    this.name = 'GoogleCalendarAvailabilityError';
    this.reconnectRequired = reconnectRequired;
  }
}

let cachedToken: { token: string; expiresAtSeconds: number } | null = null;

function throwIfGoogleRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new GoogleCalendarRequestAbortedError();
  }
}

async function fetchGoogleProvider(
  input: string | URL,
  init: RequestInit,
  options: GoogleCalendarRequestOptions = {},
): Promise<Response> {
  const requestedTimeoutMs = options.requestTimeoutMs
    ?? GOOGLE_PROVIDER_REQUEST_TIMEOUT_MS;
  const requestTimeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(1, Math.min(requestedTimeoutMs, GOOGLE_PROVIDER_REQUEST_TIMEOUT_MS))
    : GOOGLE_PROVIDER_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const sourceSignal = options.signal ?? init.signal ?? undefined;
  let timedOut = false;

  const abortFromSource = () => {
    controller.abort(sourceSignal?.reason);
  };
  throwIfGoogleRequestAborted(sourceSignal);
  sourceSignal?.addEventListener('abort', abortFromSource, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  timeout.unref?.();

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    // Buffer the small Google API response before releasing the timeout. Fetch
    // resolves when headers arrive; without this read, a stalled response body
    // could otherwise keep the worker alive indefinitely after that point.
    const body = response.body ? await response.arrayBuffer() : null;
    return new Response(body && body.byteLength > 0 ? body : null, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    if (timedOut) {
      throw new GoogleCalendarRequestTimeoutError();
    }
    if (sourceSignal?.aborted) {
      throw new GoogleCalendarRequestAbortedError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    sourceSignal?.removeEventListener('abort', abortFromSource);
  }
}

function getGoogleCalendarConfig(): GoogleCalendarConfig | null {
  const enabled = Env.GOOGLE_CALENDAR_ENABLED === 'true' || Env.GOOGLE_CALENDAR_ENABLED === '1';
  if (!enabled) {
    return null;
  }

  const calendarId = Env.GOOGLE_CALENDAR_ID?.trim();
  const clientEmail = Env.GOOGLE_CALENDAR_CLIENT_EMAIL?.trim();
  const privateKey = Env.GOOGLE_CALENDAR_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();

  if (!calendarId || !clientEmail || !privateKey) {
    throw new Error('Google Calendar is enabled but service-account env vars are incomplete');
  }

  return {
    calendarId,
    clientEmail,
    privateKey,
  };
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer
    .from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function buildServiceAccountAssertion(config: GoogleCalendarConfig, nowSeconds: number): string {
  const header = base64UrlEncode(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT',
  }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: config.clientEmail,
    scope: GOOGLE_CALENDAR_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
  }));
  const unsignedAssertion = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256')
    .update(unsignedAssertion)
    .sign(config.privateKey);

  return `${unsignedAssertion}.${base64UrlEncode(signature)}`;
}

async function getGoogleAccessToken(
  config: GoogleCalendarConfig,
  options: GoogleCalendarRequestOptions = {},
): Promise<string> {
  throwIfGoogleRequestAborted(options.signal);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAtSeconds > nowSeconds + TOKEN_REFRESH_SAFETY_SECONDS) {
    return cachedToken.token;
  }

  const assertion = buildServiceAccountAssertion(config, nowSeconds);
  let response: Response;
  try {
    response = await fetchGoogleProvider(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    }, options);
  } catch (error) {
    if (error instanceof GoogleCalendarRequestAbortedError) {
      throw error;
    }
    if (error instanceof GoogleCalendarRequestTimeoutError) {
      throw new GoogleCalendarApiError(504, 'Google OAuth token request timed out');
    }
    throw new GoogleCalendarApiError(503, 'Google OAuth token request failed');
  }

  if (!response.ok) {
    throw new GoogleCalendarApiError(response.status, await response.text());
  }

  let data: GoogleTokenResponse;
  try {
    data = await response.json() as GoogleTokenResponse;
  } catch {
    throw new GoogleCalendarApiError(502, 'Google OAuth token response was invalid');
  }
  if (!data.access_token) {
    throw new GoogleCalendarApiError(502, 'Google OAuth token response did not include an access token');
  }

  cachedToken = {
    token: data.access_token,
    expiresAtSeconds: nowSeconds + (data.expires_in ?? 3600),
  };

  return data.access_token;
}

async function googleCalendarFetchWithContext<T>(
  context: GoogleCalendarRequestContext,
  path: string,
  init: RequestInit,
  options: GoogleCalendarRequestOptions = {},
): Promise<T> {
  throwIfGoogleRequestAborted(options.signal);
  let response: Response;
  try {
    const dispatch = () => fetchGoogleProvider(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${context.accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    }, options);
    if (options.dispatchFence) {
      try {
        response = await options.dispatchFence(dispatch);
      } catch (error) {
        throw new GoogleCalendarDispatchFenceError(error);
      }
    } else {
      response = await dispatch();
    }
  } catch (error) {
    if (error instanceof GoogleCalendarDispatchFenceError) {
      throw error;
    }
    if (error instanceof GoogleCalendarRequestAbortedError) {
      throw error;
    }
    if (error instanceof GoogleCalendarRequestTimeoutError) {
      throw new GoogleCalendarApiError(504, 'Google Calendar request timed out');
    }
    throw new GoogleCalendarApiError(503, 'Google Calendar request failed');
  }
  if (response.status === 204) {
    return {} as T;
  }
  if (!response.ok) {
    throw new GoogleCalendarApiError(response.status, await response.text());
  }
  try {
    return await response.json() as T;
  } catch {
    throw new GoogleCalendarApiError(502, 'Google Calendar response was invalid');
  }
}

async function runGoogleCalendarMutationDispatch<T>(
  options: GoogleCalendarProviderOptions,
  operation: (requestOptions: GoogleCalendarRequestOptions) => Promise<T>,
): Promise<T> {
  const requestOptions = { ...options, dispatchFence: undefined };
  if (!options.dispatchFence) {
    return operation(requestOptions);
  }
  try {
    return await options.dispatchFence(() => operation(requestOptions));
  } catch (error) {
    if (error instanceof GoogleCalendarDispatchFenceError) {
      throw error;
    }
    throw new GoogleCalendarDispatchFenceError(error);
  }
}

function remoteMutationVersion(event: GoogleCalendarEventResponse) {
  return event.extendedProperties?.private?.mutationVersion;
}

function remoteEventIsAtLeastRevision(
  event: GoogleCalendarEventResponse,
  mutationVersion: string | undefined,
) {
  const remoteVersion = remoteMutationVersion(event);
  return Boolean(remoteVersion && mutationVersion && remoteVersion >= mutationVersion);
}

async function getGoogleCalendarEventForMutation(
  context: GoogleCalendarRequestContext,
  eventId: string,
  options: GoogleCalendarRequestOptions,
): Promise<GoogleCalendarEventResponse | null> {
  try {
    return await googleCalendarFetchWithContext<GoogleCalendarEventResponse>(
      context,
      `/calendars/${encodeURIComponent(context.calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'GET' },
      options,
    );
  } catch (error) {
    if (error instanceof GoogleCalendarApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function patchGoogleCalendarEventConditionally(
  context: GoogleCalendarRequestContext,
  eventId: string,
  current: GoogleCalendarEventResponse,
  body: ReturnType<typeof buildGoogleCalendarEventBody>,
  mutationVersion: string | undefined,
  options: GoogleCalendarRequestOptions,
) {
  if (!current.etag) {
    throw new GoogleCalendarApiError(409, 'Google Calendar event did not include an ETag');
  }
  try {
    return await googleCalendarFetchWithContext<GoogleCalendarEventResponse>(
      context,
      `/calendars/${encodeURIComponent(context.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      {
        method: 'PATCH',
        headers: { 'If-Match': current.etag },
        body: JSON.stringify(body),
      },
      options,
    );
  } catch (error) {
    if (!(error instanceof GoogleCalendarApiError) || error.status !== 412) {
      throw error;
    }
    // A newer revision may win after our GET but before the conditional PATCH.
    // Resolve that obsolete attempt by reading the winner instead of retrying A
    // indefinitely. If the remote state is absent or older, retain the failure.
    const refreshed = await getGoogleCalendarEventForMutation(
      context,
      eventId,
      options,
    );
    if (refreshed && remoteEventIsAtLeastRevision(refreshed, mutationVersion)) {
      return refreshed;
    }
    throw error;
  }
}

/**
 * Google returns `refresh_token` only when it rotates one. Writing the field
 * unconditionally would blank the stored credential on every ordinary refresh
 * and permanently break the connection, so the absent case yields no update at
 * all rather than an explicit undefined.
 */
function buildRotatedTokenUpdate(rotatedRefreshToken: string | undefined) {
  if (!rotatedRefreshToken) {
    return {};
  }
  const encrypted = encryptIntegrationSecret(rotatedRefreshToken);
  return {
    encryptedRefreshToken: encrypted.ciphertext,
    encryptionKeyVersion: encrypted.keyVersion,
  };
}

/** On success the access token is guaranteed present — narrowed for callers. */
type VerifiedTokenResponse = GoogleTokenResponse & { access_token: string };

type TokenRequestOutcome =
  | { ok: true; data: VerifiedTokenResponse }
  | { ok: false; failure: GoogleFailureClassification };

/** One token-endpoint round trip; provider failures are classified, caller aborts throw. */
async function requestAccessToken(
  refreshToken: string,
  options: GoogleCalendarRequestOptions = {},
): Promise<TokenRequestOutcome> {
  throwIfGoogleRequestAborted(options.signal);
  let response: Response;
  try {
    response = await fetchGoogleProvider(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: Env.GOOGLE_OAUTH_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    }, options);
  } catch (error) {
    if (error instanceof GoogleCalendarRequestAbortedError) {
      throw error;
    }
    return {
      ok: false,
      failure: classifyNetworkFailure(error instanceof Error ? error.message : undefined),
    };
  }

  let data: GoogleTokenResponse;
  try {
    data = await response.json() as GoogleTokenResponse;
  } catch {
    return { ok: false, failure: classifyNetworkFailure('unreadable token response') };
  }

  if (!response.ok || !data.access_token) {
    return {
      ok: false,
      failure: classifyTokenRefreshFailure({
        httpStatus: response.status,
        error: data.error,
        errorDescription: data.error_description,
      }),
    };
  }
  return { ok: true, data: data as VerifiedTokenResponse };
}

/**
 * Persist a classified failure, and attempt the owner alert once — on the
 * transition INTO `reconnect_required`. Provider delivery is not exactly-once.
 *
 * Availability runs on every page view, so notifying from the failure path
 * itself would email the salon on every visit. Gating on the previous status
 * means one alert per outage, not one per request.
 */
async function writeGoogleConnectionResult(
  salonId: string,
  expectedRevision: string | undefined,
  options: GoogleCalendarRequestOptions,
  buildUpdate: (currentStatus: string) => {
    transitioned?: boolean;
    values: GoogleCalendarConnectionUpdate;
  },
): Promise<{ applied: boolean; revision?: string; transitioned: boolean }> {
  throwIfGoogleRequestAborted(options.signal);
  if (!expectedRevision) {
    return { applied: false, transitioned: false };
  }
  return db.transaction(async (tx) => {
    if (options.attemptFence) {
      const [owned] = await tx.select({ id: integrationOutboxSchema.id })
        .from(integrationOutboxSchema)
        .where(and(
          eq(integrationOutboxSchema.id, options.attemptFence.jobId),
          eq(integrationOutboxSchema.salonId, salonId),
          eq(integrationOutboxSchema.provider, 'google_calendar'),
          eq(integrationOutboxSchema.status, 'processing'),
          eq(integrationOutboxSchema.attempts, options.attemptFence.claimedAttempt),
        ))
        .for('update')
        .limit(1);
      if (!owned) {
        throw new GoogleCalendarConnectionWriteFenceError();
      }
    }

    const [current] = await tx.select({
      revision: sql<string>`xmin::text`,
      status: salonGoogleCalendarConnectionSchema.status,
    }).from(salonGoogleCalendarConnectionSchema).where(
      eq(salonGoogleCalendarConnectionSchema.salonId, salonId),
    ).for('update').limit(1);
    if (!current || current.revision !== expectedRevision) {
      if (options.attemptFence) {
        throw new GoogleCalendarConnectionWriteFenceError();
      }
      return { applied: false, transitioned: false };
    }

    const update = buildUpdate(current.status);
    const written = await tx.update(salonGoogleCalendarConnectionSchema)
      .set(update.values)
      .where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId))
      .returning();
    if (written.length !== 1) {
      if (options.attemptFence) {
        throw new GoogleCalendarConnectionWriteFenceError();
      }
      return { applied: false, transitioned: false };
    }
    const [advanced] = await tx.select({ revision: sql<string>`xmin::text` })
      .from(salonGoogleCalendarConnectionSchema)
      .where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId))
      .limit(1);
    return {
      applied: true,
      revision: advanced?.revision,
      transitioned: update.transitioned === true,
    };
  });
}

async function recordConnectionFailure(
  salonId: string,
  classification: GoogleFailureClassification,
  expectedRevision: string | undefined,
  options: GoogleCalendarRequestOptions = {},
): Promise<void> {
  throwIfGoogleRequestAborted(options.signal);
  const status = statusForClassification(classification);
  const lastError = formatPersistedError(classification);
  const lastCheckedAt = new Date();
  const result = await writeGoogleConnectionResult(
    salonId,
    expectedRevision,
    options,
    currentStatus => ({
      transitioned: status === 'reconnect_required'
        && currentStatus !== 'reconnect_required',
      values: status === 'reconnect_required'
        && currentStatus === 'reconnect_required'
        ? { lastError, lastCheckedAt }
        : { status, lastError, lastCheckedAt },
    }),
  ).catch((error) => {
    if (error instanceof GoogleCalendarConnectionWriteFenceError) {
      throw error;
    }
    return { applied: false, transitioned: false };
  });

  if (status !== 'reconnect_required' || !result.transitioned) {
    return;
  }

  // Once the latch commits, this invocation owns the one best-effort outage
  // alert. Bound and cancel its provider request with the parent operation so
  // it cannot defeat Calendar-list or route execution ceilings. A timeout can
  // lose this alert; it must never reopen the durable outage latch or block
  // fail-closed availability.
  try {
    const { sendGoogleCalendarDisconnectedEmail } = await import('@/libs/googleCalendarAlerts');
    await sendGoogleCalendarDisconnectedEmail(
      { salonId, classification },
      { signal: options.signal, timeoutMs: 5_000 },
    );
  } catch (error) {
    // An alert failure must never take down the caller — availability has
    // already failed closed by this point and that is the safety-critical part.
    console.error('[GoogleCalendar] Failed to send disconnect alert', {
      salonId,
      kind: classification.kind,
      error,
    });
  }
}

async function getGoogleCalendarRequestContext(
  salonId?: string,
  options: GoogleCalendarRequestOptions = {},
): Promise<GoogleCalendarRequestContext | null> {
  throwIfGoogleRequestAborted(options.signal);
  if (salonId) {
    const [connection] = await db
      .select({
        busyCalendarIds: salonGoogleCalendarConnectionSchema.busyCalendarIds,
        destinationCalendarId: salonGoogleCalendarConnectionSchema.destinationCalendarId,
        encryptedRefreshToken: salonGoogleCalendarConnectionSchema.encryptedRefreshToken,
        revision: sql<string>`xmin::text`,
        status: salonGoogleCalendarConnectionSchema.status,
      })
      .from(salonGoogleCalendarConnectionSchema)
      .where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId))
      .limit(1);
    throwIfGoogleRequestAborted(options.signal);
    if (connection) {
      if (!['active', 'degraded'].includes(connection.status)) {
        throw new GoogleCalendarConnectionError(true);
      }
      if (!Env.GOOGLE_OAUTH_CLIENT_ID || !Env.GOOGLE_OAUTH_CLIENT_SECRET) {
        await recordConnectionFailure(
          salonId,
          classifyMissingClientConfig(),
          connection.revision,
          options,
        );
        throw new GoogleCalendarConnectionError(false);
      }

      let refreshToken: string;
      try {
        refreshToken = decryptIntegrationSecret(connection.encryptedRefreshToken);
      } catch {
        // Never reported as "reconnect" — a decrypt failure means the stored
        // secret cannot be read at all, which points at key configuration
        // rather than at the salon's authorization.
        await recordConnectionFailure(
          salonId,
          classifyDecryptFailure(),
          connection.revision,
          options,
        );
        throw new GoogleCalendarConnectionError(false);
      }

      // One retry, and only for classifications that could plausibly differ on
      // a second attempt. A confirmed invalid_grant is never repeated: the
      // answer cannot change and repeated token requests burn quota.
      let data: VerifiedTokenResponse | null = null;
      let failure: GoogleFailureClassification | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        throwIfGoogleRequestAborted(options.signal);
        const outcome = await requestAccessToken(refreshToken, options);
        throwIfGoogleRequestAborted(options.signal);
        if (outcome.ok) {
          data = outcome.data;
          failure = null;
          break;
        }
        failure = outcome.failure;
        if (!outcome.failure.retryable) {
          break;
        }
      }

      if (!data) {
        const classification = failure ?? classifyNetworkFailure();
        await recordConnectionFailure(
          salonId,
          classification,
          connection.revision,
          options,
        );
        throw new GoogleCalendarConnectionError(classification.requiresReconnect);
      }

      throwIfGoogleRequestAborted(options.signal);
      const connectionWrite = await writeGoogleConnectionResult(
        salonId,
        connection.revision,
        options,
        () => ({
          values: {
            status: 'active',
            lastError: null,
            lastCheckedAt: new Date(),
            tokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
            // Google only returns a refresh token when it rotates one. Writing
            // the absent case would blank the credential permanently.
            ...buildRotatedTokenUpdate(data.refresh_token),
          },
        }),
      );
      if (!connectionWrite.applied) {
        throw new GoogleCalendarConnectionWriteFenceError();
      }
      throwIfGoogleRequestAborted(options.signal);
      return {
        accessToken: data.access_token,
        calendarId: connection.destinationCalendarId,
        // Safety floor: while setup is incomplete (no saved blocking
        // calendars), availability still blocks on the primary calendar so a
        // connected salon can never be silently double-booked. Readiness
        // reporting (integrationHealth) treats this state as setup_incomplete.
        busyCalendarIds: connection.busyCalendarIds.length ? connection.busyCalendarIds : ['primary'],
        connectionType: 'oauth',
        connectionRevision: connectionWrite.revision,
      };
    }
  }

  const legacy = getGoogleCalendarConfig();
  if (!legacy) {
    return null;
  }
  return {
    accessToken: await getGoogleAccessToken(legacy, options),
    calendarId: legacy.calendarId,
    busyCalendarIds: [legacy.calendarId],
    connectionType: 'legacy',
  };
}

export async function listGoogleCalendarsForSalon(
  salonId: string,
  options: GoogleCalendarRequestOptions = {},
): Promise<Array<{
    id: string;
    summary: string;
    primary: boolean;
    accessRole: string;
  }>> {
  const context = await getGoogleCalendarRequestContext(salonId, options);
  if (!context) {
    return [];
  }
  const data = await googleCalendarFetchWithContext<{
    items?: Array<{ id?: string; summary?: string; primary?: boolean; accessRole?: string }>;
  }>(context, '/users/me/calendarList?minAccessRole=reader', { method: 'GET' }, options);
  return (data.items ?? []).flatMap(item => item.id
    ? [{
        id: item.id,
        summary: item.summary || item.id,
        primary: item.primary === true,
        accessRole: item.accessRole || 'reader',
      }]
    : []);
}

function parseGoogleEventDate(value?: { dateTime?: string; date?: string }): Date | null {
  const raw = value?.dateTime || (value?.date ? `${value.date}T00:00:00.000Z` : null);
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type GoogleCalendarEventListArgs = {
  calendarIds?: string[];
  startTime?: Date;
  endTime?: Date;
  updatedMin?: Date;
  includeDeleted?: boolean;
  privateExtendedProperties?: string[];
};

async function listGoogleCalendarEventsWithContext(
  context: GoogleCalendarRequestContext,
  args: GoogleCalendarEventListArgs,
  options: GoogleCalendarRequestOptions & { maxPages: number },
): Promise<GoogleCalendarRemoteEvent[]> {
  const events: GoogleCalendarRemoteEvent[] = [];
  const calendarIds = [...new Set(args.calendarIds?.length ? args.calendarIds : [context.calendarId])];
  for (const calendarId of calendarIds) {
    throwIfGoogleRequestAborted(options.signal);
    // The configured limit is per selected calendar. A salon may legitimately
    // select up to 20 calendars, each of which requires at least one page.
    // The aggregate wall-clock deadline independently bounds the whole scan.
    let pagesFetched = 0;
    let pageToken: string | undefined;
    do {
      throwIfGoogleRequestAborted(options.signal);
      if (pagesFetched >= options.maxPages) {
        throw new GoogleCalendarListLimitError();
      }
      pagesFetched += 1;
      const search = new URLSearchParams({
        singleEvents: 'true',
        showDeleted: args.includeDeleted ? 'true' : 'false',
        maxResults: '2500',
      });
      if (args.updatedMin) {
        search.set('updatedMin', args.updatedMin.toISOString());
      } else {
        if (args.startTime) {
          search.set('timeMin', args.startTime.toISOString());
        }
        if (args.endTime) {
          search.set('timeMax', args.endTime.toISOString());
        }
      }
      if (pageToken) {
        search.set('pageToken', pageToken);
      }
      for (const property of args.privateExtendedProperties ?? []) {
        search.append('privateExtendedProperty', property);
      }

      const data = await googleCalendarFetchWithContext<GoogleCalendarEventListResponse>(
        context,
        `/calendars/${encodeURIComponent(calendarId)}/events?${search.toString()}`,
        { method: 'GET' },
        options,
      );
      for (const item of data.items ?? []) {
        if (!item.id) {
          continue;
        }
        const privateProperties = item.extendedProperties?.private;
        events.push({
          id: item.id,
          calendarId,
          status: item.status || 'confirmed',
          summary: item.summary?.trim() || null,
          description: item.description?.trim() || null,
          location: item.location?.trim() || null,
          recurringEventId: item.recurringEventId || null,
          transparency: item.transparency === 'transparent' ? 'free' : 'busy',
          isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
          startTime: parseGoogleEventDate(item.start),
          endTime: parseGoogleEventDate(item.end),
          updatedAt: item.updated ? new Date(item.updated) : null,
          appointmentId: privateProperties?.appointmentId || null,
          salonId: privateProperties?.salonId || null,
          mutationVersion: privateProperties?.mutationVersion || null,
          attendees: (item.attendees ?? []).flatMap(attendee => attendee.email
            ? [{
                email: attendee.email,
                displayName: attendee.displayName?.trim() || null,
                organizer: attendee.organizer === true,
                self: attendee.self === true,
              }]
            : []),
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  throwIfGoogleRequestAborted(options.signal);
  return events;
}

export async function listGoogleCalendarEventsForSalon(args: GoogleCalendarEventListArgs & {
  salonId: string;
}, options: GoogleCalendarListOptions = {}): Promise<GoogleCalendarRemoteEvent[]> {
  const requestedTimeoutMs = options.timeoutMs ?? GOOGLE_EVENT_LIST_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(1, Math.min(requestedTimeoutMs, GOOGLE_EVENT_LIST_TIMEOUT_MS))
    : GOOGLE_EVENT_LIST_TIMEOUT_MS;
  const requestedMaxPages = options.maxPages ?? GOOGLE_EVENT_LIST_MAX_PAGES;
  const maxPages = Number.isFinite(requestedMaxPages)
    ? Math.max(1, Math.min(Math.floor(requestedMaxPages), GOOGLE_EVENT_LIST_MAX_PAGES))
    : GOOGLE_EVENT_LIST_MAX_PAGES;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(options.signal?.reason);
  throwIfGoogleRequestAborted(options.signal);
  options.signal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new GoogleCalendarRequestTimeoutError());
  }, timeoutMs);
  timeout.unref?.();

  try {
    const requestOptions = {
      maxPages,
      requestTimeoutMs: options.requestTimeoutMs,
      signal: controller.signal,
    };
    const context = await getGoogleCalendarRequestContext(args.salonId, requestOptions);
    if (!context || context.connectionType !== 'oauth') {
      return [];
    }
    return await listGoogleCalendarEventsWithContext(context, args, requestOptions);
  } catch (error) {
    if (timedOut && error instanceof GoogleCalendarRequestAbortedError) {
      throw new GoogleCalendarRequestTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromParent);
  }
}

export async function listExternalGoogleCalendarEvents(args: {
  salonId: string;
  calendarIds?: string[];
  startTime: Date;
  endTime: Date;
}): Promise<Array<GoogleCalendarRemoteEvent & { startTime: Date; endTime: Date }>> {
  const events = await listGoogleCalendarEventsForSalon({
    salonId: args.salonId,
    calendarIds: args.calendarIds,
    startTime: args.startTime,
    endTime: args.endTime,
  });
  return events.flatMap(event => (
    event.status !== 'cancelled'
    && !event.appointmentId
    && event.startTime
    && event.endTime
      ? [{ ...event, startTime: event.startTime, endTime: event.endTime }]
      : []
  ));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatPhoneForCalendar(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return phone;
}

function formatFrozenPrice(cents: number, currency: string): string | null {
  const normalizedCurrency = currency.trim().toUpperCase();
  if (
    !Number.isSafeInteger(cents)
    || cents < 0
    || (normalizedCurrency !== 'CAD' && normalizedCurrency !== 'USD')
  ) {
    return null;
  }
  return new Intl.NumberFormat(
    normalizedCurrency === 'USD' ? 'en-US' : 'en-CA',
    { style: 'currency', currency: normalizedCurrency },
  ).format(cents / 100);
}

function buildFinancialDescriptionLine(
  input: GoogleCalendarAppointmentEventInput,
): string {
  if (input.pricePresentation?.state === 'booked_service_subtotal') {
    const amount = formatFrozenPrice(
      input.pricePresentation.amountCents,
      input.pricePresentation.currency,
    );
    if (amount) {
      return `Booked services subtotal: ${amount}`;
    }
  }
  return 'Financial details: Under review';
}

function buildLocationText(input: Pick<GoogleCalendarAppointmentEventInput, 'locationName' | 'locationAddress'>): string | null {
  return [input.locationName, input.locationAddress]
    .map(part => part?.trim())
    .filter(Boolean)
    .join(' - ') || null;
}

function buildGoogleCalendarEventBody(input: GoogleCalendarAppointmentEventInput) {
  const serviceLabel = input.serviceNames.join(', ') || 'Appointment';
  const clientLabel = input.clientName?.trim() || 'Guest';
  const locationText = buildLocationText(input);
  const summary = [
    serviceLabel,
    clientLabel,
    locationText,
  ].filter(Boolean).join(' - ');

  const description = [
    `Service: ${serviceLabel}`,
    `Client: ${clientLabel}`,
    `Phone: ${formatPhoneForCalendar(input.clientPhone)}`,
    `Artist: ${input.technicianName || 'Any available artist'}`,
    ...(locationText ? [`Location: ${locationText}`] : []),
    buildFinancialDescriptionLine(input),
    `Duration: ${input.totalDurationMinutes} min`,
    ...(input.notes ? [`Notes: ${input.notes}`] : []),
    `Appointment ID: ${input.appointmentId}`,
    `Salon: ${input.salonName}`,
  ].join('\n');

  return {
    summary,
    description,
    location: locationText ?? undefined,
    start: {
      dateTime: input.startTime.toISOString(),
      timeZone: input.timeZone,
    },
    end: {
      dateTime: input.endTime.toISOString(),
      timeZone: input.timeZone,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 24 * 60 },
      ],
    },
    extendedProperties: {
      private: {
        appointmentId: input.appointmentId,
        salonId: input.salonId,
        ...(input.mutationVersion ? { mutationVersion: input.mutationVersion } : {}),
      },
    },
  };
}

async function recordCalendarSyncResult(args: {
  appointmentId: string;
  salonId: string;
  status: string;
  eventId?: string | null;
  error?: string | null;
}) {
  try {
    await db
      .update(appointmentSchema)
      .set({
        googleCalendarEventId: args.eventId,
        googleCalendarSyncStatus: args.status,
        googleCalendarSyncedAt: new Date(),
        googleCalendarSyncError: args.error ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(appointmentSchema.id, args.appointmentId),
          eq(appointmentSchema.salonId, args.salonId),
        ),
      );
  } catch (error) {
    console.error('[GoogleCalendar] Failed to record appointment sync status:', {
      appointmentId: args.appointmentId,
      salonId: args.salonId,
      error: toErrorMessage(error),
    });
  }
}

async function markGoogleConnectionDegraded(
  salonId: string,
  message: string,
  context: GoogleCalendarRequestContext,
  options: GoogleCalendarRequestOptions,
) {
  await writeGoogleConnectionResult(
    salonId,
    context.connectionRevision,
    options,
    () => ({
      values: {
        status: 'degraded',
        lastError: message,
        lastCheckedAt: new Date(),
      },
    }),
  ).catch((error) => {
    if (error instanceof GoogleCalendarConnectionWriteFenceError) {
      throw error;
    }
    return { applied: false, transitioned: false };
  });
}

function isGoogleCalendarReconnectRequired(
  error: GoogleCalendarApiError | GoogleCalendarConnectionError,
): boolean {
  return error instanceof GoogleCalendarConnectionError
    ? error.reconnectRequired
    : error.status === 401;
}

async function markGoogleAvailabilityFailure(
  salonId: string,
  error: GoogleCalendarApiError | GoogleCalendarConnectionError,
  context?: GoogleCalendarRequestContext,
) {
  // A GoogleCalendarConnectionError already travelled through the token path,
  // which recorded the precise classification (and alerted if it was a new
  // outage). Re-recording here is what used to replace Google's own message —
  // "invalid_grant: Token has been expired or revoked" — with a generic
  // "authorization is invalid", destroying the only evidence of the cause.
  if (error instanceof GoogleCalendarConnectionError) {
    return;
  }

  await recordConnectionFailure(
    salonId,
    classifyApiFailure(error.status, error.message),
    context?.connectionRevision,
  );
}

export function isBusyWindowConflict(
  startTime: Date,
  endTime: Date,
  busyWindows: GoogleCalendarBusyWindow[],
): boolean {
  return busyWindows.some(window =>
    startTime < window.endTime && endTime > window.startTime,
  );
}

/**
 * A rescheduling customer must not be blocked by their own appointment's
 * mirror on the salon's Google Calendar.
 *
 * The freeBusy API returns anonymous windows with no event ids, so the
 * appointment's own mirrored copy is indistinguishable from a real external
 * conflict — the database-side `excludedAppointmentId` cannot reach it. Here
 * we resolve the mirror this appointment actually owns (its linked
 * `google_calendar_event` row, or its `googleCalendarEventId` column) and
 * suppress ONLY windows that match that event's exact bounds.
 *
 * Deliberately narrow: an unrelated event that merely happens to overlap
 * still blocks, and if the appointment has no mirror nothing is suppressed.
 */
async function resolveOwnMirrorWindow(
  salonId: string,
  appointmentId: string,
): Promise<GoogleCalendarBusyWindow | null> {
  const [linked] = await db
    .select({
      startTime: googleCalendarEventSchema.startTime,
      endTime: googleCalendarEventSchema.endTime,
    })
    .from(googleCalendarEventSchema)
    .where(and(
      eq(googleCalendarEventSchema.salonId, salonId),
      eq(googleCalendarEventSchema.appointmentId, appointmentId),
      isNull(googleCalendarEventSchema.deletedAt),
    ))
    .limit(1);
  if (linked) {
    return { startTime: linked.startTime, endTime: linked.endTime };
  }

  // Outbound-only mirrors (created by us, never re-ingested) have no
  // google_calendar_event row — fall back to the appointment's own window,
  // which is exactly what we wrote to Google.
  const [appointment] = await db
    .select({
      startTime: appointmentSchema.startTime,
      endTime: appointmentSchema.endTime,
      googleCalendarEventId: appointmentSchema.googleCalendarEventId,
    })
    .from(appointmentSchema)
    .where(and(
      eq(appointmentSchema.id, appointmentId),
      eq(appointmentSchema.salonId, salonId),
    ))
    .limit(1);
  if (!appointment?.googleCalendarEventId) {
    return null;
  }
  return { startTime: appointment.startTime, endTime: appointment.endTime };
}

function isSameWindow(a: GoogleCalendarBusyWindow, b: GoogleCalendarBusyWindow): boolean {
  return a.startTime.getTime() === b.startTime.getTime()
    && a.endTime.getTime() === b.endTime.getTime();
}

/**
 * Google can briefly keep a deleted event in FreeBusy after events.list has
 * already stopped returning it. Only suppress that anonymous window when all
 * of the following agree:
 *
 * 1. it exactly matches a writable app mirror recorded as cancelled locally;
 * 2. that mirror belongs to a calendar currently used for availability; and
 * 3. Google's live event list contains no active busy event over the window.
 *
 * The live-list check is important: if the owner later creates a real event at
 * the same time, it continues to block even though an older cancelled mirror
 * has identical bounds.
 */
async function suppressCancelledMirrorFreeBusyGhosts(args: {
  salonId: string;
  context: GoogleCalendarRequestContext;
  startTime: Date;
  endTime: Date;
  busyWindows: GoogleCalendarBusyWindow[];
}): Promise<GoogleCalendarBusyWindow[]> {
  if (args.context.connectionType !== 'oauth' || args.busyWindows.length === 0) {
    return args.busyWindows;
  }

  const cancelledMirrors = await db
    .select({
      calendarId: googleCalendarEventSchema.calendarId,
      startTime: googleCalendarEventSchema.startTime,
      endTime: googleCalendarEventSchema.endTime,
    })
    .from(googleCalendarEventSchema)
    .where(and(
      eq(googleCalendarEventSchema.salonId, args.salonId),
      inArray(googleCalendarEventSchema.calendarId, args.context.busyCalendarIds),
      eq(googleCalendarEventSchema.googleStatus, 'cancelled'),
      eq(googleCalendarEventSchema.syncMode, 'bidirectional'),
      inArray(googleCalendarEventSchema.sourceAccessRole, ['owner', 'writer']),
      isNotNull(googleCalendarEventSchema.deletedAt),
      lt(googleCalendarEventSchema.startTime, args.endTime),
      gt(googleCalendarEventSchema.endTime, args.startTime),
    ))
    .limit(500);
  const matchingMirrors = cancelledMirrors.filter(mirror =>
    args.busyWindows.some(window => isSameWindow(mirror, window)),
  );
  if (matchingMirrors.length === 0) {
    return args.busyWindows;
  }

  const calendarIds = [...new Set(matchingMirrors.map(mirror => mirror.calendarId))];
  const liveEvents = await listGoogleCalendarEventsWithContext(args.context, {
    calendarIds,
    startTime: args.startTime,
    endTime: args.endTime,
  }, { maxPages: GOOGLE_EVENT_LIST_MAX_PAGES });
  const liveBusyWindows = liveEvents.flatMap(event => (
    event.status !== 'cancelled'
    && event.transparency === 'busy'
    && event.startTime
    && event.endTime
      ? [{ startTime: event.startTime, endTime: event.endTime }]
      : []
  ));

  return args.busyWindows.filter((window) => {
    const matchesCancelledMirror = matchingMirrors.some(mirror =>
      isSameWindow(mirror, window),
    );
    if (!matchesCancelledMirror) {
      return true;
    }

    return liveBusyWindows.some(liveWindow =>
      window.startTime < liveWindow.endTime && window.endTime > liveWindow.startTime,
    );
  });
}

export async function getGoogleCalendarBusyWindows(args: {
  salonId?: string;
  startTime: Date;
  endTime: Date;
  timeZone: string;
  /**
   * Reschedule only. MUST be an appointment id the caller has already
   * authorized server-side (validated manage token or matching client
   * session) — never a raw client-supplied id.
   */
  excludeAppointmentId?: string | null;
}): Promise<GoogleCalendarBusyWindow[]> {
  let requestContext: GoogleCalendarRequestContext | undefined;
  try {
    const context = await getGoogleCalendarRequestContext(args.salonId);
    if (!context) {
      return [];
    }
    requestContext = context;
    const ownMirrorWindow = args.salonId && args.excludeAppointmentId
      ? await resolveOwnMirrorWindow(args.salonId, args.excludeAppointmentId)
      : null;

    const data = await googleCalendarFetchWithContext<GoogleFreeBusyResponse>(
      context,
      '/freeBusy',
      {
        method: 'POST',
        body: JSON.stringify({
          timeMin: args.startTime.toISOString(),
          timeMax: args.endTime.toISOString(),
          timeZone: args.timeZone,
          items: context.busyCalendarIds.map(id => ({ id })),
        }),
      },
    );
    const busyWindows = context.busyCalendarIds.flatMap((calendarId) => {
      const calendar = data.calendars?.[calendarId];
      if (calendar?.errors?.length) {
        throw new GoogleCalendarApiError(
          502,
          calendar.errors.map(error => error.message ?? error.reason ?? 'calendar_error').join(', '),
        );
      }
      return (calendar?.busy ?? [])
        .map(window => ({
          startTime: new Date(window.start),
          endTime: new Date(window.end),
        }))
        .filter(window => !ownMirrorWindow || !isSameWindow(window, ownMirrorWindow));
    });
    return args.salonId
      ? await suppressCancelledMirrorFreeBusyGhosts({
        salonId: args.salonId,
        context,
        startTime: args.startTime,
        endTime: args.endTime,
        busyWindows,
      })
      : busyWindows;
  } catch (error) {
    if (!(error instanceof GoogleCalendarApiError || error instanceof GoogleCalendarConnectionError)) {
      throw error;
    }
    const reconnectRequired = isGoogleCalendarReconnectRequired(error);
    if (args.salonId) {
      await markGoogleAvailabilityFailure(args.salonId, error, requestContext);
    }
    throw new GoogleCalendarAvailabilityError(reconnectRequired);
  }
}

export async function hasGoogleCalendarConflict(args: {
  salonId?: string;
  startTime: Date;
  endTime: Date;
  timeZone: string;
  excludeAppointmentId?: string | null;
}): Promise<boolean> {
  const busyWindows = await getGoogleCalendarBusyWindows(args);
  return isBusyWindowConflict(args.startTime, args.endTime, busyWindows);
}

type LinkedGoogleCalendarEvent = {
  id: string;
  appointmentId: string | null;
  calendarId: string;
  deletedAt: Date | null;
  googleEventId: string;
  googleStatus: string;
  reviewStatus: string;
  sourceAccessRole: string;
  syncMode: 'inbound_only' | 'bidirectional' | 'superseded';
};

async function getLinkedGoogleCalendarEvent(
  salonId: string,
  appointmentId: string,
  googleCalendarEventId?: string | null,
  targetCalendarId?: string,
  reconciliationMirrorId?: string,
  reconciliationExpectedAppointmentId?: string | null,
): Promise<LinkedGoogleCalendarEvent | null> {
  if (googleCalendarEventId && targetCalendarId) {
    const exactPairs = await db.select({
      id: googleCalendarEventSchema.id,
      salonId: googleCalendarEventSchema.salonId,
      appointmentId: googleCalendarEventSchema.appointmentId,
      calendarId: googleCalendarEventSchema.calendarId,
      deletedAt: googleCalendarEventSchema.deletedAt,
      googleEventId: googleCalendarEventSchema.googleEventId,
      googleStatus: googleCalendarEventSchema.googleStatus,
      reviewStatus: googleCalendarEventSchema.reviewStatus,
      sourceAccessRole: googleCalendarEventSchema.sourceAccessRole,
      syncMode: googleCalendarEventSchema.syncMode,
    }).from(googleCalendarEventSchema).where(and(
      eq(googleCalendarEventSchema.calendarId, targetCalendarId),
      eq(googleCalendarEventSchema.googleEventId, googleCalendarEventId),
    ));
    if (exactPairs.length > 1) {
      throw new Error('GOOGLE_CALENDAR_MIRROR_AMBIGUOUS');
    }
    const exactPair = exactPairs[0];
    if (reconciliationMirrorId) {
      if (
        !exactPair
        || exactPair.id !== reconciliationMirrorId
        || exactPair.salonId !== salonId
        || exactPair.appointmentId !== (reconciliationExpectedAppointmentId ?? null)
        || exactPair.reviewStatus !== 'appointment'
        || exactPair.syncMode !== 'bidirectional'
        || !['owner', 'writer'].includes(exactPair.sourceAccessRole)
      ) {
        throw new Error('GOOGLE_CALENDAR_MIRROR_OWNERSHIP_CONFLICT');
      }
      return exactPair;
    }
    if (exactPair?.salonId === salonId && exactPair.appointmentId === null) {
      throw new Error('GOOGLE_CALENDAR_MIRROR_OWNERSHIP_CONFLICT');
    }
    if (
      exactPair
      && (
        exactPair.salonId !== salonId
        || exactPair.appointmentId !== appointmentId
      )
    ) {
      throw new Error('GOOGLE_CALENDAR_MIRROR_OWNERSHIP_CONFLICT');
    }
    return exactPair ?? null;
  }
  const conditions = [
    eq(googleCalendarEventSchema.salonId, salonId),
    eq(googleCalendarEventSchema.appointmentId, appointmentId),
    isNull(googleCalendarEventSchema.deletedAt),
    ne(googleCalendarEventSchema.syncMode, 'superseded'),
  ];
  if (googleCalendarEventId) {
    conditions.push(eq(googleCalendarEventSchema.googleEventId, googleCalendarEventId));
  }
  if (targetCalendarId) {
    conditions.push(eq(googleCalendarEventSchema.calendarId, targetCalendarId));
  }
  const events = await db.select({
    id: googleCalendarEventSchema.id,
    appointmentId: googleCalendarEventSchema.appointmentId,
    calendarId: googleCalendarEventSchema.calendarId,
    deletedAt: googleCalendarEventSchema.deletedAt,
    googleEventId: googleCalendarEventSchema.googleEventId,
    googleStatus: googleCalendarEventSchema.googleStatus,
    reviewStatus: googleCalendarEventSchema.reviewStatus,
    sourceAccessRole: googleCalendarEventSchema.sourceAccessRole,
    syncMode: googleCalendarEventSchema.syncMode,
  }).from(googleCalendarEventSchema).where(and(...conditions));
  if (events.length > 1) {
    throw new Error('GOOGLE_CALENDAR_MIRROR_AMBIGUOUS');
  }
  return events[0] ?? null;
}

function canWriteLinkedGoogleEvent(event: LinkedGoogleCalendarEvent): boolean {
  return event.deletedAt == null
    && event.syncMode === 'bidirectional'
    && ['owner', 'writer'].includes(event.sourceAccessRole);
}

/**
 * Google accepts caller-supplied event ids. Keeping the derivation public lets
 * the outbox enqueue a cleanup even when a create response was lost: remote
 * acceptance is ambiguous, but the possible remote identity is not.
 */
export function deterministicGoogleCalendarEventId(input: {
  appointmentId: string;
  idempotencyKey: string;
  salonId: string;
}): string {
  return `luster${createHash('sha256').update(JSON.stringify([
    input.salonId,
    input.appointmentId,
    input.idempotencyKey,
  ])).digest('hex').slice(0, 48)}`;
}

async function applyLinkedEventCalendar(
  context: GoogleCalendarRequestContext,
  salonId: string,
  appointmentId: string,
  googleCalendarEventId?: string | null,
  targetCalendarId?: string,
): Promise<boolean> {
  const event = await getLinkedGoogleCalendarEvent(
    salonId,
    appointmentId,
    googleCalendarEventId,
    targetCalendarId,
  );
  if (!event) {
    return true;
  }
  if (!canWriteLinkedGoogleEvent(event)) {
    return false;
  }
  context.calendarId = event.calendarId;
  return true;
}

export async function syncGoogleCalendarEventForAppointment(
  input: GoogleCalendarAppointmentEventInput,
  options: GoogleCalendarProviderOptions = {},
): Promise<GoogleCalendarSyncResult> {
  const context = await getGoogleCalendarRequestContext(input.salonId, options);
  if (!context) {
    return { status: 'disabled' };
  }
  if (
    !options.useDestinationCalendar
    && !await applyLinkedEventCalendar(
      context,
      input.salonId,
      input.appointmentId,
      input.googleCalendarEventId,
      options.targetCalendarId,
    )
  ) {
    return { status: 'disabled' };
  }
  if (options.targetCalendarId) {
    context.calendarId = options.targetCalendarId;
  }

  let createAttempted = false;
  try {
    const body = buildGoogleCalendarEventBody(input);
    const deterministicEventId = options.idempotencyKey
      ? deterministicGoogleCalendarEventId({
          salonId: input.salonId,
          appointmentId: input.appointmentId,
          idempotencyKey: options.idempotencyKey,
        })
      : null;
    if (deterministicEventId) {
      await getLinkedGoogleCalendarEvent(
        input.salonId,
        input.appointmentId,
        deterministicEventId,
        context.calendarId,
      );
    }
    const event = await runGoogleCalendarMutationDispatch(options, async (requestOptions) => {
      const createEvent = async () => {
        createAttempted = true;
        try {
          return await googleCalendarFetchWithContext<GoogleCalendarEventResponse>(
            context,
            `/calendars/${encodeURIComponent(context.calendarId)}/events?sendUpdates=none`,
            {
              method: 'POST',
              body: JSON.stringify(deterministicEventId
                ? { ...body, id: deterministicEventId }
                : body),
            },
            requestOptions,
          );
        } catch (error) {
          if (
            !deterministicEventId
            || !(error instanceof GoogleCalendarApiError)
            || error.status !== 409
          ) {
            throw error;
          }
          const existing = await getGoogleCalendarEventForMutation(
            context,
            deterministicEventId,
            requestOptions,
          );
          if (!existing) {
            throw new GoogleCalendarApiError(
              409,
              'Google Calendar deterministic event conflicted but could not be read',
            );
          }
          if (remoteEventIsAtLeastRevision(existing, input.mutationVersion)) {
            return { ...existing, id: existing.id ?? deterministicEventId };
          }
          return patchGoogleCalendarEventConditionally(
            context,
            deterministicEventId,
            existing,
            body,
            input.mutationVersion,
            requestOptions,
          );
        }
      };

      if (!input.googleCalendarEventId) {
        return createEvent();
      }
      const existing = await getGoogleCalendarEventForMutation(
        context,
        input.googleCalendarEventId,
        requestOptions,
      );
      if (!existing) {
        return createEvent();
      }
      if (remoteEventIsAtLeastRevision(existing, input.mutationVersion)) {
        return { ...existing, id: existing.id ?? input.googleCalendarEventId };
      }
      try {
        return await patchGoogleCalendarEventConditionally(
          context,
          input.googleCalendarEventId,
          existing,
          body,
          input.mutationVersion,
          requestOptions,
        );
      } catch (error) {
        if (!(error instanceof GoogleCalendarApiError) || error.status !== 404) {
          throw error;
        }
        return createEvent();
      }
    });

    if (!event.id) {
      throw new Error('Google Calendar event response did not include an event id');
    }

    if (options.persistResult !== false) {
      await recordCalendarSyncResult({
        appointmentId: input.appointmentId,
        salonId: input.salonId,
        status: 'synced',
        eventId: event.id,
        error: null,
      });
    }

    return options.persistResult === false
      ? { status: 'synced', eventId: event.id, calendarId: context.calendarId }
      : { status: 'synced', eventId: event.id };
  } catch (error) {
    if (error instanceof GoogleCalendarDispatchFenceError) {
      throw error;
    }
    const message = toErrorMessage(error);
    if (!(error instanceof GoogleCalendarRequestAbortedError)) {
      await markGoogleConnectionDegraded(input.salonId, message, context, options);
    }
    if (options.persistResult !== false) {
      await recordCalendarSyncResult({
        appointmentId: input.appointmentId,
        salonId: input.salonId,
        status: 'failed',
        eventId: input.googleCalendarEventId ?? null,
        error: message,
      });
    }

    return options.persistResult === false
      ? {
          status: 'failed',
          error: message,
          eventId: input.googleCalendarEventId ?? null,
          calendarId: context.calendarId,
          createAttempted,
        }
      : { status: 'failed', error: message };
  }
}

export async function deleteGoogleCalendarEventForAppointment(args: {
  appointmentId: string;
  salonId: string;
  googleCalendarEventId?: string | null;
}, options: GoogleCalendarProviderOptions = {}): Promise<GoogleCalendarSyncResult> {
  const context = await getGoogleCalendarRequestContext(args.salonId, options);
  if (!context) {
    return { status: 'disabled' };
  }

  let googleCalendarEventId = args.googleCalendarEventId;
  let linkedEvent = await getLinkedGoogleCalendarEvent(
    args.salonId,
    args.appointmentId,
    googleCalendarEventId,
    options.targetCalendarId,
    options.reconciliationMirrorId,
    options.reconciliationExpectedAppointmentId,
  );
  if (!googleCalendarEventId && linkedEvent) {
    googleCalendarEventId = linkedEvent.googleEventId;
  }
  if (!googleCalendarEventId) {
    const [appointment] = await db
      .select({ googleCalendarEventId: appointmentSchema.googleCalendarEventId })
      .from(appointmentSchema)
      .where(and(
        eq(appointmentSchema.id, args.appointmentId),
        eq(appointmentSchema.salonId, args.salonId),
      ))
      .limit(1);
    googleCalendarEventId = appointment?.googleCalendarEventId ?? null;
    if (googleCalendarEventId) {
      linkedEvent = await getLinkedGoogleCalendarEvent(
        args.salonId,
        args.appointmentId,
        googleCalendarEventId,
        options.targetCalendarId,
        options.reconciliationMirrorId,
        options.reconciliationExpectedAppointmentId,
      );
    }
  }
  if (!googleCalendarEventId) {
    return { status: 'disabled' };
  }
  if (linkedEvent) {
    if (
      !canWriteLinkedGoogleEvent(linkedEvent)
      && !(
        options.reconciliationMirrorId === linkedEvent.id
        && linkedEvent.appointmentId === (options.reconciliationExpectedAppointmentId ?? null)
        && linkedEvent.reviewStatus === 'appointment'
        && linkedEvent.syncMode === 'bidirectional'
        && ['owner', 'writer'].includes(linkedEvent.sourceAccessRole)
      )
      && !(
        options.authoritativeTerminalDelete
        && linkedEvent.appointmentId === args.appointmentId
        && linkedEvent.reviewStatus === 'appointment'
        && linkedEvent.syncMode === 'bidirectional'
        && ['owner', 'writer'].includes(linkedEvent.sourceAccessRole)
        && (
          linkedEvent.deletedAt !== null
          || linkedEvent.googleStatus === 'cancelled'
        )
      )
    ) {
      return { status: 'disabled' };
    }
    context.calendarId = linkedEvent.calendarId;
  }
  if (options.targetCalendarId) {
    context.calendarId = options.targetCalendarId;
  }

  try {
    await runGoogleCalendarMutationDispatch(options, async (requestOptions) => {
      const existing = await getGoogleCalendarEventForMutation(
        context,
        googleCalendarEventId,
        requestOptions,
      );
      if (!existing) {
        return;
      }
      if (
        options.mutationVersion
        && remoteMutationVersion(existing)
        && remoteMutationVersion(existing)! > options.mutationVersion
      ) {
        throw new GoogleCalendarApiError(
          409,
          'Google Calendar event is newer than the requested deletion',
        );
      }
      if (!existing.etag) {
        throw new GoogleCalendarApiError(409, 'Google Calendar event did not include an ETag');
      }
      try {
        await googleCalendarFetchWithContext<Record<string, never>>(
          context,
          `/calendars/${encodeURIComponent(context.calendarId)}/events/${encodeURIComponent(googleCalendarEventId)}?sendUpdates=none`,
          { method: 'DELETE', headers: { 'If-Match': existing.etag } },
          requestOptions,
        );
      } catch (error) {
        if (!(error instanceof GoogleCalendarApiError) || error.status !== 404) {
          throw error;
        }
      }
    });

    if (linkedEvent && options.persistResult !== false) {
      const deletedAt = new Date();
      await db
        .update(googleCalendarEventSchema)
        .set({
          googleStatus: 'cancelled',
          deletedAt,
          lastSyncedAt: deletedAt,
        })
        .where(and(
          eq(googleCalendarEventSchema.id, linkedEvent.id),
          eq(googleCalendarEventSchema.salonId, args.salonId),
        ));
    }

    if (options.persistResult !== false) {
      await recordCalendarSyncResult({
        appointmentId: args.appointmentId,
        salonId: args.salonId,
        status: 'deleted',
        eventId: null,
        error: null,
      });
    }

    return options.persistResult === false
      ? { status: 'deleted', eventId: googleCalendarEventId, calendarId: context.calendarId }
      : { status: 'deleted' };
  } catch (error) {
    if (error instanceof GoogleCalendarDispatchFenceError) {
      throw error;
    }
    const message = toErrorMessage(error);
    if (!(error instanceof GoogleCalendarRequestAbortedError)) {
      await markGoogleConnectionDegraded(args.salonId, message, context, options);
    }
    if (options.persistResult !== false) {
      await recordCalendarSyncResult({
        appointmentId: args.appointmentId,
        salonId: args.salonId,
        status: 'failed',
        eventId: googleCalendarEventId,
        error: message,
      });
    }

    return options.persistResult === false
      ? {
          status: 'failed',
          error: message,
          eventId: googleCalendarEventId,
          calendarId: context.calendarId,
        }
      : { status: 'failed', error: message };
  }
}
