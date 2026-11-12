import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { bindSyntheticApplicationFee, recordSyntheticApplicationFeeRefund, recordSyntheticCustomerRefund } from './recordSyntheticRefund';
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
  vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'true');
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

async function refundFixture() {
  const f = await captureFixture();
  const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
  const identity = { captureId: capture.id, stripeAccountId: capture.stripeAccountId, paymentIntentId: capture.paymentIntentId, currency: 'cad' as const, mode: 'test' as const, source: 'synthetic_test' as const, occurredAt: new Date() };
  const refund = { ...identity, eventId: randomUUID(), refundId: randomUUID(), status: 'succeeded' as const, amountCents: 3000, principalCents: 2500, tipCents: 500 };
  return { ...f, capture, identity, refund };
}

describe('immutable synthetic refund persistence', () => {
  it.each(['CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'NODE_ENV', 'APP_ENV', 'VERCEL_ENV'])('gates %s before DB access', async (key) => {
    vi.stubEnv(key, key.endsWith('ENABLED') ? 'false' : 'production');
    const fake = { select: vi.fn(), transaction: vi.fn() };

    await expect(recordSyntheticCustomerRefund(fake as never, {} as never)).rejects.toThrow('TEST_DISABLED');
    expect(fake.select).not.toHaveBeenCalled();
  });

  it('projects partial then full refund net, never changes gross tender or tip, and replays once', async () => {
    const f = await refundFixture();
    const payments = await f.payments();
    const first = await recordSyntheticCustomerRefund(database, f.refund);

    expect(first.state).toBe('applied');
    expect((await f.load()).amountPaidCents).toBe(9000);
    expect((await f.load()).tipCents).toBe(2000);
    expect(await recordSyntheticCustomerRefund(database, f.refund)).toMatchObject({ movementId: first.movementId, replayed: true });
    expect(await recordSyntheticCustomerRefund(database, { ...f.refund, eventId: randomUUID() })).toMatchObject({ movementId: first.movementId, replayed: true });

    await recordSyntheticCustomerRefund(database, { ...f.refund, eventId: randomUUID(), refundId: randomUUID(), amountCents: 9000, principalCents: 7500, tipCents: 1500 });

    expect((await f.load()).amountPaidCents).toBe(0);
    expect((await f.load()).tipCents).toBe(2000);
    expect(await f.payments()).toEqual(payments);
    expect((await client.query('SELECT id FROM customer_payment_refund WHERE capture_id=$1', [f.capture.id])).rows).toHaveLength(2);
  });

  it('preserves over-allocation facts for review without reducing trusted cache', async () => {
    const f = await refundFixture();
    const result = await recordSyntheticCustomerRefund(database, { ...f.refund, principalCents: 13000, tipCents: 0, amountCents: 13000 });

    expect(result.state).toBe('held_review');
    expect((await f.load()).amountPaidCents).toBe(12000);
    await expect(client.query('UPDATE appointment SET status=\'in_progress\' WHERE id=$1', [f.appointmentId])).rejects.toThrow('REFUND_RECONCILIATION');
    await expect(client.query('UPDATE appointment SET started_at=now() WHERE id=$1', [f.appointmentId])).rejects.toThrow('REFUND_RECONCILIATION');
    await expect(client.query('UPDATE appointment SET amount_paid_cents=0 WHERE id=$1', [f.appointmentId])).rejects.toThrow('REFUND_RECONCILIATION');

    await client.query('UPDATE appointment SET notes=\'allowed note\' WHERE id=$1', [f.appointmentId]);
  });

  it('rejects foreign identity, non-success and conflicting replay without new money rows', async () => {
    const f = await refundFixture();
    await recordSyntheticCustomerRefund(database, f.refund);

    await expect(recordSyntheticCustomerRefund(database, { ...f.refund, stripeAccountId: 'acct_foreign' })).rejects.toThrow('IDENTITY_MISMATCH');
    await expect(recordSyntheticCustomerRefund(database, { ...f.refund, status: 'pending' } as never)).rejects.toThrow();
    await expect(recordSyntheticCustomerRefund(database, { ...f.refund, amountCents: 3001 })).rejects.toThrow('EVENT_CONFLICT');
    await expect(recordSyntheticCustomerRefund(database, { ...f.refund, eventId: randomUUID(), amountCents: 3001 })).rejects.toThrow('IDENTITY_CONFLICT');
    expect((await f.load()).amountPaidCents).toBe(9000);
  });

  it('requires independent fee identity and successful receipt, never infers a fee return', async () => {
    const f = await refundFixture();
    await recordSyntheticCustomerRefund(database, f.refund);

    expect((await client.query('SELECT id FROM customer_payment_fee_refund WHERE capture_id=$1', [f.capture.id])).rows).toHaveLength(0);

    const bound = await bindSyntheticApplicationFee(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_fixture', amountCents: 100 });
    const evidence = { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_fixture', feeRefundId: randomUUID(), amountCents: 25, status: 'succeeded' as const };
    const refunded = await recordSyntheticApplicationFeeRefund(database, evidence);

    expect(bound.state).toBe('bound');
    expect(refunded.state).toBe('applied');
    expect(await recordSyntheticApplicationFeeRefund(database, evidence)).toMatchObject({ movementId: refunded.movementId, replayed: true });
    expect((await f.load()).amountPaidCents).toBe(9000);
    await expect(client.query('DELETE FROM customer_payment_fee_refund WHERE id=$1', [refunded.movementId])).rejects.toThrow();
  });

  it('retains fee-before-binding evidence as review and does not silently resolve it later', async () => {
    const f = await refundFixture();
    const evidence = { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_late', feeRefundId: randomUUID(), amountCents: 100, status: 'succeeded' as const };
    const result = await recordSyntheticApplicationFeeRefund(database, evidence);

    expect(result.state).toBe('held_review');

    await bindSyntheticApplicationFee(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_late', amountCents: 100 });

    expect(await recordSyntheticApplicationFeeRefund(database, evidence)).toMatchObject({ state: 'held_review', replayed: true });
    expect((await f.load()).amountPaidCents).toBe(12000);
  });

  it('keeps successful fee return above policy target as immutable review cash, not applied credit', async () => {
    const f = await refundFixture();
    await recordSyntheticCustomerRefund(database, f.refund);
    await bindSyntheticApplicationFee(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_overpolicy', amountCents: 100 });
    const result = await recordSyntheticApplicationFeeRefund(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_overpolicy', feeRefundId: randomUUID(), amountCents: 100, status: 'succeeded' });

    expect(result.state).toBe('held_review');
    expect((await client.query('SELECT amount_cents FROM customer_payment_fee_refund WHERE id=$1', [result.movementId])).rows).toEqual([{ amount_cents: 100 }]);
    expect((await f.load()).amountPaidCents).toBe(9000);
  });

  it.each(['allocation', 'early', 'tip_only'] as const)('handles %s boundary without modifying gross tip', async (kind) => {
    const f = await refundFixture();
    const value = kind === 'allocation'
      ? { ...f.refund, amountCents: 3001 }
      : kind === 'early'
        ? { ...f.refund, occurredAt: new Date(f.capture.capturedAt.getTime() - 1) }
        : { ...f.refund, amountCents: 500, principalCents: 0, tipCents: 500 };
    const result = await recordSyntheticCustomerRefund(database, value);

    expect(result.state).toBe(kind === 'tip_only' ? 'applied' : 'held_review');
    expect((await f.load()).amountPaidCents).toBe(kind === 'tip_only' ? 11500 : 12000);
    expect((await f.load()).tipCents).toBe(2000);
    await expect(client.query('UPDATE customer_payment_refund SET amount_cents=1 WHERE id=$1', [result.movementId])).rejects.toThrow();
    await expect(client.query('DELETE FROM customer_payment_refund WHERE id=$1', [result.movementId])).rejects.toThrow();
  });

  it('retains a distinct late capture after refund as review without new credit', async () => {
    const f = await refundFixture();
    await recordSyntheticCustomerRefund(database, f.refund);
    const late = await settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, eventId: randomUUID(), paymentIntentId: `pi_${randomUUID()}` });

    expect(late.state).toBe('held_review');
    expect((await f.load()).amountPaidCents).toBe(9000);
    expect(await f.payments()).toHaveLength(2);
    expect((await f.payments()).find(row => row.id === late.tenderId)?.voidedAt).not.toBeNull();
  });

  it.each([' ', String.fromCharCode(9, 10, 13), String.fromCharCode(160, 8195, 65279)])('rejects blank external identities before any DB access: %j', async (blank) => {
    const f = await refundFixture();
    const fake = { select: vi.fn(), transaction: vi.fn() };
    const binding = { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_valid', amountCents: 100 };
    const fee = { ...binding, feeRefundId: 'fr_valid', status: 'succeeded' as const };

    await expect(recordSyntheticCustomerRefund(fake as never, { ...f.refund, refundId: blank })).rejects.toThrow('Identity must not be blank');
    await expect(recordSyntheticCustomerRefund(fake as never, { ...f.refund, eventId: blank })).rejects.toThrow('Identity must not be blank');
    await expect(bindSyntheticApplicationFee(fake as never, { ...binding, applicationFeeId: blank })).rejects.toThrow('Identity must not be blank');
    await expect(bindSyntheticApplicationFee(fake as never, { ...binding, eventId: blank })).rejects.toThrow('Identity must not be blank');
    await expect(recordSyntheticApplicationFeeRefund(fake as never, { ...fee, applicationFeeId: blank })).rejects.toThrow('Identity must not be blank');
    await expect(recordSyntheticApplicationFeeRefund(fake as never, { ...fee, feeRefundId: blank })).rejects.toThrow('Identity must not be blank');
    await expect(recordSyntheticApplicationFeeRefund(fake as never, { ...fee, eventId: blank })).rejects.toThrow('Identity must not be blank');
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.transaction).not.toHaveBeenCalled();
    expect((await f.load()).amountPaidCents).toBe(12000);
  });

  it('matches JS trim whitespace in SQL and rejects raw blank external IDs without canonicalizing valid IDs', async () => {
    const f = await refundFixture();
    const refund = await recordSyntheticCustomerRefund(database, { ...f.refund, refundId: ' ref_preserved ' });
    const binding = await bindSyntheticApplicationFee(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_raw', amountCents: 100 });
    const fee = await recordSyntheticApplicationFeeRefund(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_raw', feeRefundId: 'fr_raw', status: 'succeeded', amountCents: 25 });
    const codes = [9, 10, 11, 12, 13, 32, 160, 5760, ...Array.from({ length: 11 }, (_, n) => 8192 + n), 8232, 8233, 8239, 8287, 12288, 65279, 8203];
    for (const code of codes) {
      const value = String.fromCharCode(code);
      const result = await client.query<{ valid: boolean }>('SELECT customer_payment_nonblank_identity($1) AS valid', [value]);

      expect(result.rows[0]!.valid).toBe(value.trim().length > 0);
    }
    const event = (await client.query<{ id: string }>('SELECT id FROM customer_payment_refund_event WHERE refund_id=$1', [refund.movementId])).rows[0]!;
    const checks = [
      ['customer_payment_refund', refund.movementId, 'refund_id'],
      ['customer_payment_fee_binding', binding.movementId, 'application_fee_id'],
      ['customer_payment_fee_refund', fee.movementId, 'application_fee_id'],
      ['customer_payment_fee_refund', fee.movementId, 'fee_refund_id'],
      ['customer_payment_refund_event', event.id, 'event_id'],
    ] as const;
    for (const [table, id, field] of checks) {
      const review = table === 'customer_payment_refund' || table === 'customer_payment_fee_refund' ? { state: 'held_review', review_reason: 'raw fixture' } : {};
      const overrides = { id: randomUUID(), [field]: String.fromCharCode(9, 10, 160, 65279), ...review };
      const failure = await client.query(`INSERT INTO ${table} SELECT (jsonb_populate_record(NULL::${table}, to_jsonb(t)||$2::jsonb)).* FROM ${table} t WHERE id=$1`, [id, JSON.stringify(overrides)]).then(() => null, error => error);

      expect(failure?.code).toBe('23514');
    }

    expect((await client.query('SELECT refund_id FROM customer_payment_refund WHERE id=$1', [refund.movementId])).rows).toEqual([{ refund_id: ' ref_preserved ' }]);
    expect((await f.load()).amountPaidCents).toBe(9000);
  });

  it('rolls movement and cache back atomically when event receipt fails', async () => {
    const f = await refundFixture();
    await client.exec('CREATE FUNCTION fixture_refund_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'fixture refund failure\'; END $$; CREATE TRIGGER fixture_refund_failure BEFORE INSERT ON customer_payment_refund_event FOR EACH ROW EXECUTE FUNCTION fixture_refund_failure();');
    try {
      await expect(recordSyntheticCustomerRefund(database, f.refund)).rejects.toThrow();
    } finally {
      await client.exec('DROP TRIGGER fixture_refund_failure ON customer_payment_refund_event; DROP FUNCTION fixture_refund_failure();');
    }

    expect((await f.load()).amountPaidCents).toBe(12000);
    expect((await client.query('SELECT id FROM customer_payment_refund WHERE capture_id=$1', [f.capture.id])).rows).toHaveLength(0);
  });
});
