/** Real routes, provenance, refund writer and full SQL journal. No provider calls. */
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
import { customerPaymentCaptureSchema, customerPaymentRefundSchema } from '@/models/customerPaymentSchema';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { recordSyntheticCustomerRefund } from './recordSyntheticRefund';
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
  const salonId = `refund_lifecycle_salon_${fixtureNumber}`;
  const appointmentId = `refund_lifecycle_appt_${fixtureNumber}`;
  const serviceId = `refund_lifecycle_service_${fixtureNumber}`;
  const technicianId = `refund_lifecycle_tech_${fixtureNumber}`;
  const clientId = `refund_lifecycle_client_${fixtureNumber}`;
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const future = (offset: number) => new Date(now.getTime() + offset);
  const settings = { payments: {
    ...(taxEnabled ? { tax: { enabled: true, name: 'HST', rateBps: 1300 } } : {}),
    etransfer: { enabled: true, recipient: 'synthetic@example.test', qrPageEnabled: true },
  } };
  const taxConfig = resolveTaxConfig(settings, now);
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Synthetic salon', status: 'active', publicationStatus: 'published', settings });
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
  return { appointmentId, salonId, serviceId, capture, load, payments, refund, params: { params: Promise.resolve({ id: appointmentId }) } };
}

async function expectBlocked(response: Response, code: string) {
  const body = await response.json();

  expect(response.status, JSON.stringify(body)).toBe(409);
  expect(body.error.code).toBe(code);
}

describe('permanent customer-refund lifecycle holds', () => {
  it('allows genuine captured service start and wrap-up through the real0118 database before any refund', async () => {
    const f = await fixture();
    for (const to of ['working', 'wrap_up']) {
      const response = await transition(request('POST', { to }), f.params);

      expect(response.status, JSON.stringify(await response.json())).toBe(200);
    }

    expect(await f.load()).toMatchObject({ status: 'in_progress', canvasState: 'wrap_up', amountPaidCents: 12000, tipCents: 2000 });
  });

  it.each(['applied', 'held_review'] as const)('blocks all waiting-appointment mutations after a %s refund without altering gross evidence', async (state) => {
    const f = await fixture();
    const original = await f.load();
    const originalPayments = await f.payments();
    await f.refund(state);
    const held = await f.load();

    expect(held.amountPaidCents).toBe(state === 'applied' ? 9000 : 12000);
    expect({ ...held, amountPaidCents: original.amountPaidCents, updatedAt: original.updatedAt }).toEqual(original);

    await expectBlocked(await transition(request('POST', { to: 'working' }), f.params), 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED');
    await expectBlocked(await cancel(request('PATCH', { cancelReason: 'client_request' }), f.params), 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED');
    await expectBlocked(await complete(request('PATCH', { finalPriceCents: 10000 }), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    await expectBlocked(await checkout(new Request('http://localhost/checkout'), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');

    await expect(runAppointmentManageMutation({ appointmentId: f.appointmentId, salonId: f.salonId, operation: 'move', startTime: new Date(original.startTime.getTime() + 3600000), canReassignTechnician: true }))
      .rejects.toMatchObject({ code: 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED' });
    await expect(runAppointmentManageMutation({ appointmentId: f.appointmentId, salonId: f.salonId, operation: 'changeService', baseServiceId: f.serviceId, canReassignTechnician: true }))
      .rejects.toMatchObject({ code: 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED' });

    expect(await f.load()).toEqual(held);
    expect(await f.payments()).toEqual(originalPayments);
    expect((await database.select().from(customerPaymentCaptureSchema).where(eq(customerPaymentCaptureSchema.id, f.capture.id)))[0]).toEqual(f.capture);
    expect(notifications.cancelled).not.toHaveBeenCalled();
    expect(notifications.email).not.toHaveBeenCalled();
  });

  it.each(['applied', 'held_review'] as const)('blocks working-to-wrap-up after a %s refund even when future refund writes are disabled', async (state) => {
    const f = await fixture();
    const started = await transition(request('POST', { to: 'working' }), f.params);

    expect(started.status, JSON.stringify(await started.json())).toBe(200);

    await f.refund(state);
    const held = await f.load();
    vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'false');
    await expectBlocked(await transition(request('POST', { to: 'wrap_up' }), f.params), 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED');

    expect(await f.load()).toEqual(held);
  });

  it.each(['applied', 'held_review'] as const)('retains completed tax/tip and classifies a %s refund as review, never collectible debt', async (state) => {
    const f = await fixture(true);
    const completed = await complete(request('PATCH', { finalPriceCents: 10000 }), f.params);

    expect(completed.status, JSON.stringify(await completed.json())).toBe(200);

    const original = await f.load();
    const originalPayments = await f.payments();
    const paymentToken = randomBytes(32).toString('base64url');
    await database.insert(schema.appointmentPaymentLinkSchema).values({ id: `link_${f.appointmentId}`, salonId: f.salonId, appointmentId: f.appointmentId, tokenHash: createHash('sha256').update(paymentToken).digest('hex') });
    await f.refund(state);
    const held = await f.load();

    expect(held.amountPaidCents).toBe(state === 'applied' ? 10300 : 13300);
    expect({ ...held, amountPaidCents: original.amountPaidCents, updatedAt: original.updatedAt }).toEqual(original);

    vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'false');
    await expectBlocked(await recordPayment(request('POST', { amountCents: 3000, method: 'cash', idempotencyKey: `fresh_${f.appointmentId}` }), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    await expectBlocked(await complete(request('PATCH', { finalPriceCents: 10000 }), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    await expectBlocked(await checkout(new Request('http://localhost/checkout'), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    await expectBlocked(await reopen(request('POST'), f.params), 'INVOICE_REVISION_UNSUPPORTED');
    await expectBlocked(await createPaymentLink(request('POST'), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    await expectBlocked(await publicPayment(new Request('http://localhost/public-pay'), { params: Promise.resolve({ token: paymentToken }) }), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');

    expect(await loadBookingEmailFinancialSummary({ salonId: f.salonId, appointmentId: f.appointmentId })).toBeNull();
    expect(await getCompletedOutstandingRows({ salonId: f.salonId, currency: 'CAD', asOf: original.endTime })).toEqual([
      expect.objectContaining({ appointmentId: f.appointmentId, financialState: 'under_review', completedOutstandingCents: 0 }),
    ]);
    expect(await getFinancialBalanceSummary({ salonId: f.salonId, currency: 'CAD', asOf: original.endTime })).toMatchObject({ completedOutstandingCents: 0 });
    expect(await f.load()).toEqual(held);
    expect(await f.payments()).toEqual(originalPayments);
    expect(held.finalTaxSnapshot).toEqual(original.finalTaxSnapshot);
    expect(held.tipCents).toBe(2000);
    expect(held.taxAmountCents).toBe(1300);

    const invalidPatches: Array<Partial<typeof schema.appointmentSchema.$inferInsert>> = [
      { amountPaidCents: held.amountPaidCents, tipCents: 1500 },
      { amountPaidCents: held.amountPaidCents, taxAmountCents: 1299 },
      { amountPaidCents: held.amountPaidCents, completedAt: null },
      { amountPaidCents: held.amountPaidCents, finalTaxSnapshot: null },
      { amountPaidCents: held.amountPaidCents, startedAt: new Date() },
      { amountPaidCents: held.amountPaidCents! + 1 },
      { amountPaidCents: held.amountPaidCents, canvasState: 'working', status: 'in_progress' },
    ];
    for (const patch of invalidPatches) {
      await expect(database.update(schema.appointmentSchema).set(patch).where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();
    }

    await expect(database.insert(schema.appointmentPaymentSchema).values({ id: `forbidden_${f.appointmentId}`, salonId: f.salonId, appointmentId: f.appointmentId, amountCents: 1, method: 'cash', recordedByType: 'admin' })).rejects.toThrow();
    await expect(database.update(schema.appointmentPaymentSchema).set({ voidedAt: new Date() }).where(eq(schema.appointmentPaymentSchema.id, f.capture.tenderId))).rejects.toThrow();
    await expect(database.update(customerPaymentRefundSchema).set({ amountCents: 1 }).where(eq(customerPaymentRefundSchema.appointmentId, f.appointmentId))).rejects.toThrow();

    // Only an exact, voided system marker may retain new late-capture facts.
    // None of its individual attributes grants permission to collect money.
    const markerId = randomUUID();
    const reviewMarker = {
      id: `cpay_${markerId}`,
      reference: `customer_payment_capture:${markerId}`,
      salonId: f.salonId,
      appointmentId: f.appointmentId,
      amountCents: 1,
      method: 'online',
      recordedByType: 'system',
      voidedAt: new Date(),
      voidedBy: 'customer_payment_review',
    };
    for (const patch of [
      { voidedAt: null },
      { id: `ordinary_${markerId}` },
      { reference: 'ordinary_reference' },
      { method: 'cash' },
      { recordedByType: 'admin' },
      { voidedBy: 'ordinary_actor' },
    ]) {
      await expect(database.insert(schema.appointmentPaymentSchema).values({ ...reviewMarker, ...patch })).rejects.toThrow();
    }

    expect(await f.load()).toEqual(held);
    expect(await f.payments()).toEqual(originalPayments);

    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');
    await expectBlocked(await checkout(new Request('http://localhost/checkout'), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
  });

  it('replays a historical successful manual receipt while refusing any fresh collection after refund', async () => {
    const f = await fixture();
    const completed = await complete(request('PATCH', { finalPriceCents: 10000, tipCents: 3000, payments: [] }), f.params);

    expect(completed.status, JSON.stringify(await completed.json())).toBe(200);

    const payment = { amountCents: 1000, method: 'cash', idempotencyKey: `historical_${f.appointmentId}` };
    const originalResponse = await recordPayment(request('POST', payment), f.params);
    const originalBody = await originalResponse.json();

    expect(originalResponse.status, JSON.stringify(originalBody)).toBe(200);

    await f.refund('applied');
    const held = await f.load();
    const tenders = await f.payments();
    const replay = await recordPayment(request('POST', payment), f.params);
    const replayBody = await replay.json();

    expect(replay.status, JSON.stringify(replayBody)).toBe(200);
    expect(replayBody).toEqual({ data: { ...originalBody.data, idempotentReplay: true } });

    await expectBlocked(await recordPayment(request('POST', { ...payment, idempotencyKey: `fresh_${f.appointmentId}` }), f.params), 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED');

    expect(await f.load()).toEqual(held);
    expect(await f.payments()).toEqual(tenders);

    const manual = tenders.find(row => row.id !== f.capture.tenderId)!;

    await expect(database.delete(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.id, manual.id))).rejects.toThrow();
    await expect(database.update(schema.appointmentPaymentSchema).set({ voidedAt: new Date() }).where(eq(schema.appointmentPaymentSchema.id, manual.id))).rejects.toThrow();

    const ledger = resolveAppointmentPaymentLedger({ cachedAmountPaidCents: held.amountPaidCents, paymentRows: await listPayments(database, f.appointmentId), expectedSalonId: f.salonId, appointmentStatus: held.status, paymentStatus: held.paymentStatus });

    expect(ledger).toMatchObject({ ok: false, code: 'PAYMENT_LEDGER_RECONCILIATION_REQUIRED' });
  });
});
