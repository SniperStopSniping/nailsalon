import path from 'node:path';
import { pathToFileURL } from 'node:url';

type PGliteRuntimeEnvironment = {
  appEnv?: string;
  configuredDataDirectory?: string;
  cwd: string;
  nodeEnv?: string;
  vitest?: boolean;
};

/**
 * Returns a PGlite data source only for an explicit local-development path.
 * The path must be absolute and outside the repository so runtime data cannot
 * become a dirty worktree or be committed accidentally. Tests always retain
 * their existing isolated in-memory database.
 */
export function resolvePGliteRuntimeDataSource(
  environment: PGliteRuntimeEnvironment,
): string | undefined {
  const configured = environment.configuredDataDirectory?.trim();
  if (!configured || environment.vitest) {
    return undefined;
  }
  if (
    environment.nodeEnv === 'production'
    || ['preview', 'staging', 'production'].includes(environment.appEnv ?? '')
  ) {
    throw new Error('File-backed PGlite is available only in local development.');
  }
  if (!path.isAbsolute(configured)) {
    throw new Error('LUSTER_PGLITE_DATA_DIR must be an absolute path.');
  }

  const repositoryRoot = path.resolve(environment.cwd);
  const dataDirectory = path.resolve(configured);
  const relative = path.relative(repositoryRoot, dataDirectory);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('LUSTER_PGLITE_DATA_DIR must be outside the repository.');
  }

  return pathToFileURL(dataDirectory).href;
}
