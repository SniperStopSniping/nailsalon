/** Independent offline movement boundaries against the complete migration journal. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { createProviderFixtureCaptureApplication } from '../server/applyProviderFixtureCapture';
import { createProviderFixtureMovementApplication } from '../server/applyProviderFixtureMovements';
import { createFixtureCaptureGraph, signFixtureCapturePayload } from '../server/fixtureApplicationTestSupport';
import { createProviderDisputeCorrelation, reserveProviderDisputeOwnership } from '../server/providerDisputeCorrelation';
import { createProviderRefundCorrelation, reserveProviderRefundOwnership } from '../server/providerRefundCorrelation';
import { dispatchProviderFixture } from './dispatchFixture';
import { verifyOfflineDisputeReceipt } from './disputeEvidence';
import { verifyOfflineProviderReceipt } from './evidence';
import { createOfflineOperationTransport, createOperationIdentity } from './operations';
import { verifyOfflineRefundReceipt } from './refundEvidence';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
const nonce = () => randomUUID().replaceAll('-', '');
const flags = ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_MOVEMENTS_ENABLED'];

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  flags.forEach(flag => vi.stubEnv(flag, 'true'));
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => client?.close());

async function fixture() {
  const f = await createFixtureCaptureGraph(database);
  const applied = await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });

  expect(applied.state).toBe('applied');

  const reconcile = () => createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: applied.applicationId! });
  return { ...f, applied, reconcile };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Refund = Awaited<ReturnType<typeof refund>>;
async function refund(f: Fixture, options: { kind?: 'customer_refund' | 'application_fee_refund'; amount?: number; status?: string; withOperation?: boolean; movementId?: string } = {}) {
  const kind = options.kind ?? 'customer_refund';
  const amount = options.amount ?? (kind === 'customer_refund' ? 1234 : 17);
  const movementId = options.movementId ?? `${kind === 'customer_refund' ? 're' : 'fr'}_${nonce()}`;
  const common = { id: randomUUID(), salonId: f.salonId, appointmentId: f.appointmentId, quoteId: f.quote.id, requestId: randomUUID(), contextHash: f.quote.fingerprint, platformId: f.config.platformId, mode: 'test' as const, apiVersion: '2024-06-20' as const, provenance: 'offline_fixture' as const };
  const accountId = f.identity.accountId;
  if (typeof accountId !== 'string' || !accountId.startsWith('acct_')) {
    throw new Error('Independent fixture requires a connected account');
  }
  const identity = kind === 'customer_refund'
    ? createOperationIdentity({ ...common, kind, accountScope: 'connected', accountId, targetId: f.ids.intent, parameters: { payment_intent: f.ids.intent, amount } })
    : createOperationIdentity({ ...common, kind, accountScope: 'platform', accountId: null, targetId: f.ids.fee, parameters: { amount } });
  if (options.withOperation !== false) {
    await f.journal.prepareOperation(identity);
    await dispatchProviderFixture(f.journal, createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: movementId }, reconciliation: { type: 'unresolved' } }]), identity.id, { workerId: 'independent_movement_boundary', leaseMs: 60000 });
  }
  const created = Math.floor(Date.now() / 1000);
  const payload = { ...f.event(kind === 'customer_refund' ? 'refund.created' : 'application_fee.refund.updated', kind === 'customer_refund'
    ? { id: movementId, object: 'refund', amount, currency: 'cad', status: options.status ?? 'succeeded', charge: f.ids.charge, payment_intent: f.ids.intent, created }
    : { id: movementId, object: 'fee_refund', amount, currency: 'cad', fee: f.ids.fee, created }, kind === 'application_fee_refund'), created };
  const config = kind === 'customer_refund' ? f.config : { ...f.config, accountScope: 'platform' as const, expectedAccountId: null };
  const signed = signFixtureCapturePayload(payload);
  const pair = await verifyOfflineRefundReceipt(signed.input, config, signed.verifier);
  const inbox = await f.journal.ingestReceipt(pair.receipt);
  await createProviderRefundCorrelation(database).persistRefundProjection(inbox.id, pair.receipt, pair.refund);
  return { identity, kind, amount, movementId, payload, config, pair, inbox };
}
async function repeatRefund(f: Fixture, r: Refund, overrides: Record<string, unknown> = {}, endpointId = r.config.endpointId) {
  const original = r.payload as Record<string, unknown>;
  const object = (original.data as { object: Record<string, unknown> }).object;
  const payload = { ...original, id: `evt_${nonce()}`, data: { object: { ...object, ...overrides } } };
  const signed = signFixtureCapturePayload(payload);
  const pair = await verifyOfflineRefundReceipt(signed.input, { ...r.config, endpointId }, signed.verifier);
  const inbox = await f.journal.ingestReceipt(pair.receipt);
  await createProviderRefundCorrelation(database).persistRefundProjection(inbox.id, pair.receipt, pair.refund);
  return { payload, pair, inbox };
}
async function dispute(f: Fixture, options: { status?: string; movement?: boolean; amount?: number; fee?: number } = {}) {
  const created = Math.floor(Date.now() / 1000);
  const disputeId = `dp_${nonce()}`;
  const amount = options.amount ?? 2000;
  const fee = options.fee ?? 1500;
  const transactionId = `txn_${nonce()}`;
  const transactions = options.movement === false ? [] : [{ id: transactionId, object: 'balance_transaction', source: disputeId, amount: -amount, fee, net: -amount - fee, currency: 'cad', created, available_on: created + 86400, status: 'pending', type: 'adjustment', reporting_category: 'dispute', exchange_rate: null }];
  const object = { id: disputeId, object: 'dispute', livemode: false, amount, currency: 'cad', status: options.status ?? 'needs_response', charge: f.ids.charge, payment_intent: f.ids.intent, created, balance_transactions: transactions };
  const payload = { ...f.event(options.status === 'won' ? 'charge.dispute.closed' : 'charge.dispute.created', object), created, data: { object } };
  const signed = signFixtureCapturePayload(payload);
  const pair = await verifyOfflineDisputeReceipt(signed.input, f.config, signed.verifier);
  const inbox = await f.journal.ingestReceipt(pair.receipt);
  await createProviderDisputeCorrelation(database).persistDisputeProjection(inbox.id, pair.receipt, pair.dispute);
  return { disputeId, transactionId, payload, pair, inbox };
}
async function movements(f: Fixture) {
  return (await client.query<Record<string, unknown>>('SELECT * FROM customer_payment_fixture_movement WHERE application_id=$1 ORDER BY movement_id', [f.applied.applicationId])).rows;
}
async function reconciliations(f: Fixture) {
  return (await client.query<Record<string, unknown>>('SELECT * FROM customer_payment_fixture_reconciliation WHERE application_id=$1 ORDER BY id', [f.applied.applicationId])).rows;
}
async function originalMoney(f: Fixture) {
  const rows = await Promise.all(['customer_payment_capture', 'appointment_payment', 'customer_payment_refund', 'customer_payment_fee_refund', 'customer_payment_credit_decision'].map(async table => ({ table, rows: (await client.query(`SELECT * FROM ${table} WHERE appointment_id=$1 ORDER BY id`, [f.appointmentId])).rows })));
  const appointment = (await client.query('SELECT * FROM appointment WHERE id=$1', [f.appointmentId])).rows;
  return { rows, appointment };
}
async function holds(f: Fixture) {
  return (await client.query('SELECT * FROM customer_payment_fixture_hold WHERE application_id=$1 ORDER BY id', [f.applied.applicationId])).rows;
}
async function suppress(table: string, work: () => Promise<void>) {
  await client.exec(`CREATE FUNCTION fixture_movement_boundary_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER fixture_movement_boundary_suppress BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_movement_boundary_suppress();`);
  try {
    await work();
  } finally {
    await client.exec(`DROP TRIGGER fixture_movement_boundary_suppress ON ${table}; DROP FUNCTION fixture_movement_boundary_suppress();`);
  }
}

describe('independent fixture movement authority boundary', () => {
  it.each([...flags.map(flag => [flag, 'false']), ['NODE_ENV', 'production'], ['NODE_ENV', 'development'], ['APP_ENV', 'production'], ['VERCEL_ENV', 'production']])('rejects %s=%s before database access', async (flag, value) => {
    vi.stubEnv(flag!, value!);
    const accessed = vi.fn(() => {
      throw new Error('Unexpected database access');
    });
    const db = new Proxy({} as never, { get: accessed });

    await expect(createProviderFixtureMovementApplication(db).reconcileMovements({ captureApplicationId: randomUUID() })).rejects.toThrow('CUSTOMER_PAYMENT_FIXTURE_MOVEMENTS_DISABLED');
    expect(accessed).not.toHaveBeenCalled();
  });

  it.each([reserveProviderRefundOwnership, reserveProviderDisputeOwnership])('gates exported ownership reservation seams before database access', async (reserve) => {
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
    const accessed = vi.fn(() => {
      throw new Error('Unexpected database access');
    });
    const tx = new Proxy({} as never, { get: accessed });

    await expect(reserve(tx, randomUUID(), {} as never, true)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    expect(accessed).not.toHaveBeenCalled();
  });

  it('rejects caller cash, source, ownership and selected evidence fields before database access', async () => {
    const accessed = vi.fn(() => {
      throw new Error('Unexpected database access');
    });
    const db = new Proxy({} as never, { get: accessed });
    const input = { captureApplicationId: randomUUID(), amountCents: 1, source: 'synthetic_test', movementIds: [], ownershipConflict: false };

    await expect(createProviderFixtureMovementApplication(db).reconcileMovements(input)).rejects.toThrow();
    expect(accessed).not.toHaveBeenCalled();
  });

  it('records partial refunded cash without changing capture, tender, booking cache, invoice, credit or holds', async () => {
    const f = await fixture();
    const r = await refund(f);
    const before = await originalMoney(f);
    const priorHolds = await holds(f);

    expect(priorHolds.length).toBeGreaterThan(0);
    expect(await f.reconcile()).toMatchObject({ state: 'applied', source: 'offline_fixture_test', financialPostingAllowed: false });

    const rows = await movements(f);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'customer_refund', movement_id: r.movementId, amount_cents: 1234, fee_cents: null, net_cents: null, source: 'offline_fixture_test' });
    expect(await originalMoney(f)).toEqual(before);

    const afterHolds = await holds(f);

    expect(afterHolds).toEqual(expect.arrayContaining(priorHolds));
    expect(await f.reconcile()).toMatchObject({ state: 'replayed' });
    expect(await movements(f)).toEqual(rows);
    expect(await holds(f)).toEqual(afterHolds);
  });

  it('records independent platform fee returns without a proportional customer refund', async () => {
    const f = await fixture();
    await refund(f, { kind: 'application_fee_refund', amount: f.snapshot.applicationFeeCents });

    expect(await f.reconcile()).toMatchObject({ state: 'applied' });
    expect(await movements(f)).toMatchObject([{ kind: 'application_fee_refund', account_scope: 'platform', account_id: null, amount_cents: f.snapshot.applicationFeeCents }]);
  });

  it('posts a complete mixed refund, fee return and dispute batch without blending their money', async () => {
    const f = await fixture();
    await refund(f);
    await refund(f, { kind: 'application_fee_refund' });
    await dispute(f);
    const before = await originalMoney(f);

    expect(await f.reconcile()).toMatchObject({ state: 'applied' });

    const rows = await movements(f);

    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.kind === 'dispute_withdrawal')).toMatchObject({ amount_cents: -2000, fee_cents: 1500, net_cents: -3500 });
    expect(new Set(rows.map(row => row.reconciliation_id)).size).toBe(1);
    expect(await originalMoney(f)).toEqual(before);
  });

  it('records an explicit signed dispute reinstatement and fee return without restoring booking credit', async () => {
    const f = await fixture();
    const d = await dispute(f);
    const before = await originalMoney(f);

    expect(await f.reconcile()).toMatchObject({ state: 'applied' });

    const initial = await movements(f);
    const object = d.payload.data.object;
    const created = Number(object.created) + 1;
    if (Date.now() < created * 1000) {
      await new Promise(resolve => setTimeout(resolve, created * 1000 - Date.now() + 2));
    }
    const originalTransactions = object.balance_transactions;
    const payload = { ...d.payload, id: `evt_${nonce()}`, type: 'charge.dispute.closed', created, data: { object: { ...object, status: 'won', balance_transactions: [...originalTransactions, { ...originalTransactions[0], id: `txn_${nonce()}`, amount: 2000, fee: -1500, net: 3500, created, available_on: created + 172800, reporting_category: 'dispute_reversal' }] } } };
    const signed = signFixtureCapturePayload(payload);
    const pair = await verifyOfflineDisputeReceipt(signed.input, f.config, signed.verifier);
    const inbox = await f.journal.ingestReceipt(pair.receipt);
    await createProviderDisputeCorrelation(database).persistDisputeProjection(inbox.id, pair.receipt, pair.dispute);

    expect(await f.reconcile()).toMatchObject({ state: 'applied' });

    const rows = await movements(f);

    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === initial[0]!.id)).toEqual(initial[0]);
    expect(rows.find(row => row.kind === 'dispute_reinstatement')).toMatchObject({ amount_cents: 2000, fee_cents: -1500, net_cents: 3500, allocation: 'unallocated', booking_credit: 'none' });
    expect(await originalMoney(f)).toEqual(before);
    expect((await holds(f)).length).toBeGreaterThan(0);
  });

  it.each(['pending', 'failed', 'canceled', 'requires_action'])('does not partially post a batch with a %s sibling refund', async (status) => {
    const f = await fixture();
    await refund(f);
    await refund(f, { status, amount: 10 });

    expect(await f.reconcile()).toMatchObject({ state: 'held' });
    expect(await movements(f)).toEqual([]);
    expect(await reconciliations(f)).toEqual([]);
  });

  it('does not invent an operation for a successful unclaimed sibling refund', async () => {
    const f = await fixture();
    await refund(f);
    await refund(f, { withOperation: false, amount: 10 });

    expect(await f.reconcile()).toMatchObject({ state: 'held' });
    expect(await movements(f)).toEqual([]);
  });

  it('refuses completeness when a successful prepared refund operation has no observed cash evidence', async () => {
    const f = await fixture();
    const r = await refund(f);
    const { parameterHash: _hash, idempotencyKey: _key, ...original } = r.identity;
    const identity = createOperationIdentity({ ...original, id: randomUUID(), requestId: randomUUID() });
    await f.journal.prepareOperation(identity);
    await dispatchProviderFixture(f.journal, createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: `re_${nonce()}` }, reconciliation: { type: 'unresolved' } }]), identity.id, { workerId: 'unobserved_movement', leaseMs: 60000 });

    expect(await f.reconcile()).toMatchObject({ state: 'held' });
    expect(await movements(f)).toEqual([]);
    expect(await reconciliations(f)).toEqual([]);
  });

  it('does not invent dispute restoration when a won event has no balance transaction', async () => {
    const f = await fixture();
    await dispute(f, { status: 'won', movement: false });

    expect(await f.reconcile()).toMatchObject({ state: 'held' });
    expect(await movements(f)).toEqual([]);
    expect(await reconciliations(f)).toEqual([]);
    expect((await holds(f)).length).toBeGreaterThan(0);
  });

  it('deduplicates the same business movement across new event and endpoint identities', async () => {
    const f = await fixture();
    const r = await refund(f);

    expect(await f.reconcile()).toMatchObject({ state: 'applied' });

    const before = await movements(f);
    await repeatRefund(f, r, {}, `endpoint_${nonce()}`);
    const result = await f.reconcile();

    expect(['applied', 'replayed']).toContain(result.state);
    expect(await movements(f)).toEqual(before);
  });

  it('retains the first immutable movement and snapshot while appending a later successful refund', async () => {
    const f = await fixture();
    await refund(f);

    expect(await f.reconcile()).toMatchObject({ state: 'applied' });

    const originalRows = await movements(f);
    const originalSnapshots = await reconciliations(f);
    await refund(f, { amount: 321 });

    expect(await f.reconcile()).toMatchObject({ state: 'applied' });

    const allRows = await movements(f);
    const allSnapshots = await reconciliations(f);

    expect(allRows).toHaveLength(2);
    expect(allRows.find(row => row.id === originalRows[0]!.id)).toEqual(originalRows[0]);
    expect(allSnapshots).toHaveLength(2);
    expect(allSnapshots.find(row => row.id === originalSnapshots[0]!.id)).toEqual(originalSnapshots[0]);
    expect(await f.reconcile()).toMatchObject({ state: 'replayed' });
  });

  it('rejects duplicate successful operation ownership for one provider movement', async () => {
    const f = await fixture();
    const r = await refund(f);
    const { parameterHash: _hash, idempotencyKey: _key, ...original } = r.identity;
    const identity = createOperationIdentity({ ...original, id: randomUUID(), requestId: randomUUID() });
    await f.journal.prepareOperation(identity);
    await dispatchProviderFixture(f.journal, createOfflineOperationTransport([{ identity, dispatch: { type: 'accepted', objectId: r.movementId }, reconciliation: { type: 'unresolved' } }]), identity.id, { workerId: 'duplicate_movement', leaseMs: 60000 });

    expect(await f.reconcile()).toMatchObject({ state: 'held' });
    expect(await movements(f)).toEqual([]);
    expect(await reconciliations(f)).toEqual([]);
  });

  it('preserves earlier cash when contradictory evidence makes a later batch incomplete', async () => {
    const f = await fixture();
    const r = await refund(f);

    expect(await f.reconcile()).toMatchObject({ state: 'applied' });

    const before = await movements(f);
    const reconciled = await reconciliations(f);
    await repeatRefund(f, r, { amount: r.amount + 1 });

    expect(await f.reconcile()).toMatchObject({ state: 'held' });
    expect(await movements(f)).toEqual(before);
    expect(await reconciliations(f)).toEqual(reconciled);
  });

  it('does not filter unknown related event evidence out of a successful batch', async () => {
    const f = await fixture();
    await refund(f);
    const signed = signFixtureCapturePayload({ ...f.event('charge.unknown', { id: f.ids.charge, object: 'charge', payment_intent: f.ids.intent, amount: f.snapshot.chargeCents, currency: 'cad' }), created: Math.floor(Date.now() / 1000) });
    await f.journal.ingestReceipt(await verifyOfflineProviderReceipt(signed.input, f.config, signed.verifier));

    expect(await f.reconcile()).toMatchObject({ state: 'held' });
    expect(await movements(f)).toEqual([]);
  });

  it('cannot claim a complete zero-cash scan when reconciliation insertion is suppressed', async () => {
    const f = await fixture();
    await suppress('customer_payment_fixture_reconciliation', async () => {
      await expect(f.reconcile()).rejects.toThrow();
    });

    expect(await movements(f)).toEqual([]);
    expect(await reconciliations(f)).toEqual([]);
    expect(await f.reconcile()).toMatchObject({ state: 'applied' });
  });

  it.each(['customer_payment_fixture_movement', 'customer_payment_fixture_reconciliation'])('rolls back all rows when %s inserts are suppressed', async (table) => {
    const f = await fixture();
    await refund(f);
    await refund(f, { kind: 'application_fee_refund' });
    const before = await originalMoney(f);
    await suppress(table, async () => {
      await expect(f.reconcile()).rejects.toThrow();
    });

    expect(await movements(f)).toEqual([]);
    expect(await reconciliations(f)).toEqual([]);
    expect(await originalMoney(f)).toEqual(before);
    expect(await f.reconcile()).toMatchObject({ state: 'applied' });
    expect(await movements(f)).toHaveLength(2);
  });

  it('rolls back the first movement and all reservations when a later movement is suppressed', async () => {
    const f = await fixture();
    await refund(f);
    await refund(f, { kind: 'application_fee_refund' });
    const claimsBefore = (await client.query('SELECT * FROM customer_payment_movement_claim ORDER BY id')).rows;
    await client.exec(`CREATE FUNCTION fixture_movement_boundary_partial() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='application_fee_refund' THEN RETURN NULL; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_movement_boundary_partial BEFORE INSERT ON customer_payment_fixture_movement FOR EACH ROW EXECUTE FUNCTION fixture_movement_boundary_partial();`);
    try {
      await expect(f.reconcile()).rejects.toThrow();
    } finally {
      await client.exec('DROP TRIGGER fixture_movement_boundary_partial ON customer_payment_fixture_movement; DROP FUNCTION fixture_movement_boundary_partial();');
    }

    expect(await movements(f)).toEqual([]);
    expect(await reconciliations(f)).toEqual([]);
    expect((await client.query('SELECT * FROM customer_payment_movement_claim ORDER BY id')).rows).toEqual(claimsBefore);
    expect(await f.reconcile()).toMatchObject({ state: 'applied' });
  });

  it('rolls back earlier reservations when a later ownership reservation changes owner', async () => {
    const f = await fixture();
    const first = await refund(f, { amount: 100 });
    const second = await refund(f, { amount: 200 });
    const claimsBefore = (await client.query('SELECT * FROM customer_payment_movement_claim ORDER BY id')).rows;
    const candidatesBefore = (await client.query('SELECT * FROM customer_payment_movement_candidate ORDER BY id')).rows;
    // Inject the conflict only after another candidate has been reserved within
    // this transaction, so a normal held return would leak partial ownership.
    await client.exec(`CREATE FUNCTION fixture_movement_boundary_late_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS(SELECT 1 FROM customer_payment_movement_candidate WHERE first_operation_id IN ('${first.identity.id}','${second.identity.id}')) THEN
        NEW.first_operation_id:=CASE WHEN NEW.first_operation_id='${first.identity.id}' THEN '${second.identity.id}' ELSE '${first.identity.id}' END;
      END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER bbb_fixture_movement_boundary_late_owner BEFORE INSERT ON customer_payment_movement_candidate FOR EACH ROW EXECUTE FUNCTION fixture_movement_boundary_late_owner();`);
    try {
      expect(await f.reconcile()).toMatchObject({ state: 'held' });
    } finally {
      await client.exec('DROP TRIGGER bbb_fixture_movement_boundary_late_owner ON customer_payment_movement_candidate; DROP FUNCTION fixture_movement_boundary_late_owner();');
    }

    expect(await movements(f)).toEqual([]);
    expect(await reconciliations(f)).toEqual([]);
    expect((await client.query('SELECT * FROM customer_payment_movement_claim ORDER BY id')).rows).toEqual(claimsBefore);
    expect((await client.query('SELECT * FROM customer_payment_movement_candidate ORDER BY id')).rows).toEqual(candidatesBefore);
    expect(await f.reconcile()).toMatchObject({ state: 'applied' });
  });

  it('rejects a rehashed reconciliation that omits reserved refund ownership', async () => {
    const f = await fixture();
    await refund(f);
    await client.exec(`CREATE FUNCTION fixture_movement_boundary_ownership() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      NEW.ownership_evidence:=jsonb_set(NEW.ownership_evidence,'{refund}','[]'::jsonb);
      NEW.ownership_revision:=encode(sha256(convert_to(customer_payment_provider_canonical(NEW.ownership_evidence),'UTF8')),'hex');
      RETURN NEW; END $$;
      CREATE TRIGGER fixture_movement_boundary_ownership BEFORE INSERT ON customer_payment_fixture_reconciliation FOR EACH ROW EXECUTE FUNCTION fixture_movement_boundary_ownership();`);
    try {
      await expect(f.reconcile()).rejects.toThrow();
    } finally {
      await client.exec('DROP TRIGGER fixture_movement_boundary_ownership ON customer_payment_fixture_reconciliation; DROP FUNCTION fixture_movement_boundary_ownership();');
    }

    expect(await movements(f)).toEqual([]);
    expect(await reconciliations(f)).toEqual([]);
  });

  it('rejects editing or deleting historical movement and reconciliation rows', async () => {
    const f = await fixture();
    await refund(f);

    expect(await f.reconcile()).toMatchObject({ state: 'applied' });

    const rows = await movements(f);
    const snapshots = await reconciliations(f);
    for (const statement of [
      'UPDATE customer_payment_fixture_movement SET amount_cents=amount_cents+1 WHERE application_id=$1',
      'DELETE FROM customer_payment_fixture_movement WHERE application_id=$1',
      'UPDATE customer_payment_fixture_reconciliation SET source_revision=\'forged\' WHERE application_id=$1',
      'DELETE FROM customer_payment_fixture_reconciliation WHERE application_id=$1',
    ]) {
      await expect(client.query(statement, [f.applied.applicationId])).rejects.toThrow();
    }

    expect(await movements(f)).toEqual(rows);
    expect(await reconciliations(f)).toEqual(snapshots);
  });
});
