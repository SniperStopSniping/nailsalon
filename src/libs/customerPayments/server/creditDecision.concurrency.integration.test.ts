/** Real PostgreSQL only; no target means skip, never an application DB fallback. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import { buildBookingTaxSnapshot, buildFinalTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { previewSyntheticCreditReview, recordSyntheticCreditDecision } from './recordSyntheticCreditDecision';
import { recordSyntheticCustomerRefund } from './recordSyntheticRefund';
import { settleSyntheticCustomerPaymentCapture } from './settleSyntheticCapture';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_CREDIT_TEST_DATABASE_URL ?? '';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (process.env.CUSTOMER_PAYMENT_CREDIT_PG_REQUIRED === 'true') {
  throw new Error('Synthetic capture PostgreSQL required but CUSTOMER_PAYMENT_CREDIT_TEST_DATABASE_URL absent.');
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

async function creditFixture() {
  const f = await captureFixture();
  const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
  const now = new Date();
  const totals = { finalPriceCents: 10000, taxableSubtotalCents: 0, taxAmountCents: 0, taxApplied: false };
  await database.update(schema.appointmentSchema).set({ status: 'completed', completedAt: now, finalPriceCents: 10000, finalSubtotalCents: 10000, finalDiscountCents: 0, taxEnabledSnapshot: false, taxNameSnapshot: null, taxRateBps: 0, taxInclusive: false, taxAmountCents: 0, taxableSubtotalCents: 0, taxExempt: false, taxExemptReason: null, paymentStatus: 'paid', finalTaxSnapshot: buildFinalTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals, capturedAt: now, currency: 'CAD', taxExempt: false, taxExemptReason: null }) }).where(eq(schema.appointmentSchema.id, f.appointmentId));
  const refund = { captureId: capture.id, stripeAccountId: capture.stripeAccountId, paymentIntentId: capture.paymentIntentId, currency: 'cad' as const, mode: 'test' as const, source: 'synthetic_test' as const, occurredAt: new Date(), eventId: randomUUID(), refundId: randomUUID(), status: 'succeeded' as const, amountCents: 3000, principalCents: 2500, tipCents: 500 };
  await recordSyntheticCustomerRefund(database, refund);
  const actor = { adminId: randomUUID(), authenticated: true as const, impersonating: false as const };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.adminSalonMembershipSchema).values({ adminId: actor.adminId, salonId: f.salonId, role: 'owner' });
  const scope = { salonId: f.salonId, appointmentId: f.appointmentId };
  const preview = await previewSyntheticCreditReview(database, actor, scope);
  const request = { ...scope, requestId: randomUUID(), expectedEvidenceRevision: preview.evidenceRevision, reason: 'Synthetic PG decision', serviceCreditCents: 2500, taxCreditCents: 0, tipCreditCents: 500 };
  return { ...f, capture, refund, actor, scope, preview, request };
}

suite('synthetic credit decisions — attested PostgreSQL concurrency', () => {
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
    vi.stubEnv('CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED', 'true');
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

  it.each(['identical', 'distinct'] as const)('serializes %s decision requests without duplicate credit', async (kind) => {
    const f = await creditFixture();
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
    const first = recordSyntheticCreditDecision(wrapped as never, f.actor, f.request);
    const handled = Promise.allSettled([first.finally(() => entered.release())]);
    await entered.promise;
    const second = recordSyntheticCreditDecision(databases[2]!, f.actor, kind === 'identical' ? f.request : { ...f.request, requestId: randomUUID() });
    const outcomes = Promise.allSettled([first, second]);
    try {
      await blockedBy(pids[2]!, pids[1]!);
    } finally {
      release.release();
      await outcomes;
      await handled;
    }

    expect((await first).replayed).toBe(false);

    if (kind === 'identical') {
      expect((await second).replayed).toBe(true);
    } else {
      await expect(second).rejects.toThrow('ALREADY_RECORDED');
    }

    expect((await clients[0]!.query('SELECT id FROM customer_payment_credit_decision WHERE appointment_id=$1', [f.appointmentId])).rows).toHaveLength(1);
    expect((await f.load()).amountPaidCents).toBe(9000);
  }, 20000);

  it('revalidates evidence after waiting behind a new refund and refuses stale credit', async () => {
    const f = await creditFixture();
    await clients[1]!.query('BEGIN');
    await clients[1]!.query('SELECT id FROM appointment WHERE id=$1 FOR UPDATE', [f.appointmentId]);
    const credit = recordSyntheticCreditDecision(databases[2]!, f.actor, f.request);
    const handled = Promise.allSettled([credit]);
    try {
      await blockedBy(pids[2]!, pids[1]!);
      // This connection already owns the outer transaction and parent lock.
      const sameTx = { select: databases[1]!.select.bind(databases[1]), transaction: (callback: Parameters<Database['transaction']>[0]) => callback(databases[1]! as never) };
      await recordSyntheticCustomerRefund(sameTx as never, { ...f.refund, eventId: randomUUID(), refundId: randomUUID(), amountCents: 1000, principalCents: 1000, tipCents: 0 });
      await clients[1]!.query('COMMIT');
    } finally {
      await clients[1]!.query('ROLLBACK');
      await handled;
    }

    await expect(credit).rejects.toThrow('STALE_EVIDENCE');
    expect((await clients[0]!.query('SELECT id FROM customer_payment_credit_decision WHERE appointment_id=$1', [f.appointmentId])).rows).toHaveLength(0);
    expect((await f.load()).amountPaidCents).toBe(8000);
  }, 20000);

  it('does not wait into an owner-revocation lock cycle or write a decision after revocation', async () => {
    const f = await creditFixture();
    await clients[1]!.query('BEGIN');
    await clients[1]!.query('UPDATE admin_salon_membership SET role=\'admin\' WHERE admin_id=$1 AND salon_id=$2', [f.actor.adminId, f.salonId]);
    try {
      const failure = await recordSyntheticCreditDecision(databases[2]!, f.actor, f.request).then(() => null, error => error);

      expect(failure?.cause?.code ?? failure?.code).toBe('55P03');

      await clients[1]!.query('COMMIT');
    } finally {
      await clients[1]!.query('ROLLBACK');
    }

    await expect(recordSyntheticCreditDecision(databases[2]!, f.actor, f.request)).rejects.toThrow('OWNER_REQUIRED');
    expect((await clients[0]!.query('SELECT id FROM customer_payment_credit_decision WHERE appointment_id=$1', [f.appointmentId])).rows).toHaveLength(0);
  }, 20000);
});
