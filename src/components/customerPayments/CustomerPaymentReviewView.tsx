'use client';

import { useId } from 'react';

import { formatMoney } from '@/libs/formatMoney';

/** Presentation only. The authenticated server must derive and validate every amount. */
export type CustomerPaymentReviewDisplay = {
  evidenceRevision: string;
  currency: 'CAD';
  originalInvoiceCents: number;
  originalTaxCents: number;
  originalTipCents: number;
  creditNoteCents: number;
  customerRefundedCents: number;
  retainedCashCents: number;
  adjustedBalanceCents: number;
  allocations: readonly { refundId: string; principalCents: number; tipCents: number }[];
};

export type CustomerPaymentReviewViewProps = {
  preview: CustomerPaymentReviewDisplay;
  reason: string;
  acknowledged: boolean;
  busy?: boolean;
  uncertain?: boolean;
  recorded?: boolean;
  resolved?: boolean;
  proposalValid?: boolean;
  error?: string;
  onReasonChange: (reason: string) => void;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CustomerPaymentReviewView({ preview, reason, acknowledged, busy = false, uncertain = false, recorded = false, resolved = false, proposalValid = true, error, onReasonChange, onAcknowledgedChange, onConfirm, onCancel }: CustomerPaymentReviewViewProps) {
  const id = useId();
  const frozen = busy || uncertain || recorded;
  const amounts = [preview.originalInvoiceCents, preview.originalTaxCents, preview.originalTipCents, preview.creditNoteCents, preview.customerRefundedCents, preview.retainedCashCents, preview.adjustedBalanceCents];
  const valid = (resolved || proposalValid) && amounts.every(value => Number.isSafeInteger(value) && value >= 0)
    && preview.adjustedBalanceCents === 0
    && preview.creditNoteCents + preview.retainedCashCents === preview.originalInvoiceCents
    && preview.allocations.length > 0;
  const money = (value: number) => formatMoney(value, preview.currency);
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-2xl border border-amber-300 bg-white p-4 text-stone-900">
      <h2 id={`${id}-title`} className="text-lg font-semibold">Test-only payment review</h2>
      <p>No money will be returned. This records a test credit note against a completed invoice and reviews existing synthetic refund evidence.</p>
      <p>The original invoice, tax and tip stay unchanged. A credit note reduces the obligation; it is not another refund, profit or payout.</p>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>Original invoice total</dt>
        <dd>{money(preview.originalInvoiceCents)}</dd>
        <dt>Original tax (included in total)</dt>
        <dd>{money(preview.originalTaxCents)}</dd>
        <dt>Original tip (included in total)</dt>
        <dd>{money(preview.originalTipCents)}</dd>
        {valid && (
          <>
            <dt>{resolved ? 'Recorded credit-note adjustment' : 'Proposed credit-note adjustment'}</dt>
            <dd>{money(preview.creditNoteCents)}</dd>
            <dt>{resolved ? 'Adjusted obligation' : 'Proposed adjusted obligation'}</dt>
            <dd>{money(preview.originalInvoiceCents - preview.creditNoteCents)}</dd>
          </>
        )}
        <dt>Successful customer refunds already recorded</dt>
        <dd>{money(preview.customerRefundedCents)}</dd>
        <dt>Retained customer cash</dt>
        <dd>{money(preview.retainedCashCents)}</dd>
        {valid && (
          <>
            <dt>{resolved ? 'Verified adjusted balance' : 'Proposed adjusted balance'}</dt>
            <dd>{money(preview.adjustedBalanceCents)}</dd>
          </>
        )}
      </dl>
      <h3 className="font-semibold">Refund allocations being reviewed</h3>
      <ul className="space-y-2 text-sm">
        {preview.allocations.map(row => (
          <li key={row.refundId} className="break-words">
            {row.refundId}
            : principal
            {' '}
            {money(row.principalCents)}
            , tip
            {' '}
            {money(row.tipCents)}
          </li>
        ))}
      </ul>
      <p className="text-sm">Further money changes require another review. This does not enable online checkout or edit the original invoice.</p>
      {!resolved && <p role="status">Needs review. Proposed amounts are not a recorded credit or verified resolution.</p>}
      {!valid && <p role="alert">Enter valid allocations before reviewing a proposed credit. This evidence cannot be recorded yet.</p>}
      {error && <p role="alert">{error}</p>}
      {uncertain && <p role="status">The save outcome is unknown. Retry the same review without changing its reason or allocations.</p>}
      {recorded && (
        <p role="status">
          {resolved ? 'Current test resolution verified. Ordinary actions remain blocked.' : 'Test review recorded. Reload current evidence to verify its resolution.'}
          {' '}
          No money was returned by this action.
        </p>
      )}
      <label className="block" htmlFor={`${id}-reason`}>Reason for this test credit note</label>
      <textarea id={`${id}-reason`} value={reason} maxLength={1000} disabled={frozen} onChange={event => onReasonChange(event.target.value)} className="w-full rounded border p-2" />
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={acknowledged} disabled={frozen} onChange={event => onAcknowledgedChange(event.target.checked)} />
        <span>I reviewed these refund allocations and the credit adjustment. No money will be returned.</span>
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy || recorded || !valid || !reason.trim() || !acknowledged} onClick={onConfirm} className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-50">
          {busy ? 'Recording test review…' : uncertain ? 'Retry same test review' : 'Record test credit note and review'}
        </button>
        <button type="button" disabled={busy || uncertain} onClick={onCancel} className="rounded border px-4 py-2">Close review</button>
      </div>
    </section>
  );
}
