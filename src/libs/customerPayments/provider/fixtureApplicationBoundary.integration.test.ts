/** Independent canonical offline fixture boundaries using a private full migration journal. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { listPayments } from '@/libs/appointmentCheckoutServer';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { purgeSalonData, SalonPurgeBlockedError } from '@/libs/salonPurge';
import { customerPaymentCaptureSchema } from '@/models/customerPaymentSchema';
import * as schema from '@/models/Schema';

import { customerPaymentTenderSummary, verifyCustomerPaymentTender } from '../provenance';
import { createProviderFixtureCaptureApplication } from '../server/applyProviderFixtureCapture';
import { readCustomerPaymentCaptureReport } from '../server/captureReportingReader';
import { readOfflineFixtureCaptureEvidence } from '../server/fixtureApplicationReader';
import { createFixtureCaptureGraph, signFixtureCapturePayload } from '../server/fixtureApplicationTestSupport';
import { assertCustomerPaymentLifecycleMutable, assertCustomerPaymentServiceProgressionAllowed } from '../server/lifecycleGuard';
import { recordSyntheticCustomerRefund } from '../server/recordSyntheticRefund';
import { settleSyntheticCustomerPaymentCapture } from '../server/settleSyntheticCapture';
import { verifyOfflineProviderReceipt } from './evidence';
import { inspectProviderFixtureInbox } from './inspectFixture';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
type Graph = Awaited<ReturnType<typeof createFixtureCaptureGraph>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  holder.db = database;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  for (const flag of ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED']) {
    vi.stubEnv(flag, 'true');
  }
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => client?.close());

async function appliedFixture() {
  const f = await createFixtureCaptureGraph(database);
  const apply = () => createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });
  const applied = await apply();

  expect(applied.state).toBe('applied');

  return { ...f, apply, applied };
}
async function loadAppointment(f: Pick<Graph, 'appointmentId'>) {
  return (await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId)))[0]!;
}
async function durableRows(f: Pick<Graph, 'appointmentId'>) {
  const tables = ['customer_payment_fixture_application', 'customer_payment_capture', 'appointment_payment'];
  return Promise.all(tables.map(async table => ({ table, rows: (await client.query(`SELECT * FROM ${table} WHERE appointment_id=$1 ORDER BY id`, [f.appointmentId])).rows })));
}
async function holdsFor(f: Pick<Graph, 'appointmentId'>) {
  return (await client.query(`SELECT h.* FROM customer_payment_fixture_hold h JOIN customer_payment_fixture_application a ON a.id=h.application_id WHERE a.appointment_id=$1 ORDER BY h.id`, [f.appointmentId])).rows;
}
async function platformRevision(f: Pick<Graph, 'config'>) {
  return (await client.query<{ revision: number }>('SELECT revision FROM customer_payment_fixture_platform WHERE platform_id=$1', [f.config.platformId])).rows[0]!.revision;
}
async function ingestPayload(f: Pick<Graph, 'config' | 'journal'>, payload: Record<string, unknown>, endpointId = f.config.endpointId) {
  const signed = signFixtureCapturePayload(payload);
  const receipt = await verifyOfflineProviderReceipt(signed.input, { ...f.config, endpointId }, signed.verifier);
  return { receipt, inbox: await f.journal.ingestReceipt(receipt) };
}
async function addRefundEvidence(f: Pick<Graph, 'event' | 'config' | 'journal' | 'ids'>) {
  return ingestPayload(f, { ...f.event('refund.created', { id: `re_${randomUUID().replaceAll('-', '')}`, object: 'refund', status: 'succeeded', amount: 100, currency: 'cad', charge: f.ids.charge, payment_intent: f.ids.intent }), created: Math.floor(Date.now() / 1000) });
}
async function report(f: Pick<Graph, 'appointmentId' | 'salonId' | 'observedAt'>) {
  const markers = await database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, f.appointmentId));
  return readCustomerPaymentCaptureReport(database, { salonId: f.salonId, currency: 'CAD', start: new Date(f.observedAt.getTime() - 10000), end: new Date(Date.now() + 10000), markers });
}
async function suppressed(table: string, event: 'INSERT' | 'UPDATE', work: () => Promise<void>) {
  await client.exec(`CREATE FUNCTION fixture_application_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER fixture_application_suppress BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_application_suppress();`);
  try {
    await work();
  } finally {
    await client.exec(`DROP TRIGGER fixture_application_suppress ON ${table}; DROP FUNCTION fixture_application_suppress();`);
  }
}

describe('strict application boundary and source separation', () => {
  it.each([
    ['CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false'],
    ['NODE_ENV', 'development'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
  ])('refuses application before any DB access when %s=%s', async (name, value) => {
    const accessed = vi.fn(() => {
      throw new Error('Unexpected DB access');
    });
    const db = new Proxy({} as never, { get: accessed });
    vi.stubEnv(name, value);

    await expect(createProviderFixtureCaptureApplication(db).applyCapture({ operationId: randomUUID() })).rejects.toThrow('CUSTOMER_PAYMENT_FIXTURE_APPLICATION_DISABLED');
    expect(accessed).not.toHaveBeenCalled();
  });

  it('accepts only an operation identity and refuses caller money/status before DB access', async () => {
    const accessed = vi.fn(() => {
      throw new Error('Unexpected DB access');
    });
    const input = { operationId: randomUUID(), amountCents: 1, source: 'synthetic_test', state: 'succeeded' };

    await expect(createProviderFixtureCaptureApplication(new Proxy({} as never, { get: accessed })).applyCapture(input)).rejects.toThrow();
    expect(accessed).not.toHaveBeenCalled();
  });

  it('posts distinct bound fixture provenance and refuses the synthetic refund seam', async () => {
    const f = await appliedFixture();
    const [capture] = await database.select().from(customerPaymentCaptureSchema).where(eq(customerPaymentCaptureSchema.id, f.applied.captureId!));
    const rows = await listPayments(database, f.appointmentId);

    expect(capture).toMatchObject({ source: 'offline_fixture_test', state: 'posted', amountCents: 12000, tipCents: 2000 });
    expect(customerPaymentTenderSummary(rows[0]!)).toMatchObject({ grossCents: 12000, grossTipCents: 2000, netCents: 12000, refundedCents: 0, collectionHold: false });
    expect(() => verifyCustomerPaymentTender(rows[0]!, { ...capture!, mode: 'test', synthetic: true, state: 'posted' }, [])).toThrow('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
    await expect(recordSyntheticCustomerRefund(database, { captureId: capture!.id, stripeAccountId: capture!.stripeAccountId, paymentIntentId: capture!.paymentIntentId, currency: 'cad', mode: 'test', source: 'synthetic_test', eventId: 'evt_fixtureRefund', refundId: 're_fixtureRefund', status: 'succeeded', amountCents: 100, principalCents: 100, tipCents: 0, occurredAt: new Date() })).rejects.toThrow('CUSTOMER_PAYMENT_REFUND_IDENTITY_MISMATCH');
    expect(await f.apply()).toMatchObject({ state: 'replayed', applicationId: f.applied.applicationId, captureId: f.applied.captureId, tenderId: f.applied.tenderId });
  });

  it('refuses new application if current refund evidence exists, with no canonical effects', async () => {
    const f = await createFixtureCaptureGraph(database);
    await addRefundEvidence(f);
    const before = await loadAppointment(f);

    expect(await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).toMatchObject({ state: 'held', applicationId: null, captureId: null, tenderId: null });
    expect((await durableRows(f)).every(row => row.rows.length === 0)).toBe(true);
    expect(await loadAppointment(f)).toEqual(before);
  });
});

describe('source admission and material invalidation', () => {
  it('keeps exact duplicate receipt/projection and harmless inspection from creating a hold', async () => {
    const f = await appliedFixture();
    const before = await durableRows(f);
    const material = await platformRevision(f);
    const [admission] = (await client.query<{ revision: number }>('SELECT revision FROM customer_payment_fixture_admission WHERE id=1')).rows;
    await f.journal.ingestReceipt(f.receipts[1]!.receipt);
    await f.correlation.persistSessionProjection(f.sessionInbox.id, f.pair.receipt, f.pair.session);
    await inspectProviderFixtureInbox(f.journal, f.receipts[1]!.inbox.id, { workerId: 'fixture_inspector', leaseMs: 60000 });

    expect(await holdsFor(f)).toEqual([]);
    expect(await platformRevision(f)).toBe(material);
    expect(Number((await client.query<{ revision: number }>('SELECT revision FROM customer_payment_fixture_admission WHERE id=1')).rows[0]!.revision)).toBeGreaterThan(Number(admission!.revision));
    expect(await durableRows(f)).toEqual(before);
    expect((await f.apply()).state).toBe('replayed');
  });

  it('does not hold a harmless correlation audit and repeated support-link retention after application', async () => {
    const f = await appliedFixture();
    const revision = await platformRevision(f);

    const beforeLinks = (await client.query('SELECT id FROM customer_payment_correlation_link WHERE operation_id=$1 ORDER BY id', [f.identity.id])).rows;

    const inspected = await f.correlation.correlateOperation(f.identity.id);

    expect(inspected.result.state).toBe('correlated');
    expect((await client.query('SELECT id FROM customer_payment_correlation_link WHERE operation_id=$1 ORDER BY id', [f.identity.id])).rows).toEqual(beforeLinks);
    expect(await platformRevision(f)).toBe(revision);
    expect(await holdsFor(f)).toEqual([]);
    expect((await f.apply()).state).toBe('replayed');
  });

  it('conservatively holds a new endpoint provenance identity without posting a second charge', async () => {
    const f = await appliedFixture();
    const before = await durableRows(f);
    const signed = signFixtureCapturePayload(f.chargePayload);
    const receipt = await verifyOfflineProviderReceipt(signed.input, { ...f.receipts[1]!.cfg, endpointId: 'endpoint_new_provenance' }, signed.verifier);
    await f.journal.ingestReceipt(receipt);

    expect((await holdsFor(f)).length).toBeGreaterThan(0);
    expect(await durableRows(f)).toEqual(before);
    expect(await f.apply()).toMatchObject({ state: 'held', captureId: f.applied.captureId, tenderId: f.applied.tenderId });
  });

  it('preserves gross cash after new refund facts while blocking ordinary ledger, service progression and purge', async () => {
    const f = await appliedFixture();
    const before = await durableRows(f);
    await addRefundEvidence(f);
    const appointment = await loadAppointment(f);
    const rows = await listPayments(database, f.appointmentId);

    expect(customerPaymentTenderSummary(rows[0]!)).toMatchObject({ grossCents: 12000, netCents: 12000, refundedCents: 0, collectionHold: true });
    expect(resolveAppointmentPaymentLedger({ cachedAmountPaidCents: appointment.amountPaidCents, paymentRows: rows, expectedSalonId: f.salonId, appointmentStatus: appointment.status, paymentStatus: appointment.paymentStatus }).ok).toBe(false);
    await expect(database.transaction(async (tx) => {
      await tx.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId)).for('update');
      await assertCustomerPaymentServiceProgressionAllowed(tx, appointment);
    })).rejects.toThrow();
    await expect(database.transaction(tx => assertCustomerPaymentLifecycleMutable(tx, f.salonId, f.appointmentId))).rejects.toThrow();
    await expect(database.transaction(tx => purgeSalonData(tx, f.salonId))).rejects.toBeInstanceOf(SalonPurgeBlockedError);
    expect(await report(f)).toMatchObject({ collectedCents: 12000, heldForReviewCents: 12000, captureCount: 1 });
    expect(await durableRows(f)).toEqual(before);
  });

  it('keeps durable gross cash and holds readable with both fixture write flags off', async () => {
    const f = await appliedFixture();
    await addRefundEvidence(f);
    vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false');
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');

    expect(customerPaymentTenderSummary((await listPayments(database, f.appointmentId))[0]!)).toMatchObject({ grossCents: 12000, collectionHold: true });
    expect(await report(f)).toMatchObject({ collectedCents: 12000, heldForReviewCents: 12000 });
    await expect(f.apply()).rejects.toThrow('CUSTOMER_PAYMENT_FIXTURE_APPLICATION_DISABLED');
  });

  it.each([['NODE_ENV', 'development'], ['NODE_ENV', 'production'], ['CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false'], ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false']])('leaves fixture evidence unproven when source read boundary %s=%s', async (name, value) => {
    const f = await appliedFixture();
    const captures = await database.select().from(customerPaymentCaptureSchema).where(eq(customerPaymentCaptureSchema.id, f.applied.captureId!));
    vi.stubEnv(name, value);

    await expect(readOfflineFixtureCaptureEvidence(database, captures)).rejects.toThrow();

    const rows = await listPayments(database, f.appointmentId);

    expect(() => customerPaymentTenderSummary(rows[0]!)).toThrow();
    await expect(report(f)).rejects.toThrow();
  });
});

describe('atomic application and rollback', () => {
  it.each([
    ['appointment_payment', 'INSERT', 'CUSTOMER_PAYMENT_FIXTURE_TENDER_WRITE_FAILED'],
    ['customer_payment_capture', 'INSERT', 'CUSTOMER_PAYMENT_FIXTURE_CAPTURE_WRITE_FAILED'],
    ['customer_payment_fixture_application', 'INSERT', 'CUSTOMER_PAYMENT_FIXTURE_APPLICATION_WRITE_FAILED'],
    ['appointment', 'UPDATE', 'CUSTOMER_PAYMENT_FIXTURE_CACHE_WRITE_FAILED'],
  ] as const)('rolls back canonical and ownership effects when %s %s is suppressed', async (table, event, code) => {
    const f = await createFixtureCaptureGraph(database);
    const before = await loadAppointment(f);
    const material = await platformRevision(f);
    await suppressed(table, event, async () => {
      await expect(createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).rejects.toThrow(code);
    });

    expect((await durableRows(f)).every(row => row.rows.length === 0)).toBe(true);
    expect((await client.query('SELECT id FROM customer_payment_charge_claim WHERE operation_id=$1', [f.identity.id])).rows).toHaveLength(0);
    expect(await loadAppointment(f)).toEqual(before);
    expect(await platformRevision(f)).toBe(material);
    expect((await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).state).toBe('applied');
  });

  it('retries the whole local transaction after serialization failure without duplicating canonical money', async () => {
    const f = await createFixtureCaptureGraph(database);
    await client.exec(`CREATE SEQUENCE fixture_application_retry_count;
      CREATE FUNCTION fixture_application_retry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF nextval('fixture_application_retry_count')=1 THEN RAISE EXCEPTION 'Fixture serialization retry' USING ERRCODE='40001'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_application_retry BEFORE INSERT ON customer_payment_fixture_application FOR EACH ROW EXECUTE FUNCTION fixture_application_retry();`);
    try {
      const result = await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });

      expect(result.state).toBe('applied');
      expect((await durableRows(f)).every(row => row.rows.length === 1)).toBe(true);
      expect((await client.query<{ last_value: number }>('SELECT last_value FROM fixture_application_retry_count')).rows[0]!.last_value).toBe(2);
    } finally {
      await client.exec('DROP TRIGGER fixture_application_retry ON customer_payment_fixture_application; DROP FUNCTION fixture_application_retry(); DROP SEQUENCE fixture_application_retry_count;');
    }
  });

  it('rolls back source evidence and material revision if hold creation raises an error', async () => {
    const f = await appliedFixture();
    const material = await platformRevision(f);
    const before = (await client.query('SELECT id FROM customer_payment_provider_inbox WHERE platform_id=$1 ORDER BY id', [f.config.platformId])).rows;
    await client.exec(`CREATE FUNCTION fixture_hold_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture hold insertion failed'; END $$;
      CREATE TRIGGER fixture_hold_fail BEFORE INSERT ON customer_payment_fixture_hold FOR EACH ROW EXECUTE FUNCTION fixture_hold_fail();`);
    try {
      await expect(addRefundEvidence(f)).rejects.toThrow();
    } finally {
      await client.exec('DROP TRIGGER fixture_hold_fail ON customer_payment_fixture_hold; DROP FUNCTION fixture_hold_fail();');
    }

    expect((await client.query('SELECT id FROM customer_payment_provider_inbox WHERE platform_id=$1 ORDER BY id', [f.config.platformId])).rows).toEqual(before);
    expect(await holdsFor(f)).toEqual([]);
    expect(await platformRevision(f)).toBe(material);
    expect((await f.apply()).state).toBe('replayed');
  });

  it('refuses stale appointment price and revoked capability without persisting a held capture', async () => {
    const f = await createFixtureCaptureGraph(database);
    await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    await database.update(schema.appointmentSchema).set({ totalPrice: 9900 }).where(eq(schema.appointmentSchema.id, f.appointmentId));

    expect(await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).toMatchObject({ state: 'held', captureId: null, tenderId: null, applicationId: null });
    expect((await durableRows(f)).every(row => row.rows.length === 0)).toBe(true);
  });
});

describe('legacy synthetic source remains separate', () => {
  it('keeps the existing synthetic capture/refund path operational and prevents a later fixture double-credit', async () => {
    const f = await createFixtureCaptureGraph(database);
    const capture = await settleSyntheticCustomerPaymentCapture(database, { quoteId: f.quote.id, eventId: `evt_synthetic${randomUUID().replaceAll('-', '')}`, paymentIntentId: `pi_synthetic${randomUUID().replaceAll('-', '')}`, stripeAccountId: f.quote.stripeAccountId, source: 'synthetic_test', livemode: false, currency: 'cad', amountCents: f.snapshot.chargeCents, applicationFeeCents: f.snapshot.applicationFeeCents, capturedAt: new Date() });
    const refund = await recordSyntheticCustomerRefund(database, { captureId: capture.id, stripeAccountId: capture.stripeAccountId, paymentIntentId: capture.paymentIntentId, currency: 'cad', mode: 'test', source: 'synthetic_test', eventId: `evt_syntheticrefund${randomUUID().replaceAll('-', '')}`, refundId: `re_synthetic${randomUUID().replaceAll('-', '')}`, status: 'succeeded', amountCents: 100, principalCents: 100, tipCents: 0, occurredAt: new Date() });

    expect(capture).toMatchObject({ source: 'synthetic_test', state: 'posted' });
    expect(refund.state).toBe('applied');
    expect(await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).toMatchObject({ state: 'held', applicationId: null });
    expect((await client.query('SELECT id FROM customer_payment_fixture_application WHERE appointment_id=$1', [f.appointmentId])).rows).toHaveLength(0);
    expect(customerPaymentTenderSummary((await listPayments(database, f.appointmentId))[0]!)).toMatchObject({ grossCents: 12000, refundedCents: 100, netCents: 11900, collectionHold: true });
  });
});

describe('deferred binding validation and derived pointers', () => {
  it.each([
    ['customer_payment_fixture_application', 'NEW.capture_fingerprint:=repeat(\'0\',64);', 'CUSTOMER_PAYMENT_FIXTURE_PROVENANCE_RECONCILIATION_REQUIRED'],
    ['customer_payment_fixture_application', 'NEW.source_evidence:=jsonb_set(NEW.source_evidence,\'{blocked}\',\'true\'::jsonb);', 'CUSTOMER_PAYMENT_FIXTURE_EVIDENCE_DIGEST_MISMATCH'],
    ['customer_payment_capture', 'NEW.recorded_at:=NEW.recorded_at+interval \'1 millisecond\';', 'CUSTOMER_PAYMENT_FIXTURE_PROVENANCE_RECONCILIATION_REQUIRED'],
  ])('rolls back mismatched %s binding facts before they can commit', async (table, mutation, message) => {
    const f = await createFixtureCaptureGraph(database);
    const appointment = await loadAppointment(f);
    const revision = await platformRevision(f);
    await client.exec(`CREATE FUNCTION fixture_binding_mismatch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${mutation} RETURN NEW; END $$;
      CREATE TRIGGER fixture_binding_mismatch BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fixture_binding_mismatch();`);
    try {
      await expect(createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).rejects.toThrow(message);
    } finally {
      await client.exec(`DROP TRIGGER fixture_binding_mismatch ON ${table}; DROP FUNCTION fixture_binding_mismatch();`);
    }

    expect((await durableRows(f)).every(row => row.rows.length === 0)).toBe(true);
    expect(await loadAppointment(f)).toEqual(appointment);
    expect(await platformRevision(f)).toBe(revision);
  });

  it('rejects an orphan offline capture/tender pair at transaction commit rather than minting unbound money', async () => {
    const f = await createFixtureCaptureGraph(database);
    const before = await durableRows(f);
    const id = randomUUID();
    const successAt = new Date(Math.floor(f.observedAt.getTime() / 1000) * 1000);
    let inserted = false;

    await expect(client.transaction(async (tx) => {
      await tx.query(`INSERT INTO appointment_payment(id,salon_id,appointment_id,amount_cents,method,reference,recorded_by_type,recorded_at)
        VALUES($1,$2,$3,$4,'online',$5,'system',$6)`, [`cpay_${id}`, f.salonId, f.appointmentId, f.snapshot.chargeCents, `customer_payment_capture:${id}`, successAt]);
      await tx.query(`INSERT INTO customer_payment_capture(id,salon_id,appointment_id,quote_id,stripe_account_id,mode,source,payment_intent_id,tender_id,currency,amount_cents,principal_cents,tip_cents,application_fee_cents,quoted_application_fee_cents,state,review_reason,captured_at,recorded_at,fingerprint)
        VALUES($1,$2,$3,$4,$5,'test','offline_fixture_test',$6,$7,'cad',$8,$9,$10,$11,$11,'posted',NULL,$12,$13,$14)`, [id, f.salonId, f.appointmentId, f.quote.id, f.config.expectedAccountId, f.ids.intent, `cpay_${id}`, f.snapshot.chargeCents, f.snapshot.chargeCents - f.snapshot.tipCents, f.snapshot.tipCents, f.snapshot.applicationFeeCents, successAt, new Date(), '0'.repeat(64)]);
      inserted = true;
    })).rejects.toThrow('CUSTOMER_PAYMENT_FIXTURE_BINDING_MISSING');

    expect(inserted).toBe(true);
    expect(await durableRows(f)).toEqual(before);
  });

  it('keeps application, capture and hold evidence immutable after source invalidation', async () => {
    const f = await appliedFixture();
    await addRefundEvidence(f);
    for (const [table, column, value] of [
      ['customer_payment_fixture_application', 'appointment_id', f.appointmentId],
      ['customer_payment_capture', 'appointment_id', f.appointmentId],
      ['customer_payment_fixture_hold', 'application_id', f.applied.applicationId],
    ]) {
      const before = (await client.query(`SELECT * FROM ${table} WHERE ${column}=$1 ORDER BY id`, [value])).rows;

      expect(before.length).toBeGreaterThan(0);
      await expect(client.query(`UPDATE ${table} SET id=id WHERE ${column}=$1`, [value])).rejects.toThrow();
      await expect(client.query(`DELETE FROM ${table} WHERE ${column}=$1`, [value])).rejects.toThrow();
      expect((await client.query(`SELECT * FROM ${table} WHERE ${column}=$1 ORDER BY id`, [value])).rows).toEqual(before);
    }
  });

  it('does not give a newly inserted derived pointer authority over unrelated already retained facts', async () => {
    const f = await createFixtureCaptureGraph(database);
    const otherCharge = `ch_${randomUUID().replaceAll('-', '')}`;
    const otherIntent = `pi_${randomUUID().replaceAll('-', '')}`;
    const payload = f.event('charge.succeeded', { id: otherCharge, object: 'charge', livemode: false, amount: 1000, amount_captured: 1000, amount_refunded: 0, currency: 'cad', payment_intent: otherIntent, paid: true, captured: true });
    const signed = signFixtureCapturePayload(payload);
    const receipt = await verifyOfflineProviderReceipt(signed.input, { ...f.config, expectedObject: { id: otherCharge, type: 'charge', amountCents: 1000, currency: 'cad', paymentIntentId: otherIntent } }, signed.verifier);
    const unrelated = await f.journal.ingestReceipt(receipt);
    const apply = () => createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });

    expect((await apply()).state).toBe('applied');

    const revision = await platformRevision(f);
    await client.query('INSERT INTO customer_payment_correlation_link(id,operation_id,inbox_id) VALUES($1,$2,$3)', [randomUUID(), f.identity.id, unrelated.id]);

    expect((await f.correlation.getCorrelation(f.identity.id))!.result.state).toBe('review');
    expect(await platformRevision(f)).toBe(revision);
    expect(await holdsFor(f)).toEqual([]);
    expect((await apply()).state).toBe('replayed');
  });
});

describe('deferred foreign evidence binding', () => {
  it.each(['correlation_id', 'candidate_id', 'success_inbox_id'] as const)('rejects a valid foreign %s FK at commit and rolls back all canonical rows', async (column) => {
    const foreign = await createFixtureCaptureGraph(database);
    const foreignAudit = await foreign.correlation.correlateOperation(foreign.identity.id);
    const foreignCandidate = (await client.query<{ id: string }>('SELECT id FROM customer_payment_charge_candidate WHERE first_operation_id=$1', [foreign.identity.id])).rows[0]!;
    const replacement = column === 'correlation_id' ? foreignAudit.id : column === 'candidate_id' ? foreignCandidate.id : foreign.receipts[1]!.inbox.id;
    const f = await createFixtureCaptureGraph(database);
    const before = await loadAppointment(f);
    await client.exec(`CREATE FUNCTION fixture_foreign_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.${column}:='${replacement}'; RETURN NEW; END $$;
      CREATE TRIGGER fixture_foreign_binding BEFORE INSERT ON customer_payment_fixture_application FOR EACH ROW EXECUTE FUNCTION fixture_foreign_binding();`);
    try {
      await expect(createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).rejects.toThrow('CUSTOMER_PAYMENT_FIXTURE_BINDING_INVALID');
    } finally {
      await client.exec('DROP TRIGGER fixture_foreign_binding ON customer_payment_fixture_application; DROP FUNCTION fixture_foreign_binding();');
    }

    expect((await durableRows(f)).every(row => row.rows.length === 0)).toBe(true);
    expect(await loadAppointment(f)).toEqual(before);

    const constraints = (await client.query<{ tgdeferrable: boolean; tginitdeferred: boolean }>('SELECT tgdeferrable,tginitdeferred FROM pg_trigger WHERE tgname IN (\'customer_payment_fixture_application_deferred\',\'customer_payment_fixture_capture_deferred\',\'customer_payment_fixture_tender_deferred\')')).rows;

    expect(constraints).toHaveLength(3);
    expect(constraints.every(row => row.tgdeferrable && row.tginitdeferred)).toBe(true);
  });
});
