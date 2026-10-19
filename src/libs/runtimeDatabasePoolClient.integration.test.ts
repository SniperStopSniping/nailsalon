/**
 * Native PostgreSQL regressions for the physical Client pre-connect cooldown.
 * This suite uses the same strictly attested disposable target as D5 and
 * performs only read-only session checks, SELECTs, and SERIALIZABLE read-only
 * transactions. Synthetic typed verifier failures exercise recovery behavior;
 * they do not represent a real provider outage or a wrong live database.
 */
import type { PoolClient, PoolConfig } from 'pg';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  attestDisposableDatabaseSession,
  type DisposableDatabaseServerExpectation,
  type DisposableDatabaseTarget,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from './disposableDatabaseTarget';
import { RuntimeDatabaseGuardError } from './runtimeDatabaseGuard';
import { createRuntimeDatabaseCooldownClient } from './runtimeDatabasePoolClient';
import { createRuntimeDatabaseVerificationCooldown } from './runtimeDatabasePoolRecovery';

vi.mock('server-only', () => ({}));

const EXPECTED_TESTS = 4;
const COOLDOWN_MS = 5_000;
const rawUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
const required = process.env.D5_POOL_COOLDOWN_REQUIRED === 'true';
let target: DisposableDatabaseTarget | null = null;
let expectedServer: DisposableDatabaseServerExpectation | null = null;
let attemptedTests = 0;
let executedTests = 0;

if (rawUrl) {
  target = requireDisposableDatabaseTarget({
    ...process.env,
    DATABASE_URL: rawUrl,
  });
  if (required && !target.serviceContainer) {
    throw new Error(
      'Runtime database pool cooldown PostgreSQL tests require Docker service-container identity evidence.',
    );
  }
  expectedServer = resolveDisposableDatabaseServerExpectation(target);
} else if (required) {
  throw new Error(
    'Runtime database pool cooldown PostgreSQL tests are required, but CONCURRENCY_TEST_DATABASE_URL is absent.',
  );
}

const suite = target ? describe : describe.skip;

type PoolHarness = {
  pool: pg.Pool;
  counts: { physicalConnections: number; verifierAttempts: number };
  setMode: (
    mode: 'availability-failure' | 'healthy' | 'identity-failure',
  ) => void;
  setClock: (time: number) => void;
  releaseVerifierGate: () => void;
};

function typedFailure(
  code: 'DATABASE_UNAVAILABLE' | 'DATABASE_ATTESTATION_REJECTED',
) {
  return new RuntimeDatabaseGuardError(code);
}

function createPoolHarness(
  initialMode: 'availability-failure' | 'healthy' | 'identity-failure',
  options: { max?: number; pauseVerifier?: boolean } = {},
): PoolHarness {
  if (!target || !expectedServer) {
    throw new Error(
      'The strictly attested disposable PostgreSQL target is unavailable.',
    );
  }

  let mode = initialMode;
  let clock = 0;
  let releaseVerifierGate!: () => void;
  const verifierGate = options.pauseVerifier
    ? new Promise<void>((resolve) => {
      releaseVerifierGate = resolve;
    })
    : Promise.resolve();
  const counts = { physicalConnections: 0, verifierAttempts: 0 };
  const cooldown = createRuntimeDatabaseVerificationCooldown({
    classify: error =>
      error instanceof RuntimeDatabaseGuardError
        ? error
        : typedFailure('DATABASE_UNAVAILABLE'),
    cooldownMs: COOLDOWN_MS,
    now: () => clock,
  });
  const Client = createRuntimeDatabaseCooldownClient(cooldown);
  const config = {
    connectionString: target.connectionString,
    max: options.max ?? 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 250,
    Client,
    verify(client: PoolClient, callback: (error?: Error) => void) {
      void cooldown
        .guard(async () => {
          counts.verifierAttempts++;
          // Verify the live server identity before allowing any scenario-specific
          // synthetic failure or application query on this physical connection.
          await attestDisposableDatabaseSession(
            client,
            target!,
            expectedServer!,
          );
          if (options.pauseVerifier) {
            await verifierGate;
          }
          if (mode === 'availability-failure') {
            throw typedFailure('DATABASE_UNAVAILABLE');
          }
          if (mode === 'identity-failure') {
            throw typedFailure('DATABASE_ATTESTATION_REJECTED');
          }
        })
        .then(
          () => callback(),
          error =>
            callback(
              error instanceof Error
                ? error
                : typedFailure('DATABASE_UNAVAILABLE'),
            ),
        );
    },
  } as PoolConfig & {
    verify: (client: PoolClient, callback: (error?: Error) => void) => void;
  };
  const pool = new pg.Pool(config);
  pool.on('connect', () => {
    counts.physicalConnections++;
  });

  return {
    pool,
    counts,
    setMode: (nextMode) => {
      mode = nextMode;
    },
    setClock: (time) => {
      clock = time;
    },
    releaseVerifierGate: () => releaseVerifierGate?.(),
  };
}

async function expectGuardRejection(
  promise: Promise<unknown>,
  expectedCode: 'DATABASE_UNAVAILABLE' | 'DATABASE_ATTESTATION_REJECTED',
): Promise<RuntimeDatabaseGuardError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeDatabaseGuardError);
    expect(error).toMatchObject({
      name: 'RuntimeDatabaseGuardError',
      code: expectedCode,
    });
    expect((error as Error).message).not.toContain('postgresql://');

    return error as RuntimeDatabaseGuardError;
  }
  throw new Error('Expected the guarded PostgreSQL query to reject.');
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return predicate();
}

suite('runtime PostgreSQL physical connection cooldown', () => {
  beforeAll(async () => {
    if (!target || !expectedServer) {
      throw new Error(
        'Disposable target unexpectedly absent in required PostgreSQL suite.',
      );
    }

    // Independently attest the configured URL and live server before any pool
    // is created. No schema setup, migrations, or fixture writes are needed.
    const client = new pg.Client({ connectionString: target.connectionString });
    try {
      await client.connect();
      await attestDisposableDatabaseSession(client, target, expectedServer);
    } finally {
      await client.end();
    }
  });

  it('blocks post-failure requests before dialing and recovers on the same pool after cooldown', async () => {
    attemptedTests++;
    const harness = createPoolHarness('availability-failure');
    try {
      const firstError = await expectGuardRejection(
        harness.pool.query('SELECT 1'),
        'DATABASE_UNAVAILABLE',
      );

      expect(harness.counts).toEqual({
        physicalConnections: 1,
        verifierAttempts: 1,
      });

      const burstSize = 20;
      const errors = await Promise.all(
        Array.from({ length: burstSize }, () =>
          expectGuardRejection(
            harness.pool.query('SELECT 1'),
            'DATABASE_UNAVAILABLE',
          )),
      );

      expect(errors.every(error => error === firstError)).toBe(true);
      expect(harness.counts).toEqual({
        physicalConnections: 1,
        verifierAttempts: 1,
      });

      harness.setMode('healthy');
      harness.setClock(COOLDOWN_MS + 1);
      const recovered = await harness.pool.query('SELECT 42::int AS result');

      expect(recovered.rows).toEqual([{ result: 42 }]);
      expect(harness.counts).toEqual({
        physicalConnections: 2,
        verifierAttempts: 2,
      });
    } finally {
      await harness.pool.end();
    }
    executedTests++;
  });

  it('stops an already queued burst from opening replacement physical connections', async () => {
    attemptedTests++;
    const harness = createPoolHarness('availability-failure', {
      max: 2,
      pauseVerifier: true,
    });
    try {
      const burstSize = 20;
      const pending = Array.from({ length: burstSize }, () =>
        harness.pool.query('SELECT 1').then(
          () => ({ error: null as unknown }),
          error => ({ error }),
        ));
      const queueReady = await waitFor(
        () =>
          harness.pool.waitingCount === burstSize - 2
          && harness.counts.physicalConnections === 2
          && harness.counts.verifierAttempts === 2,
      );

      expect(queueReady).toBe(true);
      expect(harness.pool.waitingCount).toBe(burstSize - 2);
      expect(harness.counts).toEqual({
        physicalConnections: 2,
        verifierAttempts: 2,
      });

      harness.releaseVerifierGate();
      const outcomes = await Promise.all(pending);
      for (const { error } of outcomes) {
        expect(error).toBeInstanceOf(RuntimeDatabaseGuardError);
        expect(error).toMatchObject({
          name: 'RuntimeDatabaseGuardError',
          code: 'DATABASE_UNAVAILABLE',
        });
      }

      expect(outcomes).toHaveLength(burstSize);
      expect(harness.counts).toEqual({
        physicalConnections: 2,
        verifierAttempts: 2,
      });
      expect(harness.pool.waitingCount).toBe(0);
    } finally {
      harness.releaseVerifierGate();
      await harness.pool.end();
    }
    executedTests++;
  });

  it('independently attests two healthy SERIALIZABLE clients', async () => {
    attemptedTests++;
    const harness = createPoolHarness('healthy', { max: 2 });
    const clients: PoolClient[] = [];
    try {
      const acquired = await Promise.allSettled([
        harness.pool.connect(),
        harness.pool.connect(),
      ]);
      for (const result of acquired) {
        if (result.status === 'fulfilled') {
          clients.push(result.value);
        }
      }
      const acquisitionFailure = acquired.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (acquisitionFailure) {
        throw acquisitionFailure.reason;
      }

      expect(harness.counts).toEqual({
        physicalConnections: 2,
        verifierAttempts: 2,
      });

      const isolationLevels = await Promise.all(
        clients.map(async (client) => {
          await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
          const result = await client.query<{ isolation: string }>(
            'SELECT current_setting(\'transaction_isolation\') AS isolation',
          );
          await client.query('ROLLBACK');
          return result.rows[0]?.isolation;
        }),
      );

      expect(isolationLevels).toEqual(['serializable', 'serializable']);
      expect(harness.counts).toEqual({
        physicalConnections: 2,
        verifierAttempts: 2,
      });
    } finally {
      await Promise.all(
        clients.map(async (client) => {
          try {
            await client.query('ROLLBACK');
          } catch {
            // The transaction may already have rolled back after a failure.
          } finally {
            client.release();
          }
        }),
      );
      await harness.pool.end();
    }
    executedTests++;
  });

  it('keeps wrong-identity rejection typed and fail-closed during and after cooldown', async () => {
    attemptedTests++;
    const harness = createPoolHarness('identity-failure', { max: 1 });
    try {
      const firstError = await expectGuardRejection(
        harness.pool.query('SELECT 1'),
        'DATABASE_ATTESTATION_REJECTED',
      );
      const cachedError = await expectGuardRejection(
        harness.pool.query('SELECT 1'),
        'DATABASE_ATTESTATION_REJECTED',
      );

      expect(cachedError).toBe(firstError);
      expect(harness.counts).toEqual({
        physicalConnections: 1,
        verifierAttempts: 1,
      });

      harness.setClock(COOLDOWN_MS + 1);
      await expectGuardRejection(
        harness.pool.query('SELECT 1'),
        'DATABASE_ATTESTATION_REJECTED',
      );

      expect(harness.counts).toEqual({
        physicalConnections: 2,
        verifierAttempts: 2,
      });
    } finally {
      await harness.pool.end();
    }
    executedTests++;
  });

  afterAll(() => {
    const skippedTests = EXPECTED_TESTS - attemptedTests;

    expect(attemptedTests).toBe(EXPECTED_TESTS);
    expect(executedTests).toBe(EXPECTED_TESTS);
    expect(skippedTests).toBe(0);

    process.stdout.write(
      `RUNTIME_DATABASE_POOL_COOLDOWN_POSTGRES_TESTS_EXECUTED=${executedTests} RUNTIME_DATABASE_POOL_COOLDOWN_POSTGRES_TESTS_SKIPPED=${skippedTests}\n`,
    );
  });
});
