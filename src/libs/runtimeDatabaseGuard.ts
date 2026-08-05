import 'server-only';

import { createHash } from 'node:crypto';

import {
  resolveRuntimeEnvironment,
  type RuntimeEnvironment,
} from './environmentIsolation';
import {
  type DatabaseQueryable,
  type DevelopmentDatabaseEnvironment,
  rejectNonProductionMarkerForProduction,
  requireExactNonProductionDatabaseEnvironment,
  requireNonProductionDatabaseTarget,
  requirePostgresDatabaseTarget,
} from './nonProductionDatabaseGuard';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export type RuntimeDatabaseGuardErrorCode =
  | 'CACHED_DATABASE_TARGET_MISMATCH'
  | 'CI_REMOTE_DATABASE_FORBIDDEN'
  | 'DATABASE_ATTESTATION_REJECTED'
  | 'DATABASE_URL_REJECTED'
  | 'HOSTED_DATABASE_REQUIRED'
  | 'RUNTIME_ENVIRONMENT_AMBIGUOUS';

const ERROR_MESSAGES: Record<RuntimeDatabaseGuardErrorCode, string> = {
  CACHED_DATABASE_TARGET_MISMATCH:
    'Runtime database rejected: the cached pool belongs to a different target.',
  CI_REMOTE_DATABASE_FORBIDDEN:
    'Runtime database rejected: CI may use only an approved loopback PostgreSQL target.',
  DATABASE_ATTESTATION_REJECTED:
    'Runtime database rejected: live environment attestation failed.',
  DATABASE_URL_REJECTED:
    'Runtime database rejected: DATABASE_URL is not an approved PostgreSQL target.',
  HOSTED_DATABASE_REQUIRED:
    'Runtime database rejected: hosted Preview and Production require DATABASE_URL.',
  RUNTIME_ENVIRONMENT_AMBIGUOUS:
    'Runtime database rejected: the application environment is ambiguous.',
};

export class RuntimeDatabaseGuardError extends Error {
  readonly code: RuntimeDatabaseGuardErrorCode;

  constructor(code: RuntimeDatabaseGuardErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'RuntimeDatabaseGuardError';
    this.code = code;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;
type ResolvedRuntimeEnvironment = Exclude<RuntimeEnvironment, 'unknown'>;

export type RuntimePostgresTarget = {
  connectionString: string;
  environment: ResolvedRuntimeEnvironment;
  fingerprint: string;
  host: string;
};

export type RuntimePoolVerifier = (
  client: DatabaseQueryable,
  callback: (error?: Error) => void,
) => void;

function reject(code: RuntimeDatabaseGuardErrorCode): never {
  throw new RuntimeDatabaseGuardError(code);
}

function fingerprintTarget(
  environment: ResolvedRuntimeEnvironment,
  connectionString: string,
): string {
  return createHash('sha256')
    .update(environment)
    .update('\0')
    .update(connectionString)
    .digest('hex');
}

function requiredPostgresTarget(
  environment: Environment,
  runtimeEnvironment: ResolvedRuntimeEnvironment,
  nonProduction: boolean,
): RuntimePostgresTarget {
  try {
    const target = nonProduction
      ? requireNonProductionDatabaseTarget(environment)
      : requirePostgresDatabaseTarget(environment);
    return {
      ...target,
      environment: runtimeEnvironment,
      fingerprint: fingerprintTarget(
        runtimeEnvironment,
        target.connectionString,
      ),
    };
  } catch {
    reject('DATABASE_URL_REJECTED');
  }
}

/**
 * Selects PGlite only for explicit local/test/CI environments. Any configured
 * PostgreSQL target is validated before a Pool can be constructed.
 */
export function requireRuntimeDatabaseTarget(
  environment: Environment = process.env,
): RuntimePostgresTarget | null {
  let runtimeEnvironment: RuntimeEnvironment;
  try {
    runtimeEnvironment = resolveRuntimeEnvironment(environment);
  } catch {
    reject('RUNTIME_ENVIRONMENT_AMBIGUOUS');
  }
  const hasDatabaseUrl = Boolean(environment.DATABASE_URL);

  if (runtimeEnvironment === 'unknown') {
    reject('RUNTIME_ENVIRONMENT_AMBIGUOUS');
  }

  if (!hasDatabaseUrl) {
    if (
      runtimeEnvironment === 'preview'
      || runtimeEnvironment === 'production'
    ) {
      reject('HOSTED_DATABASE_REQUIRED');
    }
    return null;
  }

  if (
    runtimeEnvironment === 'development'
    || runtimeEnvironment === 'preview'
  ) {
    return requiredPostgresTarget(environment, runtimeEnvironment, true);
  }

  const target = requiredPostgresTarget(
    environment,
    runtimeEnvironment,
    false,
  );
  if (
    (runtimeEnvironment === 'ci' || runtimeEnvironment === 'test')
    && !LOOPBACK_HOSTS.has(target.host)
  ) {
    reject('CI_REMOTE_DATABASE_FORBIDDEN');
  }
  return target;
}

/** Attests a connected client before the pool may lease it to application code. */
export async function verifyRuntimeDatabaseConnection(
  queryable: DatabaseQueryable,
  target: RuntimePostgresTarget,
): Promise<void> {
  try {
    if (
      target.environment === 'development'
      || target.environment === 'preview'
    ) {
      await requireExactNonProductionDatabaseEnvironment(
        queryable,
        target.environment as DevelopmentDatabaseEnvironment,
      );
      return;
    }

    if (target.environment === 'production') {
      await rejectNonProductionMarkerForProduction(queryable);
      return;
    }

    // CI/test targets are already restricted to loopback. This query ensures
    // the connection is live before the Pool exposes it.
    await queryable.query('SELECT 1');
  } catch {
    reject('DATABASE_ATTESTATION_REJECTED');
  }
}

/** pg-pool invokes this for every newly connected client before first use. */
export function createRuntimeDatabasePoolVerifier(
  target: RuntimePostgresTarget,
): RuntimePoolVerifier {
  return (client, callback) => {
    void verifyRuntimeDatabaseConnection(client, target).then(
      () => callback(),
      () => callback(
        new RuntimeDatabaseGuardError('DATABASE_ATTESTATION_REJECTED'),
      ),
    );
  };
}

export function requireMatchingCachedDatabaseTarget(
  cachedFingerprint: string | undefined,
  target: RuntimePostgresTarget,
): void {
  if (cachedFingerprint !== target.fingerprint) {
    reject('CACHED_DATABASE_TARGET_MISMATCH');
  }
}
