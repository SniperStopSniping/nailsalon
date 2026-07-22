'use client';

import { CalendarDays, Check, Clock, Loader2, Lock, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type GoogleEventSourceStatus, NewAppointmentModal } from '@/components/admin/NewAppointmentModal';

type ReviewEvent = {
  id: string;
  title: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  description?: string | null;
  location?: string | null;
  googleUpdatedAt?: string | null;
  updatedAt?: string | null;
  sourceVersion?: string | null;
  transparency: 'busy' | 'free';
  isReadOnly: boolean;
  suggestion?: {
    client?: { fullName: string | null; phone: string; email: string | null } | null;
    service?: { id: string; name: string; price: number } | null;
    recordedDecision?: { decision: string; count: number } | null;
  };
};

export function GoogleEventReviewQueue({ salonSlug }: { salonSlug: string }) {
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [converting, setConverting] = useState<ReviewEvent | null>(null);
  const [conversionSourceStatus, setConversionSourceStatus] = useState<GoogleEventSourceStatus>('available');
  const [error, setError] = useState<string | null>(null);
  const convertingRef = useRef<ReviewEvent | null>(null);

  const reconcileActiveConversion = useCallback(async (freshEvents: ReviewEvent[]) => {
    const active = convertingRef.current;
    if (!active) {
      return;
    }

    const refreshed = freshEvents.find(event => event.id === active.id);
    if (refreshed) {
      convertingRef.current = refreshed;
      setConverting(refreshed);
      setConversionSourceStatus('available');
      return;
    }

    try {
      const response = await fetch(`/api/admin/google-events/${encodeURIComponent(active.id)}?${new URLSearchParams({ salonSlug })}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.data?.event) {
        const verified = {
          ...active,
          ...payload.data.event,
          suggestion: { ...active.suggestion, ...payload.data.event.suggestion },
        } as ReviewEvent;
        convertingRef.current = verified;
        setConverting(verified);
        setConversionSourceStatus('available');
        return;
      }
      const code = payload?.error?.code;
      if (code === 'GOOGLE_EVENT_DELETED') {
        setConversionSourceStatus('deleted');
      } else if (code === 'GOOGLE_EVENT_ALREADY_CONVERTED') {
        setConversionSourceStatus('converted');
      } else if (code === 'GOOGLE_EVENT_NOT_FOUND') {
        setConversionSourceStatus('inaccessible');
      }
    } catch {
      // A failed status check is not proof that the source event disappeared.
      // Keep the editing session intact and let the owner retry the refresh.
    }
  }, [salonSlug]);

  const load = useCallback(async () => {
    if (!salonSlug) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/google-events?${new URLSearchParams({ salonSlug, status: 'needs_review', limit: '5' })}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Google events could not be loaded.');
      }
      const freshEvents = (payload.data?.events || []) as ReviewEvent[];
      setEvents(freshEvents);
      await reconcileActiveConversion(freshEvents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google events could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [reconcileActiveConversion, salonSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function keepAsCalendarTime(event: ReviewEvent) {
    setWorkingId(event.id);
    setError(null);
    const response = await fetch(`/api/admin/google-events/${encodeURIComponent(event.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug, action: 'keep_time' }),
    });
    if (response.ok) {
      setEvents(current => current.filter(item => item.id !== event.id));
    } else {
      const payload = await response.json().catch(() => null);
      setError(payload?.error || 'The review choice could not be saved.');
    }
    setWorkingId(null);
  }

  function openConversion(event: ReviewEvent) {
    convertingRef.current = event;
    setConverting(event);
    setConversionSourceStatus('available');
  }

  function closeConversion() {
    convertingRef.current = null;
    setConverting(null);
    setConversionSourceStatus('available');
  }

  if (!loading && events.length === 0 && !error && !converting) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_10px_30px_rgba(76,29,46,0.05)]" data-testid="google-review-queue">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Google Calendar</p>
          <h2 className="mt-1 text-lg font-semibold text-stone-950">Events needing review</h2>
          <p className="mt-1 text-sm text-stone-500">They already block booking when Google marks them busy.</p>
        </div>
        <button type="button" onClick={() => void load()} aria-label="Refresh Google events" className="rounded-full bg-blue-50 p-2 text-blue-700">
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading
        ? <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-600" /></div>
        : (
            <div className="mt-4 space-y-3">
              {events.map(event => (
                <article key={event.id} className="rounded-2xl border border-stone-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-stone-950">{event.title || 'Untitled Google event'}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500">
                        <CalendarDays size={14} />
                        {new Date(event.startTime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-stone-500">
                        <Clock size={14} />
                        {new Date(event.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        {' '}
                        ·
                        {event.durationMinutes}
                        {' '}
                        min
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${event.transparency === 'free' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700'}`}>{event.transparency === 'free' ? 'Free' : 'Busy'}</span>
                      {event.isReadOnly && (
                        <span className="flex items-center gap-1 text-[10px] text-amber-700">
                          <Lock size={10} />
                          Read-only
                        </span>
                      )}
                    </div>
                  </div>
                  {event.suggestion?.client || event.suggestion?.service
                    ? (
                        <p className="mt-3 rounded-xl bg-blue-50 p-2 text-xs text-blue-800">
                          Suggested:
                          {[event.suggestion.client?.fullName, event.suggestion.service?.name].filter(Boolean).join(' · ')}
                        </p>
                      )
                    : null}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => void keepAsCalendarTime(event)} disabled={workingId === event.id} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700 disabled:opacity-50">
                      {workingId === event.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      {event.transparency === 'free' ? 'Keep as Free' : 'Keep as Busy'}
                    </button>
                    <button type="button" onClick={() => openConversion(event)} className="rounded-xl bg-rose-800 px-3 py-2 text-xs font-semibold text-white">Convert to appointment</button>
                  </div>
                </article>
              ))}
            </div>
          )}
      <NewAppointmentModal
        isOpen={Boolean(converting)}
        onClose={closeConversion}
        onSuccess={() => {
          closeConversion();
          void load();
        }}
        googleEventSourceStatus={conversionSourceStatus}
        onRefreshGoogleEvent={() => void load()}
        googleEventPrefill={converting
          ? {
              id: converting.id,
              title: converting.title,
              startTime: converting.startTime,
              endTime: converting.endTime,
              durationMinutes: converting.durationMinutes,
              description: converting.description,
              location: converting.location,
              sourceVersion: converting.sourceVersion || converting.googleUpdatedAt || converting.updatedAt,
              suggestedClient: converting.suggestion?.client || null,
              suggestedService: converting.suggestion?.service || null,
              isReadOnly: converting.isReadOnly,
            }
          : null}
      />
    </section>
  );
}
