import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres';
import { migrate as migratePostgres } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attestDisposableDatabaseSession, requireDisposableDatabaseTarget, resolveDisposableDatabaseServerExpectation } from '@/libs/disposableDatabaseTarget';
import * as schema from '@/models/Schema';

const boundary = vi.hoisted(() => ({
  db: null as unknown,
  fetch: vi.fn(),
  heartbeat: vi.fn(async () => 'sent'),
  alert: vi.fn(async () => true),
  withSession: null as unknown as (work: (database: unknown) => unknown) => unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({
  get db() {
    return boundary.db;
  },
  usesRuntimePostgres: process.env.GOOGLE_CALENDAR_CONTENTION_POSTGRES === 'true',
  DatabaseSessionReleaseError: class DatabaseSessionReleaseError extends Error {},
  withDedicatedDatabaseSession: (work: (database: unknown) => unknown) => boundary.withSession(work),
}));
vi.mock('@/libs/Env', async importOriginal => ({
  Env: {
    ...(await importOriginal<typeof import('@/libs/Env')>()).Env,
    GOOGLE_OAUTH_CLIENT_ID: 'synthetic-calendar-client',
    GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-calendar-secret',
    GOOGLE_CALENDAR_ENABLED: 'false',
  },
}));
vi.mock('@/libs/lusterSecurity', async importOriginal => ({
  ...await importOriginal<typeof import('@/libs/lusterSecurity')>(),
  decryptIntegrationSecret: (value: string) => value.replace('encrypted:', ''),
  encryptIntegrationSecret: (value: string) => ({ ciphertext: `encrypted:${value}`, keyVersion: 1 }),
}));
vi.mock('@/libs/googleCalendarAlerts', () => ({ sendGoogleCalendarDisconnectedEmail: boundary.alert }));
vi.mock('@/libs/cronHeartbeat', () => ({ pingCronHeartbeat: boundary.heartbeat }));

/* eslint-disable import/first */
import { POST } from '@/app/api/integrations/outbox/process/route';

import { GoogleCalendarConnectionWriteFenceError, listGoogleCalendarEventsForSalon, listGoogleCalendarsForSalon, syncGoogleCalendarEventForAppointment } from './googleCalendar';
/* eslint-enable import/first */

const SALON_ID = 'salon_worker_contention';
const CALENDAR_ID = 'calendar_worker_contention';
const postgresTarget = process.env.GOOGLE_CALENDAR_CONTENTION_POSTGRES === 'true'
  ? requireDisposableDatabaseTarget({ ...process.env, DATABASE_URL: process.env.CONCURRENCY_TEST_DATABASE_URL })
  : null;
let client: PGlite | undefined;
let pool: pg.Pool | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | ReturnType<typeof drizzlePostgres<typeof schema>>;
let providerPaths: string[];
let refreshTokens: Array<string | null>;
let pendingTokens: Array<(response: Response) => void>;
let holdTokenCount: number;
let executed = 0;

const tokenResponse = () => Response.json({ access_token: 'synthetic-access', expires_in: 3600 });

beforeAll(async () => {
  if (postgresTarget) {
    pool = new pg.Pool({ connectionString: postgresTarget.connectionString, max: 8 });
    const connection = await pool.connect();
    try {
      await attestDisposableDatabaseSession(connection, postgresTarget, resolveDisposableDatabaseServerExpectation(postgresTarget));
    } finally {
      connection.release();
    }
    const postgresDb = drizzlePostgres(pool, { schema });
    await migratePostgres(postgresDb, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    db = postgresDb;
    boundary.withSession = async (work) => {
      const session = await pool!.connect();
      try {
        return await work(drizzlePostgres(session, { schema }));
      } finally {
        session.release();
      }
    };
  } else {
    client = new PGlite();
    await client.waitReady;
    const localDb = drizzle(client, { schema });
    await migrate(localDb, { migrationsFolder: path.join(process.cwd(), 'migrations') });
    db = localDb;
    boundary.withSession = work => work(boundary.db);
  }
  boundary.db = db;
}, 60_000);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'synthetic-worker-secret');
  providerPaths = [];
  refreshTokens = [];
  pendingTokens = [];
  holdTokenCount = 0;
  boundary.fetch.mockImplementation(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.href === 'https://oauth2.googleapis.com/token') {
      expect(init.method).toBe('POST');

      refreshTokens.push(new URLSearchParams(String(init.body)).get('refresh_token'));
      if (pendingTokens.length < holdTokenCount) {
        return new Promise<Response>((resolve) => {
          pendingTokens.push(resolve);
        });
      }
      return tokenResponse();
    }
    if (url.origin !== 'https://www.googleapis.com') {
      throw new Error(`Unexpected provider origin: ${url.origin}`);
    }
    providerPaths.push(url.pathname);

    expect(init.method ?? 'GET').toBe('GET');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer synthetic-access');

    if (url.pathname === '/calendar/v3/users/me/calendarList') {
      return Response.json({ items: [{ id: CALENDAR_ID, summary: 'Synthetic calendar', accessRole: 'owner' }] });
    }
    if (url.pathname === `/calendar/v3/calendars/${CALENDAR_ID}/events`) {
      return Response.json({ items: [] });
    }
    throw new Error(`Unexpected provider path: ${url.pathname}`);
  });
  vi.stubGlobal('fetch', boundary.fetch);
  if (pool) {
    // Only the explicitly opted-in, URL-guarded and live-attested disposable
    // job database can enter this branch. Real workers need an empty queue.
    await pool.query('TRUNCATE TABLE salon CASCADE');
  }
  await db.delete(schema.salonGoogleCalendarConnectionSchema).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
  await db.delete(schema.salonSchema).where(eq(schema.salonSchema.id, SALON_ID));
  await db.insert(schema.salonSchema).values({ id: SALON_ID, name: 'Synthetic contention salon', slug: 'synthetic-contention' });
  await db.insert(schema.salonGoogleCalendarConnectionSchema).values({
    salonId: SALON_ID,
    status: 'active',
    encryptedRefreshToken: 'encrypted:synthetic-refresh',
    destinationCalendarId: CALENDAR_ID,
    busyCalendarIds: [CALENDAR_ID],
    inboundSyncEnabled: true,
  });
});

afterEach(() => {
  executed += 1;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await client?.close();
  await pool?.end();
  if (postgresTarget) {
    process.stdout.write(`CALENDAR_CONTENTION_POSTGRES_TESTS_EXECUTED=${executed} CALENDAR_CONTENTION_POSTGRES_TESTS_SKIPPED=0\n`);
  }
});

describe('actual Calendar workers sharing one connection', () => {
  it.each([0, 1])('both cron lanes keep making progress when token response %s wins three revision races', async (winner) => {
    for (let round = 0; round < 3; round++) {
      pendingTokens = [];
      providerPaths = [];
      holdTokenCount = 2;
      const operation = POST(new Request('http://localhost/api/integrations/outbox/process', {
        method: 'POST',
        headers: { 'x-cron-secret': 'synthetic-worker-secret' },
      }));
      await vi.waitFor(() => expect(pendingTokens).toHaveLength(2));
      pendingTokens[winner]!(tokenResponse());
      // A Calendar request proves the first context write has committed. The
      // other token response still belongs to the old, actually stored xmin.
      await vi.waitFor(() => expect(providerPaths.length).toBeGreaterThan(0));
      pendingTokens[1 - winner]!(tokenResponse());
      const response = await operation;
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.data.outbound.failedCancelledEvents).toBe(0);
      expect(result.data.inbound.failedConnections).toBe(0);
      expect(providerPaths.filter(value => value.endsWith('/events'))).toHaveLength(2);
      expect(boundary.heartbeat).toHaveBeenCalledTimes(round + 1);
      expect(boundary.alert).not.toHaveBeenCalled();

      const [connection] = await db.select().from(schema.salonGoogleCalendarConnectionSchema)
        .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

      expect(connection?.status).toBe('active');
      expect(connection?.inboundSyncedAt).toBeInstanceOf(Date);
    }
  });

  it('reacquires the current stored credential after a concurrent credential rotation', async () => {
    holdTokenCount = 1;
    const operation = listGoogleCalendarEventsForSalon({ salonId: SALON_ID });
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(1));
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      encryptedRefreshToken: 'encrypted:current-refresh',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    pendingTokens[0]!(Response.json({ access_token: 'stale-access', refresh_token: 'losing-rotation', expires_in: 3600 }));

    await expect(operation).resolves.toEqual([]);

    expect(refreshTokens).toEqual(['synthetic-refresh', 'current-refresh']);
    expect(providerPaths).toHaveLength(1);

    const [connection] = await db.select().from(schema.salonGoogleCalendarConnectionSchema)
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    expect(connection?.encryptedRefreshToken).toBe('encrypted:current-refresh');
  });

  it('stops after a second revision collision without dispatching a Calendar request', async () => {
    holdTokenCount = 2;
    const operation = listGoogleCalendarEventsForSalon({ salonId: SALON_ID });
    const rejection = expect(operation).rejects.toBeInstanceOf(GoogleCalendarConnectionWriteFenceError);
    for (let attempt = 0; attempt < 2; attempt++) {
      await vi.waitFor(() => expect(pendingTokens).toHaveLength(attempt + 1));
      await db.update(schema.salonGoogleCalendarConnectionSchema).set({ lastError: `peer-write-${attempt}` })
        .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
      pendingTokens[attempt]!(tokenResponse());
    }
    await rejection;

    expect(refreshTokens).toHaveLength(2);
    expect(providerPaths).toEqual([]);
    expect(boundary.alert).not.toHaveBeenCalled();
  });

  it('does not fall back to a global integration after the tenant connection is deleted', async () => {
    holdTokenCount = 1;
    const operation = listGoogleCalendarsForSalon(SALON_ID);
    const rejection = expect(operation).rejects.toBeInstanceOf(GoogleCalendarConnectionWriteFenceError);
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(1));
    await db.delete(schema.salonGoogleCalendarConnectionSchema).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    pendingTokens[0]!(tokenResponse());
    await rejection;

    expect(refreshTokens).toHaveLength(1);
    expect(providerPaths).toEqual([]);
  });

  it('honors a parent cancellation before a fresh context can be acquired', async () => {
    holdTokenCount = 1;
    const controller = new AbortController();
    const operation = listGoogleCalendarEventsForSalon({ salonId: SALON_ID }, { signal: controller.signal });
    const rejection = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(1));
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({ lastError: 'peer-write' })
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    controller.abort();
    pendingTokens[0]!(tokenResponse());
    await rejection;

    expect(refreshTokens).toHaveLength(1);
    expect(providerPaths).toEqual([]);
  });

  it('never retries a stale outbox attempt fence', async () => {
    const operation = listGoogleCalendarsForSalon(SALON_ID, {
      attemptFence: { jobId: 'missing-synthetic-job', claimedAttempt: 1 },
    });

    await expect(operation).rejects.toBeInstanceOf(GoogleCalendarConnectionWriteFenceError);

    expect(refreshTokens).toHaveLength(1);
    expect(providerPaths).toEqual([]);
  });

  it('cancels a retry already waiting for its token response', async () => {
    holdTokenCount = 2;
    const controller = new AbortController();
    const operation = listGoogleCalendarEventsForSalon({ salonId: SALON_ID }, { signal: controller.signal });
    const rejection = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(1));
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({ lastError: 'peer-write' })
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    pendingTokens[0]!(tokenResponse());
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(2));
    controller.abort();
    pendingTokens[1]!(tokenResponse());
    await rejection;

    expect(refreshTokens).toHaveLength(2);
    expect(providerPaths).toEqual([]);
  });

  it('leaves appointment mutation acquisition fail-closed after its original fence loses', async () => {
    holdTokenCount = 1;
    const operation = syncGoogleCalendarEventForAppointment({
      salonId: SALON_ID,
      salonName: 'Synthetic salon',
      appointmentId: 'synthetic-appointment',
      clientPhone: '+14165550100',
      serviceNames: ['Synthetic service'],
      startTime: new Date('2099-10-10T14:00:00Z'),
      endTime: new Date('2099-10-10T15:00:00Z'),
      totalPrice: 5000,
      totalDurationMinutes: 60,
      timeZone: 'America/Toronto',
    });
    const rejection = expect(operation).rejects.toBeInstanceOf(GoogleCalendarConnectionWriteFenceError);
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(1));
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({ lastError: 'peer-write' })
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    pendingTokens[0]!(tokenResponse());
    await rejection;

    expect(refreshTokens).toHaveLength(1);
    expect(providerPaths).toEqual([]);
  });

  it('keeps the original aggregate listing deadline during a retry', async () => {
    vi.useFakeTimers();
    holdTokenCount = 2;
    const operation = listGoogleCalendarEventsForSalon({ salonId: SALON_ID }, { timeoutMs: 5_000 });
    const rejection = expect(operation).rejects.toMatchObject({ name: 'GoogleCalendarRequestTimeoutError' });
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(1));
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({ lastError: 'peer-write' })
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    pendingTokens[0]!(tokenResponse());
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(5_001);
    pendingTokens[1]!(tokenResponse());
    await rejection;

    expect(refreshTokens).toHaveLength(2);
    expect(providerPaths).toEqual([]);
  });

  it('does not retry an invalid grant or turn it into a transient revision collision', async () => {
    holdTokenCount = 1;
    const operation = listGoogleCalendarEventsForSalon({ salonId: SALON_ID });
    const rejection = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(1));
    pendingTokens[0]!(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await rejection;

    expect(refreshTokens).toHaveLength(1);
    expect(providerPaths).toEqual([]);
    expect(boundary.alert).toHaveBeenCalledOnce();

    const [connection] = await db.select().from(schema.salonGoogleCalendarConnectionSchema)
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    expect(connection?.status).toBe('reconnect_required');
  });

  it('does not revive a connection disconnected while its token request was in flight', async () => {
    holdTokenCount = 1;
    const operation = listGoogleCalendarEventsForSalon({ salonId: SALON_ID });
    const rejection = expect(operation).rejects.toThrow();
    await vi.waitFor(() => expect(pendingTokens).toHaveLength(1));
    await db.update(schema.salonGoogleCalendarConnectionSchema).set({
      status: 'disconnected',
      lastError: 'OWNER_DISCONNECTED',
    }).where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));
    pendingTokens[0]!(tokenResponse());
    await rejection;

    expect(providerPaths).toEqual([]);
    expect(boundary.fetch).toHaveBeenCalledOnce();
    expect(boundary.alert).not.toHaveBeenCalled();

    const [connection] = await db.select().from(schema.salonGoogleCalendarConnectionSchema)
      .where(eq(schema.salonGoogleCalendarConnectionSchema.salonId, SALON_ID));

    expect(connection?.status).toBe('disconnected');
    expect(connection?.lastError).toBe('OWNER_DISCONNECTED');
  });
});
