export const CLIENT_LIFECYCLE_MIGRATION_RETRYABLE_SQLSTATES = new Set([
  '40P01',
  '40001',
  '55P03',
]);

const MAX_DATABASE_ERROR_CAUSE_DEPTH = 8;

type DatabaseError = {
  code: string;
  message: string;
};

export class ClientLifecycleMigrationGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientLifecycleMigrationGuardError';
  }
}

function findDatabaseError(error: unknown): DatabaseError | null {
  let current = error;
  const seen = new Set<object>();

  for (let depth = 0; depth < MAX_DATABASE_ERROR_CAUSE_DEPTH; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) {
      return null;
    }
    seen.add(current);

    const candidate = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.code === 'string') {
      return {
        code: candidate.code,
        message: typeof candidate.message === 'string'
          ? candidate.message
          : '',
      };
    }
    current = candidate.cause;
  }

  return null;
}

export function databaseErrorCode(error: unknown): string | null {
  return findDatabaseError(error)?.code ?? null;
}

export function clientLifecycleMigrationFailureMessage(error: unknown): string {
  if (error instanceof ClientLifecycleMigrationGuardError) {
    return error.message;
  }

  const databaseError = findDatabaseError(error);
  if (databaseError) {
    if (
      databaseError.code === '55P03'
      && /canceling statement due to lock timeout/i.test(databaseError.message)
    ) {
      return 'Client lifecycle migration failed after PostgreSQL lock timeout (SQLSTATE 55P03).';
    }
    if (/^[0-9A-Z]{5}$/.test(databaseError.code)) {
      return `Client lifecycle migration failed due to PostgreSQL error (SQLSTATE ${databaseError.code}).`;
    }
    return 'Client lifecycle migration failed due to a database error.';
  }

  return error && typeof error === 'object'
    ? 'Client lifecycle migration failed due to a database error.'
    : 'Client lifecycle migration failed.';
}

export function isRetryableClientLifecycleMigrationError(
  error: unknown,
): boolean {
  const databaseError = findDatabaseError(error);
  if (!databaseError) {
    return false;
  }
  const code = databaseError.code;
  if (code === '40P01' || code === '40001') {
    return true;
  }
  return code === '55P03'
    && /canceling statement due to lock timeout/i.test(
      databaseError.message,
    );
}

type MigrationRetryDependencies = {
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function runClientLifecycleMigrationWithRetry<T>(
  migration: (attempt: number) => Promise<T>,
  dependencies: MigrationRetryDependencies = {},
): Promise<T> {
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await migration(attempt);
    } catch (error) {
      const code = databaseErrorCode(error);
      if (
        attempt === 3
        || code == null
        || !isRetryableClientLifecycleMigrationError(error)
      ) {
        throw error;
      }
      const minimum = attempt === 1 ? 50 : 150;
      const spread = attempt === 1 ? 50 : 150;
      const jitter = Math.min(1, Math.max(0, random()));
      await sleep(minimum + Math.floor(jitter * spread));
    }
  }

  throw new Error('Unreachable client lifecycle migration retry state.');
}
