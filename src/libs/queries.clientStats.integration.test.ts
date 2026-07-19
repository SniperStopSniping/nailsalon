/**
 * Client-spend basis integration test (0058): salon_client.totalSpent counts
 * only completed AND fully-paid appointments, at the final (net-of-tax) price
 * with a booked-total fallback for legacy rows; comp/unpaid/partial rows are
 * visits but never spend. Loyalty points reconcile from that figure.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { updateSalonClientStats } from './queries';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const SALON_ID = 'salon_stats';
const PHONE = '4165550142';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Stats Salon',
    slug: 'stats-salon',
  });
  await db.insert(schema.salonClientSchema).values({
    id: 'sclient_stats',
    salonId: SALON_ID,
    phone: PHONE,
    fullName: 'Stats Client',
    loyaltyPoints: 0,
    totalSpent: 0,
  });

  let counter = 0;
  const appointment = (values: Partial<typeof schema.appointmentSchema.$inferInsert>) => {
    counter += 1;
    const startTime = new Date(Date.UTC(2026, 5, counter, 15, 0, 0));
    return {
      id: `appt_stats_${counter}`,
      salonId: SALON_ID,
      clientPhone: PHONE,
      startTime,
      endTime: new Date(startTime.getTime() + 3_600_000),
      totalDurationMinutes: 60,
      ...values,
    } as typeof schema.appointmentSchema.$inferInsert;
  };

  await db.insert(schema.appointmentSchema).values([
    // Legacy paid completion (no finalPriceCents): booked total counts.
    appointment({ status: 'completed', paymentStatus: 'paid', totalPrice: 4500, completedAt: new Date() }),
    // Checkout completion: final price wins over the booked total; the tax
    // amount lives in its own column and never inflates spend.
    appointment({
      status: 'completed',
      paymentStatus: 'paid',
      totalPrice: 5000,
      finalPriceCents: 6000,
      taxAmountCents: 780,
      completedAt: new Date(),
    }),
    // Completed but unpaid: a visit, not spend.
    appointment({ status: 'completed', paymentStatus: 'pending', totalPrice: 9000, finalPriceCents: 9000, completedAt: new Date() }),
    // Complimentary: a visit, zero spend.
    appointment({ status: 'completed', paymentStatus: 'comp', totalPrice: 7000, finalPriceCents: 7000, completedAt: new Date() }),
    // Upcoming: neither.
    appointment({ status: 'confirmed', totalPrice: 8000 }),
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('updateSalonClientStats (0058 basis)', () => {
  it('counts spend paid-only at the final price, visits for every completion', async () => {
    await updateSalonClientStats(SALON_ID, PHONE);

    const [salonClient] = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'sclient_stats'));

    // 4500 (legacy paid) + 6000 (final price, tax excluded) — nothing else.
    expect(salonClient!.totalSpent).toBe(10500);
    // All four completions count as visits regardless of payment state.
    expect(salonClient!.totalVisits).toBe(4);
    // Points reconcile from spend: 20 pts per $1 → 10500 cents = $105 → 2100.
    expect(salonClient!.loyaltyPoints).toBe(2100);
  });

  it('drops spend and points when a paid appointment stops being paid (reopen/void), flooring at zero', async () => {
    await db
      .update(schema.appointmentSchema)
      .set({ paymentStatus: 'pending' })
      .where(eq(schema.appointmentSchema.id, 'appt_stats_2'));

    await updateSalonClientStats(SALON_ID, PHONE);

    const [salonClient] = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'sclient_stats'));

    expect(salonClient!.totalSpent).toBe(4500);
    expect(salonClient!.loyaltyPoints).toBe(900);
  });
});
