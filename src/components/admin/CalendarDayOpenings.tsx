'use client';

import { useEffect, useState } from 'react';

import type { CalendarOpening } from '@/libs/calendarOpenings';
import { formatTimeInTimeZone } from '@/libs/timeZone';
import { formatDuration } from '@/utils/Helpers';

export function CalendarDayOpenings({ salonSlug, date, technicianId, refreshKey, onSelect }: {
  salonSlug: string;
  date: string;
  technicianId: string | null;
  refreshKey: number;
  onSelect: (opening: CalendarOpening) => void;
}) {
  const query = new URLSearchParams({ salonSlug, date });
  if (technicianId) {
    query.set('technicianId', technicianId);
  }
  const queryKey = query.toString();
  const [retry, setRetry] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const requestKey = `${queryKey}|${refreshKey}|${retry}`;
  const [result, setResult] = useState<{ key: string; openings: CalendarOpening[]; timeZone?: string; failed?: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setShowAll(false);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/calendar-openings?${queryKey}`, { signal: controller.signal, cache: 'no-store' });
        const { data } = await response.json();
        if (!response.ok || !Array.isArray(data?.openings)) {
          throw new Error('Openings unavailable');
        }
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, openings: data.openings, timeZone: data.timeZone });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, openings: [], failed: true });
        }
      }
    })();
    return () => controller.abort();
  }, [queryKey, requestKey]);

  const current = result?.key === requestKey ? result : null;
  const visibleOpenings = showAll ? current?.openings : current?.openings.slice(0, 3);

  return (
    <section className="mb-5 space-y-2" aria-label="Calendar openings">
      <h4 className="text-sm font-semibold text-[var(--owner-ink)]">Available gaps</h4>
      {!current && <p className="text-xs text-[var(--owner-muted)]" role="status">Checking openings…</p>}
      {current?.failed && (
        <p className="text-xs text-[var(--owner-muted)]" role="status">
          Couldn’t check openings.
          {' '}
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => setRetry(value => value + 1)}>Try again</button>
        </p>
      )}
      {current && !current.failed && current.openings.length === 0 && <p className="text-xs text-[var(--owner-muted)]">No openings for this day.</p>}
      {visibleOpenings?.map((opening) => {
        const minutes = Math.floor((Date.parse(opening.endTime) - Date.parse(opening.startTime)) / 60_000);
        return (
          <button
            key={`${opening.technicianId}|${opening.startTime}`}
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] px-3 py-2 text-left text-sm text-[var(--owner-ink)]"
            onClick={() => onSelect(opening)}
          >
            <span>
              <span className="block font-semibold">
                {formatTimeInTimeZone(opening.startTime, {}, current?.timeZone)}
                {' – '}
                {formatTimeInTimeZone(opening.endTime, {}, current?.timeZone)}
              </span>
              {!technicianId && <span className="text-xs text-[var(--owner-muted)]">{opening.technicianName}</span>}
            </span>
            <span className="shrink-0 text-xs font-medium text-[var(--owner-accent)]">{formatDuration(minutes)}</span>
          </button>
        );
      })}
      {(current?.openings.length ?? 0) > 3 && (
        <button type="button" className="min-h-11 text-sm font-medium text-[var(--owner-accent)]" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
          {showAll ? 'Show fewer gaps' : 'Show all gaps'}
        </button>
      )}
    </section>
  );
}
