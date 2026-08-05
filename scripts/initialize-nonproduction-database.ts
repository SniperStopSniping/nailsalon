import { Client } from 'pg';

import { resolveRuntimeEnvironment } from '../src/libs/environmentIsolation';
import {
  type DevelopmentDatabaseEnvironment,
  initializeNonProductionDatabaseMarker,
  NonProductionDatabaseGuardError,
  requireExactNonProductionDatabaseEnvironment,
  requireNonProductionDatabaseTarget,
} from '../src/libs/nonProductionDatabaseGuard';

type Action = 'initialize' | 'verify';

class NonProductionInitializationCommandError extends Error {}

function parseArguments(arguments_: readonly string[]): {
  action: Action;
  expectedEnvironment: DevelopmentDatabaseEnvironment;
} {
  const [action, expectedEnvironment] = arguments_;
  if (
    arguments_.length !== 2
    || (action !== 'initialize' && action !== 'verify')
    || (expectedEnvironment !== 'development' && expectedEnvironment !== 'preview')
  ) {
    throw new NonProductionInitializationCommandError(
      'Non-Production database command rejected: unsupported fixed action.',
    );
  }

  return { action, expectedEnvironment };
}

async function run(): Promise<void> {
  const { action, expectedEnvironment } = parseArguments(process.argv.slice(2));
  if (resolveRuntimeEnvironment(process.env) !== expectedEnvironment) {
    throw new NonProductionInitializationCommandError(
      'Non-Production database command rejected: the application environment does not match the fixed target.',
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
      throw new NonProductionInitializationCommandError(
        'Could not connect to the approved non-Production PostgreSQL target.',
      );
    }

    if (action === 'initialize') {
      await initializeNonProductionDatabaseMarker(client, expectedEnvironment);
    } else {
      await requireExactNonProductionDatabaseEnvironment(
        client,
        expectedEnvironment,
      );
    }

    process.stdout.write(
      `Non-Production database ${action} passed for ${expectedEnvironment}.\n`,
    );
  } finally {
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }
}

run().catch((error) => {
  const message = error instanceof NonProductionDatabaseGuardError
    || error instanceof NonProductionInitializationCommandError
    ? error.message
    : 'Non-Production database initialization failed safely.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
