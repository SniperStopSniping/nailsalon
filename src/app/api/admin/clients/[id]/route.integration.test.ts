import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { GET } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const requireAdminSalon = vi.hoisted(() => vi.fn());

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

const NOW = new Date('2026-07-23T16:00:00.000Z');
const SALON_ID = 'salon_client_profile_financial';
const CLIENT_ID = 'client_profile_financial';
const PHONE = '4165550188';

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

  await testDb.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Client Profile Financial Salon',
    slug: 'client-profile-financial',
    settings: {
      booking: {
        timezone: 'America/Toronto',
        currency: 'CAD',
      },
    },
  });
  await testDb.insert(schema.salonClientSchema).values({
    id: CLIENT_ID,
    salonId: SALON_ID,
    phone: PHONE,
    fullName: 'Partial Payment Client',
    totalSpent: 4000,
  });

  await testDb.insert(schema.appointmentSchema).values([
    {
      id: 'client_profile_partial',
      salonId: SALON_ID,
      clientPhone: PHONE,
      clientName: 'Partial Payment Client',
      startTime: new Date('2026-07-20T14:00:00.000Z'),
      endTime: new Date('2026-07-20T15:00:00.000Z'),
      totalDurationMinutes: 60,
      totalPrice: 12000,
      finalPriceCents: 10000,
      finalDiscountCents: 2000,
      taxAmountCents: 0,
      tipCents: 0,
      amountPaidCents: 4000,
      paymentStatus: 'partially_paid',
      status: 'completed',
      completedAt: new Date('2026-07-20T15:00:00.000Z'),
    },
    {
      id: 'client_profile_future',
      salonId: SALON_ID,
      clientPhone: PHONE,
      clientName: 'Partial Payment Client',
      startTime: new Date('2026-08-20T14:00:00.000Z'),
      endTime: new Date('2026-08-20T15:00:00.000Z'),
      totalDurationMinutes: 60,
      totalPrice: 50000,
      amountPaidCents: 0,
      paymentStatus: 'pending',
      status: 'confirmed',
    },
  ]);
  await testDb.insert(schema.appointmentPaymentSchema).values({
    id: 'client_profile_payment',
    appointmentId: 'client_profile_partial',
    salonId: SALON_ID,
    amountCents: 4000,
    method: 'cash',
    recordedByType: 'admin',
    recordedAt: new Date('2026-07-20T15:00:00.000Z'),
  });
}, 60_000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  requireAdminSalon.mockResolvedValue({
    error: null,
    salon: {
      id: SALON_ID,
      slug: 'client-profile-financial',
      settings: {
        booking: {
          timezone: 'America/Toronto',
          currency: 'CAD',
        },
      },
    },
  });
});

afterAll(async () => {
  vi.useRealTimers();
  await client.close();
});

describe('GET /api/admin/clients/[id] financial projection', () => {
  it('counts complete partial-payment value while separating received cash and outstanding', async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/clients/${CLIENT_ID}?salonSlug=client-profile-financial`),
      { params: Promise.resolve({ id: CLIENT_ID }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.data.client.totalSpent).toBe(4000);
    expect(body.data.summary).toMatchObject({
      currency: 'CAD',
      timeZone: 'America/Toronto',
      lifetimeSpendCents: 10000,
      spendThisMonthCents: 10000,
      completedOutstandingCents: 6000,
      completedVisits: 1,
    });
    expect(body.data.pastAppointments[0].financial).toMatchObject({
      completedValueCents: 10000,
      source: 'finalized',
      paymentsReceivedCents: 4000,
      completedOutstandingCents: 6000,
      paymentStatus: 'partially_paid',
    });
    expect(body.data.pastAppointments[0].financial.payments).toEqual([
      expect.objectContaining({
        id: 'client_profile_payment',
        amountCents: 4000,
        method: 'cash',
      }),
    ]);
  });
});
