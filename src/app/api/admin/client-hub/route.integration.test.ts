/** Client Hub integration (PGlite): real metrics from finalized values. */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
    if (slug !== 'hub-salon') {
      return { salon: null, error: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }) };
    }
    return { salon: { id: 'salon_hub', slug }, error: null };
  }),
}));

const SALON_ID = 'salon_hub';
const DAY = 86_400_000;

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  const now = Date.now();
  await db.insert(schema.salonSchema).values({ id: SALON_ID, name: 'Hub Salon', slug: 'hub-salon' });
  await db.insert(schema.salonClientSchema).values([
    { id: 'hc_1', salonId: SALON_ID, phone: '4165550401', fullName: 'Returning R', totalVisits: 3, lastVisitAt: new Date(now - 10 * DAY) },
    { id: 'hc_2', salonId: SALON_ID, phone: '4165550402', fullName: 'Stale S', totalVisits: 1, noShowCount: 1, lastVisitAt: new Date(now - 70 * DAY) },
  ]);
  await db.insert(schema.appointmentSchema).values([
    // Checkout-completed: final 10000 net + 1300 tax + 500 tip, 6000 paid →
    // 5800 outstanding. Revenue must be 10000 (never 11000 booked, never +tax).
    {
      id: 'ha_1',
      salonId: SALON_ID,
      salonClientId: 'hc_1',
      clientPhone: '4165550401',
      startTime: new Date(now - 10 * DAY),
      endTime: new Date(now - 10 * DAY + 3_600_000),
      status: 'completed',
      completedAt: new Date(now - 10 * DAY),
      totalPrice: 11000,
      totalDurationMinutes: 60,
      finalPriceCents: 10000,
      taxAmountCents: 1300,
      tipCents: 500,
      amountPaidCents: 6000,
      paymentStatus: 'partially_paid',
    },
    // Legacy completed row (no checkout columns) — counts booked total.
    {
      id: 'ha_2',
      salonId: SALON_ID,
      salonClientId: 'hc_2',
      clientPhone: '4165550402',
      startTime: new Date(now - 70 * DAY),
      endTime: new Date(now - 70 * DAY + 3_600_000),
      status: 'completed',
      completedAt: new Date(now - 70 * DAY),
      totalPrice: 4500,
      totalDurationMinutes: 60,
      paymentStatus: 'paid',
    },
    {
      id: 'ha_3',
      salonId: SALON_ID,
      salonClientId: 'hc_2',
      clientPhone: '4165550402',
      startTime: new Date(now - 20 * DAY),
      endTime: new Date(now - 20 * DAY + 3_600_000),
      status: 'no_show',
      totalPrice: 4500,
      totalDurationMinutes: 60,
    },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('GET /api/admin/client-hub', () => {
  it('reports real metrics from finalized values — tax and tips never inflate revenue', async () => {
    const response = await GET(new Request('http://localhost/api/admin/client-hub?salonSlug=hub-salon'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.overview.totalClients).toBe(2);
    expect(body.data.overview.returningClients).toBe(1);
    expect(body.data.overview.completedAppointments).toBe(2);
    // 10000 (final, net of tax) + 4500 (legacy booked) — NOT 11000+4500,
    // NOT revenue+tax.
    expect(body.data.reports.serviceRevenueCents).toBe(14500);
    expect(body.data.reports.taxCollectedCents).toBe(1300);
    expect(body.data.reports.tipsCents).toBe(500);
    expect(body.data.reports.amountPaidCents).toBe(6000);
    // Outstanding only where a checkout recorded payments: 10000+1300+500-6000.
    expect(body.data.reports.outstandingCents).toBe(5800);
    // Rates from real counts: 3 finished, 1 no-show, 0 cancelled.
    expect(body.data.reports.noShowRate).toBe(33);
    expect(body.data.reports.cancellationRate).toBe(0);
  });

  it('computes honest segments and reuses the shared follow-up engine', async () => {
    const response = await GET(new Request('http://localhost/api/admin/client-hub?salonSlug=hub-salon'));
    const body = await response.json();
    const segment = (id: string) =>
      body.data.segments.find((entry: { id: string }) => entry.id === id)?.count;

    expect(segment('returning')).toBe(1);
    expect(segment('previous_no_shows')).toBe(1);
    expect(segment('not_seen_60d')).toBe(1);
    expect(segment('no_future_appointment')).toBe(2);
    // hc_2 is 70 days stale → overdue via the SAME retention engine.
    expect(body.data.overview.overdue).toBe(1);
    // No fabricated segments: birthdays/sources don't exist in the data model.
    expect(body.data.segments.some((entry: { id: string }) => /birthday|source/.test(entry.id))).toBe(false);
  });

  it('enforces admin tenancy server-side', async () => {
    const response = await GET(new Request('http://localhost/api/admin/client-hub?salonSlug=other-salon'));

    expect(response.status).toBe(403);
  });
});
