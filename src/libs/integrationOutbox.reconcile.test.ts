/**
 * Twilio cost/segment reconciliation over the outbox — the four §7.7 cases
 * (equal / underpredicted absorb / overpredicted refund-once / missing
 * actuals retry) plus the twilio-failure ops-only gate: exhaustion never
 * emails the salon owner.
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
  usesRuntimePostgres: false,
}));

const sendTransactionalEmail = vi.hoisted(() => vi.fn(async () => ({ delivered: true })));

vi.mock('@/libs/email', () => ({ sendTransactionalEmail }));

vi.mock('@/libs/googleCalendar', () => ({
  deleteGoogleCalendarEventForAppointment: vi.fn(),
  deterministicGoogleCalendarEventId: vi.fn(() => 'unused'),
  syncGoogleCalendarEventForAppointment: vi.fn(),
  listGoogleCalendarEventsForSalon: vi.fn(),
}));

vi.mock('@/libs/customerBookingEmail', () => ({
  retryCustomerBookingConfirmationEmail: vi.fn(),
}));

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  sendAppointmentOperationalEmailOnce: vi.fn(),
}));

vi.mock('@/libs/appointmentManageLink', () => ({
  mintAppointmentManageLink: vi.fn(),
}));

vi.mock('@/libs/queries', () => ({
  updateSalonClientStats: vi.fn(),
}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
  await db.insert(schema.salonSchema).values({
    id: 'rc1',
    name: 'Reconcile Salon',
    slug: 'reconcile-salon',
    ownerEmail: 'owner@reconcile.test',
  });
});

async function seedSettledDelivery(seq: number, predictedSegments: number): Promise<{
  deliveryId: string;
  reservationId: string;
}> {
  const { appendLotGrant, lockCreditAccount } = await import('./billing/creditLedger');
  const { reserveSmsCredits, settleReservationOnAccept } = await import('./billing/creditReservation');
  await db.transaction(async (tx) => {
    await lockCreditAccount(tx, 'rc1');
    await appendLotGrant(tx, {
      salonId: 'rc1',
      bucket: 'purchased',
      amount: 10,
      expiresAt: null,
      idempotencyKey: `rc1_seed_${seq}`,
      reason: 'seed',
    });
  });
  const reserved = await reserveSmsCredits({
    salonId: 'rc1',
    dedupeKey: `rc1_res_${seq}`,
    segments: predictedSegments,
  });
  const reservationId = (reserved as { reservationId: string }).reservationId;
  await settleReservationOnAccept({ reservationId, providerSid: `SM_rc_${seq}` });
  const deliveryId = `nd_rc_${seq}`;
  await db.insert(schema.notificationDeliverySchema).values({
    id: deliveryId,
    salonId: 'rc1',
    channel: 'sms',
    purpose: 'intent:test',
    dedupeKey: `dk_rc_${seq}`,
    status: 'delivered',
    statusRank: 50,
    creditReservationId: reservationId,
    settlementState: 'settled',
    segmentCount: predictedSegments,
  });
  return { deliveryId, reservationId };
}

async function enqueueDue(deliveryId: string, providerMessageId: string): Promise<void> {
  const { enqueueTwilioCostReconciliation } = await import('./integrationOutbox');
  await enqueueTwilioCostReconciliation({
    salonId: 'rc1',
    appointmentId: null,
    deliveryId,
    providerMessageId,
  });
  // The 15-minute settle delay is policy; make the job due now for the test.
  await db.execute(sql`
    UPDATE integration_outbox SET available_at = now() - interval '1 minute'
    WHERE dedupe_key = ${`twilio:reconcile:${deliveryId}`}
  `);
}

async function jobRow(deliveryId: string): Promise<Record<string, unknown>> {
  const rows = await db.execute(sql`
    SELECT status, attempts, last_error FROM integration_outbox
    WHERE dedupe_key = ${`twilio:reconcile:${deliveryId}`}
  `);
  return rows.rows[0] as Record<string, unknown>;
}

async function deliveryRow(deliveryId: string): Promise<Record<string, unknown>> {
  const rows = await db.execute(sql`
    SELECT provider_segments, provider_price_raw, provider_currency, anomaly_code, reconciled_at
    FROM notification_delivery WHERE id = ${deliveryId}
  `);
  return rows.rows[0] as Record<string, unknown>;
}

describe('Twilio cost reconciliation over the outbox', () => {
  it('retries while no fetcher is configured (Gate B ships none)', async () => {
    const { processIntegrationOutbox, setTwilioCostFetcher } = await import('./integrationOutbox');
    setTwilioCostFetcher(null);
    const { deliveryId } = await seedSettledDelivery(1, 2);
    await enqueueDue(deliveryId, 'SM_rc_1');
    await processIntegrationOutbox();

    expect(await jobRow(deliveryId)).toMatchObject({
      status: 'retry',
      last_error: 'TWILIO_COST_FETCHER_UNCONFIGURED',
    });
    expect((await deliveryRow(deliveryId)).reconciled_at).toBeNull();
  });

  it('actual == predicted: records provider truth, no anomaly, no ledger writes', async () => {
    const { processIntegrationOutbox, setTwilioCostFetcher } = await import('./integrationOutbox');
    setTwilioCostFetcher(async () => ({ priceRaw: '-0.0079', priceCurrency: 'USD', numSegments: 2 }));
    const { deliveryId } = await seedSettledDelivery(2, 2);
    await enqueueDue(deliveryId, 'SM_rc_2');
    const before = await db.execute(sql`SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = 'rc1'`);
    await processIntegrationOutbox();

    expect(await jobRow(deliveryId)).toMatchObject({ status: 'completed' });
    expect(await deliveryRow(deliveryId)).toMatchObject({
      provider_segments: 2,
      provider_price_raw: '-0.0079',
      provider_currency: 'USD',
      anomaly_code: null,
    });

    const after = await db.execute(sql`SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = 'rc1'`);

    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('actual > predicted: salon is never charged more — anomaly recorded, zero additional debits', async () => {
    const { processIntegrationOutbox, setTwilioCostFetcher } = await import('./integrationOutbox');
    setTwilioCostFetcher(async () => ({ priceRaw: '-0.0158', priceCurrency: 'USD', numSegments: 3 }));
    const { deliveryId } = await seedSettledDelivery(3, 2);
    await enqueueDue(deliveryId, 'SM_rc_3');
    const before = await db.execute(sql`SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = 'rc1'`);
    await processIntegrationOutbox();

    expect(await deliveryRow(deliveryId)).toMatchObject({
      provider_segments: 3,
      anomaly_code: 'segment_mismatch_underpredicted',
    });

    const after = await db.execute(sql`SELECT COUNT(*)::int AS n FROM sms_credit_ledger WHERE salon_id = 'rc1'`);

    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('actual < predicted: refunds exactly the overpredicted segments, exactly once under replay', async () => {
    const { processIntegrationOutbox, setTwilioCostFetcher } = await import('./integrationOutbox');
    setTwilioCostFetcher(async () => ({ priceRaw: '-0.0079', priceCurrency: 'USD', numSegments: 1 }));
    const { deliveryId, reservationId } = await seedSettledDelivery(4, 3);
    await enqueueDue(deliveryId, 'SM_rc_4');
    await processIntegrationOutbox();

    expect(await deliveryRow(deliveryId)).toMatchObject({
      provider_segments: 1,
      anomaly_code: 'segment_mismatch_overpredicted',
    });

    const refunds = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::int AS total, COUNT(*)::int AS n FROM sms_credit_ledger
      WHERE salon_id = 'rc1' AND idempotency_key LIKE ${'segment-overpredict-refund:%'}
    `);

    expect(refunds.rows[0]).toMatchObject({ total: 2 });

    // Replay: re-enqueue after completion and run again — the providerSegments
    // guard plus per-lot idempotency keys must keep the refund at exactly 2.
    const { refundOverpredictedSegments } = await import('./billing/creditReservation');
    const replay = await refundOverpredictedSegments({ reservationId, actualSegments: 1 });

    expect(replay.refundedSegments).toBe(0);

    const again = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::int AS total FROM sms_credit_ledger
      WHERE salon_id = 'rc1' AND idempotency_key LIKE ${'segment-overpredict-refund:%'}
    `);

    expect((again.rows[0] as Record<string, unknown>).total).toBe(2);
  });

  it('missing/zero actuals stay unresolved and retry on backoff', async () => {
    const { processIntegrationOutbox, setTwilioCostFetcher } = await import('./integrationOutbox');
    setTwilioCostFetcher(async () => ({ priceRaw: null, priceCurrency: null, numSegments: 0 }));
    const { deliveryId } = await seedSettledDelivery(5, 2);
    await enqueueDue(deliveryId, 'SM_rc_5');
    await processIntegrationOutbox();

    expect(await jobRow(deliveryId)).toMatchObject({
      status: 'retry',
      last_error: 'PROVIDER_ACTUALS_UNAVAILABLE',
    });
    expect((await deliveryRow(deliveryId)).reconciled_at).toBeNull();
  });

  it('twilio job exhaustion is ops-only: the salon owner is NEVER emailed', async () => {
    const { processIntegrationOutbox, setTwilioCostFetcher } = await import('./integrationOutbox');
    setTwilioCostFetcher(null);
    const { deliveryId } = await seedSettledDelivery(6, 2);
    await enqueueDue(deliveryId, 'SM_rc_6');
    // Push the job to the exhaustion boundary: next failure terminalizes.
    await db.execute(sql`
      UPDATE integration_outbox SET attempts = 7
      WHERE dedupe_key = ${`twilio:reconcile:${deliveryId}`}
    `);
    sendTransactionalEmail.mockClear();
    await processIntegrationOutbox();

    expect(await jobRow(deliveryId)).toMatchObject({ status: 'failed' });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
