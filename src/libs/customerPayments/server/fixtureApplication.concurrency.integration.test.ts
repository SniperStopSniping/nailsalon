import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import { customerPaymentCaptureSchema as captures } from '@/models/customerPaymentSchema';
import * as schema from '@/models/Schema';

import { verifyOfflineProviderReceipt } from '../provider/evidence';
import { createProviderFixtureCaptureApplication } from './applyProviderFixtureCapture';
import { readOfflineFixtureCaptureEvidence } from './fixtureApplicationReader';
import { createFixtureCaptureGraph, signFixtureCapturePayload } from './fixtureApplicationTestSupport';
import { withProviderFixtureTransaction } from './providerFixtureFence';
import { createProviderJournal } from './providerJournal';
import { settleSyntheticCustomerPaymentCapture } from './settleSyntheticCapture';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_FIXTURE_APPLICATION_TEST_DATABASE_URL ?? '';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (process.env.CUSTOMER_PAYMENT_FIXTURE_APPLICATION_PG_REQUIRED === 'true') {
  throw new Error('Fixture application PG target required but absent');
}
const suite = target ? describe.sequential : describe.skip;
type Database = NodePgDatabase<typeof schema>;
const clients: pg.PoolClient[] = [];
const databases: Database[] = [];
let pool: pg.Pool | undefined;
let database: Database;
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function code(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}
async function unknownReceipt(f: Awaited<ReturnType<typeof createFixtureCaptureGraph>>) {
  const payload = { ...f.chargePayload, id: `evt_${randomUUID().replaceAll('-', '')}`, type: 'unknown.money' };
  const signed = signFixtureCapturePayload(payload);
  return verifyOfflineProviderReceipt(signed.input, f.config, signed.verifier);
}
async function appliedFixture() {
  const f = await createFixtureCaptureGraph(database, { tipCents: 500 });
  const application = await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });

  expect(application.state).toBe('applied');

  return { ...f, application };
}
async function revision(platformId: string) {
  return Number((await clients[0]!.query('SELECT revision FROM customer_payment_fixture_platform WHERE platform_id=$1', [platformId])).rows[0].revision);
}
async function holdCount(applicationId: string) {
  return Number((await clients[0]!.query('SELECT count(*)::int AS n FROM customer_payment_fixture_hold WHERE application_id=$1', [applicationId])).rows[0].n);
}

suite('offline canonical fixture application — attested PostgreSQL concurrency', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('target missing');
    }
    const expected = resolveDisposableDatabaseServerExpectation(target);
    pool = new pg.Pool({ connectionString: target.connectionString, max: 4, connectionTimeoutMillis: 5000 });
    for (let i = 0; i < 4; i += 1) {
      const client = await pool.connect();
      clients.push(client);
      await attestDisposableDatabaseSession(client, target, expected);
      await client.query('SET statement_timeout=\'15s\'; SET lock_timeout=\'8s\'; SET idle_in_transaction_session_timeout=\'20s\'');
      databases.push(drizzle(client, { schema }));
    }
    database = databases[0]!;
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    for (const [key, value] of Object.entries({ NODE_ENV: 'test', APP_ENV: 'development', VERCEL_ENV: '', VERCEL: '', CUSTOMER_PAYMENTS_PREPARATION_ENABLED: 'true', CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED: 'true', CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED: 'true', CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED: 'true' })) {
      vi.stubEnv(key, value);
    }
  }, 120000);

  afterAll(async () => {
    for (const client of clients) {
      client.release();
    }
    await pool?.end();
    vi.unstubAllEnvs();
  }, 30000);

  it('concurrent applications create one exact binding and gross tender, then replay', async () => {
    const f = await createFixtureCaptureGraph(database);
    const outcomes = await Promise.allSettled([createProviderFixtureCaptureApplication(databases[1]!).applyCapture({ operationId: f.identity.id }), createProviderFixtureCaptureApplication(databases[2]!).applyCapture({ operationId: f.identity.id })]);

    expect(outcomes.some(r => r.status === 'fulfilled' && r.value.state === 'applied')).toBe(true);

    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(['55P03', '40001', '40P01']).toContain(code(outcome.reason));
      }
    }
    const replay = await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });

    expect(replay.state).toBe('replayed');
    expect((await clients[0]!.query('SELECT id FROM customer_payment_fixture_application WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(1);
    expect((await clients[0]!.query('SELECT id FROM appointment_payment WHERE appointment_id=$1', [f.appointmentId])).rows).toHaveLength(1);
  }, 20000);

  it('source cannot enter an uncommitted application fence; retry after commit creates permanent hold', async () => {
    const f = await createFixtureCaptureGraph(database);
    const receipt = await unknownReceipt(f);
    const entered = barrier();
    const release = barrier();
    const wrapped = { select: databases[1]!.select.bind(databases[1]), transaction: (callback: Parameters<Database['transaction']>[0], options: Parameters<Database['transaction']>[1]) => databases[1]!.transaction(async (tx) => {
      const result = await callback(tx);
      entered.release();
      await release.promise;
      return result;
    }, options) };
    const applying = createProviderFixtureCaptureApplication(wrapped as never).applyCapture({ operationId: f.identity.id });
    const handled = Promise.allSettled([applying.finally(() => entered.release())]);
    await entered.promise;
    try {
      await expect(createProviderJournal(databases[2]!).ingestReceipt(receipt)).rejects.toSatisfy(error => code(error) === '55P03');
    } finally {
      release.release();
      await handled;
    }
    const applied = await applying;

    expect(applied.state).toBe('applied');

    await createProviderJournal(databases[2]!).ingestReceipt(receipt);

    expect(await holdCount(applied.applicationId!)).toBeGreaterThan(0);
    expect((await clients[0]!.query('SELECT amount_cents,voided_at FROM appointment_payment WHERE id=$1', [applied.tenderId])).rows[0]).toEqual({ amount_cents: f.snapshot.chargeCents, voided_at: null });
  }, 20000);

  it('losing ON CONFLICT duplicates and harmless delivery/inspection do not advance material revision', async () => {
    const f = await appliedFixture();
    const before = await revision(f.config.platformId);
    await Promise.all([createProviderJournal(databases[1]!).ingestReceipt(f.pair.receipt), createProviderJournal(databases[2]!).ingestReceipt(f.pair.receipt)]);
    const row = f.receipts[1]!.inbox;
    await withProviderFixtureTransaction(database, async (tx) => {
      await tx.insert(schema.customerPaymentProviderInboxSchema).values({ ...row, id: randomUUID() }).onConflictDoNothing();
    });
    await f.journal.ensureDelivery(f.sessionInbox.id, 'fixture_inspection', 1);
    await f.correlation.correlateOperation(f.identity.id);

    expect(await revision(f.config.platformId)).toBe(before);
    expect(await holdCount(f.application.applicationId!)).toBe(0);
    expect((await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).state).toBe('replayed');
  }, 20000);

  it('a source transaction rollback leaves no hold or material revision behind', async () => {
    const f = await appliedFixture();
    const before = await revision(f.config.platformId);
    const receipt = await unknownReceipt(f);

    await expect(withProviderFixtureTransaction(database, async (tx) => {
      const { receivedAt: _arrival, ...content } = receipt;
      const { providerCorrelationFingerprint } = await import('../provider/correlation');
      await tx.insert(schema.customerPaymentProviderInboxSchema).values({ id: randomUUID(), endpointId: receipt.endpointId, platformId: receipt.platformId, accountScope: receipt.accountScope, accountKey: receipt.accountId ?? '', mode: receipt.mode, receiptIdentity: receipt.receiptIdentity, fingerprint: providerCorrelationFingerprint(content), receipt: receipt as never });
      throw new Error('ROLL_BACK_FIXTURE_SOURCE');
    })).rejects.toThrow('ROLL_BACK_FIXTURE_SOURCE');
    expect(await revision(f.config.platformId)).toBe(before);
    expect(await holdCount(f.application.applicationId!)).toBe(0);
  }, 20000);

  it('an old RR appointment snapshot cannot miss a source commit and advance lifecycle', async () => {
    const f = await appliedFixture();
    const receipt = await unknownReceipt(f);
    await clients[1]!.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await clients[1]!.query('SELECT id FROM appointment WHERE id=$1', [f.appointmentId]);
      await createProviderJournal(databases[2]!).ingestReceipt(receipt);

      await expect(clients[1]!.query('UPDATE appointment SET status=\'in_progress\' WHERE id=$1', [f.appointmentId])).rejects.toSatisfy(error => code(error) === '40001');
    } finally {
      await clients[1]!.query('ROLLBACK');
    }

    expect((await clients[0]!.query('SELECT status FROM appointment WHERE id=$1', [f.appointmentId])).rows[0].status).toBe('confirmed');
    expect(await holdCount(f.application.applicationId!)).toBeGreaterThan(0);
  }, 20000);

  it('appointment-first and admission-first paths refuse contention without a deadlock', async () => {
    const f = await appliedFixture();
    const entered = barrier();
    const release = barrier();
    await clients[1]!.query('BEGIN');
    await clients[1]!.query('SELECT id FROM appointment WHERE id=$1 FOR UPDATE', [f.appointmentId]);
    const fenced = withProviderFixtureTransaction(databases[2]!, async (tx) => {
      entered.release();
      await release.promise;
      const rows = await tx.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId)).for('update', { noWait: true });
      return rows.length;
    });
    const handled = Promise.allSettled([fenced.finally(() => entered.release())]);
    await entered.promise;
    try {
      await expect(clients[1]!.query('UPDATE appointment SET status=\'in_progress\' WHERE id=$1', [f.appointmentId])).rejects.toSatisfy(error => code(error) === '55P03');
    } finally {
      await clients[1]!.query('ROLLBACK');
      release.release();
      await handled;
    }

    expect(await fenced).toBe(1);
  }, 20000);

  it('synthetic capture contention rolls back rather than acknowledging a fabricated review capture', async () => {
    const f = await createFixtureCaptureGraph(database);
    const evidence = { quoteId: f.quote.id, eventId: `evt_${randomUUID().replaceAll('-', '')}`, paymentIntentId: f.ids.intent, stripeAccountId: f.config.expectedAccountId!, source: 'synthetic_test' as const, livemode: false as const, currency: 'cad', amountCents: f.snapshot.chargeCents, applicationFeeCents: f.snapshot.applicationFeeCents, capturedAt: new Date(Number(f.receipts[1]!.receipt.normalizedFacts.created) * 1000) };
    const entered = barrier();
    const release = barrier();
    const held = withProviderFixtureTransaction(databases[2]!, async () => {
      entered.release();
      await release.promise;
    });
    const handled = Promise.allSettled([held.finally(() => entered.release())]);
    await entered.promise;
    try {
      await expect(settleSyntheticCustomerPaymentCapture(databases[1]!, evidence)).rejects.toSatisfy(error => code(error) === '55P03');
    } finally {
      release.release();
      await handled;
    }

    expect((await clients[0]!.query('SELECT id FROM customer_payment_capture WHERE appointment_id=$1', [f.appointmentId])).rows).toHaveLength(0);
    expect((await settleSyntheticCustomerPaymentCapture(databases[1]!, evidence)).state).toBe('posted');
  }, 20000);

  it('an old snapshot predating the first application cannot mutate its now-paid appointment', async () => {
    const f = await createFixtureCaptureGraph(database);
    await clients[1]!.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await clients[1]!.query('SELECT id FROM appointment WHERE id=$1', [f.appointmentId]);

      expect((await createProviderFixtureCaptureApplication(databases[2]!).applyCapture({ operationId: f.identity.id })).state).toBe('applied');
      await expect(clients[1]!.query('UPDATE appointment SET total_price=total_price+1 WHERE id=$1', [f.appointmentId])).rejects.toSatisfy(error => code(error) === '40001');
    } finally {
      await clients[1]!.query('ROLLBACK');
    }

    expect((await clients[0]!.query('SELECT amount_paid_cents,total_price FROM appointment WHERE id=$1', [f.appointmentId])).rows[0]).toEqual({ amount_paid_cents: f.snapshot.chargeCents, total_price: 10000 });
  }, 20000);

  it('deferred commit rejects a canonical fixture capture and tender without their binding', async () => {
    const f = await createFixtureCaptureGraph(database);
    const captureId = randomUUID();
    const tenderId = `cpay_${captureId}`;
    const at = new Date(Number(f.receipts[1]!.receipt.normalizedFacts.created) * 1000);

    await expect(withProviderFixtureTransaction(database, async (tx) => {
      await tx.insert(schema.appointmentPaymentSchema).values({ id: tenderId, salonId: f.salonId, appointmentId: f.appointmentId, amountCents: f.snapshot.chargeCents, method: 'online', reference: `customer_payment_capture:${captureId}`, recordedByType: 'system', recordedAt: at });
      await tx.insert(captures).values({ id: captureId, salonId: f.salonId, appointmentId: f.appointmentId, quoteId: f.quote.id, stripeAccountId: f.config.expectedAccountId!, source: 'offline_fixture_test', mode: 'test', paymentIntentId: f.ids.intent, tenderId, currency: 'cad', amountCents: f.snapshot.chargeCents, principalCents: f.snapshot.chargeCents - f.snapshot.tipCents, tipCents: f.snapshot.tipCents, applicationFeeCents: f.snapshot.applicationFeeCents, quotedApplicationFeeCents: f.snapshot.applicationFeeCents, state: 'posted', capturedAt: at, recordedAt: new Date(), fingerprint: 'a'.repeat(64) });
    })).rejects.toSatisfy(error => String(error).includes('BINDING_MISSING') || String((error as { cause?: unknown }).cause).includes('BINDING_MISSING'));
    expect((await clients[0]!.query('SELECT id FROM customer_payment_capture WHERE id=$1', [captureId])).rows).toHaveLength(0);
    expect((await clients[0]!.query('SELECT id FROM appointment_payment WHERE id=$1', [tenderId])).rows).toHaveLength(0);
  }, 20000);

  it('disabling new application writes preserves gross evidence and later permanent holds', async () => {
    const f = await appliedFixture();
    await f.journal.ingestReceipt(await unknownReceipt(f));
    vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false');
    try {
      const [capture] = await database.select().from(captures).where(eq(captures.id, f.application.captureId!));
      const evidence = await readOfflineFixtureCaptureEvidence(database, [capture!]);

      expect(evidence).toHaveLength(1);
      expect(evidence[0]!.holds.length).toBeGreaterThan(0);
      expect(capture!.amountCents).toBe(f.snapshot.chargeCents);
      await expect(createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).rejects.toThrow('FIXTURE_APPLICATION_DISABLED');
      await expect(clients[0]!.query('UPDATE appointment SET tip_cents=tip_cents+1 WHERE id=$1', [f.appointmentId])).rejects.toThrow('SOURCE_HOLD');
    } finally {
      vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'true');
    }
  }, 20000);
});
