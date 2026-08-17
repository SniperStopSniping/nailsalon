/**
 * Communication dispatcher — the shared-sender delivery core.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §7.4,
 * §9.4, §10.9, §11.
 *
 * Per-intent pipeline (invariants I1-I9 from the Gate B design review):
 *
 *   claim (lease)
 *   → render + segments + destination + MODE resolution
 *   → TX1: reserve credits + INSERT delivery(settlement_state='settling')
 *          + intent → 'sending'                        [COMMIT before provider]
 *   → FINAL pre-provider check — a FRESH read after TX1: platform control
 *     (UNCACHED), per-event disable, global suppression, salon consent,
 *     rate limits, notAfter. STOP/kill-switch committed before this check
 *     prevents the send (release + suppress); provider acceptance first
 *     means the accepted message stands and the change affects subsequent
 *     sends. No retroactive recall exists.
 *   → provider call (INJECTED — Gate B ships no Twilio import here; tests
 *     and future Gate C wiring supply it)
 *      ├─ sync throw  → release reservation, delivery canceled/not_applicable,
 *      │                intent 'failed'
 *      └─ SID         → TX2: record SID + settle-on-accept (B1) + delivery
 *                       settlement_state 'settled', intent 'sent'
 *
 * DARK BY CONSTRUCTION: the shared sender requires COMMUNICATIONS_SMS_ENABLED,
 * the platform control row (ships disabled), the pilot allowlist when
 * enabled, AND a live credit balance. BYO intents are out of scope for this
 * dispatcher in Gate B (call-site migration is Gate C); the live BYO path in
 * SMS.ts is untouched.
 */

import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, isNull, or, sql } from 'drizzle-orm';

import {
  reapExpiredReservations,
  refundTerminalFailure,
  releaseReservation,
  reserveSmsCredits,
  settleReservationOnAccept,
} from '@/libs/billing/creditReservation';
import {
  claimDueIntents,
  expireStaleIntents,
  recoverExpiredLeases,
  transitionIntent,
} from '@/libs/communicationIntent';
import { checkSharedSendRateLimits } from '@/libs/communicationRateLimit.server';
import { COMMUNICATION_TEMPLATES } from '@/libs/communicationTemplates';
import { db } from '@/libs/DB';
import { readCommunicationControlUncached } from '@/libs/platformCommunicationControl';
import { hasGlobalSuppression, normalizeConsentRecipient } from '@/libs/smsConsentShared';
import { resolveSmsDestination } from '@/libs/smsDestination';
import { calculateSmsSegments } from '@/libs/smsSegments';
import {
  readSharedSenderEnvConfig,
  resolveSharedSenderReadiness,
} from '@/libs/smsSender';
import {
  communicationConsentSchema,
  type CommunicationIntent,
  communicationIntentSchema,
  notificationDeliverySchema,
  salonSchema,
} from '@/models/Schema';

/**
 * Gate C's provider wiring throws THIS when the send outcome is ambiguous
 * (timeout/connection-drop after the request may have reached Twilio). The
 * dispatcher then parks the intent as send_outcome_unknown — never released,
 * never resent — for the §7.5 reconciliation to resolve. A plain throw stays
 * a proven synchronous rejection (release, no debit).
 */
export class ProviderOutcomeUnknownError extends Error {
  constructor(message = 'PROVIDER_OUTCOME_UNKNOWN') {
    super(message);
    this.name = 'ProviderOutcomeUnknownError';
  }
}

export type ProviderSendFn = (input: {
  to: string;
  body: string;
  messagingServiceSid: string;
  statusCallbackUrl: string | null;
}) => Promise<{ sid: string }>;

export type DispatchSummary = {
  claimed: number;
  sent: number;
  suppressed: number;
  blockedNoCredit: number;
  failed: number;
  deferred: number;
  expired: number;
  leaseRecovered: number;
  unknownOutcome: number;
};

async function hasSalonTransactionalConsent(salonId: string, recipient: string): Promise<boolean> {
  const rows = await db
    .select({ status: communicationConsentSchema.status })
    .from(communicationConsentSchema)
    .where(and(
      eq(communicationConsentSchema.salonId, salonId),
      eq(communicationConsentSchema.recipient, normalizeConsentRecipient(recipient)),
      eq(communicationConsentSchema.channel, 'sms'),
      eq(communicationConsentSchema.purpose, 'appointment_transactional'),
    ))
    .orderBy(sql`${communicationConsentSchema.createdAt} DESC`)
    .limit(1);
  return rows[0]?.status === 'granted';
}

async function deferIntent(intentId: string, reason: string, now: Date): Promise<void> {
  await db
    .update(communicationIntentSchema)
    .set({
      status: 'pending',
      lockedBy: null,
      leaseExpiresAt: null,
      availableAt: new Date(now.getTime() + 5 * 60 * 1000),
      lastError: reason,
    })
    .where(and(
      eq(communicationIntentSchema.id, intentId),
      eq(communicationIntentSchema.status, 'claimed'),
    ));
}

/**
 * Process one claimed SMS intent through the full pipeline. Exported for
 * tests; the cron route drives it through processDueCommunications.
 */
export async function dispatchClaimedIntent(
  intent: CommunicationIntent,
  providerSend: ProviderSendFn,
  now = new Date(),
): Promise<'sent' | 'suppressed' | 'blocked_no_credit' | 'failed' | 'deferred' | 'expired' | 'unknown_outcome'> {
  if (intent.notAfter.getTime() <= now.getTime()) {
    await transitionIntent(intent.id, { to: 'expired', lastError: 'NOT_AFTER_ELAPSED' }, now);
    return 'expired';
  }

  // Render from the controlled template registry.
  const template = Object.hasOwn(COMMUNICATION_TEMPLATES, intent.templateKey)
    ? COMMUNICATION_TEMPLATES[intent.templateKey]
    : undefined;
  if (template === undefined) {
    await transitionIntent(intent.id, { to: 'failed', lastError: 'UNKNOWN_TEMPLATE' }, now);
    return 'failed';
  }
  const salonRows = await db
    .select({ name: salonSchema.name, slug: salonSchema.slug, isActive: salonSchema.isActive })
    .from(salonSchema)
    .where(eq(salonSchema.id, intent.salonId))
    .limit(1);
  const salon = salonRows[0];
  if (salon === undefined || salon.isActive === false) {
    await transitionIntent(intent.id, { to: 'suppressed', lastError: 'SALON_INACTIVE' }, now);
    return 'suppressed';
  }
  const body = template.render({ ...intent.variables, salonName: salon.name });
  const segmentation = calculateSmsSegments(body);

  // Destination policy (explicit stored country; +1 is not proof of Canada).
  const destination = resolveSmsDestination({
    rawPhone: intent.recipient,
    storedCountry: intent.destinationCountry,
  });
  if (!destination.supported) {
    await transitionIntent(intent.id, { to: 'suppressed', lastError: `DESTINATION_NOT_SUPPORTED:${destination.detail}` }, now);
    return 'suppressed';
  }

  // Mode + shared readiness (env + platform control + pilot + credits-capability).
  const control = await readCommunicationControlUncached();
  const envConfig = readSharedSenderEnvConfig();
  const readiness = resolveSharedSenderReadiness({
    salonSlug: salon.slug,
    config: {
      ...envConfig,
      platformControl: control === null ? null : { smsEnabled: control.smsEnabled },
      creditReservation: { available: true },
    },
  });
  if (!readiness.ready) {
    if (readiness.reason === 'GLOBAL_SMS_DISABLED' || readiness.reason === 'SENDER_NOT_READY') {
      // Kill switches hold, never destroy, queued evidence.
      await deferIntent(intent.id, `KILL_SWITCH:${readiness.reason}`, now);
      return 'deferred';
    }
    await transitionIntent(intent.id, { to: 'suppressed', lastError: readiness.reason }, now);
    return 'suppressed';
  }
  if (control !== null && (control.disabledEventTypes ?? []).includes(intent.eventType)) {
    await deferIntent(intent.id, 'KILL_SWITCH:EVENT_DISABLED', now);
    return 'deferred';
  }

  // Rate limits — sends degrade CLOSED (defer, never send unenforced).
  const rate = await checkSharedSendRateLimits({
    salonId: intent.salonId,
    recipient: destination.e164,
  });
  if (!rate.allowed) {
    await deferIntent(intent.id, `RATE_LIMITED:${rate.reason}`, now);
    return 'deferred';
  }

  // TX1: reserve + delivery(settling) + intent→sending, committed BEFORE the
  // provider call (invariant I1).
  const reservation = await reserveSmsCredits({
    salonId: intent.salonId,
    dedupeKey: `${intent.dedupeKey}:r${intent.attempts}`,
    segments: segmentation.segments,
    now,
  });
  if (!reservation.ok) {
    await transitionIntent(intent.id, {
      to: 'blocked_no_credit',
      blockedReason: 'NO_CREDITS',
      requiredCredits: reservation.required,
    }, now);
    return 'blocked_no_credit';
  }

  const deliveryId = `nd_${crypto.randomUUID()}`;
  const bodyFingerprint = createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 32);
  // The attempt-scoped delivery dedupe key doubles as the same-intent race
  // gate: two dispatchers holding the same claimed row (double invocation of
  // one claim, not a double claim) resolve HERE — only the inserter
  // proceeds. The loser must touch NOTHING on the way out: its reservation
  // is dedupe-shared with the winner, so releasing it would strip the
  // winner's held credits mid-send.
  const insertedDelivery = await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: intent.salonId,
    appointmentId: intent.appointmentId,
    channel: 'sms',
    purpose: `intent:${intent.eventType}`,
    dedupeKey: `delivery:${intent.dedupeKey}:r${intent.attempts}`,
    status: 'queued',
    retryable: false,
    intentId: intent.id,
    creditReservationId: reservation.reservationId,
    segmentCount: segmentation.segments,
    encoding: segmentation.encoding,
    senderIdentity: readiness.senderIdentity,
    messagingServiceSid: readiness.messagingServiceSid,
    settlementState: 'settling',
    statusRank: 0,
  }).onConflictDoNothing().returning();
  if (insertedDelivery.length === 0) {
    return 'failed';
  }
  const toSending = await transitionIntent(intent.id, {
    to: 'sending',
    deliveryId,
    creditReservationId: reservation.reservationId,
    bodySnapshot: body,
    bodyFingerprint,
    segmentCount: segmentation.segments,
    encoding: segmentation.encoding,
  }, now);
  if (!toSending.applied) {
    // Either genuine supersession (canceled/suppressed between claim and
    // here) or a lease-recovered duplicate whose winner re-reserved under a
    // HIGHER attempt key. Release our hold unless the winner's send is
    // literally using OUR reservation — status alone is not enough, because
    // a recovered intent's winner holds a different reservation and ours
    // would otherwise leak forever.
    const [fresh] = await db
      .select({
        status: communicationIntentSchema.status,
        creditReservationId: communicationIntentSchema.creditReservationId,
      })
      .from(communicationIntentSchema)
      .where(eq(communicationIntentSchema.id, intent.id))
      .limit(1);
    const winnerOwnsOurReservation
      = fresh !== undefined
      && (fresh.status === 'sending' || fresh.status === 'sent')
      && fresh.creditReservationId === reservation.reservationId;
    if (!winnerOwnsOurReservation) {
      await releaseReservation({ reservationId: reservation.reservationId, reason: 'INTENT_SUPERSEDED', now });
      await db
        .update(notificationDeliverySchema)
        .set({ status: 'canceled', settlementState: 'not_applicable' })
        .where(eq(notificationDeliverySchema.id, deliveryId));
    }
    return 'failed';
  }

  // FINAL pre-provider check (invariant I2): FRESH reads after TX1 committed.
  const finalControl = await readCommunicationControlUncached();
  const finalSuppressed = await hasGlobalSuppression(readiness.senderIdentity, destination.e164);
  const finalConsent = await hasSalonTransactionalConsent(intent.salonId, intent.recipient);
  if (
    finalControl === null
    || !finalControl.smsEnabled
    || (finalControl.disabledEventTypes ?? []).includes(intent.eventType)
    || finalSuppressed
    || !finalConsent
    || intent.notAfter.getTime() <= now.getTime()
  ) {
    await releaseReservation({ reservationId: reservation.reservationId, reason: 'FINAL_CHECK_STOPPED', now });
    await db
      .update(notificationDeliverySchema)
      .set({ status: 'canceled', settlementState: 'not_applicable' })
      .where(eq(notificationDeliverySchema.id, deliveryId));
    await transitionIntent(intent.id, { to: 'suppressed', lastError: 'FINAL_CHECK_STOPPED' }, now);
    return 'suppressed';
  }

  // Provider call — OUTSIDE any transaction.
  let sid: string;
  try {
    const result = await providerSend({
      to: destination.e164,
      body,
      messagingServiceSid: readiness.messagingServiceSid,
      // Delivery identity in the callback (§6.10): a signed status callback
      // carrying this id is the §7.5 evidence that lets the resolver adopt a
      // SID onto an unknown-outcome intent.
      statusCallbackUrl: (await import('@/libs/twilioMessagingSend')).buildStatusCallbackUrl(deliveryId),
    });
    sid = result.sid;
  } catch (error) {
    if (error instanceof ProviderOutcomeUnknownError) {
      // The request MAY have reached the provider: park, never release,
      // never resend (§7.5). Reconciliation settles or releases on proof.
      await transitionIntent(intent.id, { to: 'send_outcome_unknown', lastError: 'PROVIDER_OUTCOME_UNKNOWN' }, now);
      return 'unknown_outcome';
    }
    await releaseReservation({ reservationId: reservation.reservationId, reason: 'PROVIDER_SYNC_REJECT', now });
    await db
      .update(notificationDeliverySchema)
      .set({
        status: 'failed',
        settlementState: 'not_applicable',
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'PROVIDER_ERROR',
      })
      .where(eq(notificationDeliverySchema.id, deliveryId));
    await transitionIntent(intent.id, { to: 'failed', lastError: 'PROVIDER_SYNC_REJECT' }, now);
    return 'failed';
  }

  // TX2: SID + settle-on-accept (idempotent; invariant I3). The accepted
  // write is rank-fenced: a terminal callback that raced in ahead of us must
  // never be regressed to 'accepted'.
  await db
    .update(notificationDeliverySchema)
    .set({ providerMessageId: sid, status: 'accepted', statusRank: 20 })
    .where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      or(
        isNull(notificationDeliverySchema.statusRank),
        sql`${notificationDeliverySchema.statusRank} < 20`,
      ),
    ));
  await settleReservationOnAccept({ reservationId: reservation.reservationId, providerSid: sid, now });
  await db
    .update(notificationDeliverySchema)
    .set({ settlementState: 'settled', settledAt: now })
    .where(and(
      eq(notificationDeliverySchema.id, deliveryId),
      eq(notificationDeliverySchema.settlementState, 'settling'),
    ));
  // Close the accept→settle window from THIS side: a terminal callback that
  // landed inside it saw settlement 'settling' and skipped its refund; its
  // rank fence means it will never fire again. Re-check now that we are
  // settled and pay the refund the callback could not.
  const [postSettle] = await db
    .select({
      status: notificationDeliverySchema.status,
      settlementState: notificationDeliverySchema.settlementState,
    })
    .from(notificationDeliverySchema)
    .where(eq(notificationDeliverySchema.id, deliveryId))
    .limit(1);
  if (
    postSettle !== undefined
    && ['failed', 'undelivered', 'canceled'].includes(postSettle.status)
    && postSettle.settlementState === 'settled'
  ) {
    await refundTerminalFailure({ reservationId: reservation.reservationId, now });
    await db
      .update(notificationDeliverySchema)
      .set({ settlementState: 'refunded' })
      .where(and(
        eq(notificationDeliverySchema.id, deliveryId),
        eq(notificationDeliverySchema.settlementState, 'settled'),
      ));
  }
  await transitionIntent(intent.id, { to: 'sent' }, now);
  return 'sent';
}

/**
 * Email lane send function — injected exactly like ProviderSendFn so tests
 * never touch a real mail provider. The production implementation wraps the
 * repo's idempotent operational-email helper; it MUST be internally
 * idempotent on the intent id, because the email lane relies on that (not on
 * credit reservations, which email deliberately does not have — §3.6).
 */
export type EmailSendFn = (input: {
  intentId: string;
  salonId: string;
  appointmentId: string | null;
  recipient: string;
  subject: string;
  body: string;
}) => Promise<{ delivered: boolean }>;

/**
 * Minimal email dispatch (blueprint H1): no credits, no SMS consent gates,
 * no rate-limit CLOSED posture — email is not SMS (§3.6). The salon kill
 * switch and per-event toggles were already applied at MATERIALIZATION time,
 * and a canceled appointment cancels its intents, so the only pre-send gates
 * here are template resolution and the notAfter recheck the claim query
 * already performed.
 */
async function dispatchClaimedEmailIntent(
  intent: CommunicationIntent,
  emailSend: EmailSendFn,
  now: Date,
): Promise<'sent' | 'failed'> {
  const { getEmailTemplate } = await import('@/libs/communicationEmailTemplates');
  const template = getEmailTemplate(intent.templateKey);
  if (template === null) {
    await transitionIntent(intent.id, { to: 'failed', lastError: 'TEMPLATE_UNKNOWN' }, now);
    return 'failed';
  }
  const variables = (intent.variables ?? {}) as Record<string, string>;
  const subject = template.subject(variables);
  const body = template.body(variables);
  // A real delivery row: intent.delivery_id carries an FK, and the history
  // surface (C4) reads email sends from the same table as everything else.
  // Idempotent on the intent-scoped dedupe key, exactly like the SMS lane.
  const deliveryId = `nd_${crypto.randomUUID()}`;
  const insertedDelivery = await db.insert(notificationDeliverySchema).values({
    id: deliveryId,
    salonId: intent.salonId,
    appointmentId: intent.appointmentId,
    channel: 'email',
    purpose: intent.eventType,
    dedupeKey: `intent:${intent.id}:email`,
    status: 'queued',
    intentId: intent.id,
    encoding: 'email',
  }).onConflictDoNothing({ target: notificationDeliverySchema.dedupeKey }).returning();
  const effectiveDeliveryId = insertedDelivery.length === 1
    ? deliveryId
    : (await db.select({ id: notificationDeliverySchema.id })
        .from(notificationDeliverySchema)
        .where(eq(notificationDeliverySchema.dedupeKey, `intent:${intent.id}:email`))
        .limit(1))[0]!.id;
  const moved = await transitionIntent(intent.id, {
    to: 'sending',
    deliveryId: effectiveDeliveryId,
    creditReservationId: null,
    bodySnapshot: body,
    bodyFingerprint: '',
    segmentCount: 0,
    encoding: 'email',
  }, now);
  if (!moved.applied) {
    return 'failed';
  }
  try {
    await emailSend({
      intentId: intent.id,
      salonId: intent.salonId,
      appointmentId: intent.appointmentId,
      recipient: intent.recipient,
      subject,
      body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : 'EMAIL_SEND_FAILED';
    await db.update(notificationDeliverySchema)
      .set({ status: 'failed', errorMessage: message })
      .where(eq(notificationDeliverySchema.id, effectiveDeliveryId));
    await transitionIntent(intent.id, { to: 'failed', lastError: message }, now);
    return 'failed';
  }
  await db.update(notificationDeliverySchema)
    .set({ status: 'sent' })
    .where(eq(notificationDeliverySchema.id, effectiveDeliveryId));
  await transitionIntent(intent.id, { to: 'sent' }, now);
  return 'sent';
}

/** One dispatcher pass: housekeeping → claim → per-intent pipeline. */
export async function processDueCommunications(input: {
  workerId: string;
  providerSend: ProviderSendFn;
  /**
   * Optional until the cron route wires the production implementation —
   * absent, email intents fail closed with EMAIL_LANE_NOT_WIRED rather than
   * silently vanishing.
   */
  emailSend?: EmailSendFn;
  now?: Date;
}): Promise<DispatchSummary> {
  const now = input.now ?? new Date();
  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    suppressed: 0,
    blockedNoCredit: 0,
    failed: 0,
    deferred: 0,
    expired: 0,
    leaseRecovered: 0,
    unknownOutcome: 0,
  };

  const leases = await recoverExpiredLeases(now);
  summary.leaseRecovered = leases.recovered;
  summary.unknownOutcome = leases.unknownOutcome;
  summary.expired += (await expireStaleIntents(now)).expired;
  // Release clearly pre-send abandoned holds (§7.6) — without this sweep a
  // crashed worker's reservation would suppress the salon's balance forever.
  await reapExpiredReservations(now);

  const control = await readCommunicationControlUncached();
  const batchLimit = control?.dispatchBatchLimit ?? 100;
  const perSalonLimit = control?.perSalonBatchLimit ?? 1;

  const intents = await claimDueIntents({
    workerId: input.workerId,
    batchLimit,
    perSalonLimit,
    now,
  });
  summary.claimed = intents.length;

  for (const intent of intents) {
    if (intent.channel === 'email') {
      if (input.emailSend === undefined) {
        await transitionIntent(intent.id, { to: 'failed', lastError: 'EMAIL_LANE_NOT_WIRED' }, now);
        summary.failed += 1;
        continue;
      }
      const emailOutcome = await dispatchClaimedEmailIntent(intent, input.emailSend, now);
      if (emailOutcome === 'sent') {
        summary.sent += 1;
      } else {
        summary.failed += 1;
      }
      continue;
    }
    if (intent.channel !== 'sms') {
      await transitionIntent(intent.id, { to: 'failed', lastError: 'CHANNEL_NOT_IMPLEMENTED' }, now);
      summary.failed += 1;
      continue;
    }
    const outcome = await dispatchClaimedIntent(intent, input.providerSend, now);
    switch (outcome) {
      case 'sent': {
        summary.sent += 1;
        break;
      }
      case 'suppressed': {
        summary.suppressed += 1;
        break;
      }
      case 'blocked_no_credit': {
        summary.blockedNoCredit += 1;
        break;
      }
      case 'failed': {
        summary.failed += 1;
        break;
      }
      case 'deferred': {
        summary.deferred += 1;
        break;
      }
      case 'expired': {
        summary.expired += 1;
        break;
      }
      case 'unknown_outcome': {
        summary.unknownOutcome += 1;
        break;
      }
    }
  }
  return summary;
}
