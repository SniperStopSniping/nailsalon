/** Independent full-journal correlation boundaries. Offline fixture facts only. */
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { calculatePaymentSnapshot } from '../money';
import { createCustomerPaymentPreparationRepository, customerPaymentFingerprint } from '../server/preparationRepository';
import { createProviderCorrelation } from '../server/providerCorrelation';
import { createProviderJournal } from '../server/providerJournal';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { correlateProviderFixture } from './correlation';
import { dispatchProviderFixture } from './dispatchFixture';
import { type ProviderFixtureConfig, verifyOfflineProviderReceipt } from './evidence';
import { inspectProviderFixtureInbox } from './inspectFixture';
import { createOfflineOperationTransport, createOperationIdentity } from './operations';
import { assertVerifiedOfflineSessionProjection, verifyOfflineCheckoutSessionReceipt } from './sessionEvidence';

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
function sessionEvent(reference = '00000000-0000-4000-8000-000000000001', overrides: Record<string, unknown> = {}) {
  return event('checkout.session.completed', { id: 'cs_test_fixture', object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid', payment_intent: 'pi_fixture', amount_total: 10000, currency: 'cad', client_reference_id: reference, created: eventCreated - 60, expires_at: eventCreated + 300, metadata: { appointment_id: 'untrusted_metadata_appointment' }, ...overrides });
}
async function financialCounts() {
  return Promise.all(['appointment_payment', 'appointment_deposit', 'customer_payment_capture', 'customer_payment_refund', 'customer_payment_fee_refund', 'customer_payment_credit_decision'].map(async table => [table, (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]!.count]));
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
  const quote = await repository.prepareCustomerPaymentQuote({ salonId, appointmentId, requestId: randomUUID(), requestFingerprint: customerPaymentFingerprint({ fixture: suffix }) }, async () => ({ snapshot, stripeAccountId: 'acct_fixtureconnected', expiresAt: new Date(Date.now() + 600000), context: { fixture: suffix } }));
  const identity = createOperationIdentity({ id: randomUUID(), salonId, appointmentId, quoteId: quote.id, requestId: randomUUID(), contextHash: quote.fingerprint, platformId: 'acct_fixtureplatform', accountScope: 'connected', accountId: 'acct_fixtureconnected', mode: 'test', apiVersion: '2024-06-20', provenance: 'offline_fixture', kind: 'checkout_create', targetId: null, parameters: { mode: 'payment', payment_method_types: ['card'], client_reference_id: quote.id, success_url: 'https://fixture.invalid/success', cancel_url: 'https://fixture.invalid/cancel', line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: snapshot.chargeCents, product_data: { name: 'Appointment payment and optional tip' } } }], payment_intent_data: { application_fee_amount: snapshot.applicationFeeCents } } });
  const journal = createProviderJournal(database);
  await journal.prepareOperation(identity);
  return { identity, journal, appointmentId, quote, snapshot };
}

describe('supplemental Session evidence boundary', () => {
  it('retains the exact original review receipt and delivery holds while keeping the supplemental proof separate', async () => {
    const fixture = signed(sessionEvent());
    const original = await verifyOfflineProviderReceipt(fixture.input, config, fixture.verifier);
    const pair = await verifyOfflineCheckoutSessionReceipt(fixture.input, config, fixture.verifier);
    const journal = createProviderJournal(database);
    const before = await financialCounts();
    const inbox = await journal.ingestReceipt(pair.receipt);
    const deliveries = await inspectProviderFixtureInbox(journal, inbox.id, { workerId: 'fixture_inspector', leaseMs: 60000 });

    expect(pair.receipt).toEqual(original);
    expect(pair.receipt.classification).toBe('review');
    expect(pair.session).toMatchObject({ source: 'offline_signed_fixture_session', classification: 'correlatable', payloadDigest: original.payloadDigest });
    expect(deliveries.every(row => row.state === 'review')).toBe(true);
    expect((await journal.getInbox(inbox.id))!.receipt).toEqual(JSON.parse(JSON.stringify(original)));
    expect(JSON.stringify(pair.session)).not.toContain('untrusted_metadata_appointment');
    expect(() => assertVerifiedOfflineSessionProjection(pair.session, pair.receipt)).not.toThrow();
    expect(() => assertVerifiedOfflineSessionProjection(JSON.parse(JSON.stringify(pair.session)), pair.receipt)).toThrow('SESSION_EVIDENCE_UNVERIFIED');
    expect(() => assertVerifiedOfflineSessionProjection(pair.session, original)).toThrow('SESSION_EVIDENCE_UNVERIFIED');
    expect(await financialCounts()).toEqual(before);
  });

  it.each([
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'development'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
    ['VERCEL_ENV', 'production'],
  ])('refuses supplemental evidence before verifier work when %s=%s', async (name, value) => {
    const fixture = signed(sessionEvent());
    vi.stubEnv(name, value);

    await expect(verifyOfflineCheckoutSessionReceipt(fixture.input, config, fixture.verifier)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    expect(fixture.verifier).not.toHaveBeenCalled();
  });
});

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

describe('real operation and retained-evidence graph', () => {
  it('correlates a complete reciprocal graph without rebranding original review or creating cash', async () => {
    const f = await graphFixture();
    const before = await financialCounts();
    const original = await f.journal.getInbox(f.sessionInbox.id);
    const result = correlateProviderFixture(f.input);

    expect(result).toMatchObject({ source: 'offline_fixture_correlation', state: 'correlated', financialPostingAllowed: false, captureCandidate: { chargeKey: { chargeId: f.ids.charge }, sessionId: f.ids.session, paymentIntentId: f.ids.intent, amountCents: f.snapshot.chargeCents }, fee: { state: 'matched', feeId: f.ids.fee } });
    expect(await f.journal.getInbox(f.sessionInbox.id)).toEqual(original);
    expect(original!.receipt.classification).toBe('review');
    expect(await financialCounts()).toEqual(before);
  });

  it('requires the persisted successful Session result rather than valid-looking metadata or a different Session', async () => {
    const f = await graphFixture();
    const other = { ...f.input, operation: { ...f.input.operation, result: { provenance: 'offline_fixture' as const, objectId: 'cs_test_other' } } };

    expect(correlateProviderFixture(other)).toMatchObject({ state: 'review', financialPostingAllowed: false });
    expect(correlateProviderFixture({ ...f.input, receipts: f.input.receipts.filter(row => row.receipt.eventType !== 'application_fee.created') })).toMatchObject({ state: 'pending', financialPostingAllowed: false });
  });
});

async function ingest(payload: Record<string, unknown>, cfg: ProviderFixtureConfig, observedAt = new Date()) {
  const fixture = signed(payload, observedAt);
  const receipt = await verifyOfflineProviderReceipt(fixture.input, cfg, fixture.verifier);
  return { receipt, inbox: await createProviderJournal(database).ingestReceipt(receipt) };
}
function chargeConfig(f: Awaited<ReturnType<typeof graphFixture>>, endpointId = config.endpointId) {
  return { ...config, endpointId, expectedObject: { id: f.ids.charge, type: 'charge', amountCents: f.snapshot.chargeCents, currency: 'cad', paymentIntentId: f.ids.intent } };
}

describe('durable correlation closure and movement identity', () => {
  it('discovers the complete graph, replays unchanged correlation and never clears original review', async () => {
    const f = await graphFixture();
    const before = await financialCounts();
    const original = await f.journal.getInbox(f.sessionInbox.id);
    const first = await f.correlation.correlateOperation(f.identity.id);
    const repeated = await f.correlation.correlateOperation(f.identity.id);
    const current = await f.correlation.getCorrelation(f.identity.id);

    expect(first.result).toMatchObject({ state: 'correlated', financialPostingAllowed: false });
    expect(first.candidateId).toEqual(expect.any(String));
    expect(repeated).toMatchObject({ id: first.id, version: first.version, replayed: true, candidateId: first.candidateId });
    expect(current).toMatchObject({ recordedSnapshotMatches: true, candidateId: first.candidateId, result: { state: 'correlated', financialPostingAllowed: false } });
    expect(await f.journal.getInbox(f.sessionInbox.id)).toEqual(original);
    expect(original!.receipt.classification).toBe('review');
    expect((await inspectProviderFixtureInbox(f.journal, f.sessionInbox.id, { workerId: 'fixture_inspector', leaseMs: 60000 })).every(row => row.state === 'review')).toBe(true);
    expect(await financialCounts()).toEqual(before);
  });

  it('deduplicates charge movement across transport events/endpoints and harmless Session redelivery', async () => {
    const f = await graphFixture();
    const first = await f.correlation.correlateOperation(f.identity.id);
    const later = new Date();
    const duplicate = signed(f.sessionPayload, later);
    const pair = await verifyOfflineCheckoutSessionReceipt(duplicate.input, config, duplicate.verifier);
    const inbox = await f.journal.ingestReceipt(pair.receipt);
    const projection = await f.correlation.persistSessionProjection(inbox.id, pair.receipt, pair.session);

    expect(inbox.id).toBe(f.sessionInbox.id);
    expect(projection.inboxId).toBe(inbox.id);

    const deliveredAgain = { ...f.chargePayload, id: `evt_${randomUUID().replaceAll('-', '')}`, created: Math.floor(later.getTime() / 1000) };
    await ingest(deliveredAgain, chargeConfig(f, 'endpoint_correlation_second'), later);
    const next = await f.correlation.correlateOperation(f.identity.id);

    expect(next.result).toMatchObject({ state: 'correlated', captureCandidate: { fingerprint: first.result.captureCandidate!.fingerprint } });
    expect(next.candidateId).toBe(first.candidateId);
    expect((await client.query('SELECT id FROM customer_payment_charge_claim WHERE candidate_id=$1', [first.candidateId])).rows).toHaveLength(1);
    expect((await client.query('SELECT id FROM customer_payment_session_projection WHERE inbox_id=$1', [inbox.id])).rows).toHaveLength(1);
  });

  it('discovers late contradictory charge evidence despite an explicitly incomplete caller list', async () => {
    const f = await graphFixture();
    const first = await f.correlation.correlateOperation(f.identity.id);
    const before = await financialCounts();
    const object = (f.chargePayload.data as { object: Record<string, unknown> }).object;
    const payload = { ...f.chargePayload, id: `evt_${randomUUID().replaceAll('-', '')}`, data: { object: { ...object, amount: f.snapshot.chargeCents + 1, amount_captured: f.snapshot.chargeCents + 1 } } };
    const cfg = chargeConfig(f, 'endpoint_conflicting');
    cfg.expectedObject.amountCents += 1;
    await ingest(payload, cfg);
    const effective = await f.correlation.getCorrelation(f.identity.id);

    expect(effective).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect(effective!.sourceRevision).not.toBe(first.sourceRevision);
    expect((await f.correlation.correlateOperation(f.identity.id, [f.sessionInbox.id])).result.state).toBe('review');
    expect(await financialCounts()).toEqual(before);
  });

  it('discovers a target relationship appearing only inside a conflicting duplicate receipt', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const id = `evt_${randomUUID().replaceAll('-', '')}`;
    const unrelated = event('payment_intent.succeeded', { id: 'pi_unrelated', object: 'payment_intent', livemode: false, status: 'succeeded', amount_received: f.snapshot.chargeCents, currency: 'cad', latest_charge: 'ch_unrelated' }, { id, created: Math.floor(Date.now() / 1000) });
    await ingest(unrelated, { ...config, expectedObject: { id: 'pi_unrelated', type: 'payment_intent', amountCents: f.snapshot.chargeCents, currency: 'cad', chargeId: 'ch_unrelated' } });
    const changed = { ...f.intentPayload, id };

    await expect(ingest(changed, { ...config, expectedObject: { id: f.ids.intent, type: 'payment_intent', amountCents: f.snapshot.chargeCents, currency: 'cad', chargeId: f.ids.charge } })).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_INBOX_CONFLICT_RETAINED');

    expect(await f.correlation.getCorrelation(f.identity.id)).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect((await f.correlation.correlateOperation(f.identity.id)).result.state).toBe('review');
  });

  it('invalidates a prior correlation on newly discovered customer refund money', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const before = await financialCounts();
    const refund = event('refund.created', { id: `re_${randomUUID().replaceAll('-', '')}`, object: 'refund', status: 'succeeded', amount: 100, currency: 'cad', charge: f.ids.charge, payment_intent: f.ids.intent }, { created: Math.floor(Date.now() / 1000) });
    const refundId = (refund.data as { object: { id: string } }).object.id;
    await ingest(refund, { ...config, expectedObject: { id: refundId, type: 'refund', amountCents: 100, currency: 'cad', chargeId: f.ids.charge } });

    expect(await f.correlation.getCorrelation(f.identity.id)).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', financialPostingAllowed: false } });
    expect(await financialCounts()).toEqual(before);
  });

  it('never lets two successful operations own the same scoped charge', async () => {
    const f = await graphFixture(true);
    const before = await financialCounts();
    const first = await f.correlation.correlateOperation(f.identity.id);
    const second = await f.correlation.correlateOperation(f.twin!.identity.id);

    expect(first.result.state).toBe('correlated');
    expect(second.candidateId).toBe(first.candidateId);
    expect(second.result).toMatchObject({ state: 'review', reasons: expect.arrayContaining(['CHARGE_OWNERSHIP_CONFLICT']) });
    expect(await f.correlation.getCorrelation(f.identity.id)).toMatchObject({ recordedSnapshotMatches: false, result: { state: 'review', reasons: expect.arrayContaining(['CHARGE_OWNERSHIP_CONFLICT']) } });
    expect((await client.query('SELECT id FROM customer_payment_charge_candidate WHERE id=$1', [first.candidateId])).rows).toHaveLength(1);
    expect((await client.query('SELECT id FROM customer_payment_charge_claim WHERE candidate_id=$1', [first.candidateId])).rows).toHaveLength(2);
    expect(await financialCounts()).toEqual(before);
  });

  it.each([
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
  ])('gates durable correlation before DB access when %s=%s', async (name, value) => {
    const fake = { select: vi.fn(), transaction: vi.fn() };
    const correlation = createProviderCorrelation(fake as never);
    vi.stubEnv(name, value);

    await expect(correlation.correlateOperation(randomUUID())).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    await expect(correlation.getCorrelation(randomUUID())).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    await expect(correlation.persistSessionProjection(randomUUID(), {} as never, {} as never)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.transaction).not.toHaveBeenCalled();
  });
});

describe('as-of snapshot disclosure', () => {
  it('labels the view with its transaction snapshot start and separates later evaluation time', async () => {
    const f = await graphFixture();
    await f.correlation.correlateOperation(f.identity.id);
    const starts: Date[] = [];
    type Transaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
    const observedDatabase = {
      select: database.select.bind(database),
      transaction: <T>(body: (tx: Transaction) => Promise<T>, options?: Parameters<typeof database.transaction>[1]) => database.transaction(async (tx) => {
        const [clock] = await tx.select({ started: sql<string>`transaction_timestamp()` }).from(sql`(SELECT 1) AS test_snapshot_clock`);
        starts.push(new Date(clock!.started));
        return body(tx);
      }, options),
    };
    const current = await createProviderCorrelation(observedDatabase).getCorrelation(f.identity.id);

    expect(starts).toHaveLength(1);
    expect(current).toMatchObject({ asOf: starts[0], snapshotStartedAt: starts[0], result: { state: 'correlated', financialPostingAllowed: false } });
    expect(current!.evaluatedAt.getTime()).toBeGreaterThanOrEqual(starts[0]!.getTime());
  });
});

describe('durable evidence write acknowledgement', () => {
  it.each([
    ['customer_payment_charge_candidate', 'CUSTOMER_PAYMENT_CHARGE_CANDIDATE_WRITE_FAILED'],
    ['customer_payment_correlation_link', 'CUSTOMER_PAYMENT_CORRELATION_LINK_WRITE_FAILED'],
  ])('rolls back correlation when a trigger suppresses %s insertion', async (table, code) => {
    const f = await graphFixture();
    const before = await financialCounts();
    await client.exec(`CREATE FUNCTION fixture_correlation_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER fixture_correlation_suppress BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_correlation_suppress();`);
    try {
      await expect(f.correlation.correlateOperation(f.identity.id)).rejects.toThrow(code);
    } finally {
      await client.exec(`DROP TRIGGER fixture_correlation_suppress ON ${table}; DROP FUNCTION fixture_correlation_suppress();`);
    }

    expect(await f.correlation.getCorrelation(f.identity.id)).toBeNull();
    expect((await client.query('SELECT id FROM customer_payment_correlation_link WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(0);
    expect((await client.query('SELECT id FROM customer_payment_charge_candidate WHERE first_operation_id=$1', [f.identity.id])).rows).toHaveLength(0);
    expect((await client.query('SELECT id FROM customer_payment_charge_claim WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(0);
    expect(await financialCounts()).toEqual(before);
    expect((await f.correlation.correlateOperation(f.identity.id)).result.state).toBe('correlated');
    expect(await financialCounts()).toEqual(before);
  });
});
