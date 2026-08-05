import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import {
  type DatabaseQueryable,
  NonProductionDatabaseGuardError,
  requireDevelopmentDatabase,
  requireDevelopmentMigrationDatabase,
  requireNonProductionDatabaseTarget,
} from './nonProductionDatabaseGuard';

type GuardErrorCode = NonProductionDatabaseGuardError['code'];

async function withDatabase<T>(run: (database: PGlite) => Promise<T>): Promise<T> {
  const database = new PGlite();
  try {
    return await run(database);
  } finally {
    await database.close();
  }
}

async function expectAsyncRejection(
  operation: () => Promise<unknown>,
  code: GuardErrorCode,
): Promise<NonProductionDatabaseGuardError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(NonProductionDatabaseGuardError);
    expect(error).toMatchObject({ code });

    return error as NonProductionDatabaseGuardError;
  }
  throw new Error('Expected database guard validation to fail.');
}

function expectTargetRejection(
  environment: Record<string, string | undefined>,
  code: GuardErrorCode,
): NonProductionDatabaseGuardError {
  try {
    requireNonProductionDatabaseTarget(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(NonProductionDatabaseGuardError);
    expect(error).toMatchObject({ code });

    return error as NonProductionDatabaseGuardError;
  }
  throw new Error('Expected database target validation to fail.');
}

async function createMarker(
  database: PGlite,
  environments: string[],
): Promise<void> {
  await database.exec(`
    CREATE TABLE public.luster_environment (
      environment text NOT NULL
    )
  `);
  for (const environment of environments) {
    await database.query(
      'INSERT INTO public.luster_environment (environment) VALUES ($1)',
      [environment],
    );
  }
}

describe('non-Production database target validation', () => {
  it.each([
    ['postgres', 'LOCALHOST', 'localhost'],
    ['postgresql', '127.0.0.1', '127.0.0.1'],
  ])(
    'accepts an approved %s loopback target',
    (protocol, urlHost, expectedHost) => {
      const connectionString
        = `${protocol}://${urlHost}:5432/luster_development`;

      expect(requireNonProductionDatabaseTarget({ DATABASE_URL: connectionString }))
        .toEqual({ connectionString, host: expectedHost });
    },
  );

  it('rejects a missing database URL', () => {
    expectTargetRejection({}, 'URL_REQUIRED');
  });

  it('accepts only an exact configured remote hostname', () => {
    const connectionString
      = 'postgresql://ep-development.aws.neon.tech/luster_development?sslmode=require';

    expect(requireNonProductionDatabaseTarget({
      DATABASE_URL: connectionString,
      LUSTER_NONPROD_DB_HOSTS:
        'preview.example.test, EP-DEVELOPMENT.AWS.NEON.TECH ',
    })).toEqual({
      connectionString,
      host: 'ep-development.aws.neon.tech',
    });

    expectTargetRejection({
      DATABASE_URL:
        'postgresql://other.ep-development.aws.neon.tech/luster_development',
      LUSTER_NONPROD_DB_HOSTS: 'ep-development.aws.neon.tech',
    }, 'HOSTED_PROVIDER_NOT_ALLOWLISTED');
  });

  it('rejects unlisted hosted-provider and arbitrary remote hosts', () => {
    expectTargetRejection({
      DATABASE_URL:
        'postgresql://ep-production.aws.neon.tech/luster',
    }, 'HOSTED_PROVIDER_NOT_ALLOWLISTED');

    expectTargetRejection({
      DATABASE_URL:
        'postgresql://database.example.test/luster',
    }, 'HOST_NOT_ALLOWED');
  });

  it.each([
    'host',
    'HOSTADDR',
    'Port',
    'DATABASE',
    'DbName',
    'user',
    'PASSWORD',
  ])('rejects the case-insensitive %s routing override', (key) => {
    expectTargetRejection({
      DATABASE_URL:
        `postgresql://localhost/luster?${key}=redirected`,
    }, 'ROUTING_OVERRIDE_FORBIDDEN');
  });

  it('rejects whitespace, malformed URLs, fragments, and other protocols', () => {
    expectTargetRejection({
      DATABASE_URL:
        ' postgresql://localhost/luster',
    }, 'WHITESPACE_FORBIDDEN');
    expectTargetRejection({
      DATABASE_URL: 'postgresql://localhost/luster%ZZ',
    }, 'MALFORMED_URL');
    expectTargetRejection({
      DATABASE_URL:
        'postgresql://localhost/luster#credentials',
    }, 'FRAGMENT_FORBIDDEN');
    expectTargetRejection({
      DATABASE_URL: 'mysql://localhost/luster',
    }, 'PROTOCOL_WRONG');
  });

  it('rejects invalid allowlist entries instead of broadening the match', () => {
    expectTargetRejection({
      DATABASE_URL:
        'postgresql://preview.example.test/luster',
      LUSTER_NONPROD_DB_HOSTS: '*.example.test',
    }, 'HOST_ALLOWLIST_INVALID');
  });

  it('never leaks a connection string or credentials in errors', () => {
    const password = ['never', 'print', 'this', 'password'].join('-');
    const secretQuery = ['never', 'print', 'this', 'query'].join('-');
    const target = new URL('postgresql://ep-production.aws.neon.tech/luster');
    target.username = ['guard', 'user'].join('_');
    target.password = password;
    target.searchParams.set('token', secretQuery);
    const connectionString = target.toString();
    const error = expectTargetRejection(
      { DATABASE_URL: connectionString },
      'HOSTED_PROVIDER_NOT_ALLOWLISTED',
    );

    expect(error.message).not.toContain(connectionString);
    expect(error.message).not.toContain(password);
    expect(error.message).not.toContain(secretQuery);
    expect(error.message).not.toContain('guard_user');
  });
});

describe('development database marker attestation', () => {
  it.each(['development', 'preview'] as const)(
    'accepts exactly one %s marker row',
    async (environment) => {
      await withDatabase(async (database) => {
        await createMarker(database, [environment]);

        await expect(requireDevelopmentDatabase(database)).resolves.toBe(environment);
      });
    },
  );

  it('rejects a missing marker table', async () => {
    await withDatabase(async (database) => {
      await expectAsyncRejection(
        () => requireDevelopmentDatabase(database),
        'MARKER_TABLE_MISSING',
      );
    });
  });

  it('rejects a missing marker row', async () => {
    await withDatabase(async (database) => {
      await createMarker(database, []);
      await expectAsyncRejection(
        () => requireDevelopmentDatabase(database),
        'MARKER_ROW_MISSING',
      );
    });
  });

  it('rejects a wrong or non-exact marker', async () => {
    for (const environment of ['production', 'Development', 'development ']) {
      await withDatabase(async (database) => {
        await createMarker(database, [environment]);
        await expectAsyncRejection(
          () => requireDevelopmentDatabase(database),
          'MARKER_ENVIRONMENT_INVALID',
        );
      });
    }
  });

  it('rejects multiple marker rows', async () => {
    await withDatabase(async (database) => {
      await createMarker(database, ['development', 'preview']);
      await expectAsyncRejection(
        () => requireDevelopmentDatabase(database),
        'MARKER_ROW_MULTIPLE',
      );
    });
  });

  it('turns query failures into sanitized guard errors', async () => {
    const secret = ['database', 'failure', 'secret'].join('-');
    const failingDatabase: DatabaseQueryable = {
      async query() {
        throw new Error(secret);
      },
    };
    const error = await expectAsyncRejection(
      () => requireDevelopmentDatabase(failingDatabase),
      'MARKER_QUERY_FAILED',
    );

    expect(error.message).not.toContain(secret);
  });
});

describe('development migration bootstrap attestation', () => {
  it('allows a first migration only when the user database is truly empty', async () => {
    await withDatabase(async (database) => {
      await expect(requireDevelopmentMigrationDatabase(database)).resolves.toBeNull();
    });
  });

  it('rejects an unmarked database containing a user object', async () => {
    await withDatabase(async (database) => {
      await database.exec('CREATE TABLE public.existing_application_data (id text)');
      await expectAsyncRejection(
        () => requireDevelopmentMigrationDatabase(database),
        'DATABASE_NOT_EMPTY',
      );
    });

    await withDatabase(async (database) => {
      await database.exec(`
        CREATE TYPE public.existing_application_state
        AS ENUM ('existing')
      `);
      await expectAsyncRejection(
        () => requireDevelopmentMigrationDatabase(database),
        'DATABASE_NOT_EMPTY',
      );
    });

    await withDatabase(async (database) => {
      await database.exec('CREATE SCHEMA existing_application_schema');
      await expectAsyncRejection(
        () => requireDevelopmentMigrationDatabase(database),
        'DATABASE_NOT_EMPTY',
      );
    });
  });

  it('requires the marker when its table already exists', async () => {
    await withDatabase(async (database) => {
      await database.exec('CREATE TABLE public.existing_application_data (id text)');
      await createMarker(database, ['preview']);

      await expect(requireDevelopmentMigrationDatabase(database)).resolves.toBe('preview');
    });

    await withDatabase(async (database) => {
      await createMarker(database, ['production']);
      await expectAsyncRejection(
        () => requireDevelopmentMigrationDatabase(database),
        'MARKER_ENVIRONMENT_INVALID',
      );
    });
  });

  it('never interprets an inspection query failure as permission', async () => {
    const secret = ['catalog', 'failure', 'secret'].join('-');
    let queryCount = 0;
    const failingDatabase: DatabaseQueryable = {
      async query() {
        queryCount += 1;
        if (queryCount === 1) {
          return { rows: [{ marker_table_exists: false }] };
        }
        throw new Error(secret);
      },
    };
    const error = await expectAsyncRejection(
      () => requireDevelopmentMigrationDatabase(failingDatabase),
      'MIGRATION_INSPECTION_FAILED',
    );

    expect(queryCount).toBe(2);
    expect(error.message).not.toContain(secret);
  });
});
