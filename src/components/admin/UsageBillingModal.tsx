'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { StarterSmsCreditsCard } from '@/components/admin/StarterSmsCreditsCard';
import { DialogShell } from '@/components/ui/dialog-shell';
import { SMS_BALANCE_CHANGED_EVENT, textBalanceState } from '@/libs/commercialPolicy';

type UsagePayload = {
  salonId: string;
  usage: {
    availableCredits: number;
    starterCredits: number;
    pendingCredits?: number;
    blockedMessages: number;
    plan: { paidThrough: string; cancelAtPeriodEnd: boolean } | null;
  };
  creditPurchasesAvailable?: boolean;
  canPurchaseCredits?: boolean;
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

const EVENT_LABELS: Record<string, string> = {
  salon_invite: 'Salon invitation',
  booking_confirmation: 'Booking confirmation',
  appointment_reminder: 'Appointment reminder',
  appointment_cancelled: 'Cancellation notice',
  appointment_rescheduled: 'Reschedule notice',
  deposit_received: 'Deposit receipt',
  deposit_refunded: 'Deposit refund',
  balance_reminder: 'Balance reminder',
  manual_reminder: 'Manual reminder',
  manual_text: 'Manual client text',
  booking_request_received: 'Booking request received',
  booking_request_approved: 'Booking confirmed',
  booking_request_declined: 'Booking request declined',
  booking_request_expired: 'Booking request expired',
  owner_new_booking: 'New booking alert',
  owner_appointment_cancelled: 'Cancellation alert',
  tech_new_booking: 'Technician booking alert',
  tech_appointment_cancelled: 'Technician cancellation alert',
  review_request: 'Review request',
  rebooking_reminder: 'Rebooking reminder',
  follow_up: 'Follow-up',
  campaign: 'Campaign',
};

const STATUS_LABELS: Record<string, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  queued: 'Queued',
  accepted: 'Queued',
  pending: 'Scheduled',
  claimed: 'Sending',
  sending: 'Sending',
  failed: 'Send failed',
  undelivered: 'Undelivered',
  canceled: 'Cancelled',
  suppressed: 'Not sent',
  expired: 'Expired',
  blocked_no_credit: 'Waiting for credits',
  send_outcome_unknown: 'Checking delivery',
  opted_out: 'Opted out',
  customer_disabled: 'Disabled by customer',
  booking_disabled: 'Disabled for this booking',
  provider_blocked: 'Provider blocked',
};

export function UsageBillingModal({ salonSlug, onClose }: { salonSlug: string; onClose: () => void }) {
  const [data, setData] = useState<UsagePayload | null>(null);
  const [dataSalon, setDataSalon] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const currentSalon = useRef(salonSlug);
  currentSalon.current = salonSlug;
  const version = useRef(0);

  const refreshUsage = useCallback(async () => {
    const requestVersion = ++version.current;
    const response = await fetch(`/api/admin/salon/communications/usage?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('usage unavailable');
    }
    const body = await response.json();
    if (currentSalon.current === salonSlug && requestVersion === version.current) {
      setDataSalon(salonSlug);
      setData(current => current && current.salonId === body.data.salonId && current.history.length > body.data.history.length
        ? { ...body.data, history: [...new Map([...body.data.history, ...current.history.filter(row => !body.data.history.some((fresh: { id: string }) => fresh.id === row.id))].map(row => [row.id, row])).values()], nextCursor: current.nextCursor }
        : body.data);
      setError(null);
    }
  }, [salonSlug]);

  useEffect(() => {
    let active = true;
    setData(null);
    setLoading(true);
    setError(null);
    setBuying(null);
    setLoadingMore(false);
    setBuyError(null);
    const refresh = () => void refreshUsage().catch(() => {
      if (active) {
        setError('Could not load usage. Please try again.');
      }
    }).finally(() => {
      if (active) {
        setLoading(false);
      }
    });
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(SMS_BALANCE_CHANGED_EVENT, refresh);
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      version.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(SMS_BALANCE_CHANGED_EVENT, refresh);
    };
  }, [refreshUsage]);

  const loadMore = async () => {
    if (!data?.nextCursor || loadingMore) {
      return;
    }
    const requestedSalon = salonSlug;
    const cursor = data.nextCursor;
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ salonSlug, cursor });
      const response = await fetch(`/api/admin/salon/communications/usage?${query}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('history unavailable');
      }
      const body = await response.json();
      if (currentSalon.current === requestedSalon) {
        setData(current => current && current.salonId === body.data.salonId
          ? { ...current, history: [...new Map([...current.history, ...body.data.history].map(row => [row.id, row])).values()], nextCursor: body.data.nextCursor }
          : current);
      }
    } catch {
      if (currentSalon.current === requestedSalon) {
        setError('Could not load more history. Please try again.');
      }
    } finally {
      if (currentSalon.current === requestedSalon) {
        setLoadingMore(false);
      }
    }
  };

  const buyTopup = async (key: string) => {
    if (!data || buying || !data.creditPurchasesAvailable || data.canPurchaseCredits !== true) {
      return;
    }
    const requestedSalon = salonSlug;
    setBuying(key);
    setBuyError(null);
    try {
      const response = await fetch('/api/billing/checkout/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: data.salonId, topupOfferKey: key }),
      });
      const body = await response.json();
      if (currentSalon.current !== requestedSalon) {
        return;
      }
      if (response.ok && body.data?.url) {
        window.location.assign(body.data.url);
        return;
      }
      setBuyError(body.error?.message || 'Could not start the purchase. Please try again.');
    } catch {
      if (currentSalon.current === requestedSalon) {
        setBuyError('Could not start the purchase. Please try again.');
      }
    } finally {
      if (currentSalon.current === requestedSalon) {
        setBuying(null);
      }
    }
  };

  const openPortal = async () => {
    const requestedSalon = salonSlug;
    try {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: data?.salonId, salonSlug }),
      });
      const body = await response.json();
      if (currentSalon.current !== requestedSalon) {
        return;
      }
      if (response.ok && body.url) {
        window.location.assign(body.url);
      } else {
        setBuyError(body.error?.message || 'Could not open past billing.');
      }
    } catch {
      if (currentSalon.current === requestedSalon) {
        setBuyError('Could not open past billing.');
      }
    }
  };

  const usage = dataSalon === salonSlug ? data?.usage : null;
  const balanceState = usage ? textBalanceState(usage.availableCredits) : null;
  const history = data?.history.filter(row => row.channel === 'sms') ?? [];
  return (
    <DialogShell isOpen onClose={onClose} alignClassName="items-end justify-center p-0 sm:items-center sm:p-4" maxWidthClassName="max-w-xl" contentClassName="max-h-[90vh] overflow-hidden rounded-t-[20px] bg-[var(--owner-surface,#fffdfb)] shadow-xl sm:rounded-[20px]">
      <div role="dialog" aria-modal="true" aria-labelledby="usage-billing-title">
        <div className="flex items-center justify-between border-b border-[var(--owner-line,#dfd1d4)] px-5 py-4">
          <h2 id="usage-billing-title" className="text-lg font-semibold text-[var(--owner-ink,#30262a)]">Usage &amp; Top Ups</h2>
          <button type="button" onClick={onClose} aria-label="Close usage and top ups" className="flex size-11 items-center justify-center rounded-full bg-[var(--owner-ground,#f8f2ed)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[calc(90vh-76px)] space-y-6 overflow-y-auto p-5 text-[var(--owner-ink,#30262a)]">
          {loading && <p role="status">Loading usage…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => void refreshUsage().catch(() => setError('Could not load usage. Please try again.'))} className="min-h-11 underline">Try again</button>
            </div>
          )}
          {usage && data && (
            <>
              <section aria-labelledby="credits-heading">
                <h3 id="credits-heading" className="text-sm text-[var(--owner-muted,#706267)]">Current text balance</h3>
                <p className="mt-1 text-3xl font-semibold">
                  {usage.availableCredits}
                  {' '}
                  texts remaining
                </p>
                <p className="mt-2 text-sm text-[var(--owner-muted,#706267)]">All features included. No monthly subscription.</p>
                <p className="mt-1 text-sm text-[var(--owner-muted,#706267)]">Purchased texts never expire.</p>
                {balanceState !== 'healthy' && (
                  <div role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    <p>{balanceState === 'empty' ? 'You’re out of text credits. Add more texts to continue sending reminders and messages.' : 'Your text balance is getting low. Top up when you need more.'}</p>
                    <a href="#buymore-heading" className="inline-flex min-h-11 items-center font-semibold underline">Top up now</a>
                  </div>
                )}
                {!!usage.pendingCredits && (
                  <p className="mt-2 text-sm">
                    {usage.pendingCredits}
                    {' '}
                    text credits set aside for messages being sent.
                  </p>
                )}
                {usage.blockedMessages > 0 && (
                  <p className="mt-2 text-sm">
                    {usage.blockedMessages}
                    {' '}
                    texts waiting for credits. The rest of your app is available.
                  </p>
                )}
              </section>
              <section aria-labelledby="buymore-heading" className="space-y-3">
                <h3 id="buymore-heading" className="scroll-mt-4 text-base font-semibold">Buy more texts</h3>
                <div className="grid gap-2">
                  {data.topupOffers.map(offer => (
                    <button key={offer.key} type="button" onClick={() => void buyTopup(offer.key)} disabled={buying !== null || !data.creditPurchasesAvailable || data.canPurchaseCredits !== true} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-[var(--owner-line,#dfd1d4)] px-4 py-3 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
                      <span>{buying === offer.key ? 'Opening…' : `${offer.credits} texts — $${offer.priceCents / 100}`}</span>
                      {offer.credits === 500 && <span className="rounded-full bg-[var(--owner-blush,#f6e7ec)] px-2 py-1 text-xs">Best value</span>}
                    </button>
                  ))}
                </div>
                {!data.creditPurchasesAvailable && <p className="text-sm text-[var(--owner-muted,#706267)]">Top ups are temporarily unavailable. Please try again later.</p>}
                {data.canPurchaseCredits !== true && <p className="text-sm text-[var(--owner-muted,#706267)]">Only the salon owner can purchase texts.</p>}
                {buyError && <p role="alert" className="text-sm text-red-700">{buyError}</p>}
                <p className="text-xs text-[var(--owner-muted,#706267)]">Prices in CAD. Long messages and emoji can use more than one text credit.</p>
              </section>
              <section aria-labelledby="history-heading" className="space-y-3">
                <h3 id="history-heading" className="text-base font-semibold">Recent text usage</h3>
                {history.length === 0 && <p className="text-sm text-[var(--owner-muted,#706267)]">No text usage yet.</p>}
                <ul className="divide-y divide-[var(--owner-line,#dfd1d4)]">
                  {history.map(row => (
                    <li key={row.id} className="py-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <span>{EVENT_LABELS[row.eventType] ?? 'Client message'}</span>
                        <span className="shrink-0">{row.creditsUsed === 0 ? 'No credits used' : `${row.creditsUsed} text${row.creditsUsed === 1 ? '' : 's'}`}</span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--owner-muted,#706267)]">
                        {STATUS_LABELS[row.status] ?? 'Checking delivery'}
                        {' '}
                        ·
                        {' '}
                        {row.recipient}
                        {' '}
                        ·
                        {' '}
                        {new Date(row.sentAt ?? row.scheduledFor).toLocaleDateString()}
                      </p>
                      {row.failureReason && <p className="mt-1 text-xs text-[var(--owner-muted,#706267)]">{row.failureReason}</p>}
                    </li>
                  ))}
                </ul>
                {data.nextCursor && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="min-h-11 rounded-xl border px-4 text-sm">{loadingMore ? 'Loading…' : 'Load more'}</button>}
              </section>
              <StarterSmsCreditsCard
                key={data.salonId}
                salonId={data.salonId}
                hasKnownStarterCredits={usage.starterCredits > 0}
                onClaimed={async () => {
                  await refreshUsage();
                  window.dispatchEvent(new Event(SMS_BALANCE_CHANGED_EVENT));
                }}
              />
              {usage.plan && (
                <div className="text-xs text-[var(--owner-muted,#706267)]">
                  <p>
                    Previous plan paid through
                    {new Date(usage.plan.paidThrough).toLocaleDateString()}
                    . Prepaid credits are honored.
                  </p>
                  <button type="button" onClick={() => void openPortal()} className="min-h-11 underline">Past billing and receipts</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
