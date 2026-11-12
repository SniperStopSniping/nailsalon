import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { settleSyntheticCustomerPaymentCapture } from './settleSyntheticCapture';

vi.mock('server-only', () => ({}));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createCustomerPaymentPreparationRepository>;
let index = 0;
const settings = { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true };

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  repository = createCustomerPaymentPreparationRepository(database);
}, 60000);

beforeEach(() => {
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client?.close();
});

async function fixture() {
  index += 1;
  const salonId = `quote_salon_${index}`;
  const appointmentId = `quote_appointment_${index}`;
  const tokenId = `quote_capability_${index}`;
  const bindingId = `quote_binding_${index}`;
  const serviceId = `quote_service_${index}`;
  const serviceSnapshotId = `quote_service_snapshot_${index}`;
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const future = (offset: number) => new Date(now.getTime() + offset);
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Synthetic salon', status: 'active', publicationStatus: 'published' });
  await database.insert(schema.technicianSchema).values({ id: `quote_tech_${index}`, salonId, name: 'Synthetic technician' });
  await database.insert(schema.serviceSchema).values({ id: serviceId, salonId, name: 'Fixed service', price: 10000, durationMinutes: 60, category: 'manicure' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId: `quote_tech_${index}`, clientPhone: '4165550111', clientName: 'PRIVATE_NAME', notes: 'PRIVATE_NOTE', startTime: future(86400000), endTime: future(90000000), totalPrice: 10000, basePriceCents: 10000, addOnsPriceCents: 0, subtotalBeforeDiscountCents: 10000, totalDurationMinutes: 60, status: 'confirmed', invoiceCurrency: 'CAD', bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals: { finalPriceCents: 10000, taxableSubtotalCents: 0, taxAmountCents: 0, taxApplied: false }, currency: 'CAD', capturedAt: now }) });
  await database.insert(schema.appointmentServicesSchema).values({ id: serviceSnapshotId, appointmentId, serviceId, priceAtBooking: 10000, durationAtBooking: 60 });
  await database.insert(schema.salonStripeAccountSchema).values({ id: bindingId, salonId, stripeAccountId: `acct_fixture${index}`, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: now });
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

describe('synthetic capture into actual canonical tender', () => {
  it.each([
    ['CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
    ['VERCEL_ENV', 'production'],
  ])('rejects %s=%s before any DB effect', async (key, value) => {
    vi.stubEnv(key, value);
    const fake = { select: vi.fn(), transaction: vi.fn() };

    await expect(settleSyntheticCustomerPaymentCapture(fake as never, {} as never)).rejects.toThrow('LEDGER_TEST_DISABLED');
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it('posts one tagged gross tender with tip/cache and preserves lifecycle scalars', async () => {
    const f = await captureFixture();
    const before = await f.load();
    const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const after = await f.load();
    const payments = await f.payments();

    expect(capture).toMatchObject({ state: 'posted', amountCents: 12000, principalCents: 10000, tipCents: 2000, applicationFeeCents: 100, quotedApplicationFeeCents: 100, source: 'synthetic_test', mode: 'test', capturedAt: f.evidence.capturedAt });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ id: `cpay_${capture.id}`, reference: `customer_payment_capture:${capture.id}`, amountCents: 12000, method: 'online', recordedByType: 'system', voidedAt: null, recordedAt: f.evidence.capturedAt });
    expect(after).toMatchObject({ status: before.status, paymentStatus: before.paymentStatus, tipCents: 2000, amountPaidCents: 12000 });
    expect(await database.select().from(schema.appointmentDepositSchema).where(eq(schema.appointmentDepositSchema.appointmentId, f.appointmentId))).toEqual([]);
  });

  it('replays event/intent once even after capability revocation without unpaying money', async () => {
    const f = await captureFixture();
    const [first, duplicate] = await Promise.all([settleSyntheticCustomerPaymentCapture(database, f.evidence), settleSyntheticCustomerPaymentCapture(database, f.evidence)]);

    expect(duplicate).toEqual(first);

    await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));

    expect(await settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, eventId: `evt_${randomUUID()}` })).toEqual(first);
    expect(await f.payments()).toHaveLength(1);

    const receipts = await client.query('SELECT id FROM customer_payment_capture_event WHERE capture_id=$1', [first.id]);

    expect(receipts.rows).toHaveLength(2);
  });

  it('rejects conflicting event and intent identity without changing the original capture', async () => {
    const f = await captureFixture();
    await settleSyntheticCustomerPaymentCapture(database, f.evidence);

    await expect(settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, paymentIntentId: `pi_${randomUUID()}` })).rejects.toThrow('EVENT_CONFLICT');
    await expect(settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, eventId: `evt_${randomUUID()}`, amountCents: 1000 })).rejects.toThrow('IDENTITY_CONFLICT');
    expect(await f.payments()).toHaveLength(1);
    expect((await f.load()).amountPaidCents).toBe(12000);
  });

  it('rejects foreign-account/live/real-source facts before attributing them to a salon', async () => {
    const f = await captureFixture();

    await expect(settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, stripeAccountId: 'acct_foreign' })).rejects.toThrow('ACCOUNT_MISMATCH');
    await expect(settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, livemode: true } as never)).rejects.toThrow();
    await expect(settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, source: 'stripe_webhook' } as never)).rejects.toThrow();
    expect(await f.payments()).toEqual([]);
  });

  it.each(['cancelled', 'revoked_token', 'revoked_binding', 'rebound_binding', 'policy_changed', 'service_changed', 'existing_tender'] as const)('preserves %s capture for review without changing appointment money/lifecycle', async (change) => {
    const f = await captureFixture();
    if (change === 'cancelled') {
      await database.update(schema.appointmentSchema).set({ status: 'cancelled' }).where(eq(schema.appointmentSchema.id, f.appointmentId));
    } else if (change === 'revoked_token') {
      await database.update(schema.appointmentAccessTokenSchema).set({ revokedAt: new Date() }).where(eq(schema.appointmentAccessTokenSchema.id, f.tokenId));
    } else if (change === 'revoked_binding') {
      await database.update(schema.salonStripeAccountSchema).set({ revokedAt: new Date(), revocationCause: 'revoked_local' }).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));
    } else if (change === 'rebound_binding') {
      await database.update(schema.salonStripeAccountSchema).set({ stripeAccountId: `acct_rebound${index}` }).where(eq(schema.salonStripeAccountSchema.id, f.bindingId));
    } else if (change === 'policy_changed') {
      await repository.saveCustomerPaymentSettingsDraft({ ...f.policyInput, requestId: randomUUID(), expectedRevision: 1, settings: { ...settings, enabled: false } });
    } else if (change === 'service_changed') {
      await database.update(schema.appointmentServicesSchema).set({ priceAtBooking: 9000 }).where(eq(schema.appointmentServicesSchema.id, f.serviceSnapshotId));
    } else {
      await database.insert(schema.appointmentPaymentSchema).values({ id: randomUUID(), salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 100, recordedByType: 'admin' });
      await database.update(schema.appointmentSchema).set({ amountPaidCents: 100 }).where(eq(schema.appointmentSchema.id, f.appointmentId));
    }
    const before = await f.load();
    const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const payments = await f.payments();

    expect(capture.state).toBe('held_review');
    expect(payments.find(row => row.id === capture.tenderId)?.voidedAt).not.toBeNull();
    expect(await f.load()).toEqual(before);
    expect(resolveAppointmentPaymentLedger({ cachedAmountPaidCents: before.amountPaidCents, paymentRows: payments, expectedSalonId: f.salonId, appointmentStatus: before.status, paymentStatus: before.paymentStatus }).ok).toBe(false);
  });

  it('keeps expired capture historical without reviving the appointment', async () => {
    const f = await captureFixture();
    const before = await f.load();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(f.quote.expiresAt.getTime() + 1000));
    const capture = await settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, capturedAt: new Date() });

    expect(capture).toMatchObject({ state: 'held_review', reviewReason: 'CAPTURE_LATE', amountCents: 12000 });
    expect(await f.load()).toEqual(before);
  });

  it.each([{ amountCents: 9999 }, { currency: 'eur' }, { applicationFeeCents: 99 }])('retains mismatched observed facts %j separately from quoted allocations', async (patch) => {
    const f = await captureFixture();
    const before = await f.load();
    const capture = await settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, ...patch });

    expect(capture).toMatchObject({ ...patch, state: 'held_review', principalCents: 10000, tipCents: 2000, quotedApplicationFeeCents: 100 });
    expect(await f.load()).toEqual(before);
  });

  it('holds a second distinct capture while preserving the first paid cache and tip', async () => {
    const f = await captureFixture();
    await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const before = await f.load();
    const second = await settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, eventId: randomUUID(), paymentIntentId: `pi_${randomUUID()}` });

    expect(second.state).toBe('held_review');
    expect(await f.load()).toEqual(before);
    expect(await f.payments()).toHaveLength(2);
  });

  it('makes capture/event evidence immutable and prevents orphaning the canonical marker', async () => {
    const f = await captureFixture();
    const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);

    await expect(client.query('UPDATE customer_payment_capture SET amount_cents=1 WHERE id=$1', [capture.id])).rejects.toThrow('immutable');
    await expect(client.query('DELETE FROM customer_payment_capture WHERE id=$1', [capture.id])).rejects.toThrow('immutable');
    await expect(client.query('DELETE FROM customer_payment_capture_event WHERE capture_id=$1', [capture.id])).rejects.toThrow('immutable');
    await expect(client.query('DELETE FROM appointment_payment WHERE id=$1', [capture.tenderId])).rejects.toThrow();
    await expect(client.query('DELETE FROM customer_payment_prepared_quote WHERE id=$1', [f.quote.id])).rejects.toThrow();
  });

  it('rolls back capture, marker and cache together if receipt persistence fails', async () => {
    const f = await captureFixture();
    const before = await f.load();
    await client.exec(`CREATE FUNCTION cp_fixture_reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_id='evt_reject_fixture' THEN RAISE EXCEPTION 'fixture receipt failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER cp_fixture_reject_event BEFORE INSERT ON customer_payment_capture_event FOR EACH ROW EXECUTE FUNCTION cp_fixture_reject_event();`);
    try {
      const failure = await settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, eventId: 'evt_reject_fixture' }).then(() => null, error => error);

      expect(failure?.cause?.message ?? failure?.message).toContain('fixture receipt failure');
      expect(await f.payments()).toEqual([]);
      expect(await f.load()).toEqual(before);

      const captures = await client.query('SELECT id FROM customer_payment_capture WHERE appointment_id=$1', [f.appointmentId]);

      expect(captures.rows).toEqual([]);
    } finally {
      await client.exec('DROP TRIGGER cp_fixture_reject_event ON customer_payment_capture_event; DROP FUNCTION cp_fixture_reject_event();');
    }
  });
});
