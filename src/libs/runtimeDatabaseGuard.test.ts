import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';

import { initializeNonProductionDatabaseMarker } from './nonProductionDatabaseGuard';
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

  it('sanitizes unexpected connection and query failures', async () => {
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
      code: 'DATABASE_ATTESTATION_REJECTED',
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

    expect(failure).toMatchObject({
      name: 'RuntimeDatabaseGuardError',
      code: 'DATABASE_ATTESTATION_REJECTED',
    });
    expect(failure?.message).not.toContain('private connection detail');
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
