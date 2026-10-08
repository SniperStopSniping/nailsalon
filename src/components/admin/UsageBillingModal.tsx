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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SmsCreditsModal } from '@/components/admin/SmsCreditsModal';
import { StarterSmsCreditsCard } from '@/components/admin/StarterSmsCreditsCard';
import { DialogShell } from '@/components/ui/dialog-shell';
import { useSmsTopupCheckout } from '@/hooks/useSmsTopupCheckout';
import type { FoundingLifetimeAccess } from '@/libs/billing/foundingLifetime';
import { SMS_CREDITS_CHANGED_EVENT } from '@/libs/smsCreditStatus';

type UsagePayload = {
  salonId: string;
  usage: {
    coreAccess?: FoundingLifetimeAccess | null;
    availableCredits: number;
    monthlyCredits: number;
    starterCredits: number;
    purchasedCredits: number;
    bonusCredits: number;
    monthlyAllowance: number;
    resetsAt: string | null;
    blockedMessages: number;
    /** Credits held for texts that are queued/sending but not yet settled. */
    pendingCredits?: number;
    plan: {
      displayName: string;
      cadence: string;
      status: string;
      paidThrough: string;
      cancelAtPeriodEnd: boolean;
      /** §6.5a owner-facing status truth (G18) — plain English, never null when plan is set. */
      entitlement: {
        status: string;
        paidThrough: string | null;
        grantsEligible: boolean;
        label: string;
      };
    } | null;
  };
  creditPurchasesAvailable?: boolean;
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
    /** Minutes-before-appointment this reminder was scheduled at, when known. */
    reminderLeadMinutes: number | null;
    failureReason: string | null;
  }>;
  nextCursor: string | null;
};

/** Which grouped section of message history an entry belongs in. */
type HistoryCategory = 'all' | 'confirmations' | '24h' | '1h' | 'cancellations' | 'other';

type TopupItem = {
  id: string;
  offerKey: string;
  credits: number;
  priceCents: number;
  currency: string;
  status: 'pending' | 'fulfilled' | 'expired' | 'refunded' | 'disputed' | 'reversed';
  holdState: 'held' | null;
  createdAt: string;
  fulfilledAt: string | null;
  reversedAt: string | null;
};

type TopupsPayload = {
  available: boolean;
  items: TopupItem[];
  nextCursor: string | null;
};

type UsageBillingModalProps = {
  salonSlug: string;
  initialView?: 'overview' | 'topup' | 'history';
  onClose: () => void;
};

const TOPUP_STATUS_LABELS: Record<TopupItem['status'], string> = {
  pending: 'Pending',
  fulfilled: 'Fulfilled',
  expired: 'Expired',
  refunded: 'Refunded',
  disputed: 'Disputed',
  reversed: 'Reversed',
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
  manual_text: 'Manual text',
  booking_request_received: 'Booking request received',
  booking_request_approved: 'Booking confirmed',
  booking_request_declined: 'Booking request declined',
  booking_request_expired: 'Booking request expired',
  owner_new_booking: 'New booking alert',
  owner_appointment_cancelled: 'Cancellation alert',
  tech_new_booking: 'Technician booking alert',
  tech_appointment_cancelled: 'Technician cancellation alert',
};

const STATUS_LABELS: Record<string, string> = {
  sent: 'Sent',
  queued: 'Queued',
  accepted: 'Queued',
  delivered: 'Delivered',
  customer_disabled: 'Reminders disabled by customer',
  booking_disabled: 'Disabled for this booking',
  opted_out: 'STOP / opted out',
  provider_blocked: 'Provider blocked',
  undelivered: 'Undelivered',
  pending: 'Scheduled',
  claimed: 'Sending',
  sending: 'Sending',
  failed: 'Send failed',
  canceled: 'Cancelled',
  suppressed: 'Not sent',
  expired: 'Expired',
  blocked_no_credit: 'Waiting for credits',
  send_outcome_unknown: 'Confirming delivery',
};

const CATEGORY_LABELS: Record<Exclude<HistoryCategory, 'all'>, string> = {
  'confirmations': 'Confirmations',
  '24h': '24-hour reminders',
  '1h': '1-hour reminders',
  'cancellations': 'Cancellations',
  'other': 'Other messages',
};

/**
 * Groups a history row the way owners think about their messages, not the
 * way the ledger stores them — a saved lead time (§ reminderLeadMinutes)
 * beats guessing from the current settings, since settings can change after
 * the message went out.
 */
function historyCategory(entry: UsagePayload['history'][number]): Exclude<HistoryCategory, 'all'> {
  if (entry.eventType === 'booking_confirmation' || entry.eventType === 'booking_request_approved') {
    return 'confirmations';
  }
  if (entry.eventType === 'appointment_reminder' && entry.reminderLeadMinutes === 1440) {
    return '24h';
  }
  if (entry.eventType === 'appointment_reminder' && entry.reminderLeadMinutes === 60) {
    return '1h';
  }
  if (entry.eventType.includes('cancelled')) {
    return 'cancellations';
  }
  return 'other';
}

/**
 * Net SMS credits actually charged for this message — email and
 * fully-refunded/cancelled texts never draw credits, so this is never a
 * synonym for "a message was sent".
 */
function creditLabel(entry: UsagePayload['history'][number]): string {
  if (entry.channel !== 'sms') {
    return 'Email included · no SMS credits';
  }
  if (entry.creditsUsed === 0) {
    return 'No SMS credits charged';
  }
  return `${entry.creditsUsed} SMS credit${entry.creditsUsed === 1 ? '' : 's'} charged`;
}

export function UsageBillingModal({ salonSlug, onClose, initialView = 'overview' }: UsageBillingModalProps) {
  return initialView === 'overview'
    ? <UsageBillingOverview key={salonSlug} salonSlug={salonSlug} onClose={onClose} />
    : <SmsCreditsModal key={salonSlug} salonSlug={salonSlug} initialView={initialView} onClose={onClose} />;
}

function UsageBillingOverview({ salonSlug, onClose }: UsageBillingModalProps) {
  const currentSalonSlug = useRef(salonSlug);
  currentSalonSlug.current = salonSlug;
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const { buying, buyError, buyTopup } = useSmsTopupCheckout(data?.salonId, () => setData(current => current ? { ...current, creditPurchasesAvailable: false, topupOffers: [] } : current));
  // OP-1 (owner authorization 2026-09-16): the Portal route can now refuse a
  // collaborator with `403 OWNER_REQUIRED`, and that route has no dark switch
  // (D9) — it is live for legacy-flow customers today. Without somewhere to
  // put the refusal, the button would flip back to its idle label and say
  // nothing at all, which reads as a broken button rather than a rule.
  const [portalError, setPortalError] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryCategory>('all');
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

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

  const refreshUsage = useCallback(async () => {
    const response = await fetch(`/api/admin/salon/communications/usage?salonSlug=${salonSlug}`);
    if (!response.ok) {
      throw new Error('usage fetch failed');
    }
    const body = await response.json();
    if (currentSalonSlug.current === salonSlug) {
      setData(body.data);
    }
  }, [salonSlug]);

  useEffect(() => {
    const refresh = () => {
      void refreshUsage().catch(() => setError('Could not refresh usage. Please reopen to try again.'));
    };
    window.addEventListener(SMS_CREDITS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SMS_CREDITS_CHANGED_EVENT, refresh);
  }, [refreshUsage]);

  // Message history — a second page on demand (distinct from the top-ups
  // "Load more" below, which pages a different endpoint).
  const loadMoreHistory = useCallback(async () => {
    if (data === null || data.nextCursor === null || loadingMoreHistory) {
      return;
    }
    try {
      setLoadingMoreHistory(true);
      setHistoryError(null);
      const query = new URLSearchParams({ salonSlug, cursor: data.nextCursor });
      const response = await fetch(`/api/admin/salon/communications/usage?${query.toString()}`);
      if (!response.ok) {
        throw new Error('history fetch failed');
      }
      const body = await response.json();
      setData(current => current === null
        ? current
        : { ...current, history: [...current.history, ...body.data.history], nextCursor: body.data.nextCursor });
    } catch {
      setHistoryError('Could not load more history. Please try again.');
    } finally {
      setLoadingMoreHistory(false);
    }
  }, [data, loadingMoreHistory, salonSlug]);

  const groupedHistory = useMemo(() => {
    const groups: Record<Exclude<HistoryCategory, 'all'>, UsagePayload['history']> = {
      'confirmations': [],
      '24h': [],
      '1h': [],
      'cancellations': [],
      'other': [],
    };
    data?.history.forEach((entry) => {
      groups[historyCategory(entry)].push(entry);
    });
    return groups;
  }, [data?.history]);

  // --- Top-ups tab (G17) ---------------------------------------------------
  const [topups, setTopups] = useState<TopupItem[] | null>(null);
  const [topupsAvailable, setTopupsAvailable] = useState<boolean | null>(null);
  const [topupsCursor, setTopupsCursor] = useState<string | null>(null);
  const [topupsLoading, setTopupsLoading] = useState(false);
  const [topupsLoadingMore, setTopupsLoadingMore] = useState(false);
  const [topupsError, setTopupsError] = useState<string | null>(null);
  const salonIdForTopups = data?.salonId ?? null;

  useEffect(() => {
    if (salonIdForTopups === null) {
      return;
    }
    let cancelled = false;
    (async () => {
      setTopupsLoading(true);
      setTopupsError(null);
      try {
        const response = await fetch(`/api/billing/topups?salonId=${salonIdForTopups}&limit=20`);
        if (!response.ok) {
          throw new Error('topups fetch failed');
        }
        const body: TopupsPayload = await response.json();
        if (!cancelled) {
          setTopupsAvailable(body.available);
          setTopups(body.items);
          setTopupsCursor(body.nextCursor);
        }
      } catch {
        if (!cancelled) {
          setTopupsAvailable(false);
          setTopups([]);
          setTopupsCursor(null);
          setTopupsError('Could not load top-up history. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setTopupsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Fetches exactly once per salon — "Load more" below drives every
    // subsequent page, never a re-fetch loop.
  }, [salonIdForTopups]);

  const loadMoreTopups = useCallback(async () => {
    if (salonIdForTopups === null || topupsCursor === null || topupsLoadingMore) {
      return;
    }
    try {
      setTopupsLoadingMore(true);
      setTopupsError(null);
      const response = await fetch(
        `/api/billing/topups?salonId=${salonIdForTopups}&limit=20&cursor=${encodeURIComponent(topupsCursor)}`,
      );
      if (!response.ok) {
        throw new Error('topups fetch failed');
      }
      const body: TopupsPayload = await response.json();
      setTopups(current => [...(current ?? []), ...body.items]);
      setTopupsCursor(body.nextCursor);
    } catch {
      setTopupsError('Could not load more top-ups. Please try again.');
    } finally {
      setTopupsLoadingMore(false);
    }
  }, [salonIdForTopups, topupsCursor, topupsLoadingMore]);

  const openPortal = useCallback(async () => {
    if (portalLoading) {
      return;
    }
    try {
      setPortalLoading(true);
      setPortalError(null);
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: data?.salonId, salonSlug }),
      });
      const body = await response.json();
      if (body.url) {
        window.location.assign(body.url);
        return;
      }
      // A refusal the caller can act on (OWNER_REQUIRED above all) carries a
      // message written for the owner; show it verbatim rather than inventing
      // a retry prompt for something retrying cannot fix.
      setPortalError(typeof body?.error?.message === 'string' && body.error.message !== ''
        ? body.error.message
        : 'Could not open the billing portal. Please try again.');
    } catch {
      setPortalError('Could not open the billing portal. Please try again.');
    } finally {
      setPortalLoading(false);
    }
  }, [portalLoading, salonSlug, data]);

  const usage = data?.usage ?? null;

  return (
    <DialogShell
      isOpen
      onClose={onClose}
      alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
      maxWidthClassName="max-w-xl"
      contentClassName="max-h-[90vh] overflow-hidden rounded-t-[26px] border border-[var(--owner-line)] bg-[var(--owner-ground)] shadow-[var(--owner-shadow-card)] sm:rounded-[26px]"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="usage-billing-title" className="flex max-h-[90vh] flex-col text-[var(--owner-ink)]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--owner-line)] px-5 py-4">
          <h2 id="usage-billing-title" className="owner-title text-[30px] text-[var(--owner-ink)]">Usage & billing</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close usage and billing"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--owner-line)] bg-[var(--owner-surface)] transition-colors hover:bg-[var(--owner-blush)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-focus)] motion-reduce:transition-none"
          >
            <X className="size-4 text-[var(--owner-muted)]" />
          </button>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto p-4 sm:p-5">
          {loading && (
            <p role="status" aria-live="polite" className="text-sm text-[var(--owner-muted)]">
              Loading usage…
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {usage && (
            <>
              {/* §6.5a status banner (G18): above the credit meter whenever a
                  subscription exists and its status is not the ordinary
                  "active" case — amber when it also stops new grants. */}
              {usage.plan !== null && usage.plan.entitlement.status !== 'active' && (
                <p
                  role="status"
                  aria-live="polite"
                  className={
                    usage.plan.entitlement.grantsEligible
                      ? 'rounded-lg bg-blue-50 p-3 text-sm text-blue-800'
                      : 'rounded-lg bg-amber-50 p-3 text-sm text-amber-800'
                  }
                >
                  {usage.plan.entitlement.label}
                </p>
              )}

              {/* §10.2: one primary number first. */}
              <section aria-labelledby="credits-heading" className="owner-card space-y-3 p-5">
                <h3 id="credits-heading" className="sr-only">SMS credits</h3>
                <p className="owner-title text-[30px] leading-tight text-[var(--owner-ink)]">
                  {usage.availableCredits}
                  {' '}
                  SMS credits remaining
                </p>
                <ul className="space-y-1 text-sm text-[var(--owner-muted)]">
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
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    {usage.blockedMessages}
                    {' '}
                    text
                    {usage.blockedMessages === 1 ? ' is' : 's are'}
                    {' '}
                    waiting for credits. Email delivery continues.
                  </p>
                )}
                {usage.pendingCredits !== undefined && usage.pendingCredits > 0 && (
                  <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                    {usage.pendingCredits}
                    {' '}
                    credit
                    {usage.pendingCredits === 1 ? ' is' : 's are'}
                    {' '}
                    set aside for texts being sent.
                  </p>
                )}
              </section>

              {usage.plan === null && (
                <StarterSmsCreditsCard
                  key={data!.salonId}
                  salonId={data!.salonId}
                  hasKnownStarterCredits={usage.starterCredits > 0}
                  onClaimed={refreshUsage}
                />
              )}

              <section aria-labelledby="plan-heading" className="owner-card space-y-3 p-5">
                <h3 id="plan-heading" className="text-base font-semibold text-[var(--owner-ink)]">{usage.coreAccess ? 'Core app & optional usage' : 'Plan'}</h3>
                {usage.coreAccess?.status === 'active' && (
                  <div className="rounded-2xl bg-[var(--owner-blush)] p-4 text-sm leading-relaxed text-[var(--owner-ink)]">
                    <p className="font-semibold">Founding Salon · Free for life</p>
                    <p className="mt-1">$0/month for the core Luster app. Unlimited emails included.</p>
                    <p className="mt-1 text-[var(--owner-muted)]">Additional texts, AI receptionist, calls and other usage services are optional paid add-ons.</p>
                  </div>
                )}
                {usage.plan === null
                  ? <p className="text-sm text-[var(--owner-muted)]">{usage.coreAccess ? 'No text subscription. Your included and purchased text credits remain available.' : 'No subscription — starter and purchased credits only.'}</p>
                  : (
                      <p className="text-sm text-[var(--owner-muted)]">
                        {usage.coreAccess && 'Optional text subscription: '}
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
                  className="owner-action disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                >
                  {portalLoading ? 'Opening…' : 'Manage billing'}
                </button>
                <p role="status" aria-live="polite" className="text-sm text-red-600">{portalError ?? ''}</p>
              </section>

              {data!.creditPurchasesAvailable === true && data!.topupOffers.length > 0
                ? (
                    <section aria-labelledby="buymore-heading" className="owner-card space-y-3 p-5">
                      <h3 id="buymore-heading" className="text-base font-semibold text-[var(--owner-ink)]">Buy more credits</h3>
                      <div className="flex flex-wrap gap-2">
                        {data!.topupOffers.map(offer => (
                          <button
                            key={offer.key}
                            type="button"
                            onClick={() => buyTopup(offer.key)}
                            disabled={buying !== null}
                            className="owner-action disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                          >
                            {buying === offer.key ? 'Opening…' : `${offer.credits} credits — $${(offer.priceCents / 100).toFixed(2)}`}
                          </button>
                        ))}
                      </div>
                      <p role="status" aria-live="polite" className="text-sm text-red-600">{buyError ?? ''}</p>
                      <p className="text-sm text-[var(--owner-muted)]">Purchased credits never expire. Prices in CAD, plus applicable taxes.</p>
                    </section>
                  )
                : (
                    <p className="text-sm text-[var(--owner-muted)]">Credit purchases are not available yet.</p>
                  )}

              {/* Top-ups (G17): purchase history read back from the
                  dark-gated /api/billing/topups route. */}
              <section aria-labelledby="topups-heading" className="owner-card space-y-3 p-5">
                <h3 id="topups-heading" className="text-base font-semibold text-[var(--owner-ink)]">Top-ups</h3>
                {topupsLoading && (
                  <p role="status" aria-live="polite" className="text-sm text-[var(--owner-muted)]">Loading top-ups…</p>
                )}
                {!topupsLoading && topupsAvailable === false && (
                  <p className="text-sm text-[var(--owner-muted)]">Top-up history is not available yet.</p>
                )}
                {!topupsLoading && topupsAvailable === true && (
                  <>
                    {(topups ?? []).length === 0
                      ? <p className="text-sm text-[var(--owner-muted)]">No top-ups yet.</p>
                      : (
                          <ul className="divide-y divide-[var(--owner-line)]">
                            {(topups ?? []).map(item => (
                              <li key={item.id} className="space-y-0.5 py-2 text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="text-[var(--owner-ink)]">
                                    {item.credits}
                                    {' '}
                                    credits — $
                                    {(item.priceCents / 100).toFixed(2)}
                                  </span>
                                  <span className="text-[var(--owner-muted)]">{TOPUP_STATUS_LABELS[item.status]}</span>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--owner-muted)]">
                                  <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                                  {item.holdState === 'held' && (
                                    <span className="text-amber-700">held — being reconciled</span>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                    {topupsError && <p role="status" aria-live="polite" className="text-sm text-red-600">{topupsError}</p>}
                    {topupsCursor !== null && (
                      <button
                        type="button"
                        onClick={loadMoreTopups}
                        disabled={topupsLoadingMore}
                        className="owner-action disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                      >
                        {topupsLoadingMore ? 'Loading…' : 'Load more'}
                      </button>
                    )}
                  </>
                )}
              </section>

              <section aria-labelledby="history-heading" className="owner-card space-y-3 p-5">
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <h3 id="history-heading" className="text-base font-semibold text-[var(--owner-ink)]">Message history</h3>
                  <label className="sr-only" htmlFor="history-filter">Filter message history</label>
                  <select
                    id="history-filter"
                    value={historyFilter}
                    onChange={event => setHistoryFilter(event.target.value as HistoryCategory)}
                    className="h-12 w-full min-w-0 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-focus)] sm:w-auto"
                  >
                    <option value="all">All messages</option>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                {data!.history.length === 0 && (
                  <p className="text-sm text-[var(--owner-muted)]">No messages yet.</p>
                )}
                {(Object.keys(CATEGORY_LABELS) as Array<Exclude<HistoryCategory, 'all'>>).map(category => (
                  (historyFilter === 'all' || historyFilter === category) && groupedHistory[category].length > 0
                    ? (
                        <div key={category} className="space-y-1">
                          <h4 className="text-sm font-medium text-[var(--owner-muted)]">{CATEGORY_LABELS[category]}</h4>
                          <ul className="divide-y divide-[var(--owner-line)]">
                            {groupedHistory[category].map(entry => (
                              <li key={entry.id} className="space-y-1 py-2 text-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-[var(--owner-ink)]">
                                    {EVENT_LABELS[entry.eventType] ?? 'Message'}
                                    {' · '}
                                    {entry.channel === 'sms' ? 'Text' : 'Email'}
                                  </span>
                                  <span className="shrink-0 text-[var(--owner-muted)]">{STATUS_LABELS[entry.status] ?? entry.status}</span>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[var(--owner-muted)]">
                                  <span>{entry.recipient}</span>
                                  <span className="shrink-0">{new Date(entry.scheduledFor).toLocaleString()}</span>
                                </div>
                                <p className="text-sm text-[var(--owner-muted)]">{creditLabel(entry)}</p>
                                {entry.failureReason !== null && (
                                  <p className="text-sm text-amber-700">{entry.failureReason}</p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    : null
                ))}
                {historyError && <p role="status" aria-live="polite" className="text-sm text-red-600">{historyError}</p>}
                {data!.nextCursor !== null && (
                  <button
                    type="button"
                    onClick={loadMoreHistory}
                    disabled={loadingMoreHistory}
                    className="owner-action disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                  >
                    {loadingMoreHistory ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
