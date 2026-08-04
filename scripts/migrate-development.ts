import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

import {
  NonProductionDatabaseGuardError,
  requireDevelopmentMigrationDatabase,
  requireNonProductionDatabaseTarget,
} from '../src/libs/nonProductionDatabaseGuard';

class DevelopmentMigrationCommandError extends Error {}

async function runDevelopmentMigration(): Promise<void> {
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

    await requireDevelopmentMigrationDatabase(client);

    try {
      await migrate(drizzle(client), {
        migrationsFolder: path.join(process.cwd(), 'migrations'),
      });
    } catch {
      throw new DevelopmentMigrationCommandError(
        'Repository migrations failed on the attested development database.',
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
    : 'Development database migration failed safely.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
