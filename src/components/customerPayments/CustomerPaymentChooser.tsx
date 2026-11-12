'use client';

import { useId, useRef, useState } from 'react';

import type { CustomerPaymentChoice, CustomerPaymentPolicy, CustomerPaymentQuote } from './types';
import { formatPaymentMoney } from './types';

export type CustomerPaymentChooserProps = {
  onlineEnabled?: boolean;
  policy?: CustomerPaymentPolicy;
  choice: CustomerPaymentChoice;
  tipCents: number;
  quote: CustomerPaymentQuote | null;
  cancellationPolicy: string;
  loading?: boolean;
  error?: string | null;
  onChoiceChange: (choice: CustomerPaymentChoice) => void;
  onTipChange: (cents: number) => void;
  onContinue: () => Promise<void> | void;
  onBack: () => void;
};

/** Test-only, controlled presentation. The caller must obtain/validate a server quote. */
export function CustomerPaymentChooser({
  onlineEnabled = false,
  policy = 'optional_full',
  choice,
  tipCents,
  quote,
  cancellationPolicy,
  loading = false,
  error,
  onChoiceChange,
  onTipChange,
  onContinue,
  onBack,
}: CustomerPaymentChooserProps) {
  const id = useId();
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const busy = loading || pending;
  const requiresOnline = policy !== 'optional_full';
  const validChoice = choice === 'online' ? onlineEnabled : !requiresOnline;
  const validQuote = quote && quote.choice === choice && quote.tipCents === tipCents
    && quote.lines.every(line => Number.isSafeInteger(line.amountCents) && line.amountCents >= 0)
    && [quote.totalCents, quote.dueNowCents, quote.remainingCents].every(amount => Number.isSafeInteger(amount) && amount >= 0)
    && quote.lines.reduce((total, line) => total + line.amountCents, 0) === quote.totalCents
    && quote.dueNowCents + quote.remainingCents === quote.totalCents
    && (choice !== 'in_person' || quote.dueNowCents === 0);

  async function proceed() {
    if (locked.current || busy || !validChoice || !validQuote) {
      return;
    }
    locked.current = true;
    setPending(true);
    setSubmitError(null);
    try {
      await onContinue();
    } catch {
      setSubmitError('We could not continue. Please try again. You have not received a payment confirmation.');
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} aria-busy={busy} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 text-gray-900">
      <p className="text-sm font-semibold text-amber-800">Test mode · No live payments</p>
      <h2 id={`${id}-heading`} className="text-xl font-semibold">How would you like to pay?</h2>
      {requiresOnline && <p>{policy === 'required_deposit' ? 'An online deposit is required to secure this booking.' : 'Full online payment is required to secure this booking.'}</p>}
      {!onlineEnabled && <p>Online payments are not enabled for this salon.</p>}
      <fieldset disabled={busy} className="space-y-3">
        <legend className="font-medium">Payment choice</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name={`${id}-payment`} value="online" checked={choice === 'online'} disabled={!onlineEnabled} onChange={() => onChoiceChange('online')} />
          Pay online
        </label>
        <p className="text-sm text-gray-600">Card payments are handled securely by Stripe. Apple Pay appears in Stripe checkout only on supported devices and browsers.</p>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name={`${id}-payment`} value="in_person" checked={choice === 'in_person'} disabled={requiresOnline} onChange={() => onChoiceChange('in_person')} />
          Pay in person
        </label>
      </fieldset>
      <fieldset disabled={busy} className="space-y-2">
        <legend className="font-medium">Optional tip</legend>
        <p className="text-sm text-gray-600">No tip is selected by default. Tips go to the salon for its team.</p>
        <button type="button" aria-pressed={tipCents === 0} onClick={() => onTipChange(0)} className="min-h-11 rounded-lg border px-4">No tip</button>
        <label htmlFor={`${id}-tip`} className="block">Custom tip (CAD)</label>
        <input
          id={`${id}-tip`}
          type="number"
          min="0"
          max="10000"
          step="0.01"
          value={(tipCents / 100).toFixed(2)}
          onChange={(event) => {
            const amount = Number(event.target.value);
            if (Number.isFinite(amount) && amount >= 0 && amount <= 10000) {
              onTipChange(Math.round(amount * 100));
            }
          }}
          className="min-h-11 w-full rounded-lg border p-2"
        />
      </fieldset>
      {validQuote && quote
        ? (
            <div className="space-y-3 rounded-xl bg-gray-50 p-4">
              <div className="flex justify-between gap-3 font-semibold">
                <span>Total including tax, fees and tip</span>
                <span>{formatPaymentMoney(quote.totalCents)}</span>
              </div>
              <details>
                <summary className="min-h-11 cursor-pointer py-2 font-medium">ⓘ Tax and fee breakdown</summary>
                <dl className="space-y-3">
                  {quote.lines.map(line => (
                    <div key={line.id}>
                      <dt>
                        {line.label}
                        <span className="block text-sm text-gray-600">
                          Recipient:
                          {' '}
                          {line.recipient}
                        </span>
                      </dt>
                      <dd>{formatPaymentMoney(line.amountCents)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-sm">Only disclosed customer charges are included. Stripe processing costs paid by the salon are not an extra customer charge.</p>
              </details>
              <p>
                Due now:
                {' '}
                {formatPaymentMoney(quote.dueNowCents)}
              </p>
              <p>
                Remaining at the salon:
                {' '}
                {formatPaymentMoney(quote.remainingCents)}
              </p>
            </div>
          )
        : <p role="status">Waiting for an up-to-date total. You cannot continue until the total is confirmed.</p>}
      <div>
        <h3 className="font-medium">Cancellation and refunds</h3>
        <p className="whitespace-pre-wrap">{cancellationPolicy || 'Ask the salon for its cancellation and refund policy before continuing.'}</p>
      </div>
      {(error || submitError) && <p role="alert" className="text-red-700">{error || submitError}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={onBack} className="min-h-11 rounded-lg border px-4">Back</button>
        <button type="button" disabled={busy || !validChoice || !validQuote} onClick={() => void proceed()} className="min-h-11 rounded-lg bg-gray-900 px-4 text-white disabled:opacity-50">
          {busy ? 'Please wait…' : choice === 'online' ? 'Continue to secure payment' : 'Continue with pay in person'}
        </button>
      </div>
      <p className="text-sm text-gray-600">Continuing does not confirm payment or your booking.</p>
    </section>
  );
}
