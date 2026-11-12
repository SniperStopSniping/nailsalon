import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appointmentPaymentSchema } from '@/models/Schema';

import { projectOfflineFixtureMovementReport } from '../fixtureMovementReporting';
import { providerCorrelationFingerprint } from '../provider/correlation';
import { readOfflineFixtureCaptureEvidence } from './fixtureApplicationReader';
import { readOfflineFixtureMovementReport } from './fixtureMovementReportingReader';

vi.mock('server-only', () => ({}));
vi.mock('./fixtureApplicationReader', () => ({ readOfflineFixtureCaptureEvidence: vi.fn() }));
vi.mock('../fixtureMovementReporting', () => ({ fixtureMovementFingerprintFacts: (row: { evidence: unknown }) => row.evidence, fixtureMovementKeyFacts: () => ({ kind: 'key' }), projectOfflineFixtureMovementReport: vi.fn(() => ({ refundedCents: 500, movementReconciliationRequired: false })) }));
const input = { salonId: 'salon', currency: 'CAD' as const, start: new Date('2026-11-01'), end: new Date('2026-11-02') };
const capture = { id: 'capture', tenderId: 'cpay_capture', source: 'offline_fixture_test', capturedAt: new Date('2026-10-01') };
const snapshot = { id: 'batch', applicationId: 'application', sourceEvidence: { source: true }, sourceRevision: providerCorrelationFingerprint({ source: true }), ownershipEvidence: { owner: true }, ownershipRevision: providerCorrelationFingerprint({ owner: true }) };
const candidateFacts = { movementKey: { kind: 'key' }, amountCents: 500, currency: 'cad', chargeId: 'charge', paymentIntentId: 'intent' };
const candidateFingerprint = providerCorrelationFingerprint(candidateFacts);
const movementEvidence = { movement: true, movementKey: candidateFacts.movementKey, candidateFacts: { ...candidateFacts, fingerprint: candidateFingerprint }, candidateFingerprint };
const movement = { id: 'movement', reconciliationId: 'batch', ...candidateFacts, movementKeyHash: providerCorrelationFingerprint({ kind: 'key' }), evidence: movementEvidence, fingerprint: providerCorrelationFingerprint(movementEvidence) };

function database(results: unknown[]) {
  const queue = [...results];
  const select = vi.fn(() => ({ from: (table: unknown) => {
    if (table === appointmentPaymentSchema && queue.length && queue[0] === 'probe') {
      queue.shift();
      return { innerJoin: () => ({ where: () => ({ limit: async () => queue.shift() }) }) };
    }
    return { where: async () => queue.shift() };
  } }));
  return { select } as unknown as Parameters<typeof readOfflineFixtureMovementReport>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false');
  vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_MOVEMENTS_ENABLED', 'false');
  vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
  vi.mocked(readOfflineFixtureCaptureEvidence).mockResolvedValue([{ application: { id: 'application' }, currentPlatformRevision: 2 }] as never);
});

afterEach(() => vi.unstubAllEnvs());

describe('historical fixture movement reader', () => {
  it('keeps the legacy no-marker path free of new-table reads', async () => {
    const db = database(['probe', []]);
    await readOfflineFixtureMovementReport(db, input);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(readOfflineFixtureCaptureEvidence).not.toHaveBeenCalled();
  });

  it('reuses the request legacy marker probe without another query', async () => {
    const db = database([]);
    await readOfflineFixtureMovementReport(db, { ...input, hasCustomerPaymentMarker: false });

    expect(db.select).not.toHaveBeenCalled();
  });

  it('loads out-of-period parents and hashes evidence with future writes disabled', async () => {
    const db = database(['probe', [{ id: 'cpay_capture' }], [capture], [{ id: 'cpay_capture' }], [snapshot], [movement], [snapshot]]);
    const result = await readOfflineFixtureMovementReport(db, input);

    expect(result).toMatchObject({ refundedCents: 500, movementReconciliationRequired: false });
    expect(projectOfflineFixtureMovementReport).toHaveBeenLastCalledWith(expect.objectContaining({ captures: [capture], movements: [movement], reconciliations: [snapshot] }));
    expect(readOfflineFixtureCaptureEvidence).toHaveBeenCalledTimes(2);
  });

  it('discloses a reconciliation arriving between snapshot and movement reads', async () => {
    const db = database(['probe', [{ id: 'cpay_capture' }], [capture], [{ id: 'cpay_capture' }], [], [movement], [snapshot], [snapshot], [movement], [snapshot, { ...snapshot, id: 'next' }]]);

    expect(await readOfflineFixtureMovementReport(db, input)).toMatchObject({ refundedCents: 500, movementReconciliationRequired: true });
    expect(projectOfflineFixtureMovementReport).toHaveBeenLastCalledWith(expect.objectContaining({ movements: [movement], reconciliations: [snapshot] }));
  });

  it('retries a newly arrived batch before claiming complete cash', async () => {
    const db = database(['probe', [{ id: 'cpay_capture' }], [capture], [{ id: 'cpay_capture' }], [], [movement], [snapshot], [snapshot], [movement], [snapshot]]);

    expect(await readOfflineFixtureMovementReport(db, input)).toMatchObject({ movementReconciliationRequired: false });
    expect(readOfflineFixtureCaptureEvidence).toHaveBeenCalledTimes(3);
  });

  it('retries a changed final platform revision even without a new batch', async () => {
    vi.mocked(readOfflineFixtureCaptureEvidence)
      .mockResolvedValueOnce([{ application: { id: 'application' }, currentPlatformRevision: 2 }] as never)
      .mockResolvedValueOnce([{ application: { id: 'application' }, currentPlatformRevision: 3 }] as never)
      .mockResolvedValueOnce([{ application: { id: 'application' }, currentPlatformRevision: 4 }] as never);
    const db = database(['probe', [{ id: 'cpay_capture' }], [capture], [{ id: 'cpay_capture' }], [snapshot], [movement], [snapshot], [snapshot], [movement], [snapshot]]);

    expect(await readOfflineFixtureMovementReport(db, input)).toMatchObject({ movementReconciliationRequired: true });
    expect(readOfflineFixtureCaptureEvidence).toHaveBeenCalledTimes(3);
  });

  it.each(['sourceEvidence', 'ownershipEvidence'])('rejects corrupt snapshot %s before projection', async (field) => {
    const corrupted = { ...snapshot, [field]: { corrupt: true } };
    const db = database(['probe', [{ id: 'cpay_capture' }], [capture], [{ id: 'cpay_capture' }], [snapshot], [movement], [corrupted]]);

    await expect(readOfflineFixtureMovementReport(db, input)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(projectOfflineFixtureMovementReport).not.toHaveBeenCalled();
  });

  it('rejects corrupt movement evidence', async () => {
    const db = database(['probe', [{ id: 'cpay_capture' }], [capture], [{ id: 'cpay_capture' }], [snapshot], [{ ...movement, evidence: { corrupt: true } }], [snapshot]]);

    await expect(readOfflineFixtureMovementReport(db, input)).rejects.toThrow('RECONCILIATION_REQUIRED');
  });

  it('fails closed before new tables when the historical read gate is off', async () => {
    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');
    const db = database(['probe', [{ id: 'cpay_capture' }]]);

    await expect(readOfflineFixtureMovementReport(db, input)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('rejects fixture authority outside strict test mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const db = database(['probe', [{ id: 'cpay_capture' }], [capture]]);

    await expect(readOfflineFixtureMovementReport(db, input)).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(readOfflineFixtureCaptureEvidence).not.toHaveBeenCalled();
  });
});
