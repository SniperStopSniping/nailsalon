/**
 * B2 dispatcher — PGlite proofs for the intent pipeline: dark-by-default,
 * final pre-provider check, settle-on-accept wiring, blocked_no_credit,
 * lease recovery, notAfter, supersession and top-up release.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  COMMUNICATIONS_SMS_ENABLED: 'true' as string | undefined,
  TWILIO_MESSAGING_SERVICE_SID: 'MG11111111111111111111111111111111' as string | undefined,
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000' as string | undefined,
  TWILIO_AUTH_TOKEN: 'token' as string | undefined,
  LUSTER_SMS_SENDER_IDENTITY: undefined as string | undefined,
  SMS_PILOT_ENABLED: undefined as string | undefined,
  SMS_PILOT_SALON_ALLOWLIST: undefined as string | undefined,
  LUSTER_SHORT_LINK_ORIGIN: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_SECRET: undefined as string | undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined as number | undefined,
}));

vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const rateHolder = vi.hoisted(() => ({
  result: { allowed: true } as { allowed: true } | { allowed: false; reason: string },
}));

vi.mock('@/libs/communicationRateLimit.server', () => ({
  checkSharedSendRateLimits: vi.fn(async () => rateHolder.result),
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

const NOW = new Date('2026-08-17T12:00:00.000Z');

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

beforeEach(() => {
  rateHolder.result = { allowed: true };
  envHolder.COMMUNICATIONS_SMS_ENABLED = 'true';
  envHolder.SMS_PILOT_ENABLED = undefined;
});

let salonSeq = 0;

async function seedSalonWithConsent(): Promise<{ salonId: string; recipient: string }> {
  salonSeq += 1;
  const salonId = `sd_${salonSeq}`;
  const recipient = `416555${String(1000 + salonSeq)}`;
  await db.insert(schema.salonSchema).values({
    id: salonId,
    settings: { communications: { sms: { enabled: true }, quietHours: { enabled: false, start: '21:00', end: '09:00' } } } as schema.Salon['settings'],
    name: `Dispatch Salon ${salonSeq}`,
    slug: `dispatch-salon-${salonSeq}`,
  });
  await db.insert(schema.communicationConsentSchema).values({
    id: `cc_${salonId}`,
    salonId,
    recipient,
    channel: 'sms',
    purpose: 'appointment_transactional',
    status: 'granted',
    wordingVersion: 'test-v1',
    source: 'test',
    grantedAt: NOW,
  });
  return { salonId, recipient };
}

async function seedVoiceLinkWithoutBroadConsent() {
  salonSeq += 1;
  const salonId = `voice_link_${salonSeq}`;
  const recipient = `416555${String(1000 + salonSeq)}`;
  await db.insert(schema.salonSchema).values({
    id: salonId,
    name: 'Synthetic Isla',
    slug: `synthetic-isla-${salonSeq}`,
    settings: { communications: { sms: { enabled: true }, quietHours: { enabled: false, start: '21:00', end: '09:00' } } } as schema.Salon['settings'],
  });
  const callId = crypto.randomUUID();
  await db.insert(schema.voiceCallSchema).values({
    id: callId,
    salonId,
    provider: 'twilio',
    providerCallId: `CAvoice-link-${callId}`,
    routeTokenHash: `hash-${callId}`,
    routeExpiresAt: new Date(NOW.getTime() + 60_000),
    status: 'completed',
    endedAt: new Date(NOW.getTime() - 60_000),
  });
  const queued = await enqueueSmsIntent(salonId, recipient, {
    eventType: 'voice_booking_link',
    templateKey: 'client_voice_booking_link',
    templateVersion: 'v1',
    variables: { bookingUrl: `https://www.lustergel.app/en/synthetic-isla-${salonSeq}/book/service`, callId },
  });
  const { voiceBookingLinkRecipientHash } = await import('./voiceReceptionist/bookingLink.server');
  await db.update(schema.voiceCallSchema).set({ draft: { bookingLinkAuthority: { intentId: queued.intentId, recipientHash: voiceBookingLinkRecipientHash(recipient) } } })
    .where(eq(schema.voiceCallSchema.id, callId));
  return { salonId, recipient };
}

async function grantCredits(salonId: string, amount: number) {
  const { appendLotGrant, lockCreditAccount } = await import('./billing/creditLedger');
  await db.transaction(async (tx) => {
    await lockCreditAccount(tx, salonId);
    await appendLotGrant(tx, {
      salonId,
      bucket: 'purchased',
      amount,
      expiresAt: null,
      idempotencyKey: `seed_${salonId}`,
      reason: 'seed',
    });
  });
}

async function enableControl(enabled: boolean) {
  await db.execute(sql`UPDATE platform_communication_control SET sms_enabled = ${enabled} WHERE id = 'singleton'`);
  const { __clearCommunicationControlCache } = await import('./platformCommunicationControl');
  __clearCommunicationControlCache();
}

async function enqueueSmsIntent(salonId: string, recipient: string, overrides: Partial<Parameters<typeof import('./communicationIntent')['enqueueCommunicationIntent']>[0]> = {}) {
  const { enqueueCommunicationIntent } = await import('./communicationIntent');
  return enqueueCommunicationIntent({
    salonId,
    channel: 'sms',
    eventType: 'booking_confirmation',
    audience: 'client',
    dedupeKey: overrides.dedupeKey ?? `sms:test:${salonId}:${crypto.randomUUID()}`,
    recipient,
    destinationCountry: 'CA',
    templateKey: 'client_booking_confirmation_shortlink',
    templateVersion: 'v1',
    variables: { startTime: 'Wed Aug 26, 12:30 PM', manageUrl: 'https://islanailsalon.com/a/AbCdEfGhIjKlMnOpQrStUv' },
    schedulingRevision: 'rev1',
    scheduledFor: NOW,
    notAfter: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
    ...overrides,
  });
}

async function claimOne(salonId: string): Promise<schema.CommunicationIntent> {
  const { claimDueIntents } = await import('./communicationIntent');
  const claimed = await claimDueIntents({ workerId: 'w1', batchLimit: 50, perSalonLimit: 1, now: NOW });
  const mine = claimed.find(row => row.salonId === salonId);

  expect(mine).toBeDefined();

  return mine!;
}

async function enqueueRecoveryIntent(input: { salonId: string; recipient: string; appointmentId: string; dedupeKey: string; clientId?: string }) {
  return enqueueSmsIntent(input.salonId, input.recipient, {
    appointmentId: input.appointmentId,
    eventType: 'booking_recovery',
    dedupeKey: input.dedupeKey,
    templateKey: 'client_booking_recovery_shortlink',
    templateVersion: 'v1',
    variables: { ...(input.clientId ? { clientId: input.clientId } : {}), manageUrl: 'pending' },
  });
}

async function seedRecoveryAppointment(input: { salonId: string; recipient: string; status?: 'pending' | 'confirmed' | 'awaiting_payment' | 'cancelled' | 'completed'; endTime?: Date }) {
  const id = `recovery_${input.salonId}_${crypto.randomUUID()}`;
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId: input.salonId,
    clientName: 'Recovery Client',
    clientPhone: input.recipient,
    startTime: new Date(NOW.getTime() - 30 * 60 * 1000),
    endTime: input.endTime ?? new Date(NOW.getTime() + 60 * 60 * 1000),
    status: input.status ?? 'confirmed',
    totalPrice: 50,
    totalDurationMinutes: 60,
  });
  return id;
}

describe('dispatcher — dark by default, live only behind every switch', () => {
  it('sends a requested voice link with one-time call authority and no broad appointment consent, while honoring STOP', async () => {
    const previousSecret = process.env.VOICE_RECEPTIONIST_SIGNING_SECRET;
    process.env.VOICE_RECEPTIONIST_SIGNING_SECRET = 's'.repeat(40);
    try {
      const first = await seedVoiceLinkWithoutBroadConsent();
      await grantCredits(first.salonId, 10);
      await enableControl(true);
      const provider = vi.fn(async (_input: { to: string }) => ({ sid: 'SM_voice_link' }));
      const { dispatchClaimedIntent } = await import('./communicationDispatcher');

      expect(await dispatchClaimedIntent(await claimOne(first.salonId), provider, NOW)).toBe('sent');
      expect(provider).toHaveBeenCalledOnce();
      expect(provider.mock.calls[0]![0]).toMatchObject({ to: `+1${first.recipient}` });

      const second = await seedVoiceLinkWithoutBroadConsent();
      await grantCredits(second.salonId, 10);
      await db.insert(schema.communicationConsentSchema).values({
        id: `voice-stop-${second.salonId}`,
        salonId: second.salonId,
        recipient: second.recipient,
        channel: 'sms',
        purpose: 'appointment_transactional',
        status: 'revoked',
        wordingVersion: 'provider-stop',
        source: 'twilio_inbound',
        revokedAt: NOW,
      });

      expect(await dispatchClaimedIntent(await claimOne(second.salonId), provider, NOW)).toBe('suppressed');
      expect(provider).toHaveBeenCalledOnce();
    } finally {
      if (previousSecret === undefined) {
        delete process.env.VOICE_RECEPTIONIST_SIGNING_SECRET;
      } else {
        process.env.VOICE_RECEPTIONIST_SIGNING_SECRET = previousSecret;
      }
    }
  });

  it('waits for the call to end and suppresses a link whose authority was revoked', async () => {
    const previousSecret = process.env.VOICE_RECEPTIONIST_SIGNING_SECRET;
    process.env.VOICE_RECEPTIONIST_SIGNING_SECRET = 's'.repeat(40);
    try {
      const { salonId } = await seedVoiceLinkWithoutBroadConsent();
      const [intent] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.salonId, salonId));
      const callId = intent!.variables.callId!;
      await db.update(schema.voiceCallSchema).set({ status: 'connected', endedAt: null }).where(eq(schema.voiceCallSchema.id, callId));
      await enableControl(true);
      const provider = vi.fn();
      const { dispatchClaimedIntent } = await import('./communicationDispatcher');

      expect(await dispatchClaimedIntent(await claimOne(salonId), provider, NOW)).toBe('deferred');
      expect(provider).not.toHaveBeenCalled();

      await db.update(schema.voiceCallSchema).set({ status: 'completed', endedAt: new Date(NOW.getTime() - 60_000), draft: { bookingLinkAuthority: null } }).where(eq(schema.voiceCallSchema.id, callId));
      const { claimDueIntents } = await import('./communicationIntent');
      const retry = (await claimDueIntents({ workerId: 'voice-link-retry', batchLimit: 50, perSalonLimit: 1, now: new Date(NOW.getTime() + 61_000) })).find(row => row.salonId === salonId);

      expect(retry).toBeDefined();
      expect(await dispatchClaimedIntent(retry!, provider, new Date(NOW.getTime() + 61_000))).toBe('suppressed');
      expect(provider).not.toHaveBeenCalled();
    } finally {
      if (previousSecret === undefined) {
        delete process.env.VOICE_RECEPTIONIST_SIGNING_SECRET;
      } else {
        process.env.VOICE_RECEPTIONIST_SIGNING_SECRET = previousSecret;
      }
    }
  });

  it('defers (never sends, never destroys) when the platform control row is disabled', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await grantCredits(salonId, 10);
    await enableControl(false);
    await enqueueSmsIntent(salonId, recipient);
    const intent = await claimOne(salonId);
    const providerSend = vi.fn();
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const outcome = await dispatchClaimedIntent(intent, providerSend, NOW);

    expect(outcome).toBe('deferred');
    expect(providerSend).not.toHaveBeenCalled();

    const row = await db.execute(sql`SELECT status FROM communication_intent WHERE id = ${intent.id}`);

    expect((row.rows[0] as Record<string, unknown>).status).toBe('pending');
  });

  it('sends through the full pipeline when every switch is on: settle-on-accept, one debit, intent sent', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueSmsIntent(salonId, recipient);
    const intent = await claimOne(salonId);
    const providerSend = vi.fn(async (_input: { to: string; messagingServiceSid: string | null }) => ({ sid: 'SM_pipeline_1' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const outcome = await dispatchClaimedIntent(intent, providerSend, NOW);

    expect(outcome).toBe('sent');
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(providerSend.mock.calls[0]![0]).toMatchObject({
      messagingServiceSid: 'MG11111111111111111111111111111111',
      to: `+1${recipient}`,
    });

    const debits = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = ${salonId} AND entry_type = 'debit'
    `);

    expect(Number((debits.rows[0] as Record<string, unknown>).n)).toBe(1);

    const delivery = await db.execute(sql`
      SELECT settlement_state, provider_message_id FROM notification_delivery WHERE intent_id = ${intent.id}
    `);

    expect(delivery.rows[0]).toMatchObject({ settlement_state: 'settled', provider_message_id: 'SM_pipeline_1' });
  });

  it.each([
    ['booking_confirmation', 'client_booking_confirmation_shortlink'],
    ['appointment_reminder', 'client_appointment_reminder_shortlink'],
    ['appointment_rescheduled', 'client_appointment_rescheduled_shortlink'],
    ['appointment_cancelled', 'client_appointment_cancelled_shortlink'],
    ['manual_text', 'client_manual_text'],
  ] as const)('sends and charges the exact final %s text without changing its footer category', async (eventType, templateKey) => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await grantCredits(salonId, 10);
    await enableControl(true);
    const variables = { startTime: 'Wed, Sep 23, 12:30 PM', manageUrl: 'https://lustergel.app/a/AbCdEfGhIjKlMnOpQrStUv', message: 'Your appointment details have been updated.' };
    const overrides: Partial<Parameters<typeof import('./communicationIntent')['enqueueCommunicationIntent']>[0]> = {};
    if (eventType === 'appointment_reminder') {
      const { resolveCommunicationSettingsFromSettings } = await import('./communicationSettings');
      const { computeSchedulingRevision } = await import('./communicationScheduling');
      const [salon] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, salonId));
      const settings = resolveCommunicationSettingsFromSettings(salon!.settings);
      const rule = settings.reminders.rules[0]!;
      const startTime = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
      const technicianId = `tech_${salonId}`;
      await db.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Daniela Santos' });
      const [appointment] = await db.insert(schema.appointmentSchema).values({
        id: `exact_reminder_${salonId}`,
        salonId,
        technicianId,
        clientName: 'Test Client',
        clientPhone: recipient,
        startTime,
        endTime: new Date(startTime.getTime() + 3600000),
        status: 'confirmed',
        totalPrice: 50,
        totalDurationMinutes: 60,
      }).returning();
      overrides.appointmentId = appointment!.id;
      overrides.ruleId = rule.id;
      overrides.schedulingRevision = computeSchedulingRevision({ timeZone: salon!.settings?.booking?.timezone, quietHours: settings.quietHours, rule, appointmentStart: startTime, appointmentUpdatedAt: appointment!.updatedAt, smsEnabled: settings.sms.enabled, emailEnabled: settings.email.enabled });
    }
    await enqueueSmsIntent(salonId, recipient, { eventType, templateKey, variables, ...overrides });
    const intent = await claimOne(salonId);
    const provider = vi.fn(async (_input: { body: string }) => ({ sid: `SM_exact_${salonId}` }));
    const { COMMUNICATION_TEMPLATES } = await import('./communicationTemplates');
    const { prepareSmsBody } = await import('./smsSegments');
    const prepared = prepareSmsBody(COMMUNICATION_TEMPLATES[templateKey]!.render({
      ...variables,
      salonName: `Dispatch Salon ${salonSeq}`,
      ...(eventType === 'appointment_reminder' ? { clientName: 'Test Client', technicianName: 'Daniela Santos' } : {}),
    }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, NOW)).toBe('sent');
    expect(provider.mock.calls[0]![0].body).toBe(prepared.finalBody);
    expect(prepared.finalBody.includes('Reply STOP to opt out.')).toBe(eventType === 'manual_text');

    const [stored] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, intent.id));
    const [reservation] = await db.select().from(schema.smsCreditReservationSchema).where(eq(schema.smsCreditReservationSchema.id, stored!.creditReservationId!));

    expect(stored).toMatchObject({ bodySnapshot: prepared.finalBody, encoding: prepared.segmentation.encoding, segmentCount: prepared.predictedCredits });
    expect(reservation!.segments).toBe(prepared.predictedCredits);
    expect(prepared.predictedCredits).toBe(1);
  });

  it('a pre-committed global STOP is caught by the final pre-provider check: released, suppressed, provider never called', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await grantCredits(salonId, 10);
    await enableControl(true);
    const { appendGlobalConsentEvent } = await import('./smsConsentShared');
    await appendGlobalConsentEvent({
      senderIdentity: 'luster_shared_v1',
      recipient,
      state: 'suppressed',
      source: 'operator',
    });
    await enqueueSmsIntent(salonId, recipient);
    const intent = await claimOne(salonId);
    const providerSend = vi.fn(async () => ({ sid: 'SM_never' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const outcome = await dispatchClaimedIntent(intent, providerSend, NOW);

    expect(outcome).toBe('suppressed');
    expect(providerSend).not.toHaveBeenCalled();

    const held = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM sms_credit_reservation WHERE salon_id = ${salonId} AND status = 'held'
    `);

    expect(Number((held.rows[0] as Record<string, unknown>).n)).toBe(0);

    const debits = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = ${salonId} AND entry_type = 'debit'
    `);

    expect(Number((debits.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('a STOP after acceptance suppresses only SUBSEQUENT sends — the accepted message stands, no refund', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueSmsIntent(salonId, recipient, { dedupeKey: `sms:first:${salonId}` });
    const first = await claimOne(salonId);
    const providerSend = vi.fn(async () => ({ sid: 'SM_stands' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(first, providerSend, NOW)).toBe('sent');

    const { appendGlobalConsentEvent } = await import('./smsConsentShared');
    await appendGlobalConsentEvent({
      senderIdentity: 'luster_shared_v1',
      recipient,
      state: 'suppressed',
      source: 'twilio_inbound',
    });
    await enqueueSmsIntent(salonId, recipient, { dedupeKey: `sms:second:${salonId}` });
    const second = await claimOne(salonId);

    expect(await dispatchClaimedIntent(second, providerSend, NOW)).toBe('suppressed');
    expect(providerSend).toHaveBeenCalledTimes(1);

    const refunds = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = ${salonId} AND entry_type = 'sms_refund'
    `);

    expect(Number((refunds.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('records blocked_no_credit with evidence and releases after a top-up ONLY while still relevant', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    await enqueueSmsIntent(salonId, recipient, { dedupeKey: `sms:blocked:${salonId}` });
    const intent = await claimOne(salonId);
    const providerSend = vi.fn();
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, providerSend, NOW)).toBe('blocked_no_credit');
    expect(providerSend).not.toHaveBeenCalled();

    const { releaseBlockedIntentsAfterTopup } = await import('./communicationIntent');
    const released = await releaseBlockedIntentsAfterTopup(salonId, NOW);

    expect(released.released).toBe(1);

    // A blocked intent past notAfter stays blocked forever as evidence.
    await enqueueSmsIntent(salonId, recipient, {
      dedupeKey: `sms:stale:${salonId}`,
      scheduledFor: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
      notAfter: new Date(NOW.getTime() + 60 * 1000),
    });
    const stale = await claimOne(salonId);

    expect(await dispatchClaimedIntent(stale, providerSend, NOW)).toBe('blocked_no_credit');

    const afterWindow = new Date(NOW.getTime() + 2 * 60 * 1000);
    const releasedLate = await releaseBlockedIntentsAfterTopup(salonId, afterWindow);

    expect(releasedLate.released).toBe(0);
  });

  it('provider sync-rejection releases with zero ledger rows and fails the intent', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueSmsIntent(salonId, recipient, { dedupeKey: `sms:reject:${salonId}` });
    const intent = await claimOne(salonId);
    const providerSend = vi.fn(async () => {
      throw new Error('PROVIDER_NOT_WIRED');
    });
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, providerSend, NOW)).toBe('failed');

    const entries = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = ${salonId} AND entry_type IN ('debit', 'sms_refund')
    `);

    expect(Number((entries.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('durably suppresses a shared recipient when Twilio rejects it as opted out', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueSmsIntent(salonId, recipient, { dedupeKey: `sms:provider-opt-out:${salonId}` });
    const intent = await claimOne(salonId);
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, vi.fn(async () => {
      throw Object.assign(new Error('Recipient opted out'), { code: 21610 });
    }), NOW)).toBe('failed');

    const suppression = await db.execute(sql`
      SELECT state, source, opt_out_type FROM sms_global_consent_event WHERE recipient = ${recipient}
    `);
    const delivery = await db.execute(sql`
      SELECT error_code, retryable FROM notification_delivery WHERE intent_id = ${intent.id}
    `);
    const storedIntent = await db.execute(sql`
      SELECT last_error FROM communication_intent WHERE id = ${intent.id}
    `);

    expect(suppression.rows[0]).toMatchObject({
      state: 'suppressed',
      source: 'twilio_advanced_opt_out',
      opt_out_type: 'STOP',
    });
    expect(delivery.rows[0]).toMatchObject({ error_code: '21610', retryable: false });
    expect(storedIntent.rows[0]).toMatchObject({ last_error: 'PROVIDER_OPT_OUT' });
  });

  it('rate-limit unavailability defers closed (never sends unenforced)', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await grantCredits(salonId, 10);
    await enableControl(true);
    rateHolder.result = { allowed: false, reason: 'LIMITER_UNAVAILABLE' };
    await enqueueSmsIntent(salonId, recipient, { dedupeKey: `sms:rate:${salonId}` });
    const intent = await claimOne(salonId);
    const providerSend = vi.fn();
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, providerSend, NOW)).toBe('deferred');
    expect(providerSend).not.toHaveBeenCalled();
  });
});

describe('intent lifecycle — leases, notAfter, supersession', () => {
  it('recovers claimed-past-lease to pending; sending-past-lease becomes send_outcome_unknown, never resent', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    const { enqueueCommunicationIntent, recoverExpiredLeases, claimDueIntents } = await import('./communicationIntent');

    await enqueueCommunicationIntent({
      salonId,
      channel: 'sms',
      eventType: 'booking_confirmation',
      audience: 'client',
      dedupeKey: `sms:lease:${salonId}`,
      recipient,
      templateKey: 'client_booking_confirmation_shortlink',
      templateVersion: 'v1',
      variables: {},
      schedulingRevision: 'rev1',
      scheduledFor: new Date(NOW.getTime() - 10 * 60 * 1000),
      notAfter: new Date(NOW.getTime() + 60 * 60 * 1000),
    });
    const claimed = await claimDueIntents({ workerId: 'w_dead', batchLimit: 1, perSalonLimit: 1, now: new Date(NOW.getTime() - 5 * 60 * 1000) });

    expect(claimed).toHaveLength(1);

    // Lease expired while still 'claimed' → recovered to pending.
    const first = await recoverExpiredLeases(NOW);

    expect(first.recovered).toBe(1);
    expect(first.unknownOutcome).toBe(0);

    // Simulate a worker that died mid-send: sending + expired lease.
    await db.execute(sql`
      UPDATE communication_intent SET status = 'sending', lease_expires_at = ${new Date(NOW.getTime() - 60 * 1000)}
      WHERE dedupe_key = ${`sms:lease:${salonId}`}
    `);
    const second = await recoverExpiredLeases(NOW);

    expect(second.unknownOutcome).toBe(1);

    const reclaim = await claimDueIntents({ workerId: 'w2', batchLimit: 10, perSalonLimit: 1, now: NOW });

    expect(reclaim.find(row => row.dedupeKey === `sms:lease:${salonId}`)).toBeUndefined();
  });

  it('expires stale intents and cancels superseded appointment intents', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await db.insert(schema.appointmentSchema).values({
      id: `apt_${salonId}`,
      salonId,
      clientName: 'Test Client',
      clientPhone: recipient,
      startTime: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      endTime: new Date(NOW.getTime() + 25 * 60 * 60 * 1000),
      status: 'confirmed',
      totalPrice: 50,
      totalDurationMinutes: 60,
    });
    const { enqueueCommunicationIntent, expireStaleIntents, cancelAppointmentIntents } = await import('./communicationIntent');
    await enqueueCommunicationIntent({
      salonId,
      appointmentId: `apt_${salonId}`,
      channel: 'sms',
      eventType: 'appointment_reminder',
      audience: 'client',
      dedupeKey: `sms:reminder:${salonId}:rule1:rev1`,
      recipient,
      templateKey: 'client_appointment_reminder_shortlink',
      templateVersion: 'v1',
      variables: {},
      ruleId: 'rule1',
      startRevision: 'rev1',
      schedulingRevision: 'sched1',
      scheduledFor: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
      notAfter: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    const expired = await expireStaleIntents(NOW);

    expect(expired.expired).toBe(1);

    await enqueueCommunicationIntent({
      salonId,
      appointmentId: `apt_${salonId}`,
      channel: 'sms',
      eventType: 'appointment_reminder',
      audience: 'client',
      dedupeKey: `sms:reminder:${salonId}:rule1:rev2`,
      recipient,
      templateKey: 'client_appointment_reminder_shortlink',
      templateVersion: 'v1',
      variables: {},
      ruleId: 'rule1',
      startRevision: 'rev2',
      schedulingRevision: 'sched2',
      scheduledFor: new Date(NOW.getTime() + 60 * 60 * 1000),
      notAfter: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
    });
    const canceled = await cancelAppointmentIntents({ salonId, appointmentId: `apt_${salonId}`, now: NOW });

    expect(canceled.canceled).toBe(1);
  });
});

describe('canonical SMS safety and recovery', () => {
  it('blocks a historical BYO sender without creating a delivery or bypassing credits', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(false);
    envHolder.COMMUNICATIONS_SMS_ENABLED = undefined;
    await db.insert(schema.salonTwilioConnectionSchema).values({
      salonId,
      connectAccountSid: 'AC11111111111111111111111111111111',
      phoneNumber: '+14165559999',
      status: 'active',
    });
    await enqueueSmsIntent(salonId, recipient);
    const provider = vi.fn(async () => ({ sid: 'SM_byo_canonical' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(await claimOne(salonId), provider, NOW)).toBe('deferred');
    expect(provider).not.toHaveBeenCalled();

    const rows = await db.execute(sql`SELECT credit_reservation_id, settlement_state FROM notification_delivery WHERE salon_id = ${salonId}`);

    expect(rows.rows).toHaveLength(0);

    const [retained] = await db.select().from(schema.salonTwilioConnectionSchema).where(eq(schema.salonTwilioConnectionSchema.salonId, salonId));

    expect(retained?.status).toBe('active');
  });

  it('retains one delivery row when the owner retries a proven provider rejection', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    await grantCredits(salonId, 10);
    await enqueueSmsIntent(salonId, recipient);
    const intent = await claimOne(salonId);
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, vi.fn(async () => {
      throw new Error('Rejected');
    }), NOW)).toBe('failed');

    const before = await db.execute(sql`SELECT id, retryable FROM notification_delivery WHERE intent_id = ${intent.id}`);

    expect(before.rows[0]).toMatchObject({ retryable: true });

    await db.execute(sql`UPDATE communication_intent SET status = 'pending', available_at = ${NOW} WHERE id = ${intent.id}`);
    const retried = await claimOne(salonId);
    const provider = vi.fn(async () => ({ sid: 'SM_retry_same_delivery' }));

    expect(await dispatchClaimedIntent(retried, provider, NOW)).toBe('sent');

    const after = await db.execute(sql`SELECT id, provider_message_id FROM notification_delivery WHERE intent_id = ${intent.id}`);

    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]).toMatchObject({ id: before.rows[0]!.id, provider_message_id: 'SM_retry_same_delivery' });
  });

  it('never retries an ambiguous provider outcome or sends a duplicate invocation', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    await grantCredits(salonId, 10);
    await enqueueSmsIntent(salonId, recipient);
    const intent = await claimOne(salonId);
    const { dispatchClaimedIntent, ProviderOutcomeUnknownError } = await import('./communicationDispatcher');
    const provider = vi.fn(async () => {
      throw new ProviderOutcomeUnknownError();
    });

    expect(await dispatchClaimedIntent(intent, provider, NOW)).toBe('unknown_outcome');
    expect(await dispatchClaimedIntent(intent, provider, NOW)).toBe('failed');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('defers a manual text through current salon quiet hours without reserving credits', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    await db.execute(sql`UPDATE salon SET settings = ${JSON.stringify({ booking: { timezone: 'America/Toronto' }, communications: { sms: { enabled: true }, quietHours: { enabled: true, start: '21:00', end: '09:00' } } })}::jsonb WHERE id = ${salonId}`);
    await enqueueSmsIntent(salonId, recipient, { eventType: 'manual_text', templateKey: 'client_manual_text', variables: { message: 'Hello' } });
    const provider = vi.fn();
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');
    const intent = await claimOne(salonId);

    expect(await dispatchClaimedIntent(intent, provider, NOW)).toBe('deferred');
    expect(provider).not.toHaveBeenCalled();

    const rows = await db.execute(sql`SELECT available_at, last_error FROM communication_intent WHERE id = ${intent.id}`);

    expect(rows.rows[0]).toMatchObject({ last_error: 'QUIET_HOURS' });
    expect(new Date(String(rows.rows[0]!.available_at)).toISOString()).toBe('2026-08-17T13:00:00.000Z');
  });

  it('sends an explicitly requested voice booking link during quiet hours after the call has ended', async () => {
    const previousSecret = process.env.VOICE_RECEPTIONIST_SIGNING_SECRET;
    process.env.VOICE_RECEPTIONIST_SIGNING_SECRET = 's'.repeat(40);
    try {
      const { salonId, recipient } = await seedVoiceLinkWithoutBroadConsent();
      await db.execute(sql`UPDATE salon SET settings = ${JSON.stringify({ booking: { timezone: 'America/Toronto' }, communications: { sms: { enabled: true }, quietHours: { enabled: true, start: '21:00', end: '09:00' } } })}::jsonb WHERE id = ${salonId}`);
      await grantCredits(salonId, 10);
      await enableControl(true);
      const provider = vi.fn(async (_input: { to: string }) => ({ sid: 'SM_voice_link_quiet' }));
      const { dispatchClaimedIntent } = await import('./communicationDispatcher');

      expect(await dispatchClaimedIntent(await claimOne(salonId), provider, NOW)).toBe('sent');
      expect(provider).toHaveBeenCalledOnce();
      expect(provider.mock.calls[0]![0]).toMatchObject({ to: `+1${recipient}` });
    } finally {
      if (previousSecret === undefined) {
        delete process.env.VOICE_RECEPTIONIST_SIGNING_SECRET;
      } else {
        process.env.VOICE_RECEPTIONIST_SIGNING_SECRET = previousSecret;
      }
    }
  });

  it('suppresses stale and cross-tenant client identities before sending', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const other = await seedSalonWithConsent();
    await enableControl(true);
    await grantCredits(salonId, 10);
    await db.insert(schema.salonClientSchema).values({ id: `client_${other.salonId}`, salonId: other.salonId, phone: recipient });
    await enqueueSmsIntent(salonId, recipient, { eventType: 'manual_text', templateKey: 'client_manual_text', variables: { clientId: `client_${other.salonId}`, message: 'Hello' } });
    const provider = vi.fn();
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(await claimOne(salonId), provider, NOW)).toBe('suppressed');
    expect(provider).not.toHaveBeenCalled();
  });

  it('suppresses an old reminder after rescheduling, but sends a cancellation for a cancelled appointment', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    await grantCredits(salonId, 10);
    const appointmentId = `safety_${salonId}`;
    await db.insert(schema.appointmentSchema).values({
      id: appointmentId,
      salonId,
      clientPhone: recipient,
      startTime: new Date('2026-08-18T16:00:00Z'),
      endTime: new Date('2026-08-18T17:00:00Z'),
      status: 'confirmed',
      totalPrice: 50,
      totalDurationMinutes: 60,
    });
    await enqueueSmsIntent(salonId, recipient, { appointmentId, eventType: 'appointment_reminder', startRevision: '2026-08-18T15:00:00.000Z' });
    const provider = vi.fn(async () => ({ sid: 'SM_cancel_notice' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(await claimOne(salonId), provider, NOW)).toBe('suppressed');
    expect(provider).not.toHaveBeenCalled();

    await db.execute(sql`UPDATE appointment SET status = 'cancelled' WHERE id = ${appointmentId}`);
    await enqueueSmsIntent(salonId, recipient, { appointmentId, eventType: 'appointment_cancelled', templateKey: 'client_appointment_cancelled_shortlink' });

    expect(await dispatchClaimedIntent(await claimOne(salonId), provider, NOW)).toBe('sent');
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe('durable SMS preparation', () => {
  it('adopts an old queued evidence row after a proven pre-send worker crash', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    await grantCredits(salonId, 10);
    await enqueueSmsIntent(salonId, recipient);
    const claimed = await claimOne(salonId);
    const deliveryId = `nd_orphan_${salonId}`;
    await db.insert(schema.notificationDeliverySchema).values({
      id: deliveryId,
      salonId,
      intentId: claimed.id,
      channel: 'sms',
      purpose: 'test',
      dedupeKey: `delivery:${claimed.dedupeKey}`,
      status: 'queued',
      settlementState: 'settling',
    });
    const provider = vi.fn(async () => ({ sid: 'SM_recovered_preparation' }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(claimed, provider, NOW)).toBe('sent');
    expect(provider).toHaveBeenCalledTimes(1);

    const deliveries = await db.execute(sql`SELECT id, provider_message_id FROM notification_delivery WHERE intent_id = ${claimed.id}`);

    expect(deliveries.rows).toEqual([{ id: deliveryId, provider_message_id: 'SM_recovered_preparation' }]);
  });

  it('does not release credits held by an ambiguous send on a duplicate invocation', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    await grantCredits(salonId, 10);
    await enqueueSmsIntent(salonId, recipient);
    const claimed = await claimOne(salonId);
    const { dispatchClaimedIntent, ProviderOutcomeUnknownError } = await import('./communicationDispatcher');
    const provider = vi.fn(async () => {
      throw new ProviderOutcomeUnknownError();
    });
    await dispatchClaimedIntent(claimed, provider, NOW);
    await dispatchClaimedIntent(claimed, provider, NOW);
    const holds = await db.execute(sql`SELECT r.status FROM sms_credit_reservation r JOIN communication_intent i ON i.credit_reservation_id = r.id WHERE i.id = ${claimed.id}`);

    expect(holds.rows[0]).toMatchObject({ status: 'held' });
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

describe('fresh reminder settings and actionable suppression', () => {
  it.each(['enabled', 'disabled', 'changed_offset'] as const)('checks the current reminder rule before dispatch: %s', async (mode) => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    await grantCredits(salonId, 10);
    const { communicationSettingsSchema } = await import('./communicationSettings');
    const { computeSchedulingRevision } = await import('./communicationScheduling');
    const rule = { id: 'current-rule', enabled: true, channels: 'sms' as const, offsetMinutes: 1440 };
    const settings = communicationSettingsSchema.parse({ sms: { enabled: true }, quietHours: { enabled: false, start: '21:00', end: '09:00' }, reminders: { rules: [rule] } });
    const start = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const appointmentId = `rule_${salonId}`;
    await db.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, clientPhone: recipient, startTime: start, endTime: new Date(start.getTime() + 60 * 60 * 1000), updatedAt: NOW, status: 'confirmed', totalPrice: 5000, totalDurationMinutes: 60 });
    await db.execute(sql`UPDATE salon SET settings = ${JSON.stringify({ communications: settings })}::jsonb WHERE id = ${salonId}`);
    await enqueueSmsIntent(salonId, recipient, {
      appointmentId,
      eventType: 'appointment_reminder',
      ruleId: rule.id,
      startRevision: start.toISOString(),
      schedulingRevision: computeSchedulingRevision({ timeZone: null, quietHours: settings.quietHours, rule, appointmentStart: start, appointmentUpdatedAt: NOW, smsEnabled: true, emailEnabled: settings.email.enabled }),
    });
    if (mode !== 'enabled') {
      const changed = { ...settings, reminders: { rules: [{ ...rule, enabled: mode !== 'disabled', offsetMinutes: mode === 'changed_offset' ? 1800 : 1440 }] } };
      await db.execute(sql`UPDATE salon SET settings = ${JSON.stringify({ communications: changed })}::jsonb WHERE id = ${salonId}`);
    }
    const intent = await claimOne(salonId);
    const provider = vi.fn(async () => ({ sid: `SM_rule_${mode}` }));
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, NOW)).toBe(mode === 'enabled' ? 'sent' : 'suppressed');
    expect(provider).toHaveBeenCalledTimes(mode === 'enabled' ? 1 : 0);

    if (mode !== 'enabled') {
      const result = await db.execute(sql`SELECT last_error FROM communication_intent WHERE id = ${intent.id}`);

      expect(result.rows[0]).toMatchObject({ last_error: 'REMINDER_RULE_CHANGED' });
    }
  });

  it('records missing consent as an actionable failure reason without exposing provider content', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    await enableControl(true);
    await grantCredits(salonId, 10);
    await db.execute(sql`DELETE FROM communication_consent WHERE salon_id = ${salonId}`);
    await enqueueSmsIntent(salonId, recipient);
    const intent = await claimOne(salonId);
    const provider = vi.fn();
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, NOW)).toBe('suppressed');
    expect(provider).not.toHaveBeenCalled();

    const result = await db.execute(sql`SELECT last_error FROM communication_intent WHERE id = ${intent.id}`);

    expect(result.rows[0]).toMatchObject({ last_error: 'CONSENT_REQUIRED' });
  });
});

describe('public booking reminder preference dispatch', () => {
  it.each([['granted', 'sent'], ['revoked', 'suppressed']] as const)('honors a reminder-only %s after a historical grant', async (status, outcome) => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const appointmentId = `booking-${salonId}`;
    await db.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, clientName: 'Guest', clientPhone: recipient, status: 'confirmed', startTime: new Date(NOW.getTime() + 3600000), endTime: new Date(NOW.getTime() + 7200000), totalPrice: 5000, totalDurationMinutes: 60 });
    await db.insert(schema.communicationConsentSchema).values({ id: `reminder-${salonId}`, salonId, recipient, channel: 'sms', purpose: 'appointment_reminders', status, wordingVersion: 'booking-sms-reminders-v1', source: 'public_booking', metadata: { appointmentId, selection: status === 'granted' ? 'default_on' : 'explicit_off' } });
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueSmsIntent(salonId, recipient, { appointmentId });
    const intent = await claimOne(salonId);
    const provider = vi.fn().mockResolvedValue({ sid: `SM_${salonId}` });
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, NOW)).toBe(outcome);

    if (status === 'granted') {
      expect(provider).toHaveBeenCalledOnce();
    } else {
      expect(provider).not.toHaveBeenCalled();

      const [stored] = await db.select().from(schema.communicationIntentSchema).where(eq(schema.communicationIntentSchema.id, intent.id));

      expect(stored?.lastError).toBe('CUSTOMER_DISABLED');
    }
  });
});

describe('booking recovery SMS capabilities', () => {
  it.each(['pending', 'confirmed', 'awaiting_payment'] as const)('sends a live %s appointment recovery', async (status) => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const appointmentId = await seedRecoveryAppointment({ salonId, recipient, status });
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueRecoveryIntent({ salonId, recipient, appointmentId, dedupeKey: `recovery-live:${salonId}` });
    const intent = await claimOne(salonId);
    const provider = vi.fn().mockResolvedValue({ sid: `SM_recovery_${status}` });
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, NOW)).toBe('sent');
    expect(provider).toHaveBeenCalledOnce();
  });

  it.each([
    ['cancelled', new Date(NOW.getTime() + 60 * 60 * 1000)],
    ['completed', new Date(NOW.getTime() + 60 * 60 * 1000)],
    ['confirmed', new Date(NOW.getTime() - 1000)],
  ] as const)('suppresses inactive recovery (%s)', async (status, endTime) => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const appointmentId = await seedRecoveryAppointment({ salonId, recipient, status, endTime });
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueRecoveryIntent({ salonId, recipient, appointmentId, dedupeKey: `recovery-inactive:${salonId}` });
    const intent = await claimOne(salonId);
    const provider = vi.fn();
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, provider, NOW)).toBe('suppressed');
    expect(provider).not.toHaveBeenCalled();
  });

  it('revokes a minted recovery capability when STOP suppresses the final provider check', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const appointmentId = await seedRecoveryAppointment({ salonId, recipient });
    await grantCredits(salonId, 10);
    await enableControl(true);
    const { appendGlobalConsentEvent } = await import('./smsConsentShared');
    await appendGlobalConsentEvent({ senderIdentity: 'luster_shared_v1', recipient, state: 'suppressed', source: 'twilio_inbound' });
    await enqueueRecoveryIntent({ salonId, recipient, appointmentId, dedupeKey: `recovery-stop:${salonId}` });
    const intent = await claimOne(salonId);
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, vi.fn(), NOW)).toBe('suppressed');

    const tokens = await db.select().from(schema.appointmentAccessTokenSchema)
      .where(eq(schema.appointmentAccessTokenSchema.appointmentId, appointmentId));

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.revokedAt).not.toBeNull();
  });

  it('revokes a recovery capability on a proven provider rejection but preserves it for an ambiguous outcome', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const rejectedAppointmentId = await seedRecoveryAppointment({ salonId, recipient });
    const ambiguousAppointmentId = await seedRecoveryAppointment({ salonId, recipient });
    await grantCredits(salonId, 20);
    await enableControl(true);
    await enqueueRecoveryIntent({ salonId, recipient, appointmentId: rejectedAppointmentId, dedupeKey: `recovery-reject:${salonId}` });
    let intent = await claimOne(salonId);
    const { dispatchClaimedIntent, ProviderOutcomeUnknownError } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, vi.fn(async () => {
      throw Object.assign(new Error('rejected'), { code: '30001' });
    }), NOW)).toBe('failed');

    let tokens = await db.select().from(schema.appointmentAccessTokenSchema)
      .where(eq(schema.appointmentAccessTokenSchema.appointmentId, rejectedAppointmentId));

    expect(tokens[0]?.revokedAt).not.toBeNull();

    const [rejected] = await db.select().from(schema.communicationIntentSchema)
      .where(eq(schema.communicationIntentSchema.id, intent.id));

    expect(rejected?.variables.manageUrl).toBe('pending');

    await enqueueRecoveryIntent({ salonId, recipient, appointmentId: ambiguousAppointmentId, dedupeKey: `recovery-ambiguous:${salonId}` });
    intent = await claimOne(salonId);

    expect(await dispatchClaimedIntent(intent, vi.fn(async () => {
      throw new ProviderOutcomeUnknownError();
    }), NOW)).toBe('unknown_outcome');

    tokens = await db.select().from(schema.appointmentAccessTokenSchema)
      .where(eq(schema.appointmentAccessTokenSchema.appointmentId, ambiguousAppointmentId));

    expect(tokens[0]?.revokedAt).toBeNull();
  });

  it('caps active capabilities at three after accepted recovery delivery', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const appointmentId = await seedRecoveryAppointment({ salonId, recipient });
    const { hashOpaqueToken } = await import('./lusterSecurity');
    await db.insert(schema.appointmentAccessTokenSchema).values([0, 1, 2].map(index => ({
      id: `old-recovery-token-${salonId}-${index}`,
      salonId,
      appointmentId,
      tokenHash: hashOpaqueToken(`old-recovery-token-${salonId}-${index}`),
      expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(NOW.getTime() - (3 - index) * 1000),
    })));
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueRecoveryIntent({ salonId, recipient, appointmentId, dedupeKey: `recovery-cap:${salonId}` });
    const intent = await claimOne(salonId);
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, vi.fn().mockResolvedValue({ sid: 'SM_recovery_cap' }), NOW)).toBe('sent');

    const tokens = await db.select().from(schema.appointmentAccessTokenSchema)
      .where(eq(schema.appointmentAccessTokenSchema.appointmentId, appointmentId));

    expect(tokens.filter(token => token.revokedAt === null)).toHaveLength(3);
  });

  it('suppresses a queued orphan when a canonical client is introduced before delivery', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const appointmentId = await seedRecoveryAppointment({ salonId, recipient });
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueRecoveryIntent({ salonId, recipient, appointmentId, dedupeKey: `recovery-orphan-linked:${salonId}` });
    await db.insert(schema.salonClientSchema).values({ id: `client-${salonId}`, salonId, phone: recipient, fullName: 'Linked later' });
    const intent = await claimOne(salonId);
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, vi.fn(), NOW)).toBe('suppressed');
    expect(await db.select().from(schema.appointmentAccessTokenSchema)
      .where(eq(schema.appointmentAccessTokenSchema.appointmentId, appointmentId))).toHaveLength(0);
  });

  it('suppresses canonical recovery when the terminal phone changes before delivery', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const clientId = `client-update-${salonId}`;
    await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, phone: recipient, fullName: 'Current client' });
    const appointmentId = await seedRecoveryAppointment({ salonId, recipient });
    await db.update(schema.appointmentSchema).set({ salonClientId: clientId })
      .where(eq(schema.appointmentSchema.id, appointmentId));
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueRecoveryIntent({ salonId, recipient, appointmentId, dedupeKey: `recovery-phone-changed:${salonId}` });
    await db.update(schema.salonClientSchema).set({ phone: '6475550199' })
      .where(eq(schema.salonClientSchema.id, clientId));
    const intent = await claimOne(salonId);
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, vi.fn(), NOW)).toBe('suppressed');
  });

  it('sends an unlinked legacy appointment only when both snapshots resolve to its queued terminal', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const clientId = `client-legacy-${salonId}`;
    await db.insert(schema.salonClientSchema).values({ id: clientId, salonId, phone: recipient, email: 'legacy@example.com', fullName: 'Legacy client' });
    const appointmentId = await seedRecoveryAppointment({ salonId, recipient });
    await db.update(schema.appointmentSchema).set({ clientEmail: 'legacy@example.com' })
      .where(eq(schema.appointmentSchema.id, appointmentId));
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueRecoveryIntent({ salonId, recipient, appointmentId, clientId, dedupeKey: `recovery-legacy:${salonId}` });
    const intent = await claimOne(salonId);
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, vi.fn().mockResolvedValue({ sid: 'SM_legacy' }), NOW)).toBe('sent');
  });

  it('suppresses an orphan when an email-only canonical client appears before delivery', async () => {
    const { salonId, recipient } = await seedSalonWithConsent();
    const appointmentId = await seedRecoveryAppointment({ salonId, recipient });
    await db.update(schema.appointmentSchema).set({ clientEmail: 'orphan@example.com' })
      .where(eq(schema.appointmentSchema.id, appointmentId));
    await grantCredits(salonId, 10);
    await enableControl(true);
    await enqueueRecoveryIntent({ salonId, recipient, appointmentId, dedupeKey: `recovery-orphan-email:${salonId}` });
    await db.insert(schema.salonClientSchema).values({ id: `email-only-${salonId}`, salonId, phone: '6475550198', email: 'orphan@example.com', fullName: 'Email linked later' });
    const intent = await claimOne(salonId);
    const { dispatchClaimedIntent } = await import('./communicationDispatcher');

    expect(await dispatchClaimedIntent(intent, vi.fn(), NOW)).toBe('suppressed');
  });
});
