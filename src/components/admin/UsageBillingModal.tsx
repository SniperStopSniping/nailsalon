'use client';

/**
 * Usage & Billing modal — Gate C4 (§10.1/§10.2) and the §8.10 foundation.
 *
 * One primary, understandable number first ("277 SMS credits remaining"),
 * then the optional breakdown (monthly / starter / purchased / bonus) — no
 * lot or reservation vocabulary anywhere. Message history arrives already
 * masked and friendly from the usage API; this component never sees a raw
 * recipient or provider error. Buy More drives the server-authoritative
 * top-up checkout; Manage billing opens the Stripe Billing Portal. All
 * controls are reduced-motion safe (CSS only).
 */
import { X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';

type UsagePayload = {
  salonId: string;
  usage: {
    availableCredits: number;
    monthlyCredits: number;
    starterCredits: number;
    purchasedCredits: number;
    bonusCredits: number;
    monthlyAllowance: number;
    resetsAt: string | null;
    blockedMessages: number;
    plan: {
      displayName: string;
      cadence: string;
      status: string;
      paidThrough: string;
      cancelAtPeriodEnd: boolean;
    } | null;
  };
  topupOffers: Array<{ key: string; credits: number; priceCents: number }>;
  history: Array<{
    id: string;
    channel: string;
    eventType: string;
    recipient: string;
    status: string;
    scheduledFor: string;
    sentAt: string | null;
    creditsUsed: number;
    failureReason: string | null;
  }>;
  nextCursor: string | null;
};

type UsageBillingModalProps = {
  salonSlug: string;
  onClose: () => void;
};

const EVENT_LABELS: Record<string, string> = {
  booking_confirmation: 'Booking confirmation',
  appointment_reminder: 'Appointment reminder',
  appointment_cancelled: 'Cancellation notice',
  appointment_rescheduled: 'Reschedule notice',
  deposit_received: 'Deposit receipt',
  deposit_refunded: 'Deposit refund',
  balance_reminder: 'Balance reminder',
  manual_reminder: 'Manual reminder',
};

const STATUS_LABELS: Record<string, string> = {
  sent: 'Sent',
  pending: 'Scheduled',
  claimed: 'Sending',
  sending: 'Sending',
  failed: 'Not delivered',
  canceled: 'Cancelled',
  suppressed: 'Not sent',
  expired: 'Expired',
  blocked_no_credit: 'Waiting for credits',
  send_outcome_unknown: 'Confirming delivery',
};

export function UsageBillingModal({ salonSlug, onClose }: UsageBillingModalProps) {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/admin/salon/communications/usage?salonSlug=${salonSlug}`);
        if (!response.ok) {
          throw new Error('usage fetch failed');
        }
        const body = await response.json();
        if (!cancelled) {
          setData(body.data);
        }
      } catch {
        if (!cancelled) {
          setError('Could not load usage. Please try again.');
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
  }, [salonSlug]);

  const openPortal = useCallback(async () => {
    if (portalLoading) {
      return;
    }
    try {
      setPortalLoading(true);
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: undefined, salonSlug }),
      });
      const body = await response.json();
      if (body.url) {
        window.location.assign(body.url);
      }
    } finally {
      setPortalLoading(false);
    }
  }, [portalLoading, salonSlug]);

  const buyTopup = useCallback(async (topupOfferKey: string) => {
    if (buying !== null) {
      return;
    }
    try {
      setBuying(topupOfferKey);
      setBuyError(null);
      const response = await fetch('/api/billing/checkout/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: data?.salonId, topupOfferKey }),
      });
      const body = await response.json();
      if (response.ok && body.data?.url) {
        window.location.assign(body.data.url);
        return;
      }
      setBuyError(body.error?.code === 'TOPUPS_DISABLED'
        ? 'Buying credits is not available yet.'
        : 'Could not start the purchase. Please try again.');
    } catch {
      setBuyError('Could not start the purchase. Please try again.');
    } finally {
      setBuying(null);
    }
  }, [buying, salonSlug, data]);

  const usage = data?.usage ?? null;

  return (
    <DialogShell
      isOpen
      onClose={onClose}
      alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
      maxWidthClassName="max-w-xl"
      contentClassName="max-h-[90vh] overflow-hidden rounded-t-[20px] bg-white shadow-xl sm:rounded-[20px]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="usage-billing-title">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 id="usage-billing-title" className="text-lg font-semibold text-gray-900">Usage & billing</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close usage and billing"
            className="flex size-11 items-center justify-center rounded-full bg-gray-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 motion-reduce:transition-none"
          >
            <X className="size-4 text-gray-600" />
          </button>
        </div>

        <div className="max-h-[calc(90vh-70px)] space-y-6 overflow-y-auto p-5">
          {loading && (
            <p role="status" aria-live="polite" className="text-[14px] text-gray-500">
              Loading usage…
            </p>
          )}
          {error && <p className="text-[14px] text-red-600">{error}</p>}

          {usage && (
            <>
              {/* §10.2: one primary number first. */}
              <section aria-labelledby="credits-heading" className="space-y-2">
                <h3 id="credits-heading" className="sr-only">SMS credits</h3>
                <p className="text-2xl font-semibold text-gray-900">
                  {usage.availableCredits}
                  {' '}
                  SMS credits remaining
                </p>
                <ul className="space-y-1 text-[14px] text-gray-600">
                  {usage.monthlyAllowance > 0 && (
                    <li>
                      {usage.monthlyAllowance - usage.monthlyCredits}
                      {' '}
                      of
                      {' '}
                      {usage.monthlyAllowance}
                      {' '}
                      monthly credits used
                      {usage.resetsAt !== null && ` · resets ${new Date(usage.resetsAt).toLocaleDateString()}`}
                    </li>
                  )}
                  {usage.starterCredits > 0 && (
                    <li>
                      {usage.starterCredits}
                      {' '}
                      starter credits (do not renew)
                    </li>
                  )}
                  {usage.purchasedCredits > 0 && (
                    <li>
                      {usage.purchasedCredits}
                      {' '}
                      purchased credits (never expire)
                    </li>
                  )}
                  {usage.bonusCredits > 0 && (
                    <li>
                      {usage.bonusCredits}
                      {' '}
                      bonus credits
                    </li>
                  )}
                  <li>Email confirmations and reminders are always included.</li>
                </ul>
                {usage.blockedMessages > 0 && (
                  <p className="rounded-lg bg-amber-50 p-3 text-[14px] text-amber-800">
                    {usage.blockedMessages}
                    {' '}
                    text
                    {usage.blockedMessages === 1 ? ' is' : 's are'}
                    {' '}
                    waiting for credits. Email delivery continues.
                  </p>
                )}
              </section>

              <section aria-labelledby="plan-heading" className="space-y-2">
                <h3 id="plan-heading" className="text-[15px] font-medium text-gray-900">Plan</h3>
                {usage.plan === null
                  ? <p className="text-[14px] text-gray-600">No subscription — starter and purchased credits only.</p>
                  : (
                      <p className="text-[14px] text-gray-600">
                        {usage.plan.displayName}
                        {' '}
                        (
                        {usage.plan.cadence}
                        )
                        {usage.plan.cancelAtPeriodEnd && ' · cancellation scheduled'}
                        {' · paid through '}
                        {new Date(usage.plan.paidThrough).toLocaleDateString()}
                      </p>
                    )}
                <button
                  type="button"
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] font-medium text-gray-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:opacity-40 motion-reduce:transition-none"
                >
                  {portalLoading ? 'Opening…' : 'Manage billing'}
                </button>
              </section>

              {data!.topupOffers.length > 0 && (
                <section aria-labelledby="buymore-heading" className="space-y-2">
                  <h3 id="buymore-heading" className="text-[15px] font-medium text-gray-900">Buy more credits</h3>
                  <div className="flex flex-wrap gap-2">
                    {data!.topupOffers.map(offer => (
                      <button
                        key={offer.key}
                        type="button"
                        onClick={() => buyTopup(offer.key)}
                        disabled={buying !== null}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] font-medium text-gray-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:opacity-40 motion-reduce:transition-none"
                      >
                        {buying === offer.key ? 'Opening…' : `${offer.credits} credits — $${(offer.priceCents / 100).toFixed(2)}`}
                      </button>
                    ))}
                  </div>
                  <p role="status" aria-live="polite" className="text-[13px] text-red-600">{buyError ?? ''}</p>
                  <p className="text-[13px] text-[#8E8E93]">Purchased credits never expire. Prices in CAD, plus applicable taxes.</p>
                </section>
              )}

              <section aria-labelledby="history-heading" className="space-y-2">
                <h3 id="history-heading" className="text-[15px] font-medium text-gray-900">Recent messages</h3>
                {data!.history.length === 0 && (
                  <p className="text-[14px] text-gray-500">No messages yet.</p>
                )}
                <ul className="divide-y divide-gray-100">
                  {data!.history.map(entry => (
                    <li key={entry.id} className="space-y-0.5 py-2 text-[14px]">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-900">
                          {EVENT_LABELS[entry.eventType] ?? 'Message'}
                          {' · '}
                          {entry.channel === 'sms' ? 'Text' : 'Email'}
                        </span>
                        <span className="text-gray-500">{STATUS_LABELS[entry.status] ?? entry.status}</span>
                      </div>
                      <div className="flex items-center justify-between text-gray-500">
                        <span>{entry.recipient}</span>
                        <span>{new Date(entry.scheduledFor).toLocaleString()}</span>
                      </div>
                      {entry.failureReason !== null && (
                        <p className="text-[13px] text-amber-700">{entry.failureReason}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
