import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBookingTaxSnapshot, buildFinalTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { previewSyntheticCreditReview, readCurrentCustomerPaymentCreditResolution, recordSyntheticCreditDecision } from './recordSyntheticCreditDecision';
import { recordSyntheticApplicationFeeRefund, recordSyntheticCustomerRefund } from './recordSyntheticRefund';
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

describe('explicit synthetic credit review snapshots', () => {
  it.each(['CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED', 'CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'NODE_ENV', 'APP_ENV', 'VERCEL_ENV'])('gates %s before DB/auth', async (key) => {
    vi.stubEnv(key, key.endsWith('ENABLED') ? 'false' : 'production');
    const fake = { select: vi.fn(), transaction: vi.fn() };

    await expect(previewSyntheticCreditReview(fake as never, {} as never, {} as never)).rejects.toThrow('TEST_DISABLED');
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.transaction).not.toHaveBeenCalled();
  });

  it('records explicit credit without modifying original invoice, cash or ordinary hold', async () => {
    const f = await creditFixture();
    const before = await f.load();
    const payments = await f.payments();
    vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'false');
    const result = await recordSyntheticCreditDecision(database, f.actor, f.request);
    const preview = await previewSyntheticCreditReview(database, f.actor, f.scope);

    expect(result).toMatchObject({ replayed: false, evidenceMatchesCurrent: true, ordinaryActionsBlocked: true });
    expect(preview.resolution).toMatchObject({ state: 'resolved', collectibleBalanceCents: 0, ordinaryActionsBlocked: true });
    expect(await f.load()).toEqual(before);
    expect(await f.payments()).toEqual(payments);
    await expect(client.query('UPDATE appointment SET status=\'confirmed\' WHERE id=$1', [f.appointmentId])).rejects.toThrow('REFUND_RECONCILIATION');

    vi.stubEnv('CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED', 'false');

    expect((await readCurrentCustomerPaymentCreditResolution(database, f.scope)).resolution?.state).toBe('resolved');
  });

  it('ignores benign edits, duplicate transport and independent fee-return events', async () => {
    const f = await creditFixture();
    await recordSyntheticCreditDecision(database, f.actor, f.request);
    await database.update(schema.appointmentSchema).set({ notes: 'Harmless note', clientName: 'Updated contact' }).where(eq(schema.appointmentSchema.id, f.appointmentId));
    await recordSyntheticCustomerRefund(database, { ...f.refund, eventId: randomUUID() });
    await recordSyntheticApplicationFeeRefund(database, { ...f.identity, eventId: randomUUID(), applicationFeeId: 'fee_review', feeRefundId: randomUUID(), amountCents: 50, status: 'succeeded' });
    const preview = await previewSyntheticCreditReview(database, f.actor, f.scope);

    expect(preview.evidenceRevision).toBe(f.preview.evidenceRevision);
    expect(preview.resolution?.state).toBe('resolved');
    expect(await recordSyntheticCreditDecision(database, f.actor, f.request)).toMatchObject({ replayed: true, evidenceMatchesCurrent: true });
  });

  it('stales on new customer cash and creates chained delta instead of double-counting cumulative credit', async () => {
    const f = await creditFixture();
    const first = await recordSyntheticCreditDecision(database, f.actor, f.request);
    await recordSyntheticCustomerRefund(database, { ...f.refund, eventId: randomUUID(), refundId: randomUUID(), amountCents: 1000, principalCents: 1000, tipCents: 0 });
    const preview = await previewSyntheticCreditReview(database, f.actor, f.scope);

    expect(preview.resolution).toBeNull();
    expect(await recordSyntheticCreditDecision(database, f.actor, f.request)).toMatchObject({ replayed: true, evidenceMatchesCurrent: false });
    await expect(recordSyntheticCreditDecision(database, f.actor, { ...f.request, requestId: randomUUID() })).rejects.toThrow('STALE_EVIDENCE');

    const second = await recordSyntheticCreditDecision(database, f.actor, { ...f.request, requestId: randomUUID(), expectedEvidenceRevision: preview.evidenceRevision, serviceCreditCents: 3500 });

    expect(second.decision).toMatchObject({ previousDecisionId: first.decision.id, serviceCreditCents: 3500, deltaServiceCreditCents: 1000, deltaTipCreditCents: 0 });
    expect((await previewSyntheticCreditReview(database, f.actor, f.scope)).resolution).toMatchObject({ collectibleBalanceCents: 0 });
    expect((await f.load()).amountPaidCents).toBe(8000);
  });

  it('requires genuine context and current owner membership for new writes, preserves exact replay acknowledgement', async () => {
    const f = await creditFixture();

    await expect(recordSyntheticCreditDecision(database, { ...f.actor, impersonating: true } as never, f.request)).rejects.toThrow();
    await expect(recordSyntheticCreditDecision(database, { ...f.actor, adminId: randomUUID() }, f.request)).rejects.toThrow('OWNER_REQUIRED');

    await recordSyntheticCreditDecision(database, f.actor, f.request);
    await database.delete(schema.adminSalonMembershipSchema).where(eq(schema.adminSalonMembershipSchema.adminId, f.actor.adminId));

    expect(await recordSyntheticCreditDecision(database, f.actor, f.request)).toMatchObject({ replayed: true });
    await expect(recordSyntheticCreditDecision(database, f.actor, { ...f.request, requestId: randomUUID() })).rejects.toThrow('OWNER_REQUIRED');
    await expect(previewSyntheticCreditReview(database, f.actor, f.scope)).rejects.toThrow('OWNER_REQUIRED');
  });

  it('refuses conflicting request, raw forged evidence/allocations and immutable edits', async () => {
    const f = await creditFixture();
    const result = await recordSyntheticCreditDecision(database, f.actor, f.request);

    await expect(recordSyntheticCreditDecision(database, f.actor, { ...f.request, reason: 'Different reason' })).rejects.toThrow('REQUEST_CONFLICT');
    await expect(recordSyntheticCreditDecision(database, f.actor, { ...f.request, requestId: randomUUID() })).rejects.toThrow('ALREADY_RECORDED');
    await expect(client.query('UPDATE customer_payment_credit_decision SET reason=$1 WHERE id=$2', ['rewrite', result.decision.id])).rejects.toThrow();
    await expect(client.query('DELETE FROM customer_payment_credit_decision WHERE id=$1', [result.decision.id])).rejects.toThrow();

    for (const override of [{ evidence_revision: 'bad' }, { service_credit_cents: 2501 }, { actor_id: randomUUID() }, { salon_id: 'foreign' }]) {
      const values = { id: randomUUID(), request_id: randomUUID(), ...override };

      await expect(client.query('INSERT INTO customer_payment_credit_decision SELECT (jsonb_populate_record(NULL::customer_payment_credit_decision,to_jsonb(d)||$2::jsonb)).* FROM customer_payment_credit_decision d WHERE id=$1', [result.decision.id, JSON.stringify(values)])).rejects.toThrow();
    }

    expect((await client.query('SELECT id FROM customer_payment_credit_decision WHERE appointment_id=$1', [f.appointmentId])).rows).toHaveLength(1);
  });
});
