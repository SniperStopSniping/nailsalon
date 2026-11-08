'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';

import { formatPaymentMoney } from './types';

const cents = z.number().int().nonnegative().max(2147483647);
const quoteSchema = z.object({
  quoteId: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f\d]{64}$/i),
  expiresAt: z.string().datetime(),
  testOnly: z.literal(true),
  collectionEnabled: z.literal(false),
  executable: z.literal(false),
  currency: z.literal('CAD'),
  servicesCents: cents,
  discountCents: cents,
  taxCents: cents,
  tipCents: cents,
  customerFeeCents: cents,
  totalCents: cents,
  dueNowCents: cents,
  remainingCents: cents,
});
type Quote = z.infer<typeof quoteSchema>;

/** Existing private appointment capability only. No checkout, provider call or booking mutation. */
export function CustomerPaymentQuotePreview({ token }: { token: string }) {
  const id = useId();
  const [tipInput, setTipInput] = useState('0');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const request = useRef<{ requestId: string; tipCents: number } | null>(null);
  const generation = useRef(0);
  const locked = useRef(false);
  const mounted = useRef(true);
  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeController = useRef<AbortController | null>(null);
  const validTip = /^\d{1,6}(?:\.\d{0,2})?$/.test(tipInput) && Number(tipInput) <= 10000;
  const tipCents = validTip ? Math.round(Number(tipInput) * 100) : 0;

  useEffect(() => {
    mounted.current = true;
    generation.current++;
    return () => {
      mounted.current = false;
      activeController.current?.abort();
      if (activeTimer.current) {
        clearTimeout(activeTimer.current);
      }
    };
  }, []);
  useEffect(() => {
    if (!quote) {
      return;
    }
    const expire = () => {
      setQuote(null);
      request.current = null;
      setMessage('This test quote expired. Prepare a new quote to review current amounts.');
    };
    const timer = setTimeout(expire, Math.max(0, Date.parse(quote.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [quote]);

  function changeTip(value: string) {
    generation.current++;
    request.current = null;
    setQuote(null);
    setTipInput(value);
    setUncertain(false);
    setError('');
    setMessage('Tip changed. Prepare a new test quote to review updated amounts.');
  }

  async function prepare() {
    if (locked.current || busy || !validTip) {
      return;
    }
    locked.current = true;
    setBusy(true);
    setQuote(null);
    setError('');
    setMessage('');
    request.current ??= { requestId: crypto.randomUUID(), tipCents };
    const submitted = request.current;
    const revision = generation.current;
    const controller = new AbortController();
    activeController.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    activeTimer.current = timer;
    try {
      const response = await fetch(`/api/public/appointments/manage/${encodeURIComponent(token)}/payment-quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submitted),
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (!mounted.current || revision !== generation.current) {
        return;
      }
      if (response.status === 409 || response.status === 404 || response.status === 403 || response.status === 400) {
        request.current = null;
        setUncertain(false);
        setError(response.status === 409
          ? 'A current test quote is not available, or appointment details changed. Review your appointment and try preparing a new quote.'
          : 'This test preview is unavailable. Your booking and payment arrangements are unchanged.');
        return;
      }
      if (!response.ok) {
        throw new Error('Unconfirmed response');
      }
      const value = quoteSchema.parse((await response.json()).data);
      if (!mounted.current || revision !== generation.current) {
        return;
      }
      if (value.customerFeeCents !== 0 || value.tipCents !== submitted.tipCents || Date.parse(value.expiresAt) <= Date.now()
        || value.discountCents > value.servicesCents
        || value.totalCents !== value.servicesCents - value.discountCents + value.taxCents + value.tipCents + value.customerFeeCents
        || value.dueNowCents !== value.totalCents || value.remainingCents !== 0) {
        throw new Error('Invalid quote');
      }
      setQuote(value);
      setUncertain(false);
      setMessage('Test quote prepared. Review the amounts below. No payment can be made here.');
    } catch {
      if (mounted.current && revision === generation.current) {
        setUncertain(true);
        setError('The quote request was interrupted or could not be verified. Retry the same request safely. No payment was attempted.');
      }
    } finally {
      clearTimeout(timer);
      activeController.current = null;
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  return (
    <section id="customer-payment-preview" aria-labelledby={`${id}-heading`} aria-busy={busy} className="my-5 space-y-4 rounded-xl border bg-white p-4 text-gray-900">
      <h2 id={`${id}-heading`} className="text-xl font-semibold">Test payment quote preview</h2>
      <p>For this appointment only. This preview cannot collect money or confirm payment. Your booking, existing deposit requirements and in-person arrangements are unchanged.</p>
      <fieldset disabled={uncertain} className="space-y-2">
        <legend className="font-medium">Optional tip for this preview</legend>
        <button type="button" aria-pressed={tipInput === '0'} onClick={() => changeTip('0')} className="min-h-11 rounded-lg border px-4">No tip</button>
        <label htmlFor={`${id}-tip`} className="block">Custom tip (CAD)</label>
        <input id={`${id}-tip`} type="text" inputMode="decimal" value={tipInput} onChange={event => changeTip(event.target.value)} aria-invalid={!validTip} aria-describedby={`${id}-tip-help`} className="min-h-11 w-full rounded-lg border p-2" />
        <p id={`${id}-tip-help`} className="text-sm">No tip by default. Enter up to two decimal places. A preview tip is not added to your booking.</p>
      </fieldset>
      {!validTip && <p role="alert">Enter a tip from CAD 0 to CAD 10,000 with up to two decimal places.</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button type="button" disabled={busy || !validTip} onClick={() => void prepare()} className="min-h-11 rounded-lg bg-gray-900 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Preparing test quote…' : uncertain ? 'Retry same quote request' : quote ? 'Recheck test quote' : 'Prepare test quote'}</button>
      {quote && (
        <div className="space-y-3 rounded-lg bg-gray-50 p-4">
          <p className="font-semibold">{`Preview total: ${formatPaymentMoney(quote.totalCents)}`}</p>
          <details>
            <summary className="min-h-11 cursor-pointer py-2">Tax and fee explanation</summary>
            <dl className="space-y-2">
              <dt>Services · Salon</dt>
              <dd>{formatPaymentMoney(quote.servicesCents)}</dd>
              {quote.discountCents > 0 && (
                <>
                  <dt>Discount</dt>
                  <dd>{formatPaymentMoney(quote.discountCents)}</dd>
                </>
              )}
              <dt>Tax · Salon, for tax authority</dt>
              <dd>{formatPaymentMoney(quote.taxCents)}</dd>
              <dt>Customer payment fees</dt>
              <dd>{formatPaymentMoney(quote.customerFeeCents)}</dd>
              <dt>Preview tip · Salon team</dt>
              <dd>{formatPaymentMoney(quote.tipCents)}</dd>
            </dl>
            <p className="mt-3 text-sm">Amounts come from the saved appointment and server tax snapshot. Supported payment fees are salon-paid. Stripe processing costs are not added as an estimated customer charge.</p>
          </details>
          <p>Collection is disabled. This total is a test quote, not a request to pay.</p>
          <p className="text-sm">Quotes expire within five minutes. Recheck after appointment changes. Cancellation and refund terms remain those already agreed with your salon.</p>
        </div>
      )}
    </section>
  );
}
