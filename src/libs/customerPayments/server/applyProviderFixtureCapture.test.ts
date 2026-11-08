import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { customerPaymentCaptureEventSchema, customerPaymentCaptureSchema, customerPaymentPolicySchema, customerPaymentRefundSchema } from '@/models/customerPaymentSchema';
import * as schema from '@/models/Schema';

import { verifyOfflineProviderReceipt } from '../provider/evidence';
import { createProviderFixtureCaptureApplication } from './applyProviderFixtureCapture';
import { createFixtureCaptureGraph, signFixtureCapturePayload } from './fixtureApplicationTestSupport';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
function inert() {
  return { select: vi.fn((): never => {
    throw new Error('Unexpected database access');
  }), transaction: vi.fn(async (): Promise<never> => {
    throw new Error('Unexpected database access');
  }) };
}

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  for (const key of ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED']) {
    vi.stubEnv(key, 'true');
  }
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => vi.unstubAllEnvs());

afterAll(async () => client?.close());

describe('offline canonical application input boundary', () => {
  it.each([
    ['CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'development'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
    ['VERCEL_ENV', 'production'],
  ])('refuses %s=%s before any database access', async (key, value) => {
    vi.stubEnv(key, value);
    const fake = inert();

    await expect(createProviderFixtureCaptureApplication(fake).applyCapture({ operationId: randomUUID() })).rejects.toThrow('FIXTURE_APPLICATION_DISABLED');
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it.each([
    { source: 'synthetic_test' },
    { amountCents: 1 },
    { capturedAt: new Date() },
    { correlation: { state: 'correlated' } },
    { platformId: 'acct_forged' },
    { principalCents: 100 },
  ])('rejects caller authority %j before database work', async (extra) => {
    const fake = inert();

    await expect(createProviderFixtureCaptureApplication(fake).applyCapture({ operationId: randomUUID(), ...extra })).rejects.toThrow();
    expect(fake.transaction).not.toHaveBeenCalled();
  });
});

describe('full-journal offline canonical application', () => {
  it.each([0, 2000])('applies one immutable capture with %i tip, preserving original evidence and lifecycle', async (tipCents) => {
    const f = await createFixtureCaptureGraph(database, { tipCents });
    const [before] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));
    const original = await f.journal.getInbox(f.sessionInbox.id);
    const applied = await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });

    expect(applied).toMatchObject({ state: 'applied', source: 'offline_fixture_test', financialPostingAllowed: false, reasons: [] });
    expect(applied.captureId).toBeTruthy();

    const [capture] = await database.select().from(customerPaymentCaptureSchema).where(eq(customerPaymentCaptureSchema.id, applied.captureId!));
    const [application] = await database.select().from(schema.customerPaymentFixtureApplicationSchema).where(eq(schema.customerPaymentFixtureApplicationSchema.id, applied.applicationId!));
    const tenders = await database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, f.appointmentId));
    const [after] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));

    expect(capture).toMatchObject({ source: 'offline_fixture_test', mode: 'test', state: 'posted', amountCents: 10000 + tipCents, principalCents: 10000, tipCents, applicationFeeCents: 100 });
    expect(application).toMatchObject({ captureId: capture!.id, operationId: f.identity.id, platformId: f.config.platformId, source: 'offline_fixture_test', quoteFingerprint: f.quote.fingerprint, captureFingerprint: capture!.fingerprint });
    expect(application!.successEventAt).toEqual(capture!.capturedAt);
    expect(tenders).toHaveLength(1);
    expect(tenders[0]).toMatchObject({ id: applied.tenderId, amountCents: capture!.amountCents, voidedAt: null, recordedAt: capture!.capturedAt });
    expect(after).toMatchObject({ amountPaidCents: capture!.amountCents, tipCents, status: before!.status, paymentStatus: before!.paymentStatus, bookingTaxSnapshot: before!.bookingTaxSnapshot, finalTaxSnapshot: before!.finalTaxSnapshot });
    expect(await f.journal.getInbox(f.sessionInbox.id)).toEqual(original);
    expect(await database.select().from(customerPaymentCaptureEventSchema).where(eq(customerPaymentCaptureEventSchema.captureId, capture!.id))).toEqual([]);
    expect(await database.select().from(customerPaymentRefundSchema).where(eq(customerPaymentRefundSchema.captureId, capture!.id))).toEqual([]);
  });

  it('uses fresh evidence while preserving an already recorded charge claim', async () => {
    const f = await createFixtureCaptureGraph(database);
    const correlation = await f.correlation.correlateOperation(f.identity.id);
    const applied = await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });

    expect(applied.state).toBe('applied');

    const [application] = await database.select().from(schema.customerPaymentFixtureApplicationSchema).where(eq(schema.customerPaymentFixtureApplicationSchema.id, applied.applicationId!));

    expect(application!.correlationId).toBe(correlation.id);
    expect(application!.sourceEvidence).toHaveProperty('platformEvidence');
    expect(application!.ownershipEvidence).toEqual([{ operationId: f.identity.id, fingerprint: correlation.result.captureCandidate!.fingerprint }]);
  });

  it('replays without changing material revisions or posting again, including after capability revocation', async () => {
    const f = await createFixtureCaptureGraph(database);
    const service = createProviderFixtureCaptureApplication(database);
    const applied = await service.applyCapture({ operationId: f.identity.id });

    expect(applied.state).toBe('applied');

    await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));

    expect(await service.applyCapture({ operationId: f.identity.id })).toMatchObject({ ...applied, state: 'replayed' });
    expect(await database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, f.appointmentId))).toHaveLength(1);
  });

  it('ignores unrelated derived inspection pointers while binding every actual platform receipt', async () => {
    const f = await createFixtureCaptureGraph(database);
    const suffix = randomUUID().replaceAll('-', '');
    const chargeId = `ch_${suffix}`;
    const intentId = `pi_${suffix}`;
    const payload = f.event('charge.succeeded', { id: chargeId, object: 'charge', livemode: false, amount: 500, amount_captured: 500, amount_refunded: 0, currency: 'cad', payment_intent: intentId, application_fee: null, paid: true, captured: true });
    const signed = signFixtureCapturePayload(payload);
    const receipt = await verifyOfflineProviderReceipt(signed.input, { ...f.config, expectedObject: { id: chargeId, type: 'charge', amountCents: 500, currency: 'cad', paymentIntentId: intentId } }, signed.verifier);

    expect(receipt.classification).toBe('accepted');

    const unrelated = await f.journal.ingestReceipt(receipt);
    const service = createProviderFixtureCaptureApplication(database);
    const applied = await service.applyCapture({ operationId: f.identity.id });

    expect(applied.state).toBe('applied');

    const inspection = await f.correlation.correlateOperation(f.identity.id, [unrelated.id]);

    expect(inspection.result.state).toBe('review');
    expect(await service.applyCapture({ operationId: f.identity.id })).toMatchObject({ ...applied, state: 'replayed' });

    const [application] = await database.select().from(schema.customerPaymentFixtureApplicationSchema).where(eq(schema.customerPaymentFixtureApplicationSchema.id, applied.applicationId!));

    expect(application!.sourceEvidence.platformEvidence).toContainEqual({ id: unrelated.id, fingerprint: unrelated.fingerprint });
    expect(await database.select().from(schema.customerPaymentFixtureHoldSchema).where(eq(schema.customerPaymentFixtureHoldSchema.applicationId, applied.applicationId!))).toEqual([]);
  });

  it.each(['capability', 'binding', 'service', 'policy'] as const)('holds changed authoritative %s before any canonical posting', async (kind) => {
    const f = await createFixtureCaptureGraph(database);
    if (kind === 'capability') {
      await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    } else if (kind === 'binding') {
      await database.update(schema.salonStripeAccountSchema).set({ chargesEnabled: false }).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));
    } else if (kind === 'service') {
      await database.update(schema.appointmentServicesSchema).set({ priceAtBooking: 9999 }).where(eq(schema.appointmentServicesSchema.id, f.serviceSnapshotId));
    } else {
      await database.update(customerPaymentPolicySchema).set({ revision: 2 }).where(eq(customerPaymentPolicySchema.salonId, f.salonId));
    }

    expect(await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id })).toMatchObject({ state: 'held', captureId: null });
    expect(await database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, f.appointmentId))).toEqual([]);
    expect(await database.select().from(schema.customerPaymentFixtureApplicationSchema).where(eq(schema.customerPaymentFixtureApplicationSchema.operationId, f.identity.id))).toEqual([]);
  });
});
