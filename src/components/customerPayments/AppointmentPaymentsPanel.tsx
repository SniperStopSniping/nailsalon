'use client';

import { useId, useRef, useState } from 'react';

import type { AdjustmentBalance, adjustmentPermissions } from '@/libs/customerPayments/adjustments';

import { formatPaymentMoney } from './types';

export type AppointmentPaymentHistoryItem = {
  id: string;
  label: string;
  amountCents: number;
  status: 'paid' | 'pending' | 'failed' | 'refunded' | 'under_review';
};

type Action = 'edit' | 'request_payment' | 'record_payment' | 'request_refund' | 'review_refund' | 'refresh';
export type AppointmentPaymentsPanelProps = {
  appointmentId: string;
  clientName: string;
  balance: AdjustmentBalance;
  permissions: ReturnType<typeof adjustmentPermissions>;
  onlinePaymentsAvailable: boolean;
  history: readonly AppointmentPaymentHistoryItem[];
  /** Resolve only after a fresh server read; a click never asserts money moved. */
  onAction: (action: Action, input: { expectedRevision: number; reason?: string }) => Promise<void>;
};

const historyLabels = {
  paid: 'Paid',
  pending: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
  under_review: 'Needs review',
};

const holdMessages: Record<string, string> = {
  PAYMENT_UNDER_REVIEW: 'A payment needs review before another payment can be requested.',
  REFUND_UNDER_REVIEW: 'A refund needs review. The payment history is still available.',
  REFUND_PENDING: 'A refund is pending. It has not yet been deducted from the amount paid.',
  MULTIPLE_PAYMENT_REQUESTS: 'More than one payment request needs to be reconciled.',
  PAYMENT_REQUEST_ACTIVE: 'A payment request is already open. Its result must be checked before collecting again.',
  PAYMENT_REQUEST_STALE: 'The bill changed after a payment request was opened. That request must be resolved first.',
  PAYMENT_OUTCOME_UNKNOWN: 'The payment result is not confirmed yet. Please check its status before trying again.',
  PAYMENT_CONFIRMATION_PENDING: 'The payment request was completed, but its payment record still needs confirmation. Do not collect again yet.',
  COMPONENT_REALLOCATION_REQUIRED: 'The service balance and prepaid tip need separate review. A tip cannot automatically pay for another service.',
};

/** Shared appointment/receipt presentation. All permission and money facts are server-owned. */
export function AppointmentPaymentsPanel(props: AppointmentPaymentsPanelProps) {
  return <AppointmentPaymentsBody key={props.appointmentId} {...props} />;
}

function AppointmentPaymentsBody({ clientName, balance, permissions, onlinePaymentsAvailable, history, onAction }: AppointmentPaymentsPanelProps) {
  const id = useId();
  const lock = useRef(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundRevision, setRefundRevision] = useState<number | null>(null);
  const busy = pending !== null;
  const held = balance.blockedReasons.length > 0 || uncertain;
  const refundStale = refundOpen && refundRevision !== balance.revision;

  async function act(action: Action) {
    if (lock.current || !permissions.canView || (uncertain && action !== 'refresh')) {
      return;
    }
    if ((action === 'edit' && (!permissions.canAdjustBill || held))
      || (action === 'request_payment' && (!permissions.canRequestPayment || !onlinePaymentsAvailable || !balance.canReservePayment))
      || (action === 'record_payment' && (!permissions.canRecordPayment || !balance.canReservePayment))
      || (action === 'review_refund' && (!permissions.canIssueRefund || !balance.canReserveRefund || refundStale || !refundReason.trim()))
      || (action === 'request_refund' && (!permissions.canRequestRefund || !balance.canReserveRefund || refundStale || !refundReason.trim()))) {
      return;
    }
    lock.current = true;
    setPending(action);
    setError(null);
    try {
      await onAction(action, { expectedRevision: balance.revision, ...(action.includes('refund') ? { reason: refundReason.trim() } : {}) });
      if (action === 'refresh') {
        setUncertain(false);
      }
      if (action.includes('refund')) {
        setRefundOpen(false);
        setRefundReason('');
      }
    } catch {
      setUncertain(true);
      setError('The result could not be confirmed. Refresh the payment history before retrying. No additional payment or refund is confirmed by this message.');
    } finally {
      lock.current = false;
      setPending(null);
    }
  }

  if (!permissions.canView) {
    return <p>You do not have access to this appointment’s payments.</p>;
  }
  const buttonClass = 'min-h-11 rounded-xl border border-stone-300 px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy} className="space-y-5 rounded-2xl border border-stone-200 bg-white p-5 text-stone-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-xl font-semibold">Payments</h2>
          <p className="text-sm text-stone-600">{clientName}</p>
        </div>
        {permissions.canAdjustBill && <button type="button" className={buttonClass} disabled={busy || held} onClick={() => void act('edit')}>Edit services</button>}
      </div>
      <dl className="space-y-3 rounded-xl bg-stone-50 p-4">
        <div className="flex justify-between gap-3">
          <dt>Current total</dt>
          <dd>{formatPaymentMoney(balance.totalCents)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Payments received</dt>
          <dd>{formatPaymentMoney(balance.grossPaidCents)}</dd>
        </div>
        {balance.refundedCents > 0 && (
          <div className="flex justify-between gap-3">
            <dt>Refunded</dt>
            <dd>{formatPaymentMoney(balance.refundedCents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt>Net paid</dt>
          <dd>{formatPaymentMoney(balance.netPaidCents)}</dd>
        </div>
        {balance.underReviewPaymentCents > 0 && (
          <div className="flex justify-between gap-3">
            <dt>Payment amount under review</dt>
            <dd>{formatPaymentMoney(balance.underReviewPaymentCents)}</dd>
          </div>
        )}
        {balance.underReviewRefundCents > 0 && (
          <div className="flex justify-between gap-3">
            <dt>Refund amount under review</dt>
            <dd>{formatPaymentMoney(balance.underReviewRefundCents)}</dd>
          </div>
        )}
        {balance.pendingRefundCents > 0 && (
          <div className="flex justify-between gap-3">
            <dt>Refund pending</dt>
            <dd>{formatPaymentMoney(balance.pendingRefundCents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-stone-200 pt-3 text-lg font-semibold">
          <dt>Remaining balance</dt>
          <dd>{formatPaymentMoney(balance.balanceDueCents)}</dd>
        </div>
        {balance.overpaidCents > 0 && (
          <div className="flex justify-between gap-3 font-semibold">
            <dt>Overpayment to resolve</dt>
            <dd>{formatPaymentMoney(balance.overpaidCents)}</dd>
          </div>
        )}
      </dl>
      {held && <div role="status" className="space-y-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">{balance.blockedReasons.map(reason => <p key={reason}>{holdMessages[reason] ?? 'These payments need review before another financial action.'}</p>)}</div>}
      {held && !error && <button type="button" className={buttonClass} disabled={busy} onClick={() => void act('refresh')}>Check payment status</button>}
      {!onlinePaymentsAvailable && balance.balanceDueCents > 0 && <p className="text-sm text-stone-600">Online payment requests are unavailable. You can record money already received at the salon when the balance is ready.</p>}
      <div className="flex flex-col gap-2">
        {permissions.canRequestPayment && balance.balanceDueCents > 0 && <button type="button" className={`${buttonClass} bg-stone-900 text-white`} disabled={busy || uncertain || !onlinePaymentsAvailable || !balance.canReservePayment} onClick={() => void act('request_payment')}>{pending === 'request_payment' ? 'Preparing request…' : `Request ${formatPaymentMoney(balance.balanceDueCents)} payment`}</button>}
        {permissions.canRecordPayment && balance.balanceDueCents > 0 && <button type="button" className={buttonClass} disabled={busy || uncertain || !balance.canReservePayment} onClick={() => void act('record_payment')}>Record payment received</button>}
        {(permissions.canIssueRefund || permissions.canRequestRefund) && balance.overpaidCents > 0 && !refundOpen && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy || uncertain || !balance.canReserveRefund}
            onClick={() => {
              setRefundOpen(true);
              setRefundRevision(balance.revision);
              setError(null);
            }}
          >
            {permissions.canIssueRefund ? 'Review refund' : 'Request owner refund approval'}
          </button>
        )}
      </div>
      {refundOpen && (
        <div className="space-y-3 rounded-xl border border-stone-200 p-4">
          <h3 className="font-semibold">{permissions.canIssueRefund ? 'Review refund' : 'Request refund approval'}</h3>
          <p className="text-sm">
            {formatPaymentMoney(balance.overpaidCents)}
            {' '}
            is overpaid. The next step reviews the original payments and the exact refund allocation.
          </p>
          <label className="block text-sm font-medium" htmlFor={`${id}-reason`}>Reason for refund</label>
          <textarea id={`${id}-reason`} maxLength={500} rows={3} className="w-full rounded-lg border border-stone-300 p-3" value={refundReason} onChange={event => setRefundReason(event.target.value)} disabled={busy} />
          {refundStale && <p role="alert" className="text-sm text-red-800">The bill changed. Close this review and check the updated amounts.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={busy || uncertain || refundStale || !balance.canReserveRefund || !refundReason.trim()} onClick={() => void act(permissions.canIssueRefund ? 'review_refund' : 'request_refund')}>{busy ? 'Please wait…' : permissions.canIssueRefund ? 'Continue to refund details' : 'Send for owner approval'}</button>
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setRefundOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void act('refresh')}>Refresh payment history</button>
        </div>
      )}
      <div className="space-y-3">
        <h3 className="font-semibold">Payment history</h3>
        {history.length === 0
          ? <p className="text-sm text-stone-600">No payments recorded.</p>
          : (
              <ul className="divide-y divide-stone-100">
                {history.map(item => (
                  <li key={item.id} className="flex justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-stone-600">{historyLabels[item.status]}</p>
                    </div>
                    <span className="text-sm">{formatPaymentMoney(item.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
      </div>
    </section>
  );
}
