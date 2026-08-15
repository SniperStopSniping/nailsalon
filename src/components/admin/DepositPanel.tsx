'use client';

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

type DepositRecord = {
  id: string;
  status: string;
  amountCents: number;
  currency: string;
  refundStatus: string | null;
  refundAmountCents?: number | null;
  externalRefundObservedCents?: number | null;
  refundLastErrorCode?: string | null;
  refundFailureReason?: string | null;
  refundTerminalFailureCount?: number;
  refundedAt?: string | null;
  forfeitedAt?: string | null;
  waivedAt?: string | null;
  waiverReason?: string | null;
};

type DepositAuditRow = {
  id: string;
  action: string;
  performedByRole: string | null;
  performedByName: string | null;
  reason: string | null;
  createdAt: string;
  newValue: Record<string, unknown> | null;
};

type DepositPanelData = {
  appointmentStatus: string | null;
  deposit: DepositRecord | null;
  deposits?: DepositRecord[];
  depositCredit?: {
    state: 'resolved' | 'blocked';
    blockedCode: string | null;
    blockedDetail: string | null;
    collectedCents: number;
    refundedCents: number;
    forfeitedCents: number;
    eligibleCents: number;
  };
  auditRows: DepositAuditRow[];
  moreOmitted: number;
};

type DepositAction = 'refund' | 'retry' | 'forfeit' | 'waive' | 'release';

const ACTION_COPY: Record<DepositAction, {
  title: string;
  confirmLabel: string;
  description: string;
  endpoint: string;
}> = {
  refund: {
    title: 'Refund this deposit?',
    confirmLabel: 'Refund deposit',
    description: 'Luster will request a full refund to the client’s original payment method. You can follow progress in this panel.',
    endpoint: 'refund',
  },
  retry: {
    title: 'Retry this refund?',
    confirmLabel: 'Retry refund',
    description: 'Luster will make another refund attempt using the current Stripe connection.',
    endpoint: 'refund/retry',
  },
  forfeit: {
    title: 'Retain this cancelled deposit?',
    confirmLabel: 'Retain deposit',
    description: 'This records an explicit owner decision to retain the collected deposit and freezes its tax-reporting estimate. You can still issue a full refund later.',
    endpoint: 'forfeit',
  },
  waive: {
    title: 'Waive this deposit?',
    confirmLabel: 'Waive deposit',
    description: 'The payment session will be closed and the appointment will be confirmed without requiring a deposit.',
    endpoint: 'waive',
  },
  release: {
    title: 'Release this hold?',
    confirmLabel: 'Release hold',
    description: 'The payment session will be closed and the appointment will be cancelled, making the time available again.',
    endpoint: 'release',
  },
};

function refundStatusLabel(status: string | null): string {
  switch (status) {
    case 'requested':
      return 'Refund requested';
    case 'pending':
      return 'Refund pending';
    case 'succeeded':
      return 'Refund succeeded';
    case 'failed':
      return 'Refund failed';
    default:
      return 'No refund in progress';
  }
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatAuditAction(action: string): string {
  return action.replaceAll('_', ' ');
}

export function DepositPanel({
  appointmentId,
  salonSlug,
}: {
  appointmentId: string;
  salonSlug: string | null | undefined;
}) {
  const [data, setData] = useState<DepositPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<DepositAction | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!salonSlug) {
      setData(null);
      setError('Choose a salon to view deposit details.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/appointments/${encodeURIComponent(appointmentId)}/deposit?salonSlug=${encodeURIComponent(salonSlug)}`,
        { signal },
      );
      const body = await response.json().catch(() => ({})) as {
        data?: DepositPanelData;
        deposit?: DepositRecord | null;
        deposits?: DepositRecord[];
        depositCredit?: DepositPanelData['depositCredit'];
        appointmentStatus?: string | null;
        auditRows?: DepositAuditRow[];
        moreOmitted?: number;
      };
      if (!response.ok) {
        throw new Error('Deposit details could not be loaded.');
      }
      const payload = body.data ?? {
        appointmentStatus: body.appointmentStatus ?? null,
        deposit: body.deposit ?? null,
        deposits: body.deposits ?? [],
        depositCredit: body.depositCredit,
        auditRows: body.auditRows ?? [],
        moreOmitted: body.moreOmitted ?? 0,
      };
      setData({
        appointmentStatus: payload.appointmentStatus ?? null,
        deposit: payload.deposit ?? null,
        deposits: payload.deposits ?? [],
        depositCredit: payload.depositCredit,
        auditRows: payload.auditRows ?? [],
        moreOmitted: payload.moreOmitted ?? 0,
      });
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') {
        return;
      }
      setError('Deposit details could not be loaded. Try again.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [appointmentId, salonSlug]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const runAction = useCallback(async () => {
    if (!pendingAction || !salonSlug) {
      return;
    }
    if ((pendingAction === 'forfeit' || pendingAction === 'waive' || pendingAction === 'release') && !reason.trim()) {
      setError('Add a short reason before continuing.');
      return;
    }

    setSaving(true);
    setError(null);
    const action = pendingAction;
    try {
      const response = await fetch(
        `/api/admin/appointments/${encodeURIComponent(appointmentId)}/deposit/${ACTION_COPY[action].endpoint}?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'POST',
          ...(action === 'forfeit' || action === 'waive' || action === 'release'
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: reason.trim() }),
              }
            : {}),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message || 'The deposit action could not be completed.');
      }
      setPendingAction(null);
      setReason('');
      await load();
    } catch (actionError) {
      // Close the confirmation so the server's fixed, actionable error copy is
      // visible in the panel immediately (including expire-first retry advice).
      setPendingAction(null);
      setError(actionError instanceof Error
        ? actionError.message
        : 'The deposit action could not be completed.');
    } finally {
      setSaving(false);
    }
  }, [appointmentId, load, pendingAction, reason, salonSlug]);

  const deposit = data?.deposit ?? null;
  const refundStatus = deposit?.refundStatus ?? null;
  const canRefund = deposit?.status === 'paid'
    && !['requested', 'pending', 'succeeded'].includes(refundStatus ?? '');
  const canRetry = refundStatus === 'failed';
  const canForfeit = data?.appointmentStatus === 'cancelled'
    && deposit?.status === 'paid'
    && deposit.forfeitedAt == null
    && refundStatus == null
    && data.depositCredit?.state === 'resolved';
  const canResolveHold = deposit?.status === 'checkout_created';

  return (
    <section
      data-testid="admin-deposit-panel"
      className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4"
      aria-label="Deposit and refund"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-neutral-900">Deposit and refund</div>
          {deposit && (
            <div className="mt-1 text-xs text-neutral-500">
              {formatMoney(deposit.amountCents, deposit.currency)}
            </div>
          )}
        </div>
        {!loading && (
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg p-2 text-neutral-500 hover:bg-white"
            aria-label="Refresh deposit details"
          >
            <RefreshCw className="size-4" />
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="size-4 animate-spin" />
          Loading deposit details…
        </div>
      )}

      {!loading && error && (
        <div className="mt-3 flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !deposit && !error && (
        <div className="mt-3 text-sm text-neutral-500">No deposit is attached to this appointment.</div>
      )}

      {!loading && deposit && (
        <>
          {data?.depositCredit?.state === 'blocked'
            ? (
                <div className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Deposit credit is paused for review.
                    {' '}
                    {data.depositCredit.blockedDetail}
                  </span>
                </div>
              )
            : data?.depositCredit
              ? (
                  <dl className="mt-3 grid gap-1 rounded-xl bg-white p-3 text-xs text-neutral-600">
                    <div className="flex justify-between gap-3">
                      <dt>Collected</dt>
                      <dd className="font-medium text-neutral-900">{formatMoney(data.depositCredit.collectedCents, deposit.currency)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Refunded</dt>
                      <dd className="font-medium text-neutral-900">{formatMoney(data.depositCredit.refundedCents, deposit.currency)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Retained</dt>
                      <dd className="font-medium text-neutral-900">{formatMoney(data.depositCredit.forfeitedCents, deposit.currency)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Eligible invoice credit</dt>
                      <dd className="font-medium text-neutral-900">{formatMoney(data.depositCredit.eligibleCents, deposit.currency)}</dd>
                    </div>
                  </dl>
                )
              : null}

          <div className={`mt-3 flex items-center gap-2 rounded-xl p-3 text-sm font-medium ${refundStatus === 'failed' ? 'bg-red-50 text-red-800' : refundStatus === 'succeeded' ? 'bg-emerald-50 text-emerald-800' : 'bg-white text-neutral-800'}`}>
            {refundStatus === 'succeeded'
              ? <CheckCircle2 className="size-4" />
              : refundStatus === 'failed'
                ? <AlertTriangle className="size-4" />
                : null}
            <span>{refundStatusLabel(refundStatus)}</span>
          </div>

          {refundStatus === 'failed' && (
            <dl className="mt-3 grid gap-1 text-xs text-neutral-600">
              <div className="flex justify-between gap-3">
                <dt>Error code</dt>
                <dd className="text-right font-medium text-neutral-800">{deposit.refundLastErrorCode ?? 'UNKNOWN_PROVIDER_ERROR'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Failure reason</dt>
                <dd className="text-right font-medium text-neutral-800">{deposit.refundFailureReason ?? 'unknown'}</dd>
              </div>
            </dl>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            {canRefund && (
              <button type="button" onClick={() => setPendingAction('refund')} className="rounded-xl bg-neutral-900 px-3 py-2.5 text-sm font-semibold text-white">
                Refund
              </button>
            )}
            {canRetry && (
              <button type="button" onClick={() => setPendingAction('retry')} className="rounded-xl bg-neutral-900 px-3 py-2.5 text-sm font-semibold text-white">
                Retry
              </button>
            )}
            {canForfeit && (
              <button type="button" onClick={() => setPendingAction('forfeit')} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900">
                Retain deposit
              </button>
            )}
            {canResolveHold && (
              <>
                <button type="button" onClick={() => setPendingAction('waive')} className="rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-900">
                  Waive
                </button>
                <button type="button" onClick={() => setPendingAction('release')} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-800">
                  Release
                </button>
              </>
            )}
          </div>
        </>
      )}

      {!loading && data && data.auditRows.length > 0 && (
        <div className="mt-5 border-t border-neutral-200 pt-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">Deposit history</div>
          <ol className="mt-2 space-y-2">
            {data.auditRows.map(row => (
              <li key={row.id} className="rounded-xl bg-white p-3 text-xs text-neutral-600">
                <div className="font-medium capitalize text-neutral-900">{formatAuditAction(row.action)}</div>
                <div className="mt-1">
                  {row.performedByName || row.performedByRole || 'System'}
                  {' · '}
                  {new Date(row.createdAt).toLocaleString()}
                </div>
                {row.reason && <div className="mt-1">{row.reason}</div>}
              </li>
            ))}
          </ol>
          {data.moreOmitted > 0 && (
            <div className="mt-2 text-xs text-neutral-500">
              {data.moreOmitted}
              {' '}
              older audit
              {' '}
              {data.moreOmitted === 1 ? 'entry is' : 'entries are'}
              {' '}
              omitted.
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingAction !== null}
        title={pendingAction ? ACTION_COPY[pendingAction].title : ''}
        description={pendingAction ? ACTION_COPY[pendingAction].description : undefined}
        confirmLabel={pendingAction ? ACTION_COPY[pendingAction].confirmLabel : 'Continue'}
        tone={pendingAction === 'release' ? 'danger' : 'default'}
        busy={saving}
        onClose={() => {
          setPendingAction(null);
          setReason('');
        }}
        onConfirm={() => void runAction()}
      >
        {(pendingAction === 'forfeit' || pendingAction === 'waive' || pendingAction === 'release') && (
          <label className="block" htmlFor="deposit-action-reason">
            <span className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-neutral-500">Reason</span>
            <textarea
              id="deposit-action-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm text-neutral-900"
              placeholder="Add a short internal reason"
            />
          </label>
        )}
      </ConfirmDialog>
    </section>
  );
}
