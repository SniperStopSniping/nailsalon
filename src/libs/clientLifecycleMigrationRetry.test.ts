import { describe, expect, it, vi } from 'vitest';

import {
  databaseErrorCode,
  runClientLifecycleMigrationWithRetry,
} from './clientLifecycleMigrationRetry';

function databaseError(code: string): Error & { code: string } {
  const message = code === '55P03'
    ? 'canceling statement due to lock timeout'
    : code;
  return Object.assign(new Error(message), { code });
}

describe('runClientLifecycleMigrationWithRetry', () => {
  it.each(['40P01', '40001', '55P03'])(
    'retries %s and returns the successful result',
    async (code) => {
      const operation = vi.fn()
        .mockRejectedValueOnce(databaseError(code))
        .mockResolvedValue('migrated');
      const sleep = vi.fn().mockResolvedValue(undefined);

      await expect(runClientLifecycleMigrationWithRetry(operation, {
        sleep,
        random: () => 0,
      })).resolves.toBe('migrated');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(50);
    },
  );

  it('uses bounded jitter and exhausts after three complete attempts', async () => {
    const failure = databaseError('40P01');
    const operation = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runClientLifecycleMigrationWithRetry(operation, {
      sleep,
      random: () => 1,
    })).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[100], [300]]);
  });

  it('does not retry non-approved database failures', async () => {
    const failure = databaseError('57014');
    const operation = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn();

    await expect(runClientLifecycleMigrationWithRetry(operation, {
      sleep,
    })).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry a non-timeout 55P03 failure', async () => {
    const failure = Object.assign(new Error('could not obtain lock on row'), {
      code: '55P03',
    });
    const operation = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn();

    await expect(runClientLifecycleMigrationWithRetry(operation, {
      sleep,
    })).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('finds a nested PostgreSQL error code without looping causes', () => {
    const nested = databaseError('40001');
    const wrapper = Object.assign(new Error('wrapper'), { cause: nested });

    expect(databaseErrorCode(wrapper)).toBe('40001');

    const selfCause = Object.assign(new Error('self'), { cause: null as unknown });
    selfCause.cause = selfCause;

    expect(databaseErrorCode(selfCause)).toBeNull();
  });
});
