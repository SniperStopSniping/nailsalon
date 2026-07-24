'use client';

import {
  CalendarPlus,
  ChevronRight,
  Clock3,
  MessageCircle,
  RotateCcw,
  UserPlus,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';
import {
  buildClientSmsMessage,
  buildNativeSmsUrl,
  detectNativeSmsPlatform,
} from '@/libs/clientSmsComposer';
import { notifyRetentionDataChanged } from '@/libs/dashboardEvents';
import { useSalon } from '@/providers/SalonProvider';
import {
  CLIENT_INSIGHT_SEGMENT_LABELS,
  type ClientInsightAttentionItem,
  type ClientInsightKpiId,
  type ClientInsightsData,
  type ClientInsightSegmentId,
} from '@/types/clientInsights';
import type {
  ClientCommunicationKind,
  ClientCommunicationStatus,
} from '@/types/retention';

const KPI_CONFIG: Array<{
  id: ClientInsightKpiId;
  label: string;
  description: string;
  icon: typeof Users;
  accent: string;
}> = [
  {
    id: 'active',
    label: 'Active clients',
    description: 'Visited in 90 days or booked ahead',
    icon: Users,
    accent: 'bg-emerald-50 text-emerald-800',
  },
  {
    id: 'new_this_month',
    label: 'New this month',
    description: 'First completed visit this month',
    icon: UserPlus,
    accent: 'bg-rose-50 text-rose-800',
  },
  {
    id: 'due_to_return',
    label: 'Due to return',
    description: 'Due soon or due now',
    icon: RotateCcw,
    accent: 'bg-amber-50 text-amber-800',
  },
  {
    id: 'overdue',
    label: 'Overdue',
    description: 'More than 7 days past due',
    icon: Clock3,
    accent: 'bg-red-50 text-red-800',
  },
];

const ATTENTION_SEGMENTS: ClientInsightSegmentId[] = [
  'needs_rebooking',
  'no_future_appointment',
  'first_time_no_return',
  'recent_cancellation',
  'not_seen_30',
  'not_seen_60',
  'inactive_90',
  'completed_outstanding',
];

type DraftState = {
  item: ClientInsightAttentionItem;
  kind: ClientCommunicationKind;
  body: string;
};

function formatDate(value: string | null, timeZone: string): string {
  if (!value) {
    return 'No completed visit';
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function reasonDescription(item: ClientInsightAttentionItem): string {
  if (item.primaryReason === 'completed_outstanding') {
    return 'Completed balance to review';
  }
  return CLIENT_INSIGHT_SEGMENT_LABELS[item.primaryReason];
}

function openClientInsightsNativeUrl(href: string): void {
  window.location.assign(href);
}

function Skeleton() {
  return (
    <div className="space-y-5" aria-label="Loading Client Insights" role="status">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map(index => (
          <div key={index} className="h-32 animate-pulse rounded-3xl bg-white/80" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-3xl bg-white/80" />
      <span className="sr-only">Loading Client Insights…</span>
    </div>
  );
}

export function ClientInsightsPanel({
  onOpenClient,
  onOpenSegment,
  onBookClient,
  refreshKey = 0,
  onOpenNativeUrl = openClientInsightsNativeUrl,
}: {
  onOpenClient: (clientId: string) => void;
  onOpenSegment: (segment: ClientInsightSegmentId) => void;
  onBookClient: (client: ClientInsightAttentionItem) => void;
  refreshKey?: number;
  onOpenNativeUrl?: (href: string) => void;
}) {
  const { salonSlug, salonName } = useSalon();
  const [data, setData] = useState<ClientInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<DraftState | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!salonSlug) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/client-insights?salonSlug=${encodeURIComponent(salonSlug)}`,
        { cache: 'no-store' },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error?.message ?? 'Could not load Client Insights.');
      }
      setData(payload.data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load Client Insights.',
      );
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const segmentCounts = useMemo(
    () => new Map(data?.segments.map(segment => [segment.id, segment.count]) ?? []),
    [data?.segments],
  );

  const recordOutreach = useCallback(async (
    state: DraftState,
    status: ClientCommunicationStatus,
  ) => {
    const response = await fetch('/api/admin/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: status === 'prepared',
      body: JSON.stringify({
        salonSlug,
        clientId: state.item.clientId,
        kind: state.kind,
        status,
        ...(state.body ? { messageSnapshot: state.body } : {}),
        ...(status === 'snoozed' ? { snoozeDays: 7 } : {}),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? 'Could not update this follow-up.');
    }
    notifyRetentionDataChanged();
  }, [salonSlug]);

  const prepareText = useCallback((item: ClientInsightAttentionItem) => {
    const isRebooking = item.reasons.some(reason =>
      ['due_soon', 'due_now', 'overdue'].includes(reason));
    const kind: ClientCommunicationKind = isRebooking
      ? item.outreachStage ?? 'rebook'
      : 'generic_text';
    const body = buildClientSmsMessage(isRebooking ? 'rebook' : 'text', {
      client: { name: item.clientName, phone: item.phone },
      salon: { name: salonName },
    });
    if (!body) {
      setActionError('This client needs a valid mobile number before a text can be prepared.');
      return;
    }
    setActionError(null);
    setDraft({ item, kind, body });
  }, [salonName]);

  const openDraft = useCallback(async () => {
    if (!draft || actionBusy) {
      return;
    }
    const href = buildNativeSmsUrl({
      phone: draft.item.phone,
      body: draft.body,
      platform: detectNativeSmsPlatform(window.navigator.userAgent),
    });
    if (!href) {
      setActionError('This client needs a valid mobile number before a text can be prepared.');
      return;
    }
    setActionBusy(`text-${draft.item.clientId}`);
    try {
      await recordOutreach(draft, 'prepared');
      setPendingOutcome(draft);
      setDraft(null);
      onOpenNativeUrl(href);
    } catch (recordError) {
      setActionError(
        recordError instanceof Error
          ? recordError.message
          : 'Could not prepare this text.',
      );
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, draft, onOpenNativeUrl, recordOutreach]);

  const finishOutcome = useCallback(async (
    status: Extract<ClientCommunicationStatus, 'marked_sent' | 'not_sent'>,
  ) => {
    if (!pendingOutcome || actionBusy) {
      return;
    }
    setActionBusy(`outcome-${pendingOutcome.item.clientId}`);
    try {
      await recordOutreach(pendingOutcome, status);
      setPendingOutcome(null);
      if (status === 'marked_sent') {
        await load();
      }
    } catch (recordError) {
      setActionError(
        recordError instanceof Error
          ? recordError.message
          : 'Could not record the text outcome.',
      );
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, load, pendingOutcome, recordOutreach]);

  const resolveRetention = useCallback(async (
    item: ClientInsightAttentionItem,
    status: Extract<ClientCommunicationStatus, 'snoozed' | 'dismissed' | 'converted'>,
  ) => {
    if (!item.outreachStage || actionBusy) {
      return;
    }
    const state: DraftState = {
      item,
      kind: item.outreachStage,
      body: '',
    };
    setActionBusy(`${status}-${item.clientId}`);
    setActionError(null);
    try {
      await recordOutreach(state, status);
      await load();
    } catch (recordError) {
      setActionError(
        recordError instanceof Error
          ? recordError.message
          : 'Could not update this follow-up.',
      );
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, load, recordOutreach]);

  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 pb-12"
      data-testid="client-hub"
      data-surface="client-insights"
    >
      {loading && !data && <Skeleton />}

      {!loading && error && !data && (
        <div
          role="alert"
          className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm text-red-900"
        >
          <p className="font-semibold">Client Insights could not load</p>
          <p className="mt-1">{error}</p>
          <button
            type="button"
            className="mt-4 min-h-11 rounded-full bg-red-900 px-5 text-sm font-semibold text-white"
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      )}

      {data && (
        <>
          <section aria-labelledby="client-health-heading">
            <div className="mb-3">
              <h2 id="client-health-heading" className="text-xl font-semibold text-[#4a1f31]">
                Client health
              </h2>
              <p className="mt-1 text-sm text-stone-600">
                Open any group to see the exact matching clients.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {KPI_CONFIG.map((kpi) => {
                const Icon = kpi.icon;
                return (
                  <button
                    key={kpi.id}
                    type="button"
                    data-testid={`client-insights-kpi-${kpi.id}`}
                    onClick={() => onOpenSegment(kpi.id)}
                    className="min-w-0 rounded-3xl border border-rose-100 bg-white p-4 text-left shadow-[0_10px_30px_rgba(83,37,54,0.06)] transition hover:-translate-y-0.5 hover:border-rose-200 focus:outline-none focus:ring-2 focus:ring-rose-400"
                  >
                    <span className={`flex size-10 items-center justify-center rounded-2xl ${kpi.accent}`}>
                      <Icon size={19} />
                    </span>
                    <strong className="mt-4 block text-3xl font-semibold text-[#3f1727]">
                      {data.kpis[kpi.id]}
                    </strong>
                    <span className="mt-1 block text-sm font-semibold text-stone-900">
                      {kpi.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-stone-500">
                      {kpi.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="needs-attention-heading">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 id="needs-attention-heading" className="text-xl font-semibold text-[#4a1f31]">
                  Needs attention
                </h2>
                <p className="mt-1 text-sm text-stone-600">
                  Practical groups for rebooking and follow-up.
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {ATTENTION_SEGMENTS.map(segment => (
                <button
                  key={segment}
                  type="button"
                  data-testid={`client-insights-segment-${segment}`}
                  onClick={() => onOpenSegment(segment)}
                  className="flex min-h-16 min-w-0 items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-[#fffaf5] px-4 py-3 text-left transition hover:border-rose-200 hover:bg-white focus:outline-none focus:ring-2 focus:ring-rose-400"
                >
                  <span className="min-w-0 text-sm font-medium text-stone-800">
                    {CLIENT_INSIGHT_SEGMENT_LABELS[segment]}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-[#7a2948]">
                    {segmentCounts.get(segment) ?? 0}
                    <ChevronRight size={16} />
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="follow-up-heading"
            className="overflow-hidden rounded-3xl border border-rose-100 bg-white shadow-[0_12px_36px_rgba(83,37,54,0.07)]"
          >
            <div className="border-b border-rose-100 bg-gradient-to-r from-[#fff7f1] to-rose-50/60 px-5 py-4">
              <h2 id="follow-up-heading" className="text-lg font-semibold text-[#4a1f31]">
                Follow up next
              </h2>
              <p className="mt-1 text-sm text-stone-600">
                Highest-priority clients, with each client shown once.
              </p>
            </div>

            {data.attention.items.length === 0
              ? (
                  <div className="px-5 py-10 text-center">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                      <Users size={21} />
                    </div>
                    <p className="mt-3 font-semibold text-stone-900">Nothing urgent right now</p>
                    <p className="mt-1 text-sm text-stone-500">
                      New follow-ups will appear as clients become due.
                    </p>
                  </div>
                )
              : data.attention.items.map((item, index) => (
                <article
                  key={item.clientId}
                  className={`p-4 sm:p-5 ${index > 0 ? 'border-t border-stone-100' : ''}`}
                  data-testid={`client-insights-attention-${item.clientId}`}
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => onOpenClient(item.clientId)}
                      className="min-w-0 text-left focus:outline-none focus:ring-2 focus:ring-rose-400"
                    >
                      <span className="block truncate font-semibold text-stone-950">
                        {item.clientName || 'Client'}
                      </span>
                      <span className="mt-1 block text-sm font-medium text-[#8c3657]">
                        {reasonDescription(item)}
                      </span>
                      <span className="mt-1 block text-xs text-stone-500">
                        Last visit:
                        {' '}
                        {formatDate(item.lastVisitAt, data.timeZone)}
                      </span>
                    </button>
                    <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                      <button
                        type="button"
                        onClick={() => onOpenClient(item.clientId)}
                        className="min-h-10 rounded-full border border-stone-200 px-3 text-xs font-semibold text-stone-700"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => onBookClient(item)}
                        className="flex min-h-10 items-center justify-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-800"
                      >
                        <CalendarPlus size={14} />
                        Book
                      </button>
                      <button
                        type="button"
                        onClick={() => prepareText(item)}
                        className="flex min-h-10 items-center justify-center gap-1 rounded-full bg-[#6f2745] px-3 text-xs font-semibold text-white"
                      >
                        <MessageCircle size={14} />
                        Text
                      </button>
                    </div>
                  </div>
                  {item.outreachStage && (
                    <div className="mt-3 flex flex-wrap gap-4 pl-0 sm:justify-end">
                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => void resolveRetention(item, 'snoozed')}
                        className="text-xs font-semibold text-stone-600 underline disabled:opacity-50"
                      >
                        Snooze 7 days
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => void resolveRetention(item, 'dismissed')}
                        className="text-xs font-semibold text-stone-500 underline disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy !== null}
                        onClick={() => void resolveRetention(item, 'converted')}
                        className="text-xs font-semibold text-rose-800 underline disabled:opacity-50"
                      >
                        Mark complete
                      </button>
                    </div>
                  )}
                </article>
              ))}
          </section>

          {actionError && (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {actionError}
            </div>
          )}

          <p className="text-center text-xs text-stone-500">
            Updated
            {' '}
            {new Intl.DateTimeFormat('en-CA', {
              timeZone: data.timeZone,
              hour: 'numeric',
              minute: '2-digit',
            }).format(new Date(data.generatedAt))}
          </p>
        </>
      )}

      <DialogShell
        isOpen={Boolean(draft)}
        onClose={() => setDraft(null)}
        closeOnBackdrop={actionBusy === null}
        closeOnEscape={actionBusy === null}
      >
        {draft && (
          <div role="dialog" aria-modal="true" aria-labelledby="client-insights-text-title">
            <h2 id="client-insights-text-title" className="text-lg font-semibold text-stone-950">
              Review text
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              Edit the draft before opening your Messages app.
            </p>
            <textarea
              aria-label="Text message"
              value={draft.body}
              onChange={event => setDraft(current =>
                current ? { ...current, body: event.target.value } : current)}
              rows={7}
              className="mt-4 w-full rounded-2xl border border-stone-200 p-3 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-rose-300"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={actionBusy !== null}
                onClick={() => setDraft(null)}
                className="min-h-11 rounded-full px-4 text-sm font-semibold text-stone-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy !== null || !draft.body.trim()}
                onClick={() => void openDraft()}
                className="min-h-11 rounded-full bg-[#6f2745] px-5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Open Messages
              </button>
            </div>
          </div>
        )}
      </DialogShell>

      <DialogShell
        isOpen={Boolean(pendingOutcome)}
        onClose={() => {}}
        closeOnBackdrop={false}
        closeOnEscape={false}
      >
        {pendingOutcome && (
          <div role="dialog" aria-modal="true" aria-labelledby="client-insights-outcome-title">
            <h2 id="client-insights-outcome-title" className="text-lg font-semibold text-stone-950">
              Did you send the text?
            </h2>
            <p className="mt-2 text-sm text-stone-600">
              Opening Messages only prepares the text. Choose the actual result.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={actionBusy !== null}
                onClick={() => void finishOutcome('not_sent')}
                className="min-h-11 rounded-full border border-stone-200 px-4 text-sm font-semibold text-stone-700"
              >
                Not sent
              </button>
              <button
                type="button"
                disabled={actionBusy !== null}
                onClick={() => void finishOutcome('marked_sent')}
                className="min-h-11 rounded-full bg-[#6f2745] px-4 text-sm font-semibold text-white"
              >
                Mark sent
              </button>
            </div>
          </div>
        )}
      </DialogShell>
    </div>
  );
}

// Internal compatibility export while older imports and tests migrate.
export const ClientHubPanel = ClientInsightsPanel;
