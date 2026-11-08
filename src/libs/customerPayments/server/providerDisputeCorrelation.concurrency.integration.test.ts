import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { calculatePaymentSnapshot } from '../money';
import { dispatchProviderFixture } from '../provider/dispatchFixture';
import { verifyOfflineDisputeReceipt } from '../provider/disputeEvidence';
import { type ProviderFixtureConfig, verifyOfflineProviderReceipt } from '../provider/evidence';
import { createOfflineOperationTransport, createOperationIdentity } from '../provider/operations';
import { verifyOfflineCheckoutSessionReceipt } from '../provider/sessionEvidence';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository, customerPaymentFingerprint } from './preparationRepository';
import { createProviderCorrelation } from './providerCorrelation';
import { createProviderDisputeCorrelation } from './providerDisputeCorrelation';
import { createProviderJournal } from './providerJournal';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_DISPUTE_CORRELATION_TEST_DATABASE_URL ?? '';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (process.env.CUSTOMER_PAYMENT_DISPUTE_CORRELATION_PG_REQUIRED === 'true') {
  throw new Error('Provider PG target required but absent');
}
const suite = target ? describe.sequential : describe.skip;
type Database = NodePgDatabase<typeof schema>;
const clients: pg.PoolClient[] = [];
const databases: Database[] = [];
const pids: number[] = [];
let pool: pg.Pool | undefined;
let database: Database;
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
  throw new Error('Expected genuine PG blocking not observed');
}
const receivedAt = new Date('2026-11-08T12:00:00Z');
const eventCreated = Math.floor(receivedAt.getTime() / 1000) - 1;
let config: ProviderFixtureConfig = { endpointId: 'endpoint_correlation', platformId: 'acct_fixtureplatform', accountScope: 'connected', expectedAccountId: 'acct_fixtureconnected', apiVersion: '2024-06-20', livemode: false };
function signed(payload: Record<string, unknown>, observedAt = receivedAt) {
  const rawBody = new TextEncoder().encode(JSON.stringify(payload));
  const signature = createHmac('sha256', 'offline_correlation_fixture_only').update(rawBody).digest('hex');
  const verifier = vi.fn(async (input: { rawBody: Uint8Array; signature: string }) => createHmac('sha256', 'offline_correlation_fixture_only').update(input.rawBody).digest('hex') === input.signature);
  return { input: { rawBody, signature, receivedAt: observedAt }, verifier };
}
function event(type: string, object: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { id: `evt_${randomUUID().replaceAll('-', '')}`, object: 'event', type, created: eventCreated, account: config.expectedAccountId, api_version: config.apiVersion, livemode: false, data: { object }, ...overrides };
}
async function operationFixture() {
  const suffix = randomUUID();
  const salonId = `correlation_boundary_salon_${suffix}`;
  const appointmentId = `correlation_boundary_appt_${suffix}`;
  const technicianId = `correlation_boundary_tech_${suffix}`;
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Offline fixture' });
  await database.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Offline technician' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId, clientPhone: '4165550111', clientName: 'Offline customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const repository = createCustomerPaymentPreparationRepository(database);
  await repository.saveCustomerPaymentSettingsDraft({ salonId, actorId: 'fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } });
  const snapshot = calculatePaymentSnapshot({ currency: 'cad', collection: 'full', servicesCents: 10000, taxCents: 0, tipCents: 0, discountCents: 0 });
  const quote = await repository.prepareCustomerPaymentQuote({ salonId, appointmentId, requestId: randomUUID(), requestFingerprint: customerPaymentFingerprint({ fixture: suffix }) }, async () => ({ snapshot, stripeAccountId: config.expectedAccountId!, expiresAt: new Date(Date.now() + 600000), context: { fixture: suffix } }));
  const identity = createOperationIdentity({ id: randomUUID(), salonId, appointmentId, quoteId: quote.id, requestId: randomUUID(), contextHash: quote.fingerprint, platformId: config.platformId, accountScope: 'connected', accountId: config.expectedAccountId!, mode: 'test', apiVersion: '2024-06-20', provenance: 'offline_fixture', kind: 'checkout_create', targetId: null, parameters: { mode: 'payment', payment_method_types: ['card'], client_reference_id: quote.id, success_url: 'https://fixture.invalid/success', cancel_url: 'https://fixture.invalid/cancel', line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: snapshot.chargeCents, product_data: { name: 'Appointment payment and optional tip' } } }], payment_intent_data: { application_fee_amount: snapshot.applicationFeeCents } } });
  const journal = createProviderJournal(database);
  await journal.prepareOperation(identity);
  return { identity, journal, appointmentId, quote, snapshot };
}

async function graphFixture(withTwin = false) {
  const f = await operationFixture();
  const suffix = randomUUID().replaceAll('-', '');
  const ids = { session: `cs_test_${suffix}`, intent: `pi_${suffix}`, charge: `ch_${suffix}`, fee: `fee_${suffix}` };
  const transport = createOfflineOperationTransport([{ identity: f.identity, dispatch: { type: 'accepted', objectId: ids.session }, reconciliation: { type: 'unresolved' } }]);
  await dispatchProviderFixture(f.journal, transport, f.identity.id, { workerId: 'fixture_worker', leaseMs: 60000 });
  const operation = (await f.journal.getOperation(f.identity.id))!;
  let twin: { identity: typeof f.identity; operation: typeof operation } | null = null;
  if (withTwin) {
    const { parameterHash: _hash, idempotencyKey: _key, ...original } = f.identity;
    const identity = createOperationIdentity({ ...original, id: randomUUID(), requestId: randomUUID() });
    await f.journal.prepareOperation(identity);
    const twinTransport = createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: ids.session }, reconciliation: { type: 'unresolved' } }]);
    await dispatchProviderFixture(f.journal, twinTransport, identity.id, { workerId: 'fixture_worker', leaseMs: 60000 });
    twin = { identity, operation: (await f.journal.getOperation(identity.id))! };
  }
  const observedAt = new Date();
  const created = Math.floor(observedAt.getTime() / 1000);
  const sessionCreated = Math.floor(Math.max(operation.firstDispatchedAt!, twin?.operation.firstDispatchedAt ?? 0) / 1000);
  const sessionPayload = event('checkout.session.completed', { id: ids.session, object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid', payment_intent: ids.intent, amount_total: f.snapshot.chargeCents, currency: 'cad', client_reference_id: f.quote.id, created: sessionCreated, expires_at: sessionCreated + 300, metadata: { appointment_id: 'untrusted_metadata_appointment' } }, { created });
  const intentPayload = event('payment_intent.succeeded', { id: ids.intent, object: 'payment_intent', livemode: false, status: 'succeeded', amount: f.snapshot.chargeCents, amount_received: f.snapshot.chargeCents, currency: 'cad', latest_charge: ids.charge }, { created });
  const chargePayload = event('charge.succeeded', { id: ids.charge, object: 'charge', livemode: false, amount: f.snapshot.chargeCents, amount_captured: f.snapshot.chargeCents, amount_refunded: 0, currency: 'cad', payment_intent: ids.intent, application_fee: ids.fee, paid: true, captured: true }, { created });
  const feePayload = event('application_fee.created', { id: ids.fee, object: 'application_fee', livemode: false, amount: f.snapshot.applicationFeeCents, currency: 'cad', charge: ids.charge, account: f.identity.accountId }, { created, account: undefined });
  const sessionSigned = signed(sessionPayload, observedAt);
  const pair = await verifyOfflineCheckoutSessionReceipt(sessionSigned.input, config, sessionSigned.verifier);
  const sessionInbox = await f.journal.ingestReceipt(pair.receipt);
  const descriptions = [
    { payload: intentPayload, expectedObject: { id: ids.intent, type: 'payment_intent', amountCents: f.snapshot.chargeCents, currency: 'cad', chargeId: ids.charge }, cfg: config },
    { payload: chargePayload, expectedObject: { id: ids.charge, type: 'charge', amountCents: f.snapshot.chargeCents, currency: 'cad', paymentIntentId: ids.intent }, cfg: config },
    { payload: feePayload, expectedObject: { id: ids.fee, type: 'application_fee', amountCents: f.snapshot.applicationFeeCents, currency: 'cad', chargeId: ids.charge, connectedAccountId: f.identity.accountId! }, cfg: { ...config, accountScope: 'platform' as const, expectedAccountId: null } },
  ];
  const facts = [];
  for (const description of descriptions) {
    const fixture = signed(description.payload, observedAt);
    const receipt = await verifyOfflineProviderReceipt(fixture.input, { ...description.cfg, expectedObject: description.expectedObject }, fixture.verifier);
    const inbox = await f.journal.ingestReceipt(receipt);
    facts.push({ inboxId: inbox.id, receipt, hasConflict: false });
  }
  const correlation = createProviderCorrelation(database);
  await correlation.persistSessionProjection(sessionInbox.id, pair.receipt, pair.session);
  const input = { operation, quote: f.quote, receipts: [{ inboxId: sessionInbox.id, receipt: pair.receipt, hasConflict: false }, ...facts], sessions: [{ inboxId: sessionInbox.id, session: pair.session }], now: observedAt };
  return { ...f, ids, twin, correlation, input, pair, sessionInbox, sessionPayload, intentPayload, chargePayload, feePayload, observedAt };
}

async function disputeFixture(f: Awaited<ReturnType<typeof graphFixture>>, movement = true, txnId = `txn_${randomUUID().replaceAll('-', '')}`, publish = true) {
  const disputeId = `dp_${randomUUID().replaceAll('-', '')}`;
  const observedAt = new Date();
  const created = Math.floor(observedAt.getTime() / 1000);
  const balance = { id: txnId, object: 'balance_transaction', source: disputeId, amount: -1000, fee: 150, net: -1150, currency: 'cad', exchange_rate: null, type: 'adjustment', reporting_category: 'dispute', status: 'available', created, available_on: created };
  const payload = event(movement ? 'charge.dispute.funds_withdrawn' : 'charge.dispute.created', { id: disputeId, object: 'dispute', livemode: false, status: 'needs_response', amount: 1000, currency: 'cad', payment_intent: f.ids.intent, charge: f.ids.charge, created, balance_transactions: movement ? [balance] : [] }, { created });
  const fixture = signed(payload, observedAt);
  const pair = await verifyOfflineDisputeReceipt(fixture.input, config, fixture.verifier);
  const correlation = createProviderDisputeCorrelation(database);
  if (publish) {
    const inbox = await f.journal.ingestReceipt(pair.receipt);
    await correlation.persistDisputeProjection(inbox.id, pair.receipt, pair.dispute);
  }
  return { correlation, pair, payload, disputeId, txnId };
}
suite('provider dispute correlation — attested PostgreSQL concurrency', () => {
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
      pids.push((await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
      databases.push(drizzle(client, { schema }));
    }
    database = databases[0]!;
    await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
    vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('VERCEL', '');
  }, 120000);

  beforeEach(() => {
    config = { ...config, platformId: `acct_${randomUUID().replaceAll('-', '')}`, expectedAccountId: `acct_${randomUUID().replaceAll('-', '')}` };
  });

  afterAll(async () => {
    for (const client of clients) {
      client.release();
    }
    await pool?.end();
    vi.unstubAllEnvs();
  }, 30000);

  it('serializes pending lifecycle-only writes with exactly one immutable audit', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const dispute = await disputeFixture(f, false);
    const entered = barrier();
    const release = barrier();
    const wrapped = { select: databases[1]!.select.bind(databases[1]), transaction: (callback: Parameters<Database['transaction']>[0], options: Parameters<Database['transaction']>[1]) => databases[1]!.transaction(async (tx) => {
      const result = await callback(tx);
      entered.release();
      await release.promise;
      return result;
    }, options) };
    const first = createProviderDisputeCorrelation(wrapped as never).correlateOperation(f.identity.id);
    const handled = Promise.allSettled([first.finally(() => entered.release())]);
    await entered.promise;
    const second = createProviderDisputeCorrelation(databases[2]!).correlateOperation(f.identity.id);
    const outcomes = Promise.allSettled([first, second]);
    try {
      await blockedBy(pids[2]!, pids[1]!);
    } finally {
      release.release();
      await outcomes;
      await handled;
    }
    const a = await first;
    const b = await second;

    expect(a.result.state).toBe('pending');
    expect(a.result.balanceCandidates).toEqual([]);
    expect(b.id).toBe(a.id);
    expect(b.replayed).toBe(true);
    expect((await dispute.correlation.getCorrelation(f.identity.id))!.result.totals).toBeNull();
  }, 20000);

  it('deduplicates concurrent balance claims without treating duplicate events as new money', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const d = await disputeFixture(f);
    const results = await Promise.all([createProviderDisputeCorrelation(databases[1]!).correlateOperation(f.identity.id), createProviderDisputeCorrelation(databases[2]!).correlateOperation(f.identity.id)]);

    expect(results[0]!.id).toBe(results[1]!.id);
    expect(results[0]!.result.state).toBe('correlated');

    const replay = signed({ ...d.payload, id: `evt_${randomUUID().replaceAll('-', '')}` }, new Date());
    const pair = await verifyOfflineDisputeReceipt(replay.input, { ...config, endpointId: 'endpoint_dispute_duplicate' }, replay.verifier);
    const inbox = await f.journal.ingestReceipt(pair.receipt);
    await d.correlation.persistDisputeProjection(inbox.id, pair.receipt, pair.dispute);
    const next = await d.correlation.correlateOperation(f.identity.id);

    expect(next.result.totals).toEqual({ withdrawnCents: 1000, reinstatedCents: 0, feeCents: 150, netCents: -1150 });
    expect((await clients[0]!.query('SELECT id FROM customer_payment_dispute_balance_claim WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(1);
  }, 20000);

  it('retains competing parent-operation claims for one scoped dispute and balance movement', async () => {
    const f = await graphFixture(true);
    await f.correlation.correlateOperation(f.identity.id);
    await f.correlation.correlateOperation(f.twin!.identity.id);
    const dispute = await disputeFixture(f);
    const results = await Promise.all([createProviderDisputeCorrelation(databases[1]!).correlateOperation(f.identity.id), createProviderDisputeCorrelation(databases[2]!).correlateOperation(f.twin!.identity.id)]);

    expect(results.every(result => result.result.state === 'review')).toBe(true);

    const dp = await clients[0]!.query('SELECT id FROM customer_payment_dispute_candidate WHERE key->>\'disputeId\'=$1', [dispute.disputeId]);

    expect(dp.rows).toHaveLength(1);
    expect((await clients[0]!.query('SELECT id FROM customer_payment_dispute_claim WHERE candidate_id=$1', [dp.rows[0].id])).rows).toHaveLength(2);

    const bt = await clients[0]!.query('SELECT id FROM customer_payment_dispute_balance_candidate WHERE key->>\'balanceTransactionId\'=$1', [dispute.txnId]);

    expect(bt.rows).toHaveLength(1);
    expect((await clients[0]!.query('SELECT id FROM customer_payment_dispute_balance_claim WHERE candidate_id=$1', [bt.rows[0].id])).rows).toHaveLength(2);
  }, 20000);

  it('discovers shared balance IDs in another unclaimed dispute on an otherwise unrelated parent', async () => {
    const a = await graphFixture();
    await a.correlation.correlateOperation(a.identity.id);
    const d = await disputeFixture(a);
    await d.correlation.correlateOperation(a.identity.id);
    const b = await graphFixture();
    await b.correlation.correlateOperation(b.identity.id);
    await disputeFixture(b, true, d.txnId);
    const result = await d.correlation.getCorrelation(a.identity.id);

    expect(result!.result.state).toBe('review');
    expect((await clients[0]!.query('SELECT id FROM customer_payment_dispute_correlation WHERE operation_id=$1', [b.identity.id])).rows).toHaveLength(0);
  }, 20000);

  it('keeps a single MVCC graph during supplemental shared-transaction arrival and reviews next read', async () => {
    const a = await graphFixture();
    await a.correlation.correlateOperation(a.identity.id);
    const d = await disputeFixture(a);
    await d.correlation.correlateOperation(a.identity.id);
    const b = await graphFixture();
    await b.correlation.correlateOperation(b.identity.id);
    const other = await disputeFixture(b, true, d.txnId, false);
    const entered = barrier();
    const release = barrier();
    const wrapped = { select: databases[1]!.select.bind(databases[1]), transaction: (callback: Parameters<Database['transaction']>[0], options: Parameters<Database['transaction']>[1]) => databases[1]!.transaction(async (tx) => {
      await tx.select().from(schema.customerPaymentCorrelationMutexSchema);
      entered.release();
      await release.promise;
      return callback(tx);
    }, options) };
    const oldRead = createProviderDisputeCorrelation(wrapped as never).getCorrelation(a.identity.id);
    const handled = Promise.allSettled([oldRead.finally(() => entered.release())]);
    await entered.promise;
    try {
      const inbox = await createProviderJournal(databases[2]!).ingestReceipt(other.pair.receipt);
      await createProviderDisputeCorrelation(databases[2]!).persistDisputeProjection(inbox.id, other.pair.receipt, other.pair.dispute);
    } finally {
      release.release();
      await handled;
    }

    expect((await oldRead)!.result.state).toBe('correlated');

    const current = await d.correlation.getCorrelation(a.identity.id);

    expect(current!.result.state).toBe('review');
    expect(current!.sourceRevision).not.toBe((await oldRead)!.sourceRevision);
  }, 20000);
});
