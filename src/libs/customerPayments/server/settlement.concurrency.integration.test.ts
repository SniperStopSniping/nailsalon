/** Real PostgreSQL only; no target means skip, never an application DB fallback. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import { purgeSalonGroups, SalonPurgeBlockedError } from '@/libs/salonPurge';
import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { settleSyntheticCustomerPaymentCapture } from './settleSyntheticCapture';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_LEDGER_TEST_DATABASE_URL ?? '';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (process.env.CUSTOMER_PAYMENT_LEDGER_PG_REQUIRED === 'true') {
  throw new Error('Synthetic capture PostgreSQL required but CUSTOMER_PAYMENT_LEDGER_TEST_DATABASE_URL absent.');
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
async function counts(appointmentId: string) {
  return (await clients[0]!.query<{ captures: number; payments: number }>(`SELECT
    (SELECT count(*)::integer FROM customer_payment_capture WHERE appointment_id=$1) AS captures,
    (SELECT count(*)::integer FROM appointment_payment WHERE appointment_id=$1) AS payments`, [appointmentId])).rows[0]!;
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

suite('synthetic capture — attested PostgreSQL concurrency', () => {
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

  it.each([true, false])('legacy appointment purge safely handles contention=%s', async (contended) => {
    const id = `purge_${randomUUID()}`;
    await database.insert(schema.salonSchema).values({ id, slug: id, name: 'Private purge fixture' });
    await database.insert(schema.technicianSchema).values({ id, salonId: id, name: 'Fixture technician' });
    await database.insert(schema.serviceSchema).values({ id, salonId: id, name: 'Fixture service', price: 100, durationMinutes: 30, category: 'manicure' });
    await database.insert(schema.appointmentSchema).values({ id, salonId: id, technicianId: id, clientPhone: '4165550111', startTime: new Date(), endTime: new Date(Date.now() + 1800000), totalPrice: 100, totalDurationMinutes: 30, status: 'confirmed' });
    await database.insert(schema.appointmentServicesSchema).values({ id, appointmentId: id, serviceId: id, priceAtBooking: 100, durationAtBooking: 30 });
    const before = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, id));
    const childrenBefore = await database.select().from(schema.appointmentServicesSchema).where(eq(schema.appointmentServicesSchema.appointmentId, id));
    if (contended) {
      await clients[0]!.query('BEGIN');
      await clients[0]!.query('SELECT id FROM appointment WHERE id=$1 FOR UPDATE', [id]);
    }
    try {
      const purge = databases[1]!.transaction(tx => purgeSalonGroups(tx, id, ['appointments']));
      if (contended) {
        await expect(purge).rejects.toBeInstanceOf(SalonPurgeBlockedError);
      } else {
        const result = await purge;

        expect(result.counts.appointment).toBe(1);
        expect(result.counts.appointment_services).toBe(1);
      }
    } finally {
      if (contended) {
        await clients[0]!.query('ROLLBACK');
      }
    }

    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, id))).toEqual(contended ? before : []);
    expect(await database.select().from(schema.appointmentServicesSchema).where(eq(schema.appointmentServicesSchema.appointmentId, id))).toEqual(contended ? childrenBefore : []);
  }, 20000);

  it('refuses purge before deletion when a client-first writer waits on its salon lock', async () => {
    const id = `purge_${randomUUID()}`;
    await database.insert(schema.salonSchema).values({ id, slug: id, name: 'Private purge fixture' });
    await database.insert(schema.technicianSchema).values({ id, salonId: id, name: 'Fixture technician' });
    await database.insert(schema.serviceSchema).values({ id, salonId: id, name: 'Fixture service', price: 100, durationMinutes: 30, category: 'manicure' });
    await database.insert(schema.appointmentSchema).values({ id, salonId: id, technicianId: id, clientPhone: '4165550111', startTime: new Date(), endTime: new Date(Date.now() + 1800000), totalPrice: 100, totalDurationMinutes: 30, status: 'confirmed' });
    await database.insert(schema.appointmentServicesSchema).values({ id, appointmentId: id, serviceId: id, priceAtBooking: 100, durationAtBooking: 30 });
    await database.insert(schema.salonClientSchema).values({ id, salonId: id, phone: '4165550111' });
    const before = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, id));
    const childrenBefore = await database.select().from(schema.appointmentServicesSchema).where(eq(schema.appointmentServicesSchema.appointmentId, id));
    await clients[2]!.query('BEGIN');
    await clients[2]!.query('SELECT id FROM salon_client WHERE id=$1 FOR UPDATE', [id]);
    let competitor: Promise<pg.QueryResult> | undefined;
    try {
      const purge = databases[1]!.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM salon WHERE id=${id} FOR UPDATE`);
        competitor = clients[2]!.query('SELECT id FROM salon WHERE id=$1 FOR SHARE', [id]);
        // Observe the real client-first/salon-waiting half of the cycle before
        // calling the production prelock. NOWAIT must break it before deletes.
        void competitor.catch(() => {});
        await blockedBy(pids[2]!, pids[1]!);
        return purgeSalonGroups(tx, id, ['appointments']);
      });

      await expect(purge).rejects.toBeInstanceOf(SalonPurgeBlockedError);
      expect((await competitor!).rows).toHaveLength(1);

      await clients[2]!.query('COMMIT');
    } finally {
      await clients[2]!.query('ROLLBACK');
    }

    expect(await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, id))).toEqual(before);
    expect(await database.select().from(schema.appointmentServicesSchema).where(eq(schema.appointmentServicesSchema.appointmentId, id))).toEqual(childrenBefore);
    expect(await database.select().from(schema.salonClientSchema).where(eq(schema.salonClientSchema.id, id))).toHaveLength(1);
  }, 20000);

  it.each(['identical', 'distinct'] as const)('serializes %s capture intents without duplicate posting', async (kind) => {
    const f = await captureFixture();
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
    const first = settleSyntheticCustomerPaymentCapture(wrapped as never, f.evidence);
    const firstHandled = Promise.allSettled([first.finally(() => entered.release())]);
    await entered.promise;
    const second = settleSyntheticCustomerPaymentCapture(databases[2]!, kind === 'identical' ? f.evidence : { ...f.evidence, eventId: randomUUID(), paymentIntentId: `pi_${randomUUID()}` });
    const outcomes = Promise.allSettled([first, second]);
    try {
      await blockedBy(pids[2]!, pids[1]!);
    } finally {
      release.release();
      await outcomes;
    }
    await firstHandled;
    const results = await outcomes;

    expect(results.every(result => result.status === 'fulfilled')).toBe(true);

    if (kind === 'identical') {
      expect(results[0]).toEqual(results[1]);
      expect(await counts(f.appointmentId)).toEqual({ captures: 1, payments: 1 });
    } else {
      expect(results.map(result => result.status === 'fulfilled' ? result.value.state : 'failed')).toEqual(['posted', 'held_review']);
      expect(await counts(f.appointmentId)).toEqual({ captures: 2, payments: 2 });
    }

    expect((await f.load()).amountPaidCents).toBe(12000);
    expect((await f.load()).tipCents).toBe(2000);
  }, 20000);

  it('returns retry/no acknowledgement when initial salon FK pin is blocked', async () => {
    const f = await captureFixture();
    await clients[0]!.query('BEGIN');
    await clients[0]!.query('SELECT id FROM salon WHERE id=$1 FOR UPDATE', [f.salonId]);
    try {
      await expect(settleSyntheticCustomerPaymentCapture(databases[1]!, f.evidence)).rejects.toThrow('RETRY_REQUIRED');
    } finally {
      await clients[0]!.query('ROLLBACK');
    }

    expect(await counts(f.appointmentId)).toEqual({ captures: 0, payments: 0 });
    expect((await settleSyntheticCustomerPaymentCapture(databases[1]!, f.evidence)).state).toBe('posted');
  }, 20000);

  it('retains review evidence when salon SHARE is busy but FK KEY SHARE is compatible', async () => {
    const f = await captureFixture();
    const before = await f.load();
    await clients[0]!.query('BEGIN');
    await clients[0]!.query('SELECT id FROM salon WHERE id=$1 FOR NO KEY UPDATE', [f.salonId]);
    try {
      const capture = await settleSyntheticCustomerPaymentCapture(databases[1]!, f.evidence);

      expect(capture).toMatchObject({ state: 'held_review', reviewReason: 'CAPTURE_SOURCE_BUSY', amountCents: 12000 });
    } finally {
      await clients[0]!.query('ROLLBACK');
    }

    expect(await counts(f.appointmentId)).toEqual({ captures: 1, payments: 1 });
    expect(await f.load()).toEqual(before);
  }, 20000);

  it('replays accepted evidence while the salon is exclusively locked without new rows', async () => {
    const f = await captureFixture();
    const original = await settleSyntheticCustomerPaymentCapture(databases[1]!, f.evidence);
    await clients[0]!.query('BEGIN');
    await clients[0]!.query('SELECT id FROM salon WHERE id=$1 FOR UPDATE', [f.salonId]);
    try {
      expect(await settleSyntheticCustomerPaymentCapture(databases[1]!, f.evidence)).toEqual(original);
    } finally {
      await clients[0]!.query('ROLLBACK');
    }

    expect(await counts(f.appointmentId)).toEqual({ captures: 1, payments: 1 });

    const receipts = await clients[0]!.query('SELECT id FROM customer_payment_capture_event WHERE capture_id=$1', [original.id]);

    expect(receipts.rows).toHaveLength(1);
  }, 20000);

  it.each(['item', 'addon', 'deposit'] as const)('blocks a concurrent %s insertion before its marker check can miss capture', async (kind) => {
    const f = await captureFixture();
    const extraService = `extra_${randomUUID()}`;
    await database.insert(schema.serviceSchema).values({ id: extraService, salonId: f.salonId, name: 'Extra fixture', price: 100, durationMinutes: 5, category: 'manicure' });
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
    const capture = settleSyntheticCustomerPaymentCapture(wrapped as never, f.evidence);
    const handled = Promise.allSettled([capture.finally(() => entered.release())]);
    await entered.promise;
    try {
      const mutation = kind === 'item'
        ? databases[2]!.insert(schema.appointmentServicesSchema).values({ id: randomUUID(), appointmentId: f.appointmentId, serviceId: extraService, priceAtBooking: 100, durationAtBooking: 5 })
        : kind === 'addon'
          ? databases[2]!.insert(schema.appointmentAddOnSchema).values({ id: randomUUID(), appointmentId: f.appointmentId, appointmentServiceId: f.serviceSnapshotId, nameSnapshot: 'Extra', categorySnapshot: 'nail_art', pricingTypeSnapshot: 'fixed', unitPriceCentsSnapshot: 100, durationMinutesSnapshot: 5, lineTotalCentsSnapshot: 100, lineDurationMinutesSnapshot: 5 })
          : databases[2]!.insert(schema.appointmentDepositSchema).values({ id: randomUUID(), salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 100, status: 'pending', stripeAccountId: f.evidence.stripeAccountId });
      const failure = await mutation.then(() => null, error => error);

      expect(failure?.cause?.code ?? failure?.code).toBe('55P03');
    } finally {
      release.release();
      await handled;
    }

    expect((await capture).state).toBe('posted');
    expect(await counts(f.appointmentId)).toEqual({ captures: 1, payments: 1 });

    const deposits = await clients[0]!.query('SELECT id FROM appointment_deposit WHERE appointment_id=$1', [f.appointmentId]);

    expect(deposits.rows).toEqual([]);
  }, 20000);
});
