import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { resolveRuntimeEnvironment } from '../src/libs/environmentIsolation';
import {
  NonProductionDatabaseGuardError,
  rejectNonProductionMarkerForProduction,
  requireExactNonProductionDatabaseEnvironment,
  requireNonProductionDatabaseTarget,
  requirePostgresDatabaseTarget,
} from '../src/libs/nonProductionDatabaseGuard';
import {
  ProductionDatabaseCommandGuardError,
  requireProductionDatabaseCommandConfirmation,
} from '../src/libs/productionDatabaseCommandGuard';

type ProductionCommand = 'migrate' | 'studio';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function fail(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function runDrizzleCommand(
  command: ProductionCommand,
  connectionString: string,
): void {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    LUSTER_GUARDED_DATABASE_URL: connectionString,
  };
  delete childEnvironment.DATABASE_URL;

  const executable = path.join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'drizzle-kit.cmd' : 'drizzle-kit',
  );
  const result = spawnSync(executable, [command], {
    cwd: repositoryRoot,
    env: childEnvironment,
    stdio: 'inherit',
  });

  if (result.error || result.status === null) {
    fail('Database command could not be started safely.');
    return;
  }

  process.exitCode = result.status;
}

function isCiEnvironment(): boolean {
  return process.env.CI === 'true'
    || process.env.CI === '1'
    || process.env.GITHUB_ACTIONS === 'true'
    || process.env.GITHUB_ACTIONS === '1';
}

async function attestProductionTarget(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  let connected = false;
  try {
    try {
      await client.connect();
      connected = true;
    } catch {
      throw new Error('Production database command could not attest its target.');
    }
    await rejectNonProductionMarkerForProduction(client);
  } finally {
    if (connected) {
      await client.end().catch(() => undefined);
    }
  }
}

async function runProductionCommand(command: ProductionCommand): Promise<void> {
  if (
    isCiEnvironment()
  ) {
    fail('Production database commands are forbidden in CI.');
    return;
  }

  try {
    requireProductionDatabaseCommandConfirmation(process.env);
  } catch (error) {
    fail(error instanceof ProductionDatabaseCommandGuardError
      ? error.message
      : 'Production database command rejected safely.');
    return;
  }

  try {
    const target = requirePostgresDatabaseTarget(process.env);
    await attestProductionTarget(target.connectionString);
    runDrizzleCommand(command, target.connectionString);
  } catch (error) {
    fail(error instanceof NonProductionDatabaseGuardError
      ? error.message
      : 'Production database command rejected safely.');
  }
}

function runFixedTypeScript(script: string): void {
  const executable = path.join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const childEnvironment = { ...process.env };
  delete childEnvironment.LUSTER_GUARDED_DATABASE_URL;
  const result = spawnSync(executable, [script], {
    cwd: repositoryRoot,
    env: childEnvironment,
    stdio: 'inherit',
  });
  if (result.error || result.status === null) {
    fail('Database command could not be started safely.');
    return;
  }
  process.exitCode = result.status;
}

async function runClientLifecycleMigration(): Promise<void> {
  let target: ReturnType<typeof requirePostgresDatabaseTarget>;
  try {
    target = requirePostgresDatabaseTarget(process.env);
  } catch (error) {
    fail(error instanceof NonProductionDatabaseGuardError
      ? error.message
      : 'Client lifecycle migration rejected safely.');
    return;
  }

  if (isCiEnvironment()) {
    if (!LOOPBACK_HOSTS.has(target.host)) {
      fail('Client lifecycle migration rejected: CI may use only loopback PostgreSQL.');
      return;
    }
    runFixedTypeScript('scripts/migrate-client-lifecycle.ts');
    return;
  }

  try {
    requireProductionDatabaseCommandConfirmation(process.env);
    await attestProductionTarget(target.connectionString);
    runFixedTypeScript('scripts/migrate-client-lifecycle.ts');
  } catch (error) {
    fail(error instanceof ProductionDatabaseCommandGuardError
      || error instanceof NonProductionDatabaseGuardError
      ? error.message
      : 'Client lifecycle migration rejected safely.');
  }
}

async function runDevelopmentStudio(): Promise<void> {
  let client: Client | undefined;
  try {
    if (resolveRuntimeEnvironment(process.env) !== 'development') {
      fail('Development Studio rejected: the application environment is not Development.');
      return;
    }
    const target = requireNonProductionDatabaseTarget(process.env);
    client = new Client({ connectionString: target.connectionString });
    await client.connect();
    await requireExactNonProductionDatabaseEnvironment(client, 'development');
    await client.end();
    client = undefined;

    runDrizzleCommand('studio', target.connectionString);
  } catch (error) {
    await client?.end().catch(() => undefined);
    fail(error instanceof NonProductionDatabaseGuardError
      ? error.message
      : 'Development Studio rejected safely.');
  }
}

async function main(arguments_: readonly string[]): Promise<void> {
  const [mode, value] = arguments_;

  if (mode === 'tombstone' && value && arguments_.length === 2) {
    fail(`This command has been retired. Use "npm run ${value}" instead.`);
    return;
  }

  if (mode === 'stub' && value && arguments_.length === 2) {
    fail(value);
    return;
  }

  if (
    mode === 'production'
    && (value === 'migrate' || value === 'studio')
    && arguments_.length === 2
  ) {
    await runProductionCommand(value);
    return;
  }

  if (
    mode === 'client-lifecycle'
    && value === 'migrate'
    && arguments_.length === 2
  ) {
    await runClientLifecycleMigration();
    return;
  }

  if (
    mode === 'development'
    && value === 'studio'
    && arguments_.length === 2
  ) {
    await runDevelopmentStudio();
    return;
  }

  fail('Database command rejected: unsupported fixed action.');
}

void main(process.argv.slice(2));
