import 'server-only';

import { createSign } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { appointmentSchema } from '@/models/Schema';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_REFRESH_SAFETY_SECONDS = 60;

type GoogleCalendarConfig = {
  calendarId: string;
  clientEmail: string;
  privateKey: string;
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

class GoogleCalendarApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new GoogleCalendarApiError(response.status, await response.text());
  }

  const data = await response.json() as GoogleTokenResponse;
  if (!data.access_token) {
    throw new Error('Google OAuth token response did not include an access token');
  }

  cachedToken = {
    token: data.access_token,
    expiresAtSeconds: nowSeconds + (data.expires_in ?? 3600),
  };

  return data.access_token;
}

async function googleCalendarFetch<T>(
  config: GoogleCalendarConfig,
  path: string,
  init: RequestInit,
): Promise<T> {
  const token = await getGoogleAccessToken(config);
  const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (response.status === 204) {
    return {} as T;
  }

  if (!response.ok) {
    throw new GoogleCalendarApiError(response.status, await response.text());
  }

  return await response.json() as T;
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
  startTime: Date;
  endTime: Date;
  timeZone: string;
}): Promise<GoogleCalendarBusyWindow[]> {
  const config = getGoogleCalendarConfig();
  if (!config) {
    return [];
  }

  const data = await googleCalendarFetch<GoogleFreeBusyResponse>(
    config,
    '/freeBusy',
    {
      method: 'POST',
      body: JSON.stringify({
        timeMin: args.startTime.toISOString(),
        timeMax: args.endTime.toISOString(),
        timeZone: args.timeZone,
        items: [{ id: config.calendarId }],
      }),
    },
  );
  const calendar = data.calendars?.[config.calendarId] ?? Object.values(data.calendars ?? {})[0];

  if (calendar?.errors?.length) {
    throw new Error(calendar.errors.map(error => error.message ?? error.reason ?? 'calendar_error').join(', '));
  }

  return (calendar?.busy ?? []).map(window => ({
    startTime: new Date(window.start),
    endTime: new Date(window.end),
  }));
}

export async function hasGoogleCalendarConflict(args: {
  startTime: Date;
  endTime: Date;
  timeZone: string;
}): Promise<boolean> {
  const busyWindows = await getGoogleCalendarBusyWindows(args);
  return isBusyWindowConflict(args.startTime, args.endTime, busyWindows);
}

export async function syncGoogleCalendarEventForAppointment(
  input: GoogleCalendarAppointmentEventInput,
): Promise<GoogleCalendarSyncResult> {
  const config = getGoogleCalendarConfig();
  if (!config) {
    return { status: 'disabled' };
  }

  try {
    const body = buildGoogleCalendarEventBody(input);
    let event: GoogleCalendarEventResponse;

    if (input.googleCalendarEventId) {
      try {
        event = await googleCalendarFetch<GoogleCalendarEventResponse>(
          config,
          `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(input.googleCalendarEventId)}?sendUpdates=none`,
          {
            method: 'PATCH',
            body: JSON.stringify(body),
          },
        );
      } catch (error) {
        if (!(error instanceof GoogleCalendarApiError) || error.status !== 404) {
          throw error;
        }

        event = await googleCalendarFetch<GoogleCalendarEventResponse>(
          config,
          `/calendars/${encodeURIComponent(config.calendarId)}/events?sendUpdates=none`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          },
        );
      }
    } else {
      event = await googleCalendarFetch<GoogleCalendarEventResponse>(
        config,
        `/calendars/${encodeURIComponent(config.calendarId)}/events?sendUpdates=none`,
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
  const config = getGoogleCalendarConfig();
  if (!config || !args.googleCalendarEventId) {
    return { status: 'disabled' };
  }

  try {
    try {
      await googleCalendarFetch<Record<string, never>>(
        config,
        `/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(args.googleCalendarEventId)}?sendUpdates=none`,
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
