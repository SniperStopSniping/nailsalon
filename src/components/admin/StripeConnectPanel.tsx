'use client';

import { CreditCard, RefreshCw } from 'lucide-react';
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

type ReadinessSnapshot = Pick<StripeConnect, 'status' | 'chargeReady' | 'requirements' | 'lastSyncedAt'> & {
  payoutsPending: boolean | null;
  stale: boolean;
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
  return candidate.visible === true && typeof candidate.salonId === 'string'
    && typeof candidate.status === 'string' && Object.hasOwn(LABELS, candidate.status);
}

function isReadinessSnapshot(value: unknown): value is ReadinessSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ReadinessSnapshot>;
  const requirements = candidate.requirements;
  return typeof candidate.status === 'string' && Object.hasOwn(LABELS, candidate.status)
    && typeof candidate.chargeReady === 'boolean' && typeof candidate.stale === 'boolean'
    && (candidate.payoutsPending === null || typeof candidate.payoutsPending === 'boolean')
    && (candidate.lastSyncedAt === null || (typeof candidate.lastSyncedAt === 'string' && Number.isFinite(Date.parse(candidate.lastSyncedAt))))
    && (requirements === null || (typeof requirements === 'object'
      && [requirements.currentlyDue, requirements.pastDue].every(items => items === undefined || (Array.isArray(items) && items.every(item => typeof item === 'string')))));
}

/** The canonical editor for a salon's Stripe Connect and payout readiness. */
export function StripeConnectPanel({ salonSlug }: { salonSlug: string | null }) {
  const [connect, setConnect] = useState<StripeConnect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'setup' | 'refresh' | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<'success' | 'unconfirmed' | null>(null);
  const pendingAction = useRef(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setConnect(null);
    setBusy(null);
    setRefreshNotice(null);
    pendingAction.current = false;

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
    if (!connect || pendingAction.current) {
      return;
    }
    const version = requestVersion.current;
    pendingAction.current = true;
    setBusy('setup');
    setError(null);
    try {
      // Preserve the established server-owned account-link flow and exact body.
      const response = await fetch('/api/integrations/stripe-connect/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: connect.salonId }),
      });
      const payload = await response.json().catch(() => null);
      if (version !== requestVersion.current) {
        return;
      }
      if (!response.ok || !payload?.url) {
        throw new Error('onboard');
      }
      window.location.href = payload.url;
    } catch {
      if (version === requestVersion.current) {
        setError('Payment setup could not be started. Try again shortly.');
        setBusy(null);
        pendingAction.current = false;
      }
    }
  };

  const refreshStatus = async () => {
    if (!connect || pendingAction.current) {
      return;
    }
    const version = requestVersion.current;
    const selected = connect;
    pendingAction.current = true;
    setBusy('refresh');
    setRefreshNotice(null);
    try {
      const response = await fetch('/api/integrations/stripe-connect/refresh-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId: selected.salonId }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (version !== requestVersion.current) {
        return;
      }
      if (!response.ok || !isReadinessSnapshot(payload)) {
        throw new Error('refresh');
      }
      setConnect({
        ...selected,
        status: payload.status,
        chargeReady: payload.chargeReady,
        payoutsPending: payload.payoutsPending ?? false,
        requirements: payload.requirements,
        lastSyncedAt: payload.lastSyncedAt,
      });
      setRefreshNotice(payload.stale ? 'unconfirmed' : 'success');
    } catch {
      if (version === requestVersion.current) {
        setRefreshNotice('unconfirmed');
      }
    } finally {
      if (version === requestVersion.current) {
        setBusy(null);
        pendingAction.current = false;
      }
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
      <div className="owner-card p-5" data-testid="payments-connect-panel">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--owner-blush)] text-[var(--owner-accent)]"><CreditCard aria-hidden="true" size={22} /></span>
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
        {canSetup && <button type="button" data-testid="payments-setup-button" onClick={() => void startSetup()} disabled={busy !== null} className="owner-action owner-action--primary mt-5 min-h-12 w-full disabled:cursor-not-allowed disabled:opacity-60">{connect.status === 'not_connected' ? 'Set up payments' : connect.status === 'revoked' ? 'Reconnect' : 'Resume onboarding'}</button>}
        {connect.hasBindingHistory && (
          <div className="mt-4 border-t border-[var(--owner-line)] pt-4">
            <p className="text-sm text-[var(--owner-muted)]">
              {connect.lastSyncedAt && Number.isFinite(Date.parse(connect.lastSyncedAt))
                ? (
                    <>
                      Last checked
                      {' '}
                      <time dateTime={connect.lastSyncedAt}>{new Date(connect.lastSyncedAt).toLocaleString()}</time>
                    </>
                  )
                : 'Status not confirmed yet.'}
            </p>
            <button type="button" onClick={() => void refreshStatus()} disabled={busy !== null} className="owner-action mt-3 min-h-11 w-full gap-2 disabled:cursor-not-allowed disabled:opacity-60">
              <RefreshCw aria-hidden="true" size={18} />
              {busy === 'refresh' ? 'Checking status…' : 'Check status again'}
            </button>
            {refreshNotice === 'success' && <p role="status" className="mt-3 text-sm text-[var(--owner-muted)]">Payment status is up to date.</p>}
            {refreshNotice === 'unconfirmed' && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Could not confirm your payment status with Stripe. Showing the last saved status. Try checking again shortly.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
