import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppointmentPayment } from '@/models/Schema';

import { hasVerifiedCustomerPaymentTender } from '../provenance';
import { enrichCustomerPaymentProvenance } from './provenanceReader';

vi.mock('server-only', () => ({}));
const id = '00000000-0000-4000-8000-000000000001';
const row = { id: `cpay_${id}`, reference: `customer_payment_capture:${id}`, salonId: 's', appointmentId: 'a', amountCents: 12000, method: 'online', recordedByType: 'system', voidedAt: null } as AppointmentPayment;
const capture = { id, tenderId: row.id, salonId: 's', appointmentId: 'a', amountCents: 12000, principalCents: 10000, tipCents: 2000, applicationFeeCents: 100, quotedApplicationFeeCents: 100, currency: 'cad', state: 'posted', source: 'synthetic_test', mode: 'test' };
function reader(captures = [capture]) {
  const where = vi.fn(async () => captures);
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where })) }));
  return { select };
}
function enable() {
  vi.stubEnv('CUSTOMER_PAYMENTS_PREPARATION_ENABLED', 'true');
  vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'true');
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('APP_ENV', '');
  vi.stubEnv('VERCEL_ENV', '');
}

afterEach(() => vi.unstubAllEnvs());

describe('conditional immutable capture provenance reads', () => {
  it('never reads new tables for ordinary rows or disabled marker rows', async () => {
    const database = reader();
    enable();
    await enrichCustomerPaymentProvenance(database, [{ ...row, id: 'ordinary', reference: null }]);

    expect(database.select).not.toHaveBeenCalled();

    vi.stubEnv('CUSTOMER_PAYMENTS_LEDGER_TEST_ENABLED', 'false');
    const result = await enrichCustomerPaymentProvenance(database, [row]);

    expect(database.select).not.toHaveBeenCalled();
    expect(hasVerifiedCustomerPaymentTender(result[0]!)).toBe(false);
  });

  it('enriches an exact posted test capture and pins row identity', async () => {
    enable();
    const database = reader();
    const result = await enrichCustomerPaymentProvenance(database, [row]);

    expect(database.select).toHaveBeenCalledOnce();
    expect(hasVerifiedCustomerPaymentTender(result[0]!)).toBe(true);
  });

  it.each([{ state: 'held_review' }, { source: 'stripe_live' }, { salonId: 'foreign' }, { principalCents: 1 }, { applicationFeeCents: 99 }])('holds inconsistent capture %j', async (patch) => {
    enable();
    const result = await enrichCustomerPaymentProvenance(reader([{ ...capture, ...patch }]), [row]);

    expect(hasVerifiedCustomerPaymentTender(result[0]!)).toBe(false);
  });

  it('holds missing/duplicate/unreadable capture evidence', async () => {
    enable();
    for (const database of [reader([]), reader([capture, capture]), { select: vi.fn(() => {
      throw new Error('unavailable');
    }) }]) {
      const result = await enrichCustomerPaymentProvenance(database, [row]);

      expect(hasVerifiedCustomerPaymentTender(result[0]!)).toBe(false);
    }
  });
});
