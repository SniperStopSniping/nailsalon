'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BackButton, ModalHeader } from './AppModal';

type RecordItem = {
  appointmentId: string;
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
  countsForNetwork: boolean;
  expiresAt: string | null;
};
type RecordsResponse = { page: number; total: number; platformActive: boolean; timeZone?: string; items: RecordItem[] };

function formatDate(value: string, timeZone?: string) {
  return new Date(value).toLocaleString(undefined, { timeZone });
}
function status(item: RecordItem, platformActive: boolean, t: ReturnType<typeof useTranslations>) {
  if (item.cancelReason === 'admin_correction') {
    return t('status_corrected');
  }
  if (item.countsForNetwork) {
    return t('status_counted');
  }
  if (item.eventState === 'suppressed') {
    return t('status_removed');
  }
  if (item.eventState === 'revoked') {
    return t('status_removed');
  }
  if (item.eventState === 'active') {
    return platformActive ? t('status_expired') : t('status_paused');
  }
  return t('status_not_counted');
}

export function NoShowRecordsModal({ onClose, salonSlug }: { onClose: () => void; salonSlug: string | null }) {
  const t = useTranslations('NoShowRecords');
  const [records, setRecords] = useState<RecordsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [correcting, setCorrecting] = useState<RecordItem | null>(null);
  const [reason, setReason] = useState('');
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setRecords(null);
    try {
      if (!salonSlug) {
        throw new Error(t('error_active_salon'));
      }
      const response = await fetch(`/api/admin/network-no-show/records?salonSlug=${encodeURIComponent(salonSlug)}&page=${page}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(t('error_load'));
      }
      const result = await response.json() as RecordsResponse;
      if (version === requestVersion.current) {
        setRecords(result);
      }
    } catch (cause) {
      if (version === requestVersion.current) {
        setError(cause instanceof Error ? cause.message : t('error_load'));
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, [page, salonSlug, t]);
  useEffect(() => {
    setPage(1);
    setCorrecting(null);
    setReason('');
    setRecords(null);
    requestVersion.current += 1;
  }, [salonSlug]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (correcting) {
      reasonInputRef.current?.focus();
    }
  }, [correcting]);
  const correct = async () => {
    if (!correcting || reason.trim().length < 10) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/network-no-show/correct?salonSlug=${encodeURIComponent(salonSlug ?? '')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appointmentId: correcting.appointmentId, expectedUpdatedAt: correcting.updatedAt, reason: reason.trim() }) });
      if (!response.ok) {
        throw new Error(response.status === 409 ? t('error_stale') : t('error_correct'));
      }
      setCorrecting(null);
      setReason('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('error_correct'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-full flex-col bg-[var(--owner-ground)]">
      <div className="sticky top-0 z-10 bg-[var(--owner-ground)]"><ModalHeader title={t('title')} subtitle={t('subtitle')} leftAction={<BackButton onClick={onClose} label={t('back')} />} /></div>
      <div className="space-y-3 overflow-y-auto px-4 pb-10">
        <p className="rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-3 text-sm text-[var(--owner-muted)]">{t('explainer')}</p>
        <p className="text-sm text-[var(--owner-muted)]">{t('pending_help')}</p>
        {records && !records.platformActive ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('paused')}</p> : null}
        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        {error ? <button type="button" onClick={() => void load()} className="min-h-11 rounded-lg border px-3 text-sm font-semibold">{t('retry')}</button> : null}
        {correcting
          ? (
              <section className="rounded-xl border border-rose-300 bg-rose-50 p-4">
                <p className="font-semibold">{t('confirm_title')}</p>
                <p className="mt-1 text-sm">{t('confirm_copy')}</p>
                <label className="mt-3 block text-sm font-medium">
                  {t('reason_label')}
                  <textarea ref={reasonInputRef} value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={500} aria-describedby="no-show-correction-reason-help" className="mt-1 w-full rounded-lg border border-rose-300 bg-white p-2" />
                </label>
                <p id="no-show-correction-reason-help" className="mt-1 text-xs">{t('reason_help')}</p>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={busy || reason.trim().length < 10} onClick={() => void correct()} className="rounded-lg bg-rose-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? t('correcting') : t('confirm')}</button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setCorrecting(null);
                      setReason('');
                    }}
                    className="rounded-lg border px-3 py-2 text-sm"
                  >
                    {t('keep')}
                  </button>
                </div>
              </section>
            )
          : null}
        {loading ? <p className="py-8 text-center text-sm text-[var(--owner-muted)]">{t('loading')}</p> : null}
        {!loading && records?.items.length === 0 ? <p className="py-8 text-center text-sm text-[var(--owner-muted)]">{t('empty')}</p> : null}
        {records?.items.map(item => (
          <article key={item.appointmentId} className="rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
              <div className="min-w-0 flex-1">
                <p className="break-words font-semibold">{item.clientName || t('client_unavailable')}</p>
                <p className="text-sm text-[var(--owner-muted)]">
                  {item.clientPhone}
                  {item.clientEmail ? ` · ${item.clientEmail}` : ''}
                </p>
              </div>
              <span className="max-w-full self-start break-words rounded-full bg-[var(--owner-blush)] px-2 py-1 text-xs font-medium">{status(item, records.platformActive, t)}</span>
            </div>
            <p className="mt-3 text-sm">
              {t('appointment')}
              {formatDate(item.startTime, records.timeZone)}
            </p>
            <p className="text-sm text-[var(--owner-muted)]">
              {t('local_status')}
              {item.appointmentStatus === 'no_show' ? t('no_show') : item.appointmentStatus === 'cancelled' ? t('cancelled') : item.appointmentStatus}
            </p>
            {item.countsForNetwork && item.expiresAt
              ? (
                  <p className="mt-1 text-xs text-[var(--owner-muted)]">
                    {t('ends')}
                    {formatDate(item.expiresAt, records.timeZone)}
                  </p>
                )
              : null}
            {item.appointmentStatus === 'no_show'
              ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCorrecting(item);
                      setReason('');
                    }}
                    className="mt-3 min-h-11 w-full rounded-lg border border-rose-300 px-3 text-sm font-semibold text-rose-900"
                  >
                    {t('correct')}
                  </button>
                )
              : null}
          </article>
        ))}
        {records && records.total > 25
          ? (
              <div className="flex items-center justify-between pt-2 text-sm">
                <span>
                  {t('records', { count: records.total })}
                </span>
                <div className="flex gap-2">
                  <button type="button" disabled={loading || page === 1} onClick={() => setPage(current => current - 1)} className="min-h-11 rounded-lg border px-3 disabled:opacity-50">{t('previous')}</button>
                  <button type="button" disabled={loading || page * 25 >= records.total} onClick={() => setPage(current => current + 1)} className="min-h-11 rounded-lg border px-3 disabled:opacity-50">{t('next')}</button>
                </div>
              </div>
            )
          : null}
      </div>
    </div>
  );
}
