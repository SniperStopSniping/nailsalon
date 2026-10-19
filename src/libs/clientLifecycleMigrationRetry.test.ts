import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it, vi } from 'vitest';

import {
  clientLifecycleMigrationFailureMessage,
  ClientLifecycleMigrationGuardError,
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

  it('does not retry a Drizzle-wrapped non-timeout 55P03 failure', async () => {
    const postgresError = Object.assign(new Error('could not obtain lock on row'), {
      code: '55P03',
    });
    const wrapped = new DrizzleQueryError(
      'UPDATE private_table SET value = $1',
      ['private-value'],
      postgresError,
    );
    const operation = vi.fn().mockRejectedValue(wrapped);
    const sleep = vi.fn();

    await expect(runClientLifecycleMigrationWithRetry(operation, {
      sleep,
    })).rejects.toBe(wrapped);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a Drizzle-wrapped PostgreSQL lock timeout', async () => {
    const postgresError = databaseError('55P03');
    const wrapped = new DrizzleQueryError(
      'SELECT pg_advisory_xact_lock($1)',
      ['private-lock-key'],
      postgresError,
    );
    const operation = vi.fn()
      .mockRejectedValueOnce(wrapped)
      .mockResolvedValue('migrated');
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runClientLifecycleMigrationWithRetry(operation, {
      sleep,
      random: () => 0,
    })).resolves.toBe('migrated');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it('exhausts the same bounded attempts for a wrapped lock timeout', async () => {
    const wrapped = new DrizzleQueryError(
      'SELECT pg_advisory_xact_lock($1)',
      ['private-lock-key'],
      databaseError('55P03'),
    );
    const operation = vi.fn().mockRejectedValue(wrapped);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runClientLifecycleMigrationWithRetry(operation, {
      sleep,
      random: () => 0,
    })).rejects.toBe(wrapped);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[50], [150]]);
  });

  it('formats a wrapped lock timeout without exposing SQL or parameters', () => {
    const wrapped = new DrizzleQueryError(
      'SELECT secret_query_marker($1)',
      ['secret_parameter_marker'],
      databaseError('55P03'),
    );

    const message = clientLifecycleMigrationFailureMessage(wrapped);

    expect(message).toBe(
      'Client lifecycle migration failed after PostgreSQL lock timeout (SQLSTATE 55P03).',
    );
    expect(message).not.toContain('secret_query_marker');
    expect(message).not.toContain('secret_parameter_marker');
    expect(message).not.toContain('Failed query');
  });

  it('keeps static domain errors useful and hides unknown wrapped query details', () => {
    const domainError = new ClientLifecycleMigrationGuardError(
      'Database stabilization capability is not ready.',
    );
    const unknownDatabaseError = new DrizzleQueryError(
      'SELECT secret_query_marker($1)',
      ['secret_parameter_marker'],
      new Error('connection failed'),
    );
    const unknownPlainError = new Error(
      'Unknown failure containing private-user, private-password, and private-token',
    );

    expect(clientLifecycleMigrationFailureMessage(domainError)).toBe(
      'Database stabilization capability is not ready.',
    );
    expect(clientLifecycleMigrationFailureMessage(unknownDatabaseError)).toBe(
      'Client lifecycle migration failed due to a database error.',
    );

    const plainMessage = clientLifecycleMigrationFailureMessage(unknownPlainError);

    expect(plainMessage).toBe(
      'Client lifecycle migration failed due to a database error.',
    );
    expect(plainMessage).not.toContain('private-user');
    expect(plainMessage).not.toContain('private-password');
    expect(plainMessage).not.toContain('private-token');
  });

  it('finds a nested PostgreSQL error code without looping causes', () => {
    const nested = databaseError('40001');
    const wrapper = Object.assign(new Error('wrapper'), { cause: nested });

    expect(databaseErrorCode(wrapper)).toBe('40001');

    const selfCause = Object.assign(new Error('self'), { cause: null as unknown });
    selfCause.cause = selfCause;

    expect(databaseErrorCode(selfCause)).toBeNull();

    let deepCause: Error & { cause?: unknown } = databaseError('40001');
    for (let depth = 0; depth < 9; depth += 1) {
      deepCause = Object.assign(new Error(`wrapper-${depth}`), {
        cause: deepCause,
      });
    }

    expect(databaseErrorCode(deepCause)).toBeNull();
  });
});
