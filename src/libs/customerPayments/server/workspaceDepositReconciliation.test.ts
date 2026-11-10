import { describe, expect, it, vi } from 'vitest';

import { computeCheckoutTotals } from '@/libs/checkoutTotals';
import type { DepositCreditRow } from '@/libs/depositCredit';
import { resolveDepositCredit } from '@/libs/depositCredit';
import { buildBookingTaxSnapshot, buildForfeitureTaxSnapshot, resolveTaxConfig } from '@/libs/taxConfig';

import { netWorkspaceDepositCredit, resolveAdjustmentBalance } from '../adjustments';
import { paymentWorkspaceStateSchema } from './workspaceContract';
import { reconcileWorkspaceDepositFacts } from './workspaceDepositReconciliation';

vi.mock('server-only', () => ({}));

const scope = { salonId: 'salon', appointmentId: 'appointment' };
const now = new Date('2030-01-01T12:00:00Z');
const taxConfig = resolveTaxConfig({}, now);
function fixture() {
  const totals = computeCheckoutTotals({ items: [{ lineTotalCents: 10000, taxable: true }], taxConfig, tipCents: 1000 });
  const invoice = { currency: 'CAD' as const, items: [{ id: 'service', kind: 'service' as const, name: 'Manicure', quantity: 1, unitPriceCents: 10000, lineTotalCents: 10000 }], subtotalCents: 10000, discountCents: 0, tipCents: 1000, taxSnapshot: buildBookingTaxSnapshot({ taxConfig, totals, currency: 'CAD', capturedAt: now }) };
  const deposit: DepositCreditRow = { id: 'deposit', status: 'paid', amountCents: 2000, currency: 'cad', stripePaymentIntentId: 'pi_deposit', stripeRefundId: null, refundedAt: null, refundStatus: null, refundStatusChangedAt: null, refundAmountCents: null, refundRequestedAt: null, refundTrigger: null, refundLastErrorCode: null, refundFailureReason: null, externalRefundObservedCents: null, refundConflictFlag: false, refundTerminalFailureCount: 0, priorRefundIds: [], forfeitedAt: null, forfeitureTaxSnapshot: null, createdAt: now };
  const state = paymentWorkspaceStateSchema.parse({ revision: 3, bill: { ...scope, revision: 0, serviceCents: 10000, taxCents: 0, tipCents: 1000 }, billSourceHash: 'a'.repeat(64), legacyTenderHash: 'b'.repeat(64), invoice, payments: [{ ...scope, id: deposit.id, movementId: deposit.stripePaymentIntentId, kind: 'deposit', state: 'confirmed', principalCents: 2000, tipCents: 0 }, { ...scope, id: 'online', movementId: 'ch_online', kind: 'online', state: 'confirmed', principalCents: 8000, tipCents: 1000 }], refunds: [], requests: [], operations: [] });
  const material = (row = deposit) => {
    const credit = resolveDepositCredit({ deposits: [row], invoiceCurrency: 'CAD' });
    if (!credit.ok) {
      throw new Error(credit.code);
    }
    return { invoice, legacyTenderHash: 'b'.repeat(64), billSourceHash: 'c'.repeat(64), collectionHold: false, depositRows: [row], depositCredit: credit };
  };
  return { state, deposit, material };
}
function balance(state: ReturnType<typeof fixture>['state']) {
  return resolveAdjustmentBalance({ revision: state.revision, bill: state.bill, payments: state.payments, refunds: state.refunds, requests: state.requests });
}

describe('canonical deposit credit reconciliation', () => {
  it('removes forfeited credit once without claiming a refund, then retains a later actual full refund', () => {
    const f = fixture();
    const gross = structuredClone(f.state.payments);
    const forfeited = { ...f.deposit, forfeitedAt: now, forfeitureTaxSnapshot: buildForfeitureTaxSnapshot({ taxConfig, grossForfeitedCents: 2000, capturedAt: now, currency: 'CAD' }) };
    reconcileWorkspaceDepositFacts(f.state, f.material(forfeited), now.getTime());
    reconcileWorkspaceDepositFacts(f.state, f.material(forfeited), now.getTime() + 1);

    expect(balance(f.state)).toMatchObject({ netPaidCents: 9000, balanceDueCents: 2000, refundedCents: 0, creditRemovedCents: 2000 });
    expect(f.state.refunds).toHaveLength(1);
    expect(f.state.depositCreditHistory).toHaveLength(1);
    expect(netWorkspaceDepositCredit(f.state.payments, f.state.refunds)).toBe(0);

    const refunded = { ...forfeited, status: 'refunded', stripeRefundId: 're_deposit', refundStatus: 'succeeded', refundAmountCents: 2000, refundedAt: now, refundStatusChangedAt: now };
    reconcileWorkspaceDepositFacts(f.state, f.material(refunded), now.getTime() + 2);

    expect(balance(f.state)).toMatchObject({ netPaidCents: 9000, balanceDueCents: 2000, refundedCents: 2000, creditRemovedCents: 0 });
    expect(f.state.refunds).toHaveLength(1);
    expect(f.state.payments).toEqual(gross);
    expect(f.state.depositCreditHistory.map(item => item.disposition)).toEqual(['forfeited', 'refunded']);
    expect(() => reconcileWorkspaceDepositFacts(f.state, f.material(forfeited), now.getTime() + 3)).toThrow('DEPOSIT_IDENTITY_CHANGED');
  });

  it.each(['manual tender', 'invoice', 'hold', 'deposit amount', 'deposit identity', 'payment collision'] as const)('refuses changed %s instead of importing ambiguous money', (change) => {
    const f = fixture();
    const material = f.material();
    if (change === 'manual tender') {
      material.legacyTenderHash = 'd'.repeat(64);
    }
    if (change === 'invoice') {
      material.invoice = { ...material.invoice, items: [{ ...material.invoice.items[0]!, name: 'Changed service' }] };
    }
    if (change === 'hold') {
      material.collectionHold = true;
    }
    if (change === 'deposit amount') {
      material.depositRows = [{ ...f.deposit, amountCents: 3000 }];
    }
    if (change === 'deposit identity') {
      material.depositRows = [{ ...f.deposit, stripePaymentIntentId: 'pi_other' }];
    }
    if (change === 'payment collision') {
      f.state.payments[0]!.kind = 'manual';
    }

    expect(() => reconcileWorkspaceDepositFacts(f.state, material, now.getTime())).toThrow(/RECONCILIATION_REQUIRED|DEPOSIT_IDENTITY_CHANGED/);
  });
});
