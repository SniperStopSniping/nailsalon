'use client';

import { useCallback, useEffect, useState } from 'react';

import { formatMoney } from '@/libs/formatMoney';
import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Client Hub — deeper information and reporting inside the Clients app.
// Overview / Follow-ups / Segments / Reports, all computed server-side from
// persisted data (finalized checkout values; tax never counted as revenue).
// Follow-ups render the SAME /api/admin/marketing groups as Marketing — one
// definition of "due". Missing data reads "Not enough data yet", never a fake
// trend. Admin-only by the underlying routes.
// =============================================================================

type HubTab = 'overview' | 'followups' | 'segments' | 'reports';

type HubData = {
  overview: {
    totalClients: number;
    newClientsThisMonth: number;
    returningClients: number;
    dueToReturn: number;
    overdue: number;
    noFutureAppointment: number;
    completedAppointments: number;
    cancellationRate: number | null;
    noShowRate: number | null;
    rebookingRate: number | null;
    topServices: Array<{ name: string | null; count: number }>;
    serviceRevenueCents: number;
    outstandingCents: number;
  };
  segments: Array<{ id: string; label: string; count: number }>;
  reports: {
    finishedAppointments: number;
    completed: number;
    cancelled: number;
    noShows: number;
    cancellationRate: number | null;
    noShowRate: number | null;
    rebookingRate: number | null;
    serviceRevenueCents: number;
    discountCents: number;
    taxCollectedCents: number;
    tipsCents: number;
    amountPaidCents: number;
    outstandingCents: number;
    promotionsMinted: number;
    promotionsRedeemed: number;
    topServices: Array<{ name: string | null; count: number }>;
  };
};

type FollowupGroups = {
  groups: Array<{
    id: string;
    title: string;
    items: Array<{
      clientId: string;
      clientName: string | null;
      stage: string;
      dueAt: string;
      lastServiceName: string | null;
      smsConsent: boolean;
    }>;
  }>;
};

const TABS: Array<{ id: HubTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'followups', label: 'Follow-ups' },
  { id: 'segments', label: 'Segments' },
  { id: 'reports', label: 'Reports' },
];

const NOT_ENOUGH = 'Not enough data yet';

function pct(value: number | null): string {
  return value === null ? NOT_ENOUGH : `${value}%`;
}

export function ClientHubPanel({ onOpenClient }: {
  onOpenClient?: (clientId: string) => void;
}) {
  const { salonSlug } = useSalon();
  const [tab, setTab] = useState<HubTab>('overview');
  const [hub, setHub] = useState<HubData | null>(null);
  const [followups, setFollowups] = useState<FollowupGroups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!salonSlug) {
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const [hubRes, marketingRes] = await Promise.all([
        fetch(`/api/admin/client-hub?salonSlug=${encodeURIComponent(salonSlug)}`),
        fetch(`/api/admin/marketing?salonSlug=${encodeURIComponent(salonSlug)}`),
      ]);
      const hubPayload = await hubRes.json().catch(() => null);
      if (!hubRes.ok || !hubPayload?.data) {
        throw new Error(hubPayload?.error?.message ?? 'Could not load the Client Hub.');
      }
      setHub(hubPayload.data);
      const marketingPayload = await marketingRes.json().catch(() => null);
      setFollowups(marketingPayload?.data?.followups ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the Client Hub.');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const card = 'rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]';

  const metric = (label: string, value: string | number) => (
    <div key={label} className="flex items-center justify-between py-1 text-[13px]">
      <span className="text-[#636366]">{label}</span>
      <span className="font-semibold text-[#1C1C1E]">{value}</span>
    </div>
  );

  return (
    <div className="space-y-3 px-4 pb-10" data-testid="client-hub">
      <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="client-hub-tabs">
        {TABS.map(entry => (
          <button
            key={entry.id}
            type="button"
            data-testid={`client-hub-tab-${entry.id}`}
            onClick={() => setTab(entry.id)}
            className={`min-h-9 shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${tab === entry.id ? 'bg-[#1C1C1E] text-white' : 'bg-white text-[#636366]'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {loading && <p className="py-6 text-center text-[13px] text-[#8E8E93]" role="status">Loading Client Hub…</p>}
      {!loading && error && (
        <div role="alert" className="rounded-[14px] border border-[#FF3B30]/30 bg-[#FF3B30]/10 p-3 text-[13px] text-[#D70015]">
          {error}
        </div>
      )}

      {!loading && hub && tab === 'overview' && (
        <div className="space-y-3" data-testid="client-hub-overview">
          <div className={card}>
            {metric('Total clients', hub.overview.totalClients)}
            {metric('New this month', hub.overview.newClientsThisMonth)}
            {metric('Returning', hub.overview.returningClients)}
            {metric('Due to return', hub.overview.dueToReturn)}
            {metric('Overdue', hub.overview.overdue)}
            {metric('No future appointment', hub.overview.noFutureAppointment)}
          </div>
          <div className={card}>
            {metric('Completed appointments', hub.overview.completedAppointments)}
            {metric('Cancellation rate', pct(hub.overview.cancellationRate))}
            {metric('No-show rate', pct(hub.overview.noShowRate))}
            {metric('Rebooking rate', pct(hub.overview.rebookingRate))}
            {metric('Final service revenue', formatMoney(hub.overview.serviceRevenueCents))}
            {metric('Outstanding balance (recorded)', formatMoney(hub.overview.outstandingCents))}
          </div>
          <div className={card}>
            <h3 className="text-[14px] font-semibold text-[#1C1C1E]">Top services</h3>
            {hub.overview.topServices.length === 0
              ? <p className="mt-1 text-[13px] text-[#8E8E93]">{NOT_ENOUGH}</p>
              : hub.overview.topServices.map(service =>
                metric(service.name ?? 'Service', service.count))}
          </div>
        </div>
      )}

      {!loading && tab === 'followups' && (
        <div className="space-y-3" data-testid="client-hub-followups">
          <p className="px-1 text-[12px] text-[#8E8E93]">
            The same follow-up list as Marketing — one definition of who is due.
          </p>
          {!followups && <p className="text-[13px] text-[#8E8E93]">{NOT_ENOUGH}</p>}
          {followups?.groups.map(group => (
            <div key={group.id} className={card}>
              <h3 className="text-[14px] font-semibold text-[#1C1C1E]">{group.title}</h3>
              {group.items.length === 0
                ? <p className="mt-1 text-[13px] text-[#8E8E93]">No one right now.</p>
                : group.items.map(item => (
                  <div key={item.clientId} className="flex items-center justify-between gap-3 border-t border-[#F2F2F7] py-2 first:border-t-0">
                    <div className="min-w-0 text-[13px]">
                      <div className="font-semibold text-[#1C1C1E]">{item.clientName || 'Client'}</div>
                      <div className="text-[12px] text-[#8E8E93]">
                        {item.lastServiceName ? `Last: ${item.lastServiceName}` : 'No recorded service'}
                      </div>
                    </div>
                    {onOpenClient && (
                      <button
                        type="button"
                        data-testid={`hub-open-client-${item.clientId}`}
                        onClick={() => onOpenClient(item.clientId)}
                        className="min-h-9 shrink-0 rounded-full border border-[#D1D1D6] px-3 py-1.5 text-[12px] font-medium text-[#636366]"
                      >
                        Open
                      </button>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      {!loading && hub && tab === 'segments' && (
        <div className={card} data-testid="client-hub-segments">
          {hub.segments.map(segment => metric(segment.label, segment.count))}
          <p className="mt-2 text-[12px] text-[#8E8E93]">
            Segments come only from recorded data — no birthdays or client
            sources are stored, so those segments do not exist yet.
          </p>
        </div>
      )}

      {!loading && hub && tab === 'reports' && (
        <div className="space-y-3" data-testid="client-hub-reports">
          <div className={card}>
            {metric('Completed', hub.reports.completed)}
            {metric('Cancelled', hub.reports.cancelled)}
            {metric('No-shows', hub.reports.noShows)}
            {metric('Cancellation rate', pct(hub.reports.cancellationRate))}
            {metric('No-show rate', pct(hub.reports.noShowRate))}
            {metric('Rebooking rate', pct(hub.reports.rebookingRate))}
          </div>
          <div className={card} data-testid="client-hub-money">
            {metric('Final service revenue', formatMoney(hub.reports.serviceRevenueCents))}
            {metric('Discounts given', formatMoney(hub.reports.discountCents))}
            {metric('Tax collected (not revenue)', formatMoney(hub.reports.taxCollectedCents))}
            {metric('Tips', formatMoney(hub.reports.tipsCents))}
            {metric('Amount paid (recorded)', formatMoney(hub.reports.amountPaidCents))}
            {metric('Outstanding balance (recorded)', formatMoney(hub.reports.outstandingCents))}
          </div>
          <div className={card}>
            {metric('Win-back offers prepared', hub.reports.promotionsMinted)}
            {metric('Promotions redeemed', hub.reports.promotionsRedeemed)}
          </div>
        </div>
      )}
    </div>
  );
}
