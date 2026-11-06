'use client';

import { useEffect, useState } from 'react';

import { type SelectedAddOnParam, serializeSelectedAddOns } from '@/libs/bookingParams';
import { formatMoney } from '@/libs/formatMoney';
import { addDaysToDateKey } from '@/libs/timeZone';
import { formatDuration } from '@/utils/Helpers';

const NO_EXTRAS: SelectedAddOnParam[] = [];
const SEARCH_DAYS = 14;
const SEARCH_BATCH = 3;
const RESULT_DAYS = 3;

export type AppointmentOpening = { time: string; startTime: string; availability: string };
export type OpeningQuote = { durationMinutes: number; serviceSubtotalCents: number; hasUnpricedExtras: boolean };

type OpeningDay = { date: string; slots: AppointmentOpening[]; quote?: OpeningQuote };

async function fetchOpeningDay(queryKey: string, date: string, needsQuote: boolean, signal: AbortSignal): Promise<OpeningDay> {
  const query = new URLSearchParams(queryKey);
  query.set('date', date);
  const response = await fetch(`/api/appointments/availability?${query}`, { signal, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error?.message || 'Unable to check openings. Try again.');
  }
  if (!Array.isArray(body.slots)) {
    if (body.reason === 'no_technicians' || body.reason === 'no_compatible_technicians') {
      return { date, slots: [] };
    }
    throw new TypeError('Unable to check openings. Try again.');
  }
  const slots = body.slots.filter((slot: AppointmentOpening) => slot.availability === 'available');
  if (!needsQuote || slots.length === 0) {
    return { date, slots };
  }
  if (!Number.isSafeInteger(body.durationMinutes) || !Number.isSafeInteger(body.serviceSubtotalCents)) {
    throw new TypeError('Unable to check the price and duration of these extras. Try again.');
  }
  return {
    date,
    slots,
    quote: {
      durationMinutes: body.durationMinutes,
      serviceSubtotalCents: body.serviceSubtotalCents,
      hasUnpricedExtras: body.hasUnpricedExtras === true,
    },
  };
}

/** Suggestions use the shared scheduling engine; saving still validates the booking. */
export function AppointmentOpenings({ salonSlug, date, technicianId, serviceIds, selectedAddOns = NO_EXTRAS, selectedStart, preferredStart, searchAhead = false, refreshKey = 0, onSelect, onNextDay }: {
  salonSlug: string;
  date: string;
  technicianId: string | null;
  serviceIds: string[];
  selectedAddOns?: SelectedAddOnParam[];
  selectedStart?: string;
  preferredStart?: string;
  searchAhead?: boolean;
  refreshKey?: number;
  onSelect: (slot: AppointmentOpening, quote?: OpeningQuote, date?: string) => void;
  onNextDay: () => void;
}) {
  const query = new URLSearchParams({ salonSlug, date });
  const addOnsParam = serializeSelectedAddOns(selectedAddOns);
  if (addOnsParam && serviceIds.length === 1) {
    query.set('baseServiceId', serviceIds[0]!);
    query.set('selectedAddOns', addOnsParam);
    query.set('includeQuote', '1');
  } else {
    query.set('serviceIds', serviceIds.join(','));
  }
  if (technicianId) {
    query.set('technicianId', technicianId);
  }
  const queryKey = query.toString();
  const [retry, setRetry] = useState(0);
  const [later, setLater] = useState<{ queryKey: string; date: string } | null>(null);
  const searchDate = searchAhead && later?.queryKey === queryKey ? later.date : date;
  const resultKey = `${queryKey}|${searchDate}|${searchAhead}|${refreshKey}|${retry}`;
  const [result, setResult] = useState<{ key: string; days: OpeningDay[]; done: boolean; error?: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!searchDate) {
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    setExpanded(false);

    void (async () => {
      const days: OpeningDay[] = [];
      try {
        if (searchAhead) {
          // Parallelise a small batch, then consume it in date order. Stop
          // once the first three suitable dates have been found.
          for (let offset = 0; offset < SEARCH_DAYS && days.length < RESULT_DAYS && !signal.aborted; offset += SEARCH_BATCH) {
            const count = Math.min(SEARCH_BATCH, SEARCH_DAYS - offset);
            const batch = await Promise.all(Array.from({ length: count }, (_, index) =>
              fetchOpeningDay(queryKey, addDaysToDateKey(searchDate, offset + index), Boolean(addOnsParam), signal)));
            days.push(...batch.filter(day => day.slots.length > 0).slice(0, RESULT_DAYS - days.length));
            if (!signal.aborted) {
              setResult({ key: resultKey, days: [...days], done: false });
            }
          }
        } else {
          days.push(await fetchOpeningDay(queryKey, searchDate, Boolean(addOnsParam), signal));
        }
        if (!signal.aborted) {
          setResult({ key: resultKey, days, done: true });
        }
      } catch (error) {
        if (!signal.aborted) {
          setResult({ key: resultKey, days, done: true, error: error instanceof Error ? error.message : 'Unable to check openings.' });
          controller.abort();
        }
      }
    })();
    return () => controller.abort();
  }, [addOnsParam, queryKey, resultKey, searchAhead, searchDate]);

  const current = result?.key === resultKey ? result : null;
  const firstDay = current?.days[0];
  const preferred = preferredStart && firstDay?.slots.find(slot => slot.startTime === preferredStart);
  useEffect(() => {
    if (preferred && preferred.startTime !== selectedStart) {
      onSelect(preferred, firstDay?.quote);
    }
  }, [firstDay?.quote, onSelect, preferred, selectedStart]);

  const empty = current?.done && !current.error && !firstDay?.slots.length;
  const nextSearchDate = current?.days.at(-1)?.date;
  const quote = firstDay?.quote;
  return (
    <section className="mt-4 rounded-xl border border-stone-200 p-3" aria-label="Find a time">
      <h4 className="font-semibold">{searchAhead ? 'Next openings' : 'Times that fit your services'}</h4>
      <p className="nap-helper">{searchAhead ? 'Pick a time, then add your client.' : 'For the selected date. Availability is checked again when saving.'}</p>
      <div aria-live="polite">
        {quote && (
          <p className="nap-helper">
            {formatDuration(quote.durationMinutes)}
            {' · '}
            {formatMoney(quote.serviceSubtotalCents, 'CAD')}
            {quote.hasUnpricedExtras ? ' + extras priced separately' : ' before tax or offers'}
          </p>
        )}
        {searchDate && !current?.done && <p>Checking openings…</p>}
        {current?.error && (
          <p role="alert">
            {current.error}
            {' '}
            <button type="button" className="nap-link" onClick={() => setRetry(value => value + 1)}>Try again</button>
          </p>
        )}
        {preferredStart && current?.done && !current.error && !preferred && (
          <p className="nap-helper">The prefilled time doesn’t fit this selection. Choose another opening.</p>
        )}
        {empty && (
          <p>
            {searchAhead ? 'No times fit in this 14-day search.' : 'No times fit on this date.'}
            {!searchAhead && <button type="button" className="nap-link" onClick={onNextDay}>Check the next day</button>}
          </p>
        )}
      </div>
      {current?.days.filter(day => day.slots.length > 0).map(day => (
        <div key={day.date} className="mt-3">
          {searchAhead && <h5 className="mb-1 text-sm font-semibold">{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</h5>}
          <div className="flex flex-wrap gap-2">
            {(expanded ? day.slots : day.slots.slice(0, searchAhead ? 3 : 6)).map(slot => (
              <button
                key={slot.startTime}
                type="button"
                aria-pressed={slot.startTime === selectedStart}
                className="min-h-11 rounded-lg border border-stone-300 px-3 aria-pressed:border-current aria-pressed:font-semibold"
                onClick={() => {
                  if (searchAhead) {
                    onSelect(slot, day.quote, day.date);
                  } else if (day.quote) {
                    onSelect(slot, day.quote);
                  } else {
                    onSelect(slot);
                  }
                }}
              >
                {slot.time}
              </button>
            ))}
          </div>
        </div>
      ))}
      {current?.days.some(day => day.slots.length > (searchAhead ? 3 : 6)) && (
        <button type="button" className="nap-link mt-2" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer times' : 'Show all times'}</button>
      )}
      {searchAhead && current?.done && !current.error && (
        <button
          type="button"
          className="nap-link mt-2 block"
          onClick={() => setLater({
            queryKey,
            date: nextSearchDate && current.days.length === RESULT_DAYS ? addDaysToDateKey(nextSearchDate, 1) : addDaysToDateKey(searchDate, SEARCH_DAYS),
          })}
        >
          Search later dates
        </button>
      )}
    </section>
  );
}
