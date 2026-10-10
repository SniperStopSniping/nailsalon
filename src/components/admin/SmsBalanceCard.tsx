'use client';

import { ArrowRight, MessageSquare, Plus } from 'lucide-react';

import { useSmsCredits } from '@/hooks/useSmsCredits';
import { smsCreditShortcutFocusKey } from '@/libs/ownerNavigation';
import { SMS_CREDIT_STATUS_COPY } from '@/libs/smsCreditStatus';

import { StarterSmsCreditsCard } from './StarterSmsCreditsCard';

export function SmsBalanceCard({ salonSlug, onBuy, onHistory, compact = false }: { salonSlug: string; onBuy: () => void; onHistory?: () => void; compact?: boolean }) {
  const { data, loading, error, refresh } = useSmsCredits(salonSlug);
  const balance = data?.balance;
  if (compact && (!balance || balance.status === 'healthy' || balance.status === 'low')) {
    return null;
  }
  const remaining = balance ? Math.max(0, balance.availableCredits) : null;
  const copy = balance ? SMS_CREDIT_STATUS_COPY[balance.status] : null;
  const percent = balance?.allocationCredits ? Math.max(0, Math.min(100, balance.availableCredits / balance.allocationCredits * 100)) : null;
  if (compact && balance) {
    return (
      <section className="owner-card flex flex-wrap items-center justify-between gap-3 border-[var(--owner-accent)] p-4" aria-label="Low text balance">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[var(--owner-accent)]">
            {remaining?.toLocaleString()}
            {' '}
            texts remaining
          </p>
          <p className="mt-1 text-sm text-[var(--owner-muted)]">{remaining === 0 ? 'Add credits to send SMS. Booking and email remain available.' : 'Top up to keep your next reminders going.'}</p>
        </div>
        <button type="button" data-dialog-return-focus-key={smsCreditShortcutFocusKey(salonSlug, 'today', 'topup')} className="owner-action owner-action--primary shrink-0" onClick={onBuy}>
          Buy texts
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </section>
    );
  }
  return (
    <section className="owner-card overflow-hidden p-5" aria-labelledby="sms-balance-heading" data-testid="sms-balance-card">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--owner-blush)] text-[var(--owner-accent)]"><MessageSquare size={20} strokeWidth={1.7} aria-hidden="true" /></span>
        <h2 id="sms-balance-heading" className="text-base font-semibold">Text Message Balance</h2>
      </div>
      {loading && <p className="py-5 text-sm text-[var(--owner-muted)]" role="status">Loading your text balance…</p>}
      {error && (
        <div className="py-4">
          <p role="status" className="text-sm text-[var(--owner-muted)]">Your balance is unavailable right now.</p>
          <button className="owner-action mt-2" type="button" onClick={() => void refresh()}>Try again</button>
        </div>
      )}
      {balance && (
        <>
          <p className="mb-3 mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <strong className="owner-title break-all text-5xl tabular-nums">{remaining?.toLocaleString()}</strong>
            <span className="text-sm text-[var(--owner-muted)]">{balance.allocationCredits ? `of ${balance.allocationCredits.toLocaleString()} texts remaining` : 'texts remaining'}</span>
          </p>
          {percent !== null ? <div role="progressbar" aria-label="Texts remaining in this allocation" aria-valuemin={0} aria-valuemax={balance.allocationCredits!} aria-valuenow={remaining!} className="h-2 overflow-hidden rounded-full bg-[var(--owner-blush)]"><div className="h-full rounded-full bg-[var(--owner-accent)]" style={{ width: `${percent}%` }} /></div> : <div aria-hidden="true" className="flex gap-1.5">{[0, 1, 2, 3].map(i => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < ({ empty: 0, critical: 1, low: 2, healthy: 4 }[balance.status]) ? 'bg-[var(--owner-accent)]' : 'bg-[var(--owner-blush)]'}`} />)}</div>}
          <p className={`mt-3 text-sm ${balance.status === 'healthy' ? 'text-[var(--owner-muted)]' : 'font-semibold text-[var(--owner-accent)]'}`}>{copy?.title}</p>
          {copy?.detail && <p className="mt-1 text-sm leading-relaxed text-[var(--owner-muted)]">{copy.detail}</p>}
          {balance.pendingCredits > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--owner-muted)]">
              {balance.pendingCredits.toLocaleString()}
              {' '}
              credits reserved for queued texts, already excluded above.
            </p>
          )}
        </>
      )}
      {data && <StarterSmsCreditsCard key={data.salonId} salonId={data.salonId} onClaimed={refresh} inline />}
      <button type="button" data-dialog-return-focus-key={smsCreditShortcutFocusKey(salonSlug, 'more', 'topup')} onClick={onBuy} className={`owner-action mt-4 w-full ${balance?.status === 'healthy' ? '' : 'owner-action--primary'}`}>
        <Plus size={17} aria-hidden="true" />
        Buy More Texts
      </button>
      {onHistory && (
        <button type="button" data-dialog-return-focus-key={smsCreditShortcutFocusKey(salonSlug, 'more', 'history')} onClick={onHistory} className="mt-1 flex min-h-11 w-full items-center justify-center gap-2 text-sm font-semibold text-[var(--owner-accent)]">
          View usage history
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
