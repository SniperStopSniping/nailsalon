'use client';

import { ArrowRight, Check, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';
import { type SmsCreditActivity, type SmsCreditsPayload, useSmsCredits } from '@/hooks/useSmsCredits';
import { useSmsTopupCheckout } from '@/hooks/useSmsTopupCheckout';

function activityLabel(item: SmsCreditActivity) {
  if (item.type === 'grant') {
    return item.bucket === 'purchased' ? 'Credit purchase' : item.bucket === 'starter' ? 'Free starter texts' : 'Credits added';
  }
  if (item.type === 'sms_refund') {
    return 'Text credits returned';
  }
  if (item.type === 'purchase_reversal') {
    return 'Purchase adjustment';
  }
  if (item.type === 'expiry') {
    return 'Credits expired';
  }
  if (item.eventType?.includes('rebooking') || item.eventType?.includes('followup')) {
    return 'Client follow-up';
  }
  if (item.eventType?.includes('campaign') || item.eventType?.includes('marketing')) {
    return 'Marketing campaign';
  }
  if (item.eventType?.includes('reminder')) {
    return 'Appointment reminder';
  }
  if (item.eventType?.includes('confirmation')) {
    return 'Booking confirmation';
  }
  return 'Text message';
}

export function SmsCreditsModal({ salonSlug, initialView, onClose }: { salonSlug: string; initialView: 'topup' | 'history'; onClose: () => void }) {
  const [view, setView] = useState(initialView);
  const { data, loading, error, refresh } = useSmsCredits(salonSlug, view === 'history' ? 'credits' : 'balance');
  const { buying, buyError, buyTopup } = useSmsTopupCheckout(data?.salonId, () => void refresh());
  const [extra, setExtra] = useState<{ items: SmsCreditActivity[]; nextCursor: string | null } | null>(null);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState(false);
  const currentSnapshot = useRef(data);
  currentSnapshot.current = data;
  useEffect(() => {
    setExtra(null);
    setPageError(false);
  }, [data]);
  const loadMore = async () => {
    const cursor = extra ? extra.nextCursor : data?.activity?.nextCursor;
    if (!cursor || !data || paging) {
      return;
    }
    setPaging(true);
    setPageError(false);
    try {
      const response = await fetch(`/api/admin/salon/communications/usage?${new URLSearchParams({ salonSlug, view: 'credits', cursor })}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('history unavailable');
      }
      const body: { data: SmsCreditsPayload } = await response.json();
      if (currentSnapshot.current === data && body.data.salonId === data.salonId) {
        setExtra(previous => ({ items: [...(previous?.items ?? []), ...(body.data.activity?.items ?? [])], nextCursor: body.data.activity?.nextCursor ?? null }));
      }
    } catch {
      if (currentSnapshot.current === data) {
        setPageError(true);
      }
    } finally {
      setPaging(false);
    }
  };
  const items = [...(data?.activity?.items ?? []), ...(extra?.items ?? [])];
  const hasMore = extra ? extra.nextCursor : data?.activity?.nextCursor;
  return (
    <DialogShell isOpen onClose={onClose} alignClassName="items-end justify-center p-0 sm:items-center sm:p-4" maxWidthClassName="max-w-xl" contentClassName="max-h-[92dvh] overflow-hidden rounded-t-[26px] border border-[var(--owner-line)] bg-[var(--owner-ground)] shadow-[var(--owner-shadow-card)] sm:rounded-[26px]">
      <div role="dialog" aria-modal="true" aria-labelledby="sms-credits-title" className="flex max-h-[92dvh] flex-col text-[var(--owner-ink)]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--owner-line)] px-5 py-4">
          <h2 id="sms-credits-title" className="owner-title text-[28px]">{view === 'topup' ? 'Buy more texts' : 'Text usage history'}</h2>
          <button type="button" aria-label="Close text credits" onClick={onClose} className="owner-action size-11 shrink-0 !p-0"><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5 pb-8">
          {loading && <p role="status" className="py-6 text-sm text-[var(--owner-muted)]">Loading your text credits…</p>}
          {error && (
            <div>
              <p role="status">We couldn’t load your text credits.</p>
              <button type="button" onClick={() => void refresh()} className="owner-action mt-3">Try again</button>
            </div>
          )}
          {data && (view === 'topup'
            ? (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--owner-accent)]">
                      {Math.max(0, data.balance.availableCredits).toLocaleString()}
                      {' '}
                      texts remaining
                    </p>
                    <h3 className="owner-title mt-3 text-[32px] leading-tight">
                      More texts,
                      <br />
                      more connections.
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--owner-muted)]">Keep your appointment reminders, client follow-ups, and campaigns running smoothly.</p>
                    <p className="mt-2 text-sm font-semibold">One-time purchase. No subscription required.</p>
                  </div>
                  {!data.canPurchase && <p role="status" className="text-sm text-[var(--owner-muted)]">Only the salon owner can purchase credits. Ask your owner to top up this salon.</p>}
                  {!data.creditPurchasesAvailable && <p role="status" className="text-sm text-[var(--owner-muted)]">Text purchases are currently unavailable. Your existing credits and free core app are unchanged.</p>}
                  {buyError && <p role="alert" className="text-sm text-[var(--owner-accent)]">{buyError}</p>}
                  <p className="text-sm leading-relaxed text-[var(--owner-muted)]">Credit / debit card · Apple Pay when available</p>
                  <div className="space-y-3">
                    {data.topupOffers.map(offer => (
                      <button key={offer.key} type="button" aria-label={buying === offer.key ? 'Opening secure checkout' : `Buy ${offer.credits} texts`} disabled={buying !== null || !offer.available || !data.canPurchase} onClick={() => void buyTopup(offer.key)} className={`owner-card block w-full p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-focus)] disabled:cursor-not-allowed disabled:opacity-60 ${offer.credits === 500 ? '!border-[var(--owner-accent)]' : 'hover:bg-[var(--owner-blush)]'}`}>
                        {(offer.credits === 500 || (data.balance.lastPurchaseOfferKey === offer.key || data.balance.lastPurchaseCredits === offer.credits)) && (
                          <span className="mb-2 flex flex-wrap gap-2">
                            {offer.credits === 500 && <span className="rounded-full bg-[var(--owner-blush)] px-3 py-1 text-xs font-semibold text-[var(--owner-accent)]">Best Value</span>}
                            {(data.balance.lastPurchaseOfferKey === offer.key || data.balance.lastPurchaseCredits === offer.credits) && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--owner-line)] px-3 py-1 text-xs text-[var(--owner-muted)]">
                                <Check size={12} aria-hidden="true" />
                                Your last purchase
                              </span>
                            )}
                          </span>
                        )}
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-xl font-semibold">
                            {offer.credits.toLocaleString()}
                            {' '}
                            texts
                          </span>
                          <span className="text-2xl font-semibold">
                            $
                            {(offer.priceCents / 100).toLocaleString('en-CA')}
                            <span className="ml-1 text-xs font-normal text-[var(--owner-muted)]">CAD</span>
                          </span>
                        </span>
                        <span className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-sm text-[var(--owner-muted)]">
                            $
                            {(offer.priceCents / offer.credits / 100).toFixed(2)}
                            {' '}
                            per text credit
                          </span>
                          <span className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${offer.credits === 500 ? 'bg-[var(--owner-accent)] text-white' : 'text-[var(--owner-accent)]'}`}>
                            {buying === offer.key ? 'Opening…' : 'Buy'}
                            <ArrowRight size={15} aria-hidden="true" />
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 text-xs leading-relaxed text-[var(--owner-muted)]">
                    <ShieldCheck size={17} className="shrink-0" aria-hidden="true" />
                    <p>Secure payment through Stripe. Credits are added after payment is verified. Longer messages and some characters can use more than one text credit.</p>
                  </div>
                  <button type="button" className="owner-action w-full" onClick={() => setView('history')}>
                    View usage history
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </>
              )
            : (
                <>
                  <div className="owner-card p-4">
                    <p className="text-sm text-[var(--owner-muted)]">Texts remaining</p>
                    <p className="owner-title mt-1 break-all text-5xl tabular-nums">{Math.max(0, data.balance.availableCredits).toLocaleString()}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--owner-line)] pt-4">
                      <div>
                        <p className="text-lg font-semibold">{data.balance.totalPurchased.toLocaleString()}</p>
                        <p className="text-xs text-[var(--owner-muted)]">Total credits purchased</p>
                      </div>
                      <div>
                        <p className="text-lg font-semibold">{data.balance.usedThisMonth.toLocaleString()}</p>
                        <p className="text-xs text-[var(--owner-muted)]">Credits used this month</p>
                      </div>
                    </div>
                    <button type="button" className="owner-action owner-action--primary mt-4 w-full" onClick={() => setView('topup')}>
                      Buy More Texts
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div>
                    <h3 className="owner-section-title mb-3">Credit activity</h3>
                    <p className="mb-3 text-xs leading-relaxed text-[var(--owner-muted)]">Newest first. Dates use your salon’s time zone. Queued texts reserve credits; they appear here when charged. A text can use more than one credit.</p>
                    {items.length === 0
                      ? <div className="owner-card p-5 text-sm text-[var(--owner-muted)]">No text credit activity yet. Your credits and purchases will appear here.</div>
                      : (
                          <ol className="owner-card divide-y divide-[var(--owner-line)] overflow-hidden">
                            {items.map(item => (
                              <li key={item.id} className="flex items-center justify-between gap-3 p-4">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold">{activityLabel(item)}</p>
                                  <p className="mt-1 text-xs text-[var(--owner-muted)]">{new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: data.balance.timeZone }).format(new Date(item.createdAt))}</p>
                                </div>
                                <span className={`shrink-0 text-sm font-semibold tabular-nums ${item.credits > 0 ? 'text-[var(--owner-accent)]' : ''}`}>
                                  {item.credits > 0 ? '+' : '−'}
                                  {Math.abs(item.credits).toLocaleString()}
                                  <span className="ml-1 text-xs font-normal">credits</span>
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                    {pageError && <p role="alert" className="mt-3 text-sm">Could not load more activity. Please try again.</p>}
                    {hasMore && <button type="button" className="owner-action mt-3 w-full" onClick={() => void loadMore()} disabled={paging}>{paging ? 'Loading…' : 'Load more activity'}</button>}
                  </div>
                </>
              ))}
        </div>
      </div>
    </DialogShell>
  );
}
