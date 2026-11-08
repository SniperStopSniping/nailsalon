import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getFinancialBalanceSummary, getFinancialReportingRangeSummary } from '@/libs/financialReportingServer';
import { buildBookingTaxSnapshot, buildFinalTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { assertCustomerPaymentServiceProgressionAllowed } from './lifecycleGuard';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
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

describe('immutable cash reporting and global captured-money safeguards', () => {
  it('uses immutable capture time, counts gross once and includes prepaid tip in canonical upcoming balance', async () => {
    const f = await captureFixture();
    await new Promise(resolve => setTimeout(resolve, 20));
    const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const summary = await getFinancialReportingRangeSummary(range(f));

    expect(capture.state).toBe('posted');
    expect(capture.recordedAt.getTime()).toBeGreaterThan(f.evidence.capturedAt.getTime());
    expect(summary).toMatchObject({ cashCollectedCents: 12000, appointmentPaymentsCollectedCents: 12000, customerPaymentCollectedCents: 12000, customerPaymentHeldForReviewCents: 0, remainingBalancePaymentsCollectedCents: 0 });
    expect(await getFinancialBalanceSummary({ salonId: f.salonId, currency: 'CAD', asOf: new Date() }))
      .toMatchObject({ upcomingBalanceCents: 0, unresolvedUpcomingAppointmentCount: 0 });

    await database.update(schema.appointmentSchema).set({ notes: 'Safe note correction' }).where(eq(schema.appointmentSchema.id, f.appointmentId));

    expect(await getFinancialReportingRangeSummary(range(f))).toEqual(summary);
  });

  it('counts held captured cash while refusing to infer usable booking credit', async () => {
    const f = await captureFixture();
    const capture = await settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, amountCents: 11900 });

    expect(capture.state).toBe('held_review');
    expect(await getFinancialReportingRangeSummary(range(f))).toMatchObject({ cashCollectedCents: 11900, customerPaymentHeldForReviewCents: 11900, remainingBalancePaymentsCollectedCents: 0 });
    expect(await getFinancialBalanceSummary({ salonId: f.salonId, currency: 'CAD', asOf: new Date() }))
      .toMatchObject({ upcomingBalanceCents: 0, unresolvedUpcomingAppointmentCount: 1 });
    await expect(database.update(schema.appointmentSchema).set({ status: 'cancelled' }).where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();
  });

  it('reports actual foreign capture currency without counting it as CAD', async () => {
    const f = await captureFixture();
    await settleSyntheticCustomerPaymentCapture(database, { ...f.evidence, currency: 'usd' });

    expect(await getFinancialReportingRangeSummary(range(f))).toMatchObject({ cashCollectedCents: 0, excludedForeignCurrencyPaymentEventCount: 1 });
    expect(await getFinancialReportingRangeSummary({ ...range(f), currency: 'USD' })).toMatchObject({
      cashCollectedCents: 12000,
      customerPaymentHeldForReviewCents: 12000,
    });
  });

  it('fails closed after flag rollback instead of presenting synthetic captured money as manual tender', async () => {
    const f = await captureFixture();
    await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');

    await expect(getFinancialReportingRangeSummary(range(f))).rejects.toThrow('REPORTING_RECONCILIATION_REQUIRED');
    expect(await getFinancialBalanceSummary({ salonId: f.salonId, currency: 'CAD', asOf: new Date() }))
      .toMatchObject({ unresolvedUpcomingAppointmentCount: 1 });
  });

  it('allows verified captured service progression with real provenance and SQL guards, but not after flag rollback', async () => {
    const f = await captureFixture();
    await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const progress = (canvasState: 'working' | 'wrap_up') => database.transaction(async (tx) => {
      const [appointment] = await tx.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, f.appointmentId)).for('update');
      await assertCustomerPaymentServiceProgressionAllowed(tx, appointment!);
      await tx.update(schema.appointmentSchema).set({ status: 'in_progress', canvasState })
        .where(eq(schema.appointmentSchema.id, f.appointmentId));
    });
    await progress('working');

    expect(await f.load()).toMatchObject({ status: 'in_progress', canvasState: 'working', amountPaidCents: 12000, tipCents: 2000 });

    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');

    await expect(progress('wrap_up')).rejects.toMatchObject({ code: 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED' });
    expect(await f.load()).toMatchObject({ canvasState: 'working', amountPaidCents: 12000 });

    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
    await progress('wrap_up');

    expect(await f.load()).toMatchObject({ status: 'in_progress', canvasState: 'wrap_up', amountPaidCents: 12000, tipCents: 2000 });
  });

  it('blocks indirect changes to captured lifecycle, prices, tips, cache, tax and item snapshots', async () => {
    const f = await captureFixture();
    const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const mutations = [
      ['total_price', 10001],
      ['tip_cents', 0],
      ['amount_paid_cents', 0],
      ['status', 'cancelled'],
      ['canvas_state', 'cancelled'],
      ['canvas_state', 'no_show'],
      ['canvas_state', null],
      ['cancel_reason', 'client_request'],
      ['status', null],
      ['payment_status', 'comp'],
      ['payment_status', null],
      ['invoice_currency', 'USD'],
      ['tax_rate_bps', 1],
      ['tax_name_snapshot', 'Changed'],
      ['start_time', new Date(Date.now() + 999999).toISOString()],
      ['deleted_at', new Date().toISOString()],
      ['final_tax_snapshot', '{}'],
    ] as const;
    for (const [column, value] of mutations) {
      await expect(client.query(`UPDATE appointment SET ${column}=$1 WHERE id=$2`, [value, f.appointmentId])).rejects.toThrow();
    }

    await expect(client.query('UPDATE appointment_payment SET method=NULL WHERE id=$1', [capture.tenderId])).rejects.toThrow('RECONCILIATION_REQUIRED');
    await expect(client.query('DELETE FROM appointment_payment WHERE id=$1', [capture.tenderId])).rejects.toThrow();
    await expect(client.query('UPDATE appointment_services SET price_at_booking=1 WHERE id=$1', [f.serviceSnapshotId])).rejects.toThrow('RECONCILIATION_REQUIRED');
    await expect(client.query('DELETE FROM appointment WHERE id=$1', [f.appointmentId])).rejects.toThrow();
    await expect(database.insert(schema.appointmentDepositSchema).values({ id: `deposit_${index}`, salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 100, currency: 'cad', status: 'checkout_created', stripeAccountId: f.evidence.stripeAccountId })).rejects.toThrow();
    expect(await f.load()).toMatchObject({ status: 'confirmed', totalPrice: 10000, tipCents: 2000, amountPaidCents: 12000 });
  });

  it('allows frozen finalization, then rejects final-tip/tax rewrites and poisoned final evidence', async () => {
    const f = await captureFixture();
    await settleSyntheticCustomerPaymentCapture(database, f.evidence);
    const now = new Date();
    const totals = { finalPriceCents: 10000, taxableSubtotalCents: 0, taxAmountCents: 0, taxApplied: false };
    const final = { status: 'completed', completedAt: now, finalPriceCents: 10000, finalSubtotalCents: 10000, finalDiscountCents: 0, taxEnabledSnapshot: false, taxNameSnapshot: null, taxRateBps: 0, taxInclusive: false, taxAmountCents: 0, taxableSubtotalCents: 0, taxExempt: false, taxExemptReason: null, paymentStatus: 'paid', finalTaxSnapshot: buildFinalTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals, capturedAt: now, currency: 'CAD', taxExempt: false, taxExemptReason: null }) };

    await expect(database.update(schema.appointmentSchema).set({ ...final, finalTaxSnapshot: {} as never })
      .where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();

    await database.update(schema.appointmentSchema).set(final).where(eq(schema.appointmentSchema.id, f.appointmentId));

    expect(await f.load()).toMatchObject({ status: 'completed', tipCents: 2000, amountPaidCents: 12000 });
    await expect(database.update(schema.appointmentSchema).set({ tipCents: 3000 }).where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();
    await expect(database.update(schema.appointmentSchema).set({ taxNameSnapshot: 'Changed' }).where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();
    await expect(database.update(schema.appointmentSchema).set({ status: 'confirmed' }).where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();
    expect(await getFinancialReportingRangeSummary(range(f))).toMatchObject({ cashCollectedCents: 12000 });
  });
});
