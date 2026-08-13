/** PostgreSQL-only red/green probes for the pair lock and obsolete finalizer. */
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attestDisposableDatabaseSession,
  type DisposableDatabaseTarget,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
const REQUIRED = process.env.D5_CONCURRENCY_REQUIRED === 'true';
let disposableTarget: DisposableDatabaseTarget | null = null;
if (RAW_URL) {
  disposableTarget = requireDisposableDatabaseTarget({
    ...process.env,
    DATABASE_URL: RAW_URL,
  });
} else if (REQUIRED) {
  throw new Error('D5 mutant PostgreSQL target is required but absent.');
}

vi.mock('server-only', () => ({}));
vi.mock('@/core/redis/redisClient', () => ({
  redis: null,
  isRedisAvailable: vi.fn(async () => false),
}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
  labelDispatchSession: false,
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
  withDedicatedDatabaseSession: <T>(work: (database: unknown) => Promise<T>) =>
    holder.withSession(work) as Promise<T>,
}));
vi.mock('@/libs/Env', () => ({
  Env: {
    GOOGLE_CALENDAR_ENABLED: 'false',
    GOOGLE_OAUTH_CLIENT_ID: 'scope-clean-test-client',
    GOOGLE_OAUTH_CLIENT_SECRET: 'scope-clean-test-secret',
  },
}));
vi.mock('@/libs/lusterSecurity', () => ({
  decryptIntegrationSecret: (value: string) => value.replace(/^enc:/, ''),
  encryptIntegrationSecret: (value: string) => ({
    ciphertext: `enc:${value}`,
    keyVersion: 1,
  }),
}));

/* eslint-disable import/first */
import {
  acquireGoogleCalendarEventPairMutationBarrierInTx,
  enqueueGoogleCalendarAppointmentMutation,
  processIntegrationOutbox,
} from './integrationOutbox';
/* eslint-enable import/first */

const SALON_ID = 'salon_scope_clean_mutants';
const APPOINTMENT_ID = 'appointment_scope_clean_mutants';
const CALENDAR_ID = 'calendar_scope_clean_mutants';
const EVENT_ID = 'event_scope_clean_mutants';

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let executedTests = 0;
const ADVANCE_TRIGGER = 'd5_ver1_advance_stale_attempt_trigger';
const ADVANCE_FUNCTION = 'd5_ver1_advance_stale_attempt';

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

const suite = disposableTarget ? describe : describe.skip;

suite('scope-clean PostgreSQL mutants', () => {
  beforeAll(async () => {
    if (!disposableTarget) {
      throw new Error('Disposable target unexpectedly absent.');
    }
    const expectedServer = resolveDisposableDatabaseServerExpectation(disposableTarget);
    pool = new pg.Pool({ connectionString: disposableTarget.connectionString, max: 8 });
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
      const labelDispatchSession = holder.labelDispatchSession;
      try {
        if (labelDispatchSession) {
          await client.query('SET application_name = \'d5_ver1_provider_dispatch\'');
        }
        return await work(drizzle(client, { schema }));
      } finally {
        if (labelDispatchSession) {
          await client.query('RESET application_name');
        }
        client.release();
      }
    };
    await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  }, 120_000);

  beforeEach(async () => {
    vi.clearAllMocks();
    holder.labelDispatchSession = false;
    await pool.query(`
      DROP TRIGGER IF EXISTS ${ADVANCE_TRIGGER} ON integration_outbox;
      DROP FUNCTION IF EXISTS ${ADVANCE_FUNCTION}();
    `);
    await pool.query(`TRUNCATE TABLE
      google_calendar_event,
      integration_outbox,
      salon_google_calendar_connection,
      appointment,
      salon
      RESTART IDENTITY CASCADE`);
    await db.insert(schema.salonSchema).values({
      id: SALON_ID,
      name: 'Scope Clean Mutant Salon',
      slug: 'scope-clean-mutant-salon',
      settings: { booking: { timezone: 'America/Toronto' } },
    });
    await db.insert(schema.salonGoogleCalendarConnectionSchema).values({
      salonId: SALON_ID,
      encryptedRefreshToken: 'encrypted-test-token',
      destinationCalendarId: CALENDAR_ID,
      busyCalendarIds: [CALENDAR_ID],
      status: 'active',
    });
    await db.insert(schema.appointmentSchema).values({
      id: APPOINTMENT_ID,
      salonId: SALON_ID,
      clientName: 'Mutant Client',
      clientPhone: '4165550100',
      startTime: new Date('2099-09-01T15:00:00.000Z'),
      endTime: new Date('2099-09-01T16:00:00.000Z'),
      googleCalendarSyncStatus: 'pending',
      status: 'confirmed',
      totalDurationMinutes: 60,
      totalPrice: 5000,
    });
  });

  afterEach(async () => {
    holder.labelDispatchSession = false;
    await pool.query(`
      DROP TRIGGER IF EXISTS ${ADVANCE_TRIGGER} ON integration_outbox;
      DROP FUNCTION IF EXISTS ${ADVANCE_FUNCTION}();
    `);
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }

    expect(executedTests).toBe(2);
  });

  it('serializes exact provider calendar/event-pair ownership across sessions', async () => {
    let signalFirstAcquired!: () => void;
    let releaseFirst!: () => void;
    const firstAcquired = new Promise<void>((resolve) => {
      signalFirstAcquired = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = db.transaction(async (tx) => {
      const acquired = await acquireGoogleCalendarEventPairMutationBarrierInTx(tx, {
        expectedMirrorId: null,
        expectedSalonId: SALON_ID,
        googleCalendarEventId: EVENT_ID,
        targetCalendarId: CALENDAR_ID,
      });
      signalFirstAcquired();
      await firstRelease;
      return acquired;
    });
    await firstAcquired;

    const second = await db.transaction(tx =>
      acquireGoogleCalendarEventPairMutationBarrierInTx(tx, {
        expectedMirrorId: null,
        expectedSalonId: SALON_ID,
        googleCalendarEventId: EVENT_ID,
        targetCalendarId: CALENDAR_ID,
      }));

    expect(second).toBe(false);

    releaseFirst();

    await expect(first).resolves.toBe(true);

    executedTests += 1;
  });

  it('prevents an obsolete provider attempt from finalizing durable state', async () => {
    await db.transaction(async (tx) => {
      const [appointment] = await tx.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
      await enqueueGoogleCalendarAppointmentMutation(tx, {
        appointmentId: APPOINTMENT_ID,
        salonId: SALON_ID,
        mutationVersion: appointment!.updatedAt,
      });
    });

    let signalProviderEntered!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>(resolve => (signalProviderEntered = resolve));
    const providerRelease = new Promise<void>(resolve => (releaseProvider = resolve));
    let tokenTransportCalls = 0;
    let calendarMutationCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (urlValue: string | URL, init: RequestInit = {}) => {
      const url = String(urlValue);
      if (url.includes('oauth2.googleapis.com/token')) {
        tokenTransportCalls += 1;
        return jsonResponse({
          access_token: 'stale-attempt-access-token',
          expires_in: 3600,
        });
      }
      if (
        url.includes('/calendar/v3/calendars/')
        && init.method === 'POST'
      ) {
        calendarMutationCalls += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        signalProviderEntered();
        await providerRelease;
        return jsonResponse({
          ...body,
          etag: 'etag_obsolete_attempt',
          id: String(body.id),
        });
      }
      if (
        url.includes('/calendar/v3/calendars/')
        && init.method === 'GET'
        && url.includes('/events?')
      ) {
        return jsonResponse({ items: [] });
      }
      throw new Error(`UNEXPECTED_GOOGLE_TRANSPORT:${init.method ?? 'GET'}:${url}`);
    }));

    holder.labelDispatchSession = true;
    const obsoleteWorker = processIntegrationOutbox(1);
    const prepared = await (async () => {
      await providerEntered;
      const [claimed] = await db.select().from(schema.integrationOutboxSchema)
        .where(eq(schema.integrationOutboxSchema.appointmentId, APPOINTMENT_ID));

      expect(claimed).toMatchObject({ attempts: 1, status: 'processing' });

      const newOwnerLastCheckedAt = new Date('2099-09-01T17:00:00.000Z');
      const newOwnerTokenExpiresAt = new Date('2099-09-01T18:00:00.000Z');
      const [ownerAppointment] = await db.select().from(schema.appointmentSchema)
        .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));

      // The inner dispatch session performs its final attempt-fenced refresh
      // after the provider response. Advance durable ownership only on the outer
      // lease heartbeat that follows it, so the real success finalizer receives
      // the stale result and must reject it at its own attempt predicate.
      await pool.query(`
        CREATE FUNCTION ${ADVANCE_FUNCTION}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.id = '${claimed!.id}'
            AND OLD.salon_id = '${SALON_ID}'
            AND OLD.appointment_id = '${APPOINTMENT_ID}'
            AND OLD.attempts = 1
            AND NEW.attempts = 1
            AND NEW.status = 'processing'
            AND current_setting('application_name', true)
              IS DISTINCT FROM 'd5_ver1_provider_dispatch'
          THEN
            NEW.attempts := 2;
            NEW.status := 'processing';
            NEW.last_error := 'NEW_OWNER_ATTEMPT';
            NEW.updated_at := '2099-09-01T16:30:00.000Z';
            UPDATE salon_google_calendar_connection SET
              encrypted_refresh_token = 'enc:new-owner-refresh',
              status = 'reconnect_required',
              last_error = 'NEW_OWNER_HEALTH',
              last_checked_at = '${newOwnerLastCheckedAt.toISOString()}',
              token_expires_at = '${newOwnerTokenExpiresAt.toISOString()}',
              updated_at = '2099-09-01T16:30:00.000Z'
            WHERE salon_id = '${SALON_ID}';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER ${ADVANCE_TRIGGER}
          BEFORE UPDATE ON integration_outbox
          FOR EACH ROW EXECUTE FUNCTION ${ADVANCE_FUNCTION}();
      `);
      return {
        claimed: claimed!,
        newOwnerLastCheckedAt,
        newOwnerTokenExpiresAt,
        ownerAppointment,
      };
    })().catch(async (error) => {
      releaseProvider();
      await obsoleteWorker.catch(() => undefined);
      throw error;
    });

    const {
      claimed,
      newOwnerLastCheckedAt,
      newOwnerTokenExpiresAt,
      ownerAppointment,
    } = prepared;

    let rejectUnexpectedThrow!: (error: unknown) => void;
    const unexpectedThrow = new Promise<never>((_resolve, reject) => {
      rejectUnexpectedThrow = reject;
    });
    const monitorUnexpectedThrow = (error: Error) => rejectUnexpectedThrow(error);
    process.once('uncaughtExceptionMonitor', monitorUnexpectedThrow);
    releaseProvider();

    let summary: Awaited<typeof obsoleteWorker>;
    try {
      // Monitoring does not consume the exception. It makes a disposable
      // finalizer reachability throw fail this exact test as well as the run.
      summary = await Promise.race([obsoleteWorker, unexpectedThrow]);
    } finally {
      process.off('uncaughtExceptionMonitor', monitorUnexpectedThrow);
    }
    const jobs = await db.select().from(schema.integrationOutboxSchema);
    const [appointment] = await db.select().from(schema.appointmentSchema)
      .where(eq(schema.appointmentSchema.id, APPOINTMENT_ID));
    const mirrors = await db.select().from(schema.googleCalendarEventSchema);
    const [connection] = await db.select()
      .from(schema.salonGoogleCalendarConnectionSchema)
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    expect(appointment).toEqual(ownerAppointment);
    expect(mirrors).toEqual([]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: claimed!.id,
      attempts: 2,
      status: 'processing',
      lastError: 'NEW_OWNER_ATTEMPT',
      processedAt: null,
    });
    expect(connection).toMatchObject({
      encryptedRefreshToken: 'enc:new-owner-refresh',
      status: 'reconnect_required',
      lastError: 'NEW_OWNER_HEALTH',
      lastCheckedAt: newOwnerLastCheckedAt,
      tokenExpiresAt: newOwnerTokenExpiresAt,
    });
    expect(tokenTransportCalls).toBe(1);
    expect(calendarMutationCalls).toBe(1);
    expect(summary).toMatchObject({
      scanned: 1,
      succeeded: 0,
      retried: 0,
      failed: 0,
    });

    executedTests += 1;
  });
});
