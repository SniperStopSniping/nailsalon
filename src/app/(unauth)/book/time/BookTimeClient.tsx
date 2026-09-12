'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BookingStepHeader } from '@/components/booking/BookingStepHeader';
import { BookingSummaryCard } from '@/components/booking/BookingSummaryCard';
import { StateCard } from '@/components/ui/state-card';
import { useBookingState } from '@/hooks/useBookingState';
import { type BookingStep, getFirstStep, getNextStep, getPrevStep } from '@/libs/bookingFlow';
import { buildBookingUrl, parseSelectedAddOnsParam } from '@/libs/bookingParams';
import { formatMoney } from '@/libs/formatMoney';
import {
  buildSmartFitSuggestionContextKey,
  consumeSmartFitAvailabilityRefresh,
  type CustomerSmartFitOffer,
  isSmartFitOutrankedForSession,
  parseCustomerSmartFitOffer,
  selectNearbySmartFitSuggestion,
  SMART_FIT_BADGE_LABEL,
  SMART_FIT_OTHER_TIMES_TITLE,
  SMART_FIT_SECTION_DESCRIPTION,
  SMART_FIT_SECTION_TITLE,
  splitSmartFitSlots,
  syncSmartFitSuggestionDismissal,
} from '@/libs/smartFitCustomer';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

import { getMinimumNoticeCustomerCopy } from './minimumNoticeCopy';

export type ServiceSummary = {
  id: string;
  name: string;
  price: number; // In dollars
  duration: number;
};

export type TechnicianSummary = {
  id: string;
  name: string;
  imageUrl: string | null;
} | null;

export type AddOnSummary = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  duration: number;
};

type BookTimeClientProps = {
  services: ServiceSummary[];
  addOns?: AddOnSummary[];
  totalPrice: number;
  totalDuration: number;
  locationName?: string | null;
  technician: TechnicianSummary;
  technicianSelectionSource?: 'explicit' | 'auto' | null;
  bookingFlow: BookingStep[];
  minimumNoticeMinutes?: number;
  salonTimeZone?: string;
  /**
   * Weekdays (0 = Sunday … 6 = Saturday) the salon is closed, resolved from
   * the same opening-hours ceiling the availability API enforces. Empty when
   * the salon publishes no hours anywhere — then no day is marked closed and
   * the calendar behaves exactly as it did before.
   */
  closedWeekdays?: number[];
};

const EMPTY_ADD_ONS: AddOnSummary[] = [];
const EMPTY_CLOSED_WEEKDAYS: number[] = [];

type DisplayTimeSlot = {
  time: string;
  startTime: string | null;
  period: 'morning' | 'afternoon' | 'evening';
  smartFit?: CustomerSmartFitOffer | null;
};

function DaypartIcon({ period }: { period: DisplayTimeSlot['period'] }) {
  if (period === 'evening') {
    return (
      <svg aria-hidden="true" className="size-4" viewBox="0 0 20 20" fill="none">
        <path d="M15.75 12.2A6.4 6.4 0 0 1 7.8 4.25 6.4 6.4 0 1 0 15.75 12.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (period === 'morning') {
    return (
      <svg aria-hidden="true" className="size-4" viewBox="0 0 20 20" fill="none">
        <path d="M3 14.5h14M5.5 12a4.5 4.5 0 0 1 9 0M10 2.5v2M4.7 6.7 3.3 5.3M15.3 6.7l1.4-1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="3.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.35 4.35l1.4 1.4M14.25 14.25l1.4 1.4M15.65 4.35l-1.4 1.4M5.75 14.25l-1.4 1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

type AvailabilitySlot = {
  time: string;
  startTime?: string | null;
  smartFit?: CustomerSmartFitOffer | null;
};

type AvailabilityError = {
  kind: 'unsupported_technician' | 'invalid_service' | 'missing_required_add_on' | 'temporary_failure';
  message: string;
  canRetry: boolean;
  canReselectTechnician: boolean;
};

type CalendarCell = {
  key: string;
  date: Date | null;
};

function toDisplaySlots(slots: AvailabilitySlot[]): DisplayTimeSlot[] {
  return slots.map((slot) => {
    const time = slot.time;
    const [hour = '0'] = time.split(':');
    return {
      time,
      startTime: slot.startTime ?? null,
      period: Number.parseInt(hour, 10) < 12
        ? 'morning'
        : Number.parseInt(hour, 10) < 18
          ? 'afternoon'
          : 'evening',
      smartFit: slot.smartFit ?? null,
    };
  });
}

function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

const generateCalendarDays = (year: number, month: number): CalendarCell[] => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days: CalendarCell[] = [];

  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push({ key: `empty-${year}-${month}-before-${i}`, date: null });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    days.push({ key: getDateKey(date), date });
  }

  return days;
};

const formatTime12h = (time: string) => {
  const [hour, minute] = time.split(':');
  const h = Number.parseInt(hour || '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${minute} ${ampm}`;
};

// Fallback when the salon has no configured timezone.
const DEFAULT_SALON_TIMEZONE = 'America/Toronto';

// Current wall-clock time in the salon's timezone, represented as a local
// Date so it can be compared against the calendar's local Date values.
const getSalonNow = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return new Date(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'));
};

// Today's date at midnight in the salon's timezone.
const getSalonToday = (timeZone: string) => {
  const salonNow = getSalonNow(timeZone);
  salonNow.setHours(0, 0, 0, 0);
  return salonNow;
};

// The salon is shut on this weekday, so it can never hold a bookable slot.
// `closedWeekdays` is empty for salons that publish no opening hours; every
// day then stays open exactly as before.
const isClosedDay = (date: Date, closedWeekdays: ReadonlySet<number>) =>
  closedWeekdays.has(date.getDay());

// First day from `start` (inclusive) the salon is actually open. Never runs
// past a full week — if the owner marked all seven days closed there is no
// open day to move to and the caller keeps the day it asked for, so the
// "no bookable times" recovery card stays the honest answer.
const findFirstOpenDay = (start: Date, closedWeekdays: ReadonlySet<number>): Date => {
  const candidate = new Date(start);
  candidate.setHours(0, 0, 0, 0);
  if (closedWeekdays.size === 0 || closedWeekdays.size >= 7) {
    return candidate;
  }
  for (let offset = 0; offset < 7; offset += 1) {
    if (!isClosedDay(candidate, closedWeekdays)) {
      return candidate;
    }
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
};

// Restore a previously selected calendar date from the URL (set on date
// selection below) so returning to this step — browser back, slot-taken
// recovery, or the stale-Smart-Fit flow — keeps the client's date instead of
// resetting to today. Returns null (caller falls back to salon-today) for
// absent, malformed, impossible, or past values.
const resolveRestoredCalendarDate = (dateParam: string, timeZone: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return null;
  }
  const [year = 0, month = 0, day = 0] = dateParam.split('-').map(Number);
  const candidate = new Date(year, month - 1, day);
  candidate.setHours(0, 0, 0, 0);
  if (
    candidate.getFullYear() !== year
    || candidate.getMonth() !== month - 1
    || candidate.getDate() !== day
  ) {
    return null;
  }
  return candidate.getTime() < getSalonToday(timeZone).getTime() ? null : candidate;
};

// Short human label for the salon timezone, e.g. "EDT" or "GMT-5".
const getTimeZoneLabel = (timeZone: string) => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(part => part.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
};

// Filter out past time slots as a client-side fallback. The API is the source of
// truth for the 2-hour minimum lead time and final bookability.
const filterPastTimeSlots = (
  slotTimes: string[],
  date: Date | null,
  timeZone: string,
) => {
  if (!date) {
    return slotTimes;
  }

  const salonNow = getSalonNow(timeZone);
  const salonToday = getSalonToday(timeZone);

  // Check if selected date is today in the salon's timezone
  const selectedDateMidnight = new Date(date);
  selectedDateMidnight.setHours(0, 0, 0, 0);
  const isToday = selectedDateMidnight.toDateString() === salonToday.toDateString();

  if (!isToday) {
    return slotTimes;
  }

  return slotTimes.filter((slotTimeValue) => {
    const [hours, minutes] = slotTimeValue.split(':').map(Number);
    const slotTime = new Date(selectedDateMidnight);
    slotTime.setHours(hours || 0, minutes || 0, 0, 0);
    return slotTime > salonNow;
  });
};

export function BookTimeClient({
  services,
  addOns = EMPTY_ADD_ONS,
  totalPrice,
  totalDuration,
  locationName = null,
  technician,
  technicianSelectionSource = null,
  bookingFlow,
  minimumNoticeMinutes,
  salonTimeZone = DEFAULT_SALON_TIMEZONE,
  closedWeekdays = EMPTY_CLOSED_WEEKDAYS,
}: BookTimeClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;
  const serviceIdsParam = searchParams.get('serviceIds') || '';
  const serviceIds = serviceIdsParam ? serviceIdsParam.split(',').filter(Boolean) : [];
  const baseServiceId = searchParams.get('baseServiceId');
  const selectedAddOnsParam = searchParams.get('selectedAddOns');
  const selectedAddOns = useMemo(
    () => parseSelectedAddOnsParam(selectedAddOnsParam),
    [selectedAddOnsParam],
  );
  const techId = searchParams.get('techId') || '';
  const locationId = searchParams.get('locationId') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const manageToken = searchParams.get('manageToken') || '';
  const campaignToken = searchParams.get('campaign') || '';

  // Check if this is the first step in the booking flow (for dock/login visibility)
  const isFirstStep = getFirstStep(bookingFlow) === 'time';

  // Keep persisted booking state isolated to the active salon.
  const { syncFromUrl = () => {} } = useBookingState(salonSlug);
  const effectiveTechId = techId || technician?.id || 'any';

  // Keep the tenant-scoped state aligned with the server-validated technician.
  useEffect(() => {
    syncFromUrl({
      techId: effectiveTechId,
      technicianSelectionSource,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const serviceNames = [
    ...services.map(s => s.name),
    ...addOns.map(addOn => addOn.quantity > 1 ? `${addOn.name} x${addOn.quantity}` : addOn.name),
  ].join(' + ');

  // "Today" is defined by the salon's timezone, not the visitor's device.
  const today = getSalonToday(salonTimeZone);
  const closedWeekdaySet = useMemo(
    () => new Set(closedWeekdays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6)),
    [closedWeekdays],
  );
  const restoredCalendarDate = resolveRestoredCalendarDate(
    searchParams.get('date') || '',
    salonTimeZone,
  );
  // Arriving with no date of their own (service → artist → time), the client
  // must not land on a day the salon is shut: that day can never answer with
  // a slot, so the first thing they see is a dead end. Open on today when the
  // salon trades today, otherwise on the next day it does.
  const initialCalendarDate = restoredCalendarDate ?? findFirstOpenDay(today, closedWeekdaySet);

  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(initialCalendarDate.getMonth());
  const [currentYear, setCurrentYear] = useState(initialCalendarDate.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(initialCalendarDate);
  const [visibleSlots, setVisibleSlots] = useState<AvailabilitySlot[]>([]);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [availabilityBufferMinutes, setAvailabilityBufferMinutes] = useState(0);
  const [loadingSlots, setLoadingSlots] = useState(false);
  // Date key whose availability response has actually landed. Empty state
  // alone is not evidence a day is unbookable — before this matches the
  // selected day, nothing may conclude the day is empty.
  const [loadedAvailabilityDateKey, setLoadedAvailabilityDateKey] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<AvailabilityError | null>(null);
  const [findingNextAvailable, setFindingNextAvailable] = useState(false);
  const [nextAvailableMessage, setNextAvailableMessage] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  // Refs for smooth scrolling to time slot sections
  const smartFitSlotsRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const morningSlotsRef = useRef<HTMLDivElement>(null);
  const afternoonSlotsRef = useRef<HTMLDivElement>(null);
  const eveningSlotsRef = useRef<HTMLDivElement>(null);

  // Set when this mount follows a stale Smart Fit response on the confirm
  // step: once the refreshed availability renders, focus the time list.
  const staleRefreshFocusRef = useRef(false);

  // Scroll state refs - pendingScroll triggers scroll when slots load
  const pendingScrollRef = useRef(false);
  const scrollRequestIdRef = useRef(0);
  const scrollTargetDateRef = useRef<string | null>(null); // Track which date the scroll is for
  const isMountedRef = useRef(true);
  const autoAdvancedTodayRef = useRef(false);
  // A date restored from the URL is an explicit prior choice — never
  // auto-advance it away, exactly like a manual calendar selection.
  const allowTodayAutoAdvanceRef = useRef(restoredCalendarDate === null);
  const availabilityRequestIdRef = useRef(0);

  // Track mount/unmount for cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Custom smooth scroll with adjustable duration
  const smoothScrollTo = useCallback((targetY: number, duration: number): Promise<void> => {
    return new Promise((resolve) => {
      const startY = window.scrollY;
      const difference = targetY - startY;
      let startTime: number | null = null;
      let frameCount = 0;
      const maxFrames = 120;

      const easeInOutCubic = (t: number): number => {
        return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      };

      const step = (currentTime: number) => {
        startTime ??= currentTime;
        frameCount += 1;

        const elapsed = Math.max(0, currentTime - startTime);
        const progress = frameCount >= maxFrames ? 1 : Math.min(elapsed / duration, 1);
        const easeProgress = easeInOutCubic(progress);

        window.scrollTo(0, startY + difference * easeProgress);

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(step);
    });
  }, []);

  const buildAvailabilityUrl = useCallback((date: Date) => {
    const dateStr = getDateKey(date);
    const techParam = effectiveTechId && effectiveTechId !== 'any' ? `&technicianId=${effectiveTechId}` : '';
    const durationParam = !baseServiceId ? `&durationMinutes=${totalDuration}` : '';
    const serviceParam = serviceIdsParam ? `&serviceIds=${encodeURIComponent(serviceIdsParam)}` : '';
    const baseServiceParam = baseServiceId ? `&baseServiceId=${encodeURIComponent(baseServiceId)}` : '';
    const addOnsParam = selectedAddOns.length > 0 ? `&selectedAddOns=${encodeURIComponent(JSON.stringify(selectedAddOns))}` : '';
    const locationParam = locationId ? `&locationId=${encodeURIComponent(locationId)}` : '';
    const rescheduleParam = originalAppointmentId ? `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}` : '';
    const manageTokenParam = manageToken ? `&manageToken=${encodeURIComponent(manageToken)}` : '';
    return `/api/appointments/availability?date=${dateStr}&salonSlug=${salonSlug}${techParam}${durationParam}${serviceParam}${baseServiceParam}${addOnsParam}${locationParam}${rescheduleParam}${manageTokenParam}`;
  }, [baseServiceId, effectiveTechId, locationId, manageToken, originalAppointmentId, salonSlug, selectedAddOns, serviceIdsParam, totalDuration]);

  // Fetch booked slots for selected date and technician
  const fetchBookedSlots = useCallback(async (date: Date) => {
    if (!salonSlug) {
      return;
    }

    const requestId = ++availabilityRequestIdRef.current;
    setLoadingSlots(true);
    setAvailabilityError(null);
    try {
      const response = await fetch(
        buildAvailabilityUrl(date),
        { cache: 'no-store' },
      );

      if (response.ok) {
        const data = await response.json();
        if (availabilityRequestIdRef.current !== requestId) {
          return;
        }
        setAvailabilityError(null);
        const nextVisibleSlots: AvailabilitySlot[] = Array.isArray(data.slots)
          ? data.slots
            .filter((slot: unknown): slot is AvailabilitySlot =>
              typeof slot === 'object'
              && slot !== null
              && typeof (slot as AvailabilitySlot).time === 'string',
            )
            .map((slot: AvailabilitySlot) => ({
              time: slot.time,
              startTime: typeof slot.startTime === 'string' ? slot.startTime : null,
              // Campaign links keep their own offer (winner-take-all, no
              // stacking), and once the booking API has told this visitor a
              // higher-priority discount out-ranks Smart Fit, stop promising
              // a saving it cannot honor.
              smartFit: campaignToken || isSmartFitOutrankedForSession(salonSlug)
                ? null
                : parseCustomerSmartFitOffer((slot as { smartFit?: unknown }).smartFit),
            }))
          : (data.visibleSlots || []).map((time: string) => ({ time, startTime: null }));
        setVisibleSlots(nextVisibleSlots);
        setBookedSlots(data.bookedSlots || []);
        setAvailabilityBufferMinutes(Math.max(0, Number(data.blockedDurationMinutes || 0) - Number(data.visibleDurationMinutes || totalDuration)));
      } else {
        if (availabilityRequestIdRef.current !== requestId) {
          return;
        }
        const data = await response.json().catch(() => null);
        const publicError = data?.error;
        setAvailabilityError({
          kind: publicError?.kind === 'unsupported_technician'
            || publicError?.kind === 'invalid_service'
            || publicError?.kind === 'missing_required_add_on'
            ? publicError.kind
            : 'temporary_failure',
          message: typeof publicError?.message === 'string'
            ? publicError.message
            : 'Unable to load live availability right now. Please try again.',
          canRetry: publicError?.canRetry !== false,
          canReselectTechnician: publicError?.canReselectTechnician === true,
        });
        setVisibleSlots([]);
        setBookedSlots([]);
      }
    } catch (error) {
      if (availabilityRequestIdRef.current !== requestId) {
        return;
      }
      console.error('Failed to fetch availability:', error);
      setAvailabilityError({
        kind: 'temporary_failure',
        message: 'Unable to load live availability right now. Please try another date or refresh.',
        canRetry: true,
        canReselectTechnician: false,
      });
      setVisibleSlots([]);
      setBookedSlots([]);
    } finally {
      if (availabilityRequestIdRef.current === requestId) {
        setLoadingSlots(false);
        setLoadedAvailabilityDateKey(getDateKey(date));
      }
    }
  }, [buildAvailabilityUrl, campaignToken, salonSlug, totalDuration]);

  // Mirror the active date into the URL (shallow — no navigation) so any
  // return to this step restores it. Applies identically to the slot-taken
  // and stale-Smart-Fit recovery flows, which both history-back, and to
  // page refreshes. Every committed date change goes through this.
  const syncSelectedDateToUrl = useCallback((dateKey: string) => {
    const newParams = new URLSearchParams(searchParams.toString());
    if (newParams.get('date') === dateKey) {
      return;
    }
    newParams.set('date', dateKey);
    window.history.replaceState(null, '', `?${newParams.toString()}`);
  }, [searchParams]);

  const findNextAvailableDate = useCallback(async () => {
    if (!selectedDate || findingNextAvailable) {
      return;
    }
    setFindingNextAvailable(true);
    setNextAvailableMessage(null);
    let successfulChecks = 0;
    try {
      for (let dayOffset = 1; dayOffset <= 30; dayOffset += 1) {
        const candidate = new Date(selectedDate);
        candidate.setDate(candidate.getDate() + dayOffset);
        // A closed weekday can never answer with a slot — don't spend a
        // request (and don't let it look like a checked, empty day).
        if (isClosedDay(candidate, closedWeekdaySet)) {
          continue;
        }
        const response = await fetch(buildAvailabilityUrl(candidate), { cache: 'no-store' }).catch(() => null);
        if (!response?.ok) {
          continue;
        }
        successfulChecks += 1;
        const data = await response.json();
        const hasAvailableSlot = Array.isArray(data.slots)
          && data.slots.some((slot: { availability?: string }) => slot.availability === 'available');
        if (hasAvailableSlot) {
          allowTodayAutoAdvanceRef.current = false;
          setSelectedTime(null);
          setSelectedDate(candidate);
          setCurrentMonth(candidate.getMonth());
          setCurrentYear(candidate.getFullYear());
          syncSelectedDateToUrl(getDateKey(candidate));
          pendingScrollRef.current = true;
          scrollRequestIdRef.current += 1;
          scrollTargetDateRef.current = getDateKey(candidate);
          return;
        }
      }
      setNextAvailableMessage(successfulChecks > 0
        ? 'No openings were found in the next 30 days. Contact the salon or try another service.'
        : 'Live availability could not be checked. Please try again shortly.');
    } finally {
      setFindingNextAvailable(false);
    }
  }, [buildAvailabilityUrl, closedWeekdaySet, findingNextAvailable, selectedDate, syncSelectedDateToUrl]);

  // Check if there are any available slots for a given date (unused for now)
  // const getAvailableSlotsForDate = useCallback((date: Date, booked: string[] = []) => {
  //   const filteredByTime = filterPastTimeSlots(allTimeSlots, date);
  //   return filteredByTime.filter(slot => !booked.includes(slot.time));
  // }, [allTimeSlots]);

  // Find next available date starting from given date (unused for now)
  // const findNextAvailableDate = useCallback(async (startDate: Date): Promise<Date> => {
  //   let checkDate = new Date(startDate);
  //   const maxDays = 30;
  //   for (let i = 0; i < maxDays; i++) {
  //     const availableSlots = getAvailableSlotsForDate(checkDate, []);
  //     if (availableSlots.length > 0) return checkDate;
  //     checkDate = new Date(checkDate);
  //     checkDate.setDate(checkDate.getDate() + 1);
  //   }
  //   return startDate;
  // }, [getAvailableSlotsForDate]);

  // Initialize and check if today has available slots (using Toronto timezone)
  useEffect(() => {
    setMounted(true);
    // Arriving from the stale-Smart-Fit screen: focus the refreshed time list
    // once it renders so keyboard/screen-reader users land on the new times.
    if (consumeSmartFitAvailabilityRefresh(salonSlug)) {
      staleRefreshFocusRef.current = true;
    }
  }, [salonSlug]);

  // Fetch booked slots when selected date changes
  useEffect(() => {
    if (selectedDate && mounted) {
      fetchBookedSlots(selectedDate);
    }
  }, [selectedDate, mounted, fetchBookedSlots]);

  useEffect(() => {
    if (
      !mounted
      || loadingSlots
      || !selectedDate
      || autoAdvancedTodayRef.current
      || !allowTodayAutoAdvanceRef.current
      || availabilityError
    ) {
      return;
    }

    const selectedDateMidnight = new Date(selectedDate);
    selectedDateMidnight.setHours(0, 0, 0, 0);
    const todayMidnight = getSalonToday(salonTimeZone);

    if (selectedDateMidnight.toDateString() !== todayMidnight.toDateString()) {
      return;
    }

    // Decide only on evidence. `visibleSlots` is empty on the very first
    // render too, and acting on that emptiness is what moved every client off
    // a today that still had bookable times.
    if (loadedAvailabilityDateKey !== getDateKey(selectedDate)) {
      return;
    }

    if (filterPastTimeSlots(visibleSlots.map(slot => slot.time), selectedDate, salonTimeZone).length > 0) {
      return;
    }

    autoAdvancedTodayRef.current = true;
    const tomorrow = new Date(todayMidnight);
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Skip past any closed weekday: advancing blindly to "tomorrow" is what
    // dropped clients onto a shut Sunday with nothing to choose.
    const nextOpenDay = findFirstOpenDay(tomorrow, closedWeekdaySet);
    setSelectedDate(nextOpenDay);
    setCurrentMonth(nextOpenDay.getMonth());
    setCurrentYear(nextOpenDay.getFullYear());
    syncSelectedDateToUrl(getDateKey(nextOpenDay));
  }, [availabilityError, closedWeekdaySet, loadedAvailabilityDateKey, loadingSlots, mounted, salonTimeZone, selectedDate, syncSelectedDateToUrl, visibleSlots]);

  // A date the client never chose but that the closed-day resolution above
  // moved off today must reach the URL too, so browser-back and the
  // slot-taken/stale-Smart-Fit recoveries restore the day actually shown.
  useEffect(() => {
    if (!mounted || !selectedDate || restoredCalendarDate !== null) {
      return;
    }
    if (selectedDate.toDateString() === today.toDateString()) {
      return;
    }
    syncSelectedDateToUrl(getDateKey(selectedDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Scroll to time slots when loading completes and we have a pending scroll request
  useEffect(() => {
    // Only proceed if: pending scroll requested and not loading
    if (!pendingScrollRef.current || loadingSlots) {
      return;
    }

    // Capture current request ID and target date to detect stale scrolls
    const thisRequestId = scrollRequestIdRef.current;
    const thisTargetDate = scrollTargetDateRef.current;

    // Verify the scroll is for the currently selected date (prevents stale scroll from previous fetch)
    const currentDateKey = selectedDate ? getDateKey(selectedDate) : null;
    if (thisTargetDate !== currentDateKey) {
      // Stale scroll request - clear and bail
      pendingScrollRef.current = false;
      return;
    }

    // Hard timeout - if scroll doesn't happen within 3s, give up quietly
    const SCROLL_TIMEOUT_MS = 3000;
    let hasTimedOut = false;
    const hardTimeoutId = setTimeout(() => {
      hasTimedOut = true;
      pendingScrollRef.current = false;
    }, SCROLL_TIMEOUT_MS);

    // Small delay to ensure DOM has updated after loadingSlots changed
    const scrollTimeoutId = setTimeout(async () => {
      // Bail if unmounted, superseded, or timed out
      if (!isMountedRef.current || scrollRequestIdRef.current !== thisRequestId || hasTimedOut) {
        return;
      }

      // Clear pending flag
      pendingScrollRef.current = false;
      clearTimeout(hardTimeoutId);

      // Find the first available section ref (Smart Fit section preferred,
      // then morning, then afternoon)
      const targetRef = smartFitSlotsRef.current ?? morningSlotsRef.current ?? afternoonSlotsRef.current ?? eveningSlotsRef.current;
      if (!targetRef) {
        // No slots rendered - don't scroll
        return;
      }

      // Scroll to TOP of the section (with 20px padding from top)
      const rect = targetRef.getBoundingClientRect();
      const targetY = window.scrollY + rect.top - 20;

      // Single smooth scroll to the time slots section (800ms)
      await smoothScrollTo(Math.max(0, targetY), 800);
    }, 50); // Small delay for DOM update

    // Cleanup: if effect re-runs or component unmounts, cancel pending scroll
    return () => {
      clearTimeout(scrollTimeoutId);
      clearTimeout(hardTimeoutId);
    };
  }, [loadingSlots, selectedDate, smoothScrollTo]);

  // After a stale Smart Fit response returned the client to this step, move
  // focus to the refreshed time list once it has rendered.
  useEffect(() => {
    if (!staleRefreshFocusRef.current || !mounted || loadingSlots) {
      return;
    }
    if (visibleSlots.length === 0 && !availabilityError) {
      return;
    }
    staleRefreshFocusRef.current = false;
    const target = smartFitSlotsRef.current ?? morningSlotsRef.current ?? afternoonSlotsRef.current ?? eveningSlotsRef.current;
    target?.focus();
  }, [availabilityError, loadingSlots, mounted, visibleSlots]);

  const calendarDays = generateCalendarDays(currentYear, currentMonth);

  // Filter time slots for display
  const availableTimeSet = new Set(filterPastTimeSlots(visibleSlots.map(slot => slot.time), selectedDate, salonTimeZone));
  const availableTimeSlots = toDisplaySlots(visibleSlots.filter(slot => availableTimeSet.has(slot.time)));

  // Check if a slot is booked
  const isSlotBooked = (time: string) => bookedSlots.includes(time);

  // The bookable presentation is derived from the same canonical response
  // used by selection. Slots the server reports as booked remain impossible
  // to choose, but no longer create a wall of disabled controls.
  const bookableTimeSlots = availableTimeSlots.filter(slot => !isSlotBooked(slot.time));

  // Smart Fit grouping (P7.3): server-marked qualifying slots surface in their
  // own section first; every other slot keeps the existing morning/afternoon
  // presentation. With no qualifying slots this is exactly the legacy split.
  const { smartFitSlots, regularSlots } = splitSmartFitSlots(bookableTimeSlots, {
    isSlotUnavailable: slot => isSlotBooked(slot.time),
  });
  const hasSmartFitSlots = smartFitSlots.length > 0;
  const morningSlots = regularSlots.filter(s => s.period === 'morning');
  const afternoonSlots = regularSlots.filter(s => s.period === 'afternoon');
  const eveningSlots = regularSlots.filter(s => s.period === 'evening');
  const availableTimeCount = bookableTimeSlots.length;
  const availabilityCountCopy = availableTimeCount <= 3
    ? `Only ${availableTimeCount} ${availableTimeCount === 1 ? 'opening' : 'openings'} left today`
    : `${availableTimeCount} times available`;
  const timeGridClassName = availableTimeCount === 1
    ? 'grid grid-cols-1 gap-2.5'
    : 'grid grid-cols-2 gap-2.5 sm:grid-cols-3';
  const timeGroups = [
    { key: 'morning' as const, label: 'Morning', ref: morningSlotsRef, slots: morningSlots },
    { key: 'afternoon' as const, label: 'Afternoon', ref: afternoonSlotsRef, slots: afternoonSlots },
    { key: 'evening' as const, label: 'Evening', ref: eveningSlotsRef, slots: eveningSlots },
  ].filter(group => group.slots.length > 0);

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const dayNames = [
    { key: 'sunday', label: 'S' },
    { key: 'monday', label: 'M' },
    { key: 'tuesday', label: 'T' },
    { key: 'wednesday', label: 'W' },
    { key: 'thursday', label: 'T' },
    { key: 'friday', label: 'F' },
    { key: 'saturday', label: 'S' },
  ];

  const closedWeekdayNames = dayNames
    .map((day, index) => (closedWeekdaySet.has(index)
      ? `${day.key.charAt(0).toUpperCase()}${day.key.slice(1)}s`
      : null))
    .filter((name): name is string => name !== null);

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const handleDateSelect = (date: Date) => {
    // Use start-of-day comparison to avoid time-of-day issues
    const dateAtMidnight = new Date(date);
    dateAtMidnight.setHours(0, 0, 0, 0);
    const todayAtMidnight = new Date(today);
    todayAtMidnight.setHours(0, 0, 0, 0);
    const selectedDateKey = selectedDate ? getDateKey(selectedDate) : null;
    const nextDateKey = getDateKey(dateAtMidnight);

    if (
      dateAtMidnight < todayAtMidnight
      || isClosedDay(dateAtMidnight, closedWeekdaySet)
      || selectedDateKey === nextDateKey
    ) {
      return;
    }

    // Manual selection should not trigger surprise auto-advancing to tomorrow.
    allowTodayAutoAdvanceRef.current = false;
    autoAdvancedTodayRef.current = false;

    // Cancel any previous scroll request
    scrollRequestIdRef.current += 1;

    // Set pending scroll flag and target date - useEffect handles scroll when slots load
    pendingScrollRef.current = true;
    scrollTargetDateRef.current = nextDateKey;

    // Update selected date (triggers fetch → loadingSlots → useEffect scroll)
    setSelectedTime(null);
    setSelectedDate(dateAtMidnight);
    syncSelectedDateToUrl(nextDateKey);
  };

  const handleTimeSelect = (slot: DisplayTimeSlot) => {
    if (!selectedDate || isSlotBooked(slot.time)) {
      return;
    }

    const dateStr = getDateKey(selectedDate);
    const nextStep = getNextStep('time', bookingFlow);
    if (!nextStep) {
      return;
    }

    setSelectedTime(slot.time);

    // One nearby Smart Fit suggestion (P7.3): derived only from the loaded
    // availability response for this exact date/technician/location context,
    // and skipped while the client's dismissal for this context stands.
    let suggestion: DisplayTimeSlot | null = null;
    if (!slot.smartFit && hasSmartFitSlots) {
      const contextKey = buildSmartFitSuggestionContextKey({
        salonSlug,
        dateKey: dateStr,
        techId: effectiveTechId,
        locationId: locationId || null,
        baseServiceId,
        serviceIds,
        selectedAddOns,
      });
      if (!syncSmartFitSuggestionDismissal(contextKey)) {
        suggestion = selectNearbySmartFitSuggestion({
          selectedTime: slot.time,
          slots: smartFitSlots,
        });
      }
    }

    router.push(buildBookingUrl(`/${locale}/book/${nextStep}`, {
      salonSlug,
      serviceIds: serviceIds.length > 0 ? serviceIds : undefined,
      baseServiceId,
      selectedAddOns,
      techId: effectiveTechId,
      date: dateStr,
      time: slot.time,
      startTime: slot.startTime,
      locationId,
      originalAppointmentId,
      manageToken,
      campaignToken,
      smartFitDiscountCents: slot.smartFit?.discountAmountCents ?? null,
      smartFitTotalCents: slot.smartFit?.discountedPriceCents ?? null,
      smartFitSuggestTime: suggestion?.time ?? null,
      smartFitSuggestStartTime: suggestion?.startTime ?? null,
      smartFitSuggestDiscountCents: suggestion?.smartFit?.discountAmountCents ?? null,
      smartFitSuggestTotalCents: suggestion?.smartFit?.discountedPriceCents ?? null,
    }, {
      routeSalonSlug,
      locale,
    }));
  };

  const handleBack = () => {
    const prevStep = getPrevStep('time', bookingFlow);
    if (prevStep) {
      router.push(buildBookingUrl(`/${locale}/book/${prevStep}`, {
        salonSlug,
        serviceIds: serviceIds.length > 0 ? serviceIds : undefined,
        baseServiceId,
        selectedAddOns,
        techId: effectiveTechId,
        locationId,
        originalAppointmentId,
        manageToken,
        campaignToken,
      }, {
        routeSalonSlug,
        locale,
      }));
    } else {
      router.back();
    }
  };

  const handleChooseAnotherTechnician = () => {
    router.push(buildBookingUrl(`/${locale}/book/tech`, {
      salonSlug,
      serviceIds: serviceIds.length > 0 ? serviceIds : undefined,
      baseServiceId,
      selectedAddOns,
      locationId,
      originalAppointmentId,
      manageToken,
      campaignToken,
    }, {
      routeSalonSlug,
      locale,
    }));
  };

  const formatSelectedDate = (date: Date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const handleChooseAnotherDate = () => {
    calendarRef.current?.focus();
    calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Check if there are no available slots at all for today
  const noSlotsAvailable = selectedDate && availableTimeSlots.length === 0;
  const allSlotsBooked = selectedDate && availableTimeSlots.length > 0 && bookableTimeSlots.length === 0;

  return (
    <main
      className="min-h-screen"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10 sm:max-w-[620px]">
        <BookingStepHeader
          salonName={salonName}
          mounted={mounted}
          title="Pick Your Time"
          description={selectedDate
            ? `${formatSelectedDate(selectedDate)} · Tap another date to change`
            : 'Select a day that works for you'}
          bookingFlow={bookingFlow}
          currentStep="time"
          isFirstStep={isFirstStep}
          onBack={handleBack}
          className="-mb-1"
        />

        <BookingSummaryCard
          mounted={mounted}
          serviceNames={serviceNames}
          totalDuration={totalDuration}
          totalPrice={totalPrice}
          locationName={locationName}
          technician={technician}
        />

        <p className="mb-4 text-center text-xs font-medium text-neutral-500">
          {minimumNoticeMinutes === undefined
            ? 'Available times reflect the salon’s booking notice.'
            : getMinimumNoticeCustomerCopy(minimumNoticeMinutes)}
          {' '}
          All times are shown in salon time (
          {getTimeZoneLabel(salonTimeZone)}
          ).
        </p>

        {/* Calendar Card */}
        <div
          ref={calendarRef}
          tabIndex={-1}
          aria-label="Choose an appointment date"
          className="mb-4 overflow-hidden rounded-3xl bg-white shadow-[0_12px_32px_-22px_rgba(63,43,36,0.34)] max-[339px]:-mx-3"
          style={{
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: themeVars.cardBorder,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
          }}
        >
          {/* Month Navigation */}
          <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Previous month"
              className="flex size-11 items-center justify-center rounded-full transition-all hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95 motion-reduce:transition-none motion-reduce:active:transform-none"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="text-lg font-bold text-neutral-900">
              {monthNames[currentMonth]}
              {' '}
              {currentYear}
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Next month"
              className="flex size-11 items-center justify-center rounded-full transition-all hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95 motion-reduce:transition-none motion-reduce:active:transform-none"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Day Names */}
          <div className="grid grid-cols-7 px-4 pt-3 max-[339px]:px-0">
            {dayNames.map(day => (
              <div key={day.key} className="py-2 text-center text-xs font-bold text-neutral-400">
                {day.label}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 px-4 pb-4 max-[339px]:px-0">
            {calendarDays.map(({ key, date }) => {
              if (!date) {
                return <div key={key} className="h-11" />;
              }

              const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();
              const isToday = date.toDateString() === today.toDateString();
              const isPast = date < today && !isToday;
              const isClosed = isClosedDay(date, closedWeekdaySet);
              const isUnselectable = Boolean(isPast || isClosed);

              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  data-testid={`calendar-day-${getDateKey(date)}`}
                  data-closed={isClosed ? 'true' : undefined}
                  onClick={() => handleDateSelect(date)}
                  disabled={Boolean(isUnselectable || isSelected)}
                  aria-label={isClosed
                    ? `${monthNames[date.getMonth()]} ${date.getDate()} — closed`
                    : undefined}
                  title={isClosed ? 'The salon is closed on this day' : undefined}
                  className="h-11 min-w-11 rounded-full text-sm font-semibold transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
                  style={{
                    zIndex: isSelected ? 10 : undefined,
                    background: isSelected
                      ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                      : isToday && !isClosed
                        ? themeVars.accent
                        : undefined,
                    color: isPast
                      ? '#d4d4d4'
                      : isSelected
                        ? '#171717'
                        : isClosed
                          ? '#a3a3a3'
                          : isToday
                            ? 'white'
                            : '#404040',
                    textDecoration: isClosed && !isPast ? 'line-through' : undefined,
                    boxShadow: isSelected ? `0 0 0 3px color-mix(in srgb, ${themeVars.primary} 22%, transparent)` : undefined,
                    cursor: isUnselectable ? 'not-allowed' : 'pointer',
                    opacity: loadingSlots && !isSelected ? 0.6 : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (!isUnselectable && !isSelected && !isToday) {
                      e.currentTarget.style.backgroundColor = themeVars.background;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isUnselectable && !isSelected && !isToday) {
                      e.currentTarget.style.backgroundColor = '';
                    }
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {closedWeekdaySet.size > 0 && closedWeekdaySet.size < 7
            ? (
                <p
                  data-testid="calendar-closed-legend"
                  className="border-t border-neutral-100 px-5 py-2.5 text-center text-xs font-medium text-neutral-500"
                >
                  <span className="mr-1.5 align-middle text-neutral-400 line-through">00</span>
                  Closed —
                  {' '}
                  {closedWeekdayNames.join(', ')}
                </p>
              )
            : null}
        </div>

        {/* No slots available message */}
        {availabilityError && !loadingSlots && (
          <StateCard
            tone="error"
            className="mb-4"
            contentClassName="py-4"
            title="Availability could not be loaded"
            description={availabilityError.message}
            action={availabilityError.canReselectTechnician
              ? (
                  <button type="button" onClick={handleChooseAnotherTechnician} className="mt-2 min-h-11 rounded-full bg-red-900 px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                    Choose another technician
                  </button>
                )
              : availabilityError.canRetry
                ? (
                    <button type="button" onClick={() => selectedDate && void fetchBookedSlots(selectedDate)} className="mt-2 min-h-11 rounded-full bg-red-900 px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                      Retry
                    </button>
                  )
                : undefined}
          />
        )}

        {(noSlotsAvailable || allSlotsBooked) && !availabilityError && (
          <section
            aria-labelledby="no-openings-title"
            data-public-surface="timeSelectionControls"
            className="mb-4 rounded-[1.75rem] border bg-white px-5 py-6 text-center shadow-[0_16px_40px_-28px_rgba(63,43,36,0.42)]"
            style={{ borderColor: themeVars.cardBorder }}
          >
            <div
              className="mx-auto flex size-12 items-center justify-center rounded-2xl"
              style={{ backgroundColor: themeVars.surfaceAlt, color: themeVars.accent }}
            >
              <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none">
                <path d="M7 3v3M17 3v3M4 9h16M6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 17.5 4h-11A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="m9.5 12.5 5 5M14.5 12.5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            <h2
              id="no-openings-title"
              className="mx-auto mt-4 max-w-md text-[1.35rem] font-semibold leading-tight tracking-[-0.02em]"
              style={{ color: themeVars.titleText, fontFamily: 'var(--n5-font-heading)' }}
            >
              No openings on
              {' '}
              {selectedDate ? formatSelectedDate(selectedDate) : 'this date'}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6" style={{ color: themeVars.secondaryText }}>
              {nextAvailableMessage || 'Try another date to find the next available appointment.'}
            </p>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => void findNextAvailableDate()}
                disabled={findingNextAvailable}
                className="min-h-12 rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:translate-y-0 disabled:opacity-60 motion-reduce:transform-none"
                style={{ backgroundColor: themeVars.accent }}
              >
                {findingNextAvailable ? 'Checking the next 30 days…' : 'Find next available'}
              </button>
              <button
                type="button"
                onClick={handleChooseAnotherDate}
                className="min-h-12 rounded-2xl border bg-white px-5 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ borderColor: themeVars.borderMuted, color: themeVars.titleText }}
              >
                Choose another date
              </button>
            </div>
          </section>
        )}

        {/* Time Selection - Only shows when date is selected and has available slots */}
        {selectedDate && !noSlotsAvailable && !allSlotsBooked && (
          <div
            className="space-y-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 250ms, transform 300ms ease-out 250ms',
            }}
          >
            {/* Loading indicator */}
            {loadingSlots && (
              <StateCard
                className="border-dashed"
                contentClassName="py-5"
                title="Checking live availability"
                description="Refreshing the latest schedule for this day."
              />
            )}

            {!loadingSlots && (
              <div
                className="flex items-start gap-3 rounded-2xl border bg-white/75 px-4 py-3 text-[13px] leading-5"
                style={{ borderColor: themeVars.cardBorder, color: themeVars.titleText }}
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: themeVars.surfaceAlt, color: themeVars.accent }}
                >
                  <svg className="size-4" viewBox="0 0 20 20" fill="none">
                    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M10 6v4l2.5 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <p className="min-w-0 pt-1">
                  Your service takes
                  {' '}
                  <strong>{totalDuration >= 60 ? `${Math.floor(totalDuration / 60)}h ${totalDuration % 60 ? `${totalDuration % 60}m` : ''}`.trim() : `${totalDuration}m`}</strong>
                  {availabilityBufferMinutes > 0 ? ` plus ${availabilityBufferMinutes} minutes of preparation time` : ''}
                  .
                </p>
              </div>
            )}

            {!loadingSlots && (
              <section
                aria-labelledby="availability-heading"
                data-public-surface="timeSelectionControls"
                className="overflow-hidden rounded-[1.75rem] border bg-white shadow-[0_16px_40px_-28px_rgba(63,43,36,0.42)]"
                style={{ borderColor: themeVars.cardBorder }}
              >
                <div className="px-5 pb-4 pt-5 sm:px-6">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: themeVars.secondaryText }}>
                    {formatSelectedDate(selectedDate)}
                  </p>
                  <h2
                    id="availability-heading"
                    className="mt-1 text-[1.45rem] font-semibold leading-tight -tracking-wide"
                    style={{ color: themeVars.titleText, fontFamily: 'var(--n5-font-heading)' }}
                    aria-live="polite"
                  >
                    {availabilityCountCopy}
                  </h2>
                </div>

                {/* Smart Fit qualifying times (P7.3) — server-derived offers only */}
                {hasSmartFitSlots && (
                  <div
                    data-public-surface="smartFitAvailabilitySection"
                    ref={smartFitSlotsRef}
                    tabIndex={-1}
                    role="region"
                    aria-label={SMART_FIT_SECTION_TITLE}
                    className="scroll-mt-4 border-t p-5 sm:px-6"
                    style={{
                      borderColor: `color-mix(in srgb, ${themeVars.primary} 32%, ${themeVars.cardBorder})`,
                      backgroundColor: `color-mix(in srgb, ${themeVars.highlightBackground} 55%, white)`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `color-mix(in srgb, ${themeVars.primary} 18%, white)`, color: themeVars.accent }}
                      >
                        <svg className="size-4" viewBox="0 0 20 20" fill="none">
                          <path d="M10 2.5c.55 3.65 2.35 5.45 6 6-3.65.55-5.45 2.35-6 6-.55-3.65-2.35-5.45-6-6 3.65-.55 5.45-2.35 6-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <div>
                        <h3 className="text-sm font-bold" style={{ color: themeVars.titleText }}>{SMART_FIT_SECTION_TITLE}</h3>
                        <p className="mt-0.5 text-xs leading-5" style={{ color: themeVars.secondaryText }}>{SMART_FIT_SECTION_DESCRIPTION}</p>
                      </div>
                    </div>
                    <div className={`${timeGridClassName} mt-4`}>
                      {smartFitSlots.map((slot) => {
                        const offer = slot.smartFit;
                        if (!offer) {
                          return null;
                        }
                        const isSelectedTime = selectedTime === slot.time;
                        return (
                          <button
                            key={slot.time}
                            type="button"
                            data-testid={`smart-fit-slot-${slot.time}`}
                            data-selected={isSelectedTime ? 'true' : 'false'}
                            onClick={() => handleTimeSelect(slot)}
                            aria-label={`${isSelectedTime ? 'Selected. ' : ''}${formatTime12h(slot.time)} — ${SMART_FIT_BADGE_LABEL}: save ${formatMoney(offer.discountAmountCents)}. ${formatMoney(offer.discountedPriceCents)} instead of ${formatMoney(offer.originalPriceCents)}.`}
                            className="min-h-[60px] min-w-0 rounded-2xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-selected-ring)] focus-visible:ring-offset-2 active:translate-y-0 motion-reduce:transform-none"
                            style={{
                              borderColor: isSelectedTime ? themeVars.accent : `color-mix(in srgb, ${themeVars.primary} 42%, ${themeVars.cardBorder})`,
                              background: isSelectedTime ? themeVars.selectedBackground : themeVars.cardBackground,
                            }}
                          >
                            <span aria-hidden="true" className="block min-w-0">
                              <span className="flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5">
                                <span className="text-sm font-bold" style={{ color: themeVars.titleText }}>{formatTime12h(slot.time)}</span>
                                <span
                                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                                  style={{ backgroundColor: `color-mix(in srgb, ${themeVars.primary} 22%, white)`, color: themeVars.titleText }}
                                >
                                  {SMART_FIT_BADGE_LABEL}
                                </span>
                              </span>
                              <span className="mt-1 block text-xs font-semibold text-emerald-700">
                                {`Save ${formatMoney(offer.discountAmountCents)}`}
                              </span>
                              <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                                <span className="text-base font-bold" style={{ color: themeVars.titleText }}>{formatMoney(offer.discountedPriceCents)}</span>
                                <s className="text-xs font-medium" style={{ color: themeVars.secondaryText }}>{formatMoney(offer.originalPriceCents)}</s>
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {hasSmartFitSlots && timeGroups.length > 0 && (
                  <h3 className="border-t px-5 pt-5 text-sm font-bold sm:px-6" style={{ borderColor: themeVars.cardBorder, color: themeVars.titleText }}>
                    {SMART_FIT_OTHER_TIMES_TITLE}
                  </h3>
                )}

                {timeGroups.map(group => (
                  <div
                    key={group.key}
                    ref={group.ref}
                    tabIndex={-1}
                    role="region"
                    aria-label={`${group.label} times`}
                    className="scroll-mt-4 border-t p-5 sm:px-6"
                    style={{ borderColor: themeVars.cardBorder }}
                  >
                    <div className="mb-3.5 flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex size-8 items-center justify-center rounded-xl"
                        style={{ backgroundColor: themeVars.surfaceAlt, color: themeVars.accent }}
                      >
                        <DaypartIcon period={group.key} />
                      </span>
                      <h3 className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: themeVars.titleText }}>
                        {group.label}
                      </h3>
                    </div>
                    <div className={availableTimeCount === 1 ? timeGridClassName : group.slots.length === 1 ? 'grid grid-cols-1 gap-2.5 sm:grid-cols-3' : timeGridClassName}>
                      {group.slots.map((slot, index) => {
                        const isSelectedTime = selectedTime === slot.time;
                        const isSoleOpening = availableTimeCount === 1;
                        return (
                          <button
                            key={slot.time}
                            type="button"
                            data-testid={`time-slot-${slot.time}`}
                            data-selected={isSelectedTime ? 'true' : 'false'}
                            onClick={() => handleTimeSelect(slot)}
                            aria-label={`${formatTime12h(slot.time)}${isSelectedTime ? ', selected' : ''}`}
                            className={`relative flex ${isSoleOpening ? 'min-h-[60px] justify-between px-5 text-base text-white' : 'min-h-[52px] justify-center px-3 text-sm'} items-center rounded-2xl border font-bold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-selected-ring)] focus-visible:ring-offset-2 active:translate-y-0 motion-reduce:transform-none`}
                            style={{
                              animationDelay: `${index * 30}ms`,
                              background: isSoleOpening || isSelectedTime ? themeVars.accent : themeVars.surfaceAlt,
                              borderColor: isSoleOpening || isSelectedTime ? themeVars.accent : themeVars.borderMuted,
                              boxShadow: isSelectedTime ? `0 0 0 3px color-mix(in srgb, ${themeVars.primary} 30%, transparent)` : undefined,
                              color: isSoleOpening || isSelectedTime ? 'white' : themeVars.titleText,
                            }}
                          >
                            <span>{formatTime12h(slot.time)}</span>
                            {isSoleOpening && (
                              <span aria-hidden="true" className="flex items-center gap-1.5 text-xs font-semibold text-white/75">
                                Choose
                                <svg className="size-4" viewBox="0 0 16 16" fill="none">
                                  <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div
                  className="border-t px-5 py-4 text-center sm:px-6"
                  style={{ borderColor: themeVars.cardBorder, backgroundColor: themeVars.surfaceAlt }}
                >
                  {availableTimeCount === 1 && (
                    <p className="mb-3 text-sm font-medium" style={{ color: themeVars.secondaryText }}>
                      No other times available today.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleChooseAnotherDate}
                    className="min-h-11 w-full rounded-2xl border bg-white px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-selected-ring)] focus-visible:ring-offset-2 sm:w-auto"
                    style={{ borderColor: themeVars.borderMuted, color: themeVars.titleText }}
                  >
                    Check another date
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {/* Help text when no date selected */}
        {!selectedDate && (
          <div
            className="py-8 text-center"
            style={{
              opacity: mounted ? 1 : 0,
              transition: 'opacity 300ms ease-out 300ms',
            }}
          >
            <div className="mb-3 text-4xl">📅</div>
            <p className="text-sm text-neutral-500">
              Tap a date above to see available times
            </p>
          </div>
        )}

        {/* Footer */}
        <div
          className="mt-6 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 400ms',
          }}
        >
          <p className="text-xs text-neutral-400">
            ✨ No payment required to reserve
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            Online changes follow this salon&apos;s cancellation policy
          </p>
        </div>

      </div>
    </main>
  );
}
