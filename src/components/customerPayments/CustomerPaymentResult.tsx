'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { PaymentReturnView } from '@/libs/customerPayments/paymentReturnView';
import { paymentReturnViewSchema } from '@/libs/customerPayments/paymentReturnView';

const money = (cents: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);

export default function CustomerPaymentResult() {
  const [view, setView] = useState<PaymentReturnView | null>(null);
  const [busy, setBusy] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const token = useRef('');
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const generation = useRef(0);

  const refresh = useCallback(async function checkStatus() {
    if (inFlight.current || !token.current) {
      return;
    }
    inFlight.current = true;
    const requestGeneration = generation.current;
    setBusy(true);
    setUnavailable(false);
    const requestController = new AbortController();
    controller.current = requestController;
    const timeout = setTimeout(() => requestController.abort(), 12_000);
    try {
      const response = await fetch('/api/public/payments/status', {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.current }),
        signal: requestController.signal,
      });
      if (requestGeneration !== generation.current) {
        return;
      }
      if (!response.ok) {
        setInvalid(response.status === 404);
        throw new Error('Status unavailable');
      }
      const data = paymentReturnViewSchema.parse((await response.json()).data);
      if (requestGeneration !== generation.current) {
        return;
      }
      setView(data);
      attempts.current += 1;
      if (data.status === 'pending' && attempts.current < 6) {
        timer.current = setTimeout(() => void checkStatus(), 5000);
      }
    } catch {
      // A network error cannot replace a verified receipt with a failure claim.
      if (requestGeneration === generation.current) {
        setUnavailable(true);
      }
    } finally {
      clearTimeout(timeout);
      if (requestGeneration === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    token.current = fragment.get('status') ?? '';
    if (!token.current || token.current.length > 2048) {
      setInvalid(true);
      setBusy(false);
    } else {
      void refresh();
    }
    return () => {
      generation.current += 1;
      controller.current?.abort();
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [refresh]);

  const title = view?.status === 'received'
    ? 'Payment received'
    : view?.status === 'closed'
      ? 'Payment request closed'
      : view?.status === 'review'
        ? 'Payment needs review'
        : invalid ? 'Payment status unavailable' : 'Checking your payment';
  const description = view?.status === 'received'
    ? 'Your payment has been confirmed. Your salon can see it on your appointment.'
    : view?.status === 'closed'
      ? 'This payment request is no longer open. Contact your salon if you still need to pay.'
      : view?.status === 'review'
        ? 'Your salon needs to check this payment. Please contact them before paying again.'
        : invalid
          ? 'This status link is missing or has expired. Your salon can confirm your payment.'
          : 'We are waiting for confirmation. Please do not pay again while your payment is being checked.';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-4 py-12 text-stone-900">
      <section className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="payment-result-title">
        <p className="mb-8 text-sm font-semibold uppercase tracking-widest text-stone-500">Luster</p>
        <div role="status" aria-live="polite">
          <h1 id="payment-result-title" className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-3 text-base leading-relaxed text-stone-600">{description}</p>
          {view && (
            <dl className="mt-6 space-y-3 border-y border-stone-200 py-5">
              <div className="flex items-center justify-between gap-4">
                <dt>{view.status === 'received' ? 'Payment amount' : 'Requested amount'}</dt>
                <dd className="font-semibold">{`${money(view.amountCents)} CAD`}</dd>
              </div>
              {view.refundedCents > 0 && (
                <div className="flex items-center justify-between gap-4">
                  <dt>Refund confirmed</dt>
                  <dd className="font-semibold">{`${money(view.refundedCents)} CAD`}</dd>
                </div>
              )}
            </dl>
          )}
          {unavailable && !invalid && <p className="mt-5 text-sm text-stone-600">We could not refresh the status. Try again or contact your salon.</p>}
        </div>
        {!invalid && view?.status !== 'closed' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (timer.current) {
                clearTimeout(timer.current);
              }
              attempts.current = 0;
              void refresh();
            }}
            className="mt-6 min-h-12 w-full rounded-xl bg-stone-900 px-4 py-3 font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Refresh payment status'}
          </button>
        )}
        {view?.status === 'received' && <p className="mt-5 text-sm text-stone-500">You can close this page.</p>}
      </section>
    </main>
  );
}
