import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCompletedFinancialResolution, getCompletedOutstandingRows, getFinancialBalanceSummary, getFinancialReportingRangeSummary } from '@/libs/financialReportingServer';
import { buildBookingTaxSnapshot, buildFinalTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { readCustomerPaymentCreditForReporting } from './creditResolutionReader';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { previewSyntheticCreditReview, recordSyntheticCreditDecision } from './recordSyntheticCreditDecision';
import { recordSyntheticApplicationFeeRefund, recordSyntheticCustomerRefund } from './recordSyntheticRefund';
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
  vi.stubEnv('CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED', 'true');
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

async function creditFixture() {
  const f = await refundFixture();
  const now = new Date();
  const totals = { finalPriceCents: 10000, taxableSubtotalCents: 0, taxAmountCents: 0, taxApplied: false };
  await database.update(schema.appointmentSchema).set({ status: 'completed', completedAt: now, finalPriceCents: 10000, finalSubtotalCents: 10000, finalDiscountCents: 0, taxEnabledSnapshot: false, taxNameSnapshot: null, taxRateBps: 0, taxInclusive: false, taxAmountCents: 0, taxableSubtotalCents: 0, taxExempt: false, taxExemptReason: null, paymentStatus: 'paid', finalTaxSnapshot: buildFinalTaxSnapshot({ taxConfig: DISABLED_TAX_CONFIG, totals, capturedAt: now, currency: 'CAD', taxExempt: false, taxExemptReason: null }) }).where(eq(schema.appointmentSchema.id, f.appointmentId));
  await recordSyntheticCustomerRefund(database, f.refund);
  const actor = { adminId: randomUUID(), authenticated: true as const, impersonating: false as const };
  await database.insert(schema.adminUserSchema).values({ id: actor.adminId });
  await database.insert(schema.adminSalonMembershipSchema).values({ adminId: actor.adminId, salonId: f.salonId, role: 'owner' });
  const scope = { salonId: f.salonId, appointmentId: f.appointmentId };
  const preview = await previewSyntheticCreditReview(database, actor, scope);
  const request = { ...scope, requestId: randomUUID(), expectedEvidenceRevision: preview.evidenceRevision, reason: 'Synthetic customer refund reconciliation', serviceCreditCents: 2500, taxCreditCents: 0, tipCreditCents: 500 };
  return { ...f, actor, scope, preview, request };
}

async function reads(f: Awaited<ReturnType<typeof creditFixture>>) {
  const appointment = await f.load();
  const asOf = new Date(appointment.startTime.getTime() + 1);
  const scope = { salonId: f.salonId, currency: 'CAD', asOf };
  return {
    balance: await getFinancialBalanceSummary(scope),
    outstanding: await getCompletedOutstandingRows(scope),
    general: await getCompletedFinancialResolution(scope),
    credit: await readCustomerPaymentCreditForReporting(database, { ...f.scope, asOf, paymentRows: await f.payments() }),
  };
}

describe('credit-aware outstanding reads without generic collection authority', () => {
  it('resolves adjusted debt only and preserves gross cash, refund and unadjusted-spend boundaries', async () => {
    const f = await creditFixture();
    const before = await reads(f);
    const range = { salonId: f.salonId, currency: 'CAD', start: new Date(f.capture.capturedAt.getTime() - 1), end: new Date(Date.now() + 60000) };
    const cashBefore = await getFinancialReportingRangeSummary(range);

    expect(before.credit).toBeNull();
    expect(before.balance.completedOutstandingProvenance.unresolvedAppointmentCount).toBe(1);
    expect(before.outstanding).toMatchObject([{ financialState: 'under_review', completedOutstandingCents: 0 }]);

    await recordSyntheticCreditDecision(database, f.actor, f.request);
    const after = await reads(f);

    expect(after.credit).toMatchObject({ state: 'resolved', original: { totalCents: 12000 }, credit: { totalCents: 3000 }, adjusted: { totalCents: 9000 }, actualNetTenderCents: 9000, collectibleBalanceCents: 0, ordinaryActionsBlocked: true });
    expect(after.balance.completedOutstandingCents).toBe(0);
    expect(after.balance.completedOutstandingProvenance).toMatchObject({ unresolvedAppointmentCount: 0, finalizedAppointmentCount: 1 });
    expect(after.outstanding).toMatchObject([{ financialState: 'resolved', completedOutstandingCents: 0 }]);
    // Old spend/receipt callers have not opted into credit-aware amounts.
    expect(after.general.resolvedRows).toHaveLength(0);
    expect(after.general.unresolvedRows).toHaveLength(1);
    expect(await getFinancialReportingRangeSummary(range)).toEqual(cashBefore);
  });

  it('restores review on later cash and accepts only the next explicit delta decision', async () => {
    const f = await creditFixture();
    const first = await recordSyntheticCreditDecision(database, f.actor, f.request);
    await recordSyntheticCustomerRefund(database, { ...f.refund, eventId: randomUUID(), refundId: randomUUID(), amountCents: 1000, principalCents: 1000, tipCents: 0 });
    const stale = await reads(f);

    expect(stale.credit).toBeNull();
    expect(stale.outstanding).toMatchObject([{ financialState: 'under_review', completedOutstandingCents: 0 }]);
    expect(await recordSyntheticCreditDecision(database, f.actor, f.request)).toMatchObject({ replayed: true, evidenceMatchesCurrent: false });

    const next = await previewSyntheticCreditReview(database, f.actor, f.scope);
    const second = await recordSyntheticCreditDecision(database, f.actor, { ...f.request, requestId: randomUUID(), expectedEvidenceRevision: next.evidenceRevision, serviceCreditCents: 3500 });

    expect(second.decision).toMatchObject({ previousDecisionId: first.decision.id, deltaServiceCreditCents: 1000, deltaTipCreditCents: 0 });
    expect((await reads(f)).credit).toMatchObject({ credit: { totalCents: 4000 }, adjusted: { totalCents: 8000 }, actualNetTenderCents: 8000 });

    const deltas = await client.query<{ total: string }>('SELECT sum(delta_service_credit_cents+delta_tax_credit_cents+delta_tip_credit_cents)::text AS total FROM customer_payment_credit_decision WHERE appointment_id=$1', [f.appointmentId]);

    expect(deltas.rows[0]?.total).toBe('4000');
  });

  it('keeps independent fee movements and write-flag rollback separate, but fails closed on base ledger rollback', async () => {
    const f = await creditFixture();
    await recordSyntheticCreditDecision(database, f.actor, f.request);
    await recordSyntheticApplicationFeeRefund(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_unbound', feeRefundId: randomUUID(), amountCents: 50, status: 'succeeded' });
    vi.stubEnv('CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED', 'false');
    vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'false');

    expect((await reads(f)).credit?.state).toBe('resolved');

    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');
    const off = await reads(f);

    expect(off.credit).toBeNull();
    expect(off.outstanding).toMatchObject([{ financialState: 'under_review', completedOutstandingCents: 0 }]);
  });
});
