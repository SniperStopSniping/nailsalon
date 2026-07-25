export const CLIENT_LIFECYCLE_MIGRATION_RETRYABLE_SQLSTATES = new Set([
  '40P01',
  '40001',
  '55P03',
]);

export function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  return candidate.cause === error ? null : databaseErrorCode(candidate.cause);
}

function databaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const candidate = error as { message?: unknown; cause?: unknown };
  if (typeof candidate.message === 'string') {
    return candidate.message;
  }
  return candidate.cause === error ? '' : databaseErrorMessage(candidate.cause);
}

export function isRetryableClientLifecycleMigrationError(
  error: unknown,
): boolean {
  const code = databaseErrorCode(error);
  if (code === '40P01' || code === '40001') {
    return true;
  }
  return code === '55P03'
    && /canceling statement due to lock timeout/i.test(
      databaseErrorMessage(error),
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
