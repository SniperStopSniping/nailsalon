import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  const now = new Date();
  const appointmentStart = new Date(now);
  appointmentStart.setUTCHours(12, 0, 0, 0);

  await db.insert(schema.salonSchema).values({
    id: 'salon_today',
    name: 'Today Salon',
    slug: 'today-salon',
  });
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
    startTime: appointmentStart,
    endTime: new Date(appointmentStart.getTime() + 3_600_000),
    status: 'completed',
    totalPrice: 5000,
    totalDurationMinutes: 60,
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('GET /api/admin/today', () => {
  it('keeps archived appointments visible but excludes archived and merged clients from rebook-due results', async () => {
    const response = await GET(new Request(
      'http://localhost/api/admin/today?salonSlug=today-salon',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.dueClients.map((row: { id: string }) => row.id)).toEqual([
      'today_active',
    ]);
    expect(body.data.appointments).toEqual([
      expect.objectContaining({
        id: 'today_archived_appointment',
        clientSensitivities: 'Historical sensitivity',
      }),
    ]);
  });
});
