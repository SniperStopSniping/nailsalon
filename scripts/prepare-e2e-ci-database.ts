/* eslint-disable no-console -- CI preparation command; console output is its UI */
import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

import {
  attestDisposableDatabaseSession,
  DisposableDatabaseTargetError,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '../src/libs/disposableDatabaseTarget';
import { seedE2EFixtures } from './seed-e2e-fixtures';

class DisposableDatabasePreparationError extends Error {}

async function prepareDisposableE2EDatabase() {
  // Static validation and service-container inspection happen before a client is
  // constructed. The live session is then independently attested before the
  // repository migration ledger is allowed to mutate anything.
  const target = requireDisposableDatabaseTarget(process.env);
  const expectedServer = resolveDisposableDatabaseServerExpectation(target);
  const client = new Client({ connectionString: target.connectionString });
  let connected = false;

  try {
    try {
      await client.connect();
      connected = true;
    } catch {
      throw new DisposableDatabasePreparationError(
        'Could not connect to the approved disposable PostgreSQL target.',
      );
    }

    await attestDisposableDatabaseSession(client, target, expectedServer);

    try {
      await migrate(drizzle(client), {
        migrationsFolder: path.join(process.cwd(), 'migrations'),
      });
    } catch {
      throw new DisposableDatabasePreparationError(
        'Existing repository migrations failed on the attested disposable database.',
      );
    }
  } finally {
    if (connected) {
      await client.end().catch(() => {});
    }
  }

  // The seed command repeats both static and live attestation immediately before
  // fixture mutation. Its readiness check is the final preparation gate.
  await seedE2EFixtures(process.env);
  console.log('Disposable PostgreSQL migration and E2E fixture preparation completed.');
}

prepareDisposableE2EDatabase().catch((error) => {
  const message = error instanceof DisposableDatabaseTargetError
    || error instanceof DisposableDatabasePreparationError
    ? error.message
    : 'Disposable E2E database preparation failed safely.';
  console.error(message);
  process.exitCode = 1;
});
