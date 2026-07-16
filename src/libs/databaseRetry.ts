import 'server-only';

const TRANSIENT_POSTGRES_CODES = new Set([
  '08000',
  '08003',
  '08006',
  '53300',
  '57P01',
  '57P02',
  '57P03',
]);

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export function isTransientDatabaseError(error: unknown): boolean {
  const code = postgresCode(error);
  if (code && TRANSIENT_POSTGRES_CODES.has(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return [
    'connection terminated',
    'connection reset',
    'econnreset',
    'etimedout',
    'timeout expired',
    'the database system is starting up',
    'too many clients',
  ].some(fragment => message.includes(fragment));
}

export async function withTransientDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(options.attempts ?? 3, 5));
  const baseDelayMs = Math.max(10, Math.min(options.baseDelayMs ?? 150, 2_000));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts || !isTransientDatabaseError(error)) {
        throw error;
      }
      await new Promise(resolve =>
        setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)),
      );
    }
  }

  throw new Error('Database operation failed');
}
