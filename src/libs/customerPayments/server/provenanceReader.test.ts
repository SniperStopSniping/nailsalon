import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppointmentPayment } from '@/models/Schema';

import { calculatePaymentSnapshot } from '../money';
import { customerPaymentTenderSummary, hasVerifiedCustomerPaymentTender } from '../provenance';
import { providerCorrelationFingerprint } from '../provider/correlation';
import { enrichCustomerPaymentProvenance } from './provenanceReader';

vi.mock('server-only', () => ({}));
const id = '00000000-0000-4000-8000-000000000001';
const row = { id: `cpay_${id}`, reference: `customer_payment_capture:${id}`, salonId: 's', appointmentId: 'a', amountCents: 12000, method: 'online', recordedByType: 'system', voidedAt: null } as AppointmentPayment;
const capture = { id, tenderId: row.id, salonId: 's', appointmentId: 'a', amountCents: 12000, principalCents: 10000, tipCents: 2000, applicationFeeCents: 100, quotedApplicationFeeCents: 100, currency: 'cad', stripeAccountId: 'acct_test', paymentIntentId: 'pi_test', state: 'posted', source: 'synthetic_test', mode: 'test' };
function reader(captures = [capture], refunds: unknown[] = []) {
  const where = vi.fn().mockResolvedValueOnce(captures).mockResolvedValueOnce(refunds);
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

    expect(database.select).toHaveBeenCalledTimes(2);
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

describe('refund evidence remains authoritative with writer disabled', () => {
  const receipt = { id: 'refund-row', refundId: 're_1', captureId: id, salonId: 's', appointmentId: 'a', stripeAccountId: 'acct_test', paymentIntentId: 'pi_test', currency: 'CAD', mode: 'test', source: 'synthetic_test', state: 'applied', amountCents: 1000, principalCents: 1000, tipCents: 0 };

  it.each(['applied', 'held_review'])('retains %s hold independently of write flag', async (state) => {
    enable();
    vi.stubEnv('CUSTOMER_PAYMENTS_REFUND_TEST_ENABLED', 'false');
    const result = await enrichCustomerPaymentProvenance(reader([capture], [{ ...receipt, state }]), [row]);

    expect(result[0]?.amountCents).toBe(12000);
    expect(customerPaymentTenderSummary(result[0]!)).toMatchObject({ collectionHold: true, netCents: state === 'applied' ? 11000 : 12000 });
  });

  it('never treats unavailable or foreign refund evidence as zero refunds', async () => {
    enable();
    for (const database of [
      { select: vi.fn().mockReturnValueOnce({ from: () => ({ where: async () => [capture] }) }).mockImplementationOnce(() => {
        throw new Error('missing refund schema');
      }) },
      reader([capture], [{ ...receipt, stripeAccountId: 'acct_foreign' }]),
      reader([capture], [{ ...receipt, captureId: 'missing' }]),
    ]) {
      const result = await enrichCustomerPaymentProvenance(database, [row]);

      expect(hasVerifiedCustomerPaymentTender(result[0]!)).toBe(false);
    }
  });
});

describe('offline fixture source binding reads', () => {
  function fixture() {
    const now = new Date('2026-11-08T10:00:00Z');
    const snapshot = calculatePaymentSnapshot({ currency: 'cad', servicesCents: 10000, discountCents: 0, taxCents: 0, tipCents: 2000, collection: 'full', feePolicy: { payer: 'salon', taxTreatment: 'not_collected_in_test_mode', refundPolicy: 'proportional', feeCents: 100 } });
    const quote = { id, salonId: 's', appointmentId: 'a', stripeAccountId: 'acct_test', mode: 'test', fingerprint: 'a'.repeat(64), snapshot, createdAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 1000) };
    const captured = { ...capture, source: 'offline_fixture_test', quoteId: id, fingerprint: 'b'.repeat(64), capturedAt: now, recordedAt: now, reviewReason: null };
    const application = { id, operationId: id, quoteId: id, captureId: id, tenderId: row.id, salonId: 's', appointmentId: 'a', platformId: 'acct_platform', accountId: 'acct_test', mode: 'test', source: 'offline_fixture_test', chargeId: 'ch_test', paymentIntentId: 'pi_test', candidateId: id, correlationId: id, sourceEvidence: { fixture: true }, ownershipEvidence: [{ operationId: id, fingerprint: 'd'.repeat(64) }], sourceRevision: providerCorrelationFingerprint({ fixture: true }), ownershipRevision: providerCorrelationFingerprint([{ operationId: id, fingerprint: 'd'.repeat(64) }]), platformRevision: 1, captureFingerprint: captured.fingerprint, quoteFingerprint: quote.fingerprint, successInboxId: id, successReceiptFingerprint: 'a'.repeat(64), successEventAt: now, currency: 'cad', amountCents: 12000, principalCents: 10000, tipCents: 2000, applicationFeeCents: 100, createdAt: now };
    return { quote, captured, application, tender: { ...row, recordedAt: now }, now };
  }

  it.each([false, true])('retains fixture gross with hold=%s and writer disabled', async (held) => {
    enable();
    vi.stubEnv('CUSTOMER_PAYMENTS_FIXTURE_APPLICATION_ENABLED', 'false');
    vi.stubEnv('CUSTOMER_PAYMENTS_PROVIDER_FIXTURE_ENABLED', 'false');
    const f = fixture();
    const where = vi.fn();
    for (const result of [[f.captured], [], [f.application], [f.quote], held ? [{ id, applicationId: id, platformId: 'acct_platform', platformRevision: 2, sourceTable: 'fixture', sourceId: id, reason: 'new_evidence', createdAt: f.now }] : [], [{ platformId: 'acct_platform', revision: held ? 2 : 1 }]]) {
      where.mockResolvedValueOnce(result);
    }
    const database = { select: vi.fn(() => ({ from: () => ({ where }) })) };
    const result = await enrichCustomerPaymentProvenance(database, [f.tender]);

    expect(customerPaymentTenderSummary(result[0]!)).toMatchObject({ netCents: 12000, collectionHold: held });
  });
});
