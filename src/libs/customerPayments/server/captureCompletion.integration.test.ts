import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as clientProfile } from '@/app/api/admin/clients/[id]/route';
import { GET as checkout } from '@/app/api/appointments/[id]/checkout/route';
import { PATCH as complete } from '@/app/api/appointments/[id]/complete/route';
import { POST as voidPayment } from '@/app/api/appointments/[id]/payments/[paymentId]/void/route';
import { POST as recordPayment } from '@/app/api/appointments/[id]/payments/route';
import { POST as reopen } from '@/app/api/appointments/[id]/reopen/route';
import { GET as clientHistory } from '@/app/api/appointments/history/route';
import { runAppointmentManageMutation } from '@/libs/appointmentManage';
import { validateAppointmentTaxSnapshotChain } from '@/libs/appointmentTaxSnapshot';
import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG, resolveTaxConfig } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { settleSyntheticCustomerPaymentCapture } from './settleSyntheticCapture';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ database: null as unknown, salonId: '' }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.database;
} }));
vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess: vi.fn(async (appointmentId: string) => {
    const db = holder.database as ReturnType<typeof drizzle<typeof schema>>;
    const [appointment] = await db.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointmentId));
    return { ok: true, actorRole: 'admin', admin: { id: 'fixture_owner', name: 'Synthetic owner' }, appointment };
  }),
}));
vi.mock('@/libs/clientApiGuards', () => ({
  requireClientApiSession: vi.fn(async () => ({ ok: true, phoneVariants: ['4165550111'] })),
  requireClientSalonFromQuery: vi.fn(async () => ({ ok: true, salon: { id: holder.salonId } })),
}));
vi.mock('@/libs/adminAuth', () => ({
  getAdminSession: vi.fn(async () => ({ id: 'fixture_owner' })),
  requireAdminSalon: vi.fn(async () => {
    const db = holder.database as ReturnType<typeof drizzle<typeof schema>>;
    const [salon] = await db.select().from(schema.salonSchema).where(eq(schema.salonSchema.id, holder.salonId));
    return { salon };
  }),
}));
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
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await client?.close();
});

async function fixture(taxEnabled = false, held = false) {
  fixtureNumber++;
  const salonId = `capture_completion_salon_${fixtureNumber}`;
  holder.salonId = salonId;
  const appointmentId = `capture_completion_appt_${fixtureNumber}`;
  const serviceId = `capture_completion_service_${fixtureNumber}`;
  const technicianId = `capture_completion_tech_${fixtureNumber}`;
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const future = (offset: number) => new Date(now.getTime() + offset);
  const settings = taxEnabled ? { payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } } } : {};
  const taxConfig = taxEnabled ? resolveTaxConfig(settings, now) : DISABLED_TAX_CONFIG;
  await database.insert(schema.salonSchema).values({ id: salonId, slug: salonId, name: 'Synthetic salon', status: 'active', publicationStatus: 'published', settings });
  await database.insert(schema.technicianSchema).values({ id: technicianId, salonId, name: 'Synthetic technician' });
  await database.insert(schema.serviceSchema).values({ id: serviceId, salonId, name: 'Fixed service', price: 10000, durationMinutes: 60, category: 'manicure' });
  await database.insert(schema.appointmentSchema).values({ id: appointmentId, salonId, technicianId, clientPhone: '4165550111', clientName: 'Synthetic customer', startTime: future(86400000), endTime: future(90000000), totalPrice: 10000, basePriceCents: 10000, addOnsPriceCents: 0, subtotalBeforeDiscountCents: 10000, totalDurationMinutes: 60, status: 'confirmed', invoiceCurrency: 'CAD', bookingTaxSnapshot: buildBookingTaxSnapshot({ taxConfig, totals: { finalPriceCents: 10000, taxableSubtotalCents: taxEnabled ? 10000 : 0, taxAmountCents: taxEnabled ? 1300 : 0, taxApplied: taxEnabled }, currency: 'CAD', capturedAt: now }) });
  await database.insert(schema.appointmentServicesSchema).values({ id: `snapshot_${appointmentId}`, appointmentId, serviceId, priceAtBooking: 10000, durationAtBooking: 60 });
  await database.insert(schema.appointmentPhotoSchema).values({ id: `photo_${appointmentId}`, appointmentId, salonId, normalizedClientPhone: '4165550111', photoType: 'after', cloudinaryPublicId: `synthetic_${appointmentId}`, imageUrl: 'https://example.test/synthetic.jpg' });
  await database.insert(schema.salonStripeAccountSchema).values({ id: `binding_${salonId}`, salonId, stripeAccountId: `acct_fixture${fixtureNumber}`, livemode: false, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, lastSyncedAt: now });
  await database.insert(schema.appointmentAccessTokenSchema).values({ id: `cap_${appointmentId}`, salonId, appointmentId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: future(3600000) });
  await createCustomerPaymentPreparationRepository(database).saveCustomerPaymentSettingsDraft({ salonId, actorId: 'fixture_owner', expectedRevision: 0, requestId: randomUUID(), settings: { ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS, enabled: true } });
  const quote = await prepareCustomerPaymentQuoteForToken(database, token, { requestId: randomUUID(), tipCents: 2000 });
  const capture = await settleSyntheticCustomerPaymentCapture(database, { quoteId: quote.id, eventId: `evt_${randomUUID()}`, paymentIntentId: `pi_${randomUUID()}`, stripeAccountId: quote.stripeAccountId, source: 'synthetic_test', livemode: false, currency: 'cad', amountCents: quote.snapshot.chargeCents + (held ? 1 : 0), applicationFeeCents: quote.snapshot.applicationFeeCents, capturedAt: new Date() });

  expect(capture.state).toBe(held ? 'held_review' : 'posted');

  const load = async () => (await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, appointmentId)))[0]!;
  const payments = () => database.select().from(schema.appointmentPaymentSchema).where(eq(schema.appointmentPaymentSchema.appointmentId, appointmentId));
  return { appointmentId, salonId, serviceId, capture, load, payments, params: { params: Promise.resolve({ id: appointmentId }) } };
}
function completionRequest(payload: unknown) {
  return new Request('http://localhost/complete', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

describe('real synthetic capture through canonical checkout and completion', () => {
  it('shows zero balance with prepaid tip, rejects tip reduction, and completes once with immutable final tax', async () => {
    const f = await fixture();
    const review = await checkout(new Request('http://localhost/checkout'), f.params);
    const reviewBody = await review.json();

    expect(review.status, JSON.stringify(reviewBody)).toBe(200);
    expect(reviewBody.data.balance).toMatchObject({ totalDueCents: 12000, amountAlreadyPaidCents: 12000, balanceCents: 0 });
    expect(reviewBody.data.appointment.tipCents).toBe(2000);

    const forbiddenVoid = await voidPayment(new Request('http://localhost/void', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: f.appointmentId, paymentId: f.capture.tenderId }) });

    expect(forbiddenVoid.status).toBe(409);
    expect((await forbiddenVoid.json()).error.code).toBe('CUSTOMER_PAYMENT_REFUND_REQUIRED');

    const manual = await recordPayment(new Request('http://localhost/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountCents: 100, method: 'online', idempotencyKey: 'manual-capture-claim', reference: `customer_payment_capture:${f.capture.id}` }) }), f.params);

    expect(manual.status).toBe(409);
    expect((await manual.json()).error.code).toBe('CUSTOMER_PAYMENT_RESERVED_REFERENCE');

    await expect(runAppointmentManageMutation({ appointmentId: f.appointmentId, salonId: f.salonId, operation: 'move', startTime: new Date((await f.load()).startTime.getTime() + 3600000), canReassignTechnician: true })).rejects.toMatchObject({ code: 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED' });
    await expect(runAppointmentManageMutation({ appointmentId: f.appointmentId, salonId: f.salonId, operation: 'changeService', baseServiceId: f.serviceId, canReassignTechnician: true })).rejects.toMatchObject({ code: 'CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED' });

    const below = await complete(completionRequest({ finalPriceCents: 10000, tipCents: 0 }), f.params);

    expect(below.status).toBe(409);
    expect((await below.json()).error.code).toBe('CUSTOMER_PAYMENT_PREPAID_TIP_REQUIRED');
    expect((await f.load()).status).toBe('confirmed');

    const response = await complete(completionRequest({ finalPriceCents: 10000 }), f.params);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);

    const final = await f.load();

    expect(final).toMatchObject({ status: 'completed', tipCents: 2000, amountPaidCents: 12000, finalPriceCents: 10000, taxAmountCents: 0, paymentStatus: 'paid' });
    expect(validateAppointmentTaxSnapshotChain(final).ok).toBe(true);
    expect(final.finalTaxSnapshot?.kind).toBe('final_actual');

    const tenders = await f.payments();

    expect(tenders).toHaveLength(1);
    expect(tenders[0]).toMatchObject({ id: f.capture.tenderId, amountCents: 12000, voidedAt: null });

    const replay = await complete(completionRequest({ finalPriceCents: 10000 }), f.params);

    expect(replay.status).toBe(200);
    expect(await f.payments()).toHaveLength(1);
    expect((await f.load()).finalTaxSnapshot).toEqual(final.finalTaxSnapshot);

    for (const patch of [{ tipCents: 1000 }, { taxRateBps: 500 }, { taxAmountCents: 1 }]) {
      await expect(database.update(schema.appointmentSchema).set(patch).where(eq(schema.appointmentSchema.id, f.appointmentId))).rejects.toThrow();
    }
    const reopened = await reopen(new Request('http://localhost/reopen', { method: 'POST', body: '{}' }), f.params);

    expect(reopened.status).toBe(409);
    expect((await reopened.json()).error.code).toBe('INVOICE_REVISION_UNSUPPORTED');
    expect((await f.load()).status).toBe('completed');
  });

  it('completes a genuine frozen added-tax quote through0117 without changing tax or prepaid tip', async () => {
    const f = await fixture(true);

    expect(f.capture.amountCents).toBe(13300);

    const response = await complete(completionRequest({ finalPriceCents: 10000 }), f.params);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);

    const final = await f.load();

    expect(final).toMatchObject({ finalPriceCents: 10000, taxAmountCents: 1300, taxRateBps: 1300, tipCents: 2000, amountPaidCents: 13300 });
    expect(validateAppointmentTaxSnapshotChain(final).ok).toBe(true);
    expect(await f.payments()).toHaveLength(1);
  });

  it('fails closed in actual checkout when the ledger flag is disabled after capture', async () => {
    const f = await fixture();
    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');
    const response = await checkout(new Request('http://localhost/checkout'), f.params);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('PAYMENT_LEDGER_RECONCILIATION_REQUIRED');
    expect(await f.payments()).toHaveLength(1);
  });
});

describe('capture-backed client financial readers', () => {
  for (const held of [false, true]) {
    it(held ? 'keeps held capture history and profile blocked' : 'resolves posted capture history and profile without leaking provenance', async () => {
      const f = await fixture(false, held);
      const clientId = `client_${f.appointmentId}`;
      await database.insert(schema.salonClientSchema).values({ id: clientId, salonId: f.salonId, phone: '4165550111', fullName: 'Synthetic customer' });
      const history = await clientHistory(new Request('http://localhost/history?salonSlug=fixture'));
      const historyBody = await history.json();

      expect(history.status, JSON.stringify(historyBody)).toBe(held ? 409 : 200);

      if (!held) {
        expect(historyBody.data.appointments[0].financial).toMatchObject({ totalCents: 12000, amountAlreadyPaidCents: 12000, balanceCents: 0 });
      }
      const profile = await clientProfile(new Request('http://localhost/profile?salonSlug=fixture'), { params: Promise.resolve({ id: clientId }) });
      const profileBody = await profile.json();

      expect(profile.status, JSON.stringify(profileBody)).toBe(200);

      const financial = profileBody.data.upcomingAppointments[0].financial;

      expect(financial.balanceCents).toBe(held ? null : 0);
      expect(JSON.stringify(profileBody)).not.toContain('stripeAccountId');
      expect(JSON.stringify(historyBody)).not.toContain('stripeAccountId');

      vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');
      const disabled = await clientHistory(new Request('http://localhost/history?salonSlug=fixture'));

      expect(disabled.status).toBe(409);

      const disabledProfile = await clientProfile(new Request('http://localhost/profile?salonSlug=fixture'), { params: Promise.resolve({ id: clientId }) });

      expect(disabledProfile.status).toBe(200);
      expect((await disabledProfile.json()).data.upcomingAppointments[0].financial.balanceCents).toBeNull();
    });
  }
});

describe('captured completion with additional manual tip tender', () => {
  it('stages the additional tip and cash atomically before freezing the final invoice', async () => {
    const f = await fixture();
    const capturedBefore = (await f.payments())[0];
    const response = await complete(completionRequest({ finalPriceCents: 10000, tipCents: 3000, payments: [{ amountCents: 1000, method: 'cash' }] }), f.params);
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);

    const final = await f.load();

    expect(final).toMatchObject({ status: 'completed', paymentStatus: 'paid', tipCents: 3000, amountPaidCents: 13000, finalPriceCents: 10000 });
    expect(validateAppointmentTaxSnapshotChain(final).ok).toBe(true);

    const rows = await f.payments();

    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === capturedBefore!.id)).toEqual(capturedBefore);
    expect(rows.find(row => row.id !== capturedBefore!.id)).toMatchObject({ amountCents: 1000, method: 'cash', voidedAt: null });

    const checkoutResponse = await checkout(new Request('http://localhost/checkout'), f.params);

    expect(checkoutResponse.status).toBe(200);
    expect((await checkoutResponse.json()).data.balance).toMatchObject({ totalDueCents: 13000, amountAlreadyPaidCents: 13000, balanceCents: 0 });

    const replay = await complete(completionRequest({ finalPriceCents: 10000, tipCents: 3000, payments: [{ amountCents: 1000, method: 'cash' }] }), f.params);

    expect(replay.status).toBe(200);
    expect(await f.payments()).toHaveLength(2);
  });

  for (const suppress of [true, false]) {
    it(suppress ? 'rolls back staged tip and cash when the final update returns no rows' : 'rolls back staged tip and cash when finalization throws', async () => {
      const f = await fixture();
      const before = await f.load();
      const tenders = await f.payments();
      // Test-only failure injection AFTER the actual immutable guards run.
      // No existing trigger is disabled or changed.
      await client.exec(`
        CREATE FUNCTION fixture_fail_capture_completion() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          ${suppress ? 'RETURN NULL;' : 'RAISE EXCEPTION \'fixture finalization failure\';'}
        END $$;
        CREATE TRIGGER zzz_fixture_fail_capture_completion BEFORE UPDATE ON appointment
        FOR EACH ROW WHEN (NEW.status = 'completed') EXECUTE FUNCTION fixture_fail_capture_completion();
      `);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const response = await complete(completionRequest({ finalPriceCents: 10000, tipCents: 3000, payments: [{ amountCents: 1000, method: 'cash' }] }), f.params);

        expect(response.status).toBe(suppress ? 409 : 500);
        expect(await f.load()).toEqual(before);
        expect(await f.payments()).toEqual(tenders);
      } finally {
        await client.exec('DROP TRIGGER zzz_fixture_fail_capture_completion ON appointment; DROP FUNCTION fixture_fail_capture_completion();');
      }
    });
  }
});

describe('captured invoice completion reconciliation', () => {
  for (const change of ['price', 'tax_rate', 'tax_label', 'exemption'] as const) {
    it(`returns typed conflict without money writes for changed ${change}`, async () => {
      const f = await fixture(true);
      const before = await f.load();
      const tenders = await f.payments();
      if (change === 'tax_rate' || change === 'tax_label') {
        await database.update(schema.salonSchema).set({ settings: { payments: { tax: {
          enabled: true,
          name: change === 'tax_label' ? 'Updated HST label' : 'HST',
          rateBps: change === 'tax_rate' ? 1500 : 1300,
        } } } }).where(eq(schema.salonSchema.id, f.salonId));
      }
      const response = await complete(completionRequest({
        finalPriceCents: change === 'price' ? 11000 : 10000,
        tipCents: 3000,
        payments: [{ amountCents: 1000, method: 'cash' }],
        ...(change === 'exemption' ? { taxExempt: true, taxExemptReason: 'Changed after capture' } : {}),
      }), f.params);
      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(409);
      expect(body.error.code).toBe('CUSTOMER_PAYMENT_RECONCILIATION_REQUIRED');
      expect(await f.load()).toEqual(before);
      expect(await f.payments()).toEqual(tenders);
    });
  }
});
