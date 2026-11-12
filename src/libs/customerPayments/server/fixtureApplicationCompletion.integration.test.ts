/** Disposable full-journal integration; auth/notifications mocked, money paths real. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as checkout } from '@/app/api/appointments/[id]/checkout/route';
import { PATCH as complete } from '@/app/api/appointments/[id]/complete/route';
import { POST as recordPayment } from '@/app/api/appointments/[id]/payments/route';
import { POST as transition } from '@/app/api/appointments/[id]/transition/route';
import { listPayments } from '@/libs/appointmentCheckoutServer';
import { getFinancialReportingRangeSummary } from '@/libs/financialReportingServer';
import { resolveTaxConfig } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { customerPaymentTenderSummary } from '../provenance';
import { verifyOfflineProviderReceipt } from '../provider/evidence';
import { createProviderFixtureCaptureApplication } from './applyProviderFixtureCapture';
import { createFixtureCaptureGraph, signFixtureCapturePayload } from './fixtureApplicationTestSupport';

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
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'true');
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

async function fixture() {
  const salonSettings = { payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } } };
  const f = await createFixtureCaptureGraph(database, { taxConfig: resolveTaxConfig(salonSettings, new Date()), salonSettings, tipCents: 2000 });
  await database.insert(schema.appointmentPhotoSchema).values({ id: randomUUID(), appointmentId: f.appointmentId, salonId: f.salonId, normalizedClientPhone: '4165550111', photoType: 'after', cloudinaryPublicId: 'offline_fixture_photo', imageUrl: 'https://example.invalid/fixture.jpg' });
  const application = await createProviderFixtureCaptureApplication(database).applyCapture({ operationId: f.identity.id });

  expect(application.state).toBe('applied');

  return { ...f, application, params: { params: Promise.resolve({ id: f.appointmentId }) } };
}
function range(f: Awaited<ReturnType<typeof fixture>>) {
  return { salonId: f.salonId, currency: 'CAD', start: new Date(f.observedAt.getTime() - 2000), end: new Date(f.observedAt.getTime() + 2000) };
}
async function load(f: Awaited<ReturnType<typeof fixture>>) {
  return (await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId)))[0]!;
}
async function assertBlocked(response: Response) {
  expect(response.status, JSON.stringify(await response.json())).toBe(409);
}
async function addLaterEvidence(f: Awaited<ReturnType<typeof fixture>>, kind: 'refund' | 'dispute' | 'conflict') {
  let payload: Record<string, unknown>;
  if (kind === 'conflict') {
    payload = JSON.parse(JSON.stringify(f.chargePayload));
    ((payload.data as { object: Record<string, unknown> }).object).amount = f.snapshot.chargeCents + 1;
  } else {
    payload = f.event(kind === 'refund' ? 'refund.updated' : 'charge.dispute.created', kind === 'refund'
      ? { id: `re_${randomUUID().replaceAll('-', '')}`, object: 'refund', status: 'succeeded', amount: 1000, currency: 'cad', charge: f.ids.charge, payment_intent: f.ids.intent, created: Math.floor(Date.now() / 1000) }
      : { id: `dp_${randomUUID().replaceAll('-', '')}`, object: 'dispute', livemode: false, status: 'needs_response', amount: 1000, currency: 'cad', charge: f.ids.charge, payment_intent: f.ids.intent, created: Math.floor(Date.now() / 1000), balance_transactions: [] });
  }
  const signed = signFixtureCapturePayload(payload);
  const receipt = await verifyOfflineProviderReceipt(signed.input, f.config, signed.verifier);
  if (kind === 'conflict') {
    await expect(f.journal.ingestReceipt(receipt)).rejects.toThrow('INBOX_CONFLICT_RETAINED');
  } else {
    await f.journal.ingestReceipt(receipt);
  }
}

describe('offline fixture actual completion and reporting integration', () => {
  it('preserves tax and prepaid tip through actual checkout/completion and counts immutable gross once', async () => {
    const f = await fixture();

    expect(f.snapshot).toMatchObject({ taxCents: 1300, tipCents: 2000, chargeCents: 13300 });

    const rows = await listPayments(database, f.appointmentId);

    expect(rows).toHaveLength(1);
    expect(customerPaymentTenderSummary(rows[0]!)).toMatchObject({ netCents: 13300, collectionHold: false });

    const checkoutResponse = await checkout(new Request('http://localhost/fixture-checkout'), f.params);

    expect(checkoutResponse.status, JSON.stringify(await checkoutResponse.json())).toBe(200);

    const response = await complete(request('PATCH', { finalPriceCents: 10000 }), f.params);

    expect(response.status, JSON.stringify(await response.json())).toBe(200);
    expect(await load(f)).toMatchObject({ status: 'completed', amountPaidCents: 13300, tipCents: 2000, taxAmountCents: 1300, finalPriceCents: 10000, paymentStatus: 'paid' });
    expect(await getFinancialReportingRangeSummary(range(f))).toMatchObject({ cashCollectedCents: 13300, customerPaymentCollectedCents: 13300, customerPaymentHeldForReviewCents: 0 });
    expect(await listPayments(database, f.appointmentId)).toHaveLength(1);
  }, 60000);

  it.each(['refund', 'dispute', 'conflict'] as const)('later %s preserves gross but blocks actual mutation paths with writer flags off', async (kind) => {
    const f = await fixture();
    await addLaterEvidence(f, kind);
    vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false');
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
    const rows = await listPayments(database, f.appointmentId);

    expect(customerPaymentTenderSummary(rows[0]!)).toMatchObject({ netCents: 13300, collectionHold: true });
    expect(await getFinancialReportingRangeSummary(range(f))).toMatchObject({ cashCollectedCents: 13300, customerPaymentCollectedCents: 13300, customerPaymentHeldForReviewCents: 13300 });

    await assertBlocked(await recordPayment(request('POST', { amountCents: 100, method: 'cash', idempotencyKey: randomUUID() }), f.params));
    await assertBlocked(await complete(request('PATCH', { finalPriceCents: 10000 }), f.params));
    await assertBlocked(await transition(request('POST', { to: 'working' }), f.params));

    expect(await load(f)).toMatchObject({ status: 'confirmed', amountPaidCents: 13300, tipCents: 2000 });
    expect(await listPayments(database, f.appointmentId)).toHaveLength(1);
  }, 60000);
});
