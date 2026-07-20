'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Slot = {
  time: string;
  startTime: string;
  availability?: 'available' | 'schedule_conflict';
  smartFit?: {
    discountAmountCents: number;
    discountedPriceCents: number;
    originalPriceCents: number;
  };
};

type Props = {
  token: string;
  salonSlug: string;
  manageHref: string;
  serviceSummary: string;
  technicianName: string;
  technicianId: string | null;
  locationId: string | null;
  totalDurationMinutes: number;
  appointmentId: string;
  /** Current appointment date key (YYYY-MM-DD) in the salon's timezone. */
  currentDateKey: string;
  /** Current appointment start as HH:mm in the salon's timezone. */
  currentTimeKey: string;
  currentLabel: string;
  priceLabel: string;
  discountNote: string | null;
  currency: string;
  subtotalCents: number;
  /** Discount already committed to this appointment, in cents. */
  committedDiscountCents: number;
  committedDiscountLabel: string | null;
  /** True when the committed discount is a Smart Fit one. */
  hasCommittedSmartFit: boolean;
};

function formatMoney(cents: number, currency: string): string {
  return `$${(cents / 100).toFixed(2)} ${currency}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(key: string): Date {
  const [year = '1970', month = '01', day = '01'] = key.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function formatTime12h(time: string): string {
  const [hour, minute] = time.split(':');
  const h = Number.parseInt(hour || '0', 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${minute} ${ampm}`;
}

function buildCalendar(year: number, month: number): Array<{ key: string; date: Date | null }> {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ key: string; date: Date | null }> = [];
  for (let i = 0; i < firstDay.getDay(); i++) {
    cells.push({ key: `empty-${year}-${month}-${i}`, date: null });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    cells.push({ key: dateKey(date), date });
  }
  return cells;
}

/**
 * Date/time-only reschedule for a customer holding a valid management link.
 *
 * The service, add-ons, technician and pricing are fixed — this never becomes
 * a new booking. Availability is requested with the capability token so the
 * server authorizes excluding this appointment from its own conflict check,
 * and the submit goes to the token endpoint, which moves the existing row.
 */
export function RescheduleAppointmentClient(props: Props) {
  const initialDate = useMemo(() => parseDateKey(props.currentDateKey), [props.currentDateKey]);
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [selectedTime, setSelectedTime] = useState<string>(props.currentTimeKey);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: 'rescheduled' | 'unchanged' } | null>(null);
  const requestIdRef = useRef(0);

  const selectedKey = dateKey(selectedDate);
  const isCurrentDate = selectedKey === props.currentDateKey;

  const loadSlots = useCallback(async (date: Date) => {
    const requestId = ++requestIdRef.current;
    setLoadingSlots(true);
    setLoadError(null);
    const params = new URLSearchParams({
      date: dateKey(date),
      salonSlug: props.salonSlug,
      durationMinutes: String(props.totalDurationMinutes),
      originalAppointmentId: props.appointmentId,
      manageToken: props.token,
    });
    if (props.technicianId) {
      params.set('technicianId', props.technicianId);
    }
    if (props.locationId) {
      params.set('locationId', props.locationId);
    }
    try {
      const response = await fetch(`/api/appointments/availability?${params.toString()}`, { cache: 'no-store' });
      if (requestIdRef.current !== requestId) {
        return;
      }
      if (!response.ok) {
        setSlots([]);
        setBookedSlots([]);
        setLoadError('We could not load times for that day. Please try again.');
        return;
      }
      const data = await response.json();
      setSlots(data.slots ?? []);
      setBookedSlots(data.bookedSlots ?? []);
    } catch {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setSlots([]);
      setBookedSlots([]);
      setLoadError('We could not load times for that day. Please try again.');
    } finally {
      if (requestIdRef.current === requestId) {
        setLoadingSlots(false);
      }
    }
  }, [props.appointmentId, props.locationId, props.salonSlug, props.technicianId, props.token, props.totalDurationMinutes]);

  useEffect(() => {
    loadSlots(selectedDate);
  }, [loadSlots, selectedDate]);

  const selectedSlot = slots.find(slot => slot.time === selectedTime);
  const hasRealChange = !(isCurrentDate && selectedTime === props.currentTimeKey);

  /**
   * What the customer will actually pay at the selected time, following the
   * same policy the server enforces on submit:
   *  - a discount already committed to this appointment is preserved, and the
   *    new slot does not have to qualify again;
   *  - an undiscounted appointment only gains a discount when the slot the
   *    availability API annotated says it qualifies.
   * Nothing here is authoritative — the server recomputes on submit — but it
   * must never promise a total the server would not honor.
   */
  const pricePreview = (() => {
    if (props.committedDiscountCents > 0) {
      return {
        discountCents: props.committedDiscountCents,
        totalCents: Math.max(0, props.subtotalCents - props.committedDiscountCents),
        label: props.committedDiscountLabel,
        note: props.hasCommittedSmartFit
          ? 'Your Smart Fit discount stays applied at this new time.'
          : 'Your discount stays applied at this new time.',
      };
    }
    if (selectedSlot?.smartFit) {
      return {
        discountCents: selectedSlot.smartFit.discountAmountCents,
        totalCents: selectedSlot.smartFit.discountedPriceCents,
        label: 'Smart Fit Discount',
        note: 'This time qualifies for a Smart Fit discount.',
      };
    }
    return {
      discountCents: 0,
      totalCents: props.subtotalCents,
      label: null,
      note: null,
    };
  })();

  async function submit() {
    // The current slot is shown for orientation, never as a new choice.
    if (!hasRealChange) {
      setDone({ status: 'unchanged' });
      return;
    }
    if (!selectedSlot) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/public/appointments/manage/${encodeURIComponent(props.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reschedule', startTime: selectedSlot.startTime }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setSubmitError(payload?.error?.message ?? 'That change could not be saved. Please try again.');
        if (payload?.error?.code === 'APPOINTMENT_CONFLICT') {
          await loadSlots(selectedDate);
        }
        return;
      }
      setDone({ status: payload?.data?.status === 'unchanged' ? 'unchanged' : 'rescheduled' });
    } catch {
      setSubmitError('That change could not be saved. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-[2rem] border border-stone-200 bg-white p-7 text-center shadow-sm">
        <h2 className="text-xl font-semibold text-stone-900">
          {done.status === 'unchanged' ? 'No changes made' : 'Your appointment has been moved'}
        </h2>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          {done.status === 'unchanged'
            ? 'You picked the time you already had, so nothing was changed and no confirmation was sent.'
            : 'We have updated your booking and emailed you the new details.'}
        </p>
        <a href={props.manageHref} className="mt-6 inline-flex rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white">
          Back to my appointment
        </a>
      </div>
    );
  }

  const calendarCells = buildCalendar(viewYear, viewMonth);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Rescheduling</p>
        <p className="mt-2 font-semibold text-stone-900">{props.serviceSummary}</p>
        <p className="mt-1 text-stone-600">{props.technicianName}</p>
        <p className="mt-1 text-stone-600">
          Currently:
          {' '}
          {props.currentLabel}
        </p>
      </div>

      <div data-testid="reschedule-price-summary" className="rounded-2xl border border-stone-200 bg-white p-5 text-sm shadow-sm">
        <div className="flex justify-between text-stone-600">
          <span>Subtotal</span>
          <span>{formatMoney(props.subtotalCents, props.currency)}</span>
        </div>
        {pricePreview.discountCents > 0 && (
          <div className="mt-1 flex justify-between text-emerald-700">
            <span data-testid="reschedule-discount-label">{pricePreview.label ?? 'Discount'}</span>
            <span>
              −
              {formatMoney(pricePreview.discountCents, props.currency)}
            </span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t border-stone-100 pt-2 text-base font-semibold text-stone-900">
          <span>Total</span>
          <span data-testid="reschedule-total">{formatMoney(pricePreview.totalCents, props.currency)}</span>
        </div>
        {pricePreview.note && (
          <p data-testid="reschedule-discount-note" className="mt-2 text-emerald-700">{pricePreview.note}</p>
        )}
      </div>

      <div className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            className="rounded-full p-2 text-stone-600 hover:bg-stone-100"
            onClick={() => {
              const previous = new Date(viewYear, viewMonth - 1, 1);
              setViewYear(previous.getFullYear());
              setViewMonth(previous.getMonth());
            }}
          >
            <ChevronLeft className="size-5" />
          </button>
          <p className="text-sm font-semibold text-stone-900">
            {new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </p>
          <button
            type="button"
            aria-label="Next month"
            className="rounded-full p-2 text-stone-600 hover:bg-stone-100"
            onClick={() => {
              const next = new Date(viewYear, viewMonth + 1, 1);
              setViewYear(next.getFullYear());
              setViewMonth(next.getMonth());
            }}
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-medium text-stone-500">
          {WEEKDAYS.map(day => <div key={day} className="py-1">{day}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {calendarCells.map((cell) => {
            if (!cell.date) {
              return <div key={cell.key} />;
            }
            const key = dateKey(cell.date);
            const isPast = cell.date < today;
            const isSelected = key === selectedKey;
            const isCurrent = key === props.currentDateKey;
            return (
              <button
                key={cell.key}
                type="button"
                disabled={isPast}
                onClick={() => {
                  setSelectedDate(cell.date!);
                  setSelectedTime(key === props.currentDateKey ? props.currentTimeKey : '');
                }}
                className={`relative aspect-square rounded-xl text-sm font-medium transition ${
                  isSelected
                    ? 'bg-stone-900 text-white'
                    : isPast
                      ? 'text-stone-300'
                      : 'text-stone-800 hover:bg-stone-100'
                }`}
              >
                {cell.date.getDate()}
                {isCurrent && !isSelected && (
                  <span className="absolute inset-x-0 bottom-1 mx-auto size-1 rounded-full bg-rose-600" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold text-stone-900">
          {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        {loadingSlots && <p className="mt-3 text-sm text-stone-500">Loading times…</p>}
        {loadError && <p className="mt-3 text-sm text-red-700">{loadError}</p>}
        {!loadingSlots && !loadError && slots.length === 0 && (
          <p className="mt-3 text-sm text-stone-600">No times are open that day. Try another date.</p>
        )}
        {!loadingSlots && slots.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((slot) => {
              const isBooked = bookedSlots.includes(slot.time) || slot.availability === 'schedule_conflict';
              const isCurrentSlot = isCurrentDate && slot.time === props.currentTimeKey;
              const isSelected = slot.time === selectedTime;
              return (
                <button
                  key={slot.time}
                  type="button"
                  disabled={isBooked}
                  onClick={() => setSelectedTime(slot.time)}
                  className={`rounded-xl border px-2 py-3 text-sm font-medium transition ${
                    isSelected
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : isBooked
                        ? 'border-stone-100 bg-stone-50 text-stone-300 line-through'
                        : isCurrentSlot
                          ? 'border-rose-300 bg-rose-50 text-rose-800'
                          : 'border-stone-200 text-stone-800 hover:border-stone-400'
                  }`}
                >
                  {formatTime12h(slot.time)}
                  {isCurrentSlot && (
                    <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide">
                      Current
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {submitError && (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{submitError}</p>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-stone-200 bg-white/95 p-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a href={props.manageHref} className="text-sm font-semibold text-stone-600 underline underline-offset-4">
            Back
          </a>
          <button
            type="button"
            disabled={submitting || (hasRealChange && !selectedSlot)}
            onClick={submit}
            className="rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting ? 'Saving…' : hasRealChange ? 'Confirm new time' : 'Keep current time'}
          </button>
        </div>
      </div>
    </div>
  );
}
