import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppointmentPayment } from '@/models/Schema';

import { readCustomerPaymentCaptureReport } from './captureReportingReader';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ legacy: vi.fn(), fixture: vi.fn(), evidence: vi.fn() }));
vi.mock('../captureReporting', () => ({ CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED: 'RECONCILE', projectCustomerPaymentCaptureReport: mocks.legacy }));
vi.mock('../fixtureCaptureReporting', () => ({ projectOfflineFixtureCaptureReport: mocks.fixture }));
vi.mock('./fixtureApplicationReader', () => ({ readOfflineFixtureCaptureEvidence: mocks.evidence }));
const report = (gross: number, held = 0) => ({ collectedCents: gross, heldForReviewCents: held, captureCount: 1, unknownCurrencyEventCount: 0, excludedForeignCurrencyEventCount: 0 });
const input = { salonId: 's', currency: 'CAD' as const, start: new Date('2026-11-08'), end: new Date('2026-11-09'), markers: [{ id: 'cpay_synthetic' }, { id: 'cpay_fixture' }] as AppointmentPayment[] };
function database(rows: unknown[]) {
  return { select: vi.fn(() => ({ from: () => ({ where: async () => rows }) })) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
  mocks.legacy.mockReturnValue(report(500));
  mocks.fixture.mockReturnValue(report(12000, 12000));
  mocks.evidence.mockResolvedValue([{ application: { captureId: 'fixture' } }]);
});

afterEach(() => vi.unstubAllEnvs());

describe('mixed capture reporting dispatch', () => {
  it('partitions sources/markers exactly once and preserves held gross', async () => {
    const synthetic = { id: 'synthetic', tenderId: 'cpay_synthetic', source: 'synthetic_test' };
    const fixture = { id: 'fixture', tenderId: 'cpay_fixture', source: 'offline_fixture_test' };
    const result = await readCustomerPaymentCaptureReport(database([synthetic, fixture]), input);

    expect(mocks.legacy).toHaveBeenCalledWith(expect.objectContaining({ captures: [synthetic], markers: [input.markers[0]] }));
    expect(mocks.fixture).toHaveBeenCalledWith(expect.objectContaining({ captures: [fixture], markers: [input.markers[1]] }));
    expect(result).toMatchObject({ collectedCents: 12500, heldForReviewCents: 12000, captureCount: 2 });
  });

  it('does not read fixture evidence for synthetic or no-marker reports', async () => {
    await readCustomerPaymentCaptureReport(database([{ source: 'synthetic_test' }]), input);
    await readCustomerPaymentCaptureReport(database([]), { ...input, markers: [] });

    expect(mocks.evidence).not.toHaveBeenCalled();
    expect(mocks.fixture).not.toHaveBeenCalled();
  });

  it('does not hide binding-reader failure or overflow as zero fixture cash', async () => {
    mocks.evidence.mockRejectedValueOnce(new Error('binding missing'));

    await expect(readCustomerPaymentCaptureReport(database([{ source: 'offline_fixture_test' }]), input)).rejects.toThrow('binding missing');

    mocks.legacy.mockReturnValue(report(Number.MAX_SAFE_INTEGER));

    await expect(readCustomerPaymentCaptureReport(database([{ source: 'offline_fixture_test' }]), input)).rejects.toThrow('RECONCILE');
  });
});
