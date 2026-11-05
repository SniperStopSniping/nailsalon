'use client';

import { useEffect, useState } from 'react';

import { type SelectedAddOnParam, serializeSelectedAddOns } from '@/libs/bookingParams';
import { formatMoney } from '@/libs/formatMoney';
import { formatDuration } from '@/utils/Helpers';

const NO_EXTRAS: SelectedAddOnParam[] = [];

type Opening = { time: string; startTime: string; availability: string };

export type OpeningQuote = { durationMinutes: number; serviceSubtotalCents: number; hasUnpricedExtras: boolean };

/** Suggestions use the shared scheduling engine; saving still validates the booking. */
export function AppointmentOpenings({ salonSlug, date, technicianId, serviceIds, selectedAddOns = NO_EXTRAS, selectedStart, refreshKey = 0, onSelect, onNextDay }: {
  salonSlug: string;
  date: string;
  technicianId: string | null;
  serviceIds: string[];
  selectedAddOns?: SelectedAddOnParam[];
  selectedStart?: string;
  refreshKey?: number;
  onSelect: (slot: Opening, quote?: OpeningQuote) => void;
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
  const resultKey = `${queryKey}|${refreshKey}|${retry}`;
  const [result, setResult] = useState<{ key: string; slots: Opening[]; quote?: OpeningQuote; error?: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setExpanded(false);
    void (async () => {
      try {
        const response = await fetch(`/api/appointments/availability?${queryKey}`, { signal: controller.signal, cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error?.message || 'Unable to check openings. Try again.');
        }
        if (!Array.isArray(body.slots)) {
          throw new TypeError('Unable to check openings. Try again.');
        }
        const quote = addOnsParam
          ? {
              durationMinutes: body.durationMinutes,
              serviceSubtotalCents: body.serviceSubtotalCents,
              hasUnpricedExtras: body.hasUnpricedExtras === true,
            }
          : undefined;
        if (quote && (!Number.isSafeInteger(quote.durationMinutes) || !Number.isSafeInteger(quote.serviceSubtotalCents))) {
          throw new TypeError('Unable to check the price and duration of these extras. Try again.');
        }
        if (!controller.signal.aborted) {
          setResult({ key: resultKey, slots: body.slots.filter((slot: Opening) => slot.availability === 'available'), quote });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({ key: resultKey, slots: [], error: error instanceof Error ? error.message : 'Unable to check openings.' });
        }
      }
    })();
    return () => controller.abort();
  }, [addOnsParam, queryKey, resultKey]);

  const current = result?.key === resultKey ? result : null;
  return (
    <section className="mt-4 rounded-xl border border-stone-200 p-3" aria-label="Find a time">
      <h4 className="font-semibold">Times that fit your services</h4>
      <p className="nap-helper">For the selected date. Availability is checked again when saving.</p>
      <div aria-live="polite">
        {current?.quote && (
          <p className="nap-helper">
            {formatDuration(current.quote.durationMinutes)}
            {' · '}
            {formatMoney(current.quote.serviceSubtotalCents, 'CAD')}
            {current.quote.hasUnpricedExtras ? ' + extras priced separately' : ' before tax or offers'}
          </p>
        )}
        {!current && <p>Checking openings…</p>}
        {current?.error && (
          <p role="alert">
            {current.error}
            {' '}
            <button type="button" className="nap-link" onClick={() => setRetry(value => value + 1)}>Try again</button>
          </p>
        )}
        {current && !current.error && current.slots.length === 0 && (
          <p>
            No times fit on this date.
            <button type="button" className="nap-link" onClick={onNextDay}>Check the next day</button>
          </p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {(expanded ? current?.slots : current?.slots.slice(0, 6))?.map(slot => (
          <button key={slot.startTime} type="button" aria-pressed={slot.startTime === selectedStart} className="min-h-11 rounded-lg border border-stone-300 px-3 aria-pressed:border-current aria-pressed:font-semibold" onClick={() => current?.quote ? onSelect(slot, current.quote) : onSelect(slot)}>{slot.time}</button>
        ))}
      </div>
      {current && current.slots.length > 6 && <button type="button" className="nap-link mt-2" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer times' : 'Show all times'}</button>}
    </section>
  );
}
