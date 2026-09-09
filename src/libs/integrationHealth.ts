import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { computeAvailableBalance } from '@/libs/billing/creditLedger';
import { friendlyFailureReason } from '@/libs/communicationMasking';
import { resolveSalonCommunicationSettings } from '@/libs/communicationSettings';
import { db } from '@/libs/DB';
import { Env } from '@/libs/Env';
import { resolveEntitlement } from '@/libs/featureEntitlements';
import { readCommunicationControlCached } from '@/libs/platformCommunicationControl';
import { readSharedSenderEnvConfig, resolveByoSenderReadiness, resolveSharedSenderReadiness, resolveSmsSenderMode } from '@/libs/smsSender';
import {
  deriveConnectStatus,
  EXPECTED_LIVEMODE,
  toBinding,
} from '@/libs/stripeConnect/readiness';
import type { SmsOperationalHealth } from '@/libs/textingStatus';
import { buildStatusCallbackUrl } from '@/libs/twilioMessagingSend';
import {
  integrationOutboxSchema,
  notificationDeliverySchema,
  salonGoogleCalendarConnectionSchema,
  salonSchema,
  salonStripeAccountSchema,
  salonTwilioConnectionSchema,
} from '@/models/Schema';
import type { SalonFeatures } from '@/types/salonPolicy';

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

/** Read-only status projection of the same sender gates used by dispatch. */
export async function getSalonSmsReadiness(salonId: string): Promise<SmsOperationalHealth> {
  const [[salon], [connection]] = await Promise.all([
    db.select({ slug: salonSchema.slug, settings: salonSchema.settings, smsRemindersEnabled: salonSchema.smsRemindersEnabled })
      .from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1),
    db.select().from(salonTwilioConnectionSchema).where(eq(salonTwilioConnectionSchema.salonId, salonId)).limit(1),
  ]);
  const candidateMode = resolveSmsSenderMode({ connection: connection ?? null, perSalonDisabled: false });
  const settings = resolveSalonCommunicationSettings(salon?.settings ?? null, {
    senderMode: candidateMode,
    legacySmsEnabled: salon?.smsRemindersEnabled,
  });
  let providerReady = false;
  let availableCredits: number | null = null;
  let blockingReason: string | null = null;
  let detail = '';
  let disabledEventTypes: string[] = [];
  const phoneNumber = candidateMode === 'connected_byo' ? connection?.phoneNumber ?? null : null;
  const senderLabel = candidateMode === 'connected_byo' ? 'Retired texting connection' : 'Luster shared texting number';
  const workerConfigured = Boolean(process.env.CRON_SECRET);
  if (!salon) {
    blockingReason = 'SALON_NOT_FOUND';
    detail = 'The salon could not be loaded. Refresh and try again.';
  } else if (candidateMode === 'connected_byo' && connection) {
    providerReady = resolveByoSenderReadiness(connection, { authTokenPresent: Boolean(Env.TWILIO_AUTH_TOKEN) }).ready;
    if (!providerReady) {
      blockingReason = 'SENDER_NOT_READY';
      detail = 'Luster texts use SMS credits. This salon has a retired texting connection. Contact support before enabling Luster texting.';
    }
  } else {
    const control = await readCommunicationControlCached();
    disabledEventTypes = control?.disabledEventTypes ?? [];
    const readiness = resolveSharedSenderReadiness({
      salonSlug: salon.slug,
      config: { ...readSharedSenderEnvConfig(), platformControl: control, creditReservation: { available: true } },
    });
    providerReady = readiness.ready;
    if (!readiness.ready) {
      blockingReason = readiness.reason;
      detail = readiness.reason === 'GLOBAL_SMS_DISABLED'
        ? 'Luster has temporarily paused text delivery for all salons. Texting is included in every plan, and your SMS credits remain available.'
        : readiness.reason === 'PILOT_NOT_ENABLED'
          ? 'Luster texting is in a controlled pilot. Your plan includes texting, but this salon is waiting for pilot access.'
          : 'Luster texting setup is incomplete. Contact support to finish setup. Texting is included in every plan.';
    }
    const balance = await db.transaction(tx => computeAvailableBalance(tx, salonId, new Date()));
    availableCredits = balance.available;
  }
  if (blockingReason === null && !buildStatusCallbackUrl('readiness')) {
    providerReady = false;
    blockingReason = 'CALLBACK_NOT_CONFIGURED';
    detail = 'Text delivery tracking is not configured. Contact support to set the public callback address.';
  }
  if (blockingReason === null && candidateMode === 'shared_luster' && !process.env.REDIS_URL) {
    blockingReason = 'RATE_LIMITER_NOT_CONFIGURED';
    detail = 'Text delivery is waiting for its sending controls to be configured. Contact support.';
  }
  // A configured worker is necessary for both automatic and manual queued sends.
  if (blockingReason === null && !workerConfigured) {
    blockingReason = 'WORKER_NOT_CONFIGURED';
    detail = 'Text delivery is not configured in this environment. Contact support to enable the message worker.';
  }
  if (blockingReason === null && settings.killSwitch) {
    blockingReason = 'COMMUNICATIONS_PAUSED';
    detail = 'Communications are paused. Review and save Client texts & reminders in Settings to resume.';
  }
  if (blockingReason === null && !settings.sms.enabled) {
    blockingReason = 'SMS_DISABLED';
    detail = 'Text messages are turned off. Enable Text messages to clients in Settings.';
  }
  if (blockingReason === null && availableCredits !== null && availableCredits <= 0) {
    blockingReason = 'NO_CREDITS';
    detail = 'No SMS credits are available. Check your balance and credit options in Usage.';
  }
  const available = blockingReason === null;
  return {
    providerReady,
    senderMode: candidateMode,
    senderLabel,
    phoneNumber,
    blockingReason,
    detail: detail || (disabledEventTypes.includes('manual_text')
      ? 'Manual texting is temporarily paused by support. Automatic booking messages follow your saved preferences.'
      : `Texts send through ${senderLabel}. Each recipient must have agreed to receive texts.`),
    smsEnabled: settings.sms.enabled,
    automaticEnabled: available,
    manualAvailable: available && !disabledEventTypes.includes('manual_text'),
    remindersEnabled: available && !disabledEventTypes.includes('appointment_reminder') && settings.events.appointment_reminder.enabled
      && settings.reminders.rules.some(rule => rule.enabled && rule.channels !== 'email'),
    quietHours: settings.quietHours,
    availableCredits,
    workerConfigured,
  };
}

export async function getSalonIntegrationHealth(salonId: string) {
  const [
    [google],
    [twilio],
    [latestSmsFailure],
    [pending],
    [failed],
    stripeBindingRows,
    [salonFeatureRow],
    sms,
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
          inArray(notificationDeliverySchema.status, ['failed', 'undelivered']),
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
    // The per-salon deposits entitlement replaced the env allowlist that used to
    // decide Payments-card visibility. Guarded for the same reason as above.
    (async () => {
      try {
        return await db
          .select({ features: salonSchema.features })
          .from(salonSchema)
          .where(eq(salonSchema.id, salonId));
      } catch {
        return [];
      }
    })(),
    getSalonSmsReadiness(salonId),
  ]);

  return {
    sms,
    availability: {
      google: Boolean(
        process.env.GOOGLE_OAUTH_CLIENT_ID
        && process.env.GOOGLE_OAUTH_CLIENT_SECRET
        && process.env.GOOGLE_OAUTH_REDIRECT_URI
        && process.env.INTEGRATION_ENCRYPTION_KEY
        && process.env.OAUTH_STATE_SECRET,
      ),
      twilio: false,
      email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
      photos: Boolean(
        process.env.CLOUDINARY_CLOUD_NAME
        && process.env.CLOUDINARY_API_KEY
        && process.env.CLOUDINARY_API_SECRET,
      ),
      // Salon-owned Twilio onboarding is permanently retired.
      twilioConnectOnboarding: false,
    },
    // Capability-specific configuration flags (contract §11.8/§23). These are
    // ENV-PRESENCE indicators only, never operational readiness: the shared
    // sender stays dark until the platform communication control (Gate B)
    // enables it, and the two not-yet-built capabilities are hard false so no
    // surface can claim an unbuilt component is ready. The retired Connect
    // capability remains false regardless of stale environment configuration.
    capabilities: {
      twilioVerifyConfigured: Boolean(
        process.env.TWILIO_ACCOUNT_SID
        && process.env.TWILIO_AUTH_TOKEN
        && process.env.TWILIO_VERIFY_SERVICE_SID,
      ),
      sharedSmsConfigured: Boolean(
        process.env.TWILIO_ACCOUNT_SID
        && process.env.TWILIO_AUTH_TOKEN
        && process.env.TWILIO_MESSAGING_SERVICE_SID,
      ),
      twilioMessagingServiceConfigured: Boolean(process.env.TWILIO_MESSAGING_SERVICE_SID),
      twilioConnectConfigured: false,
      twilioStatusCallbackConfigured: Boolean(process.env.NEXT_PUBLIC_APP_URL),
      // Both shipped in Gate B: the dispatcher route exists (CRON_SECRET
      // gates invocation) and migration 0069 created the ledger. These are
      // capability-presence flags, never operational-readiness claims — the
      // shared sender stays dark behind the platform control row.
      smsWorkerConfigured: Boolean(process.env.CRON_SECRET),
      smsCreditLedgerReady: true as const,
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
          lastError: 'This texting connection is retired. Contact support before enabling Luster texting.',
          deauthorized: Boolean(twilio.deauthorizedAt) || twilio.status === 'deauthorized',
        }
      : {
          status: 'disconnected',
          phoneNumber: null,
          lastError: null,
          deauthorized: false,
        },
    latestSmsDeliveryError: latestSmsFailure ? { ...latestSmsFailure, errorMessage: friendlyFailureReason(latestSmsFailure.errorCode ?? 'DELIVERY_FAILED') } : null,
    calendarOutbox: {
      pending: Number(pending?.count ?? 0),
      failed: Number(failed?.count ?? 0),
    },
    stripeConnect: buildStripeConnectBlock(
      salonId,
      stripeBindingRows,
      (salonFeatureRow?.features as SalonFeatures | null | undefined) ?? null,
    ),
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
  features: SalonFeatures | null,
) {
  const live = rows.find(row => row.revokedAt === null) ?? null;
  const binding = live ? toBinding(live) : null;

  // Render the card when the salon has any binding history at all, or when it
  // holds the deposits entitlement.
  const visible = rows.length > 0 || resolveEntitlement(features, 'money', 'deposits');

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
