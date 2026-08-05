import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

type FixedAction =
  | 'initialize:development'
  | 'initialize:preview'
  | 'migrate:development'
  | 'migrate:preview'
  | 'reset:development'
  | 'seed:development'
  | 'studio:development'
  | 'verify:development'
  | 'verify:preview';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const fixedCommands: Record<FixedAction, readonly string[]> = {
  'initialize:development': [
    'scripts/initialize-nonproduction-database.ts',
    'initialize',
    'development',
  ],
  'initialize:preview': [
    'scripts/initialize-nonproduction-database.ts',
    'initialize',
    'preview',
  ],
  'migrate:development': [
    'scripts/migrate-development.ts',
    'development',
  ],
  'migrate:preview': [
    'scripts/migrate-development.ts',
    'preview',
  ],
  'reset:development': ['scripts/reset-development.ts'],
  'seed:development': ['scripts/seed.ts'],
  'studio:development': [
    'scripts/database-command.ts',
    'development',
    'studio',
  ],
  'verify:development': [
    'scripts/initialize-nonproduction-database.ts',
    'verify',
    'development',
  ],
  'verify:preview': [
    'scripts/initialize-nonproduction-database.ts',
    'verify',
    'preview',
  ],
};

function fail(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function loadDevelopmentEnvironment(): void {
  // The first file wins. The fallback fills only missing values; neither call
  // overrides values explicitly supplied by the invoking process (for example,
  // a one-process Keychain wrapper used for Preview provisioning).
  loadEnv({
    path: path.join(repositoryRoot, '.env.development.local'),
    override: false,
    quiet: true,
  });
  loadEnv({
    path: path.join(repositoryRoot, '.env.local'),
    override: false,
    quiet: true,
  });
}

function isFixedAction(value: string | undefined): value is FixedAction {
  return Boolean(value && Object.hasOwn(fixedCommands, value));
}

function main(arguments_: readonly string[]): void {
  const [action] = arguments_;
  if (!isFixedAction(action) || arguments_.length !== 1) {
    fail('Development database command rejected: unsupported fixed action.');
    return;
  }

  if (action.endsWith(':development')) {
    loadDevelopmentEnvironment();
  }

  const executable = path.join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const result = spawnSync(executable, [...fixedCommands[action]], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error || result.status === null) {
    fail('Development database command could not be started safely.');
    return;
  }

  process.exitCode = result.status;
}

main(process.argv.slice(2));
