import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import {
  deriveConnectStatus,
  EXPECTED_LIVEMODE,
  toBinding,
} from '@/libs/stripeConnect/readiness';
import {
  integrationOutboxSchema,
  notificationDeliverySchema,
  salonGoogleCalendarConnectionSchema,
  salonStripeAccountSchema,
  salonTwilioConnectionSchema,
} from '@/models/Schema';

/**
 * Temporary deposits pilot allowlist. This is the SECOND of exactly two read
 * sites in D2 — the other is the onboard route's exposure gate. They are not
 * redundant: this one controls VISIBILITY of the Payments card, that one
 * controls EXPOSURE of the endpoint, and an unrendered card does not make the
 * endpoint unreachable. A later PR replaces both with one entitlement call and
 * deletes the env var.
 */
function isPilotSalon(salonId: string): boolean {
  return (Env.LUSTER_DEPOSITS_PILOT_SALON_IDS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .includes(salonId);
}

/**
 * Google Calendar readiness for a salon:
 * - `not_connected`     — no OAuth connection exists (optional integration).
 * - `reconnect_required`— authorization was revoked or the token is invalid.
 * - `attention_required`— connected but the last provider call failed
 *                         (e.g. a selected calendar was deleted or lost access).
 * - `setup_incomplete`  — OAuth is connected but the owner has not yet saved
 *                         at least one calendar that prevents double-booking.
 *                         Availability still blocks on the primary calendar as
 *                         a safety floor, but setup must be finished.
 * - `ready`             — connected with at least one saved blocking calendar.
 */
export type GoogleCalendarReadiness
  = | 'not_connected'
  | 'reconnect_required'
  | 'attention_required'
  | 'setup_incomplete'
  | 'ready';

export function resolveGoogleReadiness(
  status: string,
  busyCalendarIds: string[] | null | undefined,
): GoogleCalendarReadiness {
  if (status === 'reconnect_required') {
    return 'reconnect_required';
  }
  if ((busyCalendarIds?.length ?? 0) === 0) {
    return 'setup_incomplete';
  }
  if (status === 'degraded') {
    return 'attention_required';
  }
  return 'ready';
}

export async function getSalonIntegrationHealth(salonId: string) {
  const [
    [google],
    [twilio],
    [latestSmsFailure],
    [pending],
    [failed],
    stripeBindingRows,
  ] = await Promise.all([
    db
      .select({
        status: salonGoogleCalendarConnectionSchema.status,
        email: salonGoogleCalendarConnectionSchema.googleEmail,
        lastError: salonGoogleCalendarConnectionSchema.lastError,
        busyCalendarIds: salonGoogleCalendarConnectionSchema.busyCalendarIds,
        inboundSyncEnabled: salonGoogleCalendarConnectionSchema.inboundSyncEnabled,
        inboundSyncedAt: salonGoogleCalendarConnectionSchema.inboundSyncedAt,
        inboundSyncError: salonGoogleCalendarConnectionSchema.inboundSyncError,
      })
      .from(salonGoogleCalendarConnectionSchema)
      .where(eq(salonGoogleCalendarConnectionSchema.salonId, salonId))
      .limit(1),
    db
      .select({
        status: salonTwilioConnectionSchema.status,
        phoneNumber: salonTwilioConnectionSchema.phoneNumber,
        deauthorizedAt: salonTwilioConnectionSchema.deauthorizedAt,
        lastError: salonTwilioConnectionSchema.lastError,
      })
      .from(salonTwilioConnectionSchema)
      .where(eq(salonTwilioConnectionSchema.salonId, salonId))
      .limit(1),
    db
      .select({
        errorCode: notificationDeliverySchema.errorCode,
        errorMessage: notificationDeliverySchema.errorMessage,
        createdAt: notificationDeliverySchema.createdAt,
      })
      .from(notificationDeliverySchema)
      .where(
        and(
          eq(notificationDeliverySchema.salonId, salonId),
          eq(notificationDeliverySchema.channel, 'sms'),
          eq(notificationDeliverySchema.status, 'failed'),
        ),
      )
      .orderBy(desc(notificationDeliverySchema.createdAt))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)` })
      .from(integrationOutboxSchema)
      .where(
        and(
          eq(integrationOutboxSchema.salonId, salonId),
          eq(integrationOutboxSchema.provider, 'google_calendar'),
          inArray(integrationOutboxSchema.status, ['pending', 'retry']),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(integrationOutboxSchema)
      .where(
        and(
          eq(integrationOutboxSchema.salonId, salonId),
          eq(integrationOutboxSchema.provider, 'google_calendar'),
          eq(integrationOutboxSchema.status, 'failed'),
        ),
      ),
    // CACHED ROW ONLY — no provider call on page load. Guarded so a
    // not-yet-applied 0065 degrades the Payments card alone instead of
    // rejecting the whole batch and blanking every other integration card.
    // The try/catch (rather than `.catch()`) also keeps this tolerant of the
    // many suites that mock `@/libs/DB` with a partial query builder.
    (async () => {
      try {
        return await db
          .select()
          .from(salonStripeAccountSchema)
          .where(eq(salonStripeAccountSchema.salonId, salonId));
      } catch {
        return [];
      }
    })(),
  ]);

  return {
    availability: {
      google: Boolean(
        process.env.GOOGLE_OAUTH_CLIENT_ID
        && process.env.GOOGLE_OAUTH_CLIENT_SECRET
        && process.env.GOOGLE_OAUTH_REDIRECT_URI
        && process.env.INTEGRATION_ENCRYPTION_KEY
        && process.env.OAUTH_STATE_SECRET,
      ),
      twilio: Boolean(
        process.env.TWILIO_CONNECT_APP_SID
        && process.env.TWILIO_CONNECT_REDIRECT_URI
        && process.env.TWILIO_AUTH_TOKEN,
      ),
      email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      photos: Boolean(
        process.env.CLOUDINARY_CLOUD_NAME
        && process.env.CLOUDINARY_API_KEY
        && process.env.CLOUDINARY_API_SECRET,
      ),
    },
    google: google
      ? {
          status: google.status,
          email: google.email,
          lastError: google.lastError,
          inboundSyncEnabled: google.inboundSyncEnabled,
          inboundSyncedAt: google.inboundSyncedAt,
          inboundSyncError: google.inboundSyncError,
          reconnectRequired: google.status === 'reconnect_required',
          blockingCalendarCount: google.busyCalendarIds?.length ?? 0,
          readiness: resolveGoogleReadiness(google.status, google.busyCalendarIds),
        }
      : {
          status: 'disconnected',
          email: null,
          lastError: null,
          inboundSyncEnabled: false,
          inboundSyncedAt: null,
          inboundSyncError: null,
          reconnectRequired: false,
          blockingCalendarCount: 0,
          readiness: 'not_connected' as GoogleCalendarReadiness,
        },
    twilio: twilio
      ? {
          status: twilio.status,
          phoneNumber: twilio.phoneNumber,
          lastError: twilio.lastError,
          deauthorized: Boolean(twilio.deauthorizedAt) || twilio.status === 'deauthorized',
        }
      : {
          status: 'disconnected',
          phoneNumber: null,
          lastError: null,
          deauthorized: false,
        },
    latestSmsDeliveryError: latestSmsFailure ?? null,
    calendarOutbox: {
      pending: Number(pending?.count ?? 0),
      failed: Number(failed?.count ?? 0),
    },
    stripeConnect: buildStripeConnectBlock(salonId, stripeBindingRows),
  };
}

/**
 * The Payments card's data, derived from the CACHED binding row only.
 *
 * `lastSyncedAt` is surfaced rather than hidden: D2 ships no scheduled refresher
 * on purpose, so this row may be arbitrarily stale. That is acceptable precisely
 * because it gates nothing — the money path takes its own live proof at the
 * decision — and the owner can always force a refresh explicitly.
 */
function buildStripeConnectBlock(
  salonId: string,
  rows: (typeof salonStripeAccountSchema.$inferSelect)[],
) {
  const live = rows.find(row => row.revokedAt === null) ?? null;
  const binding = live ? toBinding(live) : null;

  // Render the card when the salon has any binding history at all, or when it is
  // named in the pilot allowlist.
  const visible = rows.length > 0 || isPilotSalon(salonId);

  if (!EXPECTED_LIVEMODE.ok) {
    return {
      salonId,
      visible,
      status: 'mode_mismatch' as const,
      chargeReady: false,
      payoutsPending: false,
      requirements: null,
      disabledReason: null,
      lastSyncedAt: null,
      hasBindingHistory: rows.length > 0,
    };
  }

  const status = deriveConnectStatus(binding, EXPECTED_LIVEMODE.livemode);

  return {
    // The client needs the server-authoritative id to call the onboard endpoint;
    // that endpoint re-authorizes it with `requireAdmin` regardless.
    salonId,
    visible,
    status,
    chargeReady: status === 'charge_ready' || status === 'action_needed_soon',
    payoutsPending: Boolean(binding && !binding.payoutsEnabled),
    requirements: binding?.requirements ?? null,
    disabledReason: binding?.disabledReason ?? null,
    lastSyncedAt: binding?.lastSyncedAt ?? null,
    hasBindingHistory: rows.length > 0,
  };
}
