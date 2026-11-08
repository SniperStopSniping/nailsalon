/** Independent offline dispute graph boundaries. No financial or provider effects. */
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { calculatePaymentSnapshot } from '../money';
import { createCustomerPaymentPreparationRepository, customerPaymentFingerprint } from '../server/preparationRepository';
import { createProviderCorrelation, loadProviderCorrelationSource, withProviderCorrelationSnapshot } from '../server/providerCorrelation';
import { createProviderDisputeCorrelation } from '../server/providerDisputeCorrelation';
import { createProviderJournal } from '../server/providerJournal';
import { createProviderRefundCorrelation } from '../server/providerRefundCorrelation';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { dispatchProviderFixture } from './dispatchFixture';
import { assertVerifiedOfflineDisputeProjection, verifyOfflineDisputeReceipt } from './disputeEvidence';
import { type ProviderFixtureConfig, verifyOfflineProviderReceipt } from './evidence';
import { inspectProviderFixtureInbox } from './inspectFixture';
import { createOfflineOperationTransport, createOperationIdentity } from './operations';
import { verifyOfflineRefundReceipt } from './refundEvidence';
import { verifyOfflineCheckoutSessionReceipt } from './sessionEvidence';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

const receivedAt = new Date('2026-11-08T12:00:00Z');
const eventCreated = Math.floor(receivedAt.getTime() / 1000) - 1;
const config: ProviderFixtureConfig = { endpointId: 'endpoint_correlation', platformId: 'acct_fixtureplatform', accountScope: 'connected', expectedAccountId: 'acct_fixtureconnected', apiVersion: '2024-06-20', livemode: false };

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  config.platformId = `acct_${randomUUID().replaceAll('-', '')}`;
  config.expectedAccountId = `acct_${randomUUID().replaceAll('-', '')}`;
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => client?.close());

function signed(payload: Record<string, unknown>, observedAt = receivedAt) {
  const rawBody = new TextEncoder().encode(JSON.stringify(payload));
  const signature = createHmac('sha256', 'offline_correlation_fixture_only').update(rawBody).digest('hex');
  const verifier = vi.fn(async (input: { rawBody: Uint8Array; signature: string }) => createHmac('sha256', 'offline_correlation_fixture_only').update(input.rawBody).digest('hex') === input.signature);
  return { input: { rawBody, signature, receivedAt: observedAt }, verifier };
}
function event(type: string, object: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { id: `evt_${randomUUID().replaceAll('-', '')}`, object: 'event', type, created: eventCreated, account: config.expectedAccountId, api_version: config.apiVersion, livemode: false, data: { object }, ...overrides };
}
async function financialCounts() {
  return Promise.all(['appointment_payment', 'appointment_deposit', 'customer_payment_capture', 'customer_payment_refund', 'customer_payment_fee_refund', 'customer_payment_credit_decision'].map(async table => [table, (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]!.count]));
}

async function operationFixture(expiryMs = 600000) {
  const suffix = randomUUID();
  const salonId = `dispute_boundary_salon_${suffix}`;
  const appointmentId = `dispute_boundary_appt_${suffix}`;
  const technicianId = `dispute_boundary_tech_${suffix}`;
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Offline fixture' });
  await database.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Offline technician' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId, clientPhone: '4165550111', clientName: 'Offline customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const repository = createCustomerPaymentPreparationRepository(database);
  await repository.saveCustomerPaymentSettingsDraft({ salonId, actorId: 'fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } });
  const snapshot = calculatePaymentSnapshot({ currency: 'cad', collection: 'full', servicesCents: 10000, taxCents: 0, tipCents: 0, discountCents: 0 });
  const quote = await repository.prepareCustomerPaymentQuote({ salonId, appointmentId, requestId: randomUUID(), requestFingerprint: customerPaymentFingerprint({ fixture: suffix }) }, async () => ({ snapshot, stripeAccountId: config.expectedAccountId!, expiresAt: new Date(Date.now() + expiryMs), context: { fixture: suffix } }));
  const identity = createOperationIdentity({ id: randomUUID(), salonId, appointmentId, quoteId: quote.id, requestId: randomUUID(), contextHash: quote.fingerprint, platformId: config.platformId, accountScope: 'connected', accountId: config.expectedAccountId!, mode: 'test', apiVersion: '2024-06-20', provenance: 'offline_fixture', kind: 'checkout_create', targetId: null, parameters: { mode: 'payment', payment_method_types: ['card'], client_reference_id: quote.id, success_url: 'https://fixture.invalid/success', cancel_url: 'https://fixture.invalid/cancel', line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: snapshot.chargeCents, product_data: { name: 'Appointment payment and optional tip' } } }], payment_intent_data: { application_fee_amount: snapshot.applicationFeeCents } } });
  const journal = createProviderJournal(database);
  await journal.prepareOperation(identity);
  return { identity, journal, appointmentId, quote, snapshot };
}

async function graphFixture(withTwin = false, expiryMs = 600000) {
  const f = await operationFixture(expiryMs);
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

async function ingest(payload: Record<string, unknown>, cfg: ProviderFixtureConfig, observedAt = new Date()) {
  const fixture = signed(payload, observedAt);
  const receipt = await verifyOfflineProviderReceipt(fixture.input, cfg, fixture.verifier);
  return { receipt, inbox: await createProviderJournal(database).ingestReceipt(receipt) };
}
function chargeConfig(f: Pick<Awaited<ReturnType<typeof graphFixture>>, 'ids' | 'snapshot'>, endpointId = config.endpointId) {
  return { ...config, endpointId, expectedObject: { id: f.ids.charge, type: 'charge', amountCents: f.snapshot.chargeCents, currency: 'cad', paymentIntentId: f.ids.intent } };
}

async function refundOperation(f: Pick<Awaited<ReturnType<typeof graphFixture>>, 'identity' | 'quote' | 'ids' | 'journal'>, kind: 'customer_refund' | 'application_fee_refund', amount = kind === 'customer_refund' ? 2000 : 20, movementId = `${kind === 'customer_refund' ? 're' : 'fr'}_${randomUUID().replaceAll('-', '')}`, uncertain = false) {
  const common = { id: randomUUID(), salonId: f.identity.salonId, appointmentId: f.identity.appointmentId, quoteId: f.quote.id, requestId: randomUUID(), contextHash: f.quote.fingerprint, platformId: f.identity.platformId, mode: 'test' as const, apiVersion: '2024-06-20' as const, provenance: 'offline_fixture' as const };
  const identity = kind === 'customer_refund'
    ? createOperationIdentity({ ...common, kind, accountScope: 'connected', accountId: f.identity.accountId!, targetId: f.ids.intent, parameters: { payment_intent: f.ids.intent, amount } })
    : createOperationIdentity({ ...common, kind, accountScope: 'platform', accountId: null, targetId: f.ids.fee, parameters: { amount } });
  await f.journal.prepareOperation(identity);
  const transport = createOfflineOperationTransport([{ identity, dispatch: uncertain ? { type: 'uncertain' } : { type: 'accepted', objectId: movementId }, reconciliation: { type: 'unresolved' } }]);
  await dispatchProviderFixture(f.journal, transport, identity.id, { workerId: 'refund_fixture_worker', leaseMs: 60000 });
  return { identity, operation: (await f.journal.getOperation(identity.id))!, movementId, kind, amount };
}
async function refundReceipt(f: Pick<Awaited<ReturnType<typeof graphFixture>>, 'ids' | 'journal'>, movement: Awaited<ReturnType<typeof refundOperation>>, overrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}, persist = true) {
  const observedAt = new Date();
  const created = Math.floor(observedAt.getTime() / 1000);
  const payload = movement.kind === 'customer_refund'
    ? event('refund.created', { id: movement.movementId, object: 'refund', amount: movement.amount, currency: 'cad', status: 'succeeded', charge: f.ids.charge, payment_intent: f.ids.intent, created: Math.floor(movement.operation.firstDispatchedAt! / 1000), ...overrides }, { created, ...eventOverrides })
    : event('application_fee.refund.updated', { id: movement.movementId, object: 'fee_refund', amount: movement.amount, currency: 'cad', fee: f.ids.fee, created: Math.floor(movement.operation.firstDispatchedAt! / 1000), ...overrides }, { created, account: undefined, ...eventOverrides });
  const cfg = movement.kind === 'customer_refund' ? config : { ...config, accountScope: 'platform' as const, expectedAccountId: null };
  const fixture = signed(payload, observedAt);
  const pair = await verifyOfflineRefundReceipt(fixture.input, cfg, fixture.verifier);
  const inbox = await f.journal.ingestReceipt(pair.receipt);
  const refunds = createProviderRefundCorrelation(database);
  const projection = persist ? await refunds.persistRefundProjection(inbox.id, pair.receipt, pair.refund) : null;
  return { ...pair, inbox, payload, cfg, projection };
}

type Graph = Awaited<ReturnType<typeof graphFixture>>;
function balance(disputeId: string, created: number, reversal = false, overrides: Record<string, unknown> = {}) {
  const amount = reversal ? 2000 : -2000;
  const fee = reversal ? 0 : 300;
  return { id: `txn_${randomUUID().replaceAll('-', '')}`, object: 'balance_transaction', source: disputeId, amount, fee, net: amount - fee, currency: 'cad', exchange_rate: null, type: 'adjustment', reporting_category: reversal ? 'dispute_reversal' : 'dispute', status: 'available', created, available_on: created, ...overrides };
}
async function disputeReceipt(f: Pick<Graph, 'ids' | 'journal'>, objectOverrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}, persist = true) {
  const created = Math.floor(Date.now() / 1000);
  const id = typeof objectOverrides.id === 'string' ? objectOverrides.id : `dp_${randomUUID().replaceAll('-', '')}`;
  const payload = event('charge.dispute.funds_withdrawn', { id, object: 'dispute', livemode: false, charge: f.ids.charge, payment_intent: f.ids.intent, amount: 2000, currency: 'cad', status: 'under_review', created, balance_transactions: [balance(id, created)], ...objectOverrides }, { created, ...eventOverrides });
  const fixture = signed(payload, new Date());
  const pair = await verifyOfflineDisputeReceipt(fixture.input, config, fixture.verifier);
  const inbox = await f.journal.ingestReceipt(pair.receipt);
  const disputes = createProviderDisputeCorrelation(database);
  const projection = persist ? await disputes.persistDisputeProjection(inbox.id, pair.receipt, pair.dispute) : null;
  return { ...pair, inbox, payload, projection };
}
async function disputeFixture(objectOverrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
  const f = await graphFixture();
  await f.correlation.correlateOperation(f.identity.id);
  const evidence = await disputeReceipt(f, objectOverrides, eventOverrides);
  const disputes = createProviderDisputeCorrelation(database);
  return { ...f, evidence, disputes, record: () => disputes.correlateOperation(f.identity.id), read: () => disputes.getCorrelation(f.identity.id) };
}

async function withSuppressedInsert(table: string, work: () => Promise<void>) {
  await client.exec(`CREATE FUNCTION fixture_dispute_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER fixture_dispute_suppress BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_dispute_suppress();`);
  try {
    await work();
  } finally {
    await client.exec(`DROP TRIGGER fixture_dispute_suppress ON ${table}; DROP FUNCTION fixture_dispute_suppress();`);
  }
}

describe('dispute lifecycle cannot manufacture customer cash', () => {
  it('records proved withdrawal facts without changing original review, consumer holds, invoice or money', async () => {
    const f = await disputeFixture();
    const money = await financialCounts();
    const appointment = (await client.query('SELECT * FROM appointment WHERE id=$1', [f.appointmentId])).rows;
    const original = await f.journal.getInbox(f.evidence.inbox.id);
    await inspectProviderFixtureInbox(f.journal, f.evidence.inbox.id, { workerId: 'dispute_inspector', leaseMs: 60000 });
    const deliveries = (await client.query('SELECT * FROM customer_payment_provider_delivery WHERE inbox_id=$1 ORDER BY id', [f.evidence.inbox.id])).rows;
    const first = await f.record();

    expect(f.evidence.receipt.classification).toBe('review');
    expect(() => assertVerifiedOfflineDisputeProjection(f.evidence.dispute, f.evidence.receipt)).not.toThrow();
    expect(() => assertVerifiedOfflineDisputeProjection(JSON.parse(JSON.stringify(f.evidence.dispute)), f.evidence.receipt)).toThrow('CUSTOMER_PAYMENT_DISPUTE_EVIDENCE_UNVERIFIED');
    expect(first.result).toMatchObject({ source: 'offline_fixture_dispute_correlation', state: 'correlated', financialPostingAllowed: false, totals: { withdrawnCents: 2000, reinstatedCents: 0, feeCents: 300, netCents: -2300 } });
    expect(first.result.balanceCandidates).toHaveLength(1);
    expect(await f.record()).toMatchObject({ id: first.id, version: first.version, replayed: true });
    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: true, result: { state: 'correlated', financialPostingAllowed: false } });
    expect((await f.correlation.getCorrelation(f.identity.id))!.result.state).toBe('review');
    expect(await f.journal.getInbox(f.evidence.inbox.id)).toEqual(original);
    expect((await client.query('SELECT * FROM customer_payment_provider_delivery WHERE inbox_id=$1 ORDER BY id', [f.evidence.inbox.id])).rows).toEqual(deliveries);
    expect((await client.query('SELECT * FROM appointment WHERE id=$1', [f.appointmentId])).rows).toEqual(appointment);
    expect(await financialCounts()).toEqual(money);
  });

  it.each(['won', 'lost', 'warning_closed'] as const)('does not infer money from terminal status %s with no balance transaction', async (status) => {
    const f = await disputeFixture({ status, balance_transactions: [] }, { type: 'charge.dispute.closed' });

    expect((await f.record()).result).toMatchObject({ state: 'pending', balanceCandidates: [], totals: null, financialPostingAllowed: false });
  });

  it('does not fabricate reinstatement when a won dispute contains only proved withdrawal', async () => {
    const f = await disputeFixture({ status: 'won' }, { type: 'charge.dispute.closed' });

    expect((await f.record()).result).toMatchObject({ state: 'correlated', totals: { withdrawnCents: 2000, reinstatedCents: 0, feeCents: 300, netCents: -2300 }, financialPostingAllowed: false });
  });

  it('leaves an existing refund correlation and new dispute parent under review without merging their cash', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const movement = await refundOperation(f, 'customer_refund');
    await refundReceipt(f, movement);
    const refunds = createProviderRefundCorrelation(database);

    expect((await refunds.correlateOperation(movement.identity.id, f.identity.id)).result.state).toBe('correlated');

    const money = await financialCounts();
    await disputeReceipt(f);
    const disputes = createProviderDisputeCorrelation(database);

    expect((await disputes.correlateOperation(f.identity.id)).result).toMatchObject({ state: 'review', financialPostingAllowed: false });
    expect(await refunds.getCorrelation(movement.identity.id)).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect(await financialCounts()).toEqual(money);
  });

  it.each([undefined, ['txn_unexpanded'], [{ id: 'txn_partial', object: 'balance_transaction' }]])('retains unknown embedded balance details as review (%j)', async (details) => {
    const f = await disputeFixture({ balance_transactions: details });

    expect(f.evidence.dispute.classification).toBe('review');
    expect((await f.record()).result).toMatchObject({ state: 'review', balanceCandidates: [], totals: null, financialPostingAllowed: false });
  });
});

describe('current dispute relationships and immutable movement identity', () => {
  it('deduplicates dispute and balance identities across independent events and endpoints', async () => {
    const f = await disputeFixture();
    const first = await f.record();
    const repeated = signed({ ...f.evidence.payload, id: `evt_${randomUUID().replaceAll('-', '')}` }, new Date());
    const pair = await verifyOfflineDisputeReceipt(repeated.input, { ...config, endpointId: 'endpoint_dispute_repeat' }, repeated.verifier);
    const inbox = await f.journal.ingestReceipt(pair.receipt);
    await f.disputes.persistDisputeProjection(inbox.id, pair.receipt, pair.dispute);
    const current = await f.record();

    expect(current.result).toMatchObject({ state: 'correlated', totals: first.result.totals });

    for (const table of ['customer_payment_dispute_claim', 'customer_payment_dispute_balance_claim']) {
      expect((await client.query(`SELECT id FROM ${table} WHERE operation_id=$1`, [f.identity.id])).rows).toHaveLength(1);
    }
  });

  it('binds supplements to their actual retained receipt and refuses cloned proof', async () => {
    const f = await disputeFixture();
    const other = await disputeReceipt(f);

    await expect(f.disputes.persistDisputeProjection(f.evidence.inbox.id, other.receipt, other.dispute)).rejects.toThrow('CUSTOMER_PAYMENT_DISPUTE_ORIGINAL_RECEIPT_MISMATCH');
    await expect(f.disputes.persistDisputeProjection(f.evidence.inbox.id, f.evidence.receipt, JSON.parse(JSON.stringify(f.evidence.dispute)))).rejects.toThrow('CUSTOMER_PAYMENT_DISPUTE_EVIDENCE_UNVERIFIED');

    const again = await f.disputes.persistDisputeProjection(f.evidence.inbox.id, f.evidence.receipt, f.evidence.dispute);

    expect(again.id).toBe(f.evidence.projection!.id);
    expect((await client.query('SELECT id FROM customer_payment_dispute_projection WHERE inbox_id=$1', [f.evidence.inbox.id])).rows).toHaveLength(1);
  });

  it('invalidates a stored result when current capture evidence changes', async () => {
    const f = await disputeFixture();
    await f.record();
    const object = (f.chargePayload.data as { object: Record<string, unknown> }).object;
    await ingest({ ...f.chargePayload, id: `evt_${randomUUID().replaceAll('-', '')}`, data: { object: { ...object, amount: f.snapshot.chargeCents + 1 } } }, chargeConfig(f));

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
  });

  it('holds a second distinct dispute on the same parent, even without another claim', async () => {
    const f = await disputeFixture();
    await f.record();
    await disputeReceipt(f);

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect((await client.query('SELECT id FROM customer_payment_dispute_claim WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(1);
  });

  it('does not accept an explicitly supplied dispute from a different appointment and parent', async () => {
    const f = await disputeFixture();
    const other = await graphFixture();
    await other.correlation.correlateOperation(other.identity.id);
    const result = await createProviderDisputeCorrelation(database).correlateOperation(other.identity.id, [f.evidence.inbox.id]);

    expect(result.result).toMatchObject({ state: 'review', financialPostingAllowed: false });
    expect((await client.query('SELECT id FROM customer_payment_dispute_claim WHERE operation_id=$1', [other.identity.id])).rows).toHaveLength(0);
  });

  it('does not hide a known foreign payment intent behind a missing supplement', async () => {
    const f = await disputeFixture();
    await f.record();
    const object = (f.evidence.payload.data as { object: Record<string, unknown> }).object;
    await disputeReceipt(f, { ...object, payment_intent: 'pi_foreign' }, {}, false);

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', totals: null, financialPostingAllowed: false } });
  });

  it('holds unknown reference coverage until its matching supplement arrives', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const pair = await disputeReceipt(f, {}, {}, false);
    const disputes = createProviderDisputeCorrelation(database);
    const before = await disputes.correlateOperation(f.identity.id);

    expect(before.result).toMatchObject({ state: 'review', reasons: expect.arrayContaining(['DISPUTE_REFERENCE_COVERAGE_INCOMPLETE']), balanceCandidates: [], totals: null, financialPostingAllowed: false });

    await disputes.persistDisputeProjection(pair.inbox.id, pair.receipt, pair.dispute);
    const after = await disputes.correlateOperation(f.identity.id);

    expect(after.result.state).toBe('correlated');
    expect(after.sourceRevision).not.toBe(before.sourceRevision);
    expect(after.asOf).toEqual(after.snapshotStartedAt);
    expect(new Date(after.evaluatedAt).getTime()).toBeGreaterThanOrEqual(new Date(after.snapshotStartedAt).getTime());
  });

  it('does not correlate a dispute whose parent charge has conflicting ownership', async () => {
    const f = await graphFixture(true);
    await f.correlation.correlateOperation(f.identity.id);
    await f.correlation.correlateOperation(f.twin!.identity.id);
    await disputeReceipt(f);

    expect((await createProviderDisputeCorrelation(database).correlateOperation(f.identity.id)).result).toMatchObject({ state: 'review', financialPostingAllowed: false });
  });

  it('accepts late dispute evidence against a complete historical capture after quote expiry', async () => {
    const f = await graphFixture(false, 3000);
    await f.correlation.correlateOperation(f.identity.id);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, f.quote.expiresAt.getTime() - Date.now()) + 50));
    await disputeReceipt(f);

    expect((await createProviderDisputeCorrelation(database).correlateOperation(f.identity.id)).result.state).toBe('correlated');
  }, 15000);
});

describe('0123 durable write and raw SQL defenses', () => {
  it.each([
    ['customer_payment_dispute_candidate', 'CUSTOMER_PAYMENT_DISPUTE_CANDIDATE_WRITE_FAILED'],
    ['customer_payment_dispute_balance_candidate', 'CUSTOMER_PAYMENT_DISPUTE_BALANCE_CANDIDATE_WRITE_FAILED'],
    ['customer_payment_dispute_correlation_link', 'CUSTOMER_PAYMENT_DISPUTE_LINK_WRITE_FAILED'],
    ['customer_payment_dispute_correlation', 'CUSTOMER_PAYMENT_DISPUTE_CORRELATION_WRITE_FAILED'],
    ['customer_payment_dispute_claim', 'CUSTOMER_PAYMENT_DISPUTE_CLAIM_WRITE_FAILED'],
    ['customer_payment_dispute_balance_claim', 'CUSTOMER_PAYMENT_DISPUTE_BALANCE_CLAIM_WRITE_FAILED'],
  ])('rolls back every derived record if %s suppresses its insert', async (table, error) => {
    const f = await disputeFixture();
    const original = await f.journal.getInbox(f.evidence.inbox.id);
    const money = await financialCounts();
    await withSuppressedInsert(table, async () => {
      await expect(f.record()).rejects.toThrow(error);
    });

    expect(await f.read()).toBeNull();

    for (const child of ['customer_payment_dispute_correlation', 'customer_payment_dispute_correlation_link', 'customer_payment_dispute_claim', 'customer_payment_dispute_balance_claim']) {
      expect((await client.query(`SELECT id FROM ${child} WHERE operation_id=$1`, [f.identity.id])).rows).toHaveLength(0);
    }
    for (const candidate of ['customer_payment_dispute_candidate', 'customer_payment_dispute_balance_candidate']) {
      expect((await client.query(`SELECT id FROM ${candidate} WHERE first_operation_id=$1`, [f.identity.id])).rows).toHaveLength(0);
    }

    expect(await f.journal.getInbox(f.evidence.inbox.id)).toEqual(original);
    expect(await financialCounts()).toEqual(money);
    expect((await f.record()).result.state).toBe('correlated');
  });

  it('does not acknowledge a silently suppressed supplement', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const pair = await disputeReceipt(f, {}, {}, false);
    const disputes = createProviderDisputeCorrelation(database);
    await withSuppressedInsert('customer_payment_dispute_projection', async () => {
      await expect(disputes.persistDisputeProjection(pair.inbox.id, pair.receipt, pair.dispute)).rejects.toThrow('CUSTOMER_PAYMENT_DISPUTE_PROJECTION_WRITE_FAILED');
    });

    expect((await client.query('SELECT id FROM customer_payment_dispute_projection WHERE inbox_id=$1', [pair.inbox.id])).rows).toHaveLength(0);

    await disputes.persistDisputeProjection(pair.inbox.id, pair.receipt, pair.dispute);

    expect((await disputes.correlateOperation(f.identity.id)).result.state).toBe('correlated');
  });

  it('rejects malformed/null SQL proof and key shapes and forged financial authority', async () => {
    const f = await disputeFixture();
    const first = await f.record();
    for (const projection of [{}, { ...f.evidence.dispute, classification: null }, { ...f.evidence.dispute, balanceTransactions: [null] }, { ...f.evidence.dispute, transactionReferences: [] }, { ...f.evidence.dispute, transactionReferences: [{ id: null, sourceId: f.evidence.dispute.disputeId }] }]) {
      await expect(client.query(`INSERT INTO customer_payment_dispute_projection(id,inbox_id,projection_version,fingerprint,receipt_fingerprint,projection)
        SELECT $1,inbox_id,1,encode(sha256(convert_to(customer_payment_provider_canonical($2::jsonb-'receivedAt'),'UTF8')),'hex'),receipt_fingerprint,$2::jsonb
        FROM customer_payment_dispute_projection WHERE inbox_id=$3 LIMIT 1`, [randomUUID(), JSON.stringify(projection), f.evidence.inbox.id])).rejects.toThrow('CUSTOMER_PAYMENT_DISPUTE_PROJECTION_INVALID');
    }
    for (const table of ['customer_payment_dispute_candidate', 'customer_payment_dispute_balance_candidate']) {
      for (const key of ['{}', '{"platformId":null}']) {
        await expect(client.query(`INSERT INTO ${table}(id,key_hash,key,first_operation_id)
          VALUES($1,encode(sha256(convert_to(customer_payment_provider_canonical($2::jsonb),'UTF8')),'hex'),$2::jsonb,$3)`, [randomUUID(), key, f.identity.id])).rejects.toThrow('SCOPE');
      }
    }
    for (const authority of ['true', 'null']) {
      await expect(client.query(`INSERT INTO customer_payment_dispute_correlation(id,operation_id,version,source_revision,ownership_revision,source,result)
        SELECT $1,operation_id,version+1,source_revision,ownership_revision,source,jsonb_set(result,'{financialPostingAllowed}',$2::jsonb)
        FROM customer_payment_dispute_correlation WHERE id=$3`, [randomUUID(), authority, first.id])).rejects.toThrow('CUSTOMER_PAYMENT_DISPUTE_CORRELATION_INVALID');
    }
  });

  it('keeps all seven new proof, link, audit, candidate and claim tables append-only', async () => {
    const f = await disputeFixture();
    await f.record();
    const targets = [
      ['customer_payment_dispute_projection', 'inbox_id', f.evidence.inbox.id],
      ['customer_payment_dispute_correlation_link', 'operation_id', f.identity.id],
      ['customer_payment_dispute_correlation', 'operation_id', f.identity.id],
      ['customer_payment_dispute_candidate', 'first_operation_id', f.identity.id],
      ['customer_payment_dispute_claim', 'operation_id', f.identity.id],
      ['customer_payment_dispute_balance_candidate', 'first_operation_id', f.identity.id],
      ['customer_payment_dispute_balance_claim', 'operation_id', f.identity.id],
    ];
    for (const [table, column, value] of targets) {
      const before = (await client.query(`SELECT * FROM ${table} WHERE ${column}=$1`, [value])).rows;

      expect(before.length).toBeGreaterThan(0);
      await expect(client.query(`UPDATE ${table} SET created_at=clock_timestamp() WHERE ${column}=$1`, [value])).rejects.toThrow('customer payment preparation records are immutable');
      await expect(client.query(`DELETE FROM ${table} WHERE ${column}=$1`, [value])).rejects.toThrow('customer payment preparation records are immutable');
      expect((await client.query(`SELECT * FROM ${table} WHERE ${column}=$1`, [value])).rows).toEqual(before);
    }
  });
});

describe('dispute APIs remain inert outside explicitly enabled fixture tests', () => {
  it.each([
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'development'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
    ['VERCEL_ENV', 'production'],
  ])('refuses signed and durable work before callback or database access when %s=%s', async (name, value) => {
    const touched = vi.fn(() => {
      throw new Error('Unexpected database access');
    });
    const trap = new Proxy({} as never, { get: touched });
    const body = vi.fn(async () => {
      throw new Error('Unexpected snapshot callback');
    });
    const disputes = createProviderDisputeCorrelation(trap);
    const fixture = signed(event('charge.dispute.created', { object: 'dispute', id: 'dp_fixture', amount: 2000 }));
    vi.stubEnv(name, value);

    await expect(verifyOfflineDisputeReceipt(fixture.input, config, fixture.verifier)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    await expect(disputes.correlateOperation(randomUUID())).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    await expect(disputes.getCorrelation(randomUUID())).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    await expect(disputes.persistDisputeProjection(randomUUID(), {} as never, {} as never)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');

    for (const write of [false, true]) {
      await expect(loadProviderCorrelationSource(trap, randomUUID(), [], write)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
      await expect(withProviderCorrelationSnapshot(trap, write, body)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    }

    expect(touched).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
    expect(fixture.verifier).not.toHaveBeenCalled();
  });
});

describe('signed movement chronology and current balance exposure', () => {
  it('keeps a proved withdrawal and later reinstatement distinct while status changes without a new dispute claim', async () => {
    const f = await disputeFixture();
    await f.record();
    const object = (f.evidence.payload.data as { object: Record<string, unknown> }).object;
    const originalBalance = f.evidence.dispute.balanceTransactions[0]!;
    await new Promise(resolve => setTimeout(resolve, 1100));
    await disputeReceipt(f, { ...object, status: 'won', balance_transactions: [...object.balance_transactions as object[], balance(f.evidence.dispute.disputeId!, Math.floor(Date.now() / 1000), true)] }, { type: 'charge.dispute.funds_reinstated' });
    const current = await f.record();

    expect(current.result).toMatchObject({ state: 'correlated', disputeCandidate: { status: 'won' }, totals: { withdrawnCents: 2000, reinstatedCents: 2000, feeCents: 300, netCents: -300 }, financialPostingAllowed: false });
    expect(current.result.balanceCandidates).toHaveLength(2);
    expect(current.result.balanceCandidates.map(row => row.movementKey.balanceTransactionId)).toContain(originalBalance.id);
    expect((await client.query('SELECT id FROM customer_payment_dispute_claim WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(1);
    expect((await client.query('SELECT id FROM customer_payment_dispute_balance_claim WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(2);
  });

  it.each(['before', 'same_second'] as const)('refuses reversal %s relative to withdrawal even when final totals cancel', async (timing) => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const created = Math.floor(Date.now() / 1000);
    const disputeId = `dp_${randomUUID().replaceAll('-', '')}`;
    if (timing === 'before') {
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    await disputeReceipt(f, { id: disputeId, created, balance_transactions: [balance(disputeId, Math.floor(Date.now() / 1000)), balance(disputeId, created, true)] });

    expect((await createProviderDisputeCorrelation(database).correlateOperation(f.identity.id)).result).toMatchObject({ state: 'review', totals: null, financialPostingAllowed: false });
  });

  it('counts distinct partial withdrawals once and holds an additional unclaimed movement over the dispute amount', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const created = Math.floor(Date.now() / 1000);
    const disputeId = `dp_${randomUUID().replaceAll('-', '')}`;
    const pair = await disputeReceipt(f, { id: disputeId, created, balance_transactions: [balance(disputeId, created, false, { amount: -1000, fee: 0, net: -1000 }), balance(disputeId, created, false, { amount: -1000, fee: 0, net: -1000 })] });
    const disputes = createProviderDisputeCorrelation(database);

    expect((await disputes.correlateOperation(f.identity.id)).result).toMatchObject({ state: 'correlated', totals: { withdrawnCents: 2000, reinstatedCents: 0, feeCents: 0, netCents: -2000 } });

    await disputeReceipt(f, { id: disputeId, created, balance_transactions: [balance(disputeId, created, false, { amount: -1, fee: 0, net: -1 })] });

    expect(await disputes.getCorrelation(f.identity.id)).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect((await client.query('SELECT id FROM customer_payment_dispute_balance_claim WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(2);
    expect(pair.dispute.amountCents).toBe(2000);
  });

  it('treats changed fees/net under the same transaction ID as conflicting facts rather than a second movement', async () => {
    const f = await disputeFixture();
    await f.record();
    const object = (f.evidence.payload.data as { object: Record<string, unknown> }).object;
    const bt = (object.balance_transactions as Record<string, unknown>[])[0]!;
    await disputeReceipt(f, { ...object, balance_transactions: [{ ...bt, fee: 301, net: -2301 }] });

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', totals: null, financialPostingAllowed: false } });
    expect((await client.query('SELECT id FROM customer_payment_dispute_balance_claim WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(1);
  });

  it('does not create another movement when availability metadata changes', async () => {
    const f = await disputeFixture();
    const first = await f.record();
    const object = (f.evidence.payload.data as { object: Record<string, unknown> }).object;
    const bt = (object.balance_transactions as Record<string, unknown>[])[0]!;
    await disputeReceipt(f, { ...object, balance_transactions: [{ ...bt, status: 'pending', available_on: Number(bt.created) - 86400 }] });
    const current = await f.record();

    expect(current.result).toMatchObject({ state: 'correlated', totals: first.result.totals });
    expect((await client.query('SELECT id FROM customer_payment_dispute_balance_claim WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(1);
  });

  it('retains a closed event with nonterminal status as review', async () => {
    const f = await disputeFixture({ status: 'under_review' }, { type: 'charge.dispute.closed' });

    expect(f.evidence.dispute.classification).toBe('review');
    expect((await f.record()).result.state).toBe('review');
  });
});

describe('supplemental-only relationships and conflict anchors', () => {
  it('discovers a reused transaction on an otherwise unrelated unclaimed dispute and holds both parents', async () => {
    const first = await disputeFixture();
    await first.record();
    const second = await graphFixture();
    await second.correlation.correlateOperation(second.identity.id);
    const secondId = `dp_${randomUUID().replaceAll('-', '')}`;
    const txn = first.evidence.dispute.balanceTransactions[0]!.id;
    const created = Math.floor(Date.now() / 1000);
    const secondPair = await disputeReceipt(second, { id: secondId, created, balance_transactions: [balance(secondId, created, false, { id: txn })] });

    expect(secondPair.dispute.chargeId).not.toBe(first.evidence.dispute.chargeId);
    expect(secondPair.dispute.paymentIntentId).not.toBe(first.evidence.dispute.paymentIntentId);
    expect((await client.query('SELECT id FROM customer_payment_dispute_claim WHERE operation_id=$1', [second.identity.id])).rows).toHaveLength(0);
    expect(await first.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect((await createProviderDisputeCorrelation(database).correlateOperation(second.identity.id)).result.state).toBe('review');
    expect((await client.query('SELECT id FROM customer_payment_dispute_balance_candidate WHERE key->>\'balanceTransactionId\'=$1', [txn])).rows).toHaveLength(1);
  });

  it('discovers a reused transaction appearing only in a retained conflicting payload and keeps both anchors immutable', async () => {
    const first = await disputeFixture();
    await first.record();
    const second = await graphFixture();
    await second.correlation.correlateOperation(second.identity.id);
    const original = await disputeReceipt(second);
    const inboxBefore = (await client.query('SELECT * FROM customer_payment_provider_inbox WHERE id=$1', [original.inbox.id])).rows;
    const object = (original.payload.data as { object: Record<string, unknown> }).object;
    const originalBt = (object.balance_transactions as Record<string, unknown>[])[0]!;
    const txn = first.evidence.dispute.balanceTransactions[0]!.id;
    const changed = { ...original.payload, data: { object: { ...object, balance_transactions: [{ ...originalBt, id: txn }] } } };
    const signedConflict = signed(changed, new Date());
    const pair = await verifyOfflineDisputeReceipt(signedConflict.input, config, signedConflict.verifier);
    const disputes = createProviderDisputeCorrelation(database);

    await expect(disputes.persistDisputeProjection(original.inbox.id, pair.receipt, pair.dispute)).rejects.toThrow('CUSTOMER_PAYMENT_DISPUTE_ORIGINAL_RECEIPT_MISMATCH');
    await expect(second.journal.ingestReceipt(pair.receipt)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_INBOX_CONFLICT_RETAINED');

    const conflict = await disputes.persistDisputeProjection(original.inbox.id, pair.receipt, pair.dispute);
    const replay = await disputes.persistDisputeProjection(original.inbox.id, pair.receipt, pair.dispute);
    const retainedOriginal = await disputes.persistDisputeProjection(original.inbox.id, original.receipt, original.dispute);

    expect(conflict.conflictId).not.toBeNull();
    expect(replay.id).toBe(conflict.id);
    expect(retainedOriginal.id).toBe(original.projection!.id);
    expect(retainedOriginal.conflictId).toBeNull();
    expect((await client.query('SELECT id FROM customer_payment_dispute_projection WHERE inbox_id=$1', [original.inbox.id])).rows).toHaveLength(2);
    expect((await client.query('SELECT id FROM customer_payment_dispute_claim WHERE operation_id=$1', [second.identity.id])).rows).toHaveLength(0);
    expect(await first.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect((await disputes.correlateOperation(second.identity.id)).result.state).toBe('review');
    expect((await client.query('SELECT * FROM customer_payment_provider_inbox WHERE id=$1', [original.inbox.id])).rows).toEqual(inboxBefore);
    await expect(disputes.persistDisputeProjection(first.evidence.inbox.id, pair.receipt, pair.dispute)).rejects.toThrow('CUSTOMER_PAYMENT_DISPUTE_ORIGINAL_RECEIPT_MISMATCH');
    await expect(client.query(`INSERT INTO customer_payment_dispute_projection(id,inbox_id,conflict_id,projection_version,fingerprint,receipt_fingerprint,projection)
      SELECT $1,$2,conflict_id,projection_version,fingerprint,receipt_fingerprint,projection FROM customer_payment_dispute_projection WHERE id=$3`, [randomUUID(), first.evidence.inbox.id, conflict.id])).rejects.toThrow('CUSTOMER_PAYMENT_DISPUTE_CONFLICT_BINDING');
  });
});

describe('malformed money cannot hide a supplemental relationship', () => {
  it('finds an unclaimed malformed-money dispute by its retained transaction reference only', async () => {
    const first = await disputeFixture();
    await first.record();
    const second = await graphFixture();
    await second.correlation.correlateOperation(second.identity.id);
    const id = `dp_${randomUUID().replaceAll('-', '')}`;
    const txn = first.evidence.dispute.balanceTransactions[0]!.id;
    const malformed = await disputeReceipt(second, { id, balance_transactions: [balance(id, Math.floor(Date.now() / 1000), false, { id: txn, amount: 'unknown' })] });

    expect(malformed.dispute).toMatchObject({ classification: 'review', balanceTransactions: [], transactionReferenceCoverage: 'complete', transactionReferences: [{ id: txn, sourceId: id }] });
    expect((await client.query('SELECT id FROM customer_payment_dispute_claim WHERE operation_id=$1', [second.identity.id])).rows).toHaveLength(0);
    expect(await first.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
  });

  it('finds malformed-money transaction reuse occurring only inside a conflicting payload', async () => {
    const first = await disputeFixture();
    await first.record();
    const second = await graphFixture();
    await second.correlation.correlateOperation(second.identity.id);
    const original = await disputeReceipt(second);
    const object = (original.payload.data as { object: Record<string, unknown> }).object;
    const bt = (object.balance_transactions as Record<string, unknown>[])[0]!;
    const txn = first.evidence.dispute.balanceTransactions[0]!.id;
    const fixture = signed({ ...original.payload, data: { object: { ...object, balance_transactions: [{ ...bt, id: txn, fee: null }] } } }, new Date());
    const pair = await verifyOfflineDisputeReceipt(fixture.input, config, fixture.verifier);

    await expect(second.journal.ingestReceipt(pair.receipt)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_INBOX_CONFLICT_RETAINED');

    const projection = await createProviderDisputeCorrelation(database).persistDisputeProjection(original.inbox.id, pair.receipt, pair.dispute);

    expect(projection.conflictId).not.toBeNull();
    expect(pair.dispute).toMatchObject({ classification: 'review', balanceTransactions: [], transactionReferenceCoverage: 'complete', transactionReferences: [{ id: txn, sourceId: original.dispute.disputeId }] });
    expect(await first.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
  });

  it.each([3, 257])('does not certify a truncated %i-entry balance list when reuse is beyond supported money entries', async (size) => {
    const first = await disputeFixture();
    await first.record();
    const second = await graphFixture();
    await second.correlation.correlateOperation(second.identity.id);
    const id = `dp_${randomUUID().replaceAll('-', '')}`;
    const txn = first.evidence.dispute.balanceTransactions[0]!.id;
    const entries = Array.from({ length: size }, (_, i) => balance(id, Math.floor(Date.now() / 1000), false, i === size - 1 ? { id: txn } : {}));
    const pair = await disputeReceipt(second, { id, balance_transactions: entries });

    expect(pair.dispute.classification).toBe('review');
    expect(pair.dispute.balanceTransactions).toEqual([]);
    expect(pair.dispute.transactionReferenceCoverage).toBe(size > 256 ? 'overflow' : 'complete');
    expect(pair.dispute.transactionReferences).toHaveLength(Math.min(size, 256));
    expect(pair.dispute.transactionReferences.some(ref => ref.id === txn)).toBe(size <= 256);
    expect(await first.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
  });
});

describe('unknown coverage stays within its connected-account scope', () => {
  it('does not hold a different account on the same platform for unrelated missing references', async () => {
    const first = await disputeFixture();
    const recorded = await first.record();
    config.expectedAccountId = `acct_${randomUUID().replaceAll('-', '')}`;
    const other = await graphFixture();
    await other.correlation.correlateOperation(other.identity.id);
    const missing = await disputeReceipt(other, { balance_transactions: undefined });

    expect(missing.dispute.transactionReferenceCoverage).toBe('incomplete');
    expect(await first.read()).toMatchObject({ recordedSnapshotMatches: true, sourceRevision: recorded.sourceRevision, result: { state: 'correlated', financialPostingAllowed: false } });
    expect((await createProviderDisputeCorrelation(database).correlateOperation(other.identity.id)).result.state).toBe('review');
  });
});
