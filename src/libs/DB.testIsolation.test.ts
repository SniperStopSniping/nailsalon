import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

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
    delete process.env.DATABASE_URL;
    vi.restoreAllMocks();
  });

  it('never exposes a DATABASE_URL to the test environment', () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it('selects the in-memory PGlite database and never creates a Postgres pool', async () => {
    // The PGlite branch announces itself via console.warn; that log is expected.
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { db } = await import('./DB');

    expect(db).toBeDefined();

    const globals = globalThis as typeof globalThis & {
      pgPool?: unknown;
      pgliteClient?: unknown;
    };

    expect(globals.pgPool).toBeUndefined();
    expect(globals.pgliteClient).toBeDefined();
  });

  it('fails loudly instead of connecting when a DATABASE_URL leaks into a test run', async () => {
    vi.resetModules();
    process.env.DATABASE_URL
      = 'postgresql://user:pw@should-never-connect.invalid:5432/db';

    await expect(import('./DB')).rejects.toThrow(
      /Refusing to connect to a real database during tests/,
    );

    // The guard must throw before any client is constructed.
    const globals = globalThis as typeof globalThis & { pgPool?: unknown };

    expect(globals.pgPool).toBeUndefined();
  });
});
