import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { resolveRuntimeEnvironment } from '../src/libs/environmentIsolation';
import {
  initializeNonProductionDatabaseMarker,
  NonProductionDatabaseGuardError,
  requireExactNonProductionDatabaseEnvironment,
  requireNonProductionDatabaseTarget,
} from '../src/libs/nonProductionDatabaseGuard';

const RESET_CONFIRMATION_ENV = 'LUSTER_DEVELOPMENT_RESET_CONFIRM';
const RESET_CONFIRMATION_VALUE = 'RESET_LUSTER_DEVELOPMENT_DATABASE';
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

class DevelopmentResetCommandError extends Error {}

function requireResetConfirmation(): void {
  if (process.env[RESET_CONFIRMATION_ENV] !== RESET_CONFIRMATION_VALUE) {
    throw new DevelopmentResetCommandError(
      `Development reset rejected: ${RESET_CONFIRMATION_ENV} must exactly equal ${RESET_CONFIRMATION_VALUE}.`,
    );
  }
}

function runFixedChild(script: string, arguments_: readonly string[] = []): void {
  const executable = path.join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const result = spawnSync(executable, [script, ...arguments_], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    throw new DevelopmentResetCommandError(
      'Development reset follow-up failed safely; inspect the non-Production database before retrying.',
    );
  }
}

async function resetDevelopmentDatabase(): Promise<void> {
  if (process.argv.length !== 2) {
    throw new DevelopmentResetCommandError(
      'Development reset rejected: arguments are not accepted.',
    );
  }

  requireResetConfirmation();
  if (resolveRuntimeEnvironment(process.env) !== 'development') {
    throw new DevelopmentResetCommandError(
      'Development reset rejected: the application environment is not Development.',
    );
  }
  const target = requireNonProductionDatabaseTarget(process.env);
  const client = new Client({ connectionString: target.connectionString });
  let connected = false;
  let transactionOpen = false;

  try {
    try {
      await client.connect();
      connected = true;
    } catch {
      throw new DevelopmentResetCommandError(
        'Could not connect to the approved Development PostgreSQL target.',
      );
    }

    await requireExactNonProductionDatabaseEnvironment(client, 'development');

    await client.query('BEGIN');
    transactionOpen = true;
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await initializeNonProductionDatabaseMarker(client, 'development', {
      transaction: 'existing',
    });
    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw error;
  } finally {
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }

  // Migration and seed are fixed children. Each independently re-attests the
  // exact Development marker before making any further change.
  runFixedChild('scripts/migrate-development.ts', ['development']);
  runFixedChild('scripts/seed.ts');
  process.stdout.write('Development database reset, migrated, and seeded.\n');
}

resetDevelopmentDatabase().catch((error) => {
  const message = error instanceof NonProductionDatabaseGuardError
    || error instanceof DevelopmentResetCommandError
    ? error.message
    : 'Development database reset failed safely.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
