import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';

import {
  type DatabaseQueryable,
  initializeNonProductionDatabaseMarker,
} from './nonProductionDatabaseGuard';
import {
  createRuntimeDatabasePoolVerifier,
  requireMatchingCachedDatabaseTarget,
  requireRuntimeDatabaseTarget,
  RuntimeDatabaseGuardError,
  type RuntimePostgresTarget,
  verifyRuntimeDatabaseConnection,
} from './runtimeDatabaseGuard';

vi.mock('server-only', () => ({}));

type GuardErrorCode = RuntimeDatabaseGuardError['code'];

const protocol = ['postgre', 'sql'].join('');

function loopbackUrl(database = 'luster_development'): string {
  return `${protocol}://127.0.0.1:5432/${database}`;
}

function expectRejection(
  operation: () => unknown,
  code: GuardErrorCode,
): RuntimeDatabaseGuardError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeDatabaseGuardError);
    expect(error).toMatchObject({ code });

    return error as RuntimeDatabaseGuardError;
  }
  throw new Error('Expected runtime database guard validation to fail.');
}

async function withDatabase<T>(run: (database: PGlite) => Promise<T>): Promise<T> {
  const database = new PGlite();
  try {
    return await run(database);
  } finally {
    await database.close();
  }
}

describe('runtime database static policy', () => {
  it('allows PGlite only in explicit local, test, and CI environments', () => {
    expect(requireRuntimeDatabaseTarget({ NODE_ENV: 'development' })).toBeNull();
    expect(requireRuntimeDatabaseTarget({ NODE_ENV: 'test' })).toBeNull();
    expect(requireRuntimeDatabaseTarget({ CI: 'true' })).toBeNull();
  });

  it.each(['preview', 'production'] as const)(
    'requires PostgreSQL in hosted %s',
    (environment) => {
      expectRejection(
        () => requireRuntimeDatabaseTarget({
          APP_ENV: environment,
          VERCEL: '1',
          VERCEL_ENV: environment,
        }),
        'HOSTED_DATABASE_REQUIRED',
      );
    },
  );

  it('rejects an ambiguous production-like runtime', () => {
    expectRejection(
      () => requireRuntimeDatabaseTarget({ NODE_ENV: 'production' }),
      'RUNTIME_ENVIRONMENT_AMBIGUOUS',
    );
    expectRejection(
      () => requireRuntimeDatabaseTarget({
        APP_ENV: 'production',
        DATABASE_URL: `${protocol}://database.example.test/luster`,
        NODE_ENV: 'development',
      }),
      'RUNTIME_ENVIRONMENT_AMBIGUOUS',
    );
  });

  it('uses the PR-1 allowlist for Development and Preview', () => {
    const development = requireRuntimeDatabaseTarget({
      APP_ENV: 'development',
      DATABASE_URL: loopbackUrl(),
    });

    expect(development).toMatchObject({
      environment: 'development',
      host: '127.0.0.1',
    });

    const previewHost = 'ep-isolated-preview.aws.neon.tech';
    const preview = requireRuntimeDatabaseTarget({
      APP_ENV: 'preview',
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      DATABASE_URL: `${protocol}://${previewHost}/luster_preview?sslmode=require`,
      LUSTER_NONPROD_DB_HOSTS: previewHost,
    });

    expect(preview).toMatchObject({
      environment: 'preview',
      host: previewHost,
    });

    expectRejection(
      () => requireRuntimeDatabaseTarget({
        APP_ENV: 'preview',
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        DATABASE_URL: `${protocol}://${previewHost}/luster_preview`,
      }),
      'DATABASE_URL_REJECTED',
    );
  });

  it('permits only loopback PostgreSQL in CI and test', () => {
    expect(requireRuntimeDatabaseTarget({
      CI: 'true',
      DATABASE_URL: loopbackUrl('luster_ci'),
    })).toMatchObject({ environment: 'ci', host: '127.0.0.1' });

    expectRejection(
      () => requireRuntimeDatabaseTarget({
        APP_ENV: 'production',
        GITHUB_ACTIONS: 'true',
        DATABASE_URL: `${protocol}://database.example.test/luster_ci`,
        VERCEL_ENV: 'production',
      }),
      'CI_REMOTE_DATABASE_FORBIDDEN',
    );
  });

  it('accepts a valid PostgreSQL URL for explicit Production', () => {
    const target = requireRuntimeDatabaseTarget({
      APP_ENV: 'production',
      VERCEL: '1',
      VERCEL_ENV: 'production',
      DATABASE_URL: `${protocol}://database.example.test/luster`,
    });

    expect(target).toMatchObject({
      environment: 'production',
      host: 'database.example.test',
    });
    expect(target?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('never includes target details or credentials in errors', () => {
    const password = ['runtime', 'database', 'password'].join('-');
    const host = ['private', 'production', 'example', 'test'].join('.');
    const connectionString
      = `${protocol}://runtime-user:${password}@${host}/luster`;
    const error = expectRejection(
      () => requireRuntimeDatabaseTarget({
        APP_ENV: 'development',
        DATABASE_URL: connectionString,
      }),
      'DATABASE_URL_REJECTED',
    );

    expect(error.message).not.toContain(connectionString);
    expect(error.message).not.toContain(password);
    expect(error.message).not.toContain(host);
    expect(JSON.stringify(error)).not.toContain(password);
  });
});

describe('runtime database live attestation', () => {
  it.each(['development', 'preview'] as const)(
    'requires the exact %s marker',
    async (environment) => {
      await withDatabase(async (database) => {
        await initializeNonProductionDatabaseMarker(database, environment);
        const target = requireRuntimeDatabaseTarget({
          APP_ENV: environment,
          DATABASE_URL: loopbackUrl(`luster_${environment}`),
        });

        expect(target).not.toBeNull();
        await expect(
          verifyRuntimeDatabaseConnection(database, target!),
        ).resolves.toBeUndefined();

        const wrongTarget = {
          ...target!,
          environment: environment === 'development'
            ? 'preview' as const
            : 'development' as const,
        };

        await expect(
          verifyRuntimeDatabaseConnection(database, wrongTarget),
        ).rejects.toMatchObject({
          code: 'DATABASE_ATTESTATION_REJECTED',
        });
      });
    },
  );

  it('does not require a Production marker but rejects a non-Production one', async () => {
    const target = requireRuntimeDatabaseTarget({
      APP_ENV: 'production',
      VERCEL: '1',
      VERCEL_ENV: 'production',
      DATABASE_URL: loopbackUrl('luster_production'),
    });

    expect(target).not.toBeNull();

    await withDatabase(async (database) => {
      await expect(
        verifyRuntimeDatabaseConnection(database, target!),
      ).resolves.toBeUndefined();
    });

    await withDatabase(async (database) => {
      await initializeNonProductionDatabaseMarker(database, 'preview');

      await expect(
        verifyRuntimeDatabaseConnection(database, target!),
      ).rejects.toMatchObject({
        code: 'DATABASE_ATTESTATION_REJECTED',
      });
    });
  });

  it('sanitizes unexpected connection and query failures as availability, not attestation', async () => {
    // CI/test targets carry no marker/identity claim (static loopback policy
    // already establishes identity) — a query failure here is always a
    // connectivity problem, never a wrong-database finding, so it must
    // classify as DATABASE_UNAVAILABLE rather than DATABASE_ATTESTATION_REJECTED.
    // See the classification describe block below for the full H1 matrix
    // (production/dev/preview marker-path classification).
    const secret = ['runtime', 'query', 'secret'].join('-');
    const target = requireRuntimeDatabaseTarget({
      CI: 'true',
      DATABASE_URL: loopbackUrl('luster_ci'),
    });
    const failingDatabase = {
      async query() {
        throw new Error(secret);
      },
    };

    let rejection: RuntimeDatabaseGuardError | undefined;
    try {
      await verifyRuntimeDatabaseConnection(failingDatabase, target!);
    } catch (error) {
      rejection = error as RuntimeDatabaseGuardError;
    }

    expect(rejection).toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(rejection?.message).not.toContain(secret);
  });

  it('adapts live attestation to the pg-pool verifier callback', async () => {
    const target = requireRuntimeDatabaseTarget({
      CI: 'true',
      DATABASE_URL: loopbackUrl('luster_ci'),
    });
    const query = vi.fn(async () => ({ rows: [{ '?column?': 1 }] }));
    const verifier = createRuntimeDatabasePoolVerifier(target!);

    await new Promise<void>((resolve, reject) => {
      verifier({ query }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    expect(query).toHaveBeenCalledWith('SELECT 1');

    const failure = await new Promise<Error | undefined>((resolve) => {
      verifier({
        async query() {
          throw new Error('private connection detail');
        },
      }, resolve);
    });

    // A CI/test target has no identity claim to fail — a broken connection
    // here is availability, not a security/attestation mismatch.
    expect(failure).toMatchObject({
      name: 'RuntimeDatabaseGuardError',
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(failure?.message).not.toContain('private connection detail');
  });
});

// =============================================================================
// H1 — incident hotfix: availability vs. attestation classification.
//
// Reproduces the exact failure this fixes: a Neon `53000` quota error made
// `rejectNonProductionMarkerForProduction`'s marker query fail to execute,
// which the OLD bare catch in `verifyRuntimeDatabaseConnection` collapsed
// into `DATABASE_ATTESTATION_REJECTED` — reporting a provider outage as a
// wrong-database/security failure. These tests pin that a query that never
// executed (quota, connection refused, any other provider/network failure)
// is always `DATABASE_UNAVAILABLE`, while a query that DID execute and
// proved the wrong identity (or an identity that can never be established)
// always stays `DATABASE_ATTESTATION_REJECTED` and fails closed.
// =============================================================================

describe('H1 classification — availability vs. attestation', () => {
  function pgErrorLike(message: string, code?: string): Error {
    const error = new Error(message);
    if (code !== undefined) {
      (error as Error & { code?: string }).code = code;
    }
    return error;
  }

  function queryThrows(error: Error): DatabaseQueryable {
    return {
      async query() {
        throw error;
      },
    };
  }

  const productionTarget = requireRuntimeDatabaseTarget({
    APP_ENV: 'production',
    VERCEL: '1',
    VERCEL_ENV: 'production',
    DATABASE_URL: loopbackUrl('luster_production'),
  })!;

  const developmentTarget = requireRuntimeDatabaseTarget({
    APP_ENV: 'development',
    DATABASE_URL: loopbackUrl('luster_development'),
  })!;

  it.each([
    ['production', () => productionTarget],
    ['development', () => developmentTarget],
  ] as const)(
    'classifies a Postgres 53000 (quota exhausted) marker query failure as availability in %s',
    async (_label, getTarget) => {
      const secret = ['neon', 'quota', 'connection', 'string'].join('-');
      const error = pgErrorLike(`exceeded the compute time quota: ${secret}`, '53000');

      await expect(
        verifyRuntimeDatabaseConnection(queryThrows(error), getTarget()),
      ).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    },
  );

  it.each([
    ['production', () => productionTarget],
    ['development', () => developmentTarget],
  ] as const)(
    'classifies a connection-refused marker query failure as availability in %s',
    async (_label, getTarget) => {
      const error = pgErrorLike('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED');

      await expect(
        verifyRuntimeDatabaseConnection(queryThrows(error), getTarget()),
      ).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    },
  );

  it.each([
    ['production', () => productionTarget],
    ['development', () => developmentTarget],
  ] as const)(
    'classifies an unlabeled/transient provider query failure as availability in %s',
    async (_label, getTarget) => {
      const error = pgErrorLike('the server unexpectedly closed the connection');

      await expect(
        verifyRuntimeDatabaseConnection(queryThrows(error), getTarget()),
      ).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    },
  );

  it.each([
    ['production', () => productionTarget],
    ['development', () => developmentTarget],
  ] as const)(
    'fails closed as attestation — never availability — on a permission error (42501) in %s',
    async (_label, getTarget) => {
      // The query REACHED a real server and got a real Postgres answer back
      // — insufficient_privilege — which is evidence the database is
      // reachable, just wrong or misconfigured (e.g. a stale/incorrect
      // DATABASE_URL role). Reporting this as "temporarily unavailable"
      // would tell an operator to wait for a recovery that will never come.
      const error = pgErrorLike('permission denied for table luster_environment', '42501');

      await expect(
        verifyRuntimeDatabaseConnection(queryThrows(error), getTarget()),
      ).rejects.toMatchObject({ code: 'DATABASE_ATTESTATION_REJECTED' });
    },
  );

  it.each([
    ['production', () => productionTarget],
    ['development', () => developmentTarget],
  ] as const)(
    'fails closed as attestation — never availability — on an undefined-column error (42703) in %s',
    async (_label, getTarget) => {
      // A reachable database whose schema does not match — e.g. the
      // connection landed on the wrong logical database — must never be
      // reported as merely unavailable.
      const error = pgErrorLike('column "environment" does not exist', '42703');

      await expect(
        verifyRuntimeDatabaseConnection(queryThrows(error), getTarget()),
      ).rejects.toMatchObject({ code: 'DATABASE_ATTESTATION_REJECTED' });
    },
  );

  it('fails closed as attestation (never availability) when the Production marker row is malformed', async () => {
    // The query EXECUTES and returns an answer — two rows instead of exactly
    // one — so identity can never be established from it. This is the
    // "malformed state" case, and it must never be relaxed by a retry.
    const malformedDatabase: DatabaseQueryable = {
      async query() {
        return {
          rows: [
            { environment: 'production' },
            { environment: 'production' },
          ],
        };
      },
    };

    await expect(
      verifyRuntimeDatabaseConnection(malformedDatabase, productionTarget),
    ).rejects.toMatchObject({ code: 'DATABASE_ATTESTATION_REJECTED' });
  });

  it('fails closed as attestation (never availability) when the Development marker table is missing', async () => {
    // 42P01 (undefined_table) means the query executed fine — the connection
    // is live — but this database was never marked, which is exactly the
    // "wrong/unverified database" case Development and Preview must reject.
    const missingMarkerTable: DatabaseQueryable = {
      async query() {
        throw pgErrorLike('relation "public.luster_environment" does not exist', '42P01');
      },
    };

    await expect(
      verifyRuntimeDatabaseConnection(missingMarkerTable, developmentTarget),
    ).rejects.toMatchObject({ code: 'DATABASE_ATTESTATION_REJECTED' });
  });

  it('never leaks connection details through either classification', async () => {
    const secret = ['runtime', 'availability', 'secret'].join('-');
    const availabilityError = pgErrorLike(`connection failed: ${secret}`, '53000');

    let rejection: RuntimeDatabaseGuardError | undefined;
    try {
      await verifyRuntimeDatabaseConnection(
        queryThrows(availabilityError),
        productionTarget,
      );
    } catch (error) {
      rejection = error as RuntimeDatabaseGuardError;
    }

    expect(rejection).toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect(rejection?.message).not.toContain(secret);
    expect(JSON.stringify(rejection)).not.toContain(secret);
  });
});

describe('runtime database pool cache identity', () => {
  it('accepts only the exact cached target fingerprint', () => {
    const target = requireRuntimeDatabaseTarget({
      APP_ENV: 'development',
      DATABASE_URL: loopbackUrl(),
    }) as RuntimePostgresTarget;

    expect(() => requireMatchingCachedDatabaseTarget(
      target.fingerprint,
      target,
    )).not.toThrow();

    expectRejection(
      () => requireMatchingCachedDatabaseTarget(undefined, target),
      'CACHED_DATABASE_TARGET_MISMATCH',
    );
    expectRejection(
      () => requireMatchingCachedDatabaseTarget('different-target', target),
      'CACHED_DATABASE_TARGET_MISMATCH',
    );
  });
});
