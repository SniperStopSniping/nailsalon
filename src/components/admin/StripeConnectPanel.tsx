'use client';

import { CreditCard } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

type ConnectStatus =
  | 'not_connected'
  | 'onboarding_incomplete'
  | 'action_needed_soon'
  | 'charge_ready'
  | 'restricted'
  | 'blocked_needs_support'
  | 'revoked'
  | 'mode_mismatch';

type StripeConnect = {
  salonId: string;
  visible: boolean;
  status: ConnectStatus;
  chargeReady: boolean;
  payoutsPending: boolean;
  requirements?: { currentlyDue?: string[]; pastDue?: string[] } | null;
  lastSyncedAt?: string | null;
  hasBindingHistory: boolean;
};

const LABELS: Record<ConnectStatus, string> = {
  not_connected: 'Not connected',
  onboarding_incomplete: 'Continue setup',
  action_needed_soon: 'Verification required',
  charge_ready: 'Ready for deposits',
  restricted: 'Action required',
  blocked_needs_support: 'Needs support',
  revoked: 'Disconnected',
  mode_mismatch: 'Unavailable',
};

function isStripeConnect(value: unknown): value is StripeConnect {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<StripeConnect>;
  return candidate.visible === true && typeof candidate.salonId === 'string' && typeof candidate.status === 'string';
}

/** The canonical editor for a salon's Stripe Connect and payout readiness. */
export function StripeConnectPanel({ salonSlug }: { salonSlug: string | null }) {
  const [connect, setConnect] = useState<StripeConnect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setConnect(null);

    if (!salonSlug) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(
        `/api/integrations/health?salonSlug=${encodeURIComponent(salonSlug)}`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`health ${response.status}`);
      }
      // A salon switch can resolve requests out of order. Never render a prior
      // salon's account-link target in the currently selected salon.
      if (version !== requestVersion.current) {
        return;
      }
      setConnect(isStripeConnect(payload?.data?.stripeConnect) ? payload.data.stripeConnect : null);
    } catch {
      if (version === requestVersion.current) {
        setError('Payment status could not be loaded. Try again shortly.');
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, [salonSlug]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  const startSetup = async () => {
    if (!connect || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Preserve the established server-owned account-link flow and exact body.
      const response = await fetch('/api/integrations/stripe-connect/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: connect.salonId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.url) {
        throw new Error('onboard');
      }
      window.location.href = payload.url;
    } catch {
      setError('Payment setup could not be started. Try again shortly.');
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="px-1 py-4 text-sm text-[var(--owner-muted)]">Loading payment status…</p>;
  }

  if (error) {
    return (
      <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p>{error}</p>
        <button type="button" onClick={() => void load()} className="mt-2 min-h-11 font-semibold underline">
          Try again
        </button>
      </div>
    );
  }

  if (!connect) {
    return (
      <p className="px-1 py-4 text-sm text-[var(--owner-muted)]">
        Clients pay you in person (cash, card, or e-Transfer). Luster does not process client payments.
      </p>
    );
  }

  const tone = connect.status === 'charge_ready'
    ? 'bg-emerald-100 text-emerald-900'
    : connect.status === 'restricted' || connect.status === 'blocked_needs_support' || connect.status === 'mode_mismatch'
      ? 'bg-red-100 text-red-800'
      : 'bg-amber-100 text-amber-900';
  const canSetup = ['not_connected', 'onboarding_incomplete', 'action_needed_soon', 'restricted', 'revoked'].includes(connect.status);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm" data-testid="payments-connect-panel">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800"><CreditCard size={22} /></span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <strong>Stripe & Payouts</strong>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{LABELS[connect.status]}</span>
            </span>
            <span className="mt-1 block text-sm text-[var(--owner-muted)]">Connect your Stripe account to accept deposits and receive payouts.</span>
          </span>
        </div>
        {connect.status === 'charge_ready' && connect.payoutsPending && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Payouts are not switched on yet. Stripe is still reviewing your bank details.</p>}
        {['restricted', 'action_needed_soon', 'onboarding_incomplete'].includes(connect.status) && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--owner-muted)]">{(connect.requirements?.pastDue ?? []).concat(connect.requirements?.currentlyDue ?? []).slice(0, 5).map(item => <li key={item}>{item.replaceAll('_', ' ').replaceAll('.', ' → ')}</li>)}</ul>}
        {connect.status === 'mode_mismatch' && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">Payments are unavailable in this environment. Contact support.</p>}
        {connect.status === 'blocked_needs_support' && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">Stripe cannot finish verifying this account automatically. Contact support and we will take it from here.</p>}
        {canSetup && <button type="button" data-testid="payments-setup-button" onClick={() => void startSetup()} disabled={busy} className="mt-3 min-h-11 w-full rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{connect.status === 'not_connected' ? 'Set up payments' : connect.status === 'revoked' ? 'Reconnect' : 'Resume onboarding'}</button>}
        {connect.lastSyncedAt === null && connect.hasBindingHistory && <p className="mt-2 text-xs text-[var(--owner-line-strong)]">Status not confirmed yet.</p>}
      </div>
    </div>
  );
}
