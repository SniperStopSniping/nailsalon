import 'server-only';

import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';

import { ClientLifecycleStabilizationError, getSalonClientLineageIdentityWithHandle, resolveOperationalSalonClientContactWithHandle } from '@/libs/clientLifecycleStabilization';
import type { CommunicationIntentDatabase } from '@/libs/communicationIntent';
import { enqueueCommunicationIntent } from '@/libs/communicationIntent';
import { applyQuietHours } from '@/libs/communicationScheduling';
import { resolveCommunicationSettingsFromSettings } from '@/libs/communicationSettings';
import { db } from '@/libs/DB';
import { isValidPhone } from '@/libs/phone';
import { DEFAULT_REVIEW_MESSAGE, isReviewUrl, renderReviewMessage, reviewMessageFits, reviewSettingsSchema, reviewSmsBody } from '@/libs/reviewRequests';
import { normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { readSharedSenderEnvConfig } from '@/libs/smsSender';
import { appointmentSchema, clientCommunicationSchema, communicationConsentSchema, communicationIntentSchema, notificationDeliverySchema, reviewRequestSchema, salonClientSchema, salonRetentionSettingsSchema, salonSchema, smsGlobalConsentEventSchema } from '@/models/Schema';

const DAY = 86400000;
const CANCELLABLE = ['pending', 'claimed', 'blocked_no_credit'] as const;

export async function getReviewSettings(salonId: string, database: CommunicationIntentDatabase = db) {
  const [settings] = await database.select().from(salonRetentionSettingsSchema).where(eq(salonRetentionSettingsSchema.salonId, salonId)).limit(1);
  const [salon] = await database.select().from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1);
  return {
    googleReviewUrl: settings ? settings.googleReviewUrl : salon?.settings?.googleReviewUrl ?? null,
    automaticEnabled: settings?.automaticReviewRequests ?? false,
    enabledAt: settings?.reviewRequestsEnabledAt ?? null,
    delayMinutes: settings?.reviewRequestDelayMinutes ?? 60,
    messageTemplate: settings?.reviewRequestMessage ?? DEFAULT_REVIEW_MESSAGE,
    businessName: salon?.name ?? '',
    salon,
  };
}

async function context(database: CommunicationIntentDatabase, salonId: string, appointmentId: string) {
  const [appointment] = await database.select().from(appointmentSchema).where(and(eq(appointmentSchema.id, appointmentId), eq(appointmentSchema.salonId, salonId))).limit(1);
  const settings = await getReviewSettings(salonId, database);
  if (!appointment?.salonClientId) {
    return { appointment, settings, client: null, legacyReview: null, consent: false, clientIds: [] as string[] };
  }
  try {
    const contact = await resolveOperationalSalonClientContactWithHandle(database, { salonId, clientId: appointment.salonClientId });
    const identity = await getSalonClientLineageIdentityWithHandle(database, { salonId, terminalClientId: contact.id });
    const [client] = await database.select().from(salonClientSchema).where(and(eq(salonClientSchema.id, contact.id), eq(salonClientSchema.salonId, salonId))).limit(1);
    const [legacyReview] = await database.select().from(clientCommunicationSchema).where(and(
      eq(clientCommunicationSchema.salonId, salonId),
      inArray(clientCommunicationSchema.salonClientId, identity.clientIds),
      eq(clientCommunicationSchema.kind, 'google_review'),
      eq(clientCommunicationSchema.status, 'marked_sent'),
    )).orderBy(desc(clientCommunicationSchema.markedSentAt)).limit(1);
    const recipient = normalizeConsentRecipient(contact.phone);
    const [consent] = await database.select().from(communicationConsentSchema).where(and(
      eq(communicationConsentSchema.salonId, salonId),
      eq(communicationConsentSchema.recipient, recipient),
      eq(communicationConsentSchema.channel, 'sms'),
      eq(communicationConsentSchema.purpose, 'appointment_transactional'),
    )).orderBy(desc(communicationConsentSchema.createdAt)).limit(1);
    const [global] = await database.select().from(smsGlobalConsentEventSchema).where(and(
      eq(smsGlobalConsentEventSchema.recipient, recipient),
      eq(smsGlobalConsentEventSchema.senderIdentity, readSharedSenderEnvConfig().senderIdentity),
    )).orderBy(desc(smsGlobalConsentEventSchema.seq)).limit(1);
    return { appointment, settings, client: client ?? null, legacyReview: legacyReview ?? null, consent: consent?.status === 'granted' && global?.state !== 'suppressed', clientIds: identity.clientIds };
  } catch (error) {
    if (!(error instanceof ClientLifecycleStabilizationError)) {
      throw error;
    }
    // Archived, missing, or malformed identity always fails closed.
    return { appointment, settings, client: null, legacyReview: null, consent: false, clientIds: [] as string[] };
  }
}

type ReviewContext = Awaited<ReturnType<typeof context>>;
function ineligible(ctx: ReviewContext, automatic: boolean): string | null {
  const { appointment, client, settings } = ctx;
  if (!appointment || appointment.deletedAt || appointment.status !== 'completed' || !appointment.completedAt) {
    return 'Complete this appointment before requesting a review.';
  }
  if (!client || client.archivedAt || client.mergedIntoClientId || !isValidPhone(client.phone)) {
    return 'This client needs an active profile and a usable mobile number.';
  }
  if (ctx.legacyReview) {
    return 'A review request was previously marked sent for this client.';
  }
  if (client.reviewRequestsSuppressed || client.hasGoogleReview) {
    return client.hasGoogleReview ? 'This client is already marked as having left a review.' : 'Review requests are off for this client.';
  }
  if (!settings.googleReviewUrl || !isReviewUrl(settings.googleReviewUrl)) {
    return 'Add a Google review link in Review settings.';
  }
  if (!settings.salon || settings.salon.deletedAt || settings.salon.isActive === false) {
    return 'This business is unavailable.';
  }
  const communications = resolveCommunicationSettingsFromSettings(settings.salon.settings);
  if (!communications.sms.enabled || communications.killSwitch) {
    return 'Enable Luster SMS in Client communications to request reviews.';
  }
  if (!ctx.consent) {
    return 'This client has not permitted Luster SMS, or has opted out.';
  }
  if (automatic && (!settings.automaticEnabled || !settings.enabledAt || appointment.completedAt <= settings.enabledAt
    || (client.reviewRequestsEligibleAfter && appointment.completedAt <= client.reviewRequestsEligibleAfter))) {
    return 'Automatic review requests are off for this appointment.';
  }
  const body = reviewSmsBody({ template: settings.messageTemplate, clientName: client.fullName, businessName: settings.businessName, reviewLink: settings.googleReviewUrl });
  return reviewMessageFits(body) ? null : 'Shorten the review message to 10 SMS segments or fewer.';
}

async function existingRequest(database: CommunicationIntentDatabase, salonId: string, ctx: ReviewContext) {
  if (!ctx.client || ctx.clientIds.length === 0) {
    return undefined;
  }
  const [row] = await database.select().from(reviewRequestSchema).where(and(
    eq(reviewRequestSchema.salonId, salonId),
    ne(reviewRequestSchema.status, 'cancelled'),
    or(inArray(reviewRequestSchema.clientId, ctx.clientIds), eq(reviewRequestSchema.recipient, normalizeConsentRecipient(ctx.client.phone))),
  )).orderBy(desc(reviewRequestSchema.createdAt)).limit(1);
  return row;
}

/** Only a proven never-sent intent can release a client's normal request slot. */
export async function cancelReviewRequests(database: CommunicationIntentDatabase, salonId: string, filter: { clientIds?: string[]; automaticOnly?: boolean } = {}) {
  const rows = await database.select().from(reviewRequestSchema).where(and(
    eq(reviewRequestSchema.salonId, salonId),
    ne(reviewRequestSchema.status, 'cancelled'),
    filter.clientIds ? inArray(reviewRequestSchema.clientId, filter.clientIds) : undefined,
    filter.automaticOnly ? eq(reviewRequestSchema.source, 'automatic') : undefined,
  ));
  for (const row of rows) {
    const now = new Date();
    const cancelled = await database.update(communicationIntentSchema).set({ status: 'canceled', resolvedAt: now, lastError: 'REVIEW_REQUEST_CANCELLED' }).where(and(
      eq(communicationIntentSchema.id, row.intentId),
      eq(communicationIntentSchema.salonId, salonId),
      inArray(communicationIntentSchema.status, [...CANCELLABLE]),
    )).returning();
    if (cancelled.length) {
      await database.update(reviewRequestSchema).set({ status: 'cancelled', cancelledAt: now }).where(and(eq(reviewRequestSchema.id, row.id), eq(reviewRequestSchema.salonId, salonId)));
    }
  }
}

export async function saveReviewSettings(salonId: string, input: unknown) {
  const parsed = reviewSettingsSchema.parse(input);
  const value = { ...parsed, automaticEnabled: parsed.automaticEnabled && parsed.googleReviewUrl !== null };
  await db.transaction(async (tx) => {
    // Existing completion takes a share lock on this row: settings changes
    // and event production cannot straddle one another's commit.
    await tx.select({ id: salonSchema.id }).from(salonSchema).where(eq(salonSchema.id, salonId)).for('update');
    const old = await getReviewSettings(salonId, tx);
    const enabledAt = value.automaticEnabled ? (old.automaticEnabled ? old.enabledAt : new Date()) : null;
    const patch = { googleReviewUrl: value.googleReviewUrl, automaticReviewRequests: value.automaticEnabled, reviewRequestsEnabledAt: enabledAt, reviewRequestDelayMinutes: value.delayMinutes, reviewRequestMessage: value.messageTemplate };
    await tx.insert(salonRetentionSettingsSchema).values({ salonId, ...patch }).onConflictDoUpdate({ target: salonRetentionSettingsSchema.salonId, set: patch });
    if (!value.googleReviewUrl || !value.automaticEnabled) {
      await cancelReviewRequests(tx, salonId, { automaticOnly: !!value.googleReviewUrl });
    }
  });
  return getReviewSettings(salonId);
}

export async function setReviewSuppression(salonId: string, clientId: string, suppressed: boolean) {
  await db.transaction(async (tx) => {
    const contact = await resolveOperationalSalonClientContactWithHandle(tx, { salonId, clientId });
    const identity = await getSalonClientLineageIdentityWithHandle(tx, { salonId, terminalClientId: contact.id });
    await tx.update(salonClientSchema).set({ reviewRequestsSuppressed: suppressed, reviewRequestsEligibleAfter: new Date() }).where(and(eq(salonClientSchema.salonId, salonId), inArray(salonClientSchema.id, identity.clientIds)));
    if (suppressed) {
      await cancelReviewRequests(tx, salonId, { clientIds: identity.clientIds });
    }
  });
}

/** Called only by a NEW successful completion transaction, never by a scan. */
export async function scheduleReviewRequest(database: CommunicationIntentDatabase, salonId: string, appointmentId: string, automatic = true) {
  if (automatic && !(await getReviewSettings(salonId, database)).automaticEnabled) {
    return;
  }
  const ctx = await context(database, salonId, appointmentId);
  if (!ctx.client) {
    return;
  }
  const historical = await database.select({ request: reviewRequestSchema, intent: communicationIntentSchema }).from(reviewRequestSchema)
    .innerJoin(communicationIntentSchema, and(eq(communicationIntentSchema.id, reviewRequestSchema.intentId), eq(communicationIntentSchema.salonId, reviewRequestSchema.salonId)))
    .where(and(eq(reviewRequestSchema.salonId, salonId), or(inArray(reviewRequestSchema.clientId, ctx.clientIds), eq(reviewRequestSchema.recipient, normalizeConsentRecipient(ctx.client.phone))), eq(reviewRequestSchema.status, 'scheduled'), inArray(communicationIntentSchema.status, ['canceled', 'suppressed', 'expired'])));
  for (const entry of historical) {
    await database.update(reviewRequestSchema).set({ status: 'cancelled', cancelledAt: new Date() }).where(and(eq(reviewRequestSchema.id, entry.request.id), eq(reviewRequestSchema.salonId, salonId)));
  }
  const existing = await existingRequest(database, salonId, ctx);
  if (existing) {
    if (!automatic && existing.source === 'automatic' && !ineligible(ctx, false)) {
      // Keep its immutable send identity. An accepted/unknown attempt is never reset.
      await database.update(communicationIntentSchema).set({ scheduledFor: new Date(), availableAt: new Date() }).where(and(eq(communicationIntentSchema.id, existing.intentId), eq(communicationIntentSchema.salonId, salonId), eq(communicationIntentSchema.status, 'pending')));
    }
    return;
  }
  if (ineligible(ctx, automatic) || !ctx.client || !ctx.appointment?.completedAt) {
    return;
  }
  const now = new Date();
  const planned = automatic ? new Date(ctx.appointment.completedAt.getTime() + ctx.settings.delayMinutes * 60000) : now;
  const scheduledFor = new Date(Math.max(now.getTime(), planned.getTime()));
  const notAfter = new Date(scheduledFor.getTime() + DAY);
  const settings = resolveCommunicationSettingsFromSettings(ctx.settings.salon!.settings);
  const quiet = applyQuietHours({ instant: scheduledFor, quietHours: settings.quietHours, timeZone: ctx.settings.salon?.settings?.booking?.timezone, notAfter });
  if (quiet.kind === 'stale') {
    return;
  }
  const id = `rr_${crypto.randomUUID()}`;
  const intentId = `ci_review_${id}`;
  const inserted = await database.insert(reviewRequestSchema).values({ id, salonId, clientId: ctx.client.id, appointmentId, recipient: normalizeConsentRecipient(ctx.client.phone), source: automatic ? 'automatic' : 'manual', intentId, completedAt: ctx.appointment.completedAt, scheduledFor: quiet.sendAt }).onConflictDoNothing().returning();
  if (!inserted.length) {
    return;
  }
  const intent = await enqueueCommunicationIntent({ database, salonId, appointmentId, channel: 'sms', audience: 'client', eventType: 'review_request', dedupeKey: `review:${salonId}:${id}`, recipient: ctx.client.phone, destinationCountry: 'CA', templateKey: 'client_manual_text', templateVersion: 'v1', variables: { clientId: ctx.client.id, reviewRequestId: id }, schedulingRevision: id, scheduledFor: quiet.sendAt, notAfter });
  await database.update(reviewRequestSchema).set({ intentId: intent.intentId }).where(and(eq(reviewRequestSchema.id, id), eq(reviewRequestSchema.salonId, salonId)));
}

/** Re-read mutable business rules at BOTH existing pre-provider boundaries. */
export async function reviewRequestSendContext(salonId: string, intentId: string) {
  const [row] = await db.select().from(reviewRequestSchema).where(and(eq(reviewRequestSchema.salonId, salonId), eq(reviewRequestSchema.intentId, intentId), ne(reviewRequestSchema.status, 'cancelled'))).limit(1);
  if (!row?.appointmentId) {
    return null;
  }
  const ctx = await context(db, salonId, row.appointmentId);
  if (ineligible(ctx, row.source === 'automatic') || !ctx.client || !ctx.clientIds.includes(row.clientId)
    || normalizeConsentRecipient(ctx.client.phone) !== row.recipient || ctx.appointment?.completedAt?.getTime() !== row.completedAt.getTime()) {
    return null;
  }
  return { message: renderReviewMessage({ template: ctx.settings.messageTemplate, clientName: ctx.client.fullName, businessName: ctx.settings.businessName, reviewLink: ctx.settings.googleReviewUrl! }) };
}

export async function getAppointmentReviewState(salonId: string, appointmentId: string) {
  const ctx = await context(db, salonId, appointmentId);
  const row = await existingRequest(db, salonId, ctx);
  const [intent] = row ? await db.select().from(communicationIntentSchema).where(and(eq(communicationIntentSchema.id, row.intentId), eq(communicationIntentSchema.salonId, salonId))).limit(1) : [];
  const [delivery] = intent?.deliveryId ? await db.select().from(notificationDeliverySchema).where(and(eq(notificationDeliverySchema.id, intent.deliveryId), eq(notificationDeliverySchema.salonId, salonId))).limit(1) : [];
  const reason = ineligible(ctx, false);
  let status = reason ? (ctx.client?.reviewRequestsSuppressed || ctx.client?.hasGoogleReview ? 'suppressed' : 'not_eligible') : 'eligible';
  if (row) {
    status = intent?.status === 'sent' ? 'sent' : ['sending', 'send_outcome_unknown'].includes(intent?.status ?? '') ? 'sending' : ['canceled', 'suppressed', 'expired'].includes(intent?.status ?? '') ? 'cancelled' : intent?.status === 'failed' || !intent ? 'failed' : 'scheduled';
  }
  if (!row && ctx.legacyReview) {
    status = 'sent';
  }
  if (delivery && ['failed', 'undelivered'].includes(delivery.status)) {
    status = 'failed';
  }
  return { status, reason: status === 'failed' ? 'The review request could not be sent. It will not be retried automatically.' : intent?.status === 'blocked_no_credit' ? 'Add SMS credits to send this review request.' : reason, scheduledFor: intent?.availableAt?.toISOString() ?? null, sentAt: intent?.status === 'sent' ? intent.resolvedAt?.toISOString() ?? null : ctx.legacyReview?.markedSentAt?.toISOString() ?? null, message: intent?.bodySnapshot ?? ctx.legacyReview?.messageSnapshot ?? (ctx.settings.googleReviewUrl && ctx.client ? reviewSmsBody({ template: ctx.settings.messageTemplate, clientName: ctx.client.fullName, businessName: ctx.settings.businessName, reviewLink: ctx.settings.googleReviewUrl }) : null), phone: ctx.client?.phone ?? null, clientId: ctx.client?.id ?? null };
}
