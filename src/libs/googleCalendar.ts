import 'server-only';

import { createSign } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { decryptIntegrationSecret } from '@/libs/lusterSecurity';
import { appointmentSchema, googleCalendarEventSchema, salonGoogleCalendarConnectionSchema } from '@/models/Schema';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_REFRESH_SAFETY_SECONDS = 60;

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
};

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
  totalDurationMinutes: number;
  timeZone: string;
  locationName?: string | null;
  locationAddress?: string | null;
  notes?: string | null;
  googleCalendarEventId?: string | null;
};

type GoogleCalendarSyncResult =
  | { status: 'disabled' }
  | { status: 'synced'; eventId: string }
  | { status: 'deleted' }
  | { status: 'failed'; error: string };

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
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

async function getGoogleAccessToken(config: GoogleCalendarConfig): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAtSeconds > nowSeconds + TOKEN_REFRESH_SAFETY_SECONDS) {
    return cachedToken.token;
  }

  const assertion = buildServiceAccountAssertion(config, nowSeconds);
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
  } catch {
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
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${context.accessToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch {
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

async function getGoogleCalendarRequestContext(salonId?: string): Promise<GoogleCalendarRequestContext | null> {
  if (salonId) {
    const [connection] = await db
      .select()
      .from(salonGoogleCalendarConnectionSchema)
      .where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId))
      .limit(1);
    if (connection) {
      if (!['active', 'degraded'].includes(connection.status)) {
        throw new GoogleCalendarConnectionError(true);
      }
      if (!Env.GOOGLE_OAUTH_CLIENT_ID || !Env.GOOGLE_OAUTH_CLIENT_SECRET) {
        throw new GoogleCalendarConnectionError(false);
      }
      let response: Response;
      try {
        response = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: Env.GOOGLE_OAUTH_CLIENT_ID,
            client_secret: Env.GOOGLE_OAUTH_CLIENT_SECRET,
            refresh_token: decryptIntegrationSecret(connection.encryptedRefreshToken),
            grant_type: 'refresh_token',
          }),
        });
      } catch {
        throw new GoogleCalendarConnectionError(false);
      }
      let data: GoogleTokenResponse;
      try {
        data = await response.json() as GoogleTokenResponse;
      } catch {
        throw new GoogleCalendarConnectionError(false);
      }
      if (!response.ok || !data.access_token) {
        const reconnectRequired = data.error === 'invalid_grant';
        await db.update(salonGoogleCalendarConnectionSchema).set({
          status: reconnectRequired ? 'reconnect_required' : 'degraded',
          lastError: data.error_description || data.error || `Token refresh failed (${response.status})`,
          lastCheckedAt: new Date(),
        }).where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId));
        throw new GoogleCalendarConnectionError(reconnectRequired);
      }
      await db.update(salonGoogleCalendarConnectionSchema).set({
        status: 'active',
        lastError: null,
        lastCheckedAt: new Date(),
        tokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      }).where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId));
      return {
        accessToken: data.access_token,
        calendarId: connection.destinationCalendarId,
        // Safety floor: while setup is incomplete (no saved blocking
        // calendars), availability still blocks on the primary calendar so a
        // connected salon can never be silently double-booked. Readiness
        // reporting (integrationHealth) treats this state as setup_incomplete.
        busyCalendarIds: connection.busyCalendarIds.length ? connection.busyCalendarIds : ['primary'],
        connectionType: 'oauth',
      };
    }
  }

  const legacy = getGoogleCalendarConfig();
  if (!legacy) {
    return null;
  }
  return {
    accessToken: await getGoogleAccessToken(legacy),
    calendarId: legacy.calendarId,
    busyCalendarIds: [legacy.calendarId],
    connectionType: 'legacy',
  };
}

export async function listGoogleCalendarsForSalon(salonId: string): Promise<Array<{
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}>> {
  const context = await getGoogleCalendarRequestContext(salonId);
  if (!context) {
    return [];
  }
  const data = await googleCalendarFetchWithContext<{
    items?: Array<{ id?: string; summary?: string; primary?: boolean; accessRole?: string }>;
  }>(context, '/users/me/calendarList?minAccessRole=reader', { method: 'GET' });
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

export async function listGoogleCalendarEventsForSalon(args: {
  salonId: string;
  calendarIds?: string[];
  startTime?: Date;
  endTime?: Date;
  updatedMin?: Date;
  includeDeleted?: boolean;
}): Promise<GoogleCalendarRemoteEvent[]> {
  const context = await getGoogleCalendarRequestContext(args.salonId);
  if (!context || context.connectionType !== 'oauth') {
    return [];
  }

  const events: GoogleCalendarRemoteEvent[] = [];
  const calendarIds = [...new Set(args.calendarIds?.length ? args.calendarIds : [context.calendarId])];
  for (const calendarId of calendarIds) {
    let pageToken: string | undefined;
    do {
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

      const data = await googleCalendarFetchWithContext<GoogleCalendarEventListResponse>(
        context,
        `/calendars/${encodeURIComponent(calendarId)}/events?${search.toString()}`,
        { method: 'GET' },
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
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  return events;
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

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
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
    `Price: ${formatPrice(input.totalPrice)}`,
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

async function markGoogleConnectionDegraded(salonId: string, message: string) {
  await db
    .update(salonGoogleCalendarConnectionSchema)
    .set({ status: 'degraded', lastError: message, lastCheckedAt: new Date() })
    .where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId))
    .catch(() => undefined);
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
) {
  const reconnectRequired = isGoogleCalendarReconnectRequired(error);
  await db
    .update(salonGoogleCalendarConnectionSchema)
    .set({
      status: reconnectRequired ? 'reconnect_required' : 'degraded',
      lastError: reconnectRequired
        ? 'Google Calendar authorization is invalid. Reconnect required.'
        : 'Google Calendar availability check failed.',
      lastCheckedAt: new Date(),
    })
    .where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId))
    .catch(() => undefined);
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

export async function getGoogleCalendarBusyWindows(args: {
  salonId?: string;
  startTime: Date;
  endTime: Date;
  timeZone: string;
}): Promise<GoogleCalendarBusyWindow[]> {
  try {
    const context = await getGoogleCalendarRequestContext(args.salonId);
    if (!context) {
      return [];
    }

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
    return context.busyCalendarIds.flatMap((calendarId) => {
      const calendar = data.calendars?.[calendarId];
      if (calendar?.errors?.length) {
        throw new GoogleCalendarApiError(
          502,
          calendar.errors.map(error => error.message ?? error.reason ?? 'calendar_error').join(', '),
        );
      }
      return (calendar?.busy ?? []).map(window => ({
        startTime: new Date(window.start),
        endTime: new Date(window.end),
      }));
    });
  } catch (error) {
    if (!(error instanceof GoogleCalendarApiError || error instanceof GoogleCalendarConnectionError)) {
      throw error;
    }
    const reconnectRequired = isGoogleCalendarReconnectRequired(error);
    if (args.salonId) {
      await markGoogleAvailabilityFailure(args.salonId, error);
    }
    throw new GoogleCalendarAvailabilityError(reconnectRequired);
  }
}

export async function hasGoogleCalendarConflict(args: {
  salonId?: string;
  startTime: Date;
  endTime: Date;
  timeZone: string;
}): Promise<boolean> {
  const busyWindows = await getGoogleCalendarBusyWindows(args);
  return isBusyWindowConflict(args.startTime, args.endTime, busyWindows);
}

async function applyLinkedEventCalendar(context: GoogleCalendarRequestContext, salonId: string, appointmentId: string): Promise<boolean> {
  const [event] = await db.select({
    calendarId: googleCalendarEventSchema.calendarId,
    sourceAccessRole: googleCalendarEventSchema.sourceAccessRole,
    syncMode: googleCalendarEventSchema.syncMode,
  }).from(googleCalendarEventSchema).where(and(
    eq(googleCalendarEventSchema.salonId, salonId),
    eq(googleCalendarEventSchema.appointmentId, appointmentId),
  )).limit(1);
  if (!event) {
    return true;
  }
  if (event.syncMode === 'inbound_only' || !['owner', 'writer'].includes(event.sourceAccessRole)) {
    return false;
  }
  context.calendarId = event.calendarId;
  return true;
}

export async function syncGoogleCalendarEventForAppointment(
  input: GoogleCalendarAppointmentEventInput,
): Promise<GoogleCalendarSyncResult> {
  const context = await getGoogleCalendarRequestContext(input.salonId);
  if (!context) {
    return { status: 'disabled' };
  }
  if (!await applyLinkedEventCalendar(context, input.salonId, input.appointmentId)) {
    return { status: 'disabled' };
  }

  try {
    const body = buildGoogleCalendarEventBody(input);
    let event: GoogleCalendarEventResponse;

    if (input.googleCalendarEventId) {
      try {
        event = await googleCalendarFetchWithContext<GoogleCalendarEventResponse>(
          context,
          `/calendars/${encodeURIComponent(context.calendarId)}/events/${encodeURIComponent(input.googleCalendarEventId)}?sendUpdates=none`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        );
      } catch (error) {
        if (!(error instanceof GoogleCalendarApiError) || error.status !== 404) {
          throw error;
        }

        event = await googleCalendarFetchWithContext<GoogleCalendarEventResponse>(
          context,
          `/calendars/${encodeURIComponent(context.calendarId)}/events?sendUpdates=none`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          },
        );
      }
    } else {
      event = await googleCalendarFetchWithContext<GoogleCalendarEventResponse>(
        context,
        `/calendars/${encodeURIComponent(context.calendarId)}/events?sendUpdates=none`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
    }

    if (!event.id) {
      throw new Error('Google Calendar event response did not include an event id');
    }

    await recordCalendarSyncResult({
      appointmentId: input.appointmentId,
      salonId: input.salonId,
      status: 'synced',
      eventId: event.id,
      error: null,
    });

    return { status: 'synced', eventId: event.id };
  } catch (error) {
    const message = toErrorMessage(error);
    await markGoogleConnectionDegraded(input.salonId, message);
    await recordCalendarSyncResult({
      appointmentId: input.appointmentId,
      salonId: input.salonId,
      status: 'failed',
      eventId: input.googleCalendarEventId ?? null,
      error: message,
    });

    return { status: 'failed', error: message };
  }
}

export async function deleteGoogleCalendarEventForAppointment(args: {
  appointmentId: string;
  salonId: string;
  googleCalendarEventId?: string | null;
}): Promise<GoogleCalendarSyncResult> {
  const context = await getGoogleCalendarRequestContext(args.salonId);
  if (!context || !args.googleCalendarEventId) {
    return { status: 'disabled' };
  }
  if (!await applyLinkedEventCalendar(context, args.salonId, args.appointmentId)) {
    return { status: 'disabled' };
  }

  try {
    try {
      await googleCalendarFetchWithContext<Record<string, never>>(
        context,
        `/calendars/${encodeURIComponent(context.calendarId)}/events/${encodeURIComponent(args.googleCalendarEventId)}?sendUpdates=none`,
        { method: 'DELETE' },
      );
    } catch (error) {
      if (!(error instanceof GoogleCalendarApiError) || error.status !== 404) {
        throw error;
      }
    }

    await recordCalendarSyncResult({
      appointmentId: args.appointmentId,
      salonId: args.salonId,
      status: 'deleted',
      eventId: null,
      error: null,
    });

    return { status: 'deleted' };
  } catch (error) {
    const message = toErrorMessage(error);
    await markGoogleConnectionDegraded(args.salonId, message);
    await recordCalendarSyncResult({
      appointmentId: args.appointmentId,
      salonId: args.salonId,
      status: 'failed',
      eventId: args.googleCalendarEventId,
      error: message,
    });

    return { status: 'failed', error: message };
  }
}
