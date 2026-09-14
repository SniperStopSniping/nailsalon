import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRODUCTION_CONFIRMATION_ENV } from '../../src/libs/productionDatabaseCommandGuard';
import {
  BILLING_INTEGRITY_CHECK_USAGE,
  classifyDatabaseTarget,
  decideIntegrityCheckGuard,
  parseIntegrityCheckArgs,
} from './billingScriptGuards';

// Credential-free fixtures: the secret scanner (scripts/check-secret-leaks.mjs)
// flags any literal `user:password@host` database URL, even a fake one.
const NON_PRODUCTION_URL = 'postgresql://localhost:5432/luster_dev';
const PRODUCTION_LOOKING_URL = 'postgresql://ep-example-12345.us-east-2.aws.neon.tech/luster';

function setLocalDate(year: number, month: number, day: number): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(year, month - 1, day, 12));
}

describe('classifyDatabaseTarget', () => {
  it('classifies a localhost URL as non-production', () => {
    expect(classifyDatabaseTarget({ DATABASE_URL: NON_PRODUCTION_URL })).toEqual({ kind: 'non-production' });
  });

  it('classifies an unallowlisted hosted-provider URL as production-looking', () => {
    expect(classifyDatabaseTarget({ DATABASE_URL: PRODUCTION_LOOKING_URL })).toEqual({ kind: 'production-looking' });
  });

  it('classifies a missing DATABASE_URL as invalid', () => {
    const result = classifyDatabaseTarget({});

    expect(result.kind).toBe('invalid');
  });

  it('classifies a malformed DATABASE_URL as invalid, never production-looking', () => {
    const result = classifyDatabaseTarget({ DATABASE_URL: 'not-a-postgres-url' });

    expect(result.kind).toBe('invalid');
  });
});

describe('parseIntegrityCheckArgs', () => {
  it('parses --help', () => {
    expect(parseIntegrityCheckArgs(['--help'])).toEqual({
      help: true,
      allowProduction: false,
      reportSentry: false,
      databaseUrl: null,
    });
  });

  it('defaults every flag off', () => {
    expect(parseIntegrityCheckArgs([])).toEqual({
      help: false,
      allowProduction: false,
      reportSentry: false,
      databaseUrl: null,
    });
  });

  it('recognizes --allow-production, --report-sentry and --database-url', () => {
    expect(parseIntegrityCheckArgs([
      '--allow-production',
      '--report-sentry',
      '--database-url',
      PRODUCTION_LOOKING_URL,
    ])).toEqual({
      help: false,
      allowProduction: true,
      reportSentry: true,
      databaseUrl: PRODUCTION_LOOKING_URL,
    });
  });

  it('exposes non-empty usage text', () => {
    expect(BILLING_INTEGRITY_CHECK_USAGE.length).toBeGreaterThan(0);
  });
});

describe('decideIntegrityCheckGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not refused in CI (read-only)', () => {
    const environment = { CI: 'true', DATABASE_URL: NON_PRODUCTION_URL };

    expect(decideIntegrityCheckGuard({ allowProduction: false, databaseUrl: null }, environment)).toEqual({
      allowed: true,
      targetKind: 'non-production',
    });
  });

  it('allows a non-production target by default', () => {
    const environment = { DATABASE_URL: NON_PRODUCTION_URL };

    expect(decideIntegrityCheckGuard({ allowProduction: false, databaseUrl: null }, environment)).toEqual({
      allowed: true,
      targetKind: 'non-production',
    });
  });

  it('refuses a production-looking target without --allow-production', () => {
    const environment = { DATABASE_URL: PRODUCTION_LOOKING_URL };
    const decision = decideIntegrityCheckGuard({ allowProduction: false, databaseUrl: null }, environment);

    expect(decision.allowed).toBe(false);
  });

  it('refuses --allow-production without LUSTER_PRODUCTION_CONFIRM', () => {
    const environment = { DATABASE_URL: PRODUCTION_LOOKING_URL };
    const decision = decideIntegrityCheckGuard({ allowProduction: true, databaseUrl: null }, environment);

    expect(decision).toEqual({
      allowed: false,
      reason: expect.stringContaining('LUSTER_PRODUCTION_CONFIRM'),
    });
  });

  it('allows --allow-production with a fresh confirmation date', () => {
    setLocalDate(2026, 9, 14);
    const environment = {
      DATABASE_URL: PRODUCTION_LOOKING_URL,
      [PRODUCTION_CONFIRMATION_ENV]: '2026-09-14',
    };

    expect(decideIntegrityCheckGuard({ allowProduction: true, databaseUrl: null }, environment)).toEqual({
      allowed: true,
      targetKind: 'production',
    });
  });
});
