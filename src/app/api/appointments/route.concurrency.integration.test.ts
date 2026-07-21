/**
 * Double-booking under genuine concurrency.
 *
 * PGlite (the default test database) runs on a single connection, so two
 * transactions can never actually interleave there — it cannot prove that the
 * row lock and the `appointment_tech_active_no_overlap` exclusion constraint
 * hold under a race. This suite therefore drives the REAL route handler against
 * a throwaway PostgreSQL server over a real connection pool.
 *
 * It is opt-in and refuses to run against anything that is not an explicitly
 * local throwaway database, so the project's "tests never touch a real
 * database" guarantee is preserved:
 *
 *   docker run -d --name luster-qa-pg -e POSTGRES_PASSWORD=qa -e POSTGRES_USER=qa \
 *     -e POSTGRES_DB=luster_qa -p 55432:5432 postgres:16
 *   CONCURRENCY_TEST_DATABASE_URL=postgres://qa:qa@127.0.0.1:55432/luster_qa \
 *     npx vitest run src/app/api/appointments/route.concurrency.integration.test.ts
 */
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
const IS_LOCAL_THROWAWAY = /^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost):\d+\//.test(RAW_URL)
  && !RAW_URL.includes('neon.tech');

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const {
  sendTransactionalEmail,
  sendTransactionalEmailDetailed,
  requireStaffSession,
  requireAdmin,
  requireClientApiSession,
} = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
  sendTransactionalEmailDetailed: vi.fn(),
  requireStaffSession: vi.fn(),
  requireAdmin: vi.fn(),
  requireClientApiSession: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/email', () => ({ sendTransactionalEmail, sendTransactionalEmailDetailed }));
vi.mock('@/libs/staffAuth', () => ({ requireStaffSession }));
vi.mock('@/libs/adminAuth', () => ({
  requireAdmin,
  requireAdminSalon: vi.fn(async () => ({ ok: false, response: new Response(null, { status: 401 }) })),
}));
vi.mock('@/libs/clientApiGuards', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/clientApiGuards')>()),
  requireClientApiSession,
}));
vi.mock('@/libs/SMS', () => ({
  sendBookingConfirmationToClient: vi.fn(),
  sendCancellationNotificationToTech: vi.fn(),
  sendRescheduleConfirmation: vi.fn(),
}));
vi.mock('@/libs/googleCalendar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/googleCalendar')>()),
  getGoogleCalendarBusyWindows: vi.fn(async () => []),
  hasGoogleCalendarConflict: vi.fn(async () => false),
}));

const SALON_ID = 'salon_conc';
const TECH_ID = 'tech_conc';
const SERVICE_ID = 'svc_conc';
const START_TIME = '2099-09-01T15:00:00.000Z';

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

const suite = IS_LOCAL_THROWAWAY ? describe : describe.skip;

suite('POST /api/appointments — genuine concurrency', () => {
  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.luster.test';
    pool = new pg.Pool({ connectionString: RAW_URL, max: 10 });
    db = drizzle(pool, { schema });
    holder.db = db;

    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

    await pool.query(`TRUNCATE TABLE
      appointment_access_token, appointment_add_on, appointment_services,
      notification_delivery, integration_outbox, appointment,
      technician_blocked_slot, technician_time_off, add_on, service,
      technician, salon_client, salon_location, salon
      RESTART IDENTITY CASCADE`);

    await db.insert(schema.salonSchema).values({
      id: SALON_ID,
      name: 'Concurrency Salon',
      slug: 'concurrency-salon',
      ownerEmail: 'owner@example.invalid',
      isActive: true,
      status: 'active',
      publicationStatus: 'published',
      settings: { booking: { timezone: 'America/Toronto', slotIntervalMinutes: 15, bufferMinutes: 10 } },
    });
    await db.insert(schema.technicianSchema).values({
      id: TECH_ID,
      salonId: SALON_ID,
      name: 'Concurrency Tech',
      isActive: true,
      weeklySchedule: Object.fromEntries(
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
          .map(day => [day, { start: '00:00', end: '23:45' }]),
      ),
    });
    await db.insert(schema.serviceSchema).values({
      id: SERVICE_ID,
      salonId: SALON_ID,
      name: 'Concurrency Service',
      category: 'manicure',
      price: 6500,
      durationMinutes: 60,
      isActive: true,
    });
    // The technician must be assigned the service, or the route rejects the
    // selection long before the race is reached.
    await db.insert(schema.technicianServicesSchema).values({
      technicianId: TECH_ID,
      serviceId: SERVICE_ID,
      enabled: true,
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // The losing request logs its conflict, and the redis-less environment
    // warns about idempotency caching. Both are expected here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    requireStaffSession.mockResolvedValue({ ok: false });
    requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    requireClientApiSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    sendTransactionalEmail.mockResolvedValue(true);
    sendTransactionalEmailDetailed.mockResolvedValue({ ok: true, errorCode: null, providerMessageId: 'm' });

    await pool.query('TRUNCATE TABLE appointment_access_token, appointment_add_on, appointment_services, notification_delivery, integration_outbox, appointment RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool?.end();
  });

  function bookingRequest(overrides: Record<string, unknown> = {}) {
    return new Request('http://localhost/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug: 'concurrency-salon',
        baseServiceId: SERVICE_ID,
        technicianId: TECH_ID,
        startTime: START_TIME,
        clientName: 'Racer One',
        clientEmail: 'racer.one@example.invalid',
        clientPhone: '4165551111',
        ...overrides,
      }),
    });
  }

  async function activeAppointments() {
    return db.select().from(schema.appointmentSchema);
  }

  it('lets exactly one of two simultaneous identical bookings win', async () => {
    const { POST } = await import('./route');

    // Same customer, same salon, same slot, fired together.
    const [a, b] = await Promise.all([
      POST(bookingRequest()),
      POST(bookingRequest()),
    ]);
    const statuses = [a.status, b.status].sort();
    const bodies = await Promise.all([a.json(), b.json()]);

    expect(statuses).toEqual([201, 409]);

    const rows = await activeAppointments();

    expect(rows).toHaveLength(1);

    // Whichever lost must say so in a structured way — never a 500.
    const loser = bodies.find(body => body?.error);

    expect(loser?.error?.code).toBeDefined();
    expect(['TIME_CONFLICT', 'EXISTING_APPOINTMENT', 'CONTACT_IDENTITY_CONFLICT'])
      .toContain(loser.error.code);
  });

  it('creates no duplicate notification or outbox side effects', async () => {
    const { POST } = await import('./route');

    await Promise.all([POST(bookingRequest()), POST(bookingRequest())]);

    const rows = await activeAppointments();

    expect(rows).toHaveLength(1);

    const deliveries = await db
      .select()
      .from(schema.notificationDeliverySchema)
      .where(eq(schema.notificationDeliverySchema.appointmentId, rows[0]!.id));
    const outbox = await db
      .select()
      .from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, rows[0]!.id));

    // At most one row per purpose/operation — the losing request contributes none.
    const deliveryKeys = deliveries.map(row => `${row.channel}:${row.purpose}`);
    const outboxKeys = outbox.map(row => `${row.provider}:${row.operation}`);

    expect(new Set(deliveryKeys).size).toBe(deliveryKeys.length);
    expect(new Set(outboxKeys).size).toBe(outboxKeys.length);
    expect(deliveries.filter(row => row.purpose === 'booking_confirmation')).toHaveLength(
      deliveries.some(row => row.purpose === 'booking_confirmation') ? 1 : 0,
    );
  });

  it('holds the slot against a different customer racing for the same time', async () => {
    const { POST } = await import('./route');

    const [a, b] = await Promise.all([
      POST(bookingRequest()),
      POST(bookingRequest({
        clientName: 'Racer Two',
        clientEmail: 'racer.two@example.invalid',
        clientPhone: '4165552222',
      })),
    ]);
    const statuses = [a.status, b.status].sort();

    expect(statuses).toEqual([201, 409]);
    expect(await activeAppointments()).toHaveLength(1);
  });

  it('is correct whichever request wins, across repeated races', async () => {
    const { POST } = await import('./route');
    const winners = new Set<string>();

    for (let attempt = 0; attempt < 5; attempt++) {
      await pool.query('TRUNCATE TABLE appointment_access_token, appointment_add_on, appointment_services, notification_delivery, integration_outbox, appointment RESTART IDENTITY CASCADE');

      const requests = [
        POST(bookingRequest({ clientName: 'Racer A', clientPhone: '4165551111', clientEmail: 'a@example.invalid' })),
        POST(bookingRequest({ clientName: 'Racer B', clientPhone: '4165552222', clientEmail: 'b@example.invalid' })),
      ];
      const responses = await Promise.all(requests);

      expect([responses[0]!.status, responses[1]!.status].sort()).toEqual([201, 409]);

      const rows = await activeAppointments();

      expect(rows).toHaveLength(1);

      winners.add(rows[0]!.clientName ?? 'unknown');
    }

    // The invariant holds no matter who won; which one wins is not asserted.
    expect(winners.size).toBeGreaterThanOrEqual(1);
  });
});
