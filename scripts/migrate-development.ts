import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

import { resolveRuntimeEnvironment } from '../src/libs/environmentIsolation';
import {
  type DevelopmentDatabaseEnvironment,
  NonProductionDatabaseGuardError,
  requireExactNonProductionDatabaseEnvironment,
  requireNonProductionDatabaseTarget,
} from '../src/libs/nonProductionDatabaseGuard';

class DevelopmentMigrationCommandError extends Error {}

function parseExpectedEnvironment(
  arguments_: readonly string[],
): DevelopmentDatabaseEnvironment {
  const [expectedEnvironment] = arguments_;
  if (
    arguments_.length !== 1
    || (expectedEnvironment !== 'development' && expectedEnvironment !== 'preview')
  ) {
    throw new DevelopmentMigrationCommandError(
      'Non-Production migration rejected: unsupported fixed environment.',
    );
  }
  return expectedEnvironment;
}

async function runDevelopmentMigration(): Promise<void> {
  const expectedEnvironment = parseExpectedEnvironment(process.argv.slice(2));
  if (resolveRuntimeEnvironment(process.env) !== expectedEnvironment) {
    throw new DevelopmentMigrationCommandError(
      'Non-Production migration rejected: the application environment does not match the fixed target.',
    );
  }
  const target = requireNonProductionDatabaseTarget(process.env);
  const client = new Client({ connectionString: target.connectionString });
  let connected = false;

  try {
    try {
      await client.connect();
      connected = true;
    } catch {
      throw new DevelopmentMigrationCommandError(
        'Could not connect to the approved non-Production PostgreSQL target.',
      );
    }

    await requireExactNonProductionDatabaseEnvironment(
      client,
      expectedEnvironment,
    );

    try {
      await migrate(drizzle(client), {
        migrationsFolder: path.join(process.cwd(), 'migrations'),
      });
    } catch {
      throw new DevelopmentMigrationCommandError(
        'Repository migrations failed on the attested non-Production database.',
      );
    }
  } finally {
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }
}

runDevelopmentMigration().catch((error) => {
  const message = error instanceof NonProductionDatabaseGuardError
    || error instanceof DevelopmentMigrationCommandError
    ? error.message
    : 'Non-Production database migration failed safely.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
