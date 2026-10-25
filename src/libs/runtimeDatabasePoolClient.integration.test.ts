/**
 * Native PostgreSQL regressions for the physical Client pre-connect cooldown.
 * This suite uses the same strictly attested disposable target as D5 and
 * performs only read-only session checks, SELECTs, and SERIALIZABLE read-only
 * transactions. New deadline controls redirect only the test client's marker
 * read to a sleeping SELECT, an explicit marker value, or a server-side DO
 * block raising SQLSTATE 42501 (no grants or schema mutations). The permission
 * control proves classification of a real server rejection, not privilege
 * enforcement. A socket control destroys only that fixture client's stream.
 * Synthetic typed verifier failures exercise recovery behavior;
 * they do not represent a real provider outage or a wrong live database.
 */
import type { PoolClient, PoolConfig, QueryConfig } from 'pg';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  attestDisposableDatabaseSession,
  DISPOSABLE_DATABASE_NAME,
  DISPOSABLE_DATABASE_PORT,
  DISPOSABLE_DATABASE_USER,
  type DisposableDatabaseServerExpectation,
  type DisposableDatabaseTarget,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from './disposableDatabaseTarget';
import { readRuntimeDatabaseBindingStatus } from './runtimeDatabaseBinding.server';
import { RuntimeDatabaseGuardError } from './runtimeDatabaseGuard';
import { createRuntimeDatabaseCooldownClient } from './runtimeDatabasePoolClient';
import { createRuntimeDatabaseVerificationCooldown } from './runtimeDatabasePoolRecovery';
import { createGuardedRuntimeDatabasePoolVerifier, pingRuntimePostgres, RUNTIME_DATABASE_READ_TIMEOUT_MS } from './runtimeDatabasePoolVerifier.server';

vi.mock('server-only', () => ({}));

const EXPECTED_TESTS = 12;
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

type DeadlineMode = 'healthy' | 'stalled-marker' | 'socket-error' | 'wrong-marker' | 'permission-rejection' | 'stalled-ping';

/** Real pg-pool, real runtime verifier, and native pg query_timeout behavior. */
function createDeadlineHarness(initialMode: DeadlineMode) {
  if (!target || !expectedServer) {
    throw new Error('The strictly attested disposable PostgreSQL target is unavailable.');
  }
  let mode = initialMode;
  let clock = 0;
  const counts = { connections: 0, markers: 0, applicationQueries: 0, removed: 0 };
  const driverErrors: unknown[] = [];
  const cooldown = createRuntimeDatabaseVerificationCooldown({
    classify: error => error instanceof RuntimeDatabaseGuardError
      ? error
      : typedFailure('DATABASE_UNAVAILABLE'),
    cooldownMs: COOLDOWN_MS,
    now: () => clock,
  });
  const config = {
    connectionString: target.connectionString,
    max: 1,
    // Match the runtime physical/acquisition window; queued requests must not
    // expire before the separate 5s marker read can release its failed lease.
    connectionTimeoutMillis: 15000,
    Client: createRuntimeDatabaseCooldownClient(cooldown),
    verify: createGuardedRuntimeDatabasePoolVerifier({
      connectionString: target.connectionString,
      environment: 'production',
      fingerprint: 'strict-disposable-fixture',
      host: target.host,
    }, cooldown),
  } as PoolConfig & { verify: (client: PoolClient, callback: (error?: Error) => void) => void };
  const pool = new pg.Pool(config);
  pool.on('remove', () => {
    counts.removed++;
  });
  pool.on('connect', (client) => {
    counts.connections++;
    const nativeQuery = client.query.bind(client);
    // This adapter exists only inside the test harness. It leaves the real
    // driver's timeout/error/release machinery and the actual runtime guard
    // intact, while making a marker SELECT deliberately stall or reject.
    client.query = ((query: string | { text: string; query_timeout?: number }, ...args: unknown[]) => {
      const text = typeof query === 'string' ? query : query.text;
      if (text === 'SELECT environment FROM public.luster_environment LIMIT 2') {
        counts.markers++;
        const markerConfig = typeof query === 'string' ? { text: query } : query;
        return attestDisposableDatabaseSession({
          query: ((sessionQuery: string) => {
            const boundedQuery: QueryConfig & { query_timeout: number } = {
              text: sessionQuery,
              query_timeout: RUNTIME_DATABASE_READ_TIMEOUT_MS,
            };
            return nativeQuery(boundedQuery);
          }) as typeof client.query,
        }, target!, expectedServer!).then(async () => {
          let markerSql = 'SELECT \'production\' AS environment';
          if (mode === 'stalled-marker' || mode === 'socket-error') {
            markerSql = 'SELECT \'production\' AS environment FROM pg_sleep(30)';
          } else if (mode === 'wrong-marker') {
            markerSql = 'SELECT \'development\' AS environment';
          } else if (mode === 'permission-rejection') {
            markerSql = 'DO $$ BEGIN RAISE EXCEPTION USING ERRCODE = \'42501\', MESSAGE = \'fixture permission rejection\'; END $$';
          }
          const pending = nativeQuery({ ...markerConfig, text: markerSql });
          if (mode === 'socket-error') {
            // Exercise pg's actual socket error path, with the verifier's
            // temporary listener as the sole listener during this query.
            expect(client.listenerCount('error')).toBe(1);

            const socket = (client as unknown as { connection: { stream: { destroy: (error: Error) => void } } }).connection.stream;
            setImmediate(() => socket.destroy(new Error('private fixture socket detail')));
          }
          return pending;
        }).catch((error: unknown) => {
          driverErrors.push(error);
          throw error;
        });
      }
      counts.applicationQueries++;
      if (mode === 'stalled-ping' && text === 'SELECT 1') {
        return nativeQuery({ ...(typeof query === 'string' ? {} : query), text: 'SELECT 1 FROM pg_sleep(30)' }, ...args as []);
      }
      return nativeQuery(query, ...args as []);
    }) as typeof client.query;
  });
  return {
    pool,
    counts,
    driverErrors,
    setMode: (next: DeadlineMode) => {
      mode = next;
    },
    expireCooldown: () => {
      clock += COOLDOWN_MS + 1;
    },
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

  // Independent fixture metadata, not parsed from the pool URL or discovered
  // from the session under test. The D5 service is deliberately loopback-only.
  const expectedBinding = {
    host: '127.0.0.1',
    port: DISPOSABLE_DATABASE_PORT,
    database: DISPOSABLE_DATABASE_NAME,
    sessionUser: DISPOSABLE_DATABASE_USER,
    currentUser: DISPOSABLE_DATABASE_USER,
  };
  const bindingDescriptor = JSON.stringify(expectedBinding);

  it('compares the real guarded lease to independent fixture metadata and returns every lease', async () => {
    attemptedTests++;
    const harness = createPoolHarness('healthy', { max: 1 });
    try {
      expect(await readRuntimeDatabaseBindingStatus(bindingDescriptor, harness.pool)).toBe('matched');
      expect(harness.pool.idleCount).toBe(1);

      for (const field of ['host', 'port', 'database', 'sessionUser', 'currentUser'] as const) {
        const mismatched = JSON.stringify({ ...expectedBinding, [field]: field === 'port' ? 5433 : 'other' });

        expect(await readRuntimeDatabaseBindingStatus(mismatched, harness.pool)).toBe('mismatched');
        expect(harness.pool.idleCount).toBe(1);
      }

      expect(harness.counts).toEqual({ physicalConnections: 1, verifierAttempts: 1 });
      expect((await harness.pool.query('SELECT 42::int AS result')).rows).toEqual([{ result: 42 }]);
    } finally {
      await harness.pool.end();
    }
    executedTests++;
  });

  it('does not open a real PostgreSQL connection for absent or malformed binding metadata', async () => {
    attemptedTests++;
    const harness = createPoolHarness('healthy');
    try {
      for (const descriptor of [undefined, '', '{', JSON.stringify({ ...expectedBinding, password: 'fixture' })]) {
        expect(await readRuntimeDatabaseBindingStatus(descriptor, harness.pool)).toBe('unavailable');
      }

      expect(harness.counts).toEqual({ physicalConnections: 0, verifierAttempts: 0 });
      expect(harness.pool.totalCount).toBe(0);
    } finally {
      await harness.pool.end();
    }
    executedTests++;
  });

  it('reports unavailable when the actual guarded pool rejects identity and recovers only after verification', async () => {
    attemptedTests++;
    const harness = createPoolHarness('identity-failure', { max: 1 });
    try {
      expect(await readRuntimeDatabaseBindingStatus(bindingDescriptor, harness.pool)).toBe('unavailable');
      expect(await readRuntimeDatabaseBindingStatus(bindingDescriptor, harness.pool)).toBe('unavailable');
      expect(harness.counts).toEqual({ physicalConnections: 1, verifierAttempts: 1 });

      harness.setMode('healthy');
      harness.setClock(COOLDOWN_MS + 1);

      expect(await readRuntimeDatabaseBindingStatus(bindingDescriptor, harness.pool)).toBe('matched');
      expect(harness.counts).toEqual({ physicalConnections: 2, verifierAttempts: 2 });
      expect(harness.pool.idleCount).toBe(1);
    } finally {
      await harness.pool.end();
    }
    executedTests++;
  });

  // These two tests deliberately wait for the production 5s query deadline.
  // Their per-case 15s budget includes connection/setup/cleanup; the measured
  // rejection bound below remains asserted, without changing suite defaults.
  it('expires a real stalled marker read, removes its client, blocks a queued burst, and recovers on the same pool', async () => {
    attemptedTests++;
    const harness = createDeadlineHarness('stalled-marker');
    try {
      const started = Date.now();
      const attempts = Array.from({ length: 8 }, () => expectGuardRejection(
        harness.pool.query('SELECT 42::int AS result'),
        'DATABASE_UNAVAILABLE',
      ));
      const errors = await Promise.all(attempts);

      expect(Date.now() - started).toBeGreaterThanOrEqual(RUNTIME_DATABASE_READ_TIMEOUT_MS - 100);
      expect(Date.now() - started).toBeLessThan(10000);
      expect(errors.every(error => error === errors[0])).toBe(true);
      expect(harness.driverErrors).toHaveLength(1);
      expect(harness.driverErrors[0]).toMatchObject({ message: 'Query read timeout' });
      expect(harness.counts).toEqual({ connections: 1, markers: 1, applicationQueries: 0, removed: 1 });
      expect(harness.pool.totalCount).toBe(0);
      expect(harness.pool.waitingCount).toBe(0);

      harness.setMode('healthy');
      harness.expireCooldown();

      expect((await harness.pool.query('SELECT 42::int AS result')).rows).toEqual([{ result: 42 }]);
      expect(harness.counts).toEqual({ connections: 2, markers: 2, applicationQueries: 1, removed: 1 });
    } finally {
      await harness.pool.end();
    }
    executedTests++;
  }, 15000);

  it('bounds the native startup/readiness ping and discards its timed-out client', async () => {
    attemptedTests++;
    const harness = createDeadlineHarness('stalled-ping');
    try {
      const started = Date.now();

      await expect(pingRuntimePostgres(harness.pool)).rejects.toMatchObject({ message: 'Query read timeout' });
      expect(Date.now() - started).toBeGreaterThanOrEqual(RUNTIME_DATABASE_READ_TIMEOUT_MS - 100);
      expect(Date.now() - started).toBeLessThan(10000);
      expect(harness.pool.totalCount).toBe(0);
      expect(harness.counts.removed).toBe(1);

      harness.setMode('healthy');
      await pingRuntimePostgres(harness.pool);

      expect(harness.counts).toEqual({ connections: 2, markers: 2, applicationQueries: 2, removed: 1 });
      expect(harness.pool.idleCount).toBe(1);
    } finally {
      await harness.pool.end();
    }
    executedTests++;
  }, 15000);

  it('handles an actual socket error while verifying, destroys the client, and recovers after cooldown', async () => {
    attemptedTests++;
    const harness = createDeadlineHarness('socket-error');
    try {
      const error = await expectGuardRejection(harness.pool.query('SELECT 1'), 'DATABASE_UNAVAILABLE');

      expect(error.message).not.toContain('private fixture socket detail');
      expect(harness.pool.totalCount).toBe(0);
      expect(harness.counts).toEqual({ connections: 1, markers: 1, applicationQueries: 0, removed: 1 });
      expect(harness.driverErrors).toHaveLength(1);

      await expectGuardRejection(harness.pool.query('SELECT 1'), 'DATABASE_UNAVAILABLE');

      expect(harness.counts.connections).toBe(1);

      harness.setMode('healthy');
      harness.expireCooldown();
      await pingRuntimePostgres(harness.pool);

      expect(harness.counts).toEqual({ connections: 2, markers: 2, applicationQueries: 1, removed: 1 });
    } finally {
      await harness.pool.end();
    }
    executedTests++;
  });

  it.each(['wrong-marker', 'permission-rejection'] as const)('keeps the real runtime verifier fail-closed for %s before and after cooldown', async (mode) => {
    attemptedTests++;
    const harness = createDeadlineHarness(mode);
    try {
      await expectGuardRejection(harness.pool.query('SELECT 1'), 'DATABASE_ATTESTATION_REJECTED');
      await expectGuardRejection(harness.pool.query('SELECT 1'), 'DATABASE_ATTESTATION_REJECTED');

      expect(harness.counts).toEqual({ connections: 1, markers: 1, applicationQueries: 0, removed: 1 });

      harness.expireCooldown();
      await expectGuardRejection(harness.pool.query('SELECT 1'), 'DATABASE_ATTESTATION_REJECTED');

      expect(harness.counts).toEqual({ connections: 2, markers: 2, applicationQueries: 0, removed: 2 });
      expect(harness.pool.totalCount).toBe(0);

      if (mode === 'permission-rejection') {
        expect(harness.driverErrors).toHaveLength(2);
        expect(harness.driverErrors[0]).toMatchObject({ code: '42501' });
      }
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
