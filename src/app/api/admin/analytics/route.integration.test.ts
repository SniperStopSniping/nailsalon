import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildFinalTaxSnapshot, resolveTaxConfig } from '@/libs/taxConfig';
import * as schema from '@/models/Schema';

import { GET } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async (slug: string) => {
    if (slug !== 'analytics-salon') {
      return {
        salon: null,
        error: Response.json(
          { error: { code: 'FORBIDDEN' } },
          { status: 403 },
        ),
      };
    }
    return {
      salon: {
        id: 'salon_analytics',
        slug,
        settings: {
          booking: {
            currency: 'USD',
            timezone: 'America/Toronto',
          },
        },
      },
      error: null,
    };
  }),
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403: vi.fn(async () => null),
}));

const SALON_ID = 'salon_analytics';
const finalizedAt = new Date('2026-06-15T15:00:00.000Z');

function finalTaxSnapshotAt(capturedAt: Date) {
  return buildFinalTaxSnapshot({
    taxConfig: resolveTaxConfig({
      payments: {
        tax: {
          enabled: true,
          name: 'HST',
          rateBps: 1300,
          jurisdiction: 'Ontario',
          country: 'CA',
          region: 'ON',
        },
      },
    }, capturedAt),
    totals: {
      taxApplied: true,
      taxableSubtotalCents: 10000,
      taxAmountCents: 1300,
      finalPriceCents: 10000,
    },
    capturedAt,
    currency: 'USD',
  });
}

const finalTaxSnapshot = finalTaxSnapshotAt(finalizedAt);

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), 'migrations'),
  });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Analytics Salon',
    slug: 'analytics-salon',
  });
  await db.insert(schema.technicianSchema).values({
    id: 'analytics_technician',
    salonId: SALON_ID,
    name: 'Alex',
  });
  await db.insert(schema.appointmentSchema).values([
    {
      id: 'analytics_finalized',
      salonId: SALON_ID,
      clientPhone: '4165550101',
      startTime: new Date('2026-06-15T14:00:00.000Z'),
      endTime: new Date('2026-06-15T15:00:00.000Z'),
      status: 'completed',
      completedAt: finalizedAt,
      totalPrice: 11000,
      totalDurationMinutes: 60,
      finalPriceCents: 10000,
      finalDiscountCents: 1000,
      taxAmountCents: 1300,
      taxableSubtotalCents: 10000,
      taxExempt: false,
      tipCents: 500,
      amountPaidCents: 6000,
      paymentStatus: 'partially_paid',
      invoiceCurrency: 'USD',
      finalTaxSnapshot,
      technicianId: 'analytics_technician',
    },
    {
      id: 'analytics_legacy',
      salonId: SALON_ID,
      clientPhone: '4165550102',
      startTime: new Date('2026-06-16T14:00:00.000Z'),
      endTime: new Date('2026-06-16T15:00:00.000Z'),
      status: 'completed',
      totalPrice: 4500,
      totalDurationMinutes: 60,
      paymentStatus: 'paid',
      invoiceCurrency: 'USD',
    },
    {
      id: 'analytics_comp',
      salonId: SALON_ID,
      clientPhone: '4165550103',
      startTime: new Date('2026-06-17T14:00:00.000Z'),
      endTime: new Date('2026-06-17T15:00:00.000Z'),
      status: 'completed',
      totalPrice: 7000,
      totalDurationMinutes: 60,
      finalPriceCents: 7000,
      tipCents: 900,
      paymentStatus: 'comp',
      invoiceCurrency: 'USD',
    },
    {
      id: 'analytics_deleted',
      salonId: SALON_ID,
      clientPhone: '4165550104',
      startTime: new Date('2026-06-18T14:00:00.000Z'),
      endTime: new Date('2026-06-18T15:00:00.000Z'),
      status: 'completed',
      totalPrice: 9000,
      totalDurationMinutes: 60,
      finalPriceCents: 9000,
      deletedAt: new Date('2026-06-19T14:00:00.000Z'),
      paymentStatus: 'paid',
      invoiceCurrency: 'USD',
    },
    {
      id: 'analytics_previous',
      salonId: SALON_ID,
      clientPhone: '4165550105',
      startTime: new Date('2026-05-15T14:00:00.000Z'),
      endTime: new Date('2026-05-15T15:00:00.000Z'),
      status: 'completed',
      totalPrice: 5000,
      totalDurationMinutes: 60,
      finalPriceCents: 5000,
      paymentStatus: 'paid',
      invoiceCurrency: 'USD',
    },
    {
      id: 'analytics_without_prior_period',
      salonId: SALON_ID,
      clientPhone: '4165550106',
      startTime: new Date('2026-04-15T14:00:00.000Z'),
      endTime: new Date('2026-04-15T15:00:00.000Z'),
      status: 'completed',
      totalPrice: 3000,
      totalDurationMinutes: 60,
      finalPriceCents: 3000,
      paymentStatus: 'paid',
      invoiceCurrency: 'USD',
    },
  ]);
  await db.insert(schema.appointmentPaymentSchema).values({
    id: 'analytics_payment',
    appointmentId: 'analytics_finalized',
    salonId: SALON_ID,
    amountCents: 6000,
    recordedByType: 'admin',
    recordedAt: new Date('2026-06-15T15:05:00.000Z'),
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('GET /api/admin/analytics reporting correctness', () => {
  it('separates finalized and legacy completed revenue without tax, tips, comp, or deleted rows', async () => {
    const response = await GET(new Request(
      'http://localhost/api/admin/analytics?salonSlug=analytics-salon&period=monthly&anchor=2026-06-15',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.currency).toBe('USD');
    expect(body.data.timeZone).toBe('America/Toronto');
    expect(body.data.revenue.total).toBe(14500);
    expect(body.data.revenue.tips).toBe(500);
    expect(body.data.revenue.taxCollected).toBe(1300);
    expect(body.data.revenue.discounts).toBe(1000);
    expect(body.data.revenue.completed).toBe(2);
    expect(body.data.revenue.provenance).toEqual({
      mode: 'mixed',
      finalizedAppointmentCount: 1,
      legacyAppointmentCount: 1,
      unresolvedAppointmentCount: 0,
      finalizedAmountCents: 10000,
      legacyFallbackAmountCents: 4500,
      isEstimated: true,
    });
    expect(body.data.revenue.series.reduce(
      (sum: number, value: number) => sum + value,
      0,
    )).toBe(14500);
    expect(body.data.staff[0]).toMatchObject({
      id: 'analytics_technician',
      revenue: 10000,
      appointmentCount: 1,
    });
    expect(body.data.revenue.trend).toBe(190);
    expect(body.data.revenue.trendAvailable).toBe(true);
    expect(body.data.financials.selectedPeriod).toMatchObject({
      completedAppointmentRevenueCents: 14500,
      cashCollectedCents: 6000,
      discountsCents: 1000,
      taxCents: 1300,
      tipsCents: 500,
      completedAppointmentCount: 2,
    });
    expect(body.data.financials.balances).toMatchObject({
      completedOutstandingCents: 5800,
      upcomingBalanceCents: 0,
    });
    expect(body.data.financials.depositDue).toEqual({
      supported: false,
      amountCents: null,
      reason: 'Per-appointment deposit obligations are not recorded.',
    });
  });

  it('excludes a corrupt final snapshot from headline, chart, and technician revenue', async () => {
    const id = 'analytics_corrupt_final_snapshot';
    const corruptCompletedAt = new Date('2026-06-20T15:00:00.000Z');
    const validFinalTaxSnapshot = finalTaxSnapshotAt(corruptCompletedAt);
    const corruptFinalTaxSnapshot = {
      ...validFinalTaxSnapshot,
      configuration: {
        ...validFinalTaxSnapshot.configuration,
        configurationIdentity: `${validFinalTaxSnapshot.configuration.configurationIdentity}-stale`,
      },
    } as typeof validFinalTaxSnapshot;
    try {
      await db.insert(schema.appointmentSchema).values({
        id,
        salonId: SALON_ID,
        clientPhone: '4165550199',
        technicianId: 'analytics_technician',
        startTime: new Date('2026-06-20T14:00:00.000Z'),
        endTime: new Date('2026-06-20T15:00:00.000Z'),
        status: 'completed',
        completedAt: corruptCompletedAt,
        totalPrice: 10000,
        totalDurationMinutes: 60,
        finalPriceCents: 10000,
        taxableSubtotalCents: 10000,
        taxAmountCents: 1300,
        taxExempt: false,
        invoiceCurrency: 'USD',
        paymentStatus: 'pending',
        finalTaxSnapshot: corruptFinalTaxSnapshot,
      });

      const response = await GET(new Request(
        'http://localhost/api/admin/analytics?salonSlug=analytics-salon&period=monthly&anchor=2026-06-15',
      ));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.revenue.total).toBe(14500);
      expect(body.data.revenue.provenance.unresolvedAppointmentCount).toBe(1);
      expect(body.data.revenue.series.reduce(
        (sum: number, value: number) => sum + value,
        0,
      )).toBe(14500);
      expect(body.data.staff[0]).toMatchObject({
        revenue: 10000,
        appointmentCount: 1,
      });
    } finally {
      await db.delete(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, id));
    }
  });

  it('does not fabricate a percentage when the prior period has no revenue', async () => {
    const response = await GET(new Request(
      'http://localhost/api/admin/analytics?salonSlug=analytics-salon&period=monthly&anchor=2026-04-15',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.revenue.total).toBe(3000);
    expect(body.data.revenue.trend).toBe(0);
    expect(body.data.revenue.trendAvailable).toBe(false);
  });

  it('enforces the existing admin salon boundary', async () => {
    const response = await GET(new Request(
      'http://localhost/api/admin/analytics?salonSlug=other-salon&period=monthly&anchor=2026-06-15',
    ));

    expect(response.status).toBe(403);
  });
});
