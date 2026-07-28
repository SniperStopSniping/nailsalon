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
import { createHash, randomUUID } from 'node:crypto';
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
import type { SalonSettings } from '@/types/salonPolicy';

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
const parsedDatabaseUser = parsedConcurrencyUrl
  ? decodeURIComponent(parsedConcurrencyUrl.username)
  : '';
const disposableDatabaseConfirmed
  = process.env.CLIENT_LIFECYCLE_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || process.env.BOOKING_POLICY_ACKNOWLEDGMENT_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || (
    parsedDatabaseName === 'luster_qa'
    && parsedConcurrencyUrl?.username === 'qa'
  );
const IS_LOCAL_THROWAWAY = parsedConcurrencyUrl != null
  && ['127.0.0.1', 'localhost'].includes(parsedConcurrencyUrl.hostname)
  && parsedDatabaseName.length > 0
  && parsedDatabaseUser.length > 0
  && disposableDatabaseConfirmed
  && !RAW_URL.includes('neon.tech');

vi.mock('server-only', () => ({}));
vi.mock('@/core/redis/redisClient', () => ({
  redis: null,
  isRedisAvailable: vi.fn(async () => false),
}));

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
  recordGoogleEventReviewDecision,
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
  recordGoogleEventReviewDecision: vi.fn(),
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
vi.mock('@/libs/googleEventReview', () => ({
  recordGoogleEventReviewDecision,
}));

const SALON_ID = 'salon_conc';
const TECH_ID = 'tech_conc';
const SECOND_TECH_ID = 'tech_conc_2';
const SERVICE_ID = 'svc_conc';
const START_TIME = '2099-09-01T15:00:00.000Z';
const POLICY_TITLE = 'Deposit and cancellation policy';
const POLICY_TEXT
  = 'Please provide at least 24 hours’ notice when cancelling.';
const ACKNOWLEDGMENT_TEXT
  = 'I understand this appointment reserves the technician’s time.';
const BASE_SALON_SETTINGS: SalonSettings = {
  booking: {
    timezone: 'America/Toronto',
    slotIntervalMinutes: 15,
    bufferMinutes: 10,
  },
};

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
      database_user: string;
      application_name: string;
    }>(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        current_setting('application_name') AS application_name
    `);
    if (
      safety.rows[0]?.database_name !== parsedDatabaseName
      || safety.rows[0]?.database_user !== parsedDatabaseUser
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
      appointment_booking_policy_acknowledgment,
      appointment_access_token, appointment_add_on, appointment_services,
      notification_delivery, integration_outbox, google_calendar_event,
      appointment,
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
      settings: BASE_SALON_SETTINGS,
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
    recordGoogleEventReviewDecision.mockResolvedValue(undefined);

    await pool.query(`TRUNCATE TABLE
      audit_log, client_communication, appointment_audit_log,
      appointment_payment_link, reward, referral,
      appointment_booking_policy_acknowledgment,
      appointment_access_token, appointment_add_on, appointment_services,
      notification_delivery, integration_outbox, google_calendar_event,
      appointment,
      salon_client_contact_alias, salon_client
      RESTART IDENTITY CASCADE`);
    await db
      .update(schema.salonSchema)
      .set({
        settings: BASE_SALON_SETTINGS,
        features: null,
        plan: 'single_salon',
      })
      .where(eq(schema.salonSchema.id, SALON_ID));
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

  function requiredPolicySettings(input?: {
    title?: string;
    text?: string;
    acknowledgmentText?: string;
  }): SalonSettings {
    return {
      ...BASE_SALON_SETTINGS,
      bookingExperience: {
        policy: {
          enabled: true,
          title: input?.title ?? POLICY_TITLE,
          text: input?.text ?? POLICY_TEXT,
          showOnServicePage: true,
          showBeforeConfirmation: true,
          showAfterConfirmation: true,
          showInConfirmationEmail: true,
          acknowledgment: {
            required: true,
            text: input?.acknowledgmentText ?? ACKNOWLEDGMENT_TEXT,
          },
        },
      },
    };
  }

  function policyVersion(input?: {
    title?: string;
    text?: string;
    acknowledgmentText?: string;
  }): string {
    const digest = createHash('sha256')
      .update(JSON.stringify({
        schemaVersion: 1,
        title: input?.title ?? POLICY_TITLE,
        text: input?.text ?? POLICY_TEXT,
        acknowledgmentText:
          input?.acknowledgmentText ?? ACKNOWLEDGMENT_TEXT,
      }), 'utf8')
      .digest('hex');
    return `policy-v1:${digest}`;
  }

  async function configureRequiredPolicy(
    input?: Parameters<typeof requiredPolicySettings>[0],
  ): Promise<void> {
    await db
      .update(schema.salonSchema)
      .set({ settings: requiredPolicySettings(input) })
      .where(eq(schema.salonSchema.id, SALON_ID));
  }

  function policyAcknowledgment(
    attemptId = randomUUID(),
    version = policyVersion(),
  ) {
    return {
      accepted: true,
      version,
      attemptId,
    };
  }

  async function policyAcknowledgments() {
    return db
      .select()
      .from(schema.appointmentBookingPolicyAcknowledgmentSchema);
  }

  function postgresErrorDetails(error: unknown): {
    code: string | null;
    constraint: string | null;
  } {
    let current = error;
    for (let depth = 0; depth < 4; depth += 1) {
      if (!current || typeof current !== 'object') {
        break;
      }
      const candidate = current as {
        code?: unknown;
        constraint?: unknown;
        cause?: unknown;
      };
      if (
        typeof candidate.code === 'string'
        || typeof candidate.constraint === 'string'
      ) {
        return {
          code: typeof candidate.code === 'string' ? candidate.code : null,
          constraint: typeof candidate.constraint === 'string'
            ? candidate.constraint
            : null,
        };
      }
      current = candidate.cause;
    }
    return { code: null, constraint: null };
  }

  function acknowledgmentSnapshotValues(
    appointment: typeof schema.appointmentSchema.$inferSelect,
    overrides: Partial<
      typeof schema.appointmentBookingPolicyAcknowledgmentSchema.$inferInsert
    > = {},
  ): typeof schema.appointmentBookingPolicyAcknowledgmentSchema.$inferInsert {
    return {
      id: `policy_ack_${randomUUID()}`,
      salonId: appointment.salonId,
      appointmentId: appointment.id,
      policyVersion: policyVersion(),
      policyTitleSnapshot: POLICY_TITLE,
      policyTextSnapshot: POLICY_TEXT,
      acknowledgmentTextSnapshot: ACKNOWLEDGMENT_TEXT,
      source: 'public_booking',
      scheduledStartAtSnapshot: appointment.startTime,
      scheduledEndAtSnapshot: appointment.endTime,
      attemptId: randomUUID(),
      requestHash: 'a'.repeat(64),
      appointmentUpdatedAtSnapshot: appointment.updatedAt,
      reservationRevisionSnapshot: null,
      ...overrides,
    };
  }

  async function activeAppointments() {
    return db.select().from(schema.appointmentSchema);
  }

  async function loadExactClientUpdatedAtVersion(
    clientId: string,
  ): Promise<string> {
    const result = await pool.query<{ updated_at_version: string }>(
      `SELECT to_char(
         updated_at,
         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
       ) AS updated_at_version
       FROM salon_client
       WHERE salon_id = $1 AND id = $2`,
      [SALON_ID, clientId],
    );
    const version = result.rows[0]?.updated_at_version;
    if (!version) {
      throw new Error('Failed to load exact salon client version');
    }
    return version;
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

  async function holdSalonPolicyUpdate(
    settings: SalonSettings,
  ): Promise<HeldLock & { commit: () => Promise<void> }> {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        'UPDATE salon SET settings = $2::jsonb WHERE id = $1',
        [SALON_ID, JSON.stringify(settings)],
      );
      const pidResult = await connection.query<{ pid: number }>(
        'SELECT pg_backend_pid()::int AS pid',
      );
      let finished = false;
      const release = async () => {
        if (finished) {
          return;
        }
        finished = true;
        pendingLockReleases.delete(release);
        try {
          await connection.query('ROLLBACK');
        } finally {
          connection.release();
        }
      };
      const commit = async () => {
        if (finished) {
          return;
        }
        finished = true;
        pendingLockReleases.delete(release);
        try {
          await connection.query('COMMIT');
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
        commit,
      };
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
    const [existingProfile] = await db
      .insert(schema.salonClientSchema)
      .values({
        id: 'client_admin_email_race',
        salonId: SALON_ID,
        phone: '4165554100',
        fullName: 'Existing Profile',
        email: 'existing-profile@example.invalid',
        notes: 'Original notes',
      })
      .returning();
    if (!existingProfile) {
      throw new Error('Failed to seed admin edit race profile');
    }
    const existingProfileVersion = await loadExactClientUpdatedAtVersion(
      existingProfile.id,
    );
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
            expectedUpdatedAt: existingProfileVersion,
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

  it('waits for a pending global identity writer and then fails the contact edit closed', async () => {
    const proposedPhone = '+14165554199';
    const globalClientId = 'global_client_edit_identity_race';
    const [profile] = await db
      .insert(schema.salonClientSchema)
      .values({
        id: 'client_external_identity_race',
        salonId: SALON_ID,
        phone: '4165554198',
        fullName: 'External Identity Race',
        email: 'external-identity-race@example.invalid',
      })
      .returning();
    if (!profile) {
      throw new Error('Failed to seed external identity race profile');
    }
    const profileVersion = await loadExactClientUpdatedAtVersion(profile.id);

    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: SALON_ID,
        slug: 'concurrency-salon',
      },
    });

    const writer = await pool.connect();
    let writerFinished = false;
    let updatePromise: Promise<Response> | null = null;
    try {
      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO client (id, phone, first_name, email)
         VALUES ($1, $2, $3, $4)`,
        [
          globalClientId,
          proposedPhone,
          'External',
          'global-identity-race@example.invalid',
        ],
      );
      const writerPidResult = await writer.query<{ pid: number }>(
        'SELECT pg_backend_pid()::int AS pid',
      );
      const writerPid = writerPidResult.rows[0]?.pid;
      if (!writerPid) {
        throw new Error('Failed to identify external identity writer');
      }

      const { PATCH: updateClient } = await import(
        '../admin/clients/[id]/route'
      );
      updatePromise = updateClient(
        new Request(
          'http://localhost/api/admin/clients/client_external_identity_race',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              salonSlug: 'concurrency-salon',
              phone: proposedPhone,
              expectedUpdatedAt: profileVersion,
            }),
          },
        ),
        {
          params: Promise.resolve({
            id: 'client_external_identity_race',
          }),
        },
      );

      await waitForBlockedSessions(1, writerPid);
      const linked = await writer.query(
        `UPDATE salon_client
         SET client_id = $1
         WHERE salon_id = $2 AND id = $3`,
        [
          globalClientId,
          SALON_ID,
          'client_external_identity_race',
        ],
      );

      expect(linked.rowCount).toBe(1);

      await writer.query('COMMIT');
      writerFinished = true;

      const response = await updatePromise;
      const body = await response.json() as {
        error?: { code?: string; message?: string };
      };

      expect(response.status).toBe(409);
      expect(body.error?.code).toBe('UNSUPPORTED_CLIENT_IDENTITY');
      expect(body.error?.message).not.toMatch(
        /customer login|session|foreign|global/i,
      );
      expect(JSON.stringify(body)).not.toContain(proposedPhone);
      expect(JSON.stringify(body)).not.toContain(globalClientId);

      const [stored] = await db
        .select()
        .from(schema.salonClientSchema)
        .where(eq(
          schema.salonClientSchema.id,
          'client_external_identity_race',
        ))
        .limit(1);
      const audits = await db
        .select()
        .from(schema.auditLogSchema)
        .where(eq(
          schema.auditLogSchema.entityId,
          'client_external_identity_race',
        ));

      expect(stored).toMatchObject({
        clientId: globalClientId,
        phone: '4165554198',
        email: 'external-identity-race@example.invalid',
      });
      expect(stored?.updatedAt).toEqual(profile.updatedAt);
      expect(audits).toHaveLength(0);
    } finally {
      if (!writerFinished) {
        await writer.query('ROLLBACK').catch(() => {});
      }
      writer.release();
      if (updatePromise) {
        await updatePromise.catch(() => undefined);
      }
      await pool.query(
        'DELETE FROM client_session WHERE client_phone = $1',
        [proposedPhone],
      );
      await pool.query(
        `UPDATE salon_client
         SET client_id = NULL
         WHERE salon_id = $1 AND id = $2`,
        [SALON_ID, 'client_external_identity_race'],
      );
      await pool.query(
        'DELETE FROM client WHERE id = $1',
        [globalClientId],
      );
    }
  });

  it('fails a contact edit closed within the global identity lock deadline', async () => {
    const [profile] = await db
      .insert(schema.salonClientSchema)
      .values({
        id: 'client_global_lock_timeout',
        salonId: SALON_ID,
        phone: '4165554210',
        fullName: 'Global Lock Timeout',
        email: 'global-lock-timeout@example.invalid',
        notes: 'Original timeout note',
      })
      .returning();
    if (!profile) {
      throw new Error('Failed to seed global lock timeout profile');
    }
    const profileVersion = await loadExactClientUpdatedAtVersion(profile.id);

    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: SALON_ID,
        slug: 'concurrency-salon',
      },
    });

    const blocker = await pool.connect();
    let held: HeldLock | null = null;
    let updatePromise: Promise<Response> | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE client IN ROW EXCLUSIVE MODE');
      held = await registerHeldLock(blocker);

      const { PATCH: updateClient } = await import(
        '../admin/clients/[id]/route'
      );
      const startedAt = Date.now();
      updatePromise = updateClient(
        new Request(
          'http://localhost/api/admin/clients/client_global_lock_timeout',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              salonSlug: 'concurrency-salon',
              phone: '+1 (416) 555-4211',
              notes: 'Must roll back with the timed-out contact edit',
              expectedUpdatedAt: profileVersion,
            }),
          },
        ),
        {
          params: Promise.resolve({
            id: 'client_global_lock_timeout',
          }),
        },
      );

      await waitForBlockedSessions(1, held.pid);
      const response = await Promise.race([
        updatePromise,
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(
            () => reject(new Error(
              'Contact edit exceeded its global identity lock deadline',
            )),
            7_000,
          );
        }),
      ]);
      const elapsedMilliseconds = Date.now() - startedAt;
      const body = await response.json() as {
        error?: { code?: string; message?: string };
      };
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(409);
      expect(body.error?.code).toBe('CLIENT_EDIT_CONFLICT');
      expect(response.headers.get('cache-control')).toContain('private');
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(elapsedMilliseconds).toBeLessThan(7_000);
      expect(serialized).not.toMatch(
        /55P03|57014|lock timeout|statement timeout|client_session/i,
      );
      expect(serialized).not.toContain('4165554211');
      expect(serialized).not.toContain('client_global_lock_timeout');

      const [stored, aliases, audits] = await Promise.all([
        db
          .select()
          .from(schema.salonClientSchema)
          .where(eq(
            schema.salonClientSchema.id,
            'client_global_lock_timeout',
          ))
          .limit(1)
          .then(rows => rows[0]),
        db
          .select()
          .from(schema.salonClientContactAliasSchema)
          .where(eq(
            schema.salonClientContactAliasSchema.salonClientId,
            'client_global_lock_timeout',
          )),
        db
          .select()
          .from(schema.auditLogSchema)
          .where(eq(
            schema.auditLogSchema.entityId,
            'client_global_lock_timeout',
          )),
      ]);

      expect(stored).toMatchObject({
        phone: '4165554210',
        email: 'global-lock-timeout@example.invalid',
        notes: 'Original timeout note',
      });
      expect(stored?.updatedAt).toEqual(profile.updatedAt);
      expect(aliases).toHaveLength(0);
      expect(audits).toHaveLength(0);
    } finally {
      if (deadline) {
        clearTimeout(deadline);
      }
      if (held) {
        await held.release();
      } else {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
      if (updatePromise) {
        await updatePromise.catch(() => undefined);
      }
    }
  });

  it('distinguishes same-millisecond versions and accepts an identical stale retry', async () => {
    const clientId = 'client_edit_microsecond_cas';
    await db
      .insert(schema.salonClientSchema)
      .values({
        id: clientId,
        salonId: SALON_ID,
        phone: '4165554220',
        fullName: 'Microsecond CAS Profile',
        email: 'microsecond-cas@example.invalid',
        notes: 'Original microsecond note',
      });
    await pool.query(
      `UPDATE salon_client
       SET updated_at = TIMESTAMP '2026-07-25 11:00:00.123456'
       WHERE salon_id = $1 AND id = $2`,
      [SALON_ID, clientId],
    );
    const staleVersion = await loadExactClientUpdatedAtVersion(clientId);

    await pool.query(
      `UPDATE salon_client
       SET notes = $1,
           updated_at = TIMESTAMP '2026-07-25 11:00:00.123457'
       WHERE salon_id = $2 AND id = $3`,
      ['Already saved elsewhere', SALON_ID, clientId],
    );
    const currentVersion = await loadExactClientUpdatedAtVersion(clientId);

    expect(staleVersion).toBe('2026-07-25T11:00:00.123456Z');
    expect(currentVersion).toBe('2026-07-25T11:00:00.123457Z');
    expect(new Date(staleVersion).getTime())
      .toBe(new Date(currentVersion).getTime());

    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: SALON_ID,
        slug: 'concurrency-salon',
      },
    });
    const { PATCH: updateClient } = await import(
      '../admin/clients/[id]/route'
    );
    const edit = (notes: string) =>
      updateClient(
        new Request(`http://localhost/api/admin/clients/${clientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug: 'concurrency-salon',
            expectedUpdatedAt: staleVersion,
            notes,
          }),
        }),
        { params: Promise.resolve({ id: clientId }) },
      );

    const retry = await edit('Already saved elsewhere');
    const retryBody = await retry.json() as {
      data: { client: { notes: string; updatedAt: string } };
      meta: { idempotent: boolean };
    };

    expect(retry.status).toBe(200);
    expect(retryBody.meta.idempotent).toBe(true);
    expect(retryBody.data.client).toMatchObject({
      notes: 'Already saved elsewhere',
      updatedAt: currentVersion,
    });

    const conflict = await edit('My stale pending edit');

    expect(conflict.status).toBe(409);

    await expectErrorCode(conflict, 'CLIENT_EDIT_CONFLICT');

    const [stored, aliases, audits] = await Promise.all([
      db
        .select()
        .from(schema.salonClientSchema)
        .where(eq(schema.salonClientSchema.id, clientId))
        .limit(1)
        .then(rows => rows[0]),
      db
        .select()
        .from(schema.salonClientContactAliasSchema)
        .where(eq(
          schema.salonClientContactAliasSchema.salonClientId,
          clientId,
        )),
      db
        .select()
        .from(schema.auditLogSchema)
        .where(eq(schema.auditLogSchema.entityId, clientId)),
    ]);

    expect(stored).toMatchObject({
      notes: 'Already saved elsewhere',
    });
    expect(await loadExactClientUpdatedAtVersion(clientId))
      .toBe(currentVersion);
    expect(aliases).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('lets one simultaneous edit win and treats its exact stale retry as idempotent', async () => {
    const [profile] = await db
      .insert(schema.salonClientSchema)
      .values({
        id: 'client_edit_cas_race',
        salonId: SALON_ID,
        phone: '4165554200',
        fullName: 'CAS Profile',
        email: 'cas-profile@example.invalid',
        notes: 'Original CAS note',
      })
      .returning();
    if (!profile) {
      throw new Error('Failed to seed CAS edit profile');
    }
    const profileVersion = await loadExactClientUpdatedAtVersion(profile.id);

    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: SALON_ID,
        slug: 'concurrency-salon',
      },
    });

    const { PATCH: updateClient } = await import(
      '../admin/clients/[id]/route'
    );
    const editRequest = (notes: string) =>
      new Request(
        'http://localhost/api/admin/clients/client_edit_cas_race',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug: 'concurrency-salon',
            notes,
            expectedUpdatedAt: profileVersion,
          }),
        },
      );
    const editContext = {
      params: Promise.resolve({ id: 'client_edit_cas_race' }),
    };
    const held = await holdTerminalClient('client_edit_cas_race');
    const first = updateClient(
      editRequest('CAS edit alpha'),
      editContext,
    );
    const second = updateClient(
      editRequest('CAS edit beta'),
      {
        params: Promise.resolve({ id: 'client_edit_cas_race' }),
      },
    );

    await releaseHeldBarrier(held, 2, [first, second]);

    const responses = await Promise.all([first, second]);
    const winner = responses.find(response => response.status === 200);
    const loser = responses.find(response => response.status === 409);

    expect(winner).toBeDefined();
    expect(loser).toBeDefined();

    await expectErrorCode(loser!, 'CLIENT_EDIT_CONFLICT');

    const winnerBody = await winner!.json() as {
      data: { client: { notes: string; updatedAt: string } };
    };
    const winningNotes = winnerBody.data.client.notes;
    const [storedAfterRace] = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'client_edit_cas_race'))
      .limit(1);
    const auditsAfterRace = await db
      .select()
      .from(schema.auditLogSchema)
      .where(eq(
        schema.auditLogSchema.entityId,
        'client_edit_cas_race',
      ));

    expect(['CAS edit alpha', 'CAS edit beta']).toContain(winningNotes);
    expect(storedAfterRace).toMatchObject({
      id: 'client_edit_cas_race',
      notes: winningNotes,
    });
    expect(await loadExactClientUpdatedAtVersion('client_edit_cas_race'))
      .toBe(winnerBody.data.client.updatedAt);
    expect(auditsAfterRace).toHaveLength(1);
    expect(auditsAfterRace[0]).toMatchObject({
      actorType: 'admin',
      action: 'updated',
      entityType: 'salon_client',
      entityId: 'client_edit_cas_race',
    });
    expect(auditsAfterRace[0]?.metadata).toEqual({
      terminalClientId: 'client_edit_cas_race',
      changedFields: ['notes'],
      redirectedFromStaleSource: false,
    });
    expect(JSON.stringify(auditsAfterRace[0]?.metadata))
      .not.toContain(winningNotes);

    const retry = await updateClient(
      editRequest(winningNotes),
      {
        params: Promise.resolve({ id: 'client_edit_cas_race' }),
      },
    );
    const retryBody = await retry.json() as {
      data: { client: { notes: string; updatedAt: string } };
    };

    expect(retry.status).toBe(200);
    expect(retryBody.data.client).toMatchObject({
      notes: winningNotes,
      updatedAt: winnerBody.data.client.updatedAt,
    });

    const [storedAfterRetry] = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'client_edit_cas_race'))
      .limit(1);
    const auditsAfterRetry = await db
      .select()
      .from(schema.auditLogSchema)
      .where(eq(
        schema.auditLogSchema.entityId,
        'client_edit_cas_race',
      ));

    expect(storedAfterRetry?.updatedAt).toEqual(storedAfterRace?.updatedAt);
    expect(auditsAfterRetry).toEqual(auditsAfterRace);
  });

  it('keeps one-active-appointment protection across current and replaced contacts', async () => {
    await seedMergedLineage();
    const [terminalBefore] = await db
      .select()
      .from(schema.salonClientSchema)
      .where(eq(schema.salonClientSchema.id, 'client_terminal'))
      .limit(1);
    if (!terminalBefore) {
      throw new Error('Failed to seed contact edit terminal');
    }
    const terminalVersion = await loadExactClientUpdatedAtVersion(
      terminalBefore.id,
    );

    await seedAppointment({
      id: 'appointment_before_contact_edit',
      status: 'confirmed',
      salonClientId: 'client_source',
      clientPhone: '4165553001',
      clientEmail: 'source@example.invalid',
      startTime: '2099-10-01T15:00:00.000Z',
    });
    const appointmentBefore = await loadAppointment(
      'appointment_before_contact_edit',
    );
    const communicationsBefore = await db
      .select()
      .from(schema.clientCommunicationSchema)
      .where(eq(
        schema.clientCommunicationSchema.appointmentId,
        'appointment_before_contact_edit',
      ));

    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: {
        id: SALON_ID,
        slug: 'concurrency-salon',
      },
    });

    const [{ PATCH: updateClient }, { POST }] = await Promise.all([
      import('../admin/clients/[id]/route'),
      import('./route'),
    ]);
    const updateResponse = await updateClient(
      new Request(
        'http://localhost/api/admin/clients/client_source',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug: 'concurrency-salon',
            phone: '+1 (416) 555-3111',
            email: 'EDITED.CONTACT@example.invalid',
            expectedUpdatedAt: terminalVersion,
          }),
        },
      ),
      {
        params: Promise.resolve({ id: 'client_source' }),
      },
    );
    const updateBody = await updateResponse.json() as {
      data?: { client?: { id?: string; phone?: string; email?: string } };
    };

    expect(updateResponse.status).toBe(200);
    expect(updateBody.data?.client).toMatchObject({
      id: 'client_terminal',
      phone: '4165553111',
      email: 'edited.contact@example.invalid',
    });

    const currentContactBooking = await POST(bookingRequest({
      clientPhone: '4165553111',
      clientEmail: 'edited.contact@example.invalid',
      technicianId: SECOND_TECH_ID,
      startTime: '2099-09-08T18:00:00.000Z',
    }));
    const replacedContactBooking = await POST(bookingRequest({
      clientPhone: '4165553000',
      clientEmail: 'old-contact-clue@example.invalid',
      technicianId: SECOND_TECH_ID,
      startTime: '2099-09-09T18:00:00.000Z',
    }));

    await expectErrorCode(currentContactBooking, 'EXISTING_APPOINTMENT');
    await expectErrorCode(replacedContactBooking, 'EXISTING_APPOINTMENT');

    const [
      clients,
      aliases,
      appointments,
      communicationsAfter,
      audits,
      rewards,
      referrals,
      services,
      accessTokens,
      deliveries,
      outbox,
    ] = await Promise.all([
      db.select().from(schema.salonClientSchema),
      db.select().from(schema.salonClientContactAliasSchema),
      db.select().from(schema.appointmentSchema),
      db.select().from(schema.clientCommunicationSchema),
      db.select().from(schema.auditLogSchema),
      db.select().from(schema.rewardSchema),
      db.select().from(schema.referralSchema),
      db.select().from(schema.appointmentServicesSchema),
      db.select().from(schema.appointmentAccessTokenSchema),
      db.select().from(schema.notificationDeliverySchema),
      db.select().from(schema.integrationOutboxSchema),
    ]);

    expect(clients).toHaveLength(2);
    expect(clients.find(client => client.id === 'client_terminal'))
      .toMatchObject({
        phone: '4165553111',
        email: 'edited.contact@example.invalid',
        loyaltyPoints: terminalBefore.loyaltyPoints,
        totalSpent: terminalBefore.totalSpent,
      });
    expect(clients.find(client => client.id === 'client_source'))
      .toMatchObject({
        phone: '4165553001',
        email: 'source@example.invalid',
        mergedIntoClientId: 'client_terminal',
      });
    expect(aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        salonId: SALON_ID,
        salonClientId: 'client_terminal',
        kind: 'phone',
        normalizedValue: '4165553000',
      }),
      expect.objectContaining({
        salonId: SALON_ID,
        salonClientId: 'client_terminal',
        kind: 'email',
        normalizedValue: 'terminal@example.invalid',
      }),
    ]));
    expect(appointments).toEqual([appointmentBefore]);
    expect(communicationsAfter).toEqual(communicationsBefore);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityId: 'client_terminal',
    });
    expect(audits[0]?.metadata).toEqual({
      terminalClientId: 'client_terminal',
      changedFields: ['email', 'phone'],
      redirectedFromStaleSource: true,
    });
    expect(rewards).toHaveLength(0);
    expect(referrals).toHaveLength(0);
    expect(services).toHaveLength(0);
    expect(accessTokens).toHaveLength(0);
    expect(deliveries).toHaveLength(0);
    expect(outbox).toHaveLength(0);
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

  it('atomically stores a server-owned policy snapshot with a public booking', async () => {
    await configureRequiredPolicy();
    const attemptId = randomUUID();
    const { POST } = await import('./route');

    const response = await POST(bookingRequest({
      bookingPolicyAcknowledgment: policyAcknowledgment(attemptId),
    }));

    expect(response.status).toBe(201);

    const appointments = await activeAppointments();
    const acknowledgments = await policyAcknowledgments();

    expect(appointments).toHaveLength(1);
    expect(acknowledgments).toHaveLength(1);
    expect(acknowledgments[0]).toMatchObject({
      salonId: SALON_ID,
      appointmentId: appointments[0]!.id,
      policyVersion: policyVersion(),
      policyTitleSnapshot: POLICY_TITLE,
      policyTextSnapshot: POLICY_TEXT,
      acknowledgmentTextSnapshot: ACKNOWLEDGMENT_TEXT,
      source: 'public_booking',
      scheduledStartAtSnapshot: appointments[0]!.startTime,
      scheduledEndAtSnapshot: appointments[0]!.endTime,
      attemptId,
      appointmentUpdatedAtSnapshot: appointments[0]!.updatedAt,
      reservationRevisionSnapshot: null,
    });
    expect(acknowledgments[0]!.requestHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rolls back the appointment and transaction-created children when the acknowledgment insert fails', async () => {
    await configureRequiredPolicy();
    await pool.query(`
      CREATE FUNCTION fail_booking_policy_ack_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced acknowledgment insertion failure';
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER fail_booking_policy_ack_insert
      BEFORE INSERT ON appointment_booking_policy_acknowledgment
      FOR EACH ROW EXECUTE FUNCTION fail_booking_policy_ack_insert()
    `);

    let response: Response;
    try {
      const { POST } = await import('./route');
      response = await POST(bookingRequest({
        bookingPolicyAcknowledgment: policyAcknowledgment(),
      }));
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS fail_booking_policy_ack_insert
          ON appointment_booking_policy_acknowledgment
      `);
      await pool.query(
        'DROP FUNCTION IF EXISTS fail_booking_policy_ack_insert()',
      );
    }

    expect(response!.status).toBe(500);

    const [
      appointments,
      acknowledgments,
      clients,
      accessTokens,
      services,
      addOns,
    ] = await Promise.all([
      activeAppointments(),
      policyAcknowledgments(),
      db.select().from(schema.salonClientSchema),
      db.select().from(schema.appointmentAccessTokenSchema),
      db.select().from(schema.appointmentServicesSchema),
      db.select().from(schema.appointmentAddOnSchema),
    ]);

    expect(appointments).toHaveLength(0);
    expect(acknowledgments).toHaveLength(0);
    expect(clients).toHaveLength(0);
    expect(accessTokens).toHaveLength(0);
    expect(services).toHaveLength(0);
    expect(addOns).toHaveLength(0);
  });

  it('rejects a cross-salon appointment binding through the composite foreign key', async () => {
    const { POST } = await import('./route');
    const response = await POST(bookingRequest());

    expect(response.status).toBe(201);

    const [appointment] = await activeAppointments();

    expect(appointment).toBeDefined();

    const otherSalonId = 'salon_ack_foreign';
    await db.insert(schema.salonSchema).values({
      id: otherSalonId,
      name: 'Foreign Acknowledgment Salon',
      slug: 'foreign-acknowledgment-salon',
      plan: 'single_salon',
      status: 'active',
      publicationStatus: 'published',
      isActive: true,
    });

    let insertionError: unknown;
    try {
      await db
        .insert(schema.appointmentBookingPolicyAcknowledgmentSchema)
        .values(acknowledgmentSnapshotValues(appointment!, {
          salonId: otherSalonId,
        }));
    } catch (error) {
      insertionError = error;
    } finally {
      await db
        .delete(schema.salonSchema)
        .where(eq(schema.salonSchema.id, otherSalonId));
    }

    expect(postgresErrorDetails(insertionError)).toEqual({
      code: '23503',
      constraint: 'appointment_booking_policy_ack_appointment_fk',
    });
    expect(await policyAcknowledgments()).toHaveLength(0);
  });

  it('allows one attempt UUID to bind to only one appointment in a salon/source', async () => {
    await configureRequiredPolicy();
    const attemptId = randomUUID();
    const { POST } = await import('./route');
    const response = await POST(bookingRequest({
      bookingPolicyAcknowledgment: policyAcknowledgment(attemptId),
    }));

    expect(response.status).toBe(201);

    await seedAppointment({
      id: 'appt_second_ack_target',
      status: 'confirmed',
      salonClientId: null,
      clientPhone: '4165552999',
      clientEmail: 'second-target@example.invalid',
      technicianId: SECOND_TECH_ID,
      startTime: '2099-09-03T15:00:00.000Z',
    });
    const [secondAppointment] = await db
      .select()
      .from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, 'appt_second_ack_target'))
      .limit(1);

    let insertionError: unknown;
    try {
      await db
        .insert(schema.appointmentBookingPolicyAcknowledgmentSchema)
        .values(acknowledgmentSnapshotValues(secondAppointment!, {
          attemptId,
          requestHash: 'b'.repeat(64),
        }));
    } catch (error) {
      insertionError = error;
    }

    expect(postgresErrorDetails(insertionError)).toEqual({
      code: '23505',
      constraint: 'booking_policy_ack_attempt_unique',
    });
    expect(await policyAcknowledgments()).toHaveLength(1);
  });

  it('creates no duplicate acknowledgment evidence for identical concurrent Redis-less requests', async () => {
    await configureRequiredPolicy();
    const acknowledgment = policyAcknowledgment();
    const { POST } = await import('./route');

    const responses = await Promise.all([
      POST(bookingRequest({ bookingPolicyAcknowledgment: acknowledgment })),
      POST(bookingRequest({ bookingPolicyAcknowledgment: acknowledgment })),
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await activeAppointments()).toHaveLength(1);
    expect(await policyAcknowledgments()).toHaveLength(1);
  });

  it('rejects one attempt UUID reused with a different canonical request hash', async () => {
    await configureRequiredPolicy();
    const attemptId = randomUUID();
    const { POST } = await import('./route');
    const first = await POST(bookingRequest({
      bookingPolicyAcknowledgment: policyAcknowledgment(attemptId),
    }));

    expect(first.status).toBe(201);

    const changed = await POST(bookingRequest({
      technicianId: SECOND_TECH_ID,
      startTime: '2099-09-04T15:00:00.000Z',
      clientName: 'Changed Attempt',
      clientEmail: 'changed-attempt@example.invalid',
      clientPhone: '4165552444',
      bookingPolicyAcknowledgment: policyAcknowledgment(attemptId),
    }));
    const body = await changed.json();

    expect(changed.status).toBe(409);
    expect(body).toMatchObject({
      error: 'ACKNOWLEDGMENT_ATTEMPT_REUSED',
      message: 'This booking attempt changed. Please confirm the appointment again.',
    });
    expect(await activeAppointments()).toHaveLength(1);
    expect(await policyAcknowledgments()).toHaveLength(1);
  });

  it('atomically rejects concurrent changed requests sharing one attempt UUID', async () => {
    await configureRequiredPolicy();
    const attemptId = randomUUID();
    const { POST } = await import('./route');

    const responses = await Promise.all([
      POST(bookingRequest({
        bookingPolicyAcknowledgment: policyAcknowledgment(attemptId),
      })),
      POST(bookingRequest({
        technicianId: SECOND_TECH_ID,
        startTime: '2099-09-04T15:00:00.000Z',
        clientName: 'Concurrent Changed Attempt',
        clientEmail: 'concurrent-changed@example.invalid',
        clientPhone: '4165552444',
        bookingPolicyAcknowledgment: policyAcknowledgment(attemptId),
      })),
    ]);
    const successful = responses.filter(response => response.status === 201);
    const rejected = responses.filter(response => response.status === 409);

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    await expect(rejected[0]!.json()).resolves.toMatchObject({
      error: 'ACKNOWLEDGMENT_ATTEMPT_REUSED',
      message: 'This booking attempt changed. Please confirm the appointment again.',
    });
    expect(await activeAppointments()).toHaveLength(1);
    expect(await policyAcknowledgments()).toHaveLength(1);
    expect(await db.select().from(schema.salonClientSchema)).toHaveLength(1);
  });

  it('waits for a concurrent policy writer and rejects the now-stale wording', async () => {
    await configureRequiredPolicy();
    const staleAcknowledgment = policyAcknowledgment();
    const nextPolicy = {
      title: 'Updated cancellation policy',
      text: 'Please provide at least 48 hours’ notice when cancelling.',
      acknowledgmentText:
        'I reviewed the updated policy and will contact the salon promptly.',
    };
    const held = await holdSalonPolicyUpdate(
      requiredPolicySettings(nextPolicy),
    );
    const { POST } = await import('./route');
    const bookingPromise = POST(bookingRequest({
      bookingPolicyAcknowledgment: staleAcknowledgment,
    }));

    try {
      await waitForBlockedSessions(1, held.pid);
      await held.commit();
    } catch (error) {
      await held.release();
      await bookingPromise;
      throw error;
    }

    const response = await bookingPromise;
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: 'BOOKING_POLICY_CHANGED',
      message:
        'The salon updated its booking policy. Please review it and confirm again.',
      bookingPolicy: {
        title: nextPolicy.title,
        text: nextPolicy.text,
        acknowledgment: {
          required: true,
          text: nextPolicy.acknowledgmentText,
        },
        version: policyVersion(nextPolicy),
      },
    });
    expect(await activeAppointments()).toHaveLength(0);
    expect(await policyAcknowledgments()).toHaveLength(0);
    expect(await db.select().from(schema.salonClientSchema)).toHaveLength(0);
  });

  it('creates no acknowledgment for an optional policy', async () => {
    const { POST } = await import('./route');
    const response = await POST(bookingRequest());

    expect(response.status).toBe(201);
    expect(await activeAppointments()).toHaveLength(1);
    expect(await policyAcknowledgments()).toHaveLength(0);
  });

  it('creates no acknowledgment when customization entitlement is disabled', async () => {
    await configureRequiredPolicy();
    await db
      .update(schema.salonSchema)
      .set({ features: { booking: { customization: false } } })
      .where(eq(schema.salonSchema.id, SALON_ID));
    const { POST } = await import('./route');
    const response = await POST(bookingRequest());

    expect(response.status).toBe(201);
    expect(await activeAppointments()).toHaveLength(1);
    expect(await policyAcknowledgments()).toHaveLength(0);
  });

  it('never manufactures public acknowledgment evidence for staff or admin bookings', async () => {
    await configureRequiredPolicy();
    const { POST } = await import('./route');
    requireStaffSession.mockResolvedValue({
      ok: true,
      session: {
        salonId: SALON_ID,
        technicianId: TECH_ID,
      },
    });
    const staffResponse = await POST(bookingRequest({
      bookingPolicyAcknowledgment: policyAcknowledgment(),
    }));

    expect(staffResponse.status).toBe(201);

    requireStaffSession.mockResolvedValue({ ok: false });
    requireAdmin.mockResolvedValue({ ok: true });
    const adminResponse = await POST(bookingRequest({
      technicianId: SECOND_TECH_ID,
      startTime: '2099-09-05T15:00:00.000Z',
      clientName: 'Admin-created Client',
      clientEmail: 'admin-created@example.invalid',
      clientPhone: '4165552555',
      bookingPolicyAcknowledgment: policyAcknowledgment(),
    }));

    expect(adminResponse.status).toBe(201);
    expect(await activeAppointments()).toHaveLength(2);
    expect(await policyAcknowledgments()).toHaveLength(0);
  });

  it('never creates public acknowledgment evidence for Google-event conversion', async () => {
    await configureRequiredPolicy();
    requireAdmin.mockResolvedValue({ ok: true });
    await db.insert(schema.googleCalendarEventSchema).values({
      id: 'google_event_ack_exclusion',
      salonId: SALON_ID,
      calendarId: 'primary',
      googleEventId: 'provider_event_ack_exclusion',
      title: 'Imported booking',
      attendeeName: 'Imported Client',
      attendeePhone: '4165552666',
      attendeeEmail: 'imported@example.invalid',
      startTime: new Date(START_TIME),
      endTime: new Date('2099-09-01T16:00:00.000Z'),
      durationMinutes: 60,
      reviewStatus: 'needs_review',
    });
    const { POST } = await import('./route');
    const response = await POST(bookingRequest({
      clientName: 'Imported Client',
      clientEmail: 'imported@example.invalid',
      clientPhone: '4165552666',
      googleEventReviewId: 'google_event_ack_exclusion',
      bookingPolicyAcknowledgment: policyAcknowledgment(),
    }));

    expect(response.status).toBe(201);
    expect(await activeAppointments()).toHaveLength(1);
    expect(await policyAcknowledgments()).toHaveLength(0);
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
