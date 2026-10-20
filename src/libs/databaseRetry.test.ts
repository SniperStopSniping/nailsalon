import { DrizzleQueryError } from 'drizzle-orm/errors';
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

  it.each(['08006', '57P01'])('retries Drizzle-wrapped transient SQLSTATE %s', async (code) => {
    const postgresError = Object.assign(new Error('database connection failed'), { code });
    const operation = vi.fn()
      .mockRejectedValueOnce(new DrizzleQueryError('SELECT 1', [], postgresError))
      .mockResolvedValueOnce('ok');

    await expect(
      withTransientDatabaseRetry(operation, { attempts: 2, baseDelayMs: 10 }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry a wrapped permanent SQLSTATE because query parameters mention a transient phrase', async () => {
    const postgresError = Object.assign(new Error('duplicate key violates unique constraint'), {
      code: '23505',
    });
    const wrapped = new DrizzleQueryError(
      'SELECT $1',
      ['connection reset'],
      postgresError,
    );
    const operation = vi.fn().mockRejectedValue(wrapped);

    await expect(
      withTransientDatabaseRetry(operation, { attempts: 3, baseDelayMs: 10 }),
    ).rejects.toBe(wrapped);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('finds the SQLSTATE through nested Drizzle causes', async () => {
    const postgresError = Object.assign(new Error('database connection failed'), {
      code: '08006',
    });
    const inner = new DrizzleQueryError('SELECT 1', [], postgresError);
    const outer = new DrizzleQueryError('SELECT 2', [], inner);
    const operation = vi.fn()
      .mockRejectedValueOnce(outer)
      .mockResolvedValueOnce('ok');

    await expect(
      withTransientDatabaseRetry(operation, { attempts: 2, baseDelayMs: 10 }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('terminates safely on cyclic causes and does not retry them', async () => {
    const cyclic = new DrizzleQueryError('SELECT 1', [], new Error('wrapped failure'));
    cyclic.cause = cyclic;
    const operation = vi.fn().mockRejectedValue(cyclic);

    expect(isTransientDatabaseError(cyclic)).toBe(false);
    await expect(
      withTransientDatabaseRetry(operation, { attempts: 3, baseDelayMs: 10 }),
    ).rejects.toBe(cyclic);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
