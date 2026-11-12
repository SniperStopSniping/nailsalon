import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCustomerPaymentCreditForReporting } from './creditResolutionReader';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./recordSyntheticCreditDecision', () => ({ readCurrentCustomerPaymentCreditResolution: mocks.read }));
const database = { select: vi.fn(), transaction: vi.fn() } as never;
const input = { salonId: 'salon', appointmentId: 'appointment', asOf: new Date('2026-11-08T12:00:00Z'), paymentRows: [{ id: 'cpay_fixture', reference: 'customer_payment_capture:fixture' }] };
const resolution = { state: 'resolved', collectibleBalanceCents: 0, ordinaryActionsBlocked: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'false');
  vi.stubEnv('CUSTOMER_PAYMENTS_CREDIT_REVIEW_TEST_ENABLED', 'false');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  mocks.read.mockResolvedValue({ resolution, decision: { createdAt: new Date('2026-11-08T11:00:00Z') } });
});

afterEach(() => vi.unstubAllEnvs());

describe('credit-aware debt reader boundary', () => {
  it('leaves ordinary legacy rows on the existing path without new reads', async () => {
    expect(await readCustomerPaymentCreditForReporting(database, { ...input, paymentRows: [{ id: 'manual', reference: null }] })).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each(['CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'NODE_ENV', 'APP_ENV', 'VERCEL_ENV'])('fails closed before new reads when %s disables the base ledger', async (key) => {
    vi.stubEnv(key, key.endsWith('ENABLED') ? 'false' : 'production');

    expect(await readCustomerPaymentCreditForReporting(database, input)).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('preserves a verified zero-obligation view with both write flags disabled', async () => {
    expect(await readCustomerPaymentCreditForReporting(database, input)).toEqual(resolution);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(database, { salonId: input.salonId, appointmentId: input.appointmentId });
  });

  it('refuses missing, future, stale, or unsafe projections and read failures', async () => {
    for (const preview of [
      { resolution: null },
      { resolution, decision: { createdAt: new Date('2026-11-08T13:00:00Z') } },
      { resolution: { ...resolution, collectibleBalanceCents: 1 }, decision: { createdAt: new Date(0) } },
      { resolution: { ...resolution, ordinaryActionsBlocked: false }, decision: { createdAt: new Date(0) } },
    ]) {
      mocks.read.mockResolvedValueOnce(preview);

      expect(await readCustomerPaymentCreditForReporting(database, input)).toBeNull();
    }
    mocks.read.mockRejectedValueOnce(new Error('missing schema'));

    expect(await readCustomerPaymentCreditForReporting(database, input)).toBeNull();
  });
});
