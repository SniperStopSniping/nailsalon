/** Independent credit-note, canonical-route and full SQL journal integration. No provider calls. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATCH as cancel } from '@/app/api/appointments/[id]/cancel/route';
import { GET as checkout } from '@/app/api/appointments/[id]/checkout/route';
import { PATCH as complete } from '@/app/api/appointments/[id]/complete/route';
import { POST as createPaymentLink } from '@/app/api/appointments/[id]/payment-link/route';
import { POST as recordPayment } from '@/app/api/appointments/[id]/payments/route';
import { POST as reopen } from '@/app/api/appointments/[id]/reopen/route';
import { POST as transition } from '@/app/api/appointments/[id]/transition/route';
import { GET as publicPayment } from '@/app/api/public/pay/[token]/route';
import { listPayments } from '@/libs/appointmentCheckoutServer';
import { runAppointmentManageMutation } from '@/libs/appointmentManage';
import { resolveAppointmentPaymentLedger } from '@/libs/appointmentPaymentLedger';
import { loadBookingEmailFinancialSummary } from '@/libs/bookingEmailFinancialSummary.server';
import { getCompletedOutstandingRows, getFinancialBalanceSummary } from '@/libs/financialReportingServer';
import { buildBookingTaxSnapshot, resolveTaxConfig } from '@/libs/taxConfig';
import { customerPaymentCaptureSchema, customerPaymentCreditDecisionSchema } from '@/models/customerPaymentSchema';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { readCustomerPaymentCreditForReporting } from './creditResolutionReader';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { previewSyntheticCreditReview, readCurrentCustomerPaymentCreditResolution, recordSyntheticCreditDecision } from './recordSyntheticCreditDecision';
import { bindSyntheticApplicationFee, recordSyntheticApplicationFeeRefund, recordSyntheticCustomerRefund } from './recordSyntheticRefund';
import { settleSyntheticCustomerPaymentCapture } from './settleSyntheticCapture';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ database: null as unknown }));
const notifications = vi.hoisted(() => ({
  cancelled: vi.fn(async () => undefined),
  email: vi.fn(async () => undefined),
}));
vi.mock('@/libs/DB', () => ({
  usesRuntimePostgres: false,
  get db() {
    return holder.database;
  },
}));
vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess: vi.fn(async (appointmentId: string) => {
    const database = holder.database as ReturnType<typeof drizzle<typeof schema>>;
    const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointmentId));
    return { ok: true, actorRole: 'admin', admin: { id: 'refund_fixture_owner', name: 'Synthetic owner' }, appointment };
  }),
}));
vi.mock('@/libs/staffApiGuards', () => ({
  requireStaffAppointmentAccess: vi.fn(async (appointmentId: string) => {
    const database = holder.database as ReturnType<typeof drizzle<typeof schema>>;
    const [appointment] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointmentId));
    return { ok: true, appointment, session: { salonId: appointment!.salonId, technicianId: appointment!.technicianId, technicianName: 'Synthetic technician' } };
  }),
}));
vi.mock('@/libs/bookingNotifications', () => ({ sendBookingNotificationsForAppointmentCancelled: notifications.cancelled }));
vi.mock('@/libs/salonNotificationEmail', () => ({ sendSalonNotificationEmail: notifications.email }));
vi.mock('@/libs/fraudDetection', () => ({ evaluateAndFlagIfNeeded: vi.fn(async () => undefined) }));

let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;
let fixtureNumber = 0;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  holder.database = database;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED', 'true');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => client?.close());

function request(method: string, body: unknown = {}) {
  return new Request('http://localhost/synthetic-refund-fixture', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function fixture(taxEnabled = false) {
  fixtureNumber++;
  const salonId = `credit_review_lifecycle_salon_${fixtureNumber}`;
  const appointmentId = `credit_review_lifecycle_appt_${fixtureNumber}`;
  const serviceId = `credit_review_lifecycle_service_${fixtureNumber}`;
  const technicianId = `credit_review_lifecycle_tech_${fixtureNumber}`;
  const clientId = `credit_review_lifecycle_client_${fixtureNumber}`;
  const ownerId = `credit_review_owner_${fixtureNumber}`;
  const actor = { adminId: ownerId, authenticated: true as const, impersonating: false as const };
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const future = (offset: number) => new Date(now.getTime() + offset);
  const settings = { payments: {
    ...(taxEnabled ? { tax: { enabled: true, name: 'HST', rateBps: 1300 } } : {}),
    etransfer: { enabled: true, recipient: 'synthetic@example.test', qrPageEnabled: true },
  } };
  const taxConfig = resolveTaxConfig(settings, now);
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Synthetic salon', status: 'active', publicationStatus: 'published', settings });
  await database.insert(schema.adminUserSchema).values({ id: ownerId, name: 'Synthetic owner' });
  await database.insert(schema.adminSalonMembershipSchema).values({ adminId: ownerId, salonId, role: 'owner' });
  await database.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Synthetic technician' });
  await database.insert(schema.salonClientSchema).values({ id: clientId, salonId, fullName: 'Synthetic customer', phone: '4165550111' });
  await database.insert(schema.serviceSchema).values({ id: serviceId, salonId, name: 'Fixed service', price: 10000, durationMinutes: 60, category: 'manicure' });
  await database.insert(schema.appointmentSchema).values({
    id: appointmentId,
    salonId,
    salonClientId: clientId,
    technicianId,
    clientPhone: '4165550111',
    clientName: 'Synthetic customer',
    startTime: future(86400000),
    endTime: future(90000000),
    totalPrice: 10000,
    basePriceCents: 10000,
    addOnsPriceCents: 0,
    subtotalBeforeDiscountCents: 10000,
    totalDurationMinutes: 60,
    status: 'confirmed',
    canvasState: 'waiting',
    invoiceCurrency: 'CAD',
    bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig, totals: { finalPriceCents: 10000, taxableSubtotalCents: taxEnabled ? 10000 : 0, taxAmountCents: taxEnabled ? 1300 : 0, taxApplied: taxEnabled }, currency: 'CAD', capturedAt: now }),
  });
  await database.insert(schema.appointmentServicesSchema).values({ id: `snapshot_${appointmentId}`, appointmentId, serviceId, priceAtBooking: 10000, durationAtBooking: 60 });
  await database.insert(schema.appointmentPhotoSchema).values({ id: `photo_${appointmentId}`, appointmentId, salonId, normalizedClientPhone: '4165550111', photoType: 'after', cloudinaryPublicId: `synthetic_${appointmentId}`, imageUrl: 'https://example.test/synthetic.jpg' });
  await database.insert(schema.salonStripeAccountSchema).values({ id: `binding_${salonId}`, salonId, stripeAccountId: `acct_refundfixture${fixtureNumber}`, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: now });
  await database.insert(schema.appointmentAccessTokenSchema).values({ id: `cap_${appointmentId}`, salonId, appointmentId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: future(3600000) });
  await createCustomerPaymentPreparationRepository(database).saveCustomerPaymentSettingsDraft({ salonId, actorId: 'refund_fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } });
  const quote = await prepareCustomerPaymentQuoteForToken(database, token, { requestId: randomUUID(), tipCents: 2000 });
  const capture = await settleSyntheticCustomerPaymentCapture(database, { quoteId: quote.id, eventId: `evt_${randomUUID()}`, paymentIntentId: `pi_${randomUUID()}`, stripeAccountId: quote.stripeAccountId, source: 'synthetic_test', livemode: false, currency: 'cad', amountCents: quote.snapshot.chargeCents, applicationFeeCents: quote.snapshot.applicationFeeCents, capturedAt: new Date() });

  expect(capture.state).toBe('posted');

  const load = async () => (await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointmentId)))[0]!;
  const payments = () => database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, appointmentId));
  const refund = async (state: 'applied' | 'held_review') => {
    const result = await recordSyntheticCustomerRefund(database, {
      captureId: capture.id,
      stripeAccountId: capture.stripeAccountId,
      paymentIntentId: capture.paymentIntentId,
      currency: 'cad',
      mode: 'test',
      source: 'synthetic_test',
      eventId: `evt_${randomUUID()}`,
      refundId: `re_${randomUUID()}`,
      status: 'succeeded',
      amountCents: state === 'applied' ? 3000 : 3001,
      principalCents: 2500,
      tipCents: 500,
      occurredAt: new Date(),
    });

    expect(result.state).toBe(state);

    return result;
  };
  return { appointmentId, salonId, serviceId, actor, capture, load, payments, refund, params: { params: Promise.resolve({ id: appointmentId }) } };
}

async function expectBlocked(response: Response, code: string, status = 409) {
  const body = await response.json();

  expect(response.status, JSON.stringify(body)).toBe(status);
  expect(body.error.code).toBe(code);
}

async function customerRefund(f: Awaited<ReturnType<typeof fixture>>, principalCents = 2500, tipCents = 500, held = false) {
  const evidence = {
    captureId: f.capture.id,
    stripeAccountId: f.capture.stripeAccountId,
    paymentIntentId: f.capture.paymentIntentId,
    currency: 'cad' as const,
    mode: 'test' as const,
    source: 'synthetic_test' as const,
    eventId: `evt_${randomUUID()}`,
    refundId: `re_${randomUUID()}`,
    status: 'succeeded' as const,
    amountCents: principalCents + tipCents + (held ? 1 : 0),
    principalCents,
    tipCents,
    occurredAt: new Date(),
  };
  const result = await recordSyntheticCustomerRefund(database, evidence);

  expect(result.state).toBe(held ? 'held_review' : 'applied');

  return evidence;
}
async function completedRefundFixture() {
  const f = await fixture(true);
  const completed = await complete(request('PATCH', { finalPriceCents: 10000 }), f.params);

  expect(completed.status, JSON.stringify(await completed.json())).toBe(200);

  const original = await f.load();
  const refundEvidence = await customerRefund(f);
  const scope = { salonId: f.salonId, appointmentId: f.appointmentId };
  const decisions = () => database.select().from(customerPaymentCreditDecisionSchema).where(eq(customerPaymentCreditDecisionSchema.appointmentId, f.appointmentId));
  const preview = () => previewSyntheticCreditReview(database, f.actor, scope);
  const read = () => readCurrentCustomerPaymentCreditResolution(database, scope);
  const approve = async (allocations = { serviceCreditCents: 2200, taxCreditCents: 300, tipCreditCents: 500 }) => {
    const input = { ...scope, requestId: randomUUID(), expectedEvidenceRevision: (await preview()).evidenceRevision, reason: 'Synthetic owner confirms explicit service, tax and tip credit allocation.', ...allocations };
    const result = await recordSyntheticCreditDecision(database, f.actor, input);
    return { input, result };
  };
  return { ...f, original, refundEvidence, scope, decisions, preview, read, approve };
}

describe('bounded readonly customer credit-note resolution', () => {
  it('resolves a taxed obligation while cash, original invoice and ordinary action holds stay intact', async () => {
    const f = await completedRefundFixture();
    const before = await f.load();
    const grossTenders = await f.payments();
    const beforeView = await f.preview();

    expect(beforeView.resolution).toBeNull();

    const { result } = await f.approve();
    const view = await f.read();

    expect(result.decision).toMatchObject({ previousDecisionId: null, serviceCreditCents: 2200, taxCreditCents: 300, tipCreditCents: 500, deltaServiceCreditCents: 2200, deltaTaxCreditCents: 300, deltaTipCreditCents: 500 });
    expect(view.resolution).toMatchObject({ state: 'resolved', ordinaryActionsBlocked: true, original: { serviceCents: 10000, taxCents: 1300, tipCents: 2000, totalCents: 13300 }, credit: { serviceCents: 2200, taxCents: 300, tipCents: 500, totalCents: 3000 }, adjusted: { serviceCents: 7800, taxCents: 1000, tipCents: 1500, totalCents: 10300 }, actualNetTenderCents: 10300, collectibleBalanceCents: 0 });
    expect(await f.load()).toEqual(before);
    expect(await f.payments()).toEqual(grossTenders);
    expect((await database.select().from(customerPaymentCaptureSchema).where(eq(customerPaymentCaptureSchema.id, f.capture.id)))[0]).toEqual(f.capture);
    expect(await f.decisions()).toHaveLength(1);
    expect(await getCompletedOutstandingRows({ ...f.scope, currency: 'CAD', asOf: f.original.endTime })).toEqual([
      expect.objectContaining({ appointmentId: f.appointmentId, financialState: 'resolved', completedOutstandingCents: 0 }),
    ]);
    expect(await getFinancialBalanceSummary({ salonId: f.salonId, currency: 'CAD', asOf: f.original.endTime })).toMatchObject({ completedOutstandingCents: 0 });

    const ledger = resolveAppointmentPaymentLedger({ cachedAmountPaidCents: before.amountPaidCents, paymentRows: await listPayments(database, f.appointmentId), expectedSalonId: f.salonId, appointmentStatus: before.status, paymentStatus: before.paymentStatus });

    expect(ledger).toMatchObject({ ok: false, code: 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED' });

    await expectBlocked(await recordPayment(request('POST', { amountCents: 3000, method: 'cash', idempotencyKey: `fresh_${f.appointmentId}` }), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    await expectBlocked(await complete(request('PATCH', { finalPriceCents: 10000 }), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    await expectBlocked(await checkout(new Request('http://localhost/checkout'), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    await expectBlocked(await reopen(request('POST'), f.params), 'INVOICE_REVISION_UNSUPPORTED');
    await expectBlocked(await createPaymentLink(request('POST'), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    await expectBlocked(await cancel(request('PATCH', { cancelReason: 'client_request' }), f.params), 'INVALID_STATE', 400);
    await expectBlocked(await transition(request('POST', { to: 'working' }), f.params), 'ALREADY_TERMINAL');

    await expect(runAppointmentManageMutation({ appointmentId: f.appointmentId, salonId: f.salonId, operation: 'move', startTime: new Date(before.startTime.getTime() + 3600000), canReassignTechnician: true })).rejects.toThrow();

    const paymentToken = randomBytes(32).toString('base64url');
    await database.insert(schema.appointmentPaymentLinkSchema).values({ id: `link_${f.appointmentId}`, salonId: f.salonId, appointmentId: f.appointmentId, tokenHash: createHash('sha256').update(paymentToken).digest('hex') });
    await expectBlocked(await publicPayment(new Request('http://localhost/public-pay'), { params: Promise.resolve({ token: paymentToken }) }), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');

    expect(await loadBookingEmailFinancialSummary(f.scope)).toBeNull();

    await expect(database.insert(schema.appointmentPaymentSchema).values({ id: `not_cash_${f.appointmentId}`, salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 3000, method: 'other', reference: result.decision.id, recordedByType: 'admin' })).rejects.toThrow();
    await expect(database.update(schema.appointmentSchema).set({ finalPriceCents: 7800, taxAmountCents: 1000, tipCents: 1500 }).where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();
    await expect(database.update(customerPaymentCreditDecisionSchema).set({ serviceCreditCents: 0 }).where(eq(customerPaymentCreditDecisionSchema.id, result.decision.id))).rejects.toThrow();
    await expect(database.delete(customerPaymentCreditDecisionSchema).where(eq(customerPaymentCreditDecisionSchema.id, result.decision.id))).rejects.toThrow();

    expect(await f.load()).toEqual(before);
    expect(await f.payments()).toEqual(grossTenders);
    expect(notifications.cancelled).not.toHaveBeenCalled();
    expect(notifications.email).not.toHaveBeenCalled();
  });

  it('preserves resolution across harmless metadata, duplicate delivery, fee returns and disabled review writes', async () => {
    const f = await completedRefundFixture();
    await f.approve();
    const before = await f.preview();
    await database.update(schema.appointmentSchema).set({ notes: 'Updated nonfinancial note', clientName: 'Updated synthetic name' }).where(eq(schema.appointmentSchema.id, f.appointmentId));
    await recordSyntheticCustomerRefund(database, { ...f.refundEvidence, eventId: `evt_${randomUUID()}` });
    const identity = { captureId: f.capture.id, stripeAccountId: f.capture.stripeAccountId, paymentIntentId: f.capture.paymentIntentId, currency: 'cad' as const, mode: 'test' as const, source: 'synthetic_test' as const, occurredAt: new Date() };
    await bindSyntheticApplicationFee(database, { ...identity, eventId: `evt_${randomUUID()}`, applicationFeeId: `fee_${f.appointmentId}`, amountCents: f.capture.applicationFeeCents });
    await recordSyntheticApplicationFeeRefund(database, { ...identity, eventId: `evt_${randomUUID()}`, applicationFeeId: `fee_${f.appointmentId}`, feeRefundId: `fr_${randomUUID()}`, status: 'succeeded', amountCents: 1 });
    const heldFee = await recordSyntheticApplicationFeeRefund(database, { ...identity, eventId: `evt_${randomUUID()}`, applicationFeeId: `fee_${f.appointmentId}`, feeRefundId: `fr_${randomUUID()}`, status: 'succeeded', amountCents: f.capture.applicationFeeCents });

    expect(heldFee.state).toBe('held_review');
    expect((await f.preview()).evidenceRevision).toBe(before.evidenceRevision);
    expect((await f.read()).resolution).toEqual(before.resolution);

    vi.stubEnv('CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED', 'false');
    vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'false');

    expect((await f.read()).resolution).toEqual(before.resolution);
    expect(await readCustomerPaymentCreditForReporting(database, { ...f.scope, paymentRows: await f.payments(), asOf: f.original.endTime })).toEqual(before.resolution);
    expect(await getCompletedOutstandingRows({ ...f.scope, currency: 'CAD', asOf: f.original.endTime })).toEqual([
      expect.objectContaining({ appointmentId: f.appointmentId, financialState: 'resolved', completedOutstandingCents: 0 }),
    ]);
    expect(await f.decisions()).toHaveLength(1);
    expect((await f.load()).amountPaidCents).toBe(10300);
  });

  it.each([
    ['CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false'],
    ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'false'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'production'],
  ])('keeps the reporting boundary under review when %s=%s', async (name, value) => {
    const f = await completedRefundFixture();
    await f.approve();
    const before = await f.load();
    vi.stubEnv(name, value);

    expect(await readCustomerPaymentCreditForReporting(database, { ...f.scope, paymentRows: await f.payments(), asOf: f.original.endTime })).toBeNull();
    await expect(f.read()).rejects.toThrow('CUSTOMER_PAYMENT_CREDIT_READ_DISABLED');
    expect(await getCompletedOutstandingRows({ ...f.scope, currency: 'CAD', asOf: f.original.endTime })).toEqual([
      expect.objectContaining({ appointmentId: f.appointmentId, financialState: 'under_review', completedOutstandingCents: 0 }),
    ]);
    expect(await f.decisions()).toHaveLength(1);
    expect(await f.load()).toEqual(before);
  });

  it('reopens review after new customer money and uses monotonic delta notes, never cumulative sums', async () => {
    const f = await completedRefundFixture();
    const first = await f.approve();
    await customerRefund(f, 400, 100);
    const stale = await f.read();

    expect(stale.resolution).toBeNull();
    expect(stale.previousCredit).toEqual({ serviceCreditCents: 2200, taxCreditCents: 300, tipCreditCents: 500 });
    expect(await getCompletedOutstandingRows({ ...f.scope, currency: 'CAD', asOf: f.original.endTime })).toEqual([
      expect.objectContaining({ appointmentId: f.appointmentId, financialState: 'under_review', completedOutstandingCents: 0 }),
    ]);

    await expect(recordSyntheticCreditDecision(database, f.actor, { ...first.input, requestId: randomUUID() })).rejects.toThrow('CUSTOMER_PAYMENT_CREDIT_STALE_EVIDENCE');
    await expect(f.approve({ serviceCreditCents: 2100, taxCreditCents: 800, tipCreditCents: 600 })).rejects.toThrow();

    expect(await f.decisions()).toHaveLength(1);

    const second = await f.approve({ serviceCreditCents: 2600, taxCreditCents: 300, tipCreditCents: 600 });
    const notes = await f.decisions();

    expect(second.result.decision).toMatchObject({ previousDecisionId: first.result.decision.id, deltaServiceCreditCents: 400, deltaTaxCreditCents: 0, deltaTipCreditCents: 100 });
    expect(notes.reduce((sum, row) => sum + row.deltaServiceCreditCents + row.deltaTaxCreditCents + row.deltaTipCreditCents, 0)).toBe(3500);
    expect((await f.read()).resolution).toMatchObject({ credit: { totalCents: 3500 }, adjusted: { totalCents: 9800 }, actualNetTenderCents: 9800, collectibleBalanceCents: 0 });
    expect(await recordSyntheticCreditDecision(database, f.actor, first.input)).toMatchObject({ replayed: true, evidenceMatchesCurrent: false, decision: { id: first.result.decision.id } });
    expect(await recordSyntheticCreditDecision(database, f.actor, second.input)).toMatchObject({ replayed: true, evidenceMatchesCurrent: true, decision: { id: second.result.decision.id } });
    expect(await f.decisions()).toHaveLength(2);
    expect((await f.load()).finalTaxSnapshot).toEqual(f.original.finalTaxSnapshot);
    expect((await f.payments())[0]!.amountCents).toBe(13300);
  });

  it.each(['held_refund', 'late_capture'] as const)('fails closed when %s evidence arrives after a decision', async (kind) => {
    const f = await completedRefundFixture();
    const { result } = await f.approve();
    if (kind === 'held_refund') {
      await customerRefund(f, 400, 100, true);
    } else {
      const capture = await settleSyntheticCustomerPaymentCapture(database, { quoteId: f.capture.quoteId, eventId: `evt_${randomUUID()}`, paymentIntentId: `pi_${randomUUID()}`, stripeAccountId: f.capture.stripeAccountId, source: 'synthetic_test', livemode: false, currency: 'cad', amountCents: f.capture.amountCents, applicationFeeCents: f.capture.applicationFeeCents, capturedAt: new Date() });

      expect(capture.state).toBe('held_review');
    }

    await expect(f.read()).rejects.toThrow();
    await expect(f.preview()).rejects.toThrow();

    expect(await getCompletedOutstandingRows({ ...f.scope, currency: 'CAD', asOf: f.original.endTime })).toEqual([
      expect.objectContaining({ appointmentId: f.appointmentId, financialState: 'under_review', completedOutstandingCents: 0 }),
    ]);
    expect(await f.decisions()).toHaveLength(1);
    expect((await f.decisions())[0]!.id).toBe(result.decision.id);
    expect((await f.load()).amountPaidCents).toBe(10300);
    expect((await f.load()).finalTaxSnapshot).toEqual(f.original.finalTaxSnapshot);
  });

  it('rejects non-owner, stale and invalid allocations without any credit or cash writes', async () => {
    const f = await completedRefundFixture();
    const before = await f.load();
    await database.update(schema.adminSalonMembershipSchema).set({ role: 'admin' }).where(eq(schema.adminSalonMembershipSchema.adminId, f.actor.adminId));

    await expect(f.preview()).rejects.toThrow('CUSTOMER_PAYMENT_CREDIT_OWNER_REQUIRED');

    await database.update(schema.adminSalonMembershipSchema).set({ role: 'owner' }).where(eq(schema.adminSalonMembershipSchema.adminId, f.actor.adminId));

    await expect(f.approve({ serviceCreditCents: 1100, taxCreditCents: 1400, tipCreditCents: 500 })).rejects.toThrow();
    await expect(f.approve({ serviceCreditCents: 2200, taxCreditCents: 300, tipCreditCents: 499 })).rejects.toThrow();

    expect(await f.decisions()).toHaveLength(0);
    expect(await f.load()).toEqual(before);
    expect(await f.payments()).toHaveLength(1);
  });

  it('never creates a credit note to bypass an uncompleted refunded appointment', async () => {
    const f = await fixture(true);
    await customerRefund(f);
    const before = await f.load();

    await expect(previewSyntheticCreditReview(database, f.actor, { salonId: f.salonId, appointmentId: f.appointmentId })).rejects.toThrow();

    expect(await database.select().from(customerPaymentCreditDecisionSchema).where(eq(customerPaymentCreditDecisionSchema.appointmentId, f.appointmentId))).toHaveLength(0);
    expect(await f.load()).toEqual(before);

    await expectBlocked(await transition(request('POST', { to: 'working' }), f.params), 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED');
  });
});
