import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { zonedTimeToUtc } from '@/libs/timeZone';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  /** When set, requireAdminSalon returns this error instead of the salon. */
  adminError: null as Response | null,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async (salonSlug: string) => {
    if (holder.adminError) {
      return { error: holder.adminError, salon: null };
    }
    const db = holder.db as any;
    const { eq: eqOp } = await import('drizzle-orm');
    const schemaModule = await import('@/models/Schema');
    const [salon] = await db
      .select()
      .from(schemaModule.salonSchema)
      .where(eqOp(schemaModule.salonSchema.slug, salonSlug))
      .limit(1);
    if (!salon) {
      return {
        error: Response.json(
          { error: { code: 'SALON_NOT_FOUND', message: 'Salon not found' } },
          { status: 404 },
        ),
        salon: null,
      };
    }
    return { error: null, salon };
  }),
}));

/* eslint-disable import/first */
import { GET } from './route';
/* eslint-enable import/first */

const SALON_ID = 'salon_sf_report';
const SALON_SLUG = 'smartfit-report-salon';
const OTHER_SALON_ID = 'salon_sf_report_other';
const OTHER_SALON_SLUG = 'smartfit-report-foreign';
const TECH_DANIELA = 'tech_sfr_daniela';
const TECH_ISLA = 'tech_sfr_isla';
const OTHER_TECH = 'tech_sfr_foreign';
const SVC_BIAB = 'srv_sfr_biab'; // $65.00
const SVC_PEDI = 'srv_sfr_pedi'; // $50.00
const OTHER_SVC = 'srv_sfr_foreign';
const TIME_ZONE = 'America/Toronto';

const SALON_SETTINGS = {
  booking: { timezone: TIME_ZONE },
  smartFit: {
    enabled: true,
    discountType: 'percent',
    value: 10,
    maxRemainingGapMinutes: 10,
    minImprovementMinutes: 20,
  },
} as const;

const SALON_FEATURES = { analytics: { dashboard: true } } as const;

let db: ReturnType<typeof drizzle<typeof schema>>;
let client: PGlite;
let appointmentCounter = 0;

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

async function seedAppointment(args: {
  date: string;
  time: string;
  status?: string;
  discountType?: string | null;
  discountAmountCents?: number;
  subtotalBeforeDiscountCents?: number | null;
  totalPrice?: number;
  finalPriceCents?: number | null;
  finalDiscountCents?: number | null;
  paymentStatus?: string;
  technicianId?: string | null;
  salonId?: string;
  serviceId?: string | null;
  serviceNameSnapshot?: string | null;
  clientName?: string;
}): Promise<string> {
  appointmentCounter += 1;
  const id = `appt_sfr_${appointmentCounter}`;
  const startTime = at(args.date, args.time);
  const salonId = args.salonId ?? SALON_ID;
  await db.insert(schema.appointmentSchema).values({
    id,
    salonId,
    technicianId: args.technicianId === undefined ? TECH_DANIELA : args.technicianId,
    clientPhone: `416555${String(1000 + appointmentCounter)}`,
    clientName: args.clientName ?? `Client ${appointmentCounter}`,
    startTime,
    endTime: new Date(startTime.getTime() + 60 * 60_000),
    status: args.status ?? 'confirmed',
    totalPrice: args.totalPrice ?? 5850,
    totalDurationMinutes: 60,
    bufferMinutes: 10,
    blockedDurationMinutes: 70,
    subtotalBeforeDiscountCents: args.subtotalBeforeDiscountCents === undefined
      ? 6500
      : args.subtotalBeforeDiscountCents,
    discountAmountCents: args.discountAmountCents ?? 0,
    discountType: args.discountType ?? null,
    discountLabel: args.discountType === 'smart_fit' ? 'Smart Fit Discount' : null,
    discountAppliedAt: args.discountType ? startTime : null,
    finalPriceCents: args.finalPriceCents ?? null,
    finalDiscountCents: args.finalDiscountCents ?? null,
    paymentStatus: args.paymentStatus ?? 'pending',
  });

  const serviceId = args.serviceId === undefined ? SVC_BIAB : args.serviceId;
  if (serviceId) {
    await db.insert(schema.appointmentServicesSchema).values({
      id: `apptSvc_sfr_${appointmentCounter}`,
      appointmentId: id,
      serviceId,
      priceAtBooking: 6500,
      durationAtBooking: 60,
      nameSnapshot: args.serviceNameSnapshot === undefined
        ? (serviceId === SVC_PEDI ? 'Pedicure' : 'BIAB Short')
        : args.serviceNameSnapshot,
      priceCentsSnapshot: 6500,
      durationMinutesSnapshot: 60,
    });
  }

  return id;
}

async function queryReport(params: Record<string, string> = {}): Promise<Response> {
  const search = new URLSearchParams({ salonSlug: SALON_SLUG, ...params });
  return GET(new Request(`http://localhost/api/admin/analytics/smart-fit?${search.toString()}`));
}

async function reportData(params: Record<string, string> = {}): Promise<any> {
  const response = await queryReport(params);

  expect(response.status).toBe(200);

  return (await response.json()).data;
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: SALON_ID,
      name: 'Smart Fit Report Salon',
      slug: SALON_SLUG,
      settings: SALON_SETTINGS,
      features: SALON_FEATURES,
    },
    {
      id: OTHER_SALON_ID,
      name: 'Foreign Salon',
      slug: OTHER_SALON_SLUG,
      settings: SALON_SETTINGS,
      features: SALON_FEATURES,
    },
  ]);

  await db.insert(schema.technicianSchema).values([
    { id: TECH_DANIELA, salonId: SALON_ID, name: 'Daniela', weeklySchedule: null },
    { id: TECH_ISLA, salonId: SALON_ID, name: 'Isla', weeklySchedule: null },
    { id: OTHER_TECH, salonId: OTHER_SALON_ID, name: 'Foreign Tech', weeklySchedule: null },
  ]);

  await db.insert(schema.serviceSchema).values([
    { id: SVC_BIAB, salonId: SALON_ID, name: 'BIAB Short', category: 'builder_gel', price: 6500, durationMinutes: 60 },
    { id: SVC_PEDI, salonId: SALON_ID, name: 'Pedicure', category: 'feet', price: 5000, durationMinutes: 60 },
    { id: OTHER_SVC, salonId: OTHER_SALON_ID, name: 'Foreign Service', category: 'builder_gel', price: 6500, durationMinutes: 60 },
  ]);

  // ---------------------------------------------------------------------------
  // Week of Sunday 2026-07-12 → Saturday 2026-07-18 (weekly anchor 2026-07-15).
  // ---------------------------------------------------------------------------

  // Included Smart Fit rows.
  await seedAppointment({ // upcoming, booked total counts
    date: '2026-07-13',
    time: '10:00',
    status: 'confirmed',
    discountType: 'smart_fit',
    discountAmountCents: 650,
    totalPrice: 5850,
    technicianId: TECH_DANIELA,
    clientName: 'Avery Client',
  });
  await seedAppointment({ // completed with adjusted finalized revenue
    date: '2026-07-14',
    time: '10:00',
    status: 'completed',
    discountType: 'smart_fit',
    discountAmountCents: 650,
    totalPrice: 5850,
    finalPriceCents: 6000,
    paymentStatus: 'paid',
    technicianId: TECH_DANIELA,
  });
  await seedAppointment({ // completed legacy row without a checkout record
    date: '2026-07-15',
    time: '10:00',
    status: 'completed',
    discountType: 'smart_fit',
    discountAmountCents: 500,
    subtotalBeforeDiscountCents: 5000,
    totalPrice: 4500,
    technicianId: TECH_ISLA,
    serviceId: SVC_PEDI,
  });
  await seedAppointment({ // complimentary: counted, zero revenue
    date: '2026-07-18',
    time: '10:00',
    status: 'completed',
    discountType: 'smart_fit',
    discountAmountCents: 650,
    totalPrice: 5850,
    paymentStatus: 'comp',
    technicianId: TECH_ISLA,
  });
  await seedAppointment({ // salon-local Sat 23:30 = Sunday 03:30 UTC (timezone edge)
    date: '2026-07-18',
    time: '23:30',
    status: 'confirmed',
    discountType: 'smart_fit',
    discountAmountCents: 650,
    totalPrice: 5850,
    technicianId: TECH_ISLA,
    clientName: 'Night Owl',
  });

  // Excluded-by-status Smart Fit rows (reported separately, never in totals).
  await seedAppointment({
    date: '2026-07-16',
    time: '10:00',
    status: 'cancelled',
    discountType: 'smart_fit',
    discountAmountCents: 650,
    totalPrice: 5850,
  });
  await seedAppointment({
    date: '2026-07-17',
    time: '10:00',
    status: 'no_show',
    discountType: 'smart_fit',
    discountAmountCents: 650,
    totalPrice: 5850,
  });

  // Non-Smart-Fit discounts in the same week — all must be excluded.
  await seedAppointment({
    date: '2026-07-13',
    time: '12:00',
    status: 'confirmed',
    discountType: 'first_visit_25',
    discountAmountCents: 1625,
    totalPrice: 4875,
  });
  await seedAppointment({
    date: '2026-07-14',
    time: '12:00',
    status: 'completed',
    discountType: 'reward',
    discountAmountCents: 1000,
    totalPrice: 5500,
    finalPriceCents: 5500,
    paymentStatus: 'paid',
  });
  await seedAppointment({
    date: '2026-07-15',
    time: '12:00',
    status: 'confirmed',
    discountType: 'retention_promo_6w',
    discountAmountCents: 975,
    totalPrice: 5525,
  });
  await seedAppointment({ // manual checkout-time discount only
    date: '2026-07-16',
    time: '12:00',
    status: 'completed',
    discountType: null,
    finalPriceCents: 6000,
    finalDiscountCents: 500,
    paymentStatus: 'paid',
  });
  await seedAppointment({ // shown a Smart Fit offer, booked regular price
    date: '2026-07-17',
    time: '12:00',
    status: 'confirmed',
    discountType: null,
    totalPrice: 6500,
  });

  // Smart Fit row OUTSIDE the week (next Saturday) — excluded by range.
  await seedAppointment({
    date: '2026-07-25',
    time: '10:00',
    status: 'confirmed',
    discountType: 'smart_fit',
    discountAmountCents: 650,
    totalPrice: 5850,
  });

  // Cross-salon Smart Fit row in the same week — must never leak into salon A.
  await seedAppointment({
    date: '2026-07-14',
    time: '10:00',
    status: 'confirmed',
    discountType: 'smart_fit',
    discountAmountCents: 999,
    totalPrice: 5501,
    salonId: OTHER_SALON_ID,
    technicianId: OTHER_TECH,
    serviceId: OTHER_SVC,
    serviceNameSnapshot: 'Foreign Service',
  });

  // ---------------------------------------------------------------------------
  // 2026-06-10 (daily): historical snapshot names win over live records.
  // ---------------------------------------------------------------------------
  await seedAppointment({
    date: '2026-06-10',
    time: '10:00',
    status: 'completed',
    discountType: 'smart_fit',
    discountAmountCents: 650,
    totalPrice: 5850,
    serviceNameSnapshot: 'Old Name Gel',
  });
  await seedAppointment({
    date: '2026-06-10',
    time: '12:00',
    status: 'completed',
    discountType: 'smart_fit',
    discountAmountCents: 500,
    totalPrice: 4500,
    serviceId: SVC_PEDI,
    serviceNameSnapshot: null, // legacy row: fall back to the live service name
  });

  // 2026-06-11 (daily): unassigned technician renders safely.
  await seedAppointment({
    date: '2026-06-11',
    time: '10:00',
    status: 'confirmed',
    discountType: 'smart_fit',
    discountAmountCents: 650,
    totalPrice: 5850,
    technicianId: null,
  });

  // 2026-04-07 (daily): recent list is bounded to 10.
  for (let i = 0; i < 12; i += 1) {
    await seedAppointment({
      date: '2026-04-07',
      time: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
      status: 'confirmed',
      discountType: 'smart_fit',
      discountAmountCents: 100 + i,
      totalPrice: 6400 - i,
    });
  }
}, 60_000);

beforeEach(async () => {
  holder.adminError = null;
  await db.update(schema.salonSchema)
    .set({ settings: SALON_SETTINGS, features: SALON_FEATURES })
    .where(eq(schema.salonSchema.id, SALON_ID));
});

afterAll(async () => {
  await client.close();
});

const WEEK = { period: 'weekly', anchor: '2026-07-15' };

describe('smart fit report — authorization and tenancy', () => {
  it('returns data to an authorized salon admin', async () => {
    const data = await reportData(WEEK);

    expect(data.metrics.appointments).toBe(5);
    expect(data.config.enabled).toBe(true);
    expect(data.timezone).toBe(TIME_ZONE);
    expect(data.currency).toBe('CAD');
  });

  it('propagates the admin guard 401 for unauthenticated callers', async () => {
    holder.adminError = Response.json({ error: 'Unauthorized' }, { status: 401 });

    const response = await queryReport(WEEK);

    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain('metrics');
  });

  it('propagates the admin guard 403 for cross-salon callers', async () => {
    holder.adminError = Response.json({ error: 'Forbidden' }, { status: 403 });

    const response = await queryReport(WEEK);

    expect(response.status).toBe(403);
  });

  it('never leaks another salon\'s Smart Fit rows into totals or breakdowns', async () => {
    const data = await reportData(WEEK);

    expect(data.metrics.discountGivenCents).toBe(3100); // 999-cent foreign row absent
    expect(JSON.stringify(data)).not.toContain('Foreign');
  });

  it('returns 403 UPGRADE_REQUIRED when the salon lacks the analytics entitlement', async () => {
    await db.update(schema.salonSchema)
      .set({ features: null })
      .where(eq(schema.salonSchema.id, SALON_ID));

    const response = await queryReport(WEEK);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('UPGRADE_REQUIRED');
  });

  it('returns 403 MODULE_DISABLED when the admin turned the module off', async () => {
    await db.update(schema.salonSchema)
      .set({ settings: { ...SALON_SETTINGS, modules: { analyticsDashboard: false } } })
      .where(eq(schema.salonSchema.id, SALON_ID));

    const response = await queryReport(WEEK);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('MODULE_DISABLED');
  });
});

describe('smart fit report — request validation', () => {
  it('rejects a missing salonSlug', async () => {
    const response = await GET(new Request('http://localhost/api/admin/analytics/smart-fit'));

    expect(response.status).toBe(400);
  });

  it('rejects an unknown period', async () => {
    const response = await queryReport({ period: 'quarterly' });

    expect(response.status).toBe(400);
  });

  it('rejects a malformed anchor', async () => {
    const response = await queryReport({ period: 'weekly', anchor: 'not-a-date' });

    expect(response.status).toBe(400);
  });

  it('rejects an impossible calendar anchor (2026-02-31)', async () => {
    const response = await queryReport({ period: 'weekly', anchor: '2026-02-31' });

    expect(response.status).toBe(400);
  });

  it('defaults the anchor to today in the salon timezone', async () => {
    const data = await reportData({ period: 'daily' });
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

    expect(data.anchor).toBe(todayKey);
  });
});

describe('smart fit report — attribution from persisted metadata only', () => {
  it('counts only discount_type=smart_fit rows; first-visit, reward, retention, manual, and offer-shown-but-regular rows are excluded', async () => {
    const data = await reportData(WEEK);

    // 5 included smart_fit rows despite 5 other discounted/regular rows in-week.
    expect(data.metrics.appointments).toBe(5);
    // Sum over ONLY the smart_fit rows: 650+650+500+650+650.
    expect(data.metrics.discountGivenCents).toBe(3100);
  });

  it('excludes cancelled and no-show Smart Fit rows from totals and reports them separately', async () => {
    const data = await reportData(WEEK);

    expect(data.metrics.cancelledCount).toBe(1);
    expect(data.metrics.noShowCount).toBe(1);
    // Their 650-cent discounts are NOT in the primary total (asserted above)
    // and their revenue is NOT in booked revenue (asserted below).
  });

  it('uses finalized revenue for completed rows, booked totals for upcoming rows, and zero for comped rows', async () => {
    const data = await reportData(WEEK);

    // 5850 (upcoming booked) + 6000 (completed, finalized) + 4500 (completed,
    // legacy fallback to booked) + 0 (comp) + 5850 (upcoming booked).
    expect(data.metrics.bookedRevenueCents).toBe(22200);
    expect(data.metrics.completedCount).toBe(3);
    expect(data.metrics.upcomingCount).toBe(2);
  });

  it('computes the average discount from the primary totals', async () => {
    const data = await reportData(WEEK);

    expect(data.metrics.averageDiscountCents).toBe(620); // round(3100 / 5)
  });
});

describe('smart fit report — salon-timezone date handling', () => {
  it('assigns a salon-local 23:30 appointment to its salon-local day', async () => {
    // 2026-07-18 23:30 America/Toronto = 2026-07-19T03:30Z.
    const sat = await reportData({ period: 'daily', anchor: '2026-07-18' });
    const sun = await reportData({ period: 'daily', anchor: '2026-07-19' });

    expect(sat.metrics.appointments).toBe(2); // comp 10:00 + night 23:30
    expect(sun.metrics.appointments).toBe(0);
  });

  it('buckets the weekly series by salon-local day', async () => {
    const data = await reportData(WEEK);

    expect(data.series).toHaveLength(7);
    expect(data.series.map((bucket: any) => bucket.appointments)).toEqual([0, 1, 1, 1, 0, 0, 2]);
    expect(data.series[6].discountCents).toBe(1300); // comp 650 + night 650
    expect(data.series[6].revenueCents).toBe(5850); // comp contributes zero
    expect(data.series.map((bucket: any) => bucket.label)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ]);
  });
});

describe('smart fit report — breakdowns', () => {
  it('aggregates the service breakdown accurately with deterministic ordering', async () => {
    const data = await reportData(WEEK);

    expect(data.services).toEqual([
      { name: 'BIAB Short', appointments: 4, revenueCents: 17700, discountCents: 2600 },
      { name: 'Pedicure', appointments: 1, revenueCents: 4500, discountCents: 500 },
    ]);
  });

  it('aggregates the technician breakdown accurately with deterministic ordering', async () => {
    const data = await reportData(WEEK);

    expect(data.technicians).toEqual([
      { name: 'Isla', appointments: 3, revenueCents: 10350, discountCents: 1800 },
      { name: 'Daniela', appointments: 2, revenueCents: 11850, discountCents: 1300 },
    ]);
  });

  it('prefers historical snapshot names and falls back to live names safely', async () => {
    const data = await reportData({ period: 'daily', anchor: '2026-06-10' });

    expect(data.services.map((row: any) => row.name).sort()).toEqual([
      'Old Name Gel', // snapshot wins even though the live service is 'BIAB Short'
      'Pedicure', // null snapshot falls back to the live record
    ]);
  });

  it('renders an unassigned technician truthfully', async () => {
    const data = await reportData({ period: 'daily', anchor: '2026-06-11' });

    expect(data.technicians).toEqual([
      { name: 'Unassigned', appointments: 1, revenueCents: 5850, discountCents: 650 },
    ]);
  });
});

describe('smart fit report — recent list', () => {
  it('returns the most recent Smart Fit appointments with persisted amounts', async () => {
    const data = await reportData(WEEK);

    expect(data.recent).toHaveLength(5);

    const [first] = data.recent;

    expect(first.clientName).toBe('Night Owl');
    expect(first.serviceName).toBe('BIAB Short');
    expect(first.technicianName).toBe('Isla');
    expect(first.subtotalCents).toBe(6500);
    expect(first.discountCents).toBe(650);
    expect(first.finalCents).toBe(5850);
    expect(first.status).toBe('confirmed');

    // Descending start order.
    const times = data.recent.map((row: any) => row.startTime);

    expect([...times].sort().reverse()).toEqual(times);
  });

  it('bounds the recent list to 10 rows', async () => {
    const data = await reportData({ period: 'daily', anchor: '2026-04-07' });

    expect(data.metrics.appointments).toBe(12);
    expect(data.recent).toHaveLength(10);
  });

  it('exposes no appointment, service, or technician database ids', async () => {
    const data = await reportData(WEEK);

    const serialized = JSON.stringify([data.recent, data.services, data.technicians, data.series]);

    expect(serialized).not.toContain('appt_sfr_');
    expect(serialized).not.toContain('srv_sfr_');
    expect(serialized).not.toContain('tech_sfr_');
  });
});

describe('smart fit report — historical results are settings-independent', () => {
  it('changing or disabling Smart Fit settings never alters historical numbers', async () => {
    const before = await reportData(WEEK);

    await db.update(schema.salonSchema)
      .set({
        settings: {
          ...SALON_SETTINGS,
          smartFit: { enabled: false, discountType: 'fixed', value: 5000 },
        },
      })
      .where(eq(schema.salonSchema.id, SALON_ID));

    const after = await reportData(WEEK);

    expect(after.config.enabled).toBe(false);
    expect(after.metrics).toEqual(before.metrics);
    expect(after.series).toEqual(before.series);
    expect(after.services).toEqual(before.services);
    expect(after.technicians).toEqual(before.technicians);
    expect(after.recent).toEqual(before.recent);
  });

  it('reports a truthful empty period', async () => {
    const data = await reportData({ period: 'weekly', anchor: '2026-05-06' });

    expect(data.metrics).toEqual({
      appointments: 0,
      discountGivenCents: 0,
      bookedRevenueCents: 0,
      averageDiscountCents: 0,
      completedCount: 0,
      upcomingCount: 0,
      cancelledCount: 0,
      noShowCount: 0,
    });
    expect(data.services).toEqual([]);
    expect(data.technicians).toEqual([]);
    expect(data.recent).toEqual([]);
    expect(data.series.every((bucket: any) => bucket.appointments === 0)).toBe(true);
  });
});
