import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import {
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
      tipCents: 500,
      amountPaidCents: 4000,
      paymentStatus: 'partially_paid',
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
      discountsCents: 2000,
    });
  });

  it('uses payment recordedAt for cash while revenue uses appointment startTime', async () => {
    const summary = await getFinancialReportingRangeSummary({
      salonId: SALON_ID,
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
      start: new Date('2026-07-15T04:00:00.000Z'),
      end: NOW,
    });

    expect(summary.completedAppointmentRevenueCents).toBe(50000);
    expect(summary.cashCollectedCents).toBe(9999);
    expect(summary.provenance.mode).toBe('finalized');
  });
});

describe('financial balance aggregation', () => {
  it('separates completed debt, future balance, and unsupported deposits', async () => {
    const summary = await getFinancialBalanceSummary({
      salonId: SALON_ID,
      asOf: NOW,
    });

    // Finalized: 8000 + 1040 + 500 - 4000 = 5540.
    // Legacy with initialized payment tracking: 6000 - 2000 = 4000.
    // An explicit cached zero is initialized payment tracking and contributes
    // 2500. A positive cache with no underlying rows is unresolved.
    expect(summary.completedOutstandingCents).toBe(12040);
    expect(summary.upcomingBalanceCents).toBe(9000);
    expect(summary.upcomingAppointmentCount).toBe(2);
    expect(summary.depositDue).toEqual({
      supported: false,
      amountCents: null,
      reason: 'Per-appointment deposit obligations are not recorded.',
    });
    expect(summary.completedOutstandingProvenance).toMatchObject({
      mode: 'mixed',
      finalizedAppointmentCount: 3,
      legacyAppointmentCount: 2,
      unresolvedAppointmentCount: 2,
      finalizedAmountCents: 8040,
      legacyFallbackAmountCents: 4000,
      isEstimated: true,
    });
  });

  it('treats paid legacy rows without a ledger as settled, not fabricated debt', async () => {
    const summary = await getFinancialBalanceSummary({
      salonId: SALON_ID,
      asOf: NOW,
    });

    expect(summary.settledByLegacyPaymentStatusCount).toBe(1);
    expect(summary.completedOutstandingCents).toBe(12040);
  });

  it('clamps overpaid completed and future appointments per row', async () => {
    const summary = await getFinancialBalanceSummary({
      salonId: SALON_ID,
      asOf: NOW,
    });

    // The two overpaid rows contribute zero independently; neither can offset
    // the real debt from another appointment in the salon aggregate.
    expect(summary.completedOutstandingCents).toBe(12040);
    expect(summary.upcomingBalanceCents).toBe(9000);
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
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-07-02T00:00:00.000Z'),
    })).rejects.toThrow('salonId is required');

    await expect(getFinancialReportingRangeSummary({
      salonId: SALON_ID,
      start: NOW,
      end: NOW,
    })).rejects.toThrow('Reporting range start must be before end');
  });
});
