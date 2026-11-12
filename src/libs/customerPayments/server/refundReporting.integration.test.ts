import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getFinancialBalanceSummary, getFinancialReportingRangeSummary } from '@/libs/financialReportingServer';
import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { bindSyntheticApplicationFee, recordSyntheticApplicationFeeRefund, recordSyntheticCustomerRefund } from './recordSyntheticRefund';
import { settleSyntheticCustomerPaymentCapture } from './settleSyntheticCapture';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.db;
} }));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createCustomerPaymentPreparationRepository>;
let index = 0;
const settings = { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true };

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  holder.db = database;
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

afterEach(() => vi.unstubAllEnvs());

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

function range(f: Awaited<ReturnType<typeof captureFixture>>) {
  return { salonId: f.salonId, currency: 'CAD', start: new Date(f.evidence.capturedAt.getTime() - 1000), end: new Date(f.evidence.capturedAt.getTime() + 1) };
}

async function refundFixture() {
  const f = await captureFixture();
  const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
  await new Promise(resolve => setTimeout(resolve, 5));
  const occurredAt = new Date();
  const identity = { captureId: capture.id, stripeAccountId: capture.stripeAccountId, paymentIntentId: capture.paymentIntentId, currency: 'cad' as const, mode: 'test' as const, source: 'synthetic_test' as const, occurredAt };
  const refund = { ...identity, eventId: randomUUID(), refundId: randomUUID(), status: 'succeeded' as const, amountCents: 3000, principalCents: 2500, tipCents: 500 };
  const fullRange = { salonId: f.salonId, currency: 'CAD', start: new Date(capture.capturedAt.getTime() - 1), end: new Date(occurredAt.getTime() + 1000) };
  const refundRange = { ...fullRange, start: new Date(capture.capturedAt.getTime() + 1) };
  return { ...f, capture, identity, refund, fullRange, refundRange };
}

describe('immutable refund reporting by movement date', () => {
  it('keeps original capture gross, dates the refund separately and counts duplicate receipts once', async () => {
    const f = await refundFixture();
    const payments = await f.payments();
    await recordSyntheticCustomerRefund(database, f.refund);
    await recordSyntheticCustomerRefund(database, f.refund);
    await recordSyntheticCustomerRefund(database, { ...f.refund, eventId: randomUUID() });

    expect(await getFinancialReportingRangeSummary(range(f))).toMatchObject({
      cashCollectedCents: 12000,
      customerPaymentCollectedCents: 12000,
      customerPaymentRefundedCents: 0,
      customerPaymentNetCashCents: 12000,
    });
    expect(await getFinancialReportingRangeSummary(f.refundRange)).toMatchObject({
      cashCollectedCents: 0,
      customerPaymentCollectedCents: 0,
      customerPaymentRefundedCents: 3000,
      customerPaymentNetCashCents: -3000,
      customerPaymentFeeRefundedCents: 0,
    });
    expect(await getFinancialReportingRangeSummary(f.fullRange)).toMatchObject({
      cashCollectedCents: 12000,
      customerPaymentRefundedCents: 3000,
      customerPaymentNetCashCents: 9000,
      customerPaymentRefundHeldForReviewCents: 0,
    });
    expect(await getFinancialBalanceSummary({ salonId: f.salonId, currency: 'CAD', asOf: new Date() }))
      .toMatchObject({ unresolvedUpcomingAppointmentCount: 1 });
    expect(await f.load()).toMatchObject({ amountPaidCents: 9000, tipCents: 2000 });
    expect(await f.payments()).toEqual(payments);
  });

  it('reports only independently observed fee returns, without subtracting them from customer net', async () => {
    const f = await refundFixture();
    await recordSyntheticCustomerRefund(database, f.refund);
    await bindSyntheticApplicationFee(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_fixture', amountCents: 100 });
    const fee = { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_fixture', feeRefundId: randomUUID(), amountCents: 25, status: 'succeeded' as const };
    await recordSyntheticApplicationFeeRefund(database, fee);
    await recordSyntheticApplicationFeeRefund(database, { ...fee, eventId: randomUUID() });
    vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'false');

    expect(await getFinancialReportingRangeSummary(f.fullRange)).toMatchObject({
      customerPaymentRefundedCents: 3000,
      customerPaymentFeeRefundedCents: 25,
      customerPaymentFeeRefundHeldForReviewCents: 0,
      customerPaymentNetCashCents: 9000,
    });
    expect((await f.load()).amountPaidCents).toBe(9000);

    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');

    await expect(getFinancialReportingRangeSummary(f.refundRange)).rejects.toThrow('REPORTING_RECONCILIATION_REQUIRED');
  });

  it('keeps fee-before-binding cash separately under review without reducing customer credit', async () => {
    const f = await refundFixture();
    await recordSyntheticApplicationFeeRefund(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_unbound', feeRefundId: randomUUID(), amountCents: 50, status: 'succeeded' });
    await bindSyntheticApplicationFee(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_unbound', amountCents: 100 });

    expect(await getFinancialReportingRangeSummary(f.fullRange)).toMatchObject({
      customerPaymentRefundedCents: 0,
      customerPaymentFeeRefundedCents: 50,
      customerPaymentFeeRefundHeldForReviewCents: 50,
      customerPaymentNetCashCents: 12000,
    });
    expect((await f.load()).amountPaidCents).toBe(12000);
    expect(await getFinancialBalanceSummary({ salonId: f.salonId, currency: 'CAD', asOf: new Date() }))
      .toMatchObject({ unresolvedUpcomingAppointmentCount: 0 });
  });

  it('discloses successful refund facts under allocation review without turning them into trusted credit', async () => {
    const f = await refundFixture();
    await recordSyntheticCustomerRefund(database, { ...f.refund, amountCents: 13000, principalCents: 13000, tipCents: 0 });

    expect(await getFinancialReportingRangeSummary(f.fullRange)).toMatchObject({
      customerPaymentRefundedCents: 13000,
      customerPaymentRefundHeldForReviewCents: 13000,
      customerPaymentNetCashCents: -1000,
    });
    expect((await f.load()).amountPaidCents).toBe(12000);
    expect(await getFinancialReportingRangeSummary({ ...f.refundRange, currency: 'USD' })).toMatchObject({
      customerPaymentRefundedCents: 0,
      customerPaymentNetCashCents: 0,
      excludedForeignCurrencyPaymentEventCount: 1,
    });
  });

  it('records full principal and tip returns without rewriting invoice tip or earlier cash history', async () => {
    const f = await refundFixture();
    const payments = await f.payments();
    await recordSyntheticCustomerRefund(database, { ...f.refund, amountCents: 2000, principalCents: 0, tipCents: 2000 });
    await recordSyntheticCustomerRefund(database, { ...f.refund, eventId: randomUUID(), refundId: randomUUID(), amountCents: 10000, principalCents: 10000, tipCents: 0 });

    expect(await getFinancialReportingRangeSummary(f.fullRange)).toMatchObject({
      cashCollectedCents: 12000,
      customerPaymentRefundedCents: 12000,
      customerPaymentNetCashCents: 0,
    });
    expect(await getFinancialReportingRangeSummary(range(f))).toMatchObject({
      cashCollectedCents: 12000,
      customerPaymentRefundedCents: 0,
      customerPaymentNetCashCents: 12000,
    });
    expect(await f.load()).toMatchObject({ amountPaidCents: 0, tipCents: 2000 });
    expect(await f.payments()).toEqual(payments);
  });
});
