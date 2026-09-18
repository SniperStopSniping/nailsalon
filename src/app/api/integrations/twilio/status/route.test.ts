/**
 * Hardened status callback — BYO legacy regression (NULL-rank rows behave
 * like the pre-hardening route with zero ledger activity), monotonic
 * ordering, and exactly-once financial disposition for pipeline rows.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const envHolder = vi.hoisted(() => ({
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN: 'platform-token' as string | undefined,
  BILLING_IDENTITY_HMAC_SECRET: undefined,
  BILLING_IDENTITY_HMAC_VERSION: undefined,
}));

vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const signatureHolder = vi.hoisted(() => ({ valid: true }));

vi.mock('twilio', () => ({
  default: { validateRequest: vi.fn(() => signatureHolder.valid) },
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values({ id: 'st1', name: 'S', slug: 'status-salon' });
});

function callbackRequest(deliveryId: string, status: string, extra: Record<string, string> = {}) {
  const body = new URLSearchParams({ MessageSid: 'SM_cb_1', AccountSid: 'AC00000000000000000000000000000000', MessageStatus: status, ...extra });
  return new Request(`https://x.test/api/integrations/twilio/status?deliveryId=${deliveryId}`, {
    method: 'POST',
    headers: {
      'x-twilio-signature': 'sig',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
}

describe('Twilio delivery status callback (hardened)', () => {
  it('invalid signature mutates NOTHING', async () => {
    await db.insert(schema.notificationDeliverySchema).values({
      id: 'nd_sig',
      salonId: 'st1',
      channel: 'sms',
      purpose: 'test',
      dedupeKey: 'dk_sig',
      status: 'queued',
    });
    signatureHolder.valid = false;
    const { POST } = await import('./route');
    const response = await POST(callbackRequest('nd_sig', 'delivered'));

    expect(response.status).toBe(403);

    const row = await db.execute(sql`SELECT status, status_rank FROM notification_delivery WHERE id = 'nd_sig'`);

    expect(row.rows[0]).toMatchObject({ status: 'queued', status_rank: null });

    signatureHolder.valid = true;
  });

  it('legacy NULL-rank BYO rows accept their first callback (incl. retryable mapping), then become monotonic', async () => {
    await db.insert(schema.notificationDeliverySchema).values({
      id: 'nd_byo',
      salonId: 'st1',
      channel: 'sms',
      purpose: 'appointment_reminder',
      dedupeKey: 'dk_byo',
      status: 'queued',
    });
    const { POST } = await import('./route');

    expect((await POST(callbackRequest('nd_byo', 'delivered'))).status).toBe(204);

    let row = await db.execute(sql`
      SELECT status, status_rank, provider_message_id FROM notification_delivery WHERE id = 'nd_byo'
    `);

    expect(row.rows[0]).toMatchObject({ status: 'delivered', status_rank: 50, provider_message_id: 'SM_cb_1' });

    // Monotonic: a late `sent` never regresses `delivered`.
    expect((await POST(callbackRequest('nd_byo', 'sent'))).status).toBe(204);

    row = await db.execute(sql`SELECT status FROM notification_delivery WHERE id = 'nd_byo'`);

    expect((row.rows[0] as Record<string, unknown>).status).toBe('delivered');

    // Zero ledger writes for BYO rows (no linked reservation).
    const ledger = await db.execute(sql`SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = 'st1'`);

    expect(Number((ledger.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('legacy retryable error mapping is preserved on terminal failure', async () => {
    await db.insert(schema.notificationDeliverySchema).values({
      id: 'nd_retry',
      salonId: 'st1',
      channel: 'sms',
      purpose: 'appointment_reminder',
      dedupeKey: 'dk_retry',
      status: 'queued',
    });
    const { POST } = await import('./route');
    const response = await POST(callbackRequest('nd_retry', 'undelivered', {
      ErrorCode: '30008',
      ErrorMessage: 'Unknown error',
    }));

    expect(response.status).toBe(204);

    const row = await db.execute(sql`
      SELECT status, error_code, retryable FROM notification_delivery WHERE id = 'nd_retry'
    `);

    expect(row.rows[0]).toMatchObject({ status: 'undelivered', error_code: '30008', retryable: true });
  });

  it('records a shared-provider 21610 as durable suppression, but leaves 30007 as delivery-only evidence', async () => {
    const { LUSTER_DEFAULT_SENDER_IDENTITY } = await import('@/libs/smsSender');
    const now = new Date('2026-09-17T12:00:00.000Z');
    await db.insert(schema.communicationIntentSchema).values([
      {
        id: 'ci_callback_opt_out',
        salonId: 'st1',
        channel: 'sms',
        eventType: 'booking_confirmation',
        audience: 'client',
        dedupeKey: 'callback-opt-out',
        recipient: '4165553010',
        templateKey: 'test',
        templateVersion: 'v1',
        schedulingRevision: 'v1',
        scheduledFor: now,
        notAfter: new Date(now.getTime() + 60 * 60 * 1000),
      },
      {
        id: 'ci_callback_blocked',
        salonId: 'st1',
        channel: 'sms',
        eventType: 'booking_confirmation',
        audience: 'client',
        dedupeKey: 'callback-blocked',
        recipient: '4165553011',
        templateKey: 'test',
        templateVersion: 'v1',
        schedulingRevision: 'v1',
        scheduledFor: now,
        notAfter: new Date(now.getTime() + 60 * 60 * 1000),
      },
    ]);
    await db.insert(schema.notificationDeliverySchema).values([
      {
        id: 'nd_callback_opt_out',
        salonId: 'st1',
        channel: 'sms',
        purpose: 'test',
        dedupeKey: 'callback-opt-out-delivery',
        intentId: 'ci_callback_opt_out',
        senderIdentity: LUSTER_DEFAULT_SENDER_IDENTITY,
        status: 'accepted',
        statusRank: 20,
      },
      {
        id: 'nd_callback_blocked',
        salonId: 'st1',
        channel: 'sms',
        purpose: 'test',
        dedupeKey: 'callback-blocked-delivery',
        intentId: 'ci_callback_blocked',
        senderIdentity: LUSTER_DEFAULT_SENDER_IDENTITY,
        status: 'accepted',
        statusRank: 20,
      },
    ]);
    const { POST } = await import('./route');

    expect((await POST(callbackRequest('nd_callback_opt_out', 'undelivered', {
      To: '+14165553010',
      ErrorCode: '21610',
    }))).status).toBe(204);
    expect((await POST(callbackRequest('nd_callback_blocked', 'undelivered', {
      To: '+14165553011',
      ErrorCode: '30007',
    }))).status).toBe(204);

    const suppressions = await db.execute(sql`
      SELECT recipient, state, source FROM sms_global_consent_event
      WHERE recipient IN ('4165553010', '4165553011') ORDER BY recipient
    `);

    expect(suppressions.rows).toEqual([
      expect.objectContaining({
        recipient: '4165553010',
        state: 'suppressed',
        source: 'twilio_advanced_opt_out',
      }),
    ]);
  });

  it('records a signed BYO 21610 as a tenant-scoped provider opt-out exactly once', async () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    await db.insert(schema.communicationIntentSchema).values({
      id: 'ci_callback_byo_opt_out',
      salonId: 'st1',
      channel: 'sms',
      eventType: 'booking_confirmation',
      audience: 'client',
      dedupeKey: 'callback-byo-opt-out',
      recipient: '4165553012',
      templateKey: 'test',
      templateVersion: 'v1',
      schedulingRevision: 'v1',
      scheduledFor: now,
      notAfter: new Date(now.getTime() + 60 * 60 * 1000),
    });
    await db.insert(schema.notificationDeliverySchema).values({
      id: 'nd_callback_byo_opt_out',
      salonId: 'st1',
      channel: 'sms',
      purpose: 'test',
      dedupeKey: 'callback-byo-opt-out-delivery',
      intentId: 'ci_callback_byo_opt_out',
      senderIdentity: 'byo:AC00000000000000000000000000000000',
      status: 'accepted',
      statusRank: 20,
    });
    const { POST } = await import('./route');
    const callback = () => callbackRequest('nd_callback_byo_opt_out', 'undelivered', {
      To: '+14165553012',
      ErrorCode: '21610',
    });

    expect((await POST(callback())).status).toBe(204);
    expect((await POST(callback())).status).toBe(204);

    const records = await db.execute(sql`
      SELECT salon_id, recipient, status, source, metadata
      FROM communication_consent
      WHERE id = 'twilio:provider-21610:nd_callback_byo_opt_out:SM_cb_1'
    `);

    expect(records.rows).toEqual([
      expect.objectContaining({
        salon_id: 'st1',
        recipient: '4165553012',
        status: 'revoked',
        source: 'twilio_inbound',
        metadata: expect.objectContaining({ providerErrorCode: '21610' }),
      }),
    ]);
  });

  it('records a signed legacy BYO 21610 when its stored provider SID binds the callback recipient', async () => {
    await db.insert(schema.notificationDeliverySchema).values({
      id: 'nd_callback_legacy_byo_opt_out',
      salonId: 'st1',
      channel: 'sms',
      purpose: 'appointment_reminder',
      dedupeKey: 'callback-legacy-byo-opt-out-delivery',
      providerMessageId: 'SM_cb_1',
      senderIdentity: 'byo:AC00000000000000000000000000000000',
      status: 'sent',
    });
    const { POST } = await import('./route');

    expect((await POST(callbackRequest('nd_callback_legacy_byo_opt_out', 'undelivered', {
      To: '+14165553013',
      ErrorCode: '21610',
    }))).status).toBe(204);

    const records = await db.execute(sql`
      SELECT salon_id, recipient, status, source, metadata
      FROM communication_consent
      WHERE id = 'twilio:provider-21610:nd_callback_legacy_byo_opt_out:SM_cb_1'
    `);

    expect(records.rows).toEqual([
      expect.objectContaining({
        salon_id: 'st1',
        recipient: '4165553013',
        status: 'revoked',
        source: 'twilio_inbound',
        metadata: expect.objectContaining({ providerErrorCode: '21610' }),
      }),
    ]);
  });

  it('pipeline rows: duplicate terminal callbacks refund exactly once and enqueue one reconciliation', async () => {
    const { appendLotGrant, lockCreditAccount } = await import('@/libs/billing/creditLedger');
    const { reserveSmsCredits, settleReservationOnAccept } = await import('@/libs/billing/creditReservation');
    await db.transaction(async (tx) => {
      await lockCreditAccount(tx, 'st1');
      await appendLotGrant(tx, {
        salonId: 'st1',
        bucket: 'purchased',
        amount: 5,
        expiresAt: null,
        idempotencyKey: 'st1_seed',
        reason: 'seed',
      });
    });
    const reserved = await reserveSmsCredits({ salonId: 'st1', dedupeKey: 'st1_res', segments: 2 });
    const reservationId = (reserved as { reservationId: string }).reservationId;
    await settleReservationOnAccept({ reservationId, providerSid: 'SM_cb_1' });
    await db.insert(schema.notificationDeliverySchema).values({
      id: 'nd_pipe',
      salonId: 'st1',
      channel: 'sms',
      purpose: 'intent:booking_confirmation',
      dedupeKey: 'dk_pipe',
      status: 'accepted',
      statusRank: 20,
      creditReservationId: reservationId,
      settlementState: 'settled',
      segmentCount: 2,
    });
    const { POST } = await import('./route');

    expect((await POST(callbackRequest('nd_pipe', 'undelivered', { ErrorCode: '30005' }))).status).toBe(204);
    expect((await POST(callbackRequest('nd_pipe', 'undelivered', { ErrorCode: '30005' }))).status).toBe(204);
    expect((await POST(callbackRequest('nd_pipe', 'failed'))).status).toBe(204);

    const refunds = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM sms_credit_ledger
      WHERE salon_id = 'st1' AND amount > 0 AND idempotency_key LIKE 'sms-refund%'
    `);

    expect(Number((refunds.rows[0] as Record<string, unknown>).n)).toBe(1);

    const delivery = await db.execute(sql`SELECT settlement_state FROM notification_delivery WHERE id = 'nd_pipe'`);

    expect((delivery.rows[0] as Record<string, unknown>).settlement_state).toBe('refunded');

    const outbox = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM integration_outbox
      WHERE provider = 'twilio' AND dedupe_key = 'twilio:reconcile:nd_pipe'
    `);

    expect(Number((outbox.rows[0] as Record<string, unknown>).n)).toBe(1);
  });

  it('unknown deliveryId stays a silent 204 (no oracle)', async () => {
    const { POST } = await import('./route');

    expect((await POST(callbackRequest('nd_missing', 'delivered'))).status).toBe(204);
  });
});

describe('delivery callback identity binding', () => {
  it('does not attach another provider message to an existing delivery', async () => {
    await db.insert(schema.notificationDeliverySchema).values({ id: 'nd_bound_sid', salonId: 'st1', channel: 'sms', purpose: 'test', dedupeKey: 'bound_sid', providerMessageId: 'SM_original', status: 'sent' });
    const { POST } = await import('./route');

    expect((await POST(callbackRequest('nd_bound_sid', 'delivered', { MessageSid: 'SM_some_other_message' }))).status).toBe(409);

    const rows = await db.execute(sql`SELECT provider_message_id, status FROM notification_delivery WHERE id = 'nd_bound_sid'`);

    expect(rows.rows[0]).toMatchObject({ provider_message_id: 'SM_original', status: 'sent' });
  });

  it('rejects a signed callback from the wrong Twilio account', async () => {
    await db.insert(schema.notificationDeliverySchema).values({ id: 'nd_bound_account', salonId: 'st1', channel: 'sms', purpose: 'test', dedupeKey: 'bound_account', status: 'queued' });
    const { POST } = await import('./route');

    expect((await POST(callbackRequest('nd_bound_account', 'delivered', { AccountSid: 'AC11111111111111111111111111111111' }))).status).toBe(403);

    const rows = await db.execute(sql`SELECT provider_message_id, status FROM notification_delivery WHERE id = 'nd_bound_account'`);

    expect(rows.rows[0]).toMatchObject({ provider_message_id: null, status: 'queued' });
  });
});

describe('callback financial recovery after a crash', () => {
  it('resumes the refund when a terminal status was saved before financial work completed', async () => {
    const { appendLotGrant, lockCreditAccount } = await import('@/libs/billing/creditLedger');
    const { reserveSmsCredits, settleReservationOnAccept } = await import('@/libs/billing/creditReservation');
    await db.transaction(async (tx) => {
      await lockCreditAccount(tx, 'st1');
      await appendLotGrant(tx, { salonId: 'st1', bucket: 'purchased', amount: 5, expiresAt: null, idempotencyKey: 'callback_recovery_seed', reason: 'test' });
    });
    const reservation = await reserveSmsCredits({ salonId: 'st1', dedupeKey: 'callback_recovery_reservation', segments: 1 });
    if (!reservation.ok) {
      throw new Error('Expected test credits');
    }
    await settleReservationOnAccept({ reservationId: reservation.reservationId, providerSid: 'SM_cb_1' });
    await db.insert(schema.notificationDeliverySchema).values({
      id: 'nd_callback_recovery',
      salonId: 'st1',
      channel: 'sms',
      purpose: 'test',
      dedupeKey: 'callback_recovery_delivery',
      status: 'undelivered',
      statusRank: 70,
      providerMessageId: 'SM_cb_1',
      creditReservationId: reservation.reservationId,
      settlementState: 'settled',
    });
    const { POST } = await import('./route');

    expect((await POST(callbackRequest('nd_callback_recovery', 'undelivered'))).status).toBe(204);
    expect((await POST(callbackRequest('nd_callback_recovery', 'undelivered'))).status).toBe(204);

    const delivery = await db.execute(sql`SELECT settlement_state FROM notification_delivery WHERE id = 'nd_callback_recovery'`);
    const refunds = await db.execute(sql`SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE idempotency_key LIKE ${`sms-refund:${reservation.reservationId}:%`}`);

    expect(delivery.rows[0]).toMatchObject({ settlement_state: 'refunded' });
    expect(refunds.rows[0]).toMatchObject({ n: 1 });
  });
});
