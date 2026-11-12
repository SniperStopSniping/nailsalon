/** Real PostgreSQL only; no target means skip, never an application DB fallback. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { bindSyntheticApplicationFee, recordSyntheticApplicationFeeRefund, recordSyntheticCustomerRefund } from './recordSyntheticRefund';
import { settleSyntheticCustomerPaymentCapture } from './settleSyntheticCapture';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_REFUND_TEST_DATABASE_URL ?? '';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (process.env.CUSTOMER_PAYMENT_REFUND_PG_REQUIRED === 'true') {
  throw new Error('Synthetic capture PostgreSQL required but CUSTOMER_PAYMENT_REFUND_TEST_DATABASE_URL absent.');
}
const suite = target ? describe.sequential : describe.skip;
type Database = NodePgDatabase<typeof schema>;
const clients: pg.PoolClient[] = [];
const databases: Database[] = [];
const pids: number[] = [];
let pool: pg.Pool | undefined;
let database: Database;
let repository: ReturnType<typeof createCustomerPaymentPreparationRepository>;
let index = 0;
const runId = randomUUID().slice(0, 8);
const settings = { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true };
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function blockedBy(waiter: number, blocker: number) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const result = await clients[3]!.query<{ blockers: number[] }>('SELECT pg_blocking_pids($1) AS blockers', [waiter]);
    if (result.rows[0]?.blockers.includes(blocker)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected actual appointment lock contention was not observed.');
}
function sqlLock(appointmentId: string) {
  return sql`SELECT id FROM appointment WHERE id=${appointmentId} FOR UPDATE`;
}
async function fixture() {
  index += 1;
  const salonId = `capture_pg_${runId}_salon_${index}`;
  const appointmentId = `capture_pg_${runId}_appointment_${index}`;
  const tokenId = `capture_pg_${runId}_capability_${index}`;
  const bindingId = `capture_pg_${runId}_binding_${index}`;
  const serviceId = `capture_pg_${runId}_service_${index}`;
  const serviceSnapshotId = `capture_pg_${runId}_service_snapshot_${index}`;
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const future = (offset: number) => new Date(now.getTime() + offset);
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Synthetic salon', status: 'active', publicationStatus: 'published' });
  await database.insert(schema.technicianSchema).values({ id: `capture_pg_${runId}_tech_${index}`, salonId, name: 'Synthetic technician' });
  await database.insert(schema.serviceSchema).values({ id: serviceId, salonId, name: 'Fixed service', price: 10000, durationMinutes: 60, category: 'manicure' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId: `capture_pg_${runId}_tech_${index}`, clientPhone: '4165550111', clientName: 'PRIVATE_NAME', notes: 'PRIVATE_NOTE', startTime: future(86400000), endTime: future(90000000), totalPrice: 10000, basePriceCents: 10000, addOnsPriceCents: 0, subtotalBeforeDiscountCents: 10000, totalDurationMinutes: 60, status: 'confirmed', invoiceCurrency: 'CAD', bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals: { finalPriceCents: 10000, taxableSubtotalCents: 0, taxAmountCents: 0, taxApplied: false }, currency: 'CAD', capturedAt: now }) });
  await database.insert(schema.appointmentServicesSchema).values({ id: serviceSnapshotId, appointmentId, serviceId, priceAtBooking: 10000, durationAtBooking: 60 });
  await database.insert(schema.salonStripeAccountSchema).values({ id: bindingId, salonId, stripeAccountId: `acct_${runId}${index}`, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: now });
  await database.insert(schema.appointmentAccessTokenSchema).values({ id: tokenId, salonId, appointmentId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: future(3600000) });
  const policyInput = { salonId, actorId: 'synthetic_owner', expectedRevision: 0, requestId: randomUUID(), settings };
  await repository.saveCustomerPaymentSettingsDraft(policyInput);
  const request = { requestId: randomUUID(), tipCents: 2000 };
  const prepare = () => prepareCustomerPaymentQuoteForToken(database, token, request);
  return { salonId, appointmentId, tokenId, bindingId, serviceSnapshotId, token, policyInput, request, prepare };
}

async function captureFixture() {
  const f = await fixture();
  const quote = await f.prepare();
  const evidence = { quoteId: quote.id, eventId: `evt_${randomUUID()}`, paymentIntentId: `pi_${randomUUID()}`, stripeAccountId: quote.stripeAccountId, source: 'synthetic_test' as const, livemode: false as const, currency: 'cad', amountCents: quote.snapshot.chargeCents, applicationFeeCents: quote.snapshot.applicationFeeCents, capturedAt: new Date() };
  const load = async () => (await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId)))[0]!;
  const payments = () => database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, f.appointmentId));
  return { ...f, quote, evidence, load, payments };
}

suite('synthetic refund — attested PostgreSQL concurrency', () => {
  beforeAll(async () => {
    if (!target) {
      throw new Error('Disposable target absent inside active suite.');
    }
    const expected = resolveDisposableDatabaseServerExpectation(target);
    pool = new pg.Pool({ connectionString: target.connectionString, max: 4, connectionTimeoutMillis: 5000 });
    for (let i = 0; i < 4; i += 1) {
      const client = await pool.connect();
      clients.push(client);
      await attestDisposableDatabaseSession(client, target, expected);
      await client.query('SET statement_timeout=\'15s\'; SET lock_timeout=\'8s\'; SET idle_in_transaction_session_timeout=\'20s\'');
      const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      pids.push(result.rows[0]!.pid);
      databases.push(drizzle(client, { schema }));
    }

    expect(new Set(pids).size).toBe(4);

    database = databases[0]!;
    repository = createCustomerPaymentPreparationRepository(database);
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'true');
    vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('VERCEL', '');
  }, 120000);

  afterAll(async () => {
    // Immutable money fixtures intentionally survive until the PRIVATE
    // disposable cluster is torn down; never disable their deletion guards.
    for (const client of clients) {
      client.release();
    }
    await pool?.end();
    vi.unstubAllEnvs();
  }, 30000);

  it.each(['identical', 'partial', 'overflow'] as const)('serializes %s refund evidence with atomic cache', async (kind) => {
    const f = await captureFixture();
    const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const firstEvidence = { captureId: capture.id, stripeAccountId: capture.stripeAccountId, paymentIntentId: capture.paymentIntentId, currency: 'cad' as const, mode: 'test' as const, source: 'synthetic_test' as const, occurredAt: new Date(), eventId: randomUUID(), refundId: randomUUID(), status: 'succeeded' as const, amountCents: 6000, principalCents: 5000, tipCents: 1000 };
    const entered = barrier();
    const release = barrier();
    const wrapped = {
      select: databases[1]!.select.bind(databases[1]),
      transaction: (callback: Parameters<Database['transaction']>[0]) => databases[1]!.transaction(async (tx) => {
        await tx.execute(sqlLock(f.appointmentId));
        entered.release();
        await release.promise;
        return callback(tx);
      }),
    };
    const before = await f.load();
    const first = recordSyntheticCustomerRefund(wrapped as never, firstEvidence);
    const handled = Promise.allSettled([first.finally(() => entered.release())]);
    await entered.promise;
    const secondEvidence = kind === 'identical' ? firstEvidence : { ...firstEvidence, eventId: randomUUID(), refundId: randomUUID(), ...(kind === 'overflow' ? { amountCents: 7000, principalCents: 6000, tipCents: 1000 } : {}) };
    const second = recordSyntheticCustomerRefund(databases[2]!, secondEvidence);
    const outcomes = Promise.allSettled([first, second]);
    try {
      await blockedBy(pids[2]!, pids[1]!);
    } finally {
      release.release();
      await outcomes;
      await handled;
    }

    expect((await first).state).toBe('applied');
    expect((await second).state).toBe(kind === 'overflow' ? 'held_review' : 'applied');
    expect((await f.load()).amountPaidCents).toBe(kind === 'partial' ? 0 : 6000);
    expect((await f.load()).tipCents).toBe(2000);
    expect((await f.load()).updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect((await f.payments())[0]!.amountCents).toBe(12000);

    const rows = await clients[0]!.query('SELECT id FROM customer_payment_refund WHERE capture_id=$1', [capture.id]);

    expect(rows.rows).toHaveLength(kind === 'identical' ? 1 : 2);
  }, 20000);

  it.each(['insert', 'update', 'delete'] as const)('fences raw tender %s before refund hold lookup', async (operation) => {
    const f = await captureFixture();
    const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const manualId = randomUUID();
    await databases[0]!.transaction(async (tx) => {
      await tx.execute(sqlLock(f.appointmentId));
      await tx.update(schema.appointmentSchema).set({ tipCents: 2500 }).where(eq(schema.appointmentSchema.id, f.appointmentId));
      await tx.insert(schema.appointmentPaymentSchema).values({ id: manualId, salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 500, method: 'cash', recordedByType: 'system' });
      await tx.update(schema.appointmentSchema).set({ amountPaidCents: 12500 }).where(eq(schema.appointmentSchema.id, f.appointmentId));
    });
    const entered = barrier();
    const release = barrier();
    const wrapped = {
      select: databases[1]!.select.bind(databases[1]),
      transaction: (callback: Parameters<Database['transaction']>[0]) => databases[1]!.transaction(async (tx) => {
        await tx.execute(sqlLock(f.appointmentId));
        entered.release();
        await release.promise;
        return callback(tx);
      }),
    };
    const refund = recordSyntheticCustomerRefund(wrapped as never, { captureId: capture.id, stripeAccountId: capture.stripeAccountId, paymentIntentId: capture.paymentIntentId, currency: 'cad', mode: 'test', source: 'synthetic_test', occurredAt: new Date(), eventId: randomUUID(), refundId: randomUUID(), status: 'succeeded', amountCents: 100, principalCents: 100, tipCents: 0 });
    const handled = Promise.allSettled([refund.finally(() => entered.release())]);
    await entered.promise;
    const mutation = () => operation === 'insert'
      ? databases[2]!.insert(schema.appointmentPaymentSchema).values({ id: randomUUID(), salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 1, method: 'cash', recordedByType: 'system' })
      : operation === 'update'
        ? databases[2]!.update(schema.appointmentPaymentSchema).set({ amountCents: 501 }).where(eq(schema.appointmentPaymentSchema.id, manualId))
        : databases[2]!.delete(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.id, manualId));
    try {
      const failure = await mutation().then(() => null, error => error);

      expect(failure?.cause?.code ?? failure?.code).toBe('55P03');
    } finally {
      release.release();
      await handled;
    }

    expect((await refund).state).toBe('applied');
    expect((await f.load()).amountPaidCents).toBe(12400);
    expect((await f.payments()).find(row => row.id === manualId)?.amountCents).toBe(500);

    const heldFailure = await mutation().then(() => null, error => error);

    expect(heldFailure?.cause?.message ?? heldFailure?.message).toContain('REFUND_RECONCILIATION_REQUIRED');
  }, 20000);

  it('serializes independent fee refunds so cumulative evidence cannot apply twice', async () => {
    const f = await captureFixture();
    const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const identity = { captureId: capture.id, stripeAccountId: capture.stripeAccountId, paymentIntentId: capture.paymentIntentId, currency: 'cad' as const, mode: 'test' as const, source: 'synthetic_test' as const, occurredAt: new Date() };
    await recordSyntheticCustomerRefund(database, { ...identity, eventId: randomUUID(), refundId: randomUUID(), status: 'succeeded', amountCents: 12000, principalCents: 10000, tipCents: 2000 });
    await bindSyntheticApplicationFee(database, { ...identity, eventId: randomUUID(), applicationFeeId: `fee_${runId}`, amountCents: 100 });
    const results = await Promise.all([1, 2].map(n => recordSyntheticApplicationFeeRefund(databases[n]!, { ...identity, eventId: randomUUID(), applicationFeeId: `fee_${runId}`, feeRefundId: randomUUID(), status: 'succeeded', amountCents: 75 })));

    expect(results.map(result => result.state).sort()).toEqual(['applied', 'held_review']);
    expect((await f.load()).amountPaidCents).toBe(0);
  }, 20000);
});
