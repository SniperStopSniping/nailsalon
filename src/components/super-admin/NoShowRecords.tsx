'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type RecordItem = {
  appointmentId: string;
  salonId: string;
  salonName: string;
  salonSlug: string;
  clientName: string | null;
  clientPhone: string;
  clientEmail: string | null;
  appointmentStatus: string;
  cancelReason: string | null;
  updatedAt: string;
  startTime: string;
  endTime: string;
  eventId: string | null;
  eventState: 'active' | 'suppressed' | 'revoked' | null;
  eventEligible: boolean;
  markedAt: string | null;
  expiresAt: string | null;
  countsForNetwork: boolean;
};

type RecordsResponse = {
  page: number;
  pageSize: number;
  platformActive: boolean;
  total: number;
  items: RecordItem[];
};

const STATES = [
  ['all', 'All records'],
  ['counted', 'In network risk'],
  ['not_shared', 'No network event'],
  ['suppressed', 'Removed from risk'],
  ['revoked', 'Source corrected'],
  ['expired', 'Expired'],
] as const;

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function networkLabel(item: RecordItem, platformActive: boolean): string {
  if (!item.eventId) {
    return item.cancelReason === 'admin_correction' ? 'Source corrected; no network event' : 'No network event';
  }
  if (item.countsForNetwork) {
    return 'Counts in network risk';
  }
  if (item.eventState === 'active') {
    return item.eventEligible && !platformActive
      ? 'Eligible event; network paused'
      : 'Expired';
  }
  return item.eventState === 'suppressed' ? 'Removed from network risk' : 'Source corrected';
}

export function NoShowRecords() {
  const [records, setRecords] = useState<RecordsResponse | null>(null);
  const [salon, setSalon] = useState('');
  const [debouncedSalon, setDebouncedSalon] = useState('');
  const [state, setState] = useState<(typeof STATES)[number][0]>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<RecordItem | null>(null);
  const [correcting, setCorrecting] = useState<RecordItem | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSalon(salon.trim()), 350);
    return () => clearTimeout(timer);
  }, [salon]);

  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    setRecords(null);
    try {
      const params = new URLSearchParams({ page: String(page), state });
      if (debouncedSalon) {
        params.set('salon', debouncedSalon);
      }
      const response = await fetch(`/api/super-admin/network-no-show/records?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Could not load no-show records');
      }
      const result = await response.json() as RecordsResponse;
      if (requestId === latestRequest.current) {
        setRecords(result);
      }
    } catch (cause) {
      if (requestId === latestRequest.current) {
        setError(cause instanceof Error ? cause.message : 'Could not load no-show records');
      }
    } finally {
      if (requestId === latestRequest.current) {
        setLoading(false);
      }
    }
  }, [page, debouncedSalon, state]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function removeFromNetwork() {
    if (!pending || pending.eventState !== 'active') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/super-admin/network-no-show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'suppress_event',
          mode: 'apply',
          salonId: pending.salonId,
          appointmentId: pending.appointmentId,
        }),
      });
      if (!response.ok) {
        throw new Error('Could not remove this event from network risk');
      }
      setPending(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update no-show record');
    } finally {
      setBusy(false);
    }
  }

  async function correctSourceNoShow() {
    if (!correcting || correctionReason.trim().length < 10) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/super-admin/network-no-show/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonId: correcting.salonId,
          appointmentId: correcting.appointmentId,
          expectedUpdatedAt: correcting.updatedAt,
          reason: correctionReason.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(response.status === 409 ? 'This appointment changed. Refresh the list before correcting it.' : 'Could not correct this no-show');
      }
      setCorrecting(null);
      setCorrectionReason('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not correct no-show');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8" aria-labelledby="no-show-records-title">
      <div className="rounded-2xl border border-rose-100 bg-white p-4 shadow-[0_10px_30px_rgba(76,29,46,0.06)]">
        <div className="mb-4">
          <h2 id="no-show-records-title" className="text-lg font-semibold text-[#4C1D2E]">No-show records across salons</h2>
          <p className="text-sm text-stone-600">Every appointment marked no-show, including records that never entered network risk. You can correct an incorrect no-show to cancelled, or remove only its shared risk contribution. Payments and refunds require separate review.</p>
          {records && !records.platformActive && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Network sharing is currently paused. Eligible event history remains visible here.</p>}
        </div>
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="text-sm text-stone-700">
            Network status
            <select
              value={state}
              onChange={(event) => {
                setState(event.target.value as typeof state);
                setPage(1);
              }}
              className="ml-2 rounded-lg border border-stone-300 bg-white px-3 py-2"
            >
              {STATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm text-stone-700">
            Salon
            <input
              value={salon}
              onChange={(event) => {
                latestRequest.current += 1;
                setRecords(null);
                setLoading(true);
                setSalon(event.target.value);
                setPage(1);
              }}
              placeholder="All salons"
              className="ml-2 rounded-lg border border-stone-300 px-3 py-2"
            />
          </label>
        </div>
        {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {pending && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Remove this no-show from network risk?</p>
            <p>
              {pending.salonName}
              {' '}
              ·
              {' '}
              {pending.clientName || pending.clientPhone}
              {' '}
              ·
              {' '}
              {formatDate(pending.endTime)}
            </p>
            <p>The source appointment stays marked no-show. Existing deposits and refunds are unchanged. This correction is audited.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void removeFromNetwork()} className="rounded-lg bg-amber-800 px-3 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Updating…' : 'Confirm removal'}</button>
              <button type="button" disabled={busy} onClick={() => setPending(null)} className="rounded-lg border border-stone-300 px-3 py-2">Keep record</button>
            </div>
          </div>
        )}
        {correcting && (
          <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-950">
            <p className="font-semibold">Correct this appointment from no-show to cancelled?</p>
            <p>
              {correcting.salonName}
              {' '}
              ·
              {' '}
              {correcting.clientName || correcting.clientPhone}
              {' '}
              ·
              {' '}
              {formatDate(correcting.endTime)}
            </p>
            <p>This changes the salon appointment status and revokes any active network risk event. It does not refund or change a deposit. The reason and operator are recorded.</p>
            <label className="mt-3 block font-medium">
              Correction reason
              <textarea value={correctionReason} onChange={event => setCorrectionReason(event.target.value)} maxLength={500} rows={2} className="mt-1 block w-full rounded-lg border border-rose-300 bg-white p-2" placeholder="Explain why the no-show marking was incorrect" />
            </label>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy || correctionReason.trim().length < 10} onClick={() => void correctSourceNoShow()} className="rounded-lg bg-rose-800 px-3 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Updating…' : 'Confirm correction'}</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setCorrecting(null);
                  setCorrectionReason('');
                }}
                className="rounded-lg border border-stone-300 px-3 py-2"
              >
                Keep no-show
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase text-stone-600">
              <tr>
                <th className="p-3">Salon</th>
                <th className="p-3">Client</th>
                <th className="p-3">Appointment</th>
                <th className="p-3">Local status</th>
                <th className="p-3">Network status</th>
                <th className="p-3">Marked</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {records?.items.map(item => (
                <tr key={`${item.salonId}:${item.appointmentId}`} className="border-b border-stone-100 align-top">
                  <td className="p-3">
                    <span className="font-medium">{item.salonName}</span>
                    <br />
                    <span className="text-xs text-stone-500">{item.salonSlug}</span>
                  </td>
                  <td className="p-3">
                    {item.clientName || 'Name unavailable'}
                    <br />
                    <span className="text-xs text-stone-500">
                      {item.clientPhone}
                      {item.clientEmail ? ` · ${item.clientEmail}` : ''}
                    </span>
                  </td>
                  <td className="p-3">
                    {formatDate(item.startTime)}
                    <br />
                    <span className="text-xs text-stone-500">{item.appointmentId}</span>
                  </td>
                  <td className="p-3">{item.appointmentStatus === 'no_show' ? 'No-show' : item.appointmentStatus}</td>
                  <td className="p-3">
                    {networkLabel(item, records?.platformActive ?? false)}
                    {item.countsForNetwork && (
                      <>
                        <br />
                        <span className="text-xs text-stone-500">
                          Until
                          {formatDate(item.expiresAt)}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="p-3">{formatDate(item.markedAt)}</td>
                  <td className="p-3">
                    <div className="flex flex-col gap-2">
                      {item.eventEligible && (
                        <button
                          type="button"
                          onClick={() => {
                            setCorrecting(null);
                            setPending(item);
                          }}
                          className="rounded-lg border border-amber-400 px-3 py-2 text-amber-900 hover:bg-amber-50"
                        >
                          Remove from network risk
                        </button>
                      )}
                      {item.appointmentStatus === 'no_show' && (
                        <button
                          type="button"
                          onClick={() => {
                            setPending(null);
                            setCorrecting(item);
                          }}
                          className="rounded-lg border border-rose-300 px-3 py-2 text-rose-900 hover:bg-rose-50"
                        >
                          Correct to cancelled
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && records?.items.length === 0 && <p className="p-6 text-center text-sm text-stone-600">No records match these filters.</p>}
          {loading && <p className="p-6 text-center text-sm text-stone-600">Loading records…</p>}
        </div>
        <div className="mt-4 flex items-center justify-between text-sm text-stone-600">
          <span>
            {records?.total ?? 0}
            {' '}
            records
          </span>
          <div className="flex items-center gap-3">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-50">Previous</button>
            <span>
              Page
              {page}
            </span>
            <button type="button" disabled={loading || page * 25 >= (records?.total ?? 0)} onClick={() => setPage(page + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </section>
  );
}
