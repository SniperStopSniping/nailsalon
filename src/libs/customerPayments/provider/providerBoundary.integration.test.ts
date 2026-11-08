/** Independent inert-boundary checks. No provider SDK, credential or network use. */
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { calculatePaymentSnapshot } from '../money';
import { isCustomerPaymentProviderFixtureEnabled, requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';
import { createCustomerPaymentPreparationRepository, customerPaymentFingerprint } from '../server/preparationRepository';
import { createProviderJournal } from '../server/providerJournal';
import { settleSyntheticCustomerPaymentCapture } from '../server/settleSyntheticCapture';
import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { dispatchProviderFixture, reconcileProviderFixture } from './dispatchFixture';
import { assertVerifiedProviderReceipt, type ProviderFixtureConfig, verifyOfflineProviderReceipt } from './evidence';
import { inspectProviderFixtureInbox } from './inspectFixture';
import { createOfflineOperationTransport, createOperationIdentity } from './operations';

vi.mock('server-only', () => ({}));

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

afterAll(async () => client?.close());

const root = process.cwd();
const providerRoot = path.join(root, 'src/libs/customerPayments/provider');
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sourceFiles(path.join(directory, entry.name))
    : /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)
      ? [path.join(directory, entry.name)]
      : []);
}
function runtimeReferences(file: string) {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const calls: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyNamedTypes = bindings && ts.isNamedImports(bindings) && !clause?.name
        && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
      if (!clause?.isTypeOnly && !onlyNamedTypes) {
        imports.push(node.moduleSpecifier.text);
      }
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      if (!clause || !ts.isNamedExports(clause) || clause.elements.some(element => !element.isTypeOnly)) {
        imports.push(node.moduleSpecifier.text);
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
      calls.push(name);
      if (expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require') {
        const argument = node.arguments?.[0];
        imports.push(argument && ts.isStringLiteral(argument) ? argument.text : '<dynamic module path>');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { imports, calls };
}
function localModule(from: string, reference: string): string | null {
  const base = reference.startsWith('@/')
    ? path.join(root, 'src', reference.slice(2))
    : reference.startsWith('.') ? path.resolve(path.dirname(from), reference) : null;
  if (!base) {
    return null;
  }
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(candidate => existsSync(candidate) && /\.tsx?$/.test(candidate)) ?? null;
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
});

afterEach(() => vi.unstubAllEnvs());

const receivedAt = new Date('2026-11-08T12:00:00.000Z');
const fixtureConfig: ProviderFixtureConfig = {
  endpointId: 'endpoint_fixture',
  platformId: 'acct_fixtureplatform',
  accountScope: 'connected',
  expectedAccountId: 'acct_fixtureconnected',
  apiVersion: '2024-06-20',
  livemode: false,
  expectedObject: { id: 'pi_fixture', type: 'payment_intent', chargeId: 'ch_fixture', amountCents: 10000, currency: 'cad' },
};
function fixtureEvent(overrides: Record<string, unknown> = {}) {
  return { id: 'evt_fixture', object: 'event', account: fixtureConfig.expectedAccountId, type: 'payment_intent.succeeded', api_version: fixtureConfig.apiVersion, livemode: false, created: Math.floor(receivedAt.getTime() / 1000) - 1, data: { object: { id: 'pi_fixture', object: 'payment_intent', livemode: false, latest_charge: 'ch_fixture', amount_received: 10000, currency: 'cad', status: 'succeeded', metadata: { neverPersist: 'private fixture metadata' } } }, ...overrides };
}
function signedFixture(payload: unknown = fixtureEvent()) {
  const rawBody = new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const signature = createHmac('sha256', 'offline_boundary_fixture_only').update(rawBody).digest('hex');
  const verifier = vi.fn(async (input: { rawBody: Uint8Array; signature: string }) => createHmac('sha256', 'offline_boundary_fixture_only').update(input.rawBody).digest('hex') === input.signature);
  return { input: { rawBody, signature, receivedAt }, verifier };
}

describe('inert provider boundary', () => {
  it('requires an explicit test-only fixture gate, independent of production markers', () => {
    const enabled = { NODE_ENV: 'test', CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED: 'true', CUSTOMER_PAYMENTS_PREPARATION_ENABLED: 'true' };

    expect(isCustomerPaymentProviderFixtureEnabled({})).toBe(false);
    expect(isCustomerPaymentProviderFixtureEnabled(enabled)).toBe(true);

    for (const overrides of [
      { CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED: 'false' },
      { CUSTOMER_PAYMENTS_PREPARATION_ENABLED: 'false' },
      { NODE_ENV: 'development' },
      { NODE_ENV: 'production' },
      { APP_ENV: 'production' },
      { VERCEL_ENV: 'production' },
    ]) {
      expect(isCustomerPaymentProviderFixtureEnabled({ ...enabled, ...overrides }), JSON.stringify(overrides)).toBe(false);
    }
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
    vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');

    expect(() => requireCustomerPaymentProviderFixtureEnabled()).toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
  });

  it('has no runtime path to the global Stripe client, app DB, synthetic money writers or network primitives', () => {
    const pending = [...sourceFiles(providerRoot), path.join(root, 'src/libs/customerPayments/server/providerJournal.ts')];
    const seen = new Set<string>();
    const allowedExternal = new Set(['server-only', 'node:crypto', 'drizzle-orm', 'drizzle-orm/pg-core', 'zod']);

    expect(pending.length).toBeGreaterThan(0);

    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file)) {
        continue;
      }
      seen.add(file);
      const references = runtimeReferences(file);
      for (const reference of references.imports) {
        expect(reference, file).not.toMatch(/(?:\/stripe(?:$|\/)|\/DB$|\/app\/|settleSyntheticCapture|recordSyntheticRefund|recordSyntheticCreditDecision|\/deposits\/)/);

        const resolved = localModule(file, reference);
        if (resolved) {
          pending.push(resolved);
        } else {
          expect(allowedExternal.has(reference), `${file}: unexpected runtime module ${reference}`).toBe(true);
        }
      }

      expect(references.calls, file).not.toEqual(expect.arrayContaining(['fetch']));

      for (const forbidden of ['XMLHttpRequest', 'WebSocket', 'EventSource']) {
        expect(references.calls, file).not.toContain(forbidden);
      }
    }
  });

  it('is not mounted in an application route, page or webhook consumer', () => {
    for (const file of sourceFiles(path.join(root, 'src/app'))) {
      for (const reference of runtimeReferences(file).imports) {
        const resolved = localModule(file, reference);

        expect(resolved ?? '', `${file}: ${reference}`).not.toMatch(/customerPayments\/provider(?:\/|TestGate)/);
      }
    }
  });
});

describe('offline verified evidence does not become financial authority', () => {
  it.each([
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'development'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
    ['VERCEL_ENV', 'production'],
  ])('refuses %s=%s before verifier execution', async (name, value) => {
    const fixture = signedFixture();
    vi.stubEnv(name, value);

    await expect(verifyOfflineProviderReceipt(fixture.input, fixtureConfig, fixture.verifier)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');
    expect(fixture.verifier).not.toHaveBeenCalled();
  });

  it('keeps fixture provenance private, immutable, non-serializable and outside synthetic settlement', async () => {
    const fixture = signedFixture();
    const receipt = await verifyOfflineProviderReceipt(fixture.input, fixtureConfig, fixture.verifier);

    expect(receipt).toMatchObject({ source: 'offline_signed_fixture', classification: 'accepted', mode: 'test', eventId: 'evt_fixture' });
    expect(() => assertVerifiedProviderReceipt(receipt)).not.toThrow();
    expect(() => assertVerifiedProviderReceipt(JSON.parse(JSON.stringify(receipt)))).toThrow('CUSTOMER_PAYMENT_PROVIDER_RECEIPT_UNVERIFIED');
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.normalizedFacts)).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain('private fixture metadata');

    const database = { select: vi.fn(), transaction: vi.fn() };
    const attempt = { quoteId: 'fixture_quote', eventId: receipt.eventId, paymentIntentId: receipt.objectId, stripeAccountId: receipt.accountId, source: receipt.source, livemode: false, currency: 'cad', amountCents: 10000, applicationFeeCents: 100, capturedAt: receivedAt };

    await expect(settleSyntheticCustomerPaymentCapture(database as unknown as Parameters<typeof settleSyntheticCustomerPaymentCapture>[0], attempt as unknown as Parameters<typeof settleSyntheticCustomerPaymentCapture>[1])).rejects.toThrow();
    expect(database.select).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures and holds signed unknown or malformed money without widening authority', async () => {
    const invalid = signedFixture();

    await expect(verifyOfflineProviderReceipt({ ...invalid.input, signature: 'invalid' }, fixtureConfig, invalid.verifier)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_SIGNATURE_INVALID');

    for (const payload of [fixtureEvent({ type: 'charge.unknown_money' }), '{malformed', fixtureEvent({ livemode: true }), fixtureEvent({ account: 'acct_other' })]) {
      const fixture = signedFixture(payload);
      const receipt = await verifyOfflineProviderReceipt(fixture.input, fixtureConfig, fixture.verifier);

      expect(receipt.classification).toBe('review');
      expect(receipt.reviewReasons.length).toBeGreaterThan(0);
      expect(receipt.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(() => assertVerifiedProviderReceipt(receipt)).not.toThrow();
    }
  });
});

describe('real-journal receipt invariants', () => {
  it('rejects structurally incomplete raw receipts instead of treating null classification as pending', async () => {
    const input = { id: randomUUID(), endpointId: 'endpoint_fixture', platformId: 'acct_fixtureplatform', accountScope: 'connected', accountKey: 'acct_fixtureconnected', mode: 'test', receiptIdentity: 'evt_incomplete', fingerprint: 'a'.repeat(64), receipt: {} };

    await expect(database.insert(schema.customerPaymentProviderInboxSchema).values(input)).rejects.toThrow();
  });
});

async function recordFixtureEvent(overrides: Record<string, unknown> = {}, config = fixtureConfig) {
  const fixture = signedFixture(fixtureEvent({ id: `evt_${randomUUID().replaceAll('-', '')}`, ...overrides }));
  const receipt = await verifyOfflineProviderReceipt(fixture.input, config, fixture.verifier);
  const journal = createProviderJournal(database);
  const inbox = await journal.ingestReceipt(receipt);
  return { journal, inbox, receipt };
}
async function financialCounts() {
  const tables = ['appointment_payment', 'appointment_deposit', 'customer_payment_capture', 'customer_payment_refund', 'customer_payment_fee_refund', 'customer_payment_credit_decision'];
  return Promise.all(tables.map(async table => [table, (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]!.count]));
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
  await journal.prepareOperation(identity);
  return { identity, journal, appointmentId };
}

describe('durable fixture receipt and operation boundaries', () => {
  it('keeps consumers and versions independent after one consumer completes or reviews', async () => {
    const before = await financialCounts();
    const { journal, inbox } = await recordFixtureEvent();
    const fee = await journal.ensureDelivery(inbox.id, 'fee', 1);
    const customer = await journal.ensureDelivery(inbox.id, 'customer_payment', 1);
    const nextVersion = await journal.ensureDelivery(inbox.id, 'customer_payment', 2);
    const feeClaim = await journal.claimDelivery(fee.id, { workerId: 'fixture_fee_worker', leaseMs: 60000 });
    await journal.finishDelivery(fee.id, { expectedVersion: feeClaim.version, leaseToken: feeClaim.leaseToken!, outcome: 'completed', detail: 'Not a fee event' });

    expect((await journal.getDelivery(customer.id))!.state).toBe('pending');
    expect((await journal.getDelivery(nextVersion.id))!.state).toBe('pending');

    const customerClaim = await journal.claimDelivery(customer.id, { workerId: 'fixture_customer_worker', leaseMs: 60000 });
    await journal.finishDelivery(customer.id, { expectedVersion: customerClaim.version, leaseToken: customerClaim.leaseToken!, outcome: 'review', detail: 'Financial adapter absent; money is not settled' });

    expect((await journal.getDelivery(fee.id))!.state).toBe('completed');
    expect((await journal.getDelivery(nextVersion.id))!.state).toBe('pending');
    expect((await journal.ensureDelivery(inbox.id, 'customer_payment', 1)).id).toBe(customer.id);
    expect(await financialCounts()).toEqual(before);
  });

  it('retains unknown money and conflicting signed facts while blocking every affected consumer', async () => {
    const before = await financialCounts();
    const unknown = await recordFixtureEvent({ type: 'charge.unknown_money' });
    const held = await unknown.journal.ensureDelivery(unknown.inbox.id, 'customer_payment', 1);

    expect(held.state).toBe('review');
    expect((await unknown.journal.getInbox(unknown.inbox.id))!.receipt.classification).toBe('review');
    await expect(unknown.journal.claimDelivery(held.id, { workerId: 'fixture_worker', leaseMs: 60000 })).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_INBOX_REVIEW');

    const accepted = await recordFixtureEvent();
    const one = await accepted.journal.ensureDelivery(accepted.inbox.id, 'customer_payment', 1);
    const two = await accepted.journal.ensureDelivery(accepted.inbox.id, 'deposit', 1);
    const claim = await accepted.journal.claimDelivery(two.id, { workerId: 'fixture_deposit_worker', leaseMs: 60000 });
    await accepted.journal.finishDelivery(two.id, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, outcome: 'completed', detail: 'Not a deposit operation' });
    const conflicting = signedFixture(fixtureEvent({ id: accepted.receipt.eventId, data: { object: { id: 'pi_fixture', object: 'payment_intent', livemode: false, latest_charge: 'ch_other', amount_received: 10000, currency: 'cad', status: 'succeeded' } } }));
    const receipt = await verifyOfflineProviderReceipt(conflicting.input, fixtureConfig, conflicting.verifier);

    await expect(accepted.journal.ingestReceipt(receipt)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_INBOX_CONFLICT_RETAINED');

    expect((await accepted.journal.getInbox(accepted.inbox.id))!.hasConflict).toBe(true);
    expect((await accepted.journal.getDelivery(one.id))!.state).toBe('review');
    expect((await accepted.journal.getDelivery(two.id))!.state).toBe('review');
    await expect(accepted.journal.claimDelivery(one.id, { workerId: 'fixture_worker', leaseMs: 60000 })).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_INBOX_REVIEW');
    expect(await financialCounts()).toEqual(before);
  });

  it('persists uncertainty, refuses redispatch, then reconciles the same immutable operation without cash writes', async () => {
    const f = await operationFixture();
    const before = await financialCounts();
    const transport = createOfflineOperationTransport([{ identity: f.identity, dispatch: { type: 'uncertain' }, reconciliation: { type: 'exists', objectId: 'cs_fixtureconfirmed' } }]);
    const first = await dispatchProviderFixture(f.journal, transport, f.identity.id, { workerId: 'fixture_worker', leaseMs: 60000 });

    expect(first).toMatchObject({ outcome: 'recorded', operation: { state: 'uncertain' } });

    const uncertain = await f.journal.getOperation(f.identity.id);
    const retry = await dispatchProviderFixture(f.journal, transport, f.identity.id, { workerId: 'fixture_worker', leaseMs: 60000 });

    expect(retry).toMatchObject({ outcome: 'reconciliation_required', operation: { version: uncertain!.version } });
    expect(await f.journal.prepareOperation(f.identity)).toEqual(uncertain);

    const reconciled = await reconcileProviderFixture(f.journal, transport, f.identity.id, { workerId: 'fixture_worker', leaseMs: 60000 });

    expect(reconciled).toMatchObject({ outcome: 'recorded', operation: { state: 'succeeded', identity: f.identity, result: { provenance: 'offline_fixture', objectId: 'cs_fixtureconfirmed' } } });
    expect(await dispatchProviderFixture(f.journal, transport, f.identity.id, { workerId: 'fixture_worker', leaseMs: 60000 })).toMatchObject({ outcome: 'unchanged', operation: { state: 'succeeded' } });
    expect(await financialCounts()).toEqual(before);
    expect((await client.query('SELECT amount_paid_cents,tip_cents FROM appointment WHERE id=$1', [f.appointmentId])).rows[0]).toMatchObject({ amount_paid_cents: null, tip_cents: 0 });
  });
});

describe('fixed inert consumer inspection', () => {
  it('keeps matching capture money under review, completes only irrelevant inspections and makes repeat inspection inert', async () => {
    const before = await financialCounts();
    const f = await recordFixtureEvent();
    const inspected = await inspectProviderFixtureInbox(f.journal, f.inbox.id, { workerId: 'fixture_inspector', leaseMs: 60000 });

    expect(inspected.map(row => [row.consumer, row.state])).toEqual([
      ['customer_capture_fixture', 'review'],
      ['customer_refund_fixture', 'completed'],
      ['application_fee_fixture', 'completed'],
    ]);

    const counts = async () => (await client.query('SELECT (SELECT count(*) FROM customer_payment_provider_delivery) AS deliveries, (SELECT count(*) FROM customer_payment_provider_audit) AS audits')).rows[0];
    const afterFirst = await counts();
    const replay = await f.journal.ingestReceipt(f.receipt);
    const repeated = await inspectProviderFixtureInbox(f.journal, replay.id, { workerId: 'fixture_inspector', leaseMs: 60000 });

    expect(repeated).toEqual(inspected);
    expect(await counts()).toEqual(afterFirst);

    const conflict = signedFixture(fixtureEvent({ id: f.receipt.eventId, data: { object: { id: 'pi_fixture', object: 'payment_intent', livemode: false, latest_charge: 'ch_other', amount_received: 10000, currency: 'cad', status: 'succeeded' } } }));
    const conflictingReceipt = await verifyOfflineProviderReceipt(conflict.input, fixtureConfig, conflict.verifier);

    await expect(f.journal.ingestReceipt(conflictingReceipt)).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_INBOX_CONFLICT_RETAINED');

    const held = await inspectProviderFixtureInbox(f.journal, f.inbox.id, { workerId: 'fixture_inspector', leaseMs: 60000 });

    expect(held.map(row => row.state)).toEqual(['review', 'review', 'review']);
    expect(held.map(row => row.id)).toEqual(inspected.map(row => row.id));
    expect(await financialCounts()).toEqual(before);
  });

  it('retains authenticated unsupported money under review for every fixed consumer', async () => {
    const before = await financialCounts();
    const f = await recordFixtureEvent({ type: 'charge.unknown_money' });
    const inspected = await inspectProviderFixtureInbox(f.journal, f.inbox.id, { workerId: 'fixture_inspector', leaseMs: 60000 });

    expect(inspected).toHaveLength(3);
    expect(inspected.every(row => row.state === 'review' && row.version === 0)).toBe(true);
    expect(await financialCounts()).toEqual(before);
  });

  it.each([
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['NODE_ENV', 'production'],
  ])('refuses inspection before DB work when %s=%s', async (name, value) => {
    const journal = { getInbox: vi.fn(), ensureDelivery: vi.fn(), claimDelivery: vi.fn(), finishDelivery: vi.fn() };
    vi.stubEnv(name, value);

    await expect(inspectProviderFixtureInbox(journal as unknown as Parameters<typeof inspectProviderFixtureInbox>[0], 'fixture_inbox', { workerId: 'fixture_worker', leaseMs: 60000 })).rejects.toThrow('CUSTOMER_PAYMENT_PROVIDER_FIXTURE_DISABLED');

    for (const method of Object.values(journal)) {
      expect(method).not.toHaveBeenCalled();
    }
  });
});

describe('operation result identity fencing', () => {
  it('rejects another operation or serialized result before durable state changes', async () => {
    const first = await operationFixture();
    const second = await operationFixture();
    const transport = createOfflineOperationTransport([
      { identity: first.identity, dispatch: { type: 'accepted', objectId: 'cs_firstfixture' }, reconciliation: { type: 'unresolved' } },
      { identity: second.identity, dispatch: { type: 'accepted', objectId: 'cs_secondfixture' }, reconciliation: { type: 'unresolved' } },
    ]);
    const begin = async (f: Awaited<ReturnType<typeof operationFixture>>) => {
      const claim = await f.journal.claimOperation(f.identity.id, { workerId: 'fixture_worker', purpose: 'dispatch', leaseMs: 60000 });
      return f.journal.advanceOperation(f.identity.id, { expectedVersion: claim.version, leaseToken: claim.leaseToken!, command: { type: 'begin_dispatch' } });
    };
    const firstDispatch = await begin(first);
    const secondDispatch = await begin(second);
    const observation = await transport.execute(firstDispatch, await first.journal.databaseNow());
    const before = await financialCounts();
    const auditBefore = (await client.query('SELECT count(*)::int AS count FROM customer_payment_provider_audit')).rows[0];

    await expect(second.journal.advanceOperation(second.identity.id, { expectedVersion: secondDispatch.version, leaseToken: secondDispatch.leaseToken!, command: { type: 'observe_dispatch', observation } })).rejects.toThrow('CUSTOMER_PAYMENT_OPERATION_UNTRUSTED_OBSERVATION');
    await expect(first.journal.advanceOperation(first.identity.id, { expectedVersion: firstDispatch.version, leaseToken: firstDispatch.leaseToken!, command: { type: 'observe_dispatch', observation: JSON.parse(JSON.stringify(observation)) } })).rejects.toThrow('CUSTOMER_PAYMENT_OPERATION_UNTRUSTED_OBSERVATION');

    expect(await second.journal.getOperation(second.identity.id)).toEqual(secondDispatch);
    expect(await first.journal.getOperation(first.identity.id)).toEqual(firstDispatch);
    expect((await client.query('SELECT count(*)::int AS count FROM customer_payment_provider_audit')).rows[0]).toEqual(auditBefore);

    const result = await first.journal.advanceOperation(first.identity.id, { expectedVersion: firstDispatch.version, leaseToken: firstDispatch.leaseToken!, command: { type: 'observe_dispatch', observation } });

    expect(result).toMatchObject({ state: 'succeeded', identity: first.identity, result: { provenance: 'offline_fixture', objectId: 'cs_firstfixture' } });
    expect(await financialCounts()).toEqual(before);
  });
});
