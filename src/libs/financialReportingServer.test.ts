import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildBookingTaxSnapshot,
  buildFinalTaxSnapshot,
  buildForfeitureTaxSnapshot,
  resolveTaxConfig,
} from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import {
  buildFinancialBalanceSql,
  getCompletedOutstandingRows,
  getCurrentFinancialReportingRanges,
  getCurrentFinancialReportingSummaries,
  getFinancialBalanceSummary,
  getFinancialReportingRangeSummary,
} from './financialReportingServer';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const SALON_ID = 'salon_financial_reporting';
const OTHER_SALON_ID = 'salon_financial_reporting_other';
const NOW = new Date('2026-07-15T18:00:00.000Z'); // Wednesday 2 PM Toronto.

let client: PGlite;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  testDb = drizzle(client, { schema });
  await migrate(testDb, {
    migrationsFolder: path.join(process.cwd(), 'migrations'),
  });
  holder.db = testDb;

  await testDb.insert(schema.salonSchema).values([
    {
      id: SALON_ID,
      name: 'Financial Reporting Salon',
      slug: 'financial-reporting-salon',
    },
    {
      id: OTHER_SALON_ID,
      name: 'Other Financial Reporting Salon',
      slug: 'other-financial-reporting-salon',
    },
  ]);

  const appointment = (
    id: string,
    values: Partial<typeof schema.appointmentSchema.$inferInsert>,
    salonId = SALON_ID,
  ): typeof schema.appointmentSchema.$inferInsert => {
    const startTime = values.startTime ?? new Date('2026-07-15T16:00:00.000Z');
    return {
      id,
      salonId,
      clientPhone: salonId === SALON_ID ? '4165550700' : '4165550799',
      startTime,
      endTime: new Date(startTime.getTime() + 3_600_000),
      totalPrice: 5000,
      totalDurationMinutes: 60,
      invoiceCurrency: 'CAD',
      ...values,
    };
  };

  await testDb.insert(schema.appointmentSchema).values([
    appointment('report_finalized_today', {
      status: 'completed',
      completedAt: new Date('2026-07-15T17:00:00.000Z'),
      totalPrice: 10000,
      finalPriceCents: 8000,
      finalDiscountCents: 2000,
      taxAmountCents: 1040,
      taxableSubtotalCents: 8000,
      taxExempt: false,
      taxExemptReason: null,
      tipCents: 500,
      amountPaidCents: 4000,
      paymentStatus: 'partially_paid',
      invoiceCurrency: 'CAD',
      finalTaxSnapshot: buildFinalTaxSnapshot({
        taxConfig: resolveTaxConfig({
          payments: {
            tax: {
              enabled: true,
              name: 'HST',
              rateBps: 1300,
              pricesIncludeTax: false,
              jurisdiction: 'Ontario HST',
              country: 'CA',
              region: 'ON',
            },
          },
        }, new Date('2026-07-15T17:00:00.000Z')),
        totals: {
          taxApplied: true,
          taxableSubtotalCents: 8000,
          taxAmountCents: 1040,
          finalPriceCents: 8000,
        },
        capturedAt: new Date('2026-07-15T17:00:00.000Z'),
        currency: 'CAD',
      }),
    }),
    appointment('report_legacy_week', {
      startTime: new Date('2026-07-14T16:00:00.000Z'),
      status: 'completed',
      completedAt: new Date('2026-07-14T17:00:00.000Z'),
      totalPrice: 6000,
      finalPriceCents: null,
      amountPaidCents: 2000,
      paymentStatus: 'partially_paid',
    }),
    appointment('report_legacy_paid_without_ledger', {
      startTime: new Date('2026-07-13T16:00:00.000Z'),
      status: 'completed',
      completedAt: new Date('2026-07-13T17:00:00.000Z'),
      totalPrice: 5000,
      finalPriceCents: null,
      amountPaidCents: null,
      paymentStatus: 'paid',
    }),
    appointment('report_unresolved_today', {
      startTime: new Date('2026-07-15T17:00:00.000Z'),
      status: 'completed',
      completedAt: new Date('2026-07-15T17:30:00.000Z'),
      totalPrice: 7000,
      finalPriceCents: -1,
      amountPaidCents: null,
      paymentStatus: 'pending',
    }),
    appointment('report_cache_only_positive', {
      startTime: new Date('2026-06-10T16:00:00.000Z'),
      status: 'completed',
      completedAt: new Date('2026-06-10T17:00:00.000Z'),
      totalPrice: 3000,
      finalPriceCents: 3000,
      amountPaidCents: 1000,
      paymentStatus: 'partially_paid',
    }),
    appointment('report_explicit_zero_paid', {
      startTime: new Date('2026-06-11T16:00:00.000Z'),
      status: 'completed',
      completedAt: new Date('2026-06-11T17:00:00.000Z'),
      totalPrice: 2500,
      finalPriceCents: 2500,
      amountPaidCents: 0,
      paymentStatus: 'pending',
    }),
    appointment('report_overpaid_completed', {
      startTime: new Date('2026-06-12T16:00:00.000Z'),
      status: 'completed',
      completedAt: new Date('2026-06-12T17:00:00.000Z'),
      totalPrice: 2000,
      finalPriceCents: 2000,
      amountPaidCents: 3000,
      paymentStatus: 'paid',
    }),
    appointment('report_deleted_today', {
      status: 'completed',
      finalPriceCents: 10000,
      deletedAt: new Date('2026-07-15T17:30:00.000Z'),
      paymentStatus: 'paid',
    }),
    appointment('report_comp_today', {
      status: 'completed',
      finalPriceCents: 9000,
      paymentStatus: 'comp',
    }),
    appointment('report_cancelled_today', {
      status: 'cancelled',
      finalPriceCents: 9000,
      paymentStatus: 'paid',
    }),
    appointment('report_no_show_today', {
      status: 'no_show',
      finalPriceCents: 9000,
      paymentStatus: 'paid',
    }),
    appointment('report_upcoming', {
      startTime: new Date('2026-07-20T16:00:00.000Z'),
      status: 'confirmed',
      totalPrice: 12000,
      amountPaidCents: 3000,
      paymentStatus: 'partially_paid',
    }),
    appointment('report_upcoming_overpaid', {
      startTime: new Date('2026-07-21T16:00:00.000Z'),
      status: 'confirmed',
      totalPrice: 2000,
      amountPaidCents: 3000,
      paymentStatus: 'paid',
    }),
    appointment('report_other_tenant', {
      status: 'completed',
      finalPriceCents: 50000,
      amountPaidCents: 9999,
      paymentStatus: 'partially_paid',
    }, OTHER_SALON_ID),
  ]);

  await testDb.insert(schema.appointmentPaymentSchema).values([
    {
      id: 'payment_finalized',
      appointmentId: 'report_finalized_today',
      salonId: SALON_ID,
      amountCents: 4000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-15T17:30:00.000Z'),
    },
    {
      id: 'payment_voided',
      appointmentId: 'report_finalized_today',
      salonId: SALON_ID,
      amountCents: 999,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-15T17:40:00.000Z'),
      voidedAt: new Date('2026-07-15T17:50:00.000Z'),
    },
    {
      id: 'payment_legacy',
      appointmentId: 'report_legacy_week',
      salonId: SALON_ID,
      amountCents: 2000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-14T17:30:00.000Z'),
    },
    {
      id: 'payment_upcoming',
      appointmentId: 'report_upcoming',
      salonId: SALON_ID,
      amountCents: 3000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-15T17:45:00.000Z'),
    },
    {
      id: 'payment_overpaid_completed',
      appointmentId: 'report_overpaid_completed',
      salonId: SALON_ID,
      amountCents: 3000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-06-12T17:30:00.000Z'),
    },
    {
      id: 'payment_upcoming_overpaid',
      appointmentId: 'report_upcoming_overpaid',
      salonId: SALON_ID,
      amountCents: 3000,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-10T17:30:00.000Z'),
    },
    {
      id: 'payment_other_tenant',
      appointmentId: 'report_other_tenant',
      salonId: OTHER_SALON_ID,
      amountCents: 9999,
      recordedByType: 'admin',
      recordedAt: new Date('2026-07-15T17:30:00.000Z'),
    },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('financial reporting range aggregation', () => {
  it('keeps finalized, legacy, and unresolved revenue provenance explicit', async () => {
    const summary = await getFinancialReportingRangeSummary({
      salonId: SALON_ID,
      currency: 'CAD',
      start: new Date('2026-07-13T04:00:00.000Z'),
      end: NOW,
    });

    expect(summary.completedAppointmentRevenueCents).toBe(19000);
    expect(summary.completedAppointmentCount).toBe(4);
    expect(summary.provenance).toEqual({
      mode: 'mixed',
      finalizedAppointmentCount: 1,
      legacyAppointmentCount: 2,
      unresolvedAppointmentCount: 1,
      finalizedAmountCents: 8000,
      legacyFallbackAmountCents: 11000,
      isEstimated: true,
    });
    expect(summary).toMatchObject({
      cashCollectedCents: 9000,
      tipsCents: 500,
      taxCents: 1040,
      taxableSubtotalCents: 8000,
      unresolvedActualTaxIdentityCount: 0,
      discountsCents: 2000,
    });
    expect(summary.actualTaxIdentityBuckets).toEqual([
      expect.objectContaining({
        schemaVersion: 1,
        classification: 'actual',
        label: 'HST',
        rateBps: 1300,
        mode: 'added',
        configurationSource: 'base',
        configurationEffectiveFrom: null,
        taxApplied: true,
        taxExempt: false,
        appointmentCount: 1,
        serviceSubtotalCents: 8000,
        taxableSubtotalCents: 8000,
        taxCents: 1040,
      }),
    ]);
  });

  it('keeps legacy scalar tax out of actual tax while disclosing its missing identity', async () => {
    const id = 'report_legacy_scalar_tax';
    try {
      await testDb.insert(schema.appointmentSchema).values({
        id,
        salonId: SALON_ID,
        clientPhone: '4165550890',
        startTime: new Date('2026-07-15T16:15:00.000Z'),
        endTime: new Date('2026-07-15T17:15:00.000Z'),
        totalDurationMinutes: 60,
        totalPrice: 6000,
        status: 'completed',
        completedAt: new Date('2026-07-15T17:15:00.000Z'),
        finalPriceCents: 6000,
        taxableSubtotalCents: 6000,
        taxAmountCents: 780,
        invoiceCurrency: 'CAD',
        paymentStatus: 'pending',
      });

      const summary = await getFinancialReportingRangeSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        start: new Date('2026-07-13T04:00:00.000Z'),
        end: NOW,
      });

      expect(summary.completedAppointmentRevenueCents).toBe(25000);
      expect(summary.taxCents).toBe(1040);
      expect(summary.unresolvedActualTaxIdentityCount).toBe(1);
      expect(summary.actualTaxIdentityBuckets).toHaveLength(1);
    } finally {
      await testDb.delete(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, id));
    }
  });

  it('uses payment recordedAt for cash while revenue uses appointment startTime', async () => {
    const summary = await getFinancialReportingRangeSummary({
      salonId: SALON_ID,
      currency: 'CAD',
      start: new Date('2026-07-15T04:00:00.000Z'),
      end: NOW,
    });

    // Includes the payment toward the future appointment, but not Tuesday's
    // legacy payment. Voided payment rows never count.
    expect(summary.cashCollectedCents).toBe(7000);
    expect(summary.completedAppointmentRevenueCents).toBe(8000);
    expect(summary.provenance).toMatchObject({
      mode: 'finalized',
      unresolvedAppointmentCount: 1,
      isEstimated: true,
    });
  });

  it('tenant-scopes appointment and payment aggregates independently', async () => {
    const summary = await getFinancialReportingRangeSummary({
      salonId: OTHER_SALON_ID,
      currency: 'CAD',
      start: new Date('2026-07-15T04:00:00.000Z'),
      end: NOW,
    });

    expect(summary.completedAppointmentRevenueCents).toBe(50000);
    expect(summary.cashCollectedCents).toBe(9999);
    expect(summary.provenance.mode).toBe('finalized');
  });

  it('never mixes CAD, USD, or unknown money in revenue, collection, and balance aggregates', async () => {
    const usdId = 'report_currency_usd';
    const unknownId = 'report_currency_unknown';
    const usdPhone = '4165550891';
    const unknownPhone = '4165550892';
    try {
      await testDb.insert(schema.appointmentSchema).values([
        {
          id: usdId,
          salonId: SALON_ID,
          clientPhone: usdPhone,
          startTime: new Date('2026-07-15T16:00:00.000Z'),
          endTime: new Date('2026-07-15T17:00:00.000Z'),
          status: 'completed',
          completedAt: new Date('2026-07-15T17:00:00.000Z'),
          totalPrice: 12000,
          finalPriceCents: 12000,
          taxAmountCents: 0,
          tipCents: 0,
          amountPaidCents: 5000,
          paymentStatus: 'partially_paid',
          totalDurationMinutes: 60,
          invoiceCurrency: 'USD',
        },
        {
          id: unknownId,
          salonId: SALON_ID,
          clientPhone: unknownPhone,
          startTime: new Date('2026-07-15T16:30:00.000Z'),
          endTime: new Date('2026-07-15T17:30:00.000Z'),
          status: 'completed',
          completedAt: new Date('2026-07-15T17:30:00.000Z'),
          totalPrice: 7000,
          finalPriceCents: 7000,
          taxAmountCents: 0,
          tipCents: 0,
          amountPaidCents: 3000,
          paymentStatus: 'partially_paid',
          totalDurationMinutes: 60,
          invoiceCurrency: null,
        },
      ]);
      await testDb.insert(schema.appointmentPaymentSchema).values([
        {
          id: 'payment_currency_usd',
          appointmentId: usdId,
          salonId: SALON_ID,
          amountCents: 5000,
          recordedByType: 'admin',
          recordedAt: new Date('2026-07-15T17:15:00.000Z'),
        },
        {
          id: 'payment_currency_unknown',
          appointmentId: unknownId,
          salonId: SALON_ID,
          amountCents: 3000,
          recordedByType: 'admin',
          recordedAt: new Date('2026-07-15T17:20:00.000Z'),
        },
      ]);
      const cad = await getFinancialReportingRangeSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        start: new Date('2026-07-15T04:00:00.000Z'),
        end: NOW,
      });

      expect(cad.completedAppointmentRevenueCents).toBe(8000);
      expect(cad.appointmentPaymentsCollectedCents).toBe(7000);
      expect(cad.depositCollectedCents).toBe(0);
      expect(cad).toMatchObject({
        unknownCurrencyAppointmentCount: 1,
        excludedForeignCurrencyAppointmentCount: 1,
        unknownCurrencyPaymentEventCount: 1,
        excludedForeignCurrencyPaymentEventCount: 1,
        excludedForeignCurrencyDepositEventCount: 0,
      });
      // Currency-excluded completed rows are disclosed through provenance:
      // the range total is real money the summary did not represent, so it
      // must never present itself as an exact, complete aggregate.
      expect(cad.provenance.unresolvedAppointmentCount)
        .toBeGreaterThanOrEqual(2);
      expect(cad.provenance.isEstimated).toBe(true);

      const usd = await getFinancialReportingRangeSummary({
        salonId: SALON_ID,
        currency: 'USD',
        start: new Date('2026-07-15T04:00:00.000Z'),
        end: NOW,
      });

      expect(usd.completedAppointmentRevenueCents).toBe(12000);
      expect(usd.appointmentPaymentsCollectedCents).toBe(5000);
      expect(usd.depositCollectedCents).toBe(0);
      // The USD view likewise discloses the completed money it excluded
      // (the unknown-currency row and every CAD completion).
      expect(usd.provenance.isEstimated).toBe(true);

      const cadBalance = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: [usdPhone, unknownPhone],
      });

      expect(cadBalance.completedOutstandingCents).toBe(0);
      expect(cadBalance).toMatchObject({
        unknownCurrencyAppointmentCount: 1,
        excludedForeignCurrencyAppointmentCount: 1,
      });

      const usdBalance = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'USD',
        asOf: NOW,
        clientPhoneVariants: [usdPhone],
      });

      expect(usdBalance.completedOutstandingCents).toBe(7000);
    } finally {
      await testDb.delete(schema.appointmentDepositSchema)
        .where(eq(schema.appointmentDepositSchema.appointmentId, usdId));
      await testDb.delete(schema.appointmentPaymentSchema).where(
        sql`${schema.appointmentPaymentSchema.appointmentId} IN (${usdId}, ${unknownId})`,
      );
      await testDb.delete(schema.appointmentSchema).where(
        sql`${schema.appointmentSchema.id} IN (${usdId}, ${unknownId})`,
      );
    }
  });

  it('buckets explicit deposit events, preserves unknown dates, and reports forfeiture reversals separately', async () => {
    const ids = {
      applied: 'report_deposit_applied',
      fullyTenderedLateDeposit: 'report_fully_tendered_late_deposit',
      compLateDeposit: 'report_comp_late_deposit',
      refunded: 'report_deposit_refunded',
      forfeitedRefunded: 'report_deposit_forfeited_refunded',
      invalidForfeiture: 'report_deposit_invalid_forfeiture',
      historical: 'report_deposit_historical_unknown',
      mismatch: 'report_deposit_currency_mismatch',
    } as const;
    const forfeitedAt = new Date('2026-07-15T16:45:00.000Z');
    const forfeitureTaxSnapshot = buildForfeitureTaxSnapshot({
      taxConfig: resolveTaxConfig({
        payments: {
          tax: {
            enabled: true,
            name: 'HST',
            rateBps: 1300,
            forfeitureTaxEstimationEnabled: true,
            jurisdiction: 'Ontario HST',
            country: 'CA',
            region: 'ON',
          },
        },
      }, forfeitedAt),
      grossForfeitedCents: 2500,
      capturedAt: forfeitedAt,
      currency: 'CAD',
      estimateTaxIncluded: true,
    });
    const invalidForfeitureTaxSnapshot = {
      ...forfeitureTaxSnapshot,
      configuration: {
        ...forfeitureTaxSnapshot.configuration,
        // Mutant guard: a plausible-looking snapshot with a stale identity
        // must not be accepted by reporting or balance projections.
        configurationIdentity: `${forfeitureTaxSnapshot.configuration.configurationIdentity}-stale`,
      },
    } as typeof forfeitureTaxSnapshot;
    const appointment = (
      id: string,
      phone: string,
      values: Partial<typeof schema.appointmentSchema.$inferInsert>,
    ): typeof schema.appointmentSchema.$inferInsert => ({
      id,
      salonId: SALON_ID,
      clientPhone: phone,
      startTime: new Date('2026-07-15T16:30:00.000Z'),
      endTime: new Date('2026-07-15T17:30:00.000Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
      invoiceCurrency: 'CAD',
      ...values,
    });

    const appointments = [
      appointment(ids.applied, '4165550801', {
        status: 'completed',
        completedAt: new Date('2026-07-15T17:30:00.000Z'),
        finalPriceCents: 4000,
        taxAmountCents: 520,
        tipCents: 1000,
        amountPaidCents: 0,
        paymentStatus: 'partially_paid',
      }),
      appointment(ids.fullyTenderedLateDeposit, '4165550807', {
        status: 'completed',
        completedAt: new Date('2026-07-15T17:30:00.000Z'),
        finalPriceCents: 10000,
        taxAmountCents: 0,
        tipCents: 0,
        amountPaidCents: 10000,
        paymentStatus: 'paid',
      }),
      appointment(ids.compLateDeposit, '4165550808', {
        status: 'completed',
        completedAt: new Date('2026-07-15T17:30:00.000Z'),
        finalPriceCents: 10000,
        taxAmountCents: 0,
        tipCents: 0,
        amountPaidCents: 0,
        paymentStatus: 'comp',
      }),
      appointment(ids.refunded, '4165550802', {
        status: 'confirmed',
        startTime: new Date('2026-07-20T16:00:00.000Z'),
        endTime: new Date('2026-07-20T17:00:00.000Z'),
        amountPaidCents: 0,
        paymentStatus: 'pending',
      }),
      appointment(ids.forfeitedRefunded, '4165550803', {
        status: 'no_show',
        paymentStatus: 'pending',
      }),
      appointment(ids.invalidForfeiture, '4165550806', {
        status: 'confirmed',
        startTime: new Date('2026-07-23T16:00:00.000Z'),
        endTime: new Date('2026-07-23T17:00:00.000Z'),
        amountPaidCents: 0,
        paymentStatus: 'pending',
      }),
      appointment(ids.historical, '4165550804', {
        status: 'confirmed',
        startTime: new Date('2026-07-21T16:00:00.000Z'),
        endTime: new Date('2026-07-21T17:00:00.000Z'),
        invoiceCurrency: null,
        amountPaidCents: 0,
        paymentStatus: 'pending',
      }),
      appointment(ids.mismatch, '4165550805', {
        status: 'confirmed',
        startTime: new Date('2026-07-22T16:00:00.000Z'),
        endTime: new Date('2026-07-22T17:00:00.000Z'),
        invoiceCurrency: 'USD',
        amountPaidCents: 0,
        paymentStatus: 'pending',
      }),
    ];

    try {
      await testDb.insert(schema.appointmentSchema).values(appointments);
      await testDb.insert(schema.appointmentDepositSchema).values([
        {
          id: 'dep_report_applied',
          salonId: SALON_ID,
          appointmentId: ids.applied,
          amountCents: 2500,
          currency: 'cad',
          status: 'paid',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_applied',
          collectedAt: new Date('2026-07-15T15:00:00.000Z'),
        },
        {
          id: 'dep_report_fully_tendered_late',
          salonId: SALON_ID,
          appointmentId: ids.fullyTenderedLateDeposit,
          amountCents: 2000,
          currency: 'cad',
          status: 'paid',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_fully_tendered_late',
          collectedAt: new Date('2026-07-12T15:00:00.000Z'),
        },
        {
          id: 'dep_report_comp_late',
          salonId: SALON_ID,
          appointmentId: ids.compLateDeposit,
          amountCents: 2000,
          currency: 'cad',
          status: 'paid',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_comp_late',
          collectedAt: new Date('2026-07-12T15:00:00.000Z'),
        },
        {
          id: 'dep_report_refunded',
          salonId: SALON_ID,
          appointmentId: ids.refunded,
          amountCents: 1000,
          currency: 'cad',
          status: 'refunded',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_refunded',
          collectedAt: new Date('2026-07-14T15:00:00.000Z'),
          stripeRefundId: 're_report_refunded',
          refundStatus: 'succeeded',
          refundAmountCents: 1000,
          refundedAt: new Date('2026-07-15T16:00:00.000Z'),
          refundStatusChangedAt: new Date('2026-07-15T16:00:00.000Z'),
        },
        {
          id: 'dep_report_forfeited_refunded',
          salonId: SALON_ID,
          appointmentId: ids.forfeitedRefunded,
          amountCents: 2500,
          currency: 'cad',
          status: 'refunded',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_forfeited_refunded',
          collectedAt: new Date('2026-07-13T15:00:00.000Z'),
          forfeitedAt,
          forfeitureTaxSnapshot,
          stripeRefundId: 'refund_report_forfeited_refunded',
          refundStatus: 'succeeded',
          refundAmountCents: 2500,
          refundedAt: new Date('2026-07-15T17:00:00.000Z'),
          refundStatusChangedAt: new Date('2026-07-15T17:00:00.000Z'),
        },
        {
          id: 'dep_report_invalid_forfeiture',
          salonId: SALON_ID,
          appointmentId: ids.invalidForfeiture,
          amountCents: 2500,
          currency: 'cad',
          status: 'paid',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_invalid_forfeiture',
          collectedAt: new Date('2026-07-12T15:00:00.000Z'),
          forfeitedAt,
          forfeitureTaxSnapshot: invalidForfeitureTaxSnapshot,
        },
        {
          id: 'dep_report_historical',
          salonId: SALON_ID,
          appointmentId: ids.historical,
          amountCents: 700,
          currency: 'cad',
          status: 'paid',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_historical',
          collectedAt: null,
        },
        {
          id: 'dep_report_currency_mismatch',
          salonId: SALON_ID,
          appointmentId: ids.mismatch,
          amountCents: 900,
          currency: 'cad',
          status: 'paid',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_currency_mismatch',
          collectedAt: new Date('2026-07-15T15:30:00.000Z'),
        },
      ]);
      await testDb.insert(schema.appointmentPaymentSchema).values({
        id: 'payment_report_fully_tendered_late',
        appointmentId: ids.fullyTenderedLateDeposit,
        salonId: SALON_ID,
        amountCents: 10000,
        recordedByType: 'admin',
        recordedAt: new Date('2026-07-12T16:00:00.000Z'),
      });
      const today = await getFinancialReportingRangeSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        start: new Date('2026-07-15T04:00:00.000Z'),
        end: NOW,
      });
      const week = await getFinancialReportingRangeSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        start: new Date('2026-07-13T04:00:00.000Z'),
        end: NOW,
      });

      expect(today).toMatchObject({
        appointmentPaymentsCollectedCents: 7000,
        depositCollectedCents: 2500,
        cashCollectedCents: 9500,
        depositRefundedCents: 3500,
        depositForfeitedCents: 2500,
        depositForfeitureEstimatedTaxCents: 288,
        depositForfeitureEstimatedNetCents: 2212,
        depositForfeitureRefundReversalCents: 2500,
        depositForfeitureTaxReversalCents: 288,
        depositForfeitureNetReversalCents: 2212,
        remainingBalancePaymentsCollectedCents: 7000,
        depositAppliedCents: 2500,
        unresolvedDepositApplicationCount: 2,
        unattributedDepositEventCount: 1,
        unresolvedDepositEventCount: 2,
      });
      expect(today.forfeitureTaxIdentityBuckets).toEqual([
        expect.objectContaining({
          schemaVersion: 1,
          classification: 'estimate',
          label: 'HST',
          rateBps: 1300,
          mode: 'added',
          configurationEffectiveFrom: null,
          configurationSource: 'base',
          grossForfeitedCents: 2500,
          estimatedTaxIncludedCents: 288,
          estimatedNetCents: 2212,
          refundReversalCents: 2500,
          estimatedTaxReversalCents: 288,
          estimatedNetReversalCents: 2212,
        }),
      ]);
      expect(week.depositCollectedCents).toBe(6000);

      const appliedBalance = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550801'],
      });
      const refundedBalance = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550802'],
      });
      const unknownBalance = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550804'],
      });
      const invalidForfeitureBalance = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550806'],
      });

      expect(appliedBalance.completedOutstandingCents).toBe(3020);
      expect(refundedBalance.upcomingBalanceCents).toBe(5000);
      expect(unknownBalance.upcomingBalanceCents).toBe(0);
      expect(unknownBalance.unresolvedUpcomingAppointmentCount).toBe(0);
      expect(unknownBalance.unknownCurrencyAppointmentCount).toBe(1);
      expect(invalidForfeitureBalance.upcomingBalanceCents).toBe(0);
      expect(invalidForfeitureBalance.unresolvedUpcomingAppointmentCount).toBe(1);
    } finally {
      await testDb.delete(schema.appointmentPaymentSchema).where(
        sql`${schema.appointmentPaymentSchema.appointmentId} IN (${sql.join(
          Object.values(ids).map(id => sql`${id}`),
          sql`, `,
        )})`,
      );
      await testDb.delete(schema.appointmentDepositSchema).where(
        sql`${schema.appointmentDepositSchema.appointmentId} IN (${sql.join(
          Object.values(ids).map(id => sql`${id}`),
          sql`, `,
        )})`,
      );
      await testDb.delete(schema.appointmentSchema).where(
        sql`${schema.appointmentSchema.id} IN (${sql.join(
          Object.values(ids).map(id => sql`${id}`),
          sql`, `,
        )})`,
      );
    }
  });
});

describe('financial balance aggregation', () => {
  it('uses frozen booking tax and blocks malformed snapshot math', async () => {
    const taxedId = 'report_upcoming_taxed_deposit';
    const malformedId = 'report_upcoming_malformed_tax';
    const bookingSnapshot = buildBookingTaxSnapshot({
      taxConfig: resolveTaxConfig({
        payments: {
          tax: {
            enabled: true,
            name: 'HST',
            rateBps: 1300,
            pricesIncludeTax: false,
            jurisdiction: 'Ontario',
            country: 'Canada',
            region: 'ON',
          },
        },
      }, new Date('2026-07-15T12:00:00.000Z')),
      totals: {
        taxApplied: true,
        taxableSubtotalCents: 10000,
        taxAmountCents: 1300,
        finalPriceCents: 10000,
      },
      capturedAt: new Date('2026-07-15T12:00:00.000Z'),
      currency: 'CAD',
    });

    try {
      await testDb.insert(schema.appointmentSchema).values([
        {
          id: taxedId,
          salonId: SALON_ID,
          clientPhone: '4165550810',
          startTime: new Date('2026-07-20T16:00:00.000Z'),
          endTime: new Date('2026-07-20T17:00:00.000Z'),
          status: 'confirmed',
          totalPrice: 10000,
          totalDurationMinutes: 60,
          amountPaidCents: 0,
          paymentStatus: 'partially_paid',
          invoiceCurrency: 'CAD',
          bookingTaxSnapshot: bookingSnapshot,
        },
        {
          id: malformedId,
          salonId: SALON_ID,
          clientPhone: '4165550811',
          startTime: new Date('2026-07-20T16:00:00.000Z'),
          endTime: new Date('2026-07-20T17:00:00.000Z'),
          status: 'confirmed',
          totalPrice: 10000,
          totalDurationMinutes: 60,
          amountPaidCents: 0,
          paymentStatus: 'partially_paid',
          invoiceCurrency: 'CAD',
          bookingTaxSnapshot: {
            ...bookingSnapshot,
            invoiceTotalCents: 10000,
          },
        },
      ]);
      await testDb.insert(schema.appointmentDepositSchema).values([
        {
          id: 'dep_report_upcoming_taxed',
          salonId: SALON_ID,
          appointmentId: taxedId,
          amountCents: 2500,
          currency: 'cad',
          status: 'paid',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_upcoming_taxed',
          collectedAt: new Date('2026-07-15T15:00:00.000Z'),
        },
        {
          id: 'dep_report_upcoming_malformed',
          salonId: SALON_ID,
          appointmentId: malformedId,
          amountCents: 500,
          currency: 'cad',
          status: 'paid',
          stripeAccountId: 'acct_reporting',
          stripePaymentIntentId: 'pi_report_upcoming_malformed',
          collectedAt: new Date('2026-07-15T15:00:00.000Z'),
        },
      ]);

      const taxed = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550810'],
      });
      const malformed = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550811'],
      });

      // Mutant guard: using total_price would incorrectly report $75.00.
      expect(taxed.upcomingBalanceCents).toBe(8800);
      expect(taxed.unresolvedUpcomingAppointmentCount).toBe(0);
      expect(malformed.upcomingBalanceCents).toBe(0);
      expect(malformed.unresolvedUpcomingAppointmentCount).toBe(1);
    } finally {
      await testDb.delete(schema.appointmentDepositSchema).where(
        sql`${schema.appointmentDepositSchema.appointmentId} IN (${taxedId}, ${malformedId})`,
      );
      await testDb.delete(schema.appointmentSchema).where(
        sql`${schema.appointmentSchema.id} IN (${taxedId}, ${malformedId})`,
      );
    }
  });

  it('separates completed debt, future balance, and unsupported deposits', async () => {
    const summary = await getFinancialBalanceSummary({
      salonId: SALON_ID,
      currency: 'CAD',
      asOf: NOW,
    });

    // Finalized: 8000 + 1040 + 500 - 4000 = 5540.
    // Legacy with initialized payment tracking: 6000 - 2000 = 4000.
    // An explicit cached zero is initialized payment tracking and contributes
    // 2500. A positive cache with no underlying rows is unresolved.
    expect(summary.completedOutstandingCents).toBe(12040);
    expect(summary.upcomingBalanceCents).toBe(9000);
    expect(summary.upcomingAppointmentCount).toBe(1);
    expect(summary.unresolvedUpcomingAppointmentCount).toBe(1);
    expect(summary.depositDue).toEqual({
      supported: false,
      amountCents: null,
      reason: 'Per-appointment deposit obligations are not recorded.',
    });
    expect(summary.completedOutstandingProvenance).toMatchObject({
      mode: 'mixed',
      finalizedAppointmentCount: 2,
      legacyAppointmentCount: 2,
      unresolvedAppointmentCount: 3,
      finalizedAmountCents: 8040,
      legacyFallbackAmountCents: 4000,
      isEstimated: true,
    });
  });

  it('treats paid legacy rows without a ledger as settled, not fabricated debt', async () => {
    const summary = await getFinancialBalanceSummary({
      salonId: SALON_ID,
      currency: 'CAD',
      asOf: NOW,
    });

    expect(summary.settledByLegacyPaymentStatusCount).toBe(1);
    expect(summary.completedOutstandingCents).toBe(12040);
  });

  it('fails closed on excess completed or future tender without offsetting other rows', async () => {
    const summary = await getFinancialBalanceSummary({
      salonId: SALON_ID,
      currency: 'CAD',
      asOf: NOW,
    });

    // The two overpaid rows contribute zero independently; neither can offset
    // the real debt from another appointment, and both remain under review.
    expect(summary.completedOutstandingCents).toBe(12040);
    expect(summary.upcomingBalanceCents).toBe(9000);
    expect(summary.completedOutstandingProvenance.unresolvedAppointmentCount).toBe(3);
    expect(summary.unresolvedUpcomingAppointmentCount).toBe(1);
  });

  it('keeps set-based balance SQL unresolved when tracked tender exceeds the invoice', async () => {
    const balance = buildFinancialBalanceSql(NOW);
    const rows = await testDb
      .select({
        id: schema.appointmentSchema.id,
        unresolved: balance.completedUnresolved,
      })
      .from(schema.appointmentSchema)
      .where(sql`${schema.appointmentSchema.id} IN (
        'report_overpaid_completed',
        'report_explicit_zero_paid'
      )`);
    const byId = new Map(rows.map(row => [row.id, row.unresolved]));

    expect(byId.get('report_overpaid_completed')).toBe(true);
    expect(byId.get('report_explicit_zero_paid')).toBe(false);
  });

  it('loads cross-tenant payment children and blocks both balance and deposit application', async () => {
    const appointmentId = 'report_dirty_payment_tenant';
    const paymentId = 'payment_report_dirty_tenant';
    const depositId = 'deposit_report_dirty_tenant';
    await testDb.insert(schema.appointmentSchema).values({
      id: appointmentId,
      salonId: SALON_ID,
      clientPhone: '4165550890',
      startTime: new Date('2026-07-14T16:00:00.000Z'),
      endTime: new Date('2026-07-14T17:00:00.000Z'),
      status: 'completed',
      completedAt: new Date('2026-07-14T17:00:00.000Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
      finalPriceCents: 5000,
      amountPaidCents: null,
      paymentStatus: 'paid',
      invoiceCurrency: 'CAD',
    });
    await testDb.insert(schema.appointmentDepositSchema).values({
      id: depositId,
      salonId: SALON_ID,
      appointmentId,
      amountCents: 1000,
      currency: 'cad',
      status: 'paid',
      stripeAccountId: 'acct_dirty_tenant',
      stripePaymentIntentId: 'pi_dirty_tenant',
      collectedAt: new Date('2026-07-14T15:00:00.000Z'),
    });
    await testDb.execute(sql.raw(
      'ALTER TABLE appointment_payment DISABLE TRIGGER ALL',
    ));
    try {
      await testDb.insert(schema.appointmentPaymentSchema).values({
        id: paymentId,
        appointmentId,
        salonId: OTHER_SALON_ID,
        amountCents: 4000,
        recordedByType: 'admin',
        recordedAt: new Date('2026-07-14T17:00:00.000Z'),
      });
    } finally {
      await testDb.execute(sql.raw(
        'ALTER TABLE appointment_payment ENABLE TRIGGER ALL',
      ));
    }

    try {
      const balance = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550890'],
      });
      const range = await getFinancialReportingRangeSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        start: new Date('2026-07-14T04:00:00.000Z'),
        end: NOW,
      });

      expect(balance.completedOutstandingCents).toBe(0);
      expect(balance.completedOutstandingProvenance.unresolvedAppointmentCount).toBe(1);
      expect(balance.settledByLegacyPaymentStatusCount).toBe(0);
      // Other valid payments in this shared fixture total $90. The dirty $40
      // child is disclosed but contributes zero cash.
      expect(range.appointmentPaymentsCollectedCents).toBe(9000);
      expect(range.unattributedPaymentEventCount).toBe(1);
      expect(range.depositAppliedCents).toBe(0);
      expect(range.unresolvedDepositApplicationCount).toBeGreaterThanOrEqual(1);
    } finally {
      await testDb.delete(schema.appointmentPaymentSchema).where(
        eq(schema.appointmentPaymentSchema.id, paymentId),
      );
      await testDb.delete(schema.appointmentDepositSchema).where(
        eq(schema.appointmentDepositSchema.id, depositId),
      );
      await testDb.delete(schema.appointmentSchema).where(
        eq(schema.appointmentSchema.id, appointmentId),
      );
    }
  });

  it('counts a completed appointment with unknown frozen currency as unresolved', async () => {
    const appointmentId = 'report_completed_unknown_currency';
    await testDb.insert(schema.appointmentSchema).values({
      id: appointmentId,
      salonId: SALON_ID,
      clientPhone: '4165550891',
      startTime: new Date('2026-07-14T16:00:00.000Z'),
      endTime: new Date('2026-07-14T17:00:00.000Z'),
      status: 'completed',
      completedAt: new Date('2026-07-14T17:00:00.000Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
      finalPriceCents: 5000,
      amountPaidCents: 0,
      paymentStatus: 'pending',
      invoiceCurrency: null,
    });

    try {
      const balance = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550891'],
      });
      const rows = await getCompletedOutstandingRows({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
      });

      expect(balance.unknownCurrencyAppointmentCount).toBe(1);
      expect(balance.completedOutstandingProvenance.unresolvedAppointmentCount).toBe(1);
      expect(rows).toContainEqual(expect.objectContaining({
        appointmentId,
        financialState: 'under_review',
      }));
    } finally {
      await testDb.delete(schema.appointmentSchema).where(
        eq(schema.appointmentSchema.id, appointmentId),
      );
    }
  });

  it('exposes the same tenant-scoped, per-appointment completed balances for segmentation', async () => {
    const rows = await getCompletedOutstandingRows({
      salonId: SALON_ID,
      currency: 'CAD',
      asOf: NOW,
    });
    const byPhone = new Map(
      rows.map(row => [row.clientPhone, row.completedOutstandingCents]),
    );

    expect(
      rows.reduce((sum, row) => sum + row.completedOutstandingCents, 0),
    ).toBe(12040);
    expect(byPhone.has('4165550799')).toBe(false);
    expect(rows.some(row =>
      row.clientPhone === '4165550700'
      && row.completedOutstandingCents === 0)).toBe(true);
  });

  it('can scope completed outstanding to one client without weakening tenant scope', async () => {
    await testDb.insert(schema.appointmentSchema).values({
      id: 'report_same_salon_other_client',
      salonId: SALON_ID,
      clientPhone: '4165550711',
      startTime: new Date('2026-07-12T16:00:00.000Z'),
      endTime: new Date('2026-07-12T17:00:00.000Z'),
      totalPrice: 7000,
      finalPriceCents: 7000,
      amountPaidCents: 0,
      paymentStatus: 'pending',
      status: 'completed',
      totalDurationMinutes: 60,
      invoiceCurrency: 'CAD',
    });

    try {
      const primaryClient = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550700', '+14165550700'],
      });
      const otherClient = await getFinancialBalanceSummary({
        salonId: SALON_ID,
        currency: 'CAD',
        asOf: NOW,
        clientPhoneVariants: ['4165550711'],
      });

      expect(primaryClient.completedOutstandingCents).toBe(12040);
      expect(otherClient.completedOutstandingCents).toBe(7000);
    } finally {
      await testDb
        .delete(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, 'report_same_salon_other_client'));
    }
  });
});

describe('current salon-local summaries', () => {
  it('uses salon-local today, Monday week-to-date, and month-to-date ranges', () => {
    expect(getCurrentFinancialReportingRanges('America/Toronto', NOW)).toEqual({
      today: {
        start: new Date('2026-07-15T04:00:00.000Z'),
        end: NOW,
      },
      weekToDate: {
        start: new Date('2026-07-13T04:00:00.000Z'),
        end: NOW,
      },
      monthToDate: {
        start: new Date('2026-07-01T04:00:00.000Z'),
        end: NOW,
      },
    });
  });

  it('loads all current owner periods and one point-in-time balance summary', async () => {
    const summaries = await getCurrentFinancialReportingSummaries({
      salonId: SALON_ID,
      currency: 'CAD',
      timeZone: 'America/Toronto',
      now: NOW,
    });

    expect(summaries.today.completedAppointmentRevenueCents).toBe(8000);
    expect(summaries.weekToDate.completedAppointmentRevenueCents).toBe(19000);
    expect(summaries.monthToDate.completedAppointmentRevenueCents).toBe(19000);
    expect(summaries.balances.completedOutstandingCents).toBe(12040);
    expect(summaries.generatedAt).toEqual(NOW);
    expect(summaries.timeZone).toBe('America/Toronto');
  });
});

describe('financial reporting input validation', () => {
  it('rejects empty tenant identifiers and invalid ranges before querying', async () => {
    await expect(getFinancialReportingRangeSummary({
      salonId: ' ',
      currency: 'CAD',
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-07-02T00:00:00.000Z'),
    })).rejects.toThrow('salonId is required');

    await expect(getFinancialReportingRangeSummary({
      salonId: SALON_ID,
      currency: 'CAD',
      start: NOW,
      end: NOW,
    })).rejects.toThrow('Reporting range start must be before end');
  });
});
