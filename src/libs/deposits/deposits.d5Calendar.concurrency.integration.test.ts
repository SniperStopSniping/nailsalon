/**
 * D5's genuine PostgreSQL race evidence.
 *
 * PGlite has one connection and cannot exercise PostgreSQL row/advisory locks,
 * EvalPlanQual, or the `btree_gist` exclusion constraint. This suite therefore
 * runs only against the repository's strongly-attested disposable PostgreSQL
 * target. With no target it skips explicitly for ordinary `vitest` runs; CI
 * sets `D5_CONCURRENCY_REQUIRED=true`, which turns a missing target into a hard
 * failure before a test can be reported as skipped.
 *
 * Local command (the container id/network evidence is load-bearing):
 *
 *   docker network create luster-d5-disposable
 *   docker run --detach --name luster-d5-postgres \
 *     --network luster-d5-disposable \
 *     --publish 127.0.0.1:55432:5432 \
 *     --env POSTGRES_DB=luster_e2e_ci_disposable \
 *     --env POSTGRES_USER=luster_e2e_ci \
 *     --env POSTGRES_PASSWORD=luster-e2e-ci-only-password \
 *     postgres:16-alpine
 *   until docker exec luster-d5-postgres \
 *     pg_isready -U luster_e2e_ci -d luster_e2e_ci_disposable; do sleep 1; done
 *   export DATABASE_URL="$(printf '%s%s' 'postgresql:' '//luster_e2e_ci:luster-e2e-ci-only-password@127.0.0.1:55432/luster_e2e_ci_disposable?application_name=luster-e2e-ci-disposable')"
 *   export CONCURRENCY_TEST_DATABASE_URL="$DATABASE_URL"
 *   export LUSTER_DISPOSABLE_DATABASE=true
 *   export LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID="$(docker inspect --format '{{.Id}}' luster-d5-postgres)"
 *   export LUSTER_DISPOSABLE_POSTGRES_NETWORK=luster-d5-disposable
 *   export D5_CONCURRENCY_REQUIRED=true
 *   npm run db:prepare:e2e:ci
 *   npm run test:deposits:pg
 */
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
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

import {
  attestDisposableDatabaseSession,
  type DisposableDatabaseTarget,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';
import type { SalonSettings } from '@/types/salonPolicy';

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
const REQUIRED = process.env.D5_CONCURRENCY_REQUIRED === 'true';

let disposableTarget: DisposableDatabaseTarget | null = null;
if (RAW_URL) {
  // A supplied-but-invalid URL always fails. Only a genuinely absent opt-in URL
  // may skip, and required CI mode turns even that absence into a hard failure.
  disposableTarget = requireDisposableDatabaseTarget({
    ...process.env,
    DATABASE_URL: RAW_URL,
  });
} else if (REQUIRED) {
  throw new Error(
    'D5 PostgreSQL concurrency is required, but CONCURRENCY_TEST_DATABASE_URL is absent.',
  );
}

vi.mock('server-only', () => ({}));
vi.mock('@/core/redis/redisClient', () => ({
  redis: null,
  isRedisAvailable: vi.fn(async () => false),
}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  withSession: null as unknown as (
    work: (database: unknown) => Promise<unknown>,
  ) => Promise<unknown>,
}));
const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  checkoutCreate: vi.fn(),
  checkoutRetrieve: vi.fn(),
  deleteGoogleCalendarEventForAppointment: vi.fn(),
  listGoogleCalendarEventsForSalon: vi.fn(),
  recordGoogleEventReviewDecision: vi.fn(),
  refreshAccountReadiness: vi.fn(),
  refundsCreate: vi.fn(),
  refundsList: vi.fn(),
  refundsRetrieve: vi.fn(),
  requireAdmin: vi.fn(),
  requireAdminSalon: vi.fn(),
  requireAppointmentAccess: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
  requireClientApiSession: vi.fn(),
  requireStaffAppointmentAccess: vi.fn(),
  requireStaffSession: vi.fn(),
  sendAppointmentReminder: vi.fn(),
  sendTransactionalEmail: vi.fn(),
  sendTransactionalEmailDetailed: vi.fn(),
  syncGoogleCalendarEventForAppointment: vi.fn(),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  usesRuntimePostgres: true,
  DatabaseSessionReleaseError: class DatabaseSessionReleaseError extends Error {},
  withDedicatedDatabaseSession: <T>(
    work: (database: unknown) => Promise<T>,
  ) => holder.withSession(work) as Promise<T>,
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage,
}));

vi.mock('@/libs/stripe', () => ({
  EXPECTED_STRIPE_API_VERSION: '2024-06-20',
  stripe: {
    checkout: { sessions: { retrieve: mocks.checkoutRetrieve } },
    refunds: {
      create: mocks.refundsCreate,
      list: mocks.refundsList,
      retrieve: mocks.refundsRetrieve,
    },
  },
}));

vi.mock('@/libs/depositCheckout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/depositCheckout')>();
  return {
    ...actual,
    createDepositCheckoutSession: mocks.checkoutCreate,
  };
});

vi.mock('@/libs/stripeConnect/readiness', () => ({
  refreshAccountReadiness: mocks.refreshAccountReadiness,
}));

vi.mock('@/libs/email', () => ({
  sendTransactionalEmail: mocks.sendTransactionalEmail,
  sendTransactionalEmailDetailed: mocks.sendTransactionalEmailDetailed,
}));
vi.mock('@/libs/staffAuth', () => ({ requireStaffSession: mocks.requireStaffSession }));
vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: mocks.requireAdmin,
  requireAdminSalon: mocks.requireAdminSalon,
}));
vi.mock('@/libs/clientApiGuards', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/clientApiGuards')>()),
  requireClientApiSession: mocks.requireClientApiSession,
}));
vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentAccess: mocks.requireAppointmentAccess,
  requireAppointmentManagerAccess: mocks.requireAppointmentManagerAccess,
}));
vi.mock('@/libs/staffApiGuards', () => ({
  requireStaffAppointmentAccess: mocks.requireStaffAppointmentAccess,
}));
vi.mock('@/libs/SMS', () => ({
  sendAppointmentReminder: mocks.sendAppointmentReminder,
  sendBookingConfirmationToClient: vi.fn(),
  sendCancellationNotificationToTech: vi.fn(),
  sendRescheduleConfirmation: vi.fn(),
}));
vi.mock('@/libs/googleCalendar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/libs/googleCalendar')>()),
  deleteGoogleCalendarEventForAppointment:
    mocks.deleteGoogleCalendarEventForAppointment,
  getGoogleCalendarBusyWindows: vi.fn(async () => []),
  hasGoogleCalendarConflict: vi.fn(async () => false),
  listGoogleCalendarEventsForSalon: mocks.listGoogleCalendarEventsForSalon,
  syncGoogleCalendarEventForAppointment:
    mocks.syncGoogleCalendarEventForAppointment,
}));
vi.mock('@/libs/googleEventReview', () => ({
  recordGoogleEventReviewDecision: mocks.recordGoogleEventReviewDecision,
}));

const { POST: copyGoogleEvent } = await import('@/app/api/admin/google-events/[id]/copy/route');
const { POST: revertGoogleEvent } = await import('@/app/api/admin/google-events/[id]/revert/route');
const {
  acquireGoogleCalendarMutationBarrierInTx,
  processIntegrationOutbox,
} = await import('@/libs/integrationOutbox');
const SALON_ID = 'salon_d5_concurrency';
const SALON_SLUG = 'd5-concurrency-salon';
const TECH_ID = 'tech_d5_concurrency';
const SECOND_TECH_ID = 'tech_d5_concurrency_2';
const SERVICE_ID = 'svc_d5_concurrency';
const EXPECTED_EXECUTED_TESTS = 3;

const BASE_SETTINGS: SalonSettings = {
  booking: {
    timezone: 'America/Toronto',
    slotIntervalMinutes: 15,
    bufferMinutes: 10,
  },
};

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
type HeldLock = { pid: number; release: () => Promise<void> };

let pool: pg.Pool;
let db: TestDb;
let executedTests = 0;
const pendingLockReleases = new Set<() => Promise<void>>();

const suite = disposableTarget ? describe : describe.skip;

suite('D5 — scope-clean Calendar PostgreSQL concurrency', () => {
  beforeAll(async () => {
    if (!disposableTarget) {
      throw new Error('Disposable target unexpectedly absent inside active D5 suite.');
    }

    process.env.PUBLIC_APP_URL = 'https://app.luster.test';
    const expectedServer = resolveDisposableDatabaseServerExpectation(disposableTarget);
    pool = new pg.Pool({ connectionString: disposableTarget.connectionString, max: 12 });

    const attestationClient = await pool.connect();
    try {
      await attestDisposableDatabaseSession(
        attestationClient,
        disposableTarget,
        expectedServer,
      );
    } finally {
      attestationClient.release();
    }

    db = drizzle(pool, { schema });
    holder.db = db;
    holder.withSession = async (work) => {
      const client = await pool.connect();
      try {
        return await work(drizzle(client, { schema }));
      } finally {
        client.release();
      }
    };
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });

    await pool.query('TRUNCATE TABLE salon RESTART IDENTITY CASCADE');
    await seedBaseCatalog();
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.requireStaffSession.mockResolvedValue({ ok: false });
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    mocks.requireAdminSalon.mockResolvedValue({
      error: new Response(null, { status: 401 }),
      salon: null,
    });
    mocks.requireClientApiSession.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    mocks.requireAppointmentAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    mocks.requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    mocks.requireStaffAppointmentAccess.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    mocks.sendTransactionalEmail.mockResolvedValue(true);
    mocks.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: true,
      errorCode: null,
      providerMessageId: 'd5-concurrency-message',
    });
    mocks.sendAppointmentReminder.mockResolvedValue(true);
    mocks.recordGoogleEventReviewDecision.mockResolvedValue(undefined);
    mocks.deleteGoogleCalendarEventForAppointment.mockResolvedValue({ status: 'deleted' });
    mocks.listGoogleCalendarEventsForSalon.mockResolvedValue([]);
    mocks.syncGoogleCalendarEventForAppointment.mockResolvedValue({
      eventId: 'google_event_d5_concurrency',
      status: 'synced',
    });
    mocks.refundsRetrieve.mockResolvedValue(null);
    mocks.refundsList.mockResolvedValue({ data: [] });
    mocks.refundsCreate.mockResolvedValue({ id: 're_d5_concurrency', status: 'succeeded' });
    mocks.checkoutRetrieve.mockResolvedValue({ payment_intent: 'pi_d5_concurrency' });
    mocks.checkoutCreate.mockImplementation(async ({ deposit }: {
      deposit: { id: string; holdExpiresAt: Date };
    }) => ({
      ok: true,
      session: {
        id: `cs_${deposit.id}`,
        object: 'checkout.session',
        url: `https://checkout.stripe.test/${deposit.id}`,
        expires_at: Math.floor(deposit.holdExpiresAt.getTime() / 1000),
        payment_intent: null,
      },
    }));

    await dropTestBarriers();
    await pool.query(`TRUNCATE TABLE
      appointment_booking_policy_acknowledgment,
      appointment_access_token,
      appointment_add_on,
      appointment_services,
      notification_delivery,
      integration_outbox,
      google_calendar_event,
      appointment_deposit,
      reward,
      stripe_webhook_event,
      appointment,
      salon_client_contact_alias,
      salon_client,
      salon_stripe_account
      RESTART IDENTITY CASCADE`);

    await db.update(schema.salonSchema).set({
      settings: BASE_SETTINGS,
      features: null,
      freeSoloEnabled: false,
    }).where(eq(schema.salonSchema.id, SALON_ID));
  });

  afterEach(async () => {
    await dropTestBarriers();
    const releases = [...pendingLockReleases];
    pendingLockReleases.clear();
    await Promise.allSettled(releases.map(release => release()));
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (pool) {
      await dropTestBarriers().catch(() => {});
      const releases = [...pendingLockReleases];
      pendingLockReleases.clear();
      await Promise.allSettled(releases.map(release => release()));
      await pool.end();
    }

    expect(executedTests).toBe(EXPECTED_EXECUTED_TESTS);

    process.stdout.write(
      `D5_REAL_POSTGRES_TESTS_EXECUTED=${executedTests} D5_REAL_POSTGRES_TESTS_SKIPPED=0\n`,
    );
  });

  it('serializes simultaneous Google outbox claims for one appointment', async () => {
    const appointmentId = 'appt_d5_calendar_claim';
    const startA = new Date('2099-11-01T15:00:00.000Z');
    const endA = new Date('2099-11-01T16:00:00.000Z');
    const due = new Date('2000-01-01T00:00:00.000Z');
    const notDue = new Date('2199-01-01T00:00:00.000Z');
    await db.insert(schema.appointmentSchema).values({
      id: appointmentId,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      clientPhone: '4165553888',
      clientEmail: 'calendar.claim@example.invalid',
      clientName: 'Calendar Claim Racer',
      startTime: startA,
      endTime: endA,
      status: 'confirmed',
      totalPrice: 6500,
      totalDurationMinutes: 60,
      blockedDurationMinutes: 70,
      bufferMinutes: 10,
    });
    const payload = (startTime: Date, endTime: Date) => ({
      appointmentId,
      salonId: SALON_ID,
      salonName: 'D5 Concurrency Salon',
      clientName: 'Calendar Claim Racer',
      clientPhone: '4165553888',
      serviceNames: ['D5 Concurrency Service'],
      technicianName: 'D5 Concurrency Tech',
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      totalPrice: 6500,
      totalDurationMinutes: 60,
      timeZone: 'America/Toronto',
      locationName: null,
      locationAddress: null,
      notes: null,
      googleCalendarEventId: null,
      targetCalendarId: 'destination_calendar',
      mutationVersion: startTime.toISOString(),
    });
    await db.insert(schema.integrationOutboxSchema).values([
      {
        id: 'calendar_claim_a',
        salonId: SALON_ID,
        appointmentId,
        provider: 'google_calendar',
        operation: 'upsert_event',
        dedupeKey: `google:${appointmentId}:upsert:${startA.toISOString()}`,
        payload: payload(startA, endA),
        createdAt: new Date('2000-01-02T00:00:00.000Z'),
      },
      {
        id: 'calendar_claim_b',
        salonId: SALON_ID,
        appointmentId,
        provider: 'google_calendar',
        operation: 'upsert_event',
        dedupeKey: `google:${appointmentId}:upsert:${startA.toISOString()}:claim-b`,
        payload: payload(startA, endA),
        availableAt: notDue,
        // Once made due, B sorts ahead of A while A's claim UPDATE remains
        // blocked on its row. This forces the second worker to contend on a
        // distinct outbox row for the shared appointment advisory key.
        createdAt: new Date('2000-01-01T00:00:00.000Z'),
      },
    ]);

    let signalProviderEntered!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      signalProviderEntered = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let providerCalls = 0;
    let activeProviderCalls = 0;
    let maximumProviderConcurrency = 0;
    mocks.syncGoogleCalendarEventForAppointment.mockImplementation(async () => {
      providerCalls += 1;
      activeProviderCalls += 1;
      maximumProviderConcurrency = Math.max(
        maximumProviderConcurrency,
        activeProviderCalls,
      );
      if (providerCalls === 1) {
        signalProviderEntered();
        await providerRelease;
      }
      activeProviderCalls -= 1;
      return { eventId: 'google_event_d5_concurrency', status: 'synced' };
    });

    const held = await holdIntegrationOutboxRow('calendar_claim_a');
    const workers: Array<ReturnType<typeof processIntegrationOutbox>> = [];
    try {
      workers.push(processIntegrationOutbox(1));
      await waitForBlockedSessions(1, held.pid);

      // Worker 1 owns the appointment advisory lock but is held on A's claim
      // UPDATE. Make older B due so worker 2 selects that distinct row. Its
      // pg_try_advisory_xact_lock must fail immediately instead of waiting.
      await db.update(schema.integrationOutboxSchema)
        .set({ availableAt: due })
        .where(eq(schema.integrationOutboxSchema.id, 'calendar_claim_b'));
      const secondWorker = processIntegrationOutbox(1);
      workers.push(secondWorker);
      let secondWorkerTimeout: ReturnType<typeof setTimeout> | undefined;
      const secondBeforeRelease = await Promise.race([
        secondWorker.then(result => ({ kind: 'completed' as const, result })),
        new Promise<{ kind: 'blocked' }>((resolve) => {
          secondWorkerTimeout = setTimeout(() => resolve({ kind: 'blocked' }), 2_000);
        }),
      ]);
      clearTimeout(secondWorkerTimeout);
      if (secondBeforeRelease.kind === 'blocked') {
        throw new Error('Second Google claim blocked instead of failing fast');
      }

      expect(secondBeforeRelease.result).toMatchObject({
        scanned: 1,
        succeeded: 0,
        retried: 0,
        failed: 0,
      });
      expect(mocks.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();

      let rows = await db.select().from(schema.integrationOutboxSchema)
        .where(eq(schema.integrationOutboxSchema.appointmentId, appointmentId));

      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'calendar_claim_a', status: 'pending', attempts: 0 }),
        expect.objectContaining({ id: 'calendar_claim_b', status: 'pending', attempts: 0 }),
      ]));

      await held.release();
      await providerEntered;

      rows = await db.select().from(schema.integrationOutboxSchema)
        .where(eq(schema.integrationOutboxSchema.appointmentId, appointmentId));

      expect(rows.filter(row => row.status === 'processing')).toHaveLength(1);
      expect(rows.filter(row => row.status === 'pending')).toHaveLength(1);
      expect(providerCalls).toBe(1);
      expect(maximumProviderConcurrency).toBe(1);

      releaseProvider();
      const results = await Promise.all(workers);

      expect(results.reduce((count, result) => count + result.succeeded, 0)).toBe(1);

      // The failed nonblocking claim remains durable and unattempted. Make it
      // explicitly due and prove a later invocation enters the provider only
      // after the first operation has fully left the ordering domain.
      await db.update(schema.integrationOutboxSchema)
        .set({ availableAt: due })
        .where(eq(schema.integrationOutboxSchema.id, 'calendar_claim_b'));
      const retry = await processIntegrationOutbox(1);
      rows = await db.select().from(schema.integrationOutboxSchema)
        .where(eq(schema.integrationOutboxSchema.appointmentId, appointmentId));

      expect(retry).toMatchObject({ scanned: 1, succeeded: 1 });
      expect(providerCalls).toBe(2);
      expect(maximumProviderConcurrency).toBe(1);
      expect(rows.filter(row => row.status === 'completed')).toHaveLength(2);
      expect(rows.filter(row => row.status === 'processing')).toHaveLength(0);
    } finally {
      releaseProvider();
      await held.release();
      await Promise.allSettled(workers);
    }

    executedTests += 1;
  }, 30_000);

  it('fails one concurrent admin copy quickly and commits one runnable job', async () => {
    const appointmentId = 'appt_d5_admin_copy_race';
    const sourceRowId = 'gce_d5_admin_copy_source';
    const sourceEventId = 'google_d5_admin_copy_source';
    const startTime = new Date('2099-11-02T15:00:00.000Z');
    const endTime = new Date('2099-11-02T16:00:00.000Z');
    await db.insert(schema.salonGoogleCalendarConnectionSchema).values({
      salonId: SALON_ID,
      encryptedRefreshToken: 'disposable-admin-copy-token',
      destinationCalendarId: 'destination_calendar',
      busyCalendarIds: ['destination_calendar'],
      status: 'active',
    });
    await db.insert(schema.appointmentSchema).values({
      id: appointmentId,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      clientPhone: '4165553889',
      clientEmail: 'admin.copy.race@example.invalid',
      clientName: 'Admin Copy Racer',
      startTime,
      endTime,
      status: 'confirmed',
      totalPrice: 6500,
      totalDurationMinutes: 60,
      blockedDurationMinutes: 70,
      bufferMinutes: 10,
      googleCalendarEventId: sourceEventId,
      googleCalendarSyncStatus: 'synced',
    });
    await db.insert(schema.googleCalendarEventSchema).values({
      id: sourceRowId,
      salonId: SALON_ID,
      calendarId: 'inbound_calendar',
      googleEventId: sourceEventId,
      appointmentId,
      sourceAccessRole: 'reader',
      syncMode: 'inbound_only',
      title: 'Imported appointment',
      startTime,
      endTime,
      durationMinutes: 60,
      reviewStatus: 'appointment',
    });
    const [seededAppointment] = await db.select({
      updatedAt: schema.appointmentSchema.updatedAt,
    }).from(schema.appointmentSchema).where(
      eq(schema.appointmentSchema.id, appointmentId),
    );
    mocks.requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: SALON_ID, name: 'D5 Concurrency Salon', slug: SALON_SLUG },
    });
    const request = () => new Request(
      `http://localhost/api/admin/google-events/${sourceRowId}/copy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: SALON_SLUG }),
      },
    );

    const held = await holdAppointmentRow(appointmentId);
    const requests = [
      copyGoogleEvent(request(), { params: { id: sourceRowId } }),
      copyGoogleEvent(request(), { params: { id: sourceRowId } }),
    ];
    await releaseAfterBlocked(held, 1, requests);
    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map(response => response.json()));
    const jobs = await db.select().from(schema.integrationOutboxSchema).where(and(
      eq(schema.integrationOutboxSchema.salonId, SALON_ID),
      eq(schema.integrationOutboxSchema.appointmentId, appointmentId),
      eq(schema.integrationOutboxSchema.provider, 'google_calendar'),
    ));

    expect(responses.map(response => response.status).sort()).toEqual([202, 409]);
    expect(bodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ status: 'queued' }) }),
      expect.objectContaining({
        error: expect.objectContaining({ code: 'GOOGLE_CALENDAR_WRITE_IN_PROGRESS' }),
      }),
    ]));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(expect.objectContaining({
      status: 'pending',
      operation: 'sync_appointment',
      appointmentId,
      payload: expect.objectContaining({
        mutationVersion: seededAppointment!.updatedAt.toISOString(),
        adminCopySourceEventId: sourceRowId,
      }),
    }));
    expect(jobs[0]!.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(bodies.find(body => body.data)?.data.jobId).toBe(jobs[0]!.id);
    expect(mocks.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
    expect(mocks.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();

    executedTests += 1;
  }, 30_000);

  it('holds the appointment Calendar mutex through an admin revert before a pending worker can claim', async () => {
    const appointmentId = 'appt_d5_admin_revert_race';
    const unrelatedAppointmentId = 'appt_d5_admin_revert_unrelated';
    const sourceRowId = 'gce_d5_admin_revert_source';
    const sourceEventId = 'google_d5_admin_revert_source';
    const startTime = new Date('2099-11-03T15:00:00.000Z');
    const endTime = new Date('2099-11-03T16:00:00.000Z');
    const mutationVersion = new Date('2099-01-01T00:00:00.000Z');
    await db.insert(schema.appointmentSchema).values({
      id: appointmentId,
      salonId: SALON_ID,
      technicianId: TECH_ID,
      clientPhone: '4165553890',
      clientEmail: 'admin.revert.race@example.invalid',
      clientName: 'Admin Revert Racer',
      startTime,
      endTime,
      status: 'confirmed',
      totalPrice: 6500,
      totalDurationMinutes: 60,
      blockedDurationMinutes: 70,
      bufferMinutes: 10,
      googleCalendarEventId: sourceEventId,
      googleCalendarSyncStatus: 'pending',
      updatedAt: mutationVersion,
    });
    await db.insert(schema.appointmentSchema).values({
      id: unrelatedAppointmentId,
      salonId: SALON_ID,
      technicianId: SECOND_TECH_ID,
      clientPhone: '4165553891',
      clientEmail: 'admin.revert.unrelated@example.invalid',
      clientName: 'Unrelated Calendar Work',
      startTime: new Date('2099-11-03T18:00:00.000Z'),
      endTime: new Date('2099-11-03T19:00:00.000Z'),
      status: 'confirmed',
      totalPrice: 6500,
      totalDurationMinutes: 60,
      blockedDurationMinutes: 70,
      bufferMinutes: 10,
    });
    await db.insert(schema.googleCalendarEventSchema).values({
      id: sourceRowId,
      salonId: SALON_ID,
      calendarId: 'revert_calendar',
      googleEventId: sourceEventId,
      appointmentId,
      sourceAccessRole: 'owner',
      syncMode: 'bidirectional',
      title: 'Converted appointment',
      startTime,
      endTime,
      durationMinutes: 60,
      reviewStatus: 'appointment',
    });
    await db.insert(schema.integrationOutboxSchema).values({
      id: 'outbox_d5_admin_revert_pending',
      salonId: SALON_ID,
      appointmentId,
      provider: 'google_calendar',
      operation: 'sync_appointment',
      dedupeKey: 'google:d5:admin-revert:pending',
      payload: {
        appointmentId,
        salonId: SALON_ID,
        mutationVersion: mutationVersion.toISOString(),
        googleCalendarEventId: sourceEventId,
        targetCalendarId: 'revert_calendar',
      },
    });
    mocks.requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: SALON_ID, name: 'D5 Concurrency Salon', slug: SALON_SLUG },
    });
    const request = new Request(
      `http://localhost/api/admin/google-events/${sourceRowId}/revert`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: SALON_SLUG }),
      },
    );

    const held = await holdAppointmentRow(appointmentId);
    let revertPromise: ReturnType<typeof revertGoogleEvent> | undefined;
    let workerPromise: ReturnType<typeof processIntegrationOutbox> | undefined;
    let unrelatedBarrier: Promise<boolean> | undefined;
    try {
      revertPromise = revertGoogleEvent(request, { params: { id: sourceRowId } });
      await waitForBlockedSessions(1, held.pid);
      unrelatedBarrier = db.transaction(tx => acquireGoogleCalendarMutationBarrierInTx(tx, {
        salonId: SALON_ID,
        appointmentId: unrelatedAppointmentId,
      }));
      let unrelatedTimeout: ReturnType<typeof setTimeout> | undefined;
      const unrelatedResult = await Promise.race([
        unrelatedBarrier,
        new Promise<'blocked'>((resolve) => {
          unrelatedTimeout = setTimeout(() => resolve('blocked'), 1_000);
        }),
      ]);
      clearTimeout(unrelatedTimeout);

      expect(unrelatedResult).toBe(true);

      workerPromise = processIntegrationOutbox(1);
      let workerTimeout: ReturnType<typeof setTimeout> | undefined;
      const workerBeforeRelease = await Promise.race([
        workerPromise.then(result => ({ kind: 'completed' as const, result })),
        new Promise<{ kind: 'blocked' }>((resolve) => {
          workerTimeout = setTimeout(() => resolve({ kind: 'blocked' }), 2_000);
        }),
      ]);
      clearTimeout(workerTimeout);
      if (workerBeforeRelease.kind === 'blocked') {
        throw new Error('Pending Google worker blocked behind admin revert');
      }

      expect(workerBeforeRelease.result).toMatchObject({
        scanned: 1,
        succeeded: 0,
        retried: 0,
        failed: 0,
      });
      expect(mocks.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
      expect((await db.select().from(schema.integrationOutboxSchema)
        .where(eq(schema.integrationOutboxSchema.id, 'outbox_d5_admin_revert_pending')))[0])
        .toMatchObject({ status: 'pending', attempts: 0 });

      await held.release();

      const response = await revertPromise;

      expect(response.status).toBe(200);

      await db.update(schema.integrationOutboxSchema)
        .set({ availableAt: new Date('2000-01-01T00:00:00.000Z') })
        .where(eq(schema.integrationOutboxSchema.id, 'outbox_d5_admin_revert_pending'));
      const rerun = await processIntegrationOutbox(1);

      expect(rerun).toMatchObject({ scanned: 1, succeeded: 1 });
      expect(mocks.syncGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
      expect(mocks.deleteGoogleCalendarEventForAppointment).not.toHaveBeenCalled();
      expect((await db.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, appointmentId)))[0]).toMatchObject({
        status: 'cancelled',
        googleCalendarEventId: null,
        googleCalendarSyncStatus: 'not_synced',
      });
      expect((await db.select().from(schema.googleCalendarEventSchema)
        .where(eq(schema.googleCalendarEventSchema.id, sourceRowId)))[0]).toMatchObject({
        appointmentId: null,
        reviewStatus: 'reviewed',
        syncMode: 'bidirectional',
      });
      expect((await db.select().from(schema.integrationOutboxSchema)
        .where(eq(schema.integrationOutboxSchema.id, 'outbox_d5_admin_revert_pending')))[0])
        .toMatchObject({ status: 'cancelled', lastError: 'SUPERSEDED' });
    } finally {
      await held.release();
      await Promise.allSettled([
        ...(revertPromise ? [revertPromise] : []),
        ...(workerPromise ? [workerPromise] : []),
        ...(unrelatedBarrier ? [unrelatedBarrier] : []),
      ]);
    }

    executedTests += 1;
  }, 30_000);
});
async function seedBaseCatalog(): Promise<void> {
  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'D5 Concurrency Salon',
    slug: SALON_SLUG,
    ownerEmail: 'owner.d5@example.invalid',
    isActive: true,
    status: 'active',
    publicationStatus: 'published',
    freeSoloEnabled: false,
    settings: BASE_SETTINGS,
  });
  await db.insert(schema.technicianSchema).values([
    {
      id: TECH_ID,
      salonId: SALON_ID,
      name: 'D5 Concurrency Tech',
      isActive: true,
      weeklySchedule: alwaysOpenSchedule(),
    },
    {
      id: SECOND_TECH_ID,
      salonId: SALON_ID,
      name: 'D5 Concurrency Tech 2',
      isActive: true,
      weeklySchedule: alwaysOpenSchedule(),
    },
  ]);
  await db.insert(schema.serviceSchema).values({
    id: SERVICE_ID,
    salonId: SALON_ID,
    name: 'D5 Concurrency Service',
    category: 'manicure',
    price: 6500,
    durationMinutes: 60,
    isActive: true,
  });
  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: TECH_ID, serviceId: SERVICE_ID, enabled: true },
    { technicianId: SECOND_TECH_ID, serviceId: SERVICE_ID, enabled: true },
  ]);
}

function alwaysOpenSchedule() {
  return Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map(day => [day, { start: '00:00', end: '23:45' }]),
  );
}
async function registerHeldLock(connection: pg.PoolClient): Promise<HeldLock> {
  const result = await connection.query<{ pid: number }>('SELECT pg_backend_pid()::int AS pid');
  let released = false;
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    pendingLockReleases.delete(release);
    try {
      await connection.query('ROLLBACK');
    } finally {
      connection.release();
    }
  };
  pendingLockReleases.add(release);
  return { pid: result.rows[0]!.pid, release };
}
async function holdAppointmentRow(appointmentId: string): Promise<HeldLock> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      'SELECT id FROM appointment WHERE salon_id = $1 AND id = $2 FOR UPDATE',
      [SALON_ID, appointmentId],
    );
    return await registerHeldLock(connection);
  } catch (error) {
    await connection.query('ROLLBACK');
    connection.release();
    throw error;
  }
}

async function holdIntegrationOutboxRow(jobId: string): Promise<HeldLock> {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      'SELECT id FROM integration_outbox WHERE id = $1 FOR UPDATE',
      [jobId],
    );
    return await registerHeldLock(connection);
  } catch (error) {
    await connection.query('ROLLBACK');
    connection.release();
    throw error;
  }
}
async function waitForBlockedSessions(expectedCount: number, blockerPid: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await pool.query<{ count: number }>(`
      WITH RECURSIVE blocking_tree(waiting_pid, blocker_pid) AS (
        SELECT activity.pid, blocker.pid
        FROM pg_stat_activity AS activity
        CROSS JOIN LATERAL unnest(pg_blocking_pids(activity.pid)) AS blocker(pid)
        WHERE activity.datname = current_database()
          AND activity.pid <> pg_backend_pid()
          AND activity.state = 'active'
          AND activity.wait_event_type = 'Lock'

        UNION

        SELECT tree.waiting_pid, blocker.pid
        FROM blocking_tree AS tree
        CROSS JOIN LATERAL unnest(pg_blocking_pids(tree.blocker_pid)) AS blocker(pid)
      )
      SELECT count(DISTINCT waiting_pid)::int AS count
      FROM blocking_tree
      WHERE blocker_pid = $1
    `, [blockerPid]);
    if ((result.rows[0]?.count ?? 0) >= expectedCount) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${expectedCount} PostgreSQL sessions behind blocker ${blockerPid}.`);
}

async function releaseAfterBlocked(
  held: HeldLock,
  expectedCount: number,
  operations: Array<Promise<unknown>>,
): Promise<void> {
  try {
    await waitForBlockedSessions(expectedCount, held.pid);
  } catch (error) {
    await held.release();
    await Promise.allSettled(operations);
    throw error;
  }
  await held.release();
}
async function dropTestBarriers(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.query(`
    DROP TRIGGER IF EXISTS d5_m23_explicit_timestamp_guard_trigger ON stripe_webhook_event;
    DROP FUNCTION IF EXISTS d5_m23_explicit_timestamp_guard();
    DROP TRIGGER IF EXISTS d5_event_insert_barrier_trigger ON stripe_webhook_event;
    DROP FUNCTION IF EXISTS d5_event_insert_barrier();
    DROP TRIGGER IF EXISTS d5_lineage_write_barrier_trigger ON appointment;
    DROP FUNCTION IF EXISTS d5_lineage_write_barrier();
  `);
}
