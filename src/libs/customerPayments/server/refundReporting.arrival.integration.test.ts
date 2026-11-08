import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getFinancialReportingRangeSummary } from '@/libs/financialReportingServer';
import { buildBookingTaxSnapshot, DISABLED_TAX_CONFIG } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '../settings';
import { createCustomerPaymentPreparationRepository } from './preparationRepository';
import { prepareCustomerPaymentQuoteForToken } from './prepareQuoteForToken';
import { recordSyntheticCustomerRefund } from './recordSyntheticRefund';
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

describe('refund arrival between summary queries', () => {
  it('merges a newly observed refund capture anchor into same-period gross cash', async () => {
    const f = await captureFixture();
    const start = new Date(f.evidence.capturedAt.getTime() - 1000);
    const end = new Date(f.evidence.capturedAt.getTime() + 60000);
    let injected = false;
    let probeCount = 0;
    const select = database.select.bind(database);
    holder.db = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== 'select') {
          return Reflect.get(target, property, receiver);
        }
        return (fields?: Parameters<typeof database.select>[0]) => {
          const builder = fields === undefined ? select() : select(fields);
          if (!fields || Object.keys(fields).length !== 1 || fields.id !== schema.appointmentPaymentSchema.id) {
            return builder;
          }
          // This exact legacy marker probe runs after the summary's initial
          // Promise.all. Only this probe is delayed; writers use the real DB.
          const wrap = (value: any): any => new Proxy(value, {
            get(query, method) {
              const member = Reflect.get(query, method);
              if (method === 'limit') {
                return async (count: number) => {
                  probeCount += 1;

                  expect(injected).toBe(false);
                  expect(await f.payments()).toEqual([]);

                  injected = true;
                  const capture = await settleSyntheticCustomerPaymentCapture(database, f.evidence);
                  await recordSyntheticCustomerRefund(database, {
                    captureId: capture.id,
                    stripeAccountId: capture.stripeAccountId,
                    paymentIntentId: capture.paymentIntentId,
                    currency: 'cad',
                    mode: 'test',
                    source: 'synthetic_test',
                    occurredAt: new Date(),
                    eventId: randomUUID(),
                    refundId: randomUUID(),
                    status: 'succeeded',
                    amountCents: 3000,
                    principalCents: 2500,
                    tipCents: 500,
                  });
                  return member.call(query, count);
                };
              }
              return typeof member === 'function'
                ? (...args: unknown[]) => wrap(member.apply(query, args))
                : member;
            },
          });
          return wrap(builder);
        };
      },
    });
    try {
      const result = await getFinancialReportingRangeSummary({ salonId: f.salonId, currency: 'CAD', start, end });

      expect(probeCount).toBe(1);
      expect(injected).toBe(true);
      expect(result).toMatchObject({
        cashCollectedCents: 12000,
        customerPaymentCollectedCents: 12000,
        customerPaymentRefundedCents: 3000,
        customerPaymentNetCashCents: 9000,
      });
    } finally {
      holder.db = database;
    }
  });
});
