/**
 * Genuine PostgreSQL concurrency coverage for Booking Experience entitlement
 * overrides.
 *
 * PGlite uses one connection and cannot prove that the salon row lock
 * serializes competing route requests. This opt-in suite therefore runs both
 * real route handlers against an explicitly confirmed, loopback-only,
 * disposable PostgreSQL database.
 */
import path from 'node:path';

import { eq } from 'drizzle-orm';
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

const RAW_DATABASE_URL
  = process.env.BOOKING_ENTITLEMENT_OVERRIDE_TEST_DATABASE_URL ?? '';
let parsedDatabaseUrl: URL | null = null;
try {
  parsedDatabaseUrl = RAW_DATABASE_URL
    ? new URL(RAW_DATABASE_URL)
    : null;
} catch {
  parsedDatabaseUrl = null;
}

const configuredDatabaseName = parsedDatabaseUrl
  ? decodeURIComponent(parsedDatabaseUrl.pathname).replace(/^\//, '')
  : '';
const configuredDatabaseUser = parsedDatabaseUrl
  ? decodeURIComponent(parsedDatabaseUrl.username)
  : '';
const disposableDatabaseConfirmed = (
  process.env.BOOKING_ENTITLEMENT_OVERRIDE_DISPOSABLE_DATABASE_CONFIRMED
  === 'true'
);
const isLoopbackDatabase = parsedDatabaseUrl != null
  && ['127.0.0.1', 'localhost', '::1'].includes(parsedDatabaseUrl.hostname)
  && configuredDatabaseName.length > 0
  && configuredDatabaseUser.length > 0
  && disposableDatabaseConfirmed
  && !RAW_DATABASE_URL.includes('neon.tech');

const suite = isLoopbackDatabase ? describe : describe.skip;

vi.mock('server-only', () => ({}));

const {
  holder,
  getSuperAdminInfo,
  logAuditAction,
  requireSuperAdmin,
  requireSuperAdminGuard,
} = vi.hoisted(() => ({
  holder: { db: null as unknown },
  getSuperAdminInfo: vi.fn(async () => ({
    userId: 'super_admin_concurrency',
    name: 'Concurrency Admin',
    email: 'concurrency-admin@example.test',
  })),
  logAuditAction: vi.fn(async () => {}),
  requireSuperAdmin: vi.fn(async () => null),
  requireSuperAdminGuard: vi.fn(async () => ({
    ok: true as const,
    admin: {
      id: 'super_admin_concurrency',
      email: 'concurrency-admin@example.test',
      name: 'Concurrency Admin',
      isSuperAdmin: true,
      salons: [],
    },
  })),
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/superAdmin', () => ({
  getSuperAdminInfo,
  logAuditAction,
  requireSuperAdmin,
  requireSuperAdminGuard,
}));

const { PATCH } = await import('./route');
const { PUT } = await import(
  '@/app/api/super-admin/organizations/[id]/route'
);

const { Client, Pool } = pg;
const APPLICATION_NAME = 'booking-entitlement-override-concurrency';
const SALON_ID = 'salon_booking_entitlement_concurrency';
const AUDIT_ACTION = 'booking_experience_entitlement_override_changed';

type HeldSalonLock = {
  release: () => Promise<void>;
};

let pool: pg.Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
const pendingLockReleases = new Set<() => Promise<void>>();

function overrideRequest(args: {
  overrideState: 'force_enabled' | 'force_disabled';
  reason: string;
}): Request {
  return new Request(
    `http://localhost/api/super-admin/organizations/${SALON_ID}/entitlements/booking-experience-customization`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...args,
        expectedOverrideState: 'default',
        expectedOverrideAuditId: null,
      }),
    },
  );
}

async function invokeOverride(args: {
  overrideState: 'force_enabled' | 'force_disabled';
  reason: string;
}): Promise<Response> {
  return PATCH(overrideRequest(args), {
    params: Promise.resolve({ id: SALON_ID }),
  });
}

async function invokeGeneralFeatureUpdate(
  features: Record<string, unknown>,
): Promise<Response> {
  return PUT(
    new Request(
      `http://localhost/api/super-admin/organizations/${SALON_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features }),
      },
    ),
    { params: Promise.resolve({ id: SALON_ID }) },
  );
}

async function getSalon() {
  const [salon] = await database
    .select()
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, SALON_ID))
    .limit(1);

  return salon;
}

async function getEntitlementAudits() {
  const audits = await database
    .select()
    .from(schema.salonAuditLogSchema)
    .where(eq(schema.salonAuditLogSchema.salonId, SALON_ID));

  return audits.filter(audit => audit.action === AUDIT_ACTION);
}

async function holdSalonRow(): Promise<HeldSalonLock> {
  const connection = new Client({
    connectionString: RAW_DATABASE_URL,
    application_name: `${APPLICATION_NAME}-blocker`,
  });
  await connection.connect();

  try {
    await connection.query('BEGIN');
    await connection.query(
      'SELECT id FROM salon WHERE id = $1 FOR UPDATE',
      [SALON_ID],
    );
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    await connection.end();
    throw error;
  }

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
      await connection.end();
    }
  };
  pendingLockReleases.add(release);

  return { release };
}

async function waitForBlockedHandlerSessions(
  expectedCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await pool.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND application_name = $1
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND cardinality(pg_blocking_pids(pid)) > 0
    `, [APPLICATION_NAME]);

    if ((result.rows[0]?.count ?? 0) >= expectedCount) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 25));
  }

  throw new Error(
    `Expected ${expectedCount} Booking Experience route sessions to wait on the PostgreSQL row lock`,
  );
}

async function releaseBarrierAndSettle<T>(
  heldLock: HeldSalonLock,
  operations: Array<Promise<T>>,
): Promise<T[]> {
  try {
    await waitForBlockedHandlerSessions(operations.length);
  } catch (error) {
    await heldLock.release();
    await Promise.allSettled(operations);
    throw error;
  }

  await heldLock.release();
  return Promise.all(operations);
}

suite.sequential(
  'Booking Experience entitlement override PostgreSQL concurrency',
  () => {
    beforeAll(async () => {
      pool = new Pool({
        connectionString: RAW_DATABASE_URL,
        max: 8,
        application_name: APPLICATION_NAME,
      });

      const safety = await pool.query<{
        application_name: string;
        database_name: string;
        database_user: string;
      }>(`
        SELECT
          current_database() AS database_name,
          current_user AS database_user,
          current_setting('application_name') AS application_name
      `);
      const actual = safety.rows[0];
      if (
        !actual
        || actual.database_name !== configuredDatabaseName
        || actual.database_user !== configuredDatabaseUser
        || actual.application_name !== APPLICATION_NAME
        || !disposableDatabaseConfirmed
      ) {
        throw new Error(
          'Booking Experience concurrency tests require the explicitly confirmed disposable database',
        );
      }

      await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
      await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
      await pool.query('CREATE SCHEMA public');

      database = drizzle(pool, { schema });
      holder.db = database;
      await migrate(database, {
        migrationsFolder: path.join(process.cwd(), 'migrations'),
      });
    }, 120_000);

    beforeEach(async () => {
      vi.clearAllMocks();
      requireSuperAdmin.mockResolvedValue(null);
      requireSuperAdminGuard.mockResolvedValue({
        ok: true,
        admin: {
          id: 'super_admin_concurrency',
          email: 'concurrency-admin@example.test',
          name: 'Concurrency Admin',
          isSuperAdmin: true,
          salons: [],
        },
      });
      getSuperAdminInfo.mockResolvedValue({
        userId: 'super_admin_concurrency',
        name: 'Concurrency Admin',
        email: 'concurrency-admin@example.test',
      });
      logAuditAction.mockResolvedValue(undefined);

      await pool.query(`
        TRUNCATE TABLE salon_audit_log, salon
        RESTART IDENTITY CASCADE
      `);
      await database.insert(schema.salonSchema).values({
        id: SALON_ID,
        name: 'Booking Entitlement Concurrency Salon',
        slug: 'booking-entitlement-concurrency',
        plan: 'single_salon',
        features: {
          booking: {
            onlineBooking: true,
            staffDashboard: true,
          },
          marketing: {
            rewards: false,
          },
        },
        settings: {
          bookingExperience: {
            primaryColor: '#123456',
            bookingMessage: 'Preserved saved customization',
            policy: {
              enabled: true,
              title: 'Policy',
              text: 'Preserved policy',
            },
            appointmentOnly: true,
            socialLinks: {
              instagram: 'https://instagram.com/example',
              facebook: null,
              tiktok: null,
            },
            confirmationMessage: 'Preserved confirmation message',
          },
        },
      });
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

    it(
      'serializes two dedicated mutations into one success, one conflict, and one audit',
      async () => {
        const heldLock = await holdSalonRow();
        const operations = [
          invokeOverride({
            overrideState: 'force_enabled',
            reason: 'Enable for support exception',
          }),
          invokeOverride({
            overrideState: 'force_disabled',
            reason: 'Disable for support exception',
          }),
        ];

        const responses = await releaseBarrierAndSettle(
          heldLock,
          operations,
        );
        const results = await Promise.all(responses.map(async response => ({
          body: await response.json(),
          status: response.status,
        })));

        expect(results.map(result => result.status).sort()).toEqual([
          200,
          409,
        ]);

        const success = results.find(result => result.status === 200);
        const conflict = results.find(result => result.status === 409);

        expect(success?.body).toMatchObject({
          changed: true,
          bookingExperienceEntitlement: {
            source: 'override',
          },
        });
        expect(conflict?.body).toMatchObject({
          code: 'ENTITLEMENT_OVERRIDE_CONFLICT',
          current: {
            bookingExperienceEntitlement: {
              overrideState:
                success?.body.bookingExperienceEntitlement.overrideState,
            },
          },
        });

        const salon = await getSalon();
        const features = salon?.features;
        const booking = features?.booking;
        const audits = await getEntitlementAudits();

        expect(booking?.customization).toBe(
          success?.body.bookingExperienceEntitlement.overrideState
          === 'force_enabled',
        );
        expect(booking?.customizationOverrideAuditId)
          .toEqual(expect.any(String));
        expect(audits).toHaveLength(1);
        expect(audits[0]?.id).toBe(
          booking?.customizationOverrideAuditId,
        );
        expect(audits[0]?.metadata?.newValue).toMatchObject({
          overrideState:
            success?.body.bookingExperienceEntitlement.overrideState,
        });
      },
      20_000,
    );

    it(
      'preserves the dedicated override while a stale general feature PUT applies unrelated changes',
      async () => {
        const settingsBefore = (await getSalon())?.settings;
        const heldLock = await holdSalonRow();
        const operations = [
          invokeOverride({
            overrideState: 'force_enabled',
            reason: 'Temporary support exception',
          }),
          invokeGeneralFeatureUpdate({
            booking: {
              customization: false,
              customizationOverrideAuditId: 'stale-browser-pointer',
              onlineBooking: false,
              staffDashboard: true,
            },
            marketing: {
              rewards: true,
            },
          }),
        ];

        const responses = await releaseBarrierAndSettle(
          heldLock,
          operations,
        );

        expect(responses.map(response => response.status)).toEqual([
          200,
          200,
        ]);

        const salon = await getSalon();
        const booking = salon?.features?.booking;
        const audits = await getEntitlementAudits();

        expect(booking).toMatchObject({
          customization: true,
          customizationOverrideAuditId: expect.any(String),
          onlineBooking: false,
          staffDashboard: true,
        });
        expect(salon?.features?.marketing?.rewards).toBe(true);
        expect(salon?.settings).toEqual(settingsBefore);
        expect(audits).toHaveLength(1);
        expect(audits[0]?.id).toBe(
          booking?.customizationOverrideAuditId,
        );
      },
      20_000,
    );
  },
);
