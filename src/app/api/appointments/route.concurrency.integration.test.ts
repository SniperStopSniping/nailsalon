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

import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import * as schema from '@/models/Schema';

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let parsedConcurrencyUrl: URL | null = null;
try {
  parsedConcurrencyUrl = RAW_URL ? new URL(RAW_URL) : null;
} catch {
  parsedConcurrencyUrl = null;
}
const parsedDatabaseName = parsedConcurrencyUrl
  ? decodeURIComponent(parsedConcurrencyUrl.pathname).replace(/^\//, '')
  : '';
const disposableDatabaseConfirmed
  = process.env.CLIENT_LIFECYCLE_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || (
    parsedDatabaseName === 'luster_qa'
    && parsedConcurrencyUrl?.username === 'qa'
  );
const IS_LOCAL_THROWAWAY = parsedConcurrencyUrl != null
  && ['127.0.0.1', 'localhost'].includes(parsedConcurrencyUrl.hostname)
  && disposableDatabaseConfirmed
  && !RAW_URL.includes('neon.tech');

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const {
  sendTransactionalEmail,
  sendTransactionalEmailDetailed,
  requireStaffSession,
  requireAdmin,
  requireAdminSalon,
  requireClientApiSession,
  requireAppointmentAccess,
  requireAppointmentManagerAccess,
  requireStaffAppointmentAccess,
} = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
  sendTransactionalEmailDetailed: vi.fn(),
  requireStaffSession: vi.fn(),
  requireAdmin: vi.fn(),
  requireAdminSalon: vi.fn(),
  requireClientApiSession: vi.fn(),
  requireAppointmentAccess: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
  requireStaffAppointmentAccess: vi.fn(),
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
  requireAdminSalon,
}));
vi.mock('@/libs/clientApiGuards', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/clientApiGuards')>()),
  requireClientApiSession,
}));
vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentAccess,
  requireAppointmentManagerAccess,
}));
vi.mock('@/libs/staffApiGuards', () => ({
  requireStaffAppointmentAccess,
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
const SECOND_TECH_ID = 'tech_conc_2';
const SERVICE_ID = 'svc_conc';
const START_TIME = '2099-09-01T15:00:00.000Z';

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const pendingLockReleases = new Set<() => Promise<void>>();

const suite = IS_LOCAL_THROWAWAY ? describe : describe.skip;

suite('POST /api/appointments — genuine concurrency', () => {
  beforeAll(async () => {
    process.env.PUBLIC_APP_URL = 'https://app.luster.test';
    pool = new pg.Pool({
      connectionString: RAW_URL,
      max: 10,
      application_name: 'codex-appointment-concurrency-test',
    });
    const safety = await pool.query<{
      database_name: string;
      application_name: string;
    }>(`
      SELECT
        current_database() AS database_name,
        current_setting('application_name') AS application_name
    `);
    if (
      safety.rows[0]?.database_name !== parsedDatabaseName
      || !disposableDatabaseConfirmed
      || safety.rows[0]?.application_name
      !== 'codex-appointment-concurrency-test'
    ) {
      throw new Error('Concurrency tests require the marked disposable database');
    }
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
    await db.insert(schema.technicianSchema).values([
      {
        id: TECH_ID,
        salonId: SALON_ID,
        name: 'Concurrency Tech',
        isActive: true,
        weeklySchedule: Object.fromEntries(
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            .map(day => [day, { start: '00:00', end: '23:45' }]),
        ),
      },
      {
        id: SECOND_TECH_ID,
        salonId: SALON_ID,
        name: 'Concurrency Tech 2',
        isActive: true,
        weeklySchedule: Object.fromEntries(
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            .map(day => [day, { start: '00:00', end: '23:45' }]),
        ),
      },
    ]);
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
    await db.insert(schema.technicianServicesSchema).values([
      {
        technicianId: TECH_ID,
        serviceId: SERVICE_ID,
        enabled: true,
      },
      {
        technicianId: SECOND_TECH_ID,
        serviceId: SERVICE_ID,
        enabled: true,
      },
    ]);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    // The losing request logs its conflict, and the redis-less environment
    // warns about idempotency caching. Both are expected here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    requireStaffSession.mockResolvedValue({ ok: false });
    requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    requireAdminSalon.mockResolvedValue({
      error: new Response(null, { status: 401 }),
      salon: null,
    });
    requireClientApiSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    requireAppointmentAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    requireStaffAppointmentAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    sendTransactionalEmail.mockResolvedValue(true);
    sendTransactionalEmailDetailed.mockResolvedValue({ ok: true, errorCode: null, providerMessageId: 'm' });

    await pool.query(`TRUNCATE TABLE
      appointment_audit_log, appointment_payment_link, reward, referral,
      appointment_access_token, appointment_add_on, appointment_services,
      notification_delivery, integration_outbox, appointment,
      salon_client_contact_alias, salon_client
      RESTART IDENTITY CASCADE`);
  });

  afterEach(async () => {
    const releases = [...pendingLockReleases];
    pendingLockReleases.clear();
    const settled = await Promise.allSettled(
      releases.map(release => release()),
    );
    const rejected = settled.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );
    if (rejected) {
      throw rejected.reason;
    }
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

  async function waitForBlockedSessions(
    expectedCount: number,
    blockerPid: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await pool.query<{ count: number }>(`
        WITH RECURSIVE blocking_tree(waiting_pid, blocker_pid) AS (
          SELECT activity.pid, blocker.pid
          FROM pg_stat_activity AS activity
          CROSS JOIN LATERAL
            unnest(pg_blocking_pids(activity.pid)) AS blocker(pid)
          WHERE activity.datname = current_database()
            AND activity.pid <> pg_backend_pid()
            AND activity.state = 'active'
            AND activity.wait_event_type = 'Lock'

          UNION

          SELECT tree.waiting_pid, blocker.pid
          FROM blocking_tree AS tree
          CROSS JOIN LATERAL
            unnest(pg_blocking_pids(tree.blocker_pid)) AS blocker(pid)
        )
        SELECT count(DISTINCT waiting_pid)::int AS count
        FROM blocking_tree
        WHERE blocker_pid = $1
      `, [blockerPid]);
      if ((result.rows[0]?.count ?? 0) >= expectedCount) {
        return;
      }
      // Polling observes PostgreSQL's lock barrier; correctness never depends
      // on one request happening to win within a fixed sleep window.
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Expected ${expectedCount} blocked PostgreSQL sessions`);
  }

  async function waitForBlockedSessionPids(
    expectedCount: number,
    blockerPid: number,
  ): Promise<number[]> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await pool.query<{ pid: number }>(`
        SELECT activity.pid::int AS pid
        FROM pg_stat_activity AS activity
        WHERE activity.datname = current_database()
          AND activity.pid <> pg_backend_pid()
          AND activity.state = 'active'
          AND activity.wait_event_type = 'Lock'
          AND $1 = ANY(pg_blocking_pids(activity.pid))
        ORDER BY activity.pid
      `, [blockerPid]);
      if (result.rows.length >= expectedCount) {
        return result.rows.map(row => row.pid);
      }
      // This observes a real PostgreSQL lock barrier; the race outcome does
      // not depend on how quickly either request reaches the barrier.
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Expected ${expectedCount} blocked PostgreSQL sessions`);
  }

  async function releaseHeldBarrier(
    held: HeldLock,
    expectedCount: number,
    operations: Array<Promise<unknown>>,
  ): Promise<void> {
    try {
      await waitForBlockedSessions(expectedCount, held.pid);
    } catch (error) {
      const cleanup = await Promise.allSettled([
        held.release(),
        ...operations,
      ]);
      const cleanupFailure = cleanup.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (cleanupFailure) {
        throw cleanupFailure.reason;
      }
      throw error;
    }
    const settled = await Promise.allSettled([
      held.release(),
      ...operations,
    ]);
    const rejected = settled.find(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );
    if (rejected) {
      throw rejected.reason;
    }
  }

  type HeldLock = {
    pid: number;
    release: () => Promise<void>;
  };

  async function registerHeldLock(
    connection: pg.PoolClient,
  ): Promise<HeldLock> {
    const pidResult = await connection.query<{ pid: number }>(
      'SELECT pg_backend_pid()::int AS pid',
    );
    let released = false;
    const release = async () => {
      if (released) {
        return;
      }
      released = true;
      pendingLockReleases.delete(release);
      try {
        await connection.query('ROLLBACK');
      } catch (error) {
        connection.release(error instanceof Error ? error : true);
        throw error;
      }
      connection.release();
    };
    pendingLockReleases.add(release);
    return {
      pid: pidResult.rows[0]!.pid,
      release,
    };
  }

  async function holdAdvisoryIdentityKey(
    advisoryKey: string,
  ): Promise<HeldLock> {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [advisoryKey],
      );
      return await registerHeldLock(connection);
    } catch (error) {
      await connection.query('ROLLBACK');
      connection.release();
      throw error;
    }
  }

  async function holdTerminalClient(clientId: string): Promise<HeldLock> {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        'SELECT id FROM salon_client WHERE salon_id = $1 AND id = $2 FOR UPDATE',
        [SALON_ID, clientId],
      );
      return await registerHeldLock(connection);
    } catch (error) {
      await connection.query('ROLLBACK');
      connection.release();
      throw error;
    }
  }

  async function holdSalonRow(): Promise<HeldLock> {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        'SELECT id FROM salon WHERE id = $1 FOR UPDATE',
        [SALON_ID],
      );
      return await registerHeldLock(connection);
    } catch (error) {
      await connection.query('ROLLBACK');
      connection.release();
      throw error;
    }
  }

  async function seedMergedLineage() {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const connectionDb = drizzle(connection, { schema });
      await connectionDb.insert(schema.salonClientSchema).values([
        {
          id: 'client_terminal',
          salonId: SALON_ID,
          phone: '4165553000',
          email: 'terminal@example.invalid',
        },
        {
          id: 'client_source',
          salonId: SALON_ID,
          phone: '4165553001',
          email: 'source@example.invalid',
        },
      ]);
      const before = await connection.query<{ enabled: string }>(`
        SELECT tgenabled AS enabled
        FROM pg_trigger
        WHERE tgrelid = 'public.salon_client'::regclass
          AND tgname = 'salon_client_enforce_merge_transition'
          AND NOT tgisinternal
      `);
      if (before.rows.length !== 1 || before.rows[0]?.enabled !== 'O') {
        throw new Error('Salon client lifecycle trigger was not initially enabled');
      }
      await connection.query(
        'ALTER TABLE public.salon_client DISABLE TRIGGER salon_client_enforce_merge_transition',
      );
      await connectionDb.update(schema.salonClientSchema).set({
        archivedAt: new Date('2099-01-01T00:00:00Z'),
        archivedBy: 'concurrency-test',
        mergedIntoClientId: 'client_terminal',
        mergedAt: new Date('2099-01-01T00:00:00Z'),
        mergedBy: 'concurrency-test',
      }).where(eq(schema.salonClientSchema.id, 'client_source'));
      await connection.query(
        'ALTER TABLE public.salon_client ENABLE TRIGGER salon_client_enforce_merge_transition',
      );
      const enabled = await connection.query<{ enabled: string }>(`
        SELECT tgenabled AS enabled
        FROM pg_trigger
        WHERE tgrelid = 'public.salon_client'::regclass
          AND tgname = 'salon_client_enforce_merge_transition'
          AND NOT tgisinternal
      `);
      if (enabled.rows.length !== 1 || enabled.rows[0]?.enabled !== 'O') {
        throw new Error('Salon client lifecycle trigger was not restored');
      }
      await connectionDb
        .insert(schema.salonClientContactAliasSchema)
        .values([
          {
            salonId: SALON_ID,
            salonClientId: 'client_source',
            kind: 'phone',
            normalizedValue: '4165553002',
          },
          {
            salonId: SALON_ID,
            salonClientId: 'client_source',
            kind: 'email',
            normalizedValue: 'alias@example.invalid',
          },
        ]);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  type SeedAppointmentOptions = {
    id: string;
    status: 'cancelled' | 'completed' | 'confirmed';
    salonClientId: string | null;
    clientPhone: string;
    clientEmail: string | null;
    technicianId?: string;
    startTime?: string;
    canvasState?: 'waiting' | 'cancelled' | 'complete';
  };

  async function seedAppointment(options: SeedAppointmentOptions) {
    const startTime = new Date(
      options.startTime ?? '2099-10-01T15:00:00.000Z',
    );
    const endTime = new Date(startTime.getTime() + 60 * 60_000);
    const canvasState = options.canvasState ?? (options.status === 'completed'
      ? 'complete'
      : options.status === 'cancelled'
        ? 'cancelled'
        : 'waiting');
    const values = {
      id: options.id,
      salonId: SALON_ID,
      salonClientId: options.salonClientId,
      technicianId: options.technicianId ?? TECH_ID,
      clientPhone: options.clientPhone,
      clientEmail: options.clientEmail,
      clientName: 'Historical Racer',
      startTime,
      endTime,
      status: options.status,
      cancelReason: options.status === 'cancelled' ? 'client_request' : null,
      canvasState,
      canvasStateUpdatedAt: new Date('2099-09-01T00:00:00.000Z'),
      totalPrice: 6500,
      totalDurationMinutes: 60,
      blockedDurationMinutes: 70,
      bufferMinutes: 10,
      completedAt: options.status === 'completed'
        ? new Date('2099-09-30T16:00:00.000Z')
        : null,
    };

    // 0062 canonicalizes new stale references at write time. Temporarily
    // replace that behavior only inside one dedicated transaction while
    // seeding an already-existing production-shaped source link. Transactional
    // DDL guarantees any interruption restores the enabled trigger.
    const preserveStaleSource = options.salonClientId === 'client_source';
    let appointment: schema.Appointment | undefined;
    if (preserveStaleSource) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const before = await connection.query<{ enabled: string }>(`
          SELECT tgenabled AS enabled
          FROM pg_trigger
          WHERE tgrelid = 'public.appointment'::regclass
            AND tgname = 'appointment_resolve_merged_client'
            AND NOT tgisinternal
        `);
        if (before.rows.length !== 1 || before.rows[0]?.enabled !== 'O') {
          throw new Error(
            'Appointment lifecycle trigger was not initially enabled',
          );
        }
        await connection.query(
          'ALTER TABLE public.appointment DISABLE TRIGGER appointment_resolve_merged_client',
        );
        const connectionDb = drizzle(connection, { schema });
        [appointment] = await connectionDb
          .insert(schema.appointmentSchema)
          .values(values)
          .returning();
        await connection.query(
          'ALTER TABLE public.appointment ENABLE TRIGGER appointment_resolve_merged_client',
        );
        const enabled = await connection.query<{ enabled: string }>(`
          SELECT tgenabled AS enabled
          FROM pg_trigger
          WHERE tgrelid = 'public.appointment'::regclass
            AND tgname = 'appointment_resolve_merged_client'
            AND NOT tgisinternal
        `);
        if (enabled.rows.length !== 1 || enabled.rows[0]?.enabled !== 'O') {
          throw new Error('Appointment lifecycle trigger was not restored');
        }
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    } else {
      [appointment] = await db
        .insert(schema.appointmentSchema)
        .values(values)
        .returning();
    }
    if (!appointment) {
      throw new Error('Failed to seed concurrency appointment');
    }

    if (appointment.salonClientId) {
      await db.insert(schema.clientCommunicationSchema).values({
        id: `comm_${options.id}`,
        salonId: SALON_ID,
        salonClientId: appointment.salonClientId,
        appointmentId: appointment.id,
        kind: 'reminder',
        status: 'marked_sent',
        messageSnapshot: 'Historical delivery snapshot',
        destinationSnapshot: options.clientPhone,
        markedSentAt: new Date('2099-09-01T00:00:00.000Z'),
      });
    }

    return appointment;
  }

  async function loadAppointment(appointmentId: string) {
    const [appointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(and(
        eq(schema.appointmentSchema.id, appointmentId),
        eq(schema.appointmentSchema.salonId, SALON_ID),
      ))
      .limit(1);
    if (!appointment) {
      throw new Error('Concurrency appointment not found');
    }
    return appointment;
  }

  function configureAppointmentAccess(appointmentId: string) {
    requireAppointmentAccess.mockImplementation(async () => ({
      ok: true,
      actorRole: 'admin',
      admin: { id: 'admin_conc', name: 'Concurrency Admin' },
      appointment: await loadAppointment(appointmentId),
    }));
    requireAppointmentManagerAccess.mockImplementation(async () => ({
      ok: true,
      actorRole: 'admin',
      admin: { id: 'admin_conc', name: 'Concurrency Admin' },
      appointment: await loadAppointment(appointmentId),
    }));
    requireStaffAppointmentAccess.mockImplementation(async () => ({
      ok: true,
      session: {
        salonId: SALON_ID,
        technicianId: TECH_ID,
        technicianName: 'Concurrency Tech',
      },
      appointment: await loadAppointment(appointmentId),
    }));
  }

  async function activeLineageAppointments() {
    return db
      .select()
      .from(schema.appointmentSchema)
      .where(and(
        eq(schema.appointmentSchema.salonId, SALON_ID),
        inArray(
          schema.appointmentSchema.status,
          ['pending', 'confirmed', 'in_progress'],
        ),
      ));
  }

  async function expectCanonicalRaceOutcome(input: {
    originalAppointmentId: string;
    historicalPhone: string;
    historicalEmail: string | null;
    stableClientId?: string;
    bookingResponse?: Response;
    expectedAppointmentCount?: number;
    expectedAuditActions?: string[];
  }) {
    const clients = await db.select().from(schema.salonClientSchema);
    const aliases = await db
      .select()
      .from(schema.salonClientContactAliasSchema);
    const active = await activeLineageAppointments();
    const original = await loadAppointment(input.originalAppointmentId);
    const rewards = await db.select().from(schema.rewardSchema);
    const referrals = await db.select().from(schema.referralSchema);
    const audits = await db.select().from(schema.appointmentAuditLogSchema);
    const deliveries = await db.select().from(schema.notificationDeliverySchema);
    const outbox = await db.select().from(schema.integrationOutboxSchema);
    const communications = await db
      .select()
      .from(schema.clientCommunicationSchema)
      .where(eq(
        schema.clientCommunicationSchema.appointmentId,
        input.originalAppointmentId,
      ));
    const appointmentRows = await db.select().from(schema.appointmentSchema);
    const appointmentServices = await db
      .select()
      .from(schema.appointmentServicesSchema);
    const appointmentAddOns = await db
      .select()
      .from(schema.appointmentAddOnSchema);
    const accessTokens = await db
      .select()
      .from(schema.appointmentAccessTokenSchema);

    expect(clients).toHaveLength(2);

    const terminal = clients.find(client => client.id === 'client_terminal');
    const source = clients.find(client => client.id === 'client_source');

    expect(terminal).toMatchObject({
      salonId: SALON_ID,
      clientId: null,
      phone: '4165553000',
      fullName: null,
      email: 'terminal@example.invalid',
      loyaltyPoints: 0,
      archivedAt: null,
      mergedIntoClientId: null,
      mergedAt: null,
    });
    expect(source).toMatchObject({
      salonId: SALON_ID,
      clientId: null,
      phone: '4165553001',
      fullName: null,
      email: 'source@example.invalid',
      loyaltyPoints: 0,
      mergedIntoClientId: 'client_terminal',
      archivedBy: 'concurrency-test',
      mergedBy: 'concurrency-test',
    });
    expect(source?.archivedAt?.toISOString())
      .toBe('2099-01-01T00:00:00.000Z');
    expect(source?.mergedAt?.toISOString())
      .toBe('2099-01-01T00:00:00.000Z');
    expect(aliases.map(alias => ({
      salonId: alias.salonId,
      salonClientId: alias.salonClientId,
      kind: alias.kind,
      normalizedValue: alias.normalizedValue,
    })).sort((left, right) => left.kind.localeCompare(right.kind)))
      .toEqual([
        {
          salonId: SALON_ID,
          salonClientId: 'client_terminal',
          kind: 'email',
          normalizedValue: 'alias@example.invalid',
        },
        {
          salonId: SALON_ID,
          salonClientId: 'client_terminal',
          kind: 'phone',
          normalizedValue: '4165553002',
        },
      ]);
    expect(active).toHaveLength(1);
    expect(original.clientPhone).toBe(input.historicalPhone);
    expect(original.clientEmail).toBe(input.historicalEmail);
    expect(original.salonClientId).toBe(
      input.stableClientId ?? 'client_source',
    );
    expect(rewards).toHaveLength(0);
    expect(referrals).toHaveLength(0);
    expect(audits.map(row => row.action).sort())
      .toEqual([...(input.expectedAuditActions ?? [])].sort());
    expect(communications).toHaveLength(1);
    expect(communications[0]?.destinationSnapshot)
      .toBe(input.historicalPhone);
    expect(communications[0]?.messageSnapshot)
      .toBe('Historical delivery snapshot');

    if (input.bookingResponse?.status === 409) {
      expect(appointmentRows).toHaveLength(input.expectedAppointmentCount ?? 1);
      expect(appointmentServices).toHaveLength(0);
      expect(appointmentAddOns).toHaveLength(0);
      expect(accessTokens).toHaveLength(0);
      expect(deliveries).toHaveLength(0);
      expect(outbox).toHaveLength(0);
      expect(sendTransactionalEmail).not.toHaveBeenCalled();
      expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    } else if (input.bookingResponse?.status === 201) {
      expect(appointmentRows).toHaveLength(input.expectedAppointmentCount ?? 2);
      expect(appointmentServices).toHaveLength(1);
      expect(appointmentAddOns).toHaveLength(0);
      expect(accessTokens).toHaveLength(1);

      const booking = appointmentRows.find(
        appointment => appointment.id !== input.originalAppointmentId,
      );

      expect(booking).toMatchObject({
        salonId: SALON_ID,
        salonClientId: 'client_terminal',
      });
      expect(appointmentServices[0]?.appointmentId).toBe(booking?.id);
      expect(accessTokens[0]?.appointmentId).toBe(booking?.id);
      expect(deliveries).toHaveLength(2);
      expect(deliveries.map(delivery => ({
        appointmentId: delivery.appointmentId,
        channel: delivery.channel,
        purpose: delivery.purpose,
        status: delivery.status,
      })).sort((left, right) => left.purpose.localeCompare(right.purpose)))
        .toEqual([
          {
            appointmentId: booking?.id,
            channel: 'email',
            purpose: 'booking_confirmation',
            status: 'sent',
          },
          {
            appointmentId: booking?.id,
            channel: 'email',
            purpose: 'salon_new_booking',
            status: 'sent',
          },
        ]);
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        salonId: SALON_ID,
        appointmentId: booking?.id,
        provider: 'google_calendar',
        operation: 'upsert_event',
        status: 'pending',
      });
      expect(sendTransactionalEmail).not.toHaveBeenCalled();
      expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(2);
    } else {
      expect(appointmentRows)
        .toHaveLength(input.expectedAppointmentCount ?? 1);
      expect(appointmentServices).toHaveLength(0);
      expect(appointmentAddOns).toHaveLength(0);
      expect(accessTokens).toHaveLength(0);
      expect(deliveries).toHaveLength(0);
      expect(outbox).toHaveLength(0);
      expect(sendTransactionalEmail).not.toHaveBeenCalled();
      expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    }
  }

  async function expectSingleBookingSideEffects(input: {
    expectedClientCount: number;
    expectedTerminalClientId?: string;
    expectedAliasCount?: number;
  }): Promise<void> {
    const [
      clients,
      aliases,
      appointments,
      services,
      addOns,
      tokens,
      audits,
      rewards,
      referrals,
      deliveries,
      outbox,
    ] = await Promise.all([
      db.select().from(schema.salonClientSchema),
      db.select().from(schema.salonClientContactAliasSchema),
      db.select().from(schema.appointmentSchema),
      db.select().from(schema.appointmentServicesSchema),
      db.select().from(schema.appointmentAddOnSchema),
      db.select().from(schema.appointmentAccessTokenSchema),
      db.select().from(schema.appointmentAuditLogSchema),
      db.select().from(schema.rewardSchema),
      db.select().from(schema.referralSchema),
      db.select().from(schema.notificationDeliverySchema),
      db.select().from(schema.integrationOutboxSchema),
    ]);

    expect(clients).toHaveLength(input.expectedClientCount);
    expect(aliases).toHaveLength(input.expectedAliasCount ?? 0);
    expect(appointments).toHaveLength(1);

    const appointment = appointments[0]!;

    expect(appointment.salonClientId).toBe(
      input.expectedTerminalClientId ?? clients[0]?.id,
    );

    if (!input.expectedTerminalClientId) {
      expect(clients[0]).toMatchObject({
        salonId: SALON_ID,
        email: 'new.identity@example.invalid',
        archivedAt: null,
        mergedIntoClientId: null,
      });
      expect(['4165554000', '4165554001']).toContain(clients[0]?.phone);
    } else if (input.expectedTerminalClientId === 'client_terminal') {
      expect(clients.find(client => client.id === 'client_terminal'))
        .toMatchObject({
          salonId: SALON_ID,
          phone: '4165553000',
          email: 'terminal@example.invalid',
          archivedAt: null,
          mergedIntoClientId: null,
        });
      expect(clients.find(client => client.id === 'client_source'))
        .toMatchObject({
          salonId: SALON_ID,
          phone: '4165553001',
          email: 'source@example.invalid',
          mergedIntoClientId: 'client_terminal',
        });
      expect(aliases.map(alias => ({
        salonClientId: alias.salonClientId,
        kind: alias.kind,
        normalizedValue: alias.normalizedValue,
      })).sort((left, right) => left.kind.localeCompare(right.kind)))
        .toEqual([
          {
            salonClientId: 'client_terminal',
            kind: 'email',
            normalizedValue: 'alias@example.invalid',
          },
          {
            salonClientId: 'client_terminal',
            kind: 'phone',
            normalizedValue: '4165553002',
          },
        ]);
    }

    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      appointmentId: appointment.id,
      serviceId: SERVICE_ID,
    });
    expect(addOns).toHaveLength(0);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      salonId: SALON_ID,
      appointmentId: appointment.id,
      revokedAt: null,
    });
    expect(audits).toHaveLength(0);
    expect(rewards).toHaveLength(0);
    expect(referrals).toHaveLength(0);
    expect(deliveries.map(delivery => ({
      appointmentId: delivery.appointmentId,
      channel: delivery.channel,
      purpose: delivery.purpose,
      status: delivery.status,
    })).sort((left, right) => left.purpose.localeCompare(right.purpose)))
      .toEqual([
        {
          appointmentId: appointment.id,
          channel: 'email',
          purpose: 'booking_confirmation',
          status: 'sent',
        },
        {
          appointmentId: appointment.id,
          channel: 'email',
          purpose: 'salon_new_booking',
          status: 'sent',
        },
      ]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      salonId: SALON_ID,
      appointmentId: appointment.id,
      provider: 'google_calendar',
      operation: 'upsert_event',
      status: 'pending',
    });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendTransactionalEmailDetailed).toHaveBeenCalledTimes(2);
  }

  async function expectErrorCode(
    response: Response,
    expectedCode: string,
  ): Promise<void> {
    expect(response.status).toBe(409);

    const body = await response.clone().json() as {
      error?: { code?: string };
    };

    expect(body.error?.code).toBe(expectedCode);
  }

  function genericReactivationRequest(appointmentId: string) {
    return new Request(`http://localhost/api/appointments/${appointmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    });
  }

  function reopenRequest(appointmentId: string) {
    return new Request(
      `http://localhost/api/appointments/${appointmentId}/reopen`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Concurrency verification' }),
      },
    );
  }

  function transitionRequest(appointmentId: string) {
    return new Request(
      `http://localhost/api/appointments/${appointmentId}/transition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'working' }),
      },
    );
  }

  function startRequest(appointmentId: string) {
    return new Request(
      `http://localhost/api/appointments/${appointmentId}/complete`,
      { method: 'POST' },
    );
  }

  it('serializes phone-versus-email inputs before creating one new profile', async () => {
    const { POST } = await import('./route');
    const held = await holdAdvisoryIdentityKey(JSON.stringify([
      SALON_ID,
      'email',
      'new.identity@example.invalid',
    ]));
    const requests = [
      POST(bookingRequest({
        clientPhone: '4165554000',
        clientEmail: 'NEW.IDENTITY@example.invalid',
        technicianId: TECH_ID,
        startTime: '2099-09-01T15:00:00.000Z',
      })),
      POST(bookingRequest({
        clientPhone: '4165554001',
        clientEmail: 'new.identity@example.invalid',
        technicianId: SECOND_TECH_ID,
        startTime: '2099-09-02T18:00:00.000Z',
      })),
    ];
    await releaseHeldBarrier(held, 2, requests);

    const responses = await Promise.all(requests);

    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);

    const loser = responses.find(response => response.status === 409)!;

    await expectErrorCode(loser, 'EXISTING_APPOINTMENT');
    await expectSingleBookingSideEffects({ expectedClientCount: 1 });
  });

  it('serializes an admin email update against new-profile booking creation', async () => {
    const targetEmail = 'admin-booking-race@example.invalid';
    await db.insert(schema.salonClientSchema).values({
      id: 'client_admin_email_race',
      salonId: SALON_ID,
      phone: '4165554100',
      fullName: 'Existing Profile',
      email: 'existing-profile@example.invalid',
      notes: 'Original notes',
    });
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: SALON_ID,
        slug: 'concurrency-salon',
      },
    });

    const { POST } = await import('./route');
    const { PATCH: updateClient } = await import(
      '../admin/clients/[id]/route'
    );
    const heldSalon = await holdSalonRow();
    const booking = POST(bookingRequest({
      clientPhone: '4165554101',
      clientEmail: targetEmail,
      technicianId: SECOND_TECH_ID,
      startTime: '2099-09-07T18:00:00.000Z',
    }));
    const [bookingPid] = await waitForBlockedSessionPids(1, heldSalon.pid);
    if (!bookingPid) {
      throw new Error('Booking did not reach the salon-row barrier');
    }

    const adminUpdate = updateClient(
      new Request(
        'http://localhost/api/admin/clients/client_admin_email_race',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug: 'concurrency-salon',
            email: targetEmail,
            notes: 'Must roll back when booking wins',
          }),
        },
      ),
      {
        params: Promise.resolve({ id: 'client_admin_email_race' }),
      },
    );

    await waitForBlockedSessions(1, bookingPid);
    await releaseHeldBarrier(heldSalon, 1, [booking, adminUpdate]);

    const [bookingResponse, adminResponse] = await Promise.all([
      booking,
      adminUpdate,
    ]);

    expect(bookingResponse.status).toBe(201);

    await expectErrorCode(adminResponse, 'CONTACT_IDENTITY_CONFLICT');

    const [
      clients,
      appointments,
      rewards,
      referrals,
      deliveries,
      outbox,
    ] = await Promise.all([
      db.select().from(schema.salonClientSchema),
      db.select().from(schema.appointmentSchema),
      db.select().from(schema.rewardSchema),
      db.select().from(schema.referralSchema),
      db.select().from(schema.notificationDeliverySchema),
      db.select().from(schema.integrationOutboxSchema),
    ]);
    const targetOwners = clients.filter(client =>
      client.email?.toLowerCase() === targetEmail);
    const existing = clients.find(client =>
      client.id === 'client_admin_email_race');

    expect(clients).toHaveLength(2);
    expect(targetOwners).toHaveLength(1);
    expect(existing).toMatchObject({
      email: 'existing-profile@example.invalid',
      notes: 'Original notes',
    });
    expect(appointments).toHaveLength(1);
    expect(appointments[0]?.salonClientId).toBe(targetOwners[0]?.id);
    expect(rewards).toHaveLength(0);
    expect(referrals).toHaveLength(0);
    expect(deliveries).toHaveLength(2);
    expect(outbox).toHaveLength(1);
  });

  it('serializes terminal, source, phone-alias, and email-alias bookings', async () => {
    await seedMergedLineage();
    const { POST } = await import('./route');
    const held = await holdTerminalClient('client_terminal');
    const requests = [
      POST(bookingRequest({
        clientPhone: '4165553000',
        clientEmail: 'terminal-only-clue@example.invalid',
        technicianId: TECH_ID,
        startTime: '2099-09-03T15:00:00.000Z',
      })),
      POST(bookingRequest({
        clientPhone: '4165553001',
        clientEmail: 'source-only-clue@example.invalid',
        technicianId: SECOND_TECH_ID,
        startTime: '2099-09-04T18:00:00.000Z',
      })),
      POST(bookingRequest({
        clientPhone: '4165553002',
        clientEmail: 'phone-alias-only@example.invalid',
        technicianId: TECH_ID,
        startTime: '2099-09-05T15:00:00.000Z',
      })),
      POST(bookingRequest({
        clientPhone: '4165553999',
        clientEmail: 'alias@example.invalid',
        technicianId: SECOND_TECH_ID,
        startTime: '2099-09-06T18:00:00.000Z',
      })),
    ];
    await releaseHeldBarrier(held, 4, requests);

    const responses = await Promise.all(requests);

    expect(responses.filter(response => response.status === 201)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(3);

    for (const loser of responses.filter(response => response.status === 409)) {
      await expectErrorCode(loser, 'EXISTING_APPOINTMENT');
    }

    await expectSingleBookingSideEffects({
      expectedClientCount: 2,
      expectedTerminalClientId: 'client_terminal',
      expectedAliasCount: 2,
    });
  });

  it('serializes an alias booking against reopening a stale source appointment', async () => {
    await seedMergedLineage();
    const historicalPhone = '4165553001';
    const historicalEmail = 'source@example.invalid';
    const appointmentId = 'appt_reopen_race';
    await seedAppointment({
      id: appointmentId,
      status: 'completed',
      salonClientId: 'client_source',
      clientPhone: historicalPhone,
      clientEmail: historicalEmail,
      technicianId: TECH_ID,
    });
    configureAppointmentAccess(appointmentId);

    const [{ POST: bookingPOST }, { POST: reopenPOST }] = await Promise.all([
      import('./route'),
      import('./[id]/reopen/route'),
    ]);
    const held = await holdTerminalClient('client_terminal');
    const bookingPromise = bookingPOST(bookingRequest({
      clientPhone: '4165553002',
      clientEmail: 'phone-alias-race@example.invalid',
      technicianId: SECOND_TECH_ID,
      startTime: '2099-10-03T18:00:00.000Z',
    }));
    const reopenPromise = reopenPOST(
      reopenRequest(appointmentId),
      { params: { id: appointmentId } },
    );
    await releaseHeldBarrier(held, 2, [bookingPromise, reopenPromise]);

    const responses = await Promise.all([bookingPromise, reopenPromise]);

    expect(responses.filter(response => response.status < 300)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);

    if (responses[0]!.status === 409) {
      await expectErrorCode(responses[0]!, 'EXISTING_APPOINTMENT');

      expect(responses[1]!.status).toBe(200);
    } else {
      expect(responses[0]!.status).toBe(201);

      await expectErrorCode(
        responses[1]!,
        'CLIENT_ACTIVE_APPOINTMENT_CONFLICT',
      );
    }

    await expectCanonicalRaceOutcome({
      originalAppointmentId: appointmentId,
      historicalPhone,
      historicalEmail,
      bookingResponse: responses[0],
      expectedAuditActions: responses[1]!.status === 200
        ? ['reopened']
        : [],
    });
  });

  it('serializes a terminal booking against generic source reactivation', async () => {
    await seedMergedLineage();
    const historicalPhone = '4165553001';
    const historicalEmail = 'source@example.invalid';
    const appointmentId = 'appt_generic_race';
    await seedAppointment({
      id: appointmentId,
      status: 'cancelled',
      salonClientId: 'client_source',
      clientPhone: historicalPhone,
      clientEmail: historicalEmail,
      technicianId: TECH_ID,
    });
    configureAppointmentAccess(appointmentId);

    const [{ POST: bookingPOST }, { PATCH: reactivatePATCH }]
      = await Promise.all([
        import('./route'),
        import('./[id]/route'),
      ]);
    const held = await holdTerminalClient('client_terminal');
    const bookingPromise = bookingPOST(bookingRequest({
      clientPhone: '4165553000',
      clientEmail: 'terminal@example.invalid',
      technicianId: SECOND_TECH_ID,
      startTime: '2099-10-04T18:00:00.000Z',
    }));
    const reactivationPromise = reactivatePATCH(
      genericReactivationRequest(appointmentId),
      { params: { id: appointmentId } },
    );
    await releaseHeldBarrier(
      held,
      2,
      [bookingPromise, reactivationPromise],
    );

    const responses = await Promise.all([
      bookingPromise,
      reactivationPromise,
    ]);

    expect(responses.filter(response => response.status < 300)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);

    if (responses[0]!.status === 409) {
      await expectErrorCode(responses[0]!, 'EXISTING_APPOINTMENT');

      expect(responses[1]!.status).toBe(200);
    } else {
      expect(responses[0]!.status).toBe(201);

      await expectErrorCode(responses[1]!, 'INVALID_STATE');
    }

    await expectCanonicalRaceOutcome({
      originalAppointmentId: appointmentId,
      historicalPhone,
      historicalEmail,
      bookingResponse: responses[0],
    });
  });

  it('serializes an alias booking against transition-route reactivation', async () => {
    await seedMergedLineage();
    const phone = '4165553000';
    const email = 'transition-snapshot@example.invalid';
    const appointmentId = 'appt_transition_race';
    await seedAppointment({
      id: appointmentId,
      status: 'cancelled',
      salonClientId: 'client_terminal',
      clientPhone: phone,
      clientEmail: email,
      technicianId: TECH_ID,
      startTime: '2099-10-05T15:00:00.000Z',
      canvasState: 'waiting',
    });
    configureAppointmentAccess(appointmentId);

    const [{ POST: bookingPOST }, { POST: transitionPOST }]
      = await Promise.all([
        import('./route'),
        import('./[id]/transition/route'),
      ]);
    const held = await holdTerminalClient('client_terminal');
    const bookingPromise = bookingPOST(bookingRequest({
      clientPhone: '4165553998',
      clientEmail: 'alias@example.invalid',
      technicianId: SECOND_TECH_ID,
      startTime: '2099-10-06T18:00:00.000Z',
    }));
    const transitionPromise = transitionPOST(
      transitionRequest(appointmentId),
      { params: { id: appointmentId } },
    );
    await releaseHeldBarrier(
      held,
      2,
      [bookingPromise, transitionPromise],
    );

    const responses = await Promise.all([
      bookingPromise,
      transitionPromise,
    ]);

    expect(responses.filter(response => response.status < 300)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);

    if (responses[0]!.status === 409) {
      await expectErrorCode(responses[0]!, 'EXISTING_APPOINTMENT');

      expect(responses[1]!.status).toBe(200);
    } else {
      expect(responses[0]!.status).toBe(201);

      await expectErrorCode(
        responses[1]!,
        'CLIENT_ACTIVE_APPOINTMENT_CONFLICT',
      );
    }

    await expectCanonicalRaceOutcome({
      originalAppointmentId: appointmentId,
      historicalPhone: phone,
      historicalEmail: email,
      stableClientId: 'client_terminal',
      bookingResponse: responses[0],
      expectedAuditActions: responses[1]!.status === 200
        ? ['locked', 'status_changed']
        : [],
    });
  });

  it('prevents a stale complete-route start from resurrecting over a new booking', async () => {
    await seedMergedLineage();
    const phone = '4165553001';
    const email = 'complete-snapshot@example.invalid';
    const appointmentId = 'appt_complete_race';
    const cancelledAppointment = await seedAppointment({
      id: appointmentId,
      status: 'cancelled',
      salonClientId: 'client_source',
      clientPhone: phone,
      clientEmail: email,
      technicianId: TECH_ID,
      startTime: '2099-10-07T15:00:00.000Z',
    });
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      admin: { id: 'admin_conc', name: 'Concurrency Admin' },
      // Models a request authorized immediately before cancellation committed.
      appointment: {
        ...cancelledAppointment,
        status: 'confirmed',
        cancelReason: null,
        canvasState: 'waiting',
      },
    });

    const [{ POST: bookingPOST }, { POST: startPOST }]
      = await Promise.all([
        import('./route'),
        import('./[id]/complete/route'),
      ]);
    const held = await holdTerminalClient('client_terminal');
    const bookingPromise = bookingPOST(bookingRequest({
      clientPhone: '4165553002',
      clientEmail: 'complete-phone-alias@example.invalid',
      technicianId: SECOND_TECH_ID,
      startTime: '2099-10-08T18:00:00.000Z',
    }));
    const startPromise = startPOST(
      startRequest(appointmentId),
      { params: { id: appointmentId } },
    );
    await releaseHeldBarrier(held, 2, [bookingPromise, startPromise]);

    const [bookingResponse, startResponse] = await Promise.all([
      bookingPromise,
      startPromise,
    ]);

    expect(bookingResponse.status).toBe(201);

    await expectErrorCode(startResponse, 'APPOINTMENT_STATE_CHANGED');

    await expectCanonicalRaceOutcome({
      originalAppointmentId: appointmentId,
      historicalPhone: phone,
      historicalEmail: email,
      bookingResponse,
    });
  });

  it('allows one of two distinct lineage reactivations to win', async () => {
    await seedMergedLineage();
    const reopenId = 'appt_reopen_competing';
    const transitionId = 'appt_transition_competing';
    await seedAppointment({
      id: reopenId,
      status: 'completed',
      salonClientId: 'client_source',
      clientPhone: '4165553001',
      clientEmail: 'reopen-history@example.invalid',
      technicianId: TECH_ID,
      startTime: '2099-10-09T15:00:00.000Z',
    });
    await seedAppointment({
      id: transitionId,
      status: 'cancelled',
      salonClientId: 'client_terminal',
      clientPhone: '4165553000',
      clientEmail: 'transition-history@example.invalid',
      technicianId: SECOND_TECH_ID,
      startTime: '2099-10-10T18:00:00.000Z',
      canvasState: 'waiting',
    });
    requireAppointmentManagerAccess.mockImplementation(async () => ({
      ok: true,
      actorRole: 'admin',
      admin: { id: 'admin_conc', name: 'Concurrency Admin' },
      appointment: await loadAppointment(reopenId),
    }));
    requireStaffAppointmentAccess.mockImplementation(async () => ({
      ok: true,
      session: {
        salonId: SALON_ID,
        technicianId: SECOND_TECH_ID,
        technicianName: 'Concurrency Tech 2',
      },
      appointment: await loadAppointment(transitionId),
    }));

    const [{ POST: reopenPOST }, { POST: transitionPOST }]
      = await Promise.all([
        import('./[id]/reopen/route'),
        import('./[id]/transition/route'),
      ]);
    const held = await holdTerminalClient('client_terminal');
    const reopenPromise = reopenPOST(
      reopenRequest(reopenId),
      { params: { id: reopenId } },
    );
    const transitionPromise = transitionPOST(
      transitionRequest(transitionId),
      { params: { id: transitionId } },
    );
    await releaseHeldBarrier(
      held,
      2,
      [reopenPromise, transitionPromise],
    );

    const responses = await Promise.all([reopenPromise, transitionPromise]);

    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);

    if (responses[0]!.status === 409) {
      await expectErrorCode(
        responses[0]!,
        'CLIENT_ACTIVE_APPOINTMENT_CONFLICT',
      );

      expect(responses[1]!.status).toBe(200);
    } else {
      expect(responses[0]!.status).toBe(200);

      await expectErrorCode(
        responses[1]!,
        'CLIENT_ACTIVE_APPOINTMENT_CONFLICT',
      );
    }

    expect(await db.select().from(schema.appointmentSchema)).toHaveLength(2);
    expect(await activeLineageAppointments()).toHaveLength(1);

    await expectCanonicalRaceOutcome({
      originalAppointmentId: reopenId,
      historicalPhone: '4165553001',
      historicalEmail: 'reopen-history@example.invalid',
      expectedAppointmentCount: 2,
      expectedAuditActions: responses[0]!.status === 200
        ? ['reopened']
        : ['locked', 'status_changed'],
    });
    const transitionAppointment = await loadAppointment(transitionId);
    const transitionCommunication = await db
      .select()
      .from(schema.clientCommunicationSchema)
      .where(eq(
        schema.clientCommunicationSchema.appointmentId,
        transitionId,
      ));

    expect(transitionAppointment.clientPhone).toBe('4165553000');
    expect(transitionAppointment.clientEmail)
      .toBe('transition-history@example.invalid');
    expect(transitionCommunication[0]?.destinationSnapshot)
      .toBe('4165553000');
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

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
      await pool.query(`TRUNCATE TABLE
        appointment_access_token, appointment_add_on, appointment_services,
        notification_delivery, integration_outbox, appointment,
        salon_client_contact_alias, salon_client
        RESTART IDENTITY CASCADE`);

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
