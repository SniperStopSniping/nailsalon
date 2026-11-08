import { afterEach, describe, expect, it, vi } from 'vitest';

import { appointmentPaymentSchema, appointmentSchema } from '@/models/Schema';

import { readCustomerPaymentRefundReport } from './refundReportingReader';

vi.mock('server-only', () => ({}));

const input = { salonId: 'legacy-salon', currency: 'CAD' as const, start: new Date('2026-11-01'), end: new Date('2026-11-02') };

function database(markers: { id: string }[]) {
  const limit = vi.fn().mockResolvedValue(markers);
  const where = vi.fn(() => ({ limit }));
  const innerJoin = vi.fn((_table: unknown, _condition: unknown) => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));
  return { select, from, innerJoin, limit };
}

function enable(ledger: string) {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', 'development');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', ledger);
}

afterEach(() => vi.unstubAllEnvs());

describe('refund reporting legacy-table probe', () => {
  it.each(['true', 'false'])('reads only legacy tables without markers, ledger=%s', async (ledger) => {
    enable(ledger);
    const db = database([]);
    const result = await readCustomerPaymentRefundReport(db as unknown as Parameters<typeof readCustomerPaymentRefundReport>[0], input);

    expect(result).toMatchObject({ refundedCents: 0, feeRefundedCents: 0, heldForReviewCents: 0, captureMarkers: [] });
    expect(db.select).toHaveBeenCalledExactlyOnceWith({ id: appointmentPaymentSchema.id });
    expect(db.from).toHaveBeenCalledExactlyOnceWith(appointmentPaymentSchema);
    expect(db.innerJoin.mock.calls[0]?.[0]).toBe(appointmentSchema);
    expect(db.limit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('fails closed with a marker and ledger off, before any new-table query', async () => {
    enable('false');
    const db = database([{ id: 'cpay_fixture' }]);

    await expect(readCustomerPaymentRefundReport(db as unknown as Parameters<typeof readCustomerPaymentRefundReport>[0], input))
      .rejects.toThrow('CUSTOMER_PAYMENT_REPORTING_RECONCILIATION_REQUIRED');
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledExactlyOnceWith(appointmentPaymentSchema);
  });
});
