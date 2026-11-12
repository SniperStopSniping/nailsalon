import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerPaymentCapture } from '@/models/customerPaymentSchema';

import { providerCorrelationFingerprint } from '../provider/correlation';
import { readOfflineFixtureCaptureEvidence } from './fixtureApplicationReader';

vi.mock('server-only', () => ({}));
const capture = { id: 'capture', source: 'offline_fixture_test' } as CustomerPaymentCapture;
const application = { id: 'application', captureId: 'capture', quoteId: 'quote', platformId: 'acct_platform', sourceEvidence: { original: true }, ownershipEvidence: [], sourceRevision: providerCorrelationFingerprint({ original: true }), ownershipRevision: providerCorrelationFingerprint([]) };
const quote = { id: 'quote' };
const hold = { id: 'hold', applicationId: 'application', platformRevision: 2 };
function reader(results: unknown[]) {
  const where = vi.fn();
  for (const result of results) {
    where.mockResolvedValueOnce(result);
  }
  return { select: vi.fn(() => ({ from: () => ({ where }) })) };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
});

afterEach(() => vi.unstubAllEnvs());

describe('conditional immutable fixture application reads', () => {
  it('never reads fixture tables for legacy or synthetic captures', async () => {
    const db = reader([]);

    expect(await readOfflineFixtureCaptureEvidence(db, [])).toEqual([]);
    expect(await readOfflineFixtureCaptureEvidence(db, [{ ...capture, source: 'synthetic_test' }])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('preserves binding and permanent holds while application writes are off', async () => {
    const db = reader([[application], [quote], [hold], [{ platformId: 'acct_platform', revision: 2 }]]);

    expect(await readOfflineFixtureCaptureEvidence(db, [capture])).toEqual([{ application, quote, holds: [hold], currentPlatformRevision: 2 }]);
    expect(db.select).toHaveBeenCalledTimes(4);
  });

  it.each([
    [[], [quote], [], []],
    [[application, application], [quote], [], []],
    [[application], [], [], [{ platformId: 'acct_platform', revision: 1 }]],
    [[application], [quote, quote], [], [{ platformId: 'acct_platform', revision: 1 }]],
    [[application], [quote], [], []],
    [[application], [quote], undefined, [{ platformId: 'acct_platform', revision: 1 }]],
  ])('rejects missing/duplicate/unreadable binding facts', async (...results) => {
    await expect(readOfflineFixtureCaptureEvidence(reader(results), [capture])).rejects.toThrow();
  });

  it.each([{ sourceEvidence: { changed: true } }, { sourceRevision: 'a'.repeat(64) }, { ownershipEvidence: [{ changed: true }] }, { ownershipRevision: 'b'.repeat(64) }, { sourceEvidence: undefined }])('rejects corrupted immutable evidence/hash %j', async (patch) => {
    await expect(readOfflineFixtureCaptureEvidence(reader([[{ ...application, ...patch }]]), [capture])).rejects.toThrow();
  });

  it.each(['development', 'production'])('rejects fixture authority in %s despite forced flags', async (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'true');
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'true');
    const db = reader([]);

    await expect(readOfflineFixtureCaptureEvidence(db, [capture])).rejects.toThrow();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('fails closed before schema reads when ledger gate is off', async () => {
    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');
    const db = reader([]);

    await expect(readOfflineFixtureCaptureEvidence(db, [capture])).rejects.toThrow();
    expect(db.select).not.toHaveBeenCalled();
  });
});
