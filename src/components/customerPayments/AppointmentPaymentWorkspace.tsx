'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { PaymentWorkspaceView } from '@/libs/customerPayments/workspaceView';

import { formatPaymentMoney as money } from './types';

type Command = { kind: string; requestId: string; expectedRevision: number; operationId?: string; paymentId?: string; principalCents?: number; tipCents?: number; reason?: string };
const active = new Set(['awaiting_approval', 'prepared', 'dispatching', 'open', 'pending', 'uncertain', 'review']);
const button = 'min-h-11 rounded-xl border border-stone-300 px-4 py-3 text-sm font-semibold disabled:opacity-50';
const labels: Record<string, string> = { awaiting_approval: 'Waiting for owner approval', prepared: 'Ready to submit', dispatching: 'Confirming submission', open: 'Payment link open', pending: 'Processing', uncertain: 'Checking result', review: 'Needs review', succeeded: 'Confirmed', failed: 'Failed', canceled: 'Closed' };

/** Only persisted invoice balances can create a provider request. */
export function AppointmentPaymentWorkspace(props: { appointmentId: string; salonSlug?: string | null; hasWorkspace?: boolean; hasUnsavedInvoice: boolean; refreshKey: string; onChanged: () => Promise<void>; onBusyChange: (busy: boolean) => void; onHoldChange?: (held: boolean) => void }) {
  return <WorkspaceBody key={props.appointmentId} {...props} />;
}

function WorkspaceBody({ appointmentId, salonSlug, hasWorkspace, hasUnsavedInvoice, refreshKey, onChanged, onBusyChange, onHoldChange }: Parameters<typeof AppointmentPaymentWorkspace>[0]) {
  const id = useId();
  const [view, setView] = useState<PaymentWorkspaceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refundPayment, setRefundPayment] = useState('');
  const [reason, setReason] = useState('');
  const [refundRevision, setRefundRevision] = useState<number | null>(null);
  const pending = useRef<Command | null>(null);
  const lock = useRef(false);
  const endpoint = `/api/appointments/${encodeURIComponent(appointmentId)}/payment-workspace${salonSlug ? `?salonSlug=${encodeURIComponent(salonSlug)}` : ''}`;

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const held = !!pending.current || ((!!hasWorkspace || view?.initialized === true) && (!view || !!error))
    || (!!view && (view.sourceChanged || view.balance.blockedReasons.length > 0 || view.operations.some(operation => active.has(operation.state))));
  useEffect(() => {
    onHoldChange?.(held);
    return () => onHoldChange?.(false);
  }, [held, onHoldChange]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { cache: 'no-store', signal });
    const result = await response.json();
    if (!response.ok || !result.data) {
      throw new Error('Payment history is unavailable. Refresh before collecting a payment.');
    }
    if (!signal?.aborted) {
      setView(result.data);
    }
    return result.data as PaymentWorkspaceView;
  }, [endpoint]);

  useEffect(() => {
    const abort = new AbortController();
    setCheckoutUrl(null);
    void load(abort.signal).catch(() => {
      if (!abort.signal.aborted) {
        setError('Payment history is unavailable. Refresh before collecting a payment.');
      }
    });
    return () => abort.abort();
  }, [load, refreshKey]);

  async function post(command: Command) {
    pending.current = command;
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    const result = await response.json();
    if (!response.ok || !result.data) {
      if (response.status >= 400 && response.status < 500) {
        pending.current = null;
      }
      throw new Error(result.error?.message ?? 'The payment result could not be confirmed.');
    }
    pending.current = null;
    setView(result.data);
    const url = result.checkoutUrl ? new URL(result.checkoutUrl) : null;
    setCheckoutUrl(url?.protocol === 'https:' && url.hostname === 'checkout.stripe.com' ? url.href : null);
    setCopied(false);
    return result.data as PaymentWorkspaceView;
  }

  async function run(action: () => Promise<void>) {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      await onChanged();
    } catch (failure) {
      setCheckoutUrl(null);
      setError(failure instanceof Error ? failure.message : 'The payment result could not be confirmed.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function command(kind: string, fields: Partial<Command> = {}) {
    if (!view || pending.current || hasUnsavedInvoice) {
      return;
    }
    let current = view;
    if (!current.initialized) {
      current = await post({ kind: 'initialize', requestId: crypto.randomUUID(), expectedRevision: 0 });
    }
    await post({ ...fields, kind, requestId: crypto.randomUUID(), expectedRevision: current.balance.revision });
  }

  async function refresh() {
    const current = await load();
    // A lost response reuses its durable command identity. It never creates a
    // fresh collection/refund while the first command is still unresolved.
    if (pending.current) {
      await post(pending.current);
      return;
    }
    for (const operation of current.operations.filter(operation => active.has(operation.state) && operation.state !== 'awaiting_approval')) {
      await post({ kind: 'refresh', requestId: crypto.randomUUID(), expectedRevision: current.balance.revision, operationId: operation.id });
    }
  }

  const blocked = busy || !!pending.current || !!error || hasUnsavedInvoice;
  const refund = view?.balance.refundable.find(payment => payment.paymentId === refundPayment && payment.kind === 'online');
  const principalCents = Math.min(refund?.principalCents ?? 0, view?.balance.principalOverpaidCents ?? 0);
  const tipCents = Math.min(refund?.tipCents ?? 0, view?.balance.tipOverpaidCents ?? 0);
  const refundStale = refundRevision !== view?.balance.revision;

  return (
    <details className="mb-4 rounded-2xl border border-stone-200 bg-white p-4 text-stone-900" data-testid="appointment-payment-workspace">
      <summary className="min-h-11 cursor-pointer text-base font-semibold">
        Payments
        {view ? ` · ${money(view.balance.balanceDueCents)} remaining` : ''}
      </summary>
      <div aria-busy={busy} className="space-y-4 pt-3">
        {!view && !error && <p role="status">Loading payment history…</p>}
        {view && (
          <>
            <p className="text-sm text-stone-600">This is the saved bill. Deposits already paid are credited once. Changing services does not automatically charge or refund a customer.</p>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt>Saved total</dt>
                <dd>{money(view.balance.totalCents)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Net paid</dt>
                <dd>{money(view.balance.netPaidCents)}</dd>
              </div>
              <div className="flex justify-between gap-3 font-semibold">
                <dt>Remaining balance</dt>
                <dd>{money(view.balance.balanceDueCents)}</dd>
              </div>
              {view.balance.overpaidCents > 0 && (
                <div className="flex justify-between gap-3">
                  <dt>Overpayment to resolve</dt>
                  <dd>{money(view.balance.overpaidCents)}</dd>
                </div>
              )}
            </dl>
            {hasUnsavedInvoice && <p role="status" className="text-sm text-amber-900">Finish saving the services in checkout before requesting another payment or refund.</p>}
            {view.sourceChanged && <p role="status" className="text-sm text-amber-900">The saved invoice changed. These payments need review before collecting again.</p>}
            {view.permissions.canRequestPayment && view.balance.balanceDueCents > 0 && (
              <button type="button" className={button} disabled={blocked || !view.onlinePaymentsAvailable || !view.balance.canReservePayment} onClick={() => void run(() => command('request_payment'))}>
                {`Create ${money(view.balance.balanceDueCents)} payment link`}
              </button>
            )}
            {!view.onlinePaymentsAvailable && view.balance.balanceDueCents > 0 && <p className="text-sm text-stone-600">Online payments are unavailable. Use checkout to record money already received at the salon.</p>}
            {checkoutUrl && (
              <div className="space-y-2 rounded-xl bg-stone-50 p-3">
                <p className="text-sm">The link is ready. Payment is confirmed only after Stripe reports the result.</p>
                <a className={`${button} inline-flex`} href={checkoutUrl} target="_blank" rel="noopener noreferrer">Open secure payment page</a>
                <button type="button" className={button} onClick={() => void navigator.clipboard.writeText(checkoutUrl).then(() => setCopied(true)).catch(() => setError('The link could not be copied. Use Open secure payment page.'))}>{copied ? 'Link copied' : 'Copy payment link'}</button>
              </div>
            )}
            {view.balance.canReserveRefund && view.permissions.canRequestRefund && (
              <div className="space-y-3 rounded-xl border border-stone-200 p-3">
                <label className="block text-sm font-semibold" htmlFor={`${id}-refund`}>Refund to the original online payment</label>
                <select
                  id={`${id}-refund`}
                  value={refundPayment}
                  disabled={blocked}
                  onChange={(event) => {
                    setRefundPayment(event.target.value);
                    setRefundRevision(view.balance.revision);
                  }}
                  className="min-h-11 w-full rounded-lg border p-2"
                >
                  <option value="">Choose a payment</option>
                  {view.balance.refundable.filter(payment => payment.kind === 'online' && payment.principalCents + payment.tipCents > 0).map((payment, index) => (
                    <option key={payment.paymentId} value={payment.paymentId}>
                      {`Online payment ${index + 1} · ${money(payment.principalCents + payment.tipCents)} available`}
                    </option>
                  ))}
                </select>
                <label className="block text-sm" htmlFor={`${id}-reason`}>Reason for refund</label>
                <textarea id={`${id}-reason`} value={reason} maxLength={500} disabled={blocked} onChange={event => setReason(event.target.value)} className="w-full rounded-lg border p-2" />
                {refund && (
                  <p className="text-sm">
                    {`Refund ${money(principalCents)} for services${tipCents > 0 ? ` and ${money(tipCents)} in tips` : ''}. `}
                    {view.permissions.canIssueRefund ? 'Confirming submits this refund to Stripe.' : 'The owner must approve before money is refunded.'}
                  </p>
                )}
                {refund && refundStale && <p role="alert" className="text-sm text-amber-900">The balance changed. Choose the payment again to review the new amount.</p>}
                <button
                  type="button"
                  className={button}
                  disabled={blocked || refundStale || !refund || !reason.trim() || principalCents + tipCents === 0}
                  onClick={() => void run(async () => {
                    await command('request_refund', { paymentId: refundPayment, principalCents, tipCents, reason: reason.trim() });
                    setRefundPayment('');
                    setReason('');
                  })}
                >
                  {view.permissions.canIssueRefund ? `Confirm ${money(principalCents + tipCents)} refund` : 'Request owner refund approval'}
                </button>
              </div>
            )}
            <div className="space-y-2">
              <h3 className="font-semibold">Payment history</h3>
              {view.payments.length === 0 && view.operations.length === 0 && <p className="text-sm text-stone-600">No payments recorded.</p>}
              {view.payments.filter(payment => payment.kind !== 'online').map(payment => (
                <p key={payment.id} className="text-sm">
                  {payment.voided ? 'Payment record voided' : payment.kind === 'deposit' ? 'Deposit credited' : 'Payment recorded at salon'}
                  {' '}
                  ·
                  {' '}
                  {money(payment.amountCents)}
                </p>
              ))}
              {view.operations.map(operation => (
                <div key={operation.id} className="space-y-2 border-t py-3 text-sm">
                  <p>
                    {operation.kind === 'refund' ? 'Refund' : 'Online payment'}
                    {' '}
                    ·
                    {' '}
                    {money(operation.principalCents + operation.tipCents)}
                    {' '}
                    ·
                    {' '}
                    {labels[operation.state] ?? 'Needs review'}
                  </p>
                  {operation.reason && <p>{operation.reason}</p>}
                  {operation.kind === 'payment' && active.has(operation.state) && (
                    <button
                      type="button"
                      className={button}
                      disabled={busy || !!pending.current}
                      onClick={() => void run(async () => {
                        await post({ kind: 'cancel_request', requestId: crypto.randomUUID(), expectedRevision: view.balance.revision, operationId: operation.id });
                      })}
                    >
                      Close payment request
                    </button>
                  )}
                  {operation.state === 'awaiting_approval' && view.permissions.canIssueRefund && (
                    <div className="space-y-2">
                      <button type="button" className={button} disabled={blocked} onClick={() => void run(() => command('approve_refund', { operationId: operation.id }))}>
                        {`Approve ${money(operation.principalCents + operation.tipCents)} refund`}
                      </button>
                      <button type="button" className={button} disabled={blocked} onClick={() => void run(() => command('reject_refund', { operationId: operation.id, reason: 'Owner declined the refund request' }))}>Decline refund</button>
                    </div>
                  )}
                  {['prepared', 'uncertain'].includes(operation.state) && (operation.kind === 'payment' || view.permissions.canIssueRefund) && <button type="button" className={button} disabled={blocked} onClick={() => void run(() => command('dispatch', { operationId: operation.id }))}>Retry saved request</button>}
                </div>
              ))}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-800">
            {error}
            {' '}
            No additional payment or refund is confirmed by this message.
          </p>
        )}
        <button type="button" className={button} disabled={busy} onClick={() => void run(refresh)}>{busy ? 'Checking…' : pending.current ? 'Check saved request' : 'Refresh payment status'}</button>
      </div>
    </details>
  );
}
