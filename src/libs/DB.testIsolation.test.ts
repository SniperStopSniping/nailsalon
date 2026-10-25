import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const originalEnvironment = { ...process.env };

/**
 * Database test-isolation contract.
 *
 * Local .env files (and CI job env) may carry a real development
 * DATABASE_URL. Automated tests must never connect to it:
 * - vitest.config.mts strips DATABASE_URL from the loaded .env files
 * - vitest-setup.ts deletes shell/CI-inherited values
 * - src/libs/DB.ts refuses to open a real connection under Vitest
 */
describe('database test isolation', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.restoreAllMocks();
  });

  it('never exposes a DATABASE_URL to the test environment', () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it('selects the in-memory PGlite database and never creates a Postgres pool', async () => {
    const globals = globalThis as typeof globalThis & {
      pgDrizzle?: unknown;
      pgPool?: unknown;
      pgTargetFingerprint?: unknown;
      pgliteClient?: unknown;
      pgliteDataSource?: unknown;
      pgliteDrizzle?: unknown;
      pgliteSeeded?: boolean;
    };
    const globalKeys = [
      'pgDrizzle',
      'pgPool',
      'pgTargetFingerprint',
      'pgliteClient',
      'pgliteDataSource',
      'pgliteDrizzle',
      'pgliteSeeded',
    ] as const;
    const previousGlobals = new Map(globalKeys.map(key => [
      key,
      {
        present: Object.prototype.hasOwnProperty.call(globals, key),
        value: globals[key],
      },
    ] as const));

    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    class PGliteMock {
      waitReady = Promise.resolve();
    }
    const pgliteConstructor = vi.fn(PGliteMock);
    const drizzleDatabase = {};
    const drizzlePglite = vi.fn(() => drizzleDatabase);
    const migratePglite = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@electric-sql/pglite', () => ({ PGlite: pgliteConstructor }));
    vi.doMock('drizzle-orm/pglite', () => ({ drizzle: drizzlePglite }));
    vi.doMock('drizzle-orm/pglite/migrator', () => ({ migrate: migratePglite }));

    for (const key of globalKeys) {
      delete globals[key];
    }
    // Skip application fixture seeding: this unit test concerns target
    // selection, while real PGlite migration/seed behavior is covered by the
    // PGlite integration suites.
    globals.pgliteSeeded = true;

    try {
      const { db, usesRuntimePostgres, getRuntimeDatabaseBindingStatus } = await import('./DB');

      expect(db).toBe(drizzleDatabase);
      expect(usesRuntimePostgres).toBe(false);

      process.env.LUSTER_EXPECTED_DATABASE_BINDING = JSON.stringify({
        host: 'approved.example.test',
        port: 5432,
        database: 'approved_db',
        sessionUser: 'login_role',
        currentUser: 'effective_role',
      });

      expect(await getRuntimeDatabaseBindingStatus()).toBe('unavailable');
      expect(pgliteConstructor).toHaveBeenCalledOnce();
      expect(globals.pgliteClient).toBeDefined();
      expect(drizzlePglite).toHaveBeenCalledWith(globals.pgliteClient, expect.any(Object));
      expect(migratePglite).toHaveBeenCalledOnce();
      expect(globals.pgPool).toBeUndefined();
      expect(globals.pgDrizzle).toBeUndefined();
      expect(globals.pgTargetFingerprint).toBeUndefined();
    } finally {
      vi.doUnmock('@electric-sql/pglite');
      vi.doUnmock('drizzle-orm/pglite');
      vi.doUnmock('drizzle-orm/pglite/migrator');
      vi.resetModules();

      for (const [key, previous] of previousGlobals) {
        if (previous.present) {
          Object.assign(globals, { [key]: previous.value });
        } else {
          delete globals[key];
        }
      }
    }
  });

  it('fails loudly instead of connecting when a DATABASE_URL leaks into a test run', async () => {
    vi.resetModules();
    // Runtime-built and non-routable so this fixture cannot resemble a usable secret.
    const protocol = ['postgre', 'sql'].join('');
    const credentials = ['fixture-user', 'fixture-password'].join(':');
    process.env.DATABASE_URL = `${protocol}://${credentials}@example.invalid/test`;

    await expect(import('./DB')).rejects.toThrow(
      /Refusing to connect to a real database during tests/,
    );

    // The guard must throw before any client is constructed.
    const globals = globalThis as typeof globalThis & { pgPool?: unknown };

    expect(globals.pgPool).toBeUndefined();
  });

  it.each(['preview', 'production'])(
    'fails closed instead of selecting PGlite when hosted %s has no database',
    async (environment) => {
      vi.resetModules();
      process.env = {
        ...originalEnvironment,
        APP_ENV: environment,
        NODE_ENV: 'production',
        VERCEL: '1',
        VERCEL_ENV: environment,
      };
      delete process.env.DATABASE_URL;
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.VITEST;

      await expect(import('./DB')).rejects.toMatchObject({
        code: 'HOSTED_DATABASE_REQUIRED',
      });
    },
  );

  it('rejects a cached pool whose non-secret target fingerprint changed', async () => {
    vi.resetModules();
    const globals = globalThis as typeof globalThis & {
      pgDrizzle?: unknown;
      pgPool?: unknown;
      pgTargetFingerprint?: string;
    };
    globals.pgPool = {};
    globals.pgDrizzle = {};
    globals.pgTargetFingerprint = 'different-target';

    process.env = {
      ...originalEnvironment,
      APP_ENV: 'development',
      DATABASE_URL: 'postgresql://127.0.0.1:5432/luster_development',
    };
    delete process.env.VERCEL_ENV;
    delete process.env.VITEST;

    try {
      await expect(import('./DB')).rejects.toMatchObject({
        code: 'CACHED_DATABASE_TARGET_MISMATCH',
      });
    } finally {
      delete globals.pgPool;
      delete globals.pgDrizzle;
      delete globals.pgTargetFingerprint;
    }
  });
});
