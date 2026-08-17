/**
 * B2 dispatcher — PGlite proofs for the intent pipeline: dark-by-default,
 * final pre-provider check, settle-on-accept wiring, blocked_no_credit,
 * lease recovery, notAfter, supersession and top-up release.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
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

describe('dispatcher — dark by default, live only behind every switch', () => {
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
    const providerSend = vi.fn(async (_input: { to: string; messagingServiceSid: string }) => ({ sid: 'SM_pipeline_1' }));
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
