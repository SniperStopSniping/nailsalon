/** Independent offline refund/fee-return graph boundaries. No financial or provider effects. */
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
import { createProviderJournal } from '../server/providerJournal';
import { createProviderRefundCorrelation } from '../server/providerRefundCorrelation';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { dispatchProviderFixture, reconcileProviderFixture } from './dispatchFixture';
import { type ProviderFixtureConfig, verifyOfflineProviderReceipt } from './evidence';
import { inspectProviderFixtureInbox } from './inspectFixture';
import { createOfflineOperationTransport, createOperationIdentity } from './operations';
import { assertVerifiedOfflineRefundProjection, verifyOfflineRefundReceipt } from './refundEvidence';
import { verifyOfflineCheckoutSessionReceipt } from './sessionEvidence';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => client?.close());

const receivedAt = new Date('2026-11-08T12:00:00Z');
const eventCreated = Math.floor(receivedAt.getTime() / 1000) - 1;
const config: ProviderFixtureConfig = { endpointId: 'endpoint_correlation', platformId: 'acct_fixtureplatform', accountScope: 'connected', expectedAccountId: 'acct_fixtureconnected', apiVersion: '2024-06-20', livemode: false };
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
  const salonId = `refund_boundary_salon_${suffix}`;
  const appointmentId = `refund_boundary_appt_${suffix}`;
  const technicianId = `refund_boundary_tech_${suffix}`;
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Offline fixture' });
  await database.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Offline technician' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId, clientPhone: '4165550111', clientName: 'Offline customer', startTime: new Date('2030-01-01T12:00:00Z'), endTime: new Date('2030-01-01T13:00:00Z'), totalPrice: 10000, totalDurationMinutes: 60, status: 'confirmed' });
  const repository = createCustomerPaymentPreparationRepository(database);
  await repository.saveCustomerPaymentSettingsDraft({ salonId, actorId: 'fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } });
  const snapshot = calculatePaymentSnapshot({ currency: 'cad', collection: 'full', servicesCents: 10000, taxCents: 0, tipCents: 0, discountCents: 0 });
  const quote = await repository.prepareCustomerPaymentQuote({ salonId, appointmentId, requestId: randomUUID(), requestFingerprint: customerPaymentFingerprint({ fixture: suffix }) }, async () => ({ snapshot, stripeAccountId: 'acct_fixtureconnected', expiresAt: new Date(Date.now() + expiryMs), context: { fixture: suffix } }));
  const identity = createOperationIdentity({ id: randomUUID(), salonId, appointmentId, quoteId: quote.id, requestId: randomUUID(), contextHash: quote.fingerprint, platformId: 'acct_fixtureplatform', accountScope: 'connected', accountId: 'acct_fixtureconnected', mode: 'test', apiVersion: '2024-06-20', provenance: 'offline_fixture', kind: 'checkout_create', targetId: null, parameters: { mode: 'payment', payment_method_types: ['card'], client_reference_id: quote.id, success_url: 'https://fixture.invalid/success', cancel_url: 'https://fixture.invalid/cancel', line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: snapshot.chargeCents, product_data: { name: 'Appointment payment and optional tip' } } }], payment_intent_data: { application_fee_amount: snapshot.applicationFeeCents } } });
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
    ? createOperationIdentity({ ...common, kind, accountScope: 'connected', accountId: 'acct_fixtureconnected', targetId: f.ids.intent, parameters: { payment_intent: f.ids.intent, amount } })
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

describe('existing capture and immutable refund proof boundary', () => {
  it.each(['customer_refund', 'application_fee_refund'] as const)('keeps old capture review and original evidence intact after %s', async (kind) => {
    const f = await graphFixture();
    const first = await f.correlation.correlateOperation(f.identity.id);
    const original = await f.journal.getInbox(f.sessionInbox.id);
    const before = await financialCounts();
    const movement = await refundOperation(f, kind);
    const pair = await refundReceipt(f, movement);

    expect(first.result.state).toBe('correlated');
    expect(pair.refund).toMatchObject({ source: 'offline_signed_fixture_refund', classification: 'correlatable', kind, payloadDigest: pair.receipt.payloadDigest });
    expect(pair.receipt.classification).toBe('review');
    expect(() => assertVerifiedOfflineRefundProjection(pair.refund, pair.receipt)).not.toThrow();
    expect(() => assertVerifiedOfflineRefundProjection(JSON.parse(JSON.stringify(pair.refund)), pair.receipt)).toThrow('REFUND_EVIDENCE_UNVERIFIED');
    expect(await f.correlation.getCorrelation(f.identity.id)).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect(await f.journal.getInbox(f.sessionInbox.id)).toEqual(original);
    expect((await inspectProviderFixtureInbox(f.journal, pair.inbox.id, { workerId: 'fixture_inspector', leaseMs: 60000 })).every(row => row.state === 'review')).toBe(true);
    expect(await financialCounts()).toEqual(before);
  });

  it.each([
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'development'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
    ['VERCEL_ENV', 'production'],
  ])('gates supplemental refund verification before callback when %s=%s', async (name, value) => {
    const fixture = signed(event('refund.created', { id: 're_fixture', object: 'refund', amount: 100, currency: 'cad', charge: 'ch_fixture', payment_intent: 'pi_fixture', status: 'succeeded', created: eventCreated }));
    vi.stubEnv(name, value);

    await expect(verifyOfflineRefundReceipt(fixture.input, config, fixture.verifier)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    expect(fixture.verifier).not.toHaveBeenCalled();
  });
});

async function refundFixture(kind: 'customer_refund' | 'application_fee_refund' = 'customer_refund', amount = kind === 'customer_refund' ? 2000 : 20, overrides: Record<string, unknown> = {}) {
  const f = await graphFixture();
  await f.correlation.correlateOperation(f.identity.id);
  const movement = await refundOperation(f, kind, amount);
  const pair = await refundReceipt(f, movement, overrides);
  const refunds = createProviderRefundCorrelation(database);
  const record = () => refunds.correlateOperation(movement.identity.id, f.identity.id);
  const read = () => refunds.getCorrelation(movement.identity.id);
  return { ...f, movement, pair, refunds, record, read };
}

describe('current parent proof and independent returned money', () => {
  it.each(['customer_refund', 'application_fee_refund'] as const)('correlates %s only in the new offline graph and preserves existing holds and invoice fields', async (kind) => {
    const f = await refundFixture(kind);
    const money = await financialCounts();
    const appointment = (await client.query('SELECT * FROM appointment WHERE id=$1', [f.appointmentId])).rows[0];
    const original = await f.journal.getInbox(f.pair.inbox.id);
    await inspectProviderFixtureInbox(f.journal, f.pair.inbox.id, { workerId: 'fixture_inspector', leaseMs: 60000 });
    const deliveries = (await client.query('SELECT * FROM customer_payment_provider_delivery WHERE inbox_id=$1 ORDER BY id', [f.pair.inbox.id])).rows;
    const first = await f.record();

    expect(first.result).toMatchObject({ source: 'offline_fixture_refund_correlation', state: 'correlated', financialPostingAllowed: false, candidate: { kind, amountCents: f.movement.amount, operationId: f.movement.identity.id } });
    expect(first.result.totals).toEqual(kind === 'customer_refund' ? { customerRefundCents: 2000, applicationFeeRefundCents: 0 } : { customerRefundCents: 0, applicationFeeRefundCents: 20 });
    expect(await f.record()).toMatchObject({ id: first.id, version: first.version, replayed: true, candidateId: first.candidateId });
    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: true, result: { state: 'correlated', financialPostingAllowed: false } });
    expect((await f.correlation.getCorrelation(f.identity.id))!.result.state).toBe('review');
    expect(await f.journal.getInbox(f.pair.inbox.id)).toEqual(original);
    expect((await inspectProviderFixtureInbox(f.journal, f.pair.inbox.id, { workerId: 'fixture_inspector', leaseMs: 60000 })).every(row => row.state === 'review')).toBe(true);
    expect((await client.query('SELECT * FROM customer_payment_provider_delivery WHERE inbox_id=$1 ORDER BY id', [f.pair.inbox.id])).rows).toEqual(deliveries);
    expect((await client.query('SELECT * FROM appointment WHERE id=$1', [f.appointmentId])).rows[0]).toEqual(appointment);
    expect(await financialCounts()).toEqual(money);
  });

  it('keeps customer refunds and platform fee returns separate and deduplicates transport without new movement claims', async () => {
    const f = await refundFixture();
    const first = await f.record();
    const fee = await refundOperation(f, 'application_fee_refund', 20);
    await refundReceipt(f, fee);
    const feeResult = await f.refunds.correlateOperation(fee.identity.id, f.identity.id);
    const duplicate = signed({ ...f.pair.payload, id: `evt_${randomUUID().replaceAll('-', '')}` }, new Date());
    const pair = await verifyOfflineRefundReceipt(duplicate.input, { ...f.pair.cfg, endpointId: 'endpoint_refund_duplicate' }, duplicate.verifier);
    const inbox = await f.journal.ingestReceipt(pair.receipt);
    await f.refunds.persistRefundProjection(inbox.id, pair.receipt, pair.refund);
    const current = await f.record();

    expect(feeResult.result).toMatchObject({ state: 'correlated', totals: { customerRefundCents: 2000, applicationFeeRefundCents: 20 } });
    expect(current.result).toMatchObject({ state: 'correlated', totals: { customerRefundCents: 2000, applicationFeeRefundCents: 20 } });
    expect(current.candidateId).toBe(first.candidateId);
    expect((await client.query('SELECT id FROM customer_payment_movement_claim WHERE candidate_id=$1', [first.candidateId])).rows).toHaveLength(1);
  });

  it.each(['charge', 'fee'] as const)('invalidates child proof when current original %s evidence contradicts the stored parent snapshot', async (kind) => {
    const f = await refundFixture();
    await f.record();
    const payload = kind === 'charge' ? f.chargePayload : f.feePayload;
    const object = (payload.data as { object: Record<string, unknown> }).object;
    const changed = { ...payload, id: `evt_${randomUUID().replaceAll('-', '')}`, data: { object: kind === 'charge' ? { ...object, amount: f.snapshot.chargeCents + 1, amount_captured: f.snapshot.chargeCents + 1 } : { ...object, amount: f.snapshot.applicationFeeCents + 1 } } };
    await ingest(changed, kind === 'charge' ? chargeConfig(f, 'endpoint_parent_conflict') : { ...config, accountScope: 'platform', expectedAccountId: null });

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect((await f.record()).result.state).toBe('review');
  });

  it('rejects foreign tenant parent selection without pinning the wrong parent', async () => {
    const f = await refundFixture();
    const foreign = await graphFixture();
    await foreign.correlation.correlateOperation(foreign.identity.id);

    await expect(f.refunds.correlateOperation(f.movement.identity.id, foreign.identity.id)).rejects.toThrow();

    expect(await f.read()).toBeNull();
    expect((await client.query('SELECT id FROM customer_payment_refund_correlation_link WHERE operation_id=$1', [f.movement.identity.id])).rows).toHaveLength(0);
    expect((await f.record()).result.state).toBe('correlated');
    await expect(f.refunds.correlateOperation(f.movement.identity.id, foreign.identity.id)).rejects.toThrow('CUSTOMER_PAYMENT_REFUND_PARENT_CONFLICT');
  });

  it('accepts a late refund against the complete historical capture after quote expiry', async () => {
    const f = await graphFixture(false, 3000);
    await f.correlation.correlateOperation(f.identity.id);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, f.quote.expiresAt.getTime() - Date.now()) + 50));
    const movement = await refundOperation(f, 'customer_refund');
    await refundReceipt(f, movement);
    const result = await createProviderRefundCorrelation(database).correlateOperation(movement.identity.id, f.identity.id);

    expect(new Date().getTime()).toBeGreaterThan(f.quote.expiresAt.getTime());
    expect(result.result).toMatchObject({ state: 'correlated', financialPostingAllowed: false, totals: { customerRefundCents: 2000, applicationFeeRefundCents: 0 } });
  }, 15000);
});

describe('refund status and cumulative movement evidence', () => {
  it('allows strictly earlier pending then succeeded, but later pending invalidates the effective view', async () => {
    const f = await refundFixture('customer_refund', 2000, { status: 'pending' });

    expect((await f.record()).result.state).toBe('pending');

    await new Promise(resolve => setTimeout(resolve, 1100));
    await refundReceipt(f, f.movement, { status: 'succeeded' }, { type: 'refund.updated' });

    expect((await f.record()).result).toMatchObject({ state: 'correlated', totals: { customerRefundCents: 2000, applicationFeeRefundCents: 0 } });

    await refundReceipt(f, f.movement, { status: 'pending' }, { type: 'refund.updated' });

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review' } });
  }, 10000);

  it.each(['failed', 'canceled', 'requires_action'] as const)('keeps signed %s customer movement under review', async (status) => {
    const f = await refundFixture('customer_refund', 2000, { status });

    expect((await f.record()).result).toMatchObject({ state: 'review', financialPostingAllowed: false });
  });

  it.each(['customer_refund', 'application_fee_refund'] as const)('counts distinct unclaimed %s siblings and refuses totals above the original amount', async (kind) => {
    const f = await refundFixture(kind);
    const first = await f.record();
    const cap = kind === 'customer_refund' ? f.snapshot.chargeCents : f.snapshot.applicationFeeCents;
    const sibling = await refundOperation(f, kind, cap - f.movement.amount);
    await refundReceipt(f, sibling);
    const atCap = await f.record();

    expect(atCap.result.state).toBe('correlated');
    expect(atCap.result.totals![kind === 'customer_refund' ? 'customerRefundCents' : 'applicationFeeRefundCents']).toBe(cap);

    const excess = await refundOperation(f, kind, 1);
    await refundReceipt(f, excess);

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', reasons: expect.arrayContaining(['CUMULATIVE_REFUND_EXCEEDS_PARENT']) } });
    expect((await client.query('SELECT id FROM customer_payment_movement_claim WHERE candidate_id=$1', [first.candidateId])).rows).toHaveLength(1);
    expect((await client.query('SELECT id FROM customer_payment_movement_claim WHERE operation_id=$1', [sibling.identity.id])).rows).toHaveLength(0);
  });

  it('does not use successful-looking movement evidence to bypass an uncertain operation result', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const movement = await refundOperation(f, 'customer_refund', 2000, `re_${randomUUID().replaceAll('-', '')}`, true);
    await refundReceipt(f, movement);
    const refunds = createProviderRefundCorrelation(database);
    const first = await refunds.correlateOperation(movement.identity.id, f.identity.id);

    expect(first.result).toMatchObject({ state: 'pending', candidate: null, financialPostingAllowed: false });

    const recovery = createOfflineOperationTransport([{ identity: movement.identity, dispatch: { type: 'uncertain' }, reconciliation: { type: 'exists', objectId: movement.movementId } }]);
    await reconcileProviderFixture(f.journal, recovery, movement.identity.id, { workerId: 'fixture_recovery', leaseMs: 60000 });

    expect((await refunds.correlateOperation(movement.identity.id, f.identity.id)).result.state).toBe('correlated');
  });

  it('makes both operations review when one scoped refund object is claimed twice', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const movement = await refundOperation(f, 'customer_refund');
    const duplicate = await refundOperation(f, 'customer_refund', movement.amount, movement.movementId);
    await refundReceipt(f, movement, { created: Math.floor(duplicate.operation.firstDispatchedAt! / 1000) });
    const refunds = createProviderRefundCorrelation(database);
    const first = await refunds.correlateOperation(movement.identity.id, f.identity.id);
    const second = await refunds.correlateOperation(duplicate.identity.id, f.identity.id);

    expect(second.candidateId).toBe(first.candidateId);
    expect(second.result).toMatchObject({ state: 'review', reasons: expect.arrayContaining(['MOVEMENT_OWNERSHIP_CONFLICT']) });
    expect(await refunds.getCorrelation(movement.identity.id)).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review' } });
    expect((await client.query('SELECT id FROM customer_payment_movement_claim WHERE candidate_id=$1', [first.candidateId])).rows).toHaveLength(2);
  });
});

async function withSuppressedInsert(table: string, work: () => Promise<void>) {
  await client.exec(`CREATE FUNCTION fixture_refund_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER fixture_refund_suppress BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_refund_suppress();`);
  try {
    await work();
  } finally {
    await client.exec(`DROP TRIGGER fixture_refund_suppress ON ${table}; DROP FUNCTION fixture_refund_suppress();`);
  }
}

describe('0122 durable journal rollback and SQL boundaries', () => {
  it.each([
    ['customer_payment_movement_candidate', 'CUSTOMER_PAYMENT_MOVEMENT_CANDIDATE_WRITE_FAILED'],
    ['customer_payment_refund_correlation_link', 'CUSTOMER_PAYMENT_REFUND_LINK_WRITE_FAILED'],
    ['customer_payment_movement_claim', 'CUSTOMER_PAYMENT_MOVEMENT_CLAIM_WRITE_FAILED'],
  ])('rolls back every derived write when %s silently suppresses its insert', async (table, error) => {
    const f = await refundFixture();
    const original = await f.journal.getInbox(f.pair.inbox.id);
    const money = await financialCounts();
    await withSuppressedInsert(table, async () => {
      await expect(f.record()).rejects.toThrow(error);
    });

    expect(await f.read()).toBeNull();

    for (const child of ['customer_payment_refund_correlation', 'customer_payment_refund_correlation_link', 'customer_payment_movement_claim']) {
      expect((await client.query(`SELECT id FROM ${child} WHERE operation_id=$1`, [f.movement.identity.id])).rows).toHaveLength(0);
    }

    expect((await client.query('SELECT id FROM customer_payment_movement_candidate WHERE first_operation_id=$1', [f.movement.identity.id])).rows).toHaveLength(0);
    expect(await f.journal.getInbox(f.pair.inbox.id)).toEqual(original);
    expect(await financialCounts()).toEqual(money);
    expect((await f.record()).result.state).toBe('correlated');
  });

  it('does not acknowledge a suppressed immutable supplement and permits a clean retry', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const movement = await refundOperation(f, 'customer_refund');
    const pair = await refundReceipt(f, movement, {}, {}, false);
    const refunds = createProviderRefundCorrelation(database);
    const original = await f.journal.getInbox(pair.inbox.id);
    const money = await financialCounts();
    await withSuppressedInsert('customer_payment_refund_projection', async () => {
      await expect(refunds.persistRefundProjection(pair.inbox.id, pair.receipt, pair.refund)).rejects.toThrow('CUSTOMER_PAYMENT_REFUND_PROJECTION_WRITE_FAILED');
    });

    expect((await client.query('SELECT id FROM customer_payment_refund_projection WHERE inbox_id=$1', [pair.inbox.id])).rows).toHaveLength(0);
    expect(await f.journal.getInbox(pair.inbox.id)).toEqual(original);
    expect(await financialCounts()).toEqual(money);

    await refunds.persistRefundProjection(pair.inbox.id, pair.receipt, pair.refund);

    expect((await refunds.correlateOperation(movement.identity.id, f.identity.id)).result.state).toBe('correlated');
  });

  it('rejects raw SQL missing/null projection and movement-key shapes, forged financial authority, and mismatched parents', async () => {
    const f = await refundFixture();
    const first = await f.record();
    const foreign = await graphFixture();
    const money = await financialCounts();
    for (const projection of ['{}', JSON.stringify({ ...f.pair.refund, classification: null })]) {
      await expect(client.query(`INSERT INTO customer_payment_refund_projection(id,inbox_id,projection_version,fingerprint,receipt_fingerprint,projection)
        SELECT $1,inbox_id,1,encode(sha256(convert_to(customer_payment_provider_canonical($2::jsonb-'receivedAt'),'UTF8')),'hex'),receipt_fingerprint,$2::jsonb
        FROM customer_payment_refund_projection WHERE inbox_id=$3 LIMIT 1`, [randomUUID(), projection, f.pair.inbox.id])).rejects.toThrow('CUSTOMER_PAYMENT_REFUND_PROJECTION_INVALID');
    }
    for (const key of [{ ...first.result.candidate!.movementKey, kind: null }, { ...first.result.candidate!.movementKey, accountScope: null }, {}]) {
      await expect(client.query(`INSERT INTO customer_payment_movement_candidate(id,movement_key_hash,movement_key,first_operation_id)
        VALUES($1,encode(sha256(convert_to(customer_payment_provider_canonical($2::jsonb),'UTF8')),'hex'),$2::jsonb,$3)`, [randomUUID(), JSON.stringify(key), f.movement.identity.id])).rejects.toThrow('CUSTOMER_PAYMENT_MOVEMENT_CANDIDATE_SCOPE');
    }
    for (const authority of ['true', 'null']) {
      await expect(client.query(`INSERT INTO customer_payment_refund_correlation(id,operation_id,parent_operation_id,version,source_revision,ownership_revision,source,result)
        SELECT $1,operation_id,parent_operation_id,version+1,source_revision,ownership_revision,source,jsonb_set(result,'{financialPostingAllowed}',$2::jsonb)
        FROM customer_payment_refund_correlation WHERE id=$3`, [randomUUID(), authority, first.id])).rejects.toThrow('CUSTOMER_PAYMENT_REFUND_CORRELATION_INVALID');
    }

    await expect(client.query(`INSERT INTO customer_payment_refund_correlation(id,operation_id,parent_operation_id,version,source_revision,ownership_revision,source,result)
      SELECT $1,operation_id,$2,version+1,source_revision,ownership_revision,source,result FROM customer_payment_refund_correlation WHERE id=$3`, [randomUUID(), foreign.identity.id, first.id])).rejects.toThrow('CUSTOMER_PAYMENT_REFUND_CORRELATION_INVALID');

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: true, result: { state: 'correlated', financialPostingAllowed: false } });
    expect(await financialCounts()).toEqual(money);
  });

  it('makes every new evidence, support, candidate, claim and audit table append-only', async () => {
    const f = await refundFixture();
    await f.record();
    const targets = [
      ['customer_payment_refund_projection', 'inbox_id', f.pair.inbox.id],
      ['customer_payment_refund_correlation_link', 'operation_id', f.movement.identity.id],
      ['customer_payment_refund_correlation', 'operation_id', f.movement.identity.id],
      ['customer_payment_movement_candidate', 'first_operation_id', f.movement.identity.id],
      ['customer_payment_movement_claim', 'operation_id', f.movement.identity.id],
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

describe('complete current closure and supplement precedence', () => {
  it('discovers a child relationship existing only in conflicting duplicate payload evidence', async () => {
    const f = await refundFixture();
    await f.record();
    const id = `evt_${randomUUID().replaceAll('-', '')}`;
    const unrelated = event('refund.created', { id: 're_unrelated', object: 'refund', status: 'succeeded', amount: 2000, currency: 'cad', charge: 'ch_unrelated', payment_intent: 'pi_unrelated', created: Math.floor(Date.now() / 1000) }, { id, created: Math.floor(Date.now() / 1000) });
    await ingest(unrelated, config);

    await expect(ingest({ ...f.pair.payload, id }, config)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_INBOX_CONFLICT_RETAINED');

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect((await f.record()).result.state).toBe('review');
  });

  it('keeps missing supplemental evidence pending, then resolves only after the exact persisted supplement arrives', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const movement = await refundOperation(f, 'customer_refund');
    const pair = await refundReceipt(f, movement, {}, {}, false);
    const refunds = createProviderRefundCorrelation(database);
    const missing = await refunds.correlateOperation(movement.identity.id, f.identity.id);

    expect(missing.result).toMatchObject({ state: 'pending', candidate: null, totals: null, financialPostingAllowed: false });

    await refunds.persistRefundProjection(pair.inbox.id, pair.receipt, pair.refund);
    const resolved = await refunds.correlateOperation(movement.identity.id, f.identity.id);

    expect(resolved.result.state).toBe('correlated');
    expect(resolved.sourceRevision).not.toBe(missing.sourceRevision);
    expect(resolved.asOf).toEqual(resolved.snapshotStartedAt);
    expect(new Date(resolved.evaluatedAt).getTime()).toBeGreaterThanOrEqual(new Date(resolved.snapshotStartedAt).getTime());
  });

  it('does not let a missing supplement mask an independently contradictory fee-return relationship', async () => {
    const f = await refundFixture();
    await f.record();
    const missing = await refundOperation(f, 'customer_refund', 10);
    await refundReceipt(f, missing, {}, {}, false);
    const fee = await refundOperation(f, 'application_fee_refund', 20);
    await refundReceipt(f, fee, { charge: 'ch_foreign' }, {}, false);

    expect(await f.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', candidate: null, totals: null, financialPostingAllowed: false } });
  });

  it('refuses a child when another operation has already claimed its parent charge', async () => {
    const f = await graphFixture(true);
    await f.correlation.correlateOperation(f.identity.id);
    await f.correlation.correlateOperation(f.twin!.identity.id);
    const movement = await refundOperation(f, 'customer_refund');
    await refundReceipt(f, movement);

    expect((await createProviderRefundCorrelation(database).correlateOperation(movement.identity.id, f.identity.id)).result).toMatchObject({ state: 'review', reasons: expect.arrayContaining(['PARENT_CAPTURE_OWNERSHIP_CONFLICT']), financialPostingAllowed: false });
  });

  it.each(['customer_refund', 'application_fee_refund'] as const)('refuses a %s receipt in the wrong connected/platform account envelope', async (kind) => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const movement = await refundOperation(f, kind);
    const pair = await refundReceipt(f, movement, {}, { account: kind === 'customer_refund' ? undefined : 'acct_fixtureconnected' });

    expect(pair.refund.classification).toBe('review');
    expect((await createProviderRefundCorrelation(database).correlateOperation(movement.identity.id, f.identity.id)).result.state).not.toBe('correlated');
  });

  it('does not fork a platform fee-return identity under a different original fee or tenant', async () => {
    const first = await refundFixture('application_fee_refund');
    const recorded = await first.record();
    const second = await graphFixture();
    await second.correlation.correlateOperation(second.identity.id);
    const reused = await refundOperation(second, 'application_fee_refund', first.movement.amount, first.movement.movementId);
    await refundReceipt(second, reused);
    const current = await createProviderRefundCorrelation(database).correlateOperation(reused.identity.id, second.identity.id);

    expect(current.result).toMatchObject({ state: 'review', financialPostingAllowed: false });
    expect(await first.read()).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });

    const candidates = (await client.query('SELECT id FROM customer_payment_movement_candidate WHERE movement_key->>\'movementId\'=$1', [first.movement.movementId])).rows;

    expect(candidates).toEqual([{ id: recorded.candidateId }]);
  });

  it.each(['customer_refund', 'application_fee_refund'] as const)('rejects %s creation predating the proven original charge or fee', async (kind) => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const movement = await refundOperation(f, kind);
    await refundReceipt(f, movement, { created: Number(kind === 'customer_refund' ? f.chargePayload.created : f.feePayload.created) - 1 });

    expect((await createProviderRefundCorrelation(database).correlateOperation(movement.identity.id, f.identity.id)).result).toMatchObject({ state: 'review', reasons: expect.arrayContaining(['MOVEMENT_TIME_INVALID']), financialPostingAllowed: false });
  });

  it.each([
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
  ])('refuses every durable correlation API before DB access when %s=%s', async (name, value) => {
    const db = { select: vi.fn(), transaction: vi.fn() };
    const refunds = createProviderRefundCorrelation(db as never);
    vi.stubEnv(name, value);

    await expect(refunds.correlateOperation(randomUUID(), randomUUID())).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    await expect(refunds.getCorrelation(randomUUID())).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    await expect(refunds.persistRefundProjection(randomUUID(), {} as never, {} as never)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe('direct shared correlation helpers remain fixture-only', () => {
  it.each([
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
  ])('refuses direct helper imports before reading a DB property when %s=%s', async (name, value) => {
    const touched = vi.fn(() => {
      throw new Error('Unexpected database access');
    });
    const trap = new Proxy({} as never, { get: touched });
    const body = vi.fn(async () => {
      throw new Error('Unexpected snapshot callback');
    });
    vi.stubEnv(name, value);

    for (const write of [false, true]) {
      await expect(loadProviderCorrelationSource(trap, randomUUID(), [], write)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
      await expect(withProviderCorrelationSnapshot(trap, write, body)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    }

    expect(touched).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });
});
