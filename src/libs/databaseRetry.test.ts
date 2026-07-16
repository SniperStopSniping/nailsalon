import { describe, expect, it, vi } from 'vitest';

import {
  isTransientDatabaseError,
  withTransientDatabaseRetry,
} from './databaseRetry';

vi.mock('server-only', () => ({}));

describe('database retry', () => {
  it('retries transient connection failures and returns the successful result', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('connection terminated unexpectedly'), {
          code: '08006',
        }),
      )
      .mockResolvedValueOnce('ok');

    await expect(
      withTransientDatabaseRetry(operation, { baseDelayMs: 10 }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry application or validation failures', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(new Error('invalid appointment'));

    await expect(
      withTransientDatabaseRetry(operation, { baseDelayMs: 10 }),
    ).rejects.toThrow('invalid appointment');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('recognizes the transient failures returned by managed Postgres providers', () => {
    expect(isTransientDatabaseError({ code: '53300' })).toBe(true);
    expect(isTransientDatabaseError(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransientDatabaseError({ code: '23505' })).toBe(false);
  });
});
