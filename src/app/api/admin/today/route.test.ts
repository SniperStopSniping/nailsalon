import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import * as schema from '@/models/Schema';

import { GET } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async () => ({
    salon: {
      id: 'salon_today',
      name: 'Today Salon',
      slug: 'today-salon',
      customDomain: null,
    },
    error: null,
  })),
}));

vi.mock('@/libs/bookingConfig', () => ({
  getBookingConfigForSalon: vi.fn(async () => ({ timezone: 'UTC' })),
}));

vi.mock('@/libs/integrationHealth', () => ({
  getSalonIntegrationHealth: vi.fn(async () => ({ status: 'healthy' })),
}));

vi.mock('@/libs/publicUrl', () => ({
  buildSalonTenantPublicUrl: vi.fn((pathname: string) => `https://today.example${pathname}`),
}));

const fixtureNow = new Date('2026-11-08T12:00:00Z');

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  const now = fixtureNow;

  await db.insert(schema.salonSchema).values({
    id: 'salon_today',
    name: 'Today Salon',
    slug: 'today-salon',
  });
  await db.insert(schema.salonSchema).values({
    id: 'salon_other',
    name: 'Other Salon',
    slug: 'other-salon',
  });
  await db.insert(schema.technicianSchema).values([
    { id: 'today_tech_avery_one', salonId: 'salon_today', name: 'Avery', isActive: true },
    { id: 'today_tech_avery_two', salonId: 'salon_today', name: 'Avery', isActive: true },
    { id: 'today_tech_inactive', salonId: 'salon_today', name: 'Former tech', isActive: false },
    { id: 'other_tech', salonId: 'salon_other', name: 'Other salon tech', isActive: true },
  ]);
  await db.insert(schema.salonClientSchema).values([
    {
      id: 'today_active',
      salonId: 'salon_today',
      phone: '4165554101',
      fullName: 'Active Due',
      lastVisitAt: new Date(now.getTime() - 30 * 86_400_000),
      nextRebookDueAt: new Date(now.getTime() - 86_400_000),
    },
    {
      id: 'today_archived',
      salonId: 'salon_today',
      phone: '4165554102',
      fullName: 'Archived Due',
      sensitivities: 'Historical sensitivity',
      lastVisitAt: new Date(now.getTime() - 30 * 86_400_000),
      nextRebookDueAt: new Date(now.getTime() - 86_400_000),
      archivedAt: new Date(now.getTime() - 86_400_000),
      archivedBy: 'archive-test',
    },
    {
      id: 'today_terminal',
      salonId: 'salon_today',
      phone: '4165554103',
      fullName: 'Terminal Client',
    },
    {
      id: 'today_merged_source',
      salonId: 'salon_today',
      phone: '4165554104',
      fullName: 'Merged Due',
      lastVisitAt: new Date(now.getTime() - 30 * 86_400_000),
      nextRebookDueAt: new Date(now.getTime() - 86_400_000),
    },
  ]);

  // Deliberately retain an unarchived merged source to prove the read path
  // independently fails closed on both lifecycle columns.
  await db.execute(sql.raw(
    'ALTER TABLE salon_client DISABLE TRIGGER salon_client_enforce_merge_transition',
  ));
  try {
    await db.execute(sql.raw(`
      UPDATE salon_client
      SET merged_into_client_id = 'today_terminal'
      WHERE id = 'today_merged_source'
    `));
  } finally {
    await db.execute(sql.raw(
      'ALTER TABLE salon_client ENABLE TRIGGER salon_client_enforce_merge_transition',
    ));
  }

  // Historical/transactional appointment reads remain independent from the
  // active rebook-due projection.
  await db.insert(schema.appointmentSchema).values({
    id: 'today_archived_appointment',
    salonId: 'salon_today',
    salonClientId: 'today_archived',
    clientPhone: '4165554102',
    clientName: 'Archived Due',
    startTime: now,
    endTime: new Date(now.getTime() + 3_600_000),
    status: 'completed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
    technicianId: 'today_tech_avery_one',
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('GET /api/admin/today', () => {
  beforeEach(() => {
    vi.setSystemTime(fixtureNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps archived appointments visible but excludes archived and merged clients from rebook-due results', async () => {
    const response = await GET(new Request(
      'http://localhost/api/admin/today?salonSlug=today-salon',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).not.toHaveProperty('tomorrow');
    expect(body.data.dueClients.map((row: { id: string }) => row.id)).toEqual([
      'today_active',
    ]);
    expect(body.data.appointments).toEqual([
      expect.objectContaining({
        id: 'today_archived_appointment',
        clientSensitivities: 'Historical sensitivity',
        technicianId: 'today_tech_avery_one',
      }),
    ]);
  });

  it('returns both salon-local days across the fall DST transition for opted-in callers', async () => {
    const today = new Date('2026-11-01T02:00:00Z');
    const firstTomorrow = '2026-11-01T04:00:00Z';
    const lastTomorrow = '2026-11-02T04:45:00Z';
    const rows = [
      { id: 'next-day-late', start: lastTomorrow, status: 'awaiting_payment' },
      { id: 'next-day-first', start: firstTomorrow, status: 'confirmed' },
      { id: 'today-spans-midnight', start: '2026-11-01T03:50:00Z', status: 'completed' },
      { id: 'after-tomorrow', start: '2026-11-02T05:00:00Z', status: 'confirmed' },
      { id: 'next-day-cancelled', start: '2026-11-01T17:00:00Z', status: 'cancelled' },
      { id: 'next-day-no-show', start: '2026-11-01T17:00:00Z', status: 'no_show' },
      { id: 'next-day-deleted', start: '2026-11-01T17:00:00Z', status: 'confirmed', deletedAt: today },
      { id: 'other-salon-appt', start: '2026-11-01T17:00:00Z', status: 'confirmed', salonId: 'salon_other' },
    ];
    await db.insert(schema.appointmentSchema).values(rows.map(({ start, ...row }) => ({
      ...row,
      salonId: row.salonId ?? 'salon_today',
      clientPhone: '4165554109',
      startTime: new Date(start),
      endTime: new Date(new Date(start).getTime() + 3_600_000),
      totalPrice: 5000,
      totalDurationMinutes: 60,
    })));
    await db.insert(schema.serviceSchema).values({
      id: 'today-service',
      salonId: 'salon_today',
      name: 'Renamed manicure',
      price: 5000,
      durationMinutes: 60,
      category: 'manicure',
    });
    await db.insert(schema.appointmentServicesSchema).values({
      id: 'tomorrow-service-snapshot',
      appointmentId: 'next-day-first',
      serviceId: 'today-service',
      priceAtBooking: 5000,
      durationAtBooking: 60,
      nameSnapshot: 'Russian Manicure',
    });

    vi.mocked(getBookingConfigForSalon).mockResolvedValueOnce({
      ...await getBookingConfigForSalon('salon_today'),
      timezone: 'America/Toronto',
    });
    vi.setSystemTime(today);
    const response = await GET(new Request('http://localhost/api/admin/today?salonSlug=today-salon&includeTomorrow=1'));

    expect(response.status).toBe(200);

    const { data } = await response.json();

    expect(data.date).toBe('2026-10-31');
    expect(data.timeZone).toBe('America/Toronto');
    expect(data.appointments).toEqual([
      expect.objectContaining({ id: 'today-spans-midnight', status: 'completed' }),
    ]);
    expect(data.tomorrow).toEqual({
      date: '2026-11-01',
      appointments: [
        expect.objectContaining({ id: 'next-day-first', startTime: new Date(firstTomorrow).toISOString(), services: ['Russian Manicure'], totalDurationMinutes: 60 }),
        expect.objectContaining({ id: 'next-day-late', startTime: new Date(lastTomorrow).toISOString(), status: 'awaiting_payment' }),
      ],
    });
  });

  it('returns the active, tenant-scoped technician roster independently of today appointment names', async () => {
    const response = await GET(new Request(
      'http://localhost/api/admin/today?salonSlug=today-salon',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.technicians).toEqual(expect.arrayContaining([
      { id: 'today_tech_avery_one', name: 'Avery' },
      { id: 'today_tech_avery_two', name: 'Avery' },
    ]));
    expect(body.data.technicians).toHaveLength(2);
  });
});
