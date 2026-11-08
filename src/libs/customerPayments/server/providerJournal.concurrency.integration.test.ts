import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, type DisposableDatabaseTarget, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

import { calculatePaymentSnapshot } from '../money';
import { reconcileProviderFixture } from '../provider/dispatchFixture';
import { verifyOfflineProviderReceipt } from '../provider/evidence';
import { createOfflineOperationTransport, createOperationIdentity } from '../provider/operations';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository, customerPaymentFingerprint } from './preparationRepository';
import { createProviderJournal } from './providerJournal';

vi.mock('server-only', () => ({}));
const rawUrl = process.env.CUSTOMER_PAYMENT_PROVIDER_TEST_DATABASE_URL ?? '';
let target: DisposableDatabaseTarget | null = null;
if (rawUrl) {
  target = requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: rawUrl });
} else if (process.env.CUSTOMER_PAYMENT_PROVIDER_PG_REQUIRED === 'true') {
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
async function receipt(eventId: string, extra: Record<string, unknown> = {}) {
  const receivedAt = new Date();
  const config = { endpointId: 'endpoint_fixture', platformId: 'acct_fixtureplatform', accountScope: 'connected' as const, expectedAccountId: 'acct_fixtureconnected', apiVersion: '2024-06-20', livemode: false as const, expectedObject: { id: 'pi_fixture', type: 'payment_intent', chargeId: 'ch_fixture', amountCents: 10000, currency: 'cad' } };
  const body = { id: eventId, object: 'event', account: config.expectedAccountId, type: 'payment_intent.succeeded', api_version: config.apiVersion, livemode: false, created: Math.floor(receivedAt.getTime() / 1000) - 1, data: { object: { id: 'pi_fixture', object: 'payment_intent', livemode: false, latest_charge: 'ch_fixture', amount_received: 10000, currency: 'cad', status: 'succeeded' } }, ...extra };
  const rawBody = new TextEncoder().encode(JSON.stringify(body));
  const signature = createHmac('sha256', 'private_offline_fixture_only').update(rawBody).digest('hex');
  return verifyOfflineProviderReceipt({ rawBody, signature, receivedAt }, config, input => createHmac('sha256', 'private_offline_fixture_only').update(input.rawBody).digest('hex') === input.signature);
}
async function operationFixture() {
  const suffix = randomUUID();
  const salonId = `boundary_salon_${suffix}`;
  const appointmentId = `boundary_appt_${suffix}`;
  const technicianId = `boundary_tech_${suffix}`;
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Offline fixture' });
  await database.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Offline technician' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId, clientPhone: '4165550111', clientName: 'Offline customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const repository = createCustomerPaymentPreparationRepository(database);
  await repository.saveCustomerPaymentSettingsDraft({ salonId, actorId: 'fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } });
  const snapshot = calculatePaymentSnapshot({ currency: 'cad', collection: 'full', servicesCents: 10000, taxCents: 0, tipCents: 0, discountCents: 0 });
  const quote = await repository.prepareCustomerPaymentQuote({ salonId, appointmentId, requestId: randomUUID(), requestFingerprint: customerPaymentFingerprint({ fixture: suffix }) }, async () => ({ snapshot, stripeAccountId: 'acct_fixtureconnected', expiresAt: new Date(Date.now() + 600000), context: { fixture: suffix } }));
  const identity = createOperationIdentity({ id: randomUUID(), salonId, appointmentId, quoteId: quote.id, requestId: randomUUID(), contextHash: quote.fingerprint, platformId: 'acct_fixtureplatform', accountScope: 'connected', accountId: 'acct_fixtureconnected', mode: 'test', apiVersion: '2024-06-20', provenance: 'offline_fixture', kind: 'checkout_create', targetId: null, parameters: { mode: 'payment', payment_method_types: ['card'], client_reference_id: quote.id, success_url: 'https://fixture.invalid/success', cancel_url: 'https://fixture.invalid/cancel', line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: snapshot.chargeCents, product_data: { name: 'Appointment payment and optional tip' } } }], payment_intent_data: { application_fee_amount: snapshot.applicationFeeCents } } });
  const journal = createProviderJournal(database);
  return { identity, journal, appointmentId };
}

suite('provider journal — attested PostgreSQL concurrency', () => {
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

  afterAll(async () => {
    for (const client of clients) {
      client.release();
    }
    await pool?.end();
    vi.unstubAllEnvs();
  }, 30000);

  it('serializes duplicate authenticated receipt inserts then retains conflicts across consumer fanout', async () => {
    const eventId = `evt_${randomUUID().replaceAll('-', '')}`;
    const evidence = await receipt(eventId);

    expect(evidence.classification).toBe('accepted');

    const entered = barrier();
    const release = barrier();
    const wrapped = { select: databases[1]!.select.bind(databases[1]), transaction: (callback: Parameters<Database['transaction']>[0]) => databases[1]!.transaction(async (tx) => {
      const result = await callback(tx);
      entered.release();
      await release.promise;
      return result;
    }) };
    const first = createProviderJournal(wrapped as never).ingestReceipt(evidence);
    const handled = Promise.allSettled([first.finally(() => entered.release())]);
    await entered.promise;
    const second = createProviderJournal(databases[2]!).ingestReceipt(evidence);
    const outcomes = Promise.allSettled([first, second]);
    try {
      await blockedBy(pids[2]!, pids[1]!);
    } finally {
      release.release();
      await outcomes;
      await handled;
    }
    const inbox = await first;

    expect((await second).id).toBe(inbox.id);

    const journal = createProviderJournal(database);
    const d1 = await journal.ensureDelivery(inbox.id, 'deposit', 1);
    const d2 = await journal.ensureDelivery(inbox.id, 'customer', 1);
    const d3 = await journal.ensureDelivery(inbox.id, 'fee', 2);
    const claim = await journal.claimDelivery(d1.id, { workerId: 'deposit', leaseMs: 60000 });
    await journal.finishDelivery(d1.id, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, outcome: 'completed' });
    const conflicting = await receipt(eventId, { type: 'unknown.money' });
    const conflicting2 = await receipt(eventId, { type: 'other.money' });
    const conflicts = await Promise.allSettled([createProviderJournal(databases[1]!).ingestReceipt(conflicting), createProviderJournal(databases[2]!).ingestReceipt(conflicting2)]);

    expect(conflicts.every(result => result.status === 'rejected')).toBe(true);
    expect((await journal.getInbox(inbox.id))?.hasConflict).toBe(true);

    for (const d of [d1, d2, d3]) {
      expect((await journal.getDelivery(d.id))?.state).toBe('review');
    }

    expect((await clients[0]!.query('SELECT id FROM customer_payment_provider_conflict WHERE inbox_id=$1', [inbox.id])).rows).toHaveLength(2);
  }, 20000);

  it('serializes identical operation prepares with one immutable identity and initial audit', async () => {
    const { identity } = await operationFixture();
    const results = await Promise.all([createProviderJournal(databases[1]!).prepareOperation(identity), createProviderJournal(databases[2]!).prepareOperation(identity)]);

    expect(results[0]).toEqual(results[1]);
    expect((await clients[0]!.query('SELECT id FROM customer_payment_provider_audit WHERE entity_type=\'operation\' AND entity_id=$1', [identity.id])).rows).toHaveLength(1);
  });

  it('fences competing claims and stale workers after actual database lease expiry', async () => {
    const { identity, journal } = await operationFixture();
    await journal.prepareOperation(identity);
    const claims = await Promise.allSettled([createProviderJournal(databases[1]!).claimOperation(identity.id, { workerId: 'one', leaseMs: 1000, purpose: 'dispatch' }), createProviderJournal(databases[2]!).claimOperation(identity.id, { workerId: 'two', leaseMs: 1000, purpose: 'dispatch' })]);

    expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1);

    const old = claims.find(result => result.status === 'fulfilled')!;
    if (old.status !== 'fulfilled') {
      throw new Error('missing claim');
    }
    await new Promise(resolve => setTimeout(resolve, 1100));
    const fresh = await journal.claimOperation(identity.id, { workerId: 'replacement', leaseMs: 60000, purpose: 'dispatch' });

    await expect(journal.advanceOperation(identity.id, { expectedVersion: old.value.version, leaseToken: old.value.leaseToken!, command: { type: 'begin_dispatch' } })).rejects.toThrow();

    const dispatched = await journal.advanceOperation(identity.id, { expectedVersion: fresh.version, leaseToken: fresh.leaseToken!, command: { type: 'begin_dispatch' } });

    expect(dispatched.state).toBe('dispatching');
    expect(dispatched.leaseToken).not.toBe(old.value.leaseToken);
  }, 20000);

  it('recovers a crash after durable dispatch only by reconciliation, never blind retry', async () => {
    const { identity, journal, appointmentId } = await operationFixture();
    await journal.prepareOperation(identity);
    const claim = await journal.claimOperation(identity.id, { workerId: 'crash', leaseMs: 1000, purpose: 'dispatch' });
    await journal.advanceOperation(identity.id, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, command: { type: 'begin_dispatch' } });
    await new Promise(resolve => setTimeout(resolve, 1100));

    await expect(journal.claimOperation(identity.id, { workerId: 'unsafe', leaseMs: 60000, purpose: 'dispatch' })).rejects.toThrow('RECONCILIATION_REQUIRED');

    const transport = createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: 'cs_neverdispatched' }, reconciliation: { type: 'exists', objectId: 'cs_recovered' } }]);
    await reconcileProviderFixture(journal, transport, identity.id, { workerId: 'recovery', leaseMs: 60000 });

    expect((await journal.getOperation(identity.id))?.result).toEqual({ provenance: 'offline_fixture', objectId: 'cs_recovered' });
    expect((await clients[0]!.query('SELECT id FROM appointment_payment WHERE appointment_id=$1', [appointmentId])).rows).toHaveLength(0);
    await expect(clients[0]!.query('DELETE FROM customer_payment_provider_operation WHERE id=$1', [identity.id])).rejects.toThrow();
  }, 20000);
});
