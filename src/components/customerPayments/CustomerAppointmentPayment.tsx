'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { CustomerWorkspaceView } from '@/libs/customerPayments/customerWorkspaceView';
import { customerWorkspaceViewSchema } from '@/libs/customerPayments/customerWorkspaceView';

import { formatPaymentMoney as money } from './types';

type PaymentCommand = { kind: 'request_payment'; requestId: string; initializationId: string; expectedRevision: number; expectedInvoiceHash: string; acceptedPolicyRevision: number };
type Command = PaymentCommand | { kind: 'refresh' | 'resume'; operationId: string };

export function CustomerAppointmentPayment({ token }: { token: string }) {
  return <CustomerPaymentBody key={token} token={token} />;
}

function CustomerPaymentBody({ token }: { token: string }) {
  const id = useId();
  const [view, setView] = useState<CustomerWorkspaceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const pending = useRef<Command | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const submission = useRef<AbortController | null>(null);
  const endpoint = `/api/public/appointments/manage/${encodeURIComponent(token)}/payments`;
  const consentKey = view ? `${view.invoiceHash}:${view.policy.revision}` : '';
  const accepted = acceptedFor === consentKey;

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { cache: 'no-store', referrerPolicy: 'no-referrer', signal });
    if (response.status === 404) {
      return null;
    }
    const result = await response.json();
    if (!response.ok) {
      throw new Error('Payment details could not be loaded. Please contact your salon before paying.');
    }
    const data = customerWorkspaceViewSchema.parse(result.data);
    if (!signal?.aborted && mounted.current) {
      setView(data);
      setCheckoutUrl(null);
    }
    return data;
  }, [endpoint]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) {
        setError('Payment details could not be loaded. Please contact your salon before paying.');
      }
    });
    return () => {
      mounted.current = false;
      controller.abort();
      submission.current?.abort();
    };
  }, [load]);

  async function post(command: Command) {
    pending.current = command;
    const controller = new AbortController();
    submission.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response: Response;
    let result;
    try {
      response = await fetch(endpoint, { method: 'POST', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: controller.signal });
      result = await response.json();
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        pending.current = null;
      }
      throw new Error('The payment details changed or could not be confirmed. Check the payment before trying again.');
    }
    const data = customerWorkspaceViewSchema.parse(result.data);
    pending.current = null;
    if (mounted.current) {
      setView(data);
      const url = result.checkoutUrl ? new URL(result.checkoutUrl) : null;
      setCheckoutUrl(url?.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.port && !url.username && !url.password ? url.href : null);
    }
  }

  async function run(action: () => Promise<void>) {
    if (locked.current) {
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      if (mounted.current) {
        setCheckoutUrl(null);
        setError(failure instanceof Error ? failure.message : 'Your salon can help confirm this payment.');
      }
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  async function check() {
    if (pending.current) {
      await post(pending.current);
      return;
    }
    const current = await load();
    if (current?.activePayment) {
      await post({ kind: current.activePayment.canResume ? 'resume' : 'refresh', operationId: current.activePayment.id });
    }
  }

  if (!view && !error) {
    return null;
  }
  return (
    <section id="appointment-payment" className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-900" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-lg font-semibold">Appointment payment</h2>
      {view && (
        <>
          <dl className="my-5 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt>Appointment total</dt>
              <dd>{money(view.totalCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Already paid</dt>
              <dd>{money(view.paidCents)}</dd>
            </div>
            {view.depositCreditCents > 0 && (
              <div className="flex justify-between gap-3 text-xs text-stone-500">
                <dt>Deposit included above</dt>
                <dd>{money(view.depositCreditCents)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 font-semibold">
              <dt>Remaining balance</dt>
              <dd>{money(view.balanceCents)}</dd>
            </div>
            {view.overpaidCents > 0 && (
              <div className="flex justify-between gap-3">
                <dt>Overpayment to review</dt>
                <dd>{money(view.overpaidCents)}</dd>
              </div>
            )}
          </dl>
          {view.needsReview
            ? <p className="text-sm text-stone-600">Your salon needs to review the payment details. Contact them before paying again.</p>
            : view.activePayment
              ? <p className="text-sm text-stone-600">A payment request is already open. Check that request before paying.</p>
              : view.overpaidCents > 0
                ? <p className="text-sm text-stone-600">Your salon can review this overpayment and any refund.</p>
                : view.balanceCents === 0
                  ? <p className="text-sm text-stone-600">There is no remaining balance on this appointment.</p>
                  : <p className="text-sm text-stone-600">{view.canPay ? 'You can pay this balance securely online or pay at your appointment.' : 'Online payment is currently unavailable. Your salon can help with the remaining balance.'}</p>}
          {(view.canPay || view.activePayment) && view.policy.cancellationPolicy && (
            <div className="mt-5 space-y-3 text-sm">
              <h3 className="font-semibold">Cancellation and refund policy</h3>
              <p className="whitespace-pre-wrap break-words text-stone-600">{view.policy.cancellationPolicy}</p>
              <label className="flex min-h-11 items-start gap-3" htmlFor={`${id}-accept`}>
                <input id={`${id}-accept`} type="checkbox" checked={accepted} disabled={busy} onChange={event => setAcceptedFor(event.target.checked ? consentKey : null)} className="mt-1 size-4 shrink-0" />
                <span>I agree to this cancellation and refund policy.</span>
              </label>
            </div>
          )}
          {checkoutUrl && accepted && !view.needsReview
            ? <a href={checkoutUrl} rel="noreferrer" className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-stone-900 px-4 py-3 text-center font-medium text-white">Continue to secure payment</a>
            : view.canPay && !pending.current && (
              <button className="mt-4 min-h-12 w-full rounded-xl bg-stone-900 px-4 py-3 font-medium text-white disabled:opacity-50" type="button" disabled={busy || !accepted || !!error} onClick={() => void run(() => post({ kind: 'request_payment', requestId: crypto.randomUUID(), initializationId: crypto.randomUUID(), expectedRevision: view.revision, expectedInvoiceHash: view.invoiceHash, acceptedPolicyRevision: view.policy.revision }))}>
                {busy ? 'Preparing secure payment…' : `Pay ${money(view.balanceCents)} online`}
              </button>
            )}
        </>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
      {(error || view?.activePayment || pending.current) && <button type="button" disabled={busy} onClick={() => void run(check)} className="mt-4 min-h-11 w-full rounded-xl border border-stone-300 px-4 py-3 text-sm font-medium disabled:opacity-50">{busy ? 'Checking payment…' : 'Check payment'}</button>}
    </section>
  );
}
