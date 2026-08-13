/**
 * PostgreSQL-only proof for Calendar dispatch/reclaim/connection fencing.
 * PGlite has one physical session and cannot prove session advisory liveness.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let parsedUrl: URL | null = null;
try {
  parsedUrl = RAW_URL ? new URL(RAW_URL) : null;
} catch {
  parsedUrl = null;
}
const databaseName = parsedUrl
  ? decodeURIComponent(parsedUrl.pathname).replace(/^\//, '')
  : '';
const CHILD_RECLAIMER_TEST_NAME
  = 'child-process production reclaimer respects the live provider session lock';
const IS_CHILD_RECLAIMER
  = process.env.GOOGLE_FENCE_CHILD_RECLAIMER === 'true';
const IS_LOCAL_THROWAWAY = parsedUrl !== null
  && ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)
  && parsedUrl.username === 'qa'
  && databaseName === 'luster_qa'
  && !RAW_URL.includes('neon.tech');

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  withSession: null as unknown as (
    work: (database: unknown) => Promise<unknown>,
  ) => Promise<unknown>,
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

vi.mock('@/libs/Env', () => ({
  Env: {
    GOOGLE_CALENDAR_ENABLED: 'false',
    GOOGLE_OAUTH_CLIENT_ID: 'test-client',
    GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret',
  },
}));

vi.mock('@/libs/lusterSecurity', () => ({
  decryptIntegrationSecret: (value: string) => value.replace(/^enc:/, ''),
  encryptIntegrationSecret: (value: string) => ({
    ciphertext: `enc:${value}`,
    keyVersion: 1,
  }),
}));

vi.mock('@/libs/googleCalendarAlerts', () => ({
  sendGoogleCalendarDisconnectedEmail: vi.fn(async () => true),
}));

const {
  enqueueGoogleCalendarAppointmentMutation,
  processIntegrationOutbox,
} = await import('@/libs/integrationOutbox');
const {
  deterministicGoogleCalendarEventId,
  GoogleCalendarConnectionWriteFenceError,
  syncGoogleCalendarEventForAppointment,
} = await import('@/libs/googleCalendar');
const { runAppointmentManageMutation } = await import('@/libs/appointmentManage');

const SALON_ID = 'salon_google_fence_pg';
const APPOINTMENT_ID = 'appointment_google_fence_pg';

type RemoteEvent = {
  body: Record<string, unknown>;
  etag: string;
  id: string;
};

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let tokenHandlers: Array<() => Promise<Response>> = [];
let eventHook: ((args: {
  body: Record<string, unknown> | null;
  init: RequestInit;
  url: string;
}) => Promise<Response | null>) | null = null;
let remoteEvents = new Map<string, RemoteEvent>();
let remoteRevision = 0;
let mutationTransportCalls = 0;

async function runProductionReclaimerInIndependentProcess(jobId: string) {
  const vitestEntry = path.resolve(process.cwd(), 'node_modules/vitest/vitest.mjs');
  const testFile = path.resolve(
    process.cwd(),
    'src/libs/integrationOutbox.postgres.integration.test.ts',
  );
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, [
      vitestEntry,
      'run',
      '--no-file-parallelism',
      testFile,
      '-t',
      CHILD_RECLAIMER_TEST_NAME,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CONCURRENCY_TEST_DATABASE_URL: RAW_URL,
        GOOGLE_FENCE_CHILD_RECLAIMER: 'true',
        GOOGLE_FENCE_CHILD_RECLAIMER_JOB_ID: jobId,
      },
      timeout: 30_000,
    }, (error, output, stderr) => {
      if (error) {
        reject(new Error(
          `Independent production reclaimer failed: ${stderr || output || error.message}`,
        ));
        return;
      }
      resolve(output);
    });
  });
  const processId = /GOOGLE_FENCE_CHILD_RECLAIMER_PID=(\d+)/.exec(stdout)?.[1];
  if (!processId) {
    throw new Error(`Independent production reclaimer emitted no PID marker: ${stdout}`);
  }
  return Number(processId);
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function eventIdFromUrl(url: string) {
  const match = /\/events\/([^?]+)/.exec(url);
  return match ? decodeURIComponent(match[1]!) : null;
}

async function providerFetch(urlValue: string | URL, init: RequestInit = {}) {
  const url = String(urlValue);
  if (url.includes('oauth2.googleapis.com/token')) {
    return tokenHandlers.shift()?.() ?? Promise.resolve(jsonResponse({
      access_token: 'access-default',
      expires_in: 3600,
    }));
  }
  if (!url.includes('/calendar/v3/calendars/')) {
    return jsonResponse({});
  }

  if (['POST', 'PATCH', 'DELETE'].includes(init.method ?? 'GET')) {
    mutationTransportCalls += 1;
  }
  const body = typeof init.body === 'string'
    ? JSON.parse(init.body) as Record<string, unknown>
    : null;
  const hooked = await eventHook?.({ body, init, url });
  if (hooked) {
    return hooked;
  }
  const eventId = eventIdFromUrl(url);
  if (init.method === 'GET' && url.includes('/events?')) {
    return jsonResponse({ items: [] });
  }
  if (init.method === 'GET') {
    const existing = eventId ? remoteEvents.get(eventId) : undefined;
    return existing
      ? jsonResponse({ ...existing.body, etag: existing.etag, id: existing.id })
      : jsonResponse({ error: { message: 'not found' } }, 404);
  }
  if (init.method === 'POST') {
    const id = String(body?.id ?? `event_${remoteEvents.size + 1}`);
    if (remoteEvents.has(id)) {
      return jsonResponse({ error: { message: 'conflict' } }, 409);
    }
    const event = { body: body ?? {}, etag: `etag_${++remoteRevision}`, id };
    remoteEvents.set(id, event);
    return jsonResponse({ ...event.body, etag: event.etag, id });
  }
  if (init.method === 'PATCH' && eventId) {
    const existing = remoteEvents.get(eventId);
    if (!existing) {
      return jsonResponse({ error: { message: 'not found' } }, 404);
    }
    const ifMatch = new Headers(init.headers).get('If-Match');
    // Google treats a missing precondition as an unconditional mutation. Keep
    // the fake faithful so deleting the production If-Match header makes the
    // late-write test restore stale remote state instead of failing harmlessly.
    if (ifMatch && ifMatch !== existing.etag) {
      return jsonResponse({ error: { message: 'precondition failed' } }, 412);
    }
    const event = { body: body ?? {}, etag: `etag_${++remoteRevision}`, id: eventId };
    remoteEvents.set(eventId, event);
    return jsonResponse({ ...event.body, etag: event.etag, id: eventId });
  }
  if (init.method === 'DELETE' && eventId) {
    const existing = remoteEvents.get(eventId);
    if (!existing) {
      return jsonResponse({ error: { message: 'not found' } }, 404);
    }
    const ifMatch = new Headers(init.headers).get('If-Match');
    if (ifMatch && ifMatch !== existing.etag) {
      return jsonResponse({ error: { message: 'precondition failed' } }, 412);
    }
    remoteEvents.delete(eventId);
    return new Response(null, { status: 204 });
  }
  return jsonResponse({ error: { message: 'unsupported' } }, 400);
}

async function currentAppointment() {
  const [appointment] = await db.select().from(schema.appointmentSchema)
    .where(and(
      eq(schema.appointmentSchema.id, APPOINTMENT_ID),
      eq(schema.appointmentSchema.salonId, SALON_ID),
    ));
  return appointment!;
}

async function enqueueCurrentAppointment() {
  const appointment = await currentAppointment();
  return db.transaction(tx => enqueueGoogleCalendarAppointmentMutation(tx, {
    appointmentId: APPOINTMENT_ID,
    salonId: SALON_ID,
    mutationVersion: appointment.updatedAt,
  }));
}

function calendarInput(mutationVersion: string, eventId?: string) {
  return {
    appointmentId: APPOINTMENT_ID,
    salonId: SALON_ID,
    salonName: 'Postgres Fence Salon',
    clientName: 'Fence Client',
    clientPhone: '4165550100',
    serviceNames: ['Manicure'],
    technicianName: 'Tech',
    startTime: new Date('2099-09-01T15:00:00.000Z'),
    endTime: new Date('2099-09-01T16:00:00.000Z'),
    totalPrice: 5000,
    totalDurationMinutes: 60,
    timeZone: 'America/Toronto',
    googleCalendarEventId: eventId,
    mutationVersion,
  };
}

const suite = IS_LOCAL_THROWAWAY ? describe : describe.skip;

suite('Google outbox PostgreSQL fences', () => {
  beforeAll(async () => {
    pool = new pg.Pool({
      connectionString: RAW_URL,
      max: 10,
      application_name: 'codex-google-outbox-fence-test',
    });
    const safety = await pool.query<{ database_name: string; database_user: string }>(
      'SELECT current_database() AS database_name, current_user AS database_user',
    );
    if (
      safety.rows[0]?.database_name !== 'luster_qa'
      || safety.rows[0]?.database_user !== 'qa'
    ) {
      throw new Error('REFUSING_NON_THROWAWAY_POSTGRES');
    }
    db = drizzle(pool, { schema });
    holder.db = db;
    holder.withSession = async (work) => {
      const client = await pool.connect();
      let destroy = false;
      try {
        return await work(drizzle(client, { schema }));
      } catch (error) {
        destroy = error instanceof Error
        && error.name === 'DatabaseSessionReleaseError';
        throw error;
      } finally {
        client.release(destroy);
      }
    };
    if (!IS_CHILD_RECLAIMER) {
      await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    }
  }, 60_000);

  beforeEach(async () => {
    if (IS_CHILD_RECLAIMER) {
      vi.stubGlobal('fetch', vi.fn(providerFetch));
      return;
    }
    await pool.query(`
      TRUNCATE TABLE
        google_calendar_event,
        integration_outbox,
        salon_google_calendar_connection,
        appointment,
        salon
      RESTART IDENTITY CASCADE
    `);
    await db.insert(schema.salonSchema).values({
      id: SALON_ID,
      name: 'Postgres Fence Salon',
      slug: 'postgres-fence-salon',
    });
    await db.insert(schema.salonGoogleCalendarConnectionSchema).values({
      salonId: SALON_ID,
      encryptedRefreshToken: 'enc:refresh-initial',
      destinationCalendarId: 'primary',
      busyCalendarIds: ['primary'],
      status: 'active',
    });
    await db.insert(schema.appointmentSchema).values({
      id: APPOINTMENT_ID,
      salonId: SALON_ID,
      clientName: 'Fence Client',
      clientPhone: '4165550100',
      startTime: new Date('2099-09-01T15:00:00.000Z'),
      endTime: new Date('2099-09-01T16:00:00.000Z'),
      status: 'confirmed',
      totalDurationMinutes: 60,
      totalPrice: 5000,
    });
    tokenHandlers = [];
    eventHook = null;
    remoteEvents = new Map();
    remoteRevision = 0;
    mutationTransportCalls = 0;
    vi.stubGlobal('fetch', vi.fn(providerFetch));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await pool?.end();
  });

  (IS_CHILD_RECLAIMER ? it : it.skip)(CHILD_RECLAIMER_TEST_NAME, async () => {
    const jobId = process.env.GOOGLE_FENCE_CHILD_RECLAIMER_JOB_ID;

    expect(jobId).toBeTruthy();

    // Age the row in the independent contender immediately before invoking
    // the production reclaimer. If cold child startup takes longer than one
    // parent heartbeat interval, an earlier parent-side timestamp could have
    // become fresh and let this test pass without probing the advisory lock.
    const staleUpdatedAt = new Date(Date.now() - 16 * 60_000);
    await db.update(schema.integrationOutboxSchema).set({
      updatedAt: staleUpdatedAt,
    }).where(eq(schema.integrationOutboxSchema.id, jobId!));
    const [staleJob] = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.id, jobId!));

    expect(staleJob!.updatedAt.getTime()).toBeLessThan(Date.now() - 15 * 60_000);

    const summary = await processIntegrationOutbox(1);
    const [job] = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.id, jobId!));

    // A production reclaimer in this independent process has no access to the
    // parent's in-memory active Set. The database session lock is the only
    // reason this stale row remains owned by the live parent transport.
    expect(summary).toMatchObject({ scanned: 0, succeeded: 0 });
    expect(job).toMatchObject({ attempts: 1, status: 'processing' });
    expect(job!.updatedAt.getTime()).toBe(staleUpdatedAt.getTime());

    process.stdout.write(`\nGOOGLE_FENCE_CHILD_RECLAIMER_PID=${process.pid}\n`);
  });

  it('suppresses A when B commits in the historical final-check/request-start window', async () => {
    await enqueueCurrentAppointment();
    let releaseA!: () => void;
    let enteredA!: () => void;
    const aEntered = new Promise<void>(resolve => (enteredA = resolve));
    const aRelease = new Promise<void>(resolve => (releaseA = resolve));
    let gated = false;
    const workerA = processIntegrationOutbox(1, {
      afterGoogleCurrentnessCheckBeforeProviderCall: async () => {
        if (!gated) {
          gated = true;
          enteredA();
          await aRelease;
        }
      },
    });
    await aEntered;

    const beforeB = await currentAppointment();
    const revisionB = new Date(beforeB.updatedAt.getTime() + 1_000);
    await db.transaction(async (tx) => {
      await tx.update(schema.appointmentSchema).set({
        startTime: new Date('2099-09-01T17:00:00.000Z'),
        endTime: new Date('2099-09-01T18:00:00.000Z'),
        updatedAt: revisionB,
      }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
      await enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: revisionB,
      });
    });
    releaseA();

    await expect(workerA).resolves.toMatchObject({ scanned: 1, succeeded: 1 });
    expect(mutationTransportCalls).toBe(0);

    await expect(processIntegrationOutbox(1)).resolves.toMatchObject({
      scanned: 1,
      succeeded: 1,
    });
    expect(mutationTransportCalls).toBeGreaterThan(0);
    expect([...remoteEvents.values()][0]?.body).toEqual(expect.objectContaining({
      start: expect.objectContaining({ dateTime: '2099-09-01T17:00:00.000Z' }),
    }));
  });

  it('prevents an independent process from reclaiming while the old Calendar transport is alive', async () => {
    await enqueueCurrentAppointment();
    let releaseTransport!: () => void;
    let transportEntered!: () => void;
    const entered = new Promise<void>(resolve => (transportEntered = resolve));
    const release = new Promise<void>(resolve => (releaseTransport = resolve));
    eventHook = async ({ body, init }) => {
      if (init.method !== 'POST') {
        return null;
      }
      transportEntered();
      await release;
      const id = String(body?.id);
      const event = { body: body ?? {}, etag: `etag_${++remoteRevision}`, id };
      remoteEvents.set(id, event);
      return jsonResponse({ ...event.body, etag: event.etag, id });
    };

    const workerA = processIntegrationOutbox(1);
    await entered;
    try {
      const [job] = await db.select().from(schema.integrationOutboxSchema);

      // This contender is a separate Node process with its own PostgreSQL
      // backend. It cannot see this module's in-memory active-dispatch Set, so
      // only the production session advisory lock can prevent its production
      // reclaim path from changing this row to retry.
      const childProcessId = await runProductionReclaimerInIndependentProcess(job!.id);

      expect(childProcessId).not.toBe(process.pid);
      expect(mutationTransportCalls).toBe(1);

      const [stillOwned] = await db.select().from(schema.integrationOutboxSchema);

      expect(stillOwned).toMatchObject({ attempts: 1, status: 'processing' });

      await db.insert(schema.integrationOutboxSchema).values({
        id: 'pending_peer_while_transport_is_live',
        salonId: SALON_ID,
        appointmentId: APPOINTMENT_ID,
        provider: 'google_calendar',
        operation: 'sync_appointment',
        dedupeKey: 'pending_peer_while_transport_is_live',
        payload: job!.payload,
        createdAt: new Date(job!.createdAt.getTime() + 1_000),
      });

      const contenderStartedAt = performance.now();

      await expect(processIntegrationOutbox(1)).resolves.toMatchObject({
        scanned: 1,
        succeeded: 0,
      });

      expect(performance.now() - contenderStartedAt).toBeLessThan(1_000);

      const [pendingPeer] = await db.select().from(schema.integrationOutboxSchema)
        .where(eq(
          schema.integrationOutboxSchema.id,
          'pending_peer_while_transport_is_live',
        ));

      expect(pendingPeer).toMatchObject({ attempts: 0, status: 'pending' });
    } finally {
      releaseTransport();
      await workerA.catch(() => undefined);
    }

    await expect(workerA).resolves.toMatchObject({ scanned: 1, succeeded: 1 });
  }, 45_000);

  it('rolls back a real appointment move when A already owns the provider session lock', async () => {
    await enqueueCurrentAppointment();
    const before = await currentAppointment();
    let releaseTransport!: () => void;
    let transportEntered!: () => void;
    const entered = new Promise<void>(resolve => (transportEntered = resolve));
    const release = new Promise<void>(resolve => (releaseTransport = resolve));
    eventHook = async ({ body, init }) => {
      if (init.method !== 'POST') {
        return null;
      }
      transportEntered();
      await release;
      const id = String(body?.id);
      const event = { body: body ?? {}, etag: `etag_${++remoteRevision}`, id };
      remoteEvents.set(id, event);
      return jsonResponse({ ...event.body, etag: event.etag, id });
    };

    const workerA = processIntegrationOutbox(1);
    await entered;
    try {
      // The real manage path updates the appointment before enqueueing in the
      // same transaction. Its enqueue must fail the shared xact-lock probe,
      // causing the preceding row update to roll back atomically.
      await expect(runAppointmentManageMutation({
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        operation: 'move',
        startTime: new Date('2099-09-01T17:00:00.000Z'),
        durationMinutes: 60,
        canReassignTechnician: false,
      })).rejects.toMatchObject({
        message: 'GOOGLE_CALENDAR_DISPATCH_BUSY',
        name: 'GoogleCalendarDispatchBusyError',
      });

      const after = await currentAppointment();

      expect(after.startTime).toEqual(before.startTime);
      expect(after.endTime).toEqual(before.endTime);
      expect(after.updatedAt).toEqual(before.updatedAt);

      const calendarJobs = await db.select().from(schema.integrationOutboxSchema)
        .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));

      expect(calendarJobs).toHaveLength(1);
      expect(calendarJobs[0]).toMatchObject({ attempts: 1, status: 'processing' });
    } finally {
      releaseTransport();
      await workerA.catch(() => undefined);
    }

    await expect(workerA).resolves.toMatchObject({ scanned: 1, succeeded: 1 });
  });

  it('rejects a delayed OAuth token replacement when only its attempt fence is stale', async () => {
    const jobId = 'token_attempt_fence_job';
    await db.insert(schema.integrationOutboxSchema).values({
      id: jobId,
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'sync_appointment',
      dedupeKey: jobId,
      payload: { appointmentId: APPOINTMENT_ID, salonId: SALON_ID },
      status: 'processing',
      attempts: 1,
    });
    let releaseTokenA!: () => void;
    let tokenAEntered!: () => void;
    const entered = new Promise<void>(resolve => (tokenAEntered = resolve));
    const release = new Promise<void>(resolve => (releaseTokenA = resolve));
    tokenHandlers.push(
      async () => {
        tokenAEntered();
        await release;
        return jsonResponse({
          access_token: 'access-a',
          expires_in: 3600,
          refresh_token: 'rotated-a',
        });
      },
    );

    const attemptA = syncGoogleCalendarEventForAppointment(
      calendarInput('2099-09-01T00:00:00.000Z'),
      {
        attemptFence: { jobId, claimedAttempt: 1 },
        idempotencyKey: 'appointment-lane:initial',
        persistResult: false,
        targetCalendarId: 'primary',
      },
    );
    await entered;
    await db.update(schema.integrationOutboxSchema).set({ attempts: 2 })
      .where(eq(schema.integrationOutboxSchema.id, jobId));

    releaseTokenA();

    await expect(attemptA).rejects.toBeInstanceOf(
      GoogleCalendarConnectionWriteFenceError,
    );

    const [connection] = await db.select()
      .from(schema.salonGoogleCalendarConnectionSchema)
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    expect(connection).toMatchObject({
      encryptedRefreshToken: 'enc:refresh-initial',
      status: 'active',
    });
    expect(mutationTransportCalls).toBe(0);
  });

  it('rejects a delayed OAuth token replacement when only its connection xmin is stale', async () => {
    let releaseTokenA!: () => void;
    let tokenAEntered!: () => void;
    const entered = new Promise<void>(resolve => (tokenAEntered = resolve));
    const release = new Promise<void>(resolve => (releaseTokenA = resolve));
    tokenHandlers.push(async () => {
      tokenAEntered();
      await release;
      return jsonResponse({
        access_token: 'access-a',
        expires_in: 3600,
        refresh_token: 'rotated-a',
      });
    });

    // No attempt fence is supplied in this race. The captured connection xmin
    // is the only thing that can reject A after a newer connection write wins.
    const delayedA = syncGoogleCalendarEventForAppointment(
      calendarInput('2099-09-01T00:00:00.000Z'),
      {
        idempotencyKey: 'appointment-lane:initial',
        persistResult: false,
        targetCalendarId: 'primary',
      },
    );
    await entered;
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      encryptedRefreshToken: 'enc:rotated-newer',
      lastError: 'newer health result',
      status: 'degraded',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    releaseTokenA();

    await expect(delayedA).rejects.toBeInstanceOf(
      GoogleCalendarConnectionWriteFenceError,
    );

    const [connection] = await db.select()
      .from(schema.salonGoogleCalendarConnectionSchema)
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    expect(connection).toMatchObject({
      encryptedRefreshToken: 'enc:rotated-newer',
      lastError: 'newer health result',
      status: 'degraded',
    });
    expect(mutationTransportCalls).toBe(0);
  });

  it('keeps C after late A receives 404 and falls back through the stable event identity', async () => {
    const idempotencyKey = 'appointment-lane:initial';
    const eventId = deterministicGoogleCalendarEventId({
      appointmentId: APPOINTMENT_ID,
      idempotencyKey,
      salonId: SALON_ID,
    });
    const retiredEventId = 'retired_remote_event';
    const versions = {
      A: '2099-09-01T02:00:00.000Z',
      B: '2099-09-01T01:00:00.000Z',
      C: '2099-09-01T03:00:00.000Z',
    } as const;
    remoteEvents.set(retiredEventId, {
      id: retiredEventId,
      etag: 'etag_retired',
      body: {
        extendedProperties: { private: { mutationVersion: '2099-09-01T00:00:00.000Z' } },
      },
    });
    remoteEvents.set(eventId, {
      id: eventId,
      etag: 'etag_b',
      body: {
        extendedProperties: { private: { mutationVersion: versions.B } },
      },
    });
    const jobId = 'remote_attempt_fence_job';
    await db.insert(schema.integrationOutboxSchema).values({
      id: jobId,
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'sync_appointment',
      dedupeKey: jobId,
      payload: { appointmentId: APPOINTMENT_ID, salonId: SALON_ID },
      status: 'processing',
      attempts: 1,
    });
    tokenHandlers.push(
      async () => jsonResponse({ access_token: 'access-a', expires_in: 3600 }),
      async () => jsonResponse({
        access_token: 'access-c',
        expires_in: 3600,
        refresh_token: 'rotated-c',
      }),
    );
    let releasePatchA!: () => void;
    let patchAEntered!: () => void;
    const entered = new Promise<void>(resolve => (patchAEntered = resolve));
    const release = new Promise<void>(resolve => (releasePatchA = resolve));
    let delayedAIfMatch: string | null = null;
    let retiredEventWasRead = false;
    eventHook = async ({ body, init, url }) => {
      const requestEventId = eventIdFromUrl(url);
      if (
        init.method === 'GET'
        && requestEventId === retiredEventId
        && !retiredEventWasRead
      ) {
        const retired = remoteEvents.get(retiredEventId)!;
        retiredEventWasRead = true;
        // Return the version A read, then remove it before A's conditional
        // PATCH. A's PATCH must receive 404 whether or not it has If-Match.
        remoteEvents.delete(retiredEventId);
        return jsonResponse({ ...retired.body, etag: retired.etag, id: retired.id });
      }
      const version = ((body?.extendedProperties as {
        private?: { mutationVersion?: string };
      } | undefined)?.private?.mutationVersion);
      if (
        init.method !== 'PATCH'
        || requestEventId !== eventId
        || version !== versions.A
      ) {
        return null;
      }
      delayedAIfMatch = new Headers(init.headers).get('If-Match');
      patchAEntered();
      await release;
      // Resume against the actual current map state. C now exists with a newer
      // ETag, so the ordinary provider fake returns 412 for A's stale If-Match.
      // If production drops the header, the same existing-event PATCH is
      // unconditional and restores A, failing the assertions below.
      return null;
    };

    const call = (attempt: number, version: string) =>
      syncGoogleCalendarEventForAppointment(calendarInput(version, eventId), {
        attemptFence: { jobId, claimedAttempt: attempt },
        idempotencyKey,
        persistResult: false,
        targetCalendarId: 'primary',
      });

    const attemptA = syncGoogleCalendarEventForAppointment(
      calendarInput(versions.A, retiredEventId),
      {
        attemptFence: { jobId, claimedAttempt: 1 },
        idempotencyKey,
        persistResult: false,
        targetCalendarId: 'primary',
      },
    );
    await entered;
    await db.update(schema.integrationOutboxSchema).set({ attempts: 2 })
      .where(eq(schema.integrationOutboxSchema.id, jobId));

    await expect(call(2, versions.C))
      .resolves.toMatchObject({ status: 'synced' });

    releasePatchA();

    await expect(attemptA).resolves.toMatchObject({
      eventId,
      status: 'synced',
    });

    expect(retiredEventWasRead).toBe(true);
    expect(delayedAIfMatch).toBe('etag_b');
    expect(remoteEvents.size).toBe(1);

    const remote = remoteEvents.get(eventId)!;

    expect((remote.body.extendedProperties as {
      private: { mutationVersion: string };
    }).private.mutationVersion).toBe(versions.C);

    const [connection] = await db.select()
      .from(schema.salonGoogleCalendarConnectionSchema)
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    expect(connection).toMatchObject({
      encryptedRefreshToken: 'enc:rotated-c',
      status: 'active',
    });
  });

  it('transactionally adopts an ambiguous legacy create and resolves late A behind B and C', async () => {
    const versions = {
      A: '2099-09-01T01:00:00.000Z',
      B: '2099-09-01T02:00:00.000Z',
      C: '2099-09-01T03:00:00.000Z',
    } as const;
    const legacyIdentity = `appointment-revision:${versions.A}`;
    const canonicalEventId = deterministicGoogleCalendarEventId({
      appointmentId: APPOINTMENT_ID,
      idempotencyKey: legacyIdentity,
      salonId: SALON_ID,
    });
    const legacyJobId = 'legacy_ambiguous_create_a';
    await db.update(schema.appointmentSchema).set({
      updatedAt: new Date(versions.A),
    }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    await db.insert(schema.integrationOutboxSchema).values({
      id: legacyJobId,
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'sync_appointment',
      dedupeKey: legacyJobId,
      payload: {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: versions.A,
        targetCalendarId: 'primary',
      },
      status: 'retry',
      attempts: 1,
      availableAt: new Date('2200-01-01T00:00:00.000Z'),
      lastError: 'accepted response lost before identity lanes existed',
    });
    const preexistingCleanupId = 'legacy_canonical_cleanup_before_adoption';

    await db.insert(schema.integrationOutboxSchema).values({
      id: preexistingCleanupId,
      salonId: SALON_ID,
      appointmentId: APPOINTMENT_ID,
      provider: 'google_calendar',
      operation: 'delete_event',
      dedupeKey: preexistingCleanupId,
      payload: {
        appointmentId: APPOINTMENT_ID,
        cleanup: true,
        googleCalendarEventId: canonicalEventId,
        mutationVersion: null,
        salonId: SALON_ID,
        targetCalendarId: 'primary',
      },
      availableAt: new Date('2200-01-01T00:00:00.000Z'),
    });

    // The old deterministic POST was accepted, but the application never
    // received its response. This is provider scheduling, not a second current
    // application transport: the durable row remains a retry while B/C adopt
    // its exact identity before either reaches Calendar.
    remoteEvents.set(canonicalEventId, {
      id: canonicalEventId,
      etag: 'etag_legacy_a',
      body: {
        extendedProperties: { private: { mutationVersion: versions.A } },
        start: { dateTime: '2099-09-01T15:00:00.000Z' },
      },
    });

    let releaseLateA!: () => void;
    let lateAEntered!: () => void;
    const lateAEnteredPromise = new Promise<void>(resolve => (lateAEntered = resolve));
    const lateARelease = new Promise<void>(resolve => (releaseLateA = resolve));
    let servedStaleProviderRead = false;
    let lateAIfMatch: string | null = null;
    let lateAReleased = false;
    let lateARefreshes = 0;
    const deleteTargets: string[] = [];
    const adoptionSnapshots: Array<Array<{
      id: string;
      operation: string;
      payload: Record<string, unknown>;
      status: string;
    }>> = [];
    const assertAdoptedBeforeProviderIo = async () => {
      const rows = await db.select({
        id: schema.integrationOutboxSchema.id,
        operation: schema.integrationOutboxSchema.operation,
        payload: schema.integrationOutboxSchema.payload,
        status: schema.integrationOutboxSchema.status,
      }).from(schema.integrationOutboxSchema).where(
        eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID),
      );

      expect(rows.find(row => row.id === legacyJobId)).toEqual(expect.objectContaining({
        payload: expect.objectContaining({
          googleCalendarEventId: canonicalEventId,
          providerEventIdentity: legacyIdentity,
          targetCalendarId: 'primary',
        }),
      }));
      expect(rows.find(row => row.id === preexistingCleanupId)).toEqual(
        expect.objectContaining({ status: 'cancelled' }),
      );

      return jsonResponse({ access_token: 'access-adopter', expires_in: 3600 });
    };
    eventHook = async ({ body, init, url }) => {
      const requestEventId = eventIdFromUrl(url);
      const version = ((body?.extendedProperties as {
        private?: { mutationVersion?: string };
      } | undefined)?.private?.mutationVersion);
      if (init.method === 'DELETE' && requestEventId) {
        deleteTargets.push(requestEventId);
        return null;
      }
      if (
        init.method === 'GET'
        && requestEventId === canonicalEventId
        && !servedStaleProviderRead
      ) {
        servedStaleProviderRead = true;
        // The retry observes an older provider snapshot and prepares a
        // conditional A write. The authoritative remote map remains A until
        // B/C update it; only the returned read snapshot is stale.
        return jsonResponse({
          id: canonicalEventId,
          etag: 'etag_legacy_a',
          extendedProperties: {
            private: { mutationVersion: '2099-09-01T00:00:00.000Z' },
          },
        });
      }
      if (
        init.method === 'PATCH'
        && requestEventId === canonicalEventId
        && version === versions.A
      ) {
        lateAIfMatch = new Headers(init.headers).get('If-Match');
        lateAEntered();
        await lateARelease;
        return null;
      }
      if (
        init.method === 'GET'
        && requestEventId === canonicalEventId
        && lateAIfMatch !== null
        && lateAReleased
      ) {
        lateARefreshes += 1;
        return null;
      }
      if (
        ['POST', 'PATCH'].includes(init.method ?? '')
        && (version === versions.B || version === versions.C)
      ) {
        const rows = await db.select({
          id: schema.integrationOutboxSchema.id,
          operation: schema.integrationOutboxSchema.operation,
          payload: schema.integrationOutboxSchema.payload,
          status: schema.integrationOutboxSchema.status,
        }).from(schema.integrationOutboxSchema).where(
          eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID),
        );
        adoptionSnapshots.push(rows.map(row => ({
          id: row.id,
          operation: row.operation,
          payload: row.payload as Record<string, unknown>,
          status: row.status,
        })));
        return null;
      }
      return null;
    };

    // This request intentionally has no modern dispatch or attempt fence: it
    // represents a pre-upgrade provider retry already in flight. The stale
    // conditional write itself remains protected by Google ETag ordering.
    const lateA = syncGoogleCalendarEventForAppointment(
      calendarInput(versions.A, canonicalEventId),
      {
        idempotencyKey: legacyIdentity,
        persistResult: false,
        targetCalendarId: 'primary',
      },
    );
    await lateAEnteredPromise;
    tokenHandlers.push(assertAdoptedBeforeProviderIo, assertAdoptedBeforeProviderIo);

    const enqueueRevision = async (
      mutationVersion: string,
      startTime: string,
      endTime: string,
    ) => {
      await db.transaction(async (tx) => {
        await tx.update(schema.appointmentSchema).set({
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          updatedAt: new Date(mutationVersion),
        }).where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
        await enqueueGoogleCalendarAppointmentMutation(tx, {
          appointmentId: APPOINTMENT_ID,
          salonId: SALON_ID,
          mutationVersion: new Date(mutationVersion),
        });
      });
    };

    await enqueueRevision(
      versions.B,
      '2099-09-01T17:00:00.000Z',
      '2099-09-01T18:00:00.000Z',
    );

    await expect(processIntegrationOutbox(1)).resolves.toMatchObject({
      scanned: 1,
      succeeded: 1,
    });

    await enqueueRevision(
      versions.C,
      '2099-09-01T19:00:00.000Z',
      '2099-09-01T20:00:00.000Z',
    );

    await expect(processIntegrationOutbox(1)).resolves.toMatchObject({
      scanned: 1,
      succeeded: 1,
    });

    lateAReleased = true;
    releaseLateA();

    await expect(lateA).resolves.toMatchObject({
      eventId: canonicalEventId,
      status: 'synced',
    });

    await db.update(schema.integrationOutboxSchema).set({
      availableAt: new Date('2000-01-01T00:00:00.000Z'),
    }).where(eq(schema.integrationOutboxSchema.id, legacyJobId));

    await expect(processIntegrationOutbox(1)).resolves.toMatchObject({
      scanned: 1,
      succeeded: 1,
    });

    expect(adoptionSnapshots).toHaveLength(2);

    for (const snapshot of adoptionSnapshots) {
      expect(snapshot.length).toBeGreaterThanOrEqual(2);
      expect(snapshot).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: legacyJobId,
          payload: expect.objectContaining({
            googleCalendarEventId: canonicalEventId,
            providerEventIdentity: legacyIdentity,
            providerEventLane: 'initial',
            targetCalendarId: 'primary',
          }),
        }),
        expect.objectContaining({
          id: preexistingCleanupId,
          operation: 'delete_event',
          status: 'cancelled',
        }),
      ]));
      expect(snapshot.every(({ payload }) => (
        payload.cleanup === true
        || (
          payload.providerEventIdentity === legacyIdentity
          && payload.googleCalendarEventId === canonicalEventId
        )
      ))).toBe(true);
    }

    expect(lateAIfMatch).toBe('etag_legacy_a');
    expect(lateARefreshes).toBe(1);
    expect(deleteTargets).toEqual([]);
    expect(remoteEvents.size).toBe(1);
    expect(remoteEvents.has(deterministicGoogleCalendarEventId({
      appointmentId: APPOINTMENT_ID,
      idempotencyKey: 'appointment-lane:initial',
      salonId: SALON_ID,
    }))).toBe(false);

    const canonicalRemote = remoteEvents.get(canonicalEventId)!;

    expect(canonicalRemote.etag).not.toBe(lateAIfMatch);
    expect(canonicalRemote.body).toEqual(expect.objectContaining({
      extendedProperties: {
        private: expect.objectContaining({ mutationVersion: versions.C }),
      },
      start: expect.objectContaining({ dateTime: '2099-09-01T19:00:00.000Z' }),
    }));

    const jobs = await db.select().from(schema.integrationOutboxSchema)
      .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));

    expect(jobs.find(job => job.id === legacyJobId)).toEqual(expect.objectContaining({
      attempts: 2,
      lastError: 'SUPERSEDED',
      status: 'cancelled',
    }));
    expect(jobs.filter(job => job.operation === 'delete_event')).toEqual([
      expect.objectContaining({
        id: preexistingCleanupId,
        lastError: 'CANONICAL_PROVIDER_IDENTITY_ADOPTED',
        status: 'cancelled',
      }),
    ]);
    expect(jobs.filter(job => job.operation !== 'delete_event').map(job => job.status).sort())
      .toEqual(['cancelled', 'completed', 'completed']);

    const appointment = await currentAppointment();

    expect(appointment).toEqual(expect.objectContaining({
      googleCalendarEventId: canonicalEventId,
      googleCalendarSyncStatus: 'synced',
      startTime: new Date('2099-09-01T19:00:00.000Z'),
    }));

    const activeMirrors = (await db.select().from(schema.googleCalendarEventSchema))
      .filter(mirror => mirror.appointmentId === APPOINTMENT_ID && !mirror.deletedAt);

    expect(activeMirrors).toHaveLength(1);
    expect(activeMirrors[0]).toEqual(expect.objectContaining({
      calendarId: 'primary',
      googleEventId: canonicalEventId,
      syncMode: 'bidirectional',
    }));
  });
});
