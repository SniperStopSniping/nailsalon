import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ProductionDatabaseCommandGuardError,
  requireProductionDatabaseCommandConfirmation,
} from '../src/libs/productionDatabaseCommandGuard';

type ProductionCommand = 'migrate' | 'studio';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function fail(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function runProductionCommand(command: ProductionCommand): void {
  try {
    requireProductionDatabaseCommandConfirmation(process.env);
  } catch (error) {
    fail(error instanceof ProductionDatabaseCommandGuardError
      ? error.message
      : 'Production database command rejected safely.');
    return;
  }

  const executable = path.join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'drizzle-kit.cmd' : 'drizzle-kit',
  );
  const result = spawnSync(executable, [command], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error || result.status === null) {
    fail('Production database command could not be started safely.');
    return;
  }

  process.exitCode = result.status;
}

function main(arguments_: readonly string[]): void {
  const [mode, value] = arguments_;

  if (mode === 'tombstone' && value) {
    fail(`This command has been retired. Use "npm run ${value}" instead.`);
    return;
  }

  if (mode === 'stub' && value) {
    fail(value);
    return;
  }

  if (mode === 'production' && (value === 'migrate' || value === 'studio')) {
    runProductionCommand(value);
    return;
  }

  fail('Database command rejected: unsupported fixed action.');
}

main(process.argv.slice(2));
