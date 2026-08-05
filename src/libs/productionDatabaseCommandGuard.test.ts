import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PRODUCTION_CONFIRMATION_ENV,
  ProductionDatabaseCommandGuardError,
  requireProductionDatabaseCommandConfirmation,
} from './productionDatabaseCommandGuard';

function setLocalDate(year: number, month: number, day: number): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(year, month - 1, day, 12));
}

function expectRejection(
  value: string | undefined,
): ProductionDatabaseCommandGuardError {
  try {
    requireProductionDatabaseCommandConfirmation({
      [PRODUCTION_CONFIRMATION_ENV]: value,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ProductionDatabaseCommandGuardError);
    expect(error).toMatchObject({
      code: 'PRODUCTION_CONFIRMATION_REQUIRED',
    });

    return error as ProductionDatabaseCommandGuardError;
  }

  throw new Error('Expected Production database confirmation to be rejected.');
}

describe('Production database command confirmation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts only the current local calendar date', () => {
    setLocalDate(2026, 8, 3);

    expect(() => requireProductionDatabaseCommandConfirmation({
      [PRODUCTION_CONFIRMATION_ENV]: '2026-08-03',
    })).not.toThrow();

    expectRejection('2026-08-02');
    expectRejection('2026-08-04');
  });

  it('calculates the required date at invocation time', () => {
    setLocalDate(2026, 8, 3);

    expect(() => requireProductionDatabaseCommandConfirmation({
      [PRODUCTION_CONFIRMATION_ENV]: '2026-08-03',
    })).not.toThrow();

    vi.setSystemTime(new Date(2026, 7, 4, 12));

    expectRejection('2026-08-03');

    expect(() => requireProductionDatabaseCommandConfirmation({
      [PRODUCTION_CONFIRMATION_ENV]: '2026-08-04',
    })).not.toThrow();
  });

  it.each([
    undefined,
    '',
    '2026-8-3',
    '2026-08-03 ',
    ' 2026-08-03',
  ])('rejects a missing or non-exact confirmation value: %j', (value) => {
    setLocalDate(2026, 8, 3);

    expectRejection(value);
  });

  it('returns a typed, sanitized error', () => {
    setLocalDate(2026, 8, 3);
    const suppliedValue = ['do', 'not', 'print', 'this'].join('-');
    const error = expectRejection(suppliedValue);

    expect(error.name).toBe('ProductionDatabaseCommandGuardError');
    expect(error.message).not.toContain(suppliedValue);
    expect(JSON.stringify(error)).not.toContain(suppliedValue);
  });
});
