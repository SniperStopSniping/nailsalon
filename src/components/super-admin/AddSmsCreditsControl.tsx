'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type CreditBalanceResponse = {
  balance: number;
  administrativeBalance: number;
};

type GrantResponse = CreditBalanceResponse & {
  lotId: string;
  created: boolean;
};

export type AddSmsCreditsControlProps = {
  salonId: string;
  salonName: string;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    return fallback;
  }
  const error = payload.error;
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

export function AddSmsCreditsControl({ salonId, salonName }: AddSmsCreditsControlProps) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [balance, setBalance] = useState<CreditBalanceResponse | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const currentSalonId = useRef(salonId);
  currentSalonId.current = salonId;

  useEffect(() => {
    let active = true;
    // The panel instance can be reused for another salon. Clear every value
    // that is scoped to the previous target before its new balance arrives.
    setBalance(null);
    setAmount('');
    setReason('');
    setConfirmed(false);
    setPendingIdempotencyKey(null);
    setFeedback(null);
    setSubmitting(false);
    async function loadBalance() {
      setLoadingBalance(true);
      try {
        const response = await fetch(`/api/super-admin/salons/${salonId}/sms-credits`);
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(errorMessage(payload, 'SMS credit balance could not be loaded.'));
        }
        if (
          !payload
          || typeof payload.balance !== 'number'
          || typeof payload.administrativeBalance !== 'number'
        ) {
          throw new Error('The server returned an invalid SMS credit balance.');
        }
        if (active) {
          setBalance(payload as CreditBalanceResponse);
        }
      } catch (error) {
        if (active) {
          setFeedback({
            kind: 'error',
            message: error instanceof Error ? error.message : 'SMS credit balance could not be loaded.',
          });
        }
      } finally {
        if (active) {
          setLoadingBalance(false);
        }
      }
    }
    void loadBalance();
    return () => {
      active = false;
    };
  }, [salonId]);

  const parsedAmount = Number(amount);
  const validAmount = Number.isInteger(parsedAmount) && parsedAmount >= 1 && parsedAmount <= 100_000;
  const normalizedReason = reason.trim();
  const canSubmit = validAmount && normalizedReason.length > 0 && normalizedReason.length <= 500 && confirmed && !submitting;
  const confirmationCopy = useMemo(
    () => validAmount ? `I confirm adding ${parsedAmount.toLocaleString()} texts to ${salonName}.` : `I confirm adding texts to ${salonName}.`,
    [parsedAmount, salonName, validAmount],
  );

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    const requestSalonId = salonId;
    // Keep this key after an ambiguous network failure: retrying the same
    // unchanged form cannot create a second lot.
    const idempotencyKey = pendingIdempotencyKey ?? crypto.randomUUID();
    setPendingIdempotencyKey(idempotencyKey);
    try {
      const response = await fetch(`/api/super-admin/salons/${salonId}/sms-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parsedAmount, reason: normalizedReason, idempotencyKey }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, 'SMS credits could not be added.'));
      }
      if (!payload || typeof payload.balance !== 'number' || typeof payload.administrativeBalance !== 'number') {
        throw new Error('The server returned an invalid SMS credit balance.');
      }
      if (currentSalonId.current !== requestSalonId) {
        return;
      }
      const result = payload as GrantResponse;
      setBalance({ balance: result.balance, administrativeBalance: result.administrativeBalance });
      setAmount('');
      setReason('');
      setConfirmed(false);
      setPendingIdempotencyKey(null);
      setFeedback({
        kind: 'success',
        message: result.created ? `${parsedAmount.toLocaleString()} texts added to ${salonName}.` : 'This credit grant was already recorded.',
      });
    } catch (error) {
      if (currentSalonId.current !== requestSalonId) {
        return;
      }
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'SMS credits could not be added.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4" data-testid="add-sms-credits-control">
      <h4 className="font-semibold text-gray-900">Add texts</h4>
      <p className="mt-1 text-xs text-gray-600">
        Add non-expiring support credits for this salon. These credits are used after monthly and promotional credits, before starter and purchased credits.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-white p-3 text-sm text-gray-700">
        <div>
          <dt className="text-xs text-gray-500">Available texts</dt>
          <dd className="font-semibold" aria-live="polite">{loadingBalance ? 'Loading…' : (balance?.balance ?? 'Unavailable')}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Support-credit texts</dt>
          <dd className="font-semibold">{loadingBalance ? 'Loading…' : (balance?.administrativeBalance ?? 'Unavailable')}</dd>
        </div>
      </dl>
      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor={`sms-credit-amount-${salonId}`} className="block text-sm font-medium text-gray-700">Texts to add</label>
          <input
            id={`sms-credit-amount-${salonId}`}
            type="number"
            min="1"
            max="100000"
            step="1"
            inputMode="numeric"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setPendingIdempotencyKey(null);
              setFeedback(null);
            }}
            disabled={submitting}
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor={`sms-credit-reason-${salonId}`} className="block text-sm font-medium text-gray-700">Reason</label>
          <textarea
            id={`sms-credit-reason-${salonId}`}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setPendingIdempotencyKey(null);
              setFeedback(null);
            }}
            maxLength={500}
            rows={2}
            disabled={submitting}
            className="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={submitting} className="mt-0.5" />
          <span>{confirmationCopy}</span>
        </label>
        {feedback && <p role="status" className={feedback.kind === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}>{feedback.message}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Adding texts…' : 'Add texts'}
        </button>
      </div>
    </section>
  );
}
