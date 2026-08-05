#!/usr/bin/env tsx

import {
  assertEnvironmentIsolation,
  EnvironmentIsolationError,
} from '../src/libs/environmentIsolation';

try {
  const runtimeEnvironment = assertEnvironmentIsolation(process.env);
  process.stdout.write(
    `Environment isolation verified for ${runtimeEnvironment}.\n`,
  );
} catch (error) {
  const message = error instanceof EnvironmentIsolationError
    ? error.message
    : 'Environment isolation verification failed safely.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
