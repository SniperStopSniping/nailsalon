/** Real complete migration journal, isolated in-memory database, closed fake evidence. */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getFinancialReportingRangeSummary } from '@/libs/financialReportingServer';
import { customerPaymentFixtureMovementSchema } from '@/models/customerPaymentFixtureMovementSchema';
import * as schema from '@/models/Schema';

import { createProviderFixtureMovementApplication } from './applyProviderFixtureMovements';
import { readOfflineFixtureMovementReport } from './fixtureMovementReportingReader';
import { addFixtureDispute, addFixtureRefund, createFixtureMovementGraph } from './fixtureMovementTestSupport';

vi.mock('server-only', () => ({}));
const holder = vi.hoisted(() => ({ database: null as unknown }));
vi.mock('@/libs/DB', () => ({ get db() {
  return holder.database;
} }));
let client: PGlite;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client, { schema });
  holder.database = database;
  await migrate(database, { migrationsFolder: path.join(process.cwd(), 'migrations') });
}, 60000);

beforeEach(() => {
  for (const key of ['CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_MOVEMENTS_ENABLED']) {
    vi.stubEnv(key, 'true');
  }
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(async () => client?.close());

const range = (salonId: string) => ({ salonId, currency: 'CAD', start: new Date('2020-01-01'), end: new Date('2040-01-01') });

describe('full-journal fixture movement financial reporting', () => {
  it('forwards unallocated refunds, independent fees and signed dispute cash without altering capture or credit', async () => {
    const f = await createFixtureMovementGraph(database);
    const [before] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));
    await addFixtureRefund(f);
    await addFixtureRefund(f, { kind: 'application_fee_refund' });
    await addFixtureDispute(f);
    const posted = await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(posted).toMatchObject({ state: 'applied', reasons: [] });

    for (const key of ['CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'CUSTOMER_PAYMENTS_FIXTURE_MOVEMENTS_ENABLED']) {
      vi.stubEnv(key, 'false');
    }
    const report = await getFinancialReportingRangeSummary(range(f.salonId));

    expect(report).toMatchObject({
      cashCollectedCents: 12000,
      customerPaymentCollectedCents: 12000,
      customerPaymentHeldForReviewCents: 12000,
      customerPaymentRefundedCents: 1000,
      customerPaymentUnallocatedRefundCents: 1000,
      customerPaymentFeeRefundedCents: 100,
      customerPaymentDisputeWithdrawnCents: 2000,
      customerPaymentDisputeReinstatedCents: 0,
      customerPaymentDisputeFeeCents: 1500,
      customerPaymentDisputeNetCents: -3500,
      customerPaymentNetCashCents: 11000,
      customerPaymentMovementReconciliationRequired: false,
      completedAppointmentRevenueCents: 0,
    });

    const [after] = await database.select().from(schema.appointmentSchema).where(eq(schema.appointmentSchema.id, f.appointmentId));

    expect(after).toEqual(before);
  }, 60000);

  it('retains posted historical cash and omits net after later unmatched source evidence', async () => {
    const f = await createFixtureMovementGraph(database);
    await addFixtureRefund(f);

    expect(await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId })).toMatchObject({ state: 'applied' });

    await addFixtureRefund(f, { amountCents: 400, withOperation: false });
    const report = await getFinancialReportingRangeSummary(range(f.salonId));

    expect(report).toMatchObject({ customerPaymentCollectedCents: 12000, customerPaymentRefundedCents: 1000, customerPaymentUnallocatedRefundCents: 1000, customerPaymentMovementReconciliationRequired: true });
    expect(Object.hasOwn(report, 'customerPaymentNetCashCents')).toBe(false);
  }, 60000);

  it('omits net for unposted source facts while preserving gross and never inventing dispute cash', async () => {
    const f = await createFixtureMovementGraph(database);
    await addFixtureDispute(f, { status: 'won', transactions: [] });
    const report = await getFinancialReportingRangeSummary(range(f.salonId));

    expect(report).toMatchObject({ customerPaymentCollectedCents: 12000, customerPaymentRefundedCents: 0, customerPaymentDisputeWithdrawnCents: 0, customerPaymentDisputeReinstatedCents: 0, customerPaymentMovementReconciliationRequired: true });
    expect(report.customerPaymentNetCashCents).toBeUndefined();
  }, 60000);

  it('uses movement dates and loads parent captures outside a refund-only period', async () => {
    const f = await createFixtureMovementGraph(database);
    const tomorrow = new Date(Date.now() + 86400000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(tomorrow);
    await addFixtureRefund(f, { amountCents: 700 });
    const posted = await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(posted).toMatchObject({ state: 'applied', reasons: [] });

    const report = await getFinancialReportingRangeSummary({ salonId: f.salonId, currency: 'CAD', start: new Date(tomorrow.getTime() - 60000), end: new Date(tomorrow.getTime() + 60000) });

    expect(report).toMatchObject({ cashCollectedCents: 0, customerPaymentCollectedCents: 0, customerPaymentRefundedCents: 700, customerPaymentUnallocatedRefundCents: 700, customerPaymentNetCashCents: -700, customerPaymentMovementReconciliationRequired: false });
  }, 60000);

  it('shows explicit reinstated principal and signed fee returns separately from customer net', async () => {
    const f = await createFixtureMovementGraph(database);
    const created = Math.floor(Date.now() / 1000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date((created + 2) * 1000));
    const disputeId = 'dp_reportingreinstatement';
    const base = { object: 'balance_transaction', source: disputeId, currency: 'cad', exchange_rate: null, created, available_on: created + 86400, status: 'pending', type: 'adjustment', reporting_category: 'dispute' };
    await addFixtureDispute(f, { disputeId, objectCreated: created, status: 'won', transactions: [
      { ...base, id: 'txn_reportingwithdrawal', amount: -2000, fee: 1500, net: -3500 },
      { ...base, id: 'txn_reportingreinstatement', created: created + 1, reporting_category: 'dispute_reversal', amount: 2000, fee: -1500, net: 3500 },
    ] });
    const posted = await createProviderFixtureMovementApplication(database).reconcileMovements({ captureApplicationId: f.captureApplicationId });

    expect(posted).toMatchObject({ state: 'applied', reasons: [] });

    const report = await getFinancialReportingRangeSummary(range(f.salonId));

    expect(report).toMatchObject({ customerPaymentDisputeWithdrawnCents: 2000, customerPaymentDisputeReinstatedCents: 2000, customerPaymentDisputeFeeCents: 0, customerPaymentDisputeNetCents: 0, customerPaymentNetCashCents: 12000, customerPaymentMovementReconciliationRequired: false });
  }, 60000);

  it('retains exact historical birth batches after repeated arrivals between movement and reconciliation reads', async () => {
    const f = await createFixtureMovementGraph(database);
    await addFixtureRefund(f);
    const writer = createProviderFixtureMovementApplication(database);
    await writer.reconcileMovements({ captureApplicationId: f.captureApplicationId });
    let arrivals = 0;
    const racing = {
      select: (...args: Parameters<typeof database.select>) => {
        const query = database.select(...args);
        const from = query.from.bind(query);
        return {
          from: (table: Parameters<typeof query.from>[0]) => {
            const next = from(table);
            if (table !== customerPaymentFixtureMovementSchema) {
              return next;
            }
            return {
              where: async (...conditions: Parameters<typeof next.where>) => {
                const rows = await next.where(...conditions);
                arrivals++;
                await addFixtureRefund(f, { amountCents: arrivals * 100 });
                await writer.reconcileMovements({ captureApplicationId: f.captureApplicationId });
                return rows;
              },
            };
          },
        };
      },
    } as unknown as Parameters<typeof readOfflineFixtureMovementReport>[0];
    const report = await readOfflineFixtureMovementReport(racing, { ...range(f.salonId), currency: 'CAD' });

    expect(arrivals).toBe(2);
    expect(report).toMatchObject({ refundedCents: 1100, unallocatedRefundCents: 1100, movementReconciliationRequired: true });
  }, 60000);
});
