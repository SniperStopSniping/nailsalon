'use client';

import { CheckCircle2, Copy } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { formatMoney } from '@/libs/formatMoney';

// =============================================================================
// Public payment-instruction page (opened from the checkout QR).
// Shows ONLY salon-side payment facts — salon name, amount, recipient,
// reference, instructions. The salon confirms receipt manually; this page
// never claims bank verification.
// =============================================================================

type PayPageData = {
  salonName: string;
  amountDueCents: number;
  totalCents: number;
  isFinalized: boolean;
  reference: string;
  recipient: string | null;
  recipientName: string | null;
  autodepositEnabled: boolean;
  requireReference: boolean;
  instructions: string | null;
};

export default function PayPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<PayPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/public/pay/${token}`);
        const result = await response.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setNotFound(true);
          return;
        }
        setData(result.data);
      } catch {
        if (!cancelled) {
          setNotFound(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const copy = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(current => (current === label ? null : current)), 2000);
    } catch {
      // Clipboard unavailable — the values stay visible for manual copying.
    }
  }, []);

  return (
    <main
      className="flex min-h-screen items-start justify-center bg-[#FFF8F5] px-4 py-10"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="w-full max-w-md">
        {loading && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center text-sm text-neutral-500">
            Loading payment details…
          </div>
        )}

        {!loading && notFound && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center" data-testid="pay-page-invalid">
            <div className="text-lg font-semibold text-neutral-900">Link not active</div>
            <p className="mt-2 text-sm text-neutral-500">
              This payment link is invalid or no longer active. Please ask the salon
              for a new one.
            </p>
          </div>
        )}

        {!loading && data && (
          <div className="space-y-4" data-testid="pay-page">
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center">
              <div className="text-sm uppercase tracking-[0.12em] text-neutral-400">
                {data.salonName}
              </div>
              <div className="mt-2 text-4xl font-semibold text-neutral-900" data-testid="pay-page-amount">
                {formatMoney(data.amountDueCents)}
              </div>
              <div className="mt-1 text-sm text-neutral-500">
                {data.isFinalized
                  ? data.amountDueCents < data.totalCents
                    ? `Remaining balance of a ${formatMoney(data.totalCents)} total`
                    : 'Amount due'
                  : 'Estimated — the final amount is confirmed at checkout'}
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 bg-white p-5">
              <div className="mb-3 text-sm font-semibold text-neutral-900">
                Pay by Interac e-Transfer
              </div>
              <div className="space-y-3 text-sm text-neutral-700">
                {data.recipient && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-wide text-neutral-400">Send to</div>
                      <div className="truncate font-medium">{data.recipient}</div>
                      {data.recipientName && (
                        <div className="text-xs text-neutral-500">{data.recipientName}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Copy recipient"
                      onClick={() => void copy('recipient', data.recipient ?? '')}
                      className="shrink-0 rounded-lg border border-neutral-200 p-2 text-neutral-600"
                    >
                      {copied === 'recipient' ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-neutral-400">Amount</div>
                    <div className="font-medium">{formatMoney(data.amountDueCents)}</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Copy amount"
                    onClick={() => void copy('amount', (data.amountDueCents / 100).toFixed(2))}
                    className="shrink-0 rounded-lg border border-neutral-200 p-2 text-neutral-600"
                  >
                    {copied === 'amount' ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-neutral-400">
                      {data.requireReference ? 'Reference (please include)' : 'Reference'}
                    </div>
                    <div className="font-medium" data-testid="pay-page-reference">{data.reference}</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Copy reference"
                    onClick={() => void copy('reference', data.reference)}
                    className="shrink-0 rounded-lg border border-neutral-200 p-2 text-neutral-600"
                  >
                    {copied === 'reference' ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                  </button>
                </div>
                {data.autodepositEnabled && (
                  <p className="text-xs text-neutral-500">
                    Autodeposit is on — the transfer deposits automatically with no
                    security question.
                  </p>
                )}
                {data.instructions && (
                  <p className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-600">
                    {data.instructions}
                  </p>
                )}
                <p className="text-xs text-neutral-400">
                  Once you've sent the transfer, let the salon know — they confirm
                  payments manually.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
