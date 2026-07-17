'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BookingStepHeader } from '@/components/booking/BookingStepHeader';
import { BookingSummaryCard } from '@/components/booking/BookingSummaryCard';
import { StateCard } from '@/components/ui/state-card';
import { useBookingState } from '@/hooks/useBookingState';
import { type BookingStep, getFirstStep, getNextStep, getPrevStep } from '@/libs/bookingFlow';
import { buildBookingUrl, parseSelectedAddOnsParam } from '@/libs/bookingParams';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

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
  salonTimeZone?: string;
};

const EMPTY_ADD_ONS: AddOnSummary[] = [];

type DisplayTimeSlot = {
  time: string;
  startTime: string | null;
  period: 'morning' | 'afternoon';
};

type AvailabilitySlot = {
  time: string;
  startTime?: string | null;
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
      period: Number.parseInt(hour, 10) < 12 ? 'morning' : 'afternoon',
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
  salonTimeZone = DEFAULT_SALON_TIMEZONE,
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

  // Use global booking state - this is the single source of truth
  const { technicianId: stateTechId = null, syncFromUrl = () => {} } = useBookingState();

  // Sync from URL params on mount (for deep links and reschedule flows)
  useEffect(() => {
    const urlTechId = searchParams.get('techId');
    if (urlTechId) {
      syncFromUrl({
        techId: urlTechId,
        technicianSelectionSource,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const serviceNames = [
    ...services.map(s => s.name),
    ...addOns.map(addOn => addOn.quantity > 1 ? `${addOn.name} x${addOn.quantity}` : addOn.name),
  ].join(' + ');

  // "Today" is defined by the salon's timezone, not the visitor's device.
  const today = getSalonToday(salonTimeZone);

  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);
  const [visibleSlots, setVisibleSlots] = useState<AvailabilitySlot[]>([]);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [availabilityBufferMinutes, setAvailabilityBufferMinutes] = useState(0);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [findingNextAvailable, setFindingNextAvailable] = useState(false);
  const [nextAvailableMessage, setNextAvailableMessage] = useState<string | null>(null);

  // Refs for smooth scrolling to time slot sections
  const morningSlotsRef = useRef<HTMLDivElement>(null);
  const afternoonSlotsRef = useRef<HTMLDivElement>(null);

  // Scroll state refs - pendingScroll triggers scroll when slots load
  const pendingScrollRef = useRef(false);
  const scrollRequestIdRef = useRef(0);
  const scrollTargetDateRef = useRef<string | null>(null); // Track which date the scroll is for
  const isMountedRef = useRef(true);
  const autoAdvancedTodayRef = useRef(false);
  const allowTodayAutoAdvanceRef = useRef(true);
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
    const effectiveTechId = techId || stateTechId;
    const techParam = effectiveTechId && effectiveTechId !== 'any' ? `&technicianId=${effectiveTechId}` : '';
    const durationParam = !baseServiceId ? `&durationMinutes=${totalDuration}` : '';
    const serviceParam = serviceIdsParam ? `&serviceIds=${encodeURIComponent(serviceIdsParam)}` : '';
    const baseServiceParam = baseServiceId ? `&baseServiceId=${encodeURIComponent(baseServiceId)}` : '';
    const addOnsParam = selectedAddOns.length > 0 ? `&selectedAddOns=${encodeURIComponent(JSON.stringify(selectedAddOns))}` : '';
    const locationParam = locationId ? `&locationId=${encodeURIComponent(locationId)}` : '';
    const rescheduleParam = originalAppointmentId ? `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}` : '';
    return `/api/appointments/availability?date=${dateStr}&salonSlug=${salonSlug}${techParam}${durationParam}${serviceParam}${baseServiceParam}${addOnsParam}${locationParam}${rescheduleParam}`;
  }, [baseServiceId, locationId, originalAppointmentId, salonSlug, selectedAddOns, serviceIdsParam, stateTechId, techId, totalDuration]);

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
        setAvailabilityError(data?.error?.message ?? 'Unable to load live availability for this technician.');
        setVisibleSlots([]);
        setBookedSlots([]);
      }
    } catch (error) {
      if (availabilityRequestIdRef.current !== requestId) {
        return;
      }
      console.error('Failed to fetch availability:', error);
      setAvailabilityError('Unable to load live availability right now. Please try another date or refresh.');
      setVisibleSlots([]);
      setBookedSlots([]);
    } finally {
      if (availabilityRequestIdRef.current === requestId) {
        setLoadingSlots(false);
      }
    }
  }, [buildAvailabilityUrl, salonSlug, totalDuration]);

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
          setSelectedDate(candidate);
          setCurrentMonth(candidate.getMonth());
          setCurrentYear(candidate.getFullYear());
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
  }, [buildAvailabilityUrl, findingNextAvailable, selectedDate]);

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
  }, []);

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

    if (filterPastTimeSlots(visibleSlots.map(slot => slot.time), selectedDate, salonTimeZone).length > 0) {
      return;
    }

    autoAdvancedTodayRef.current = true;
    const tomorrow = new Date(todayMidnight);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setSelectedDate(tomorrow);
    setCurrentMonth(tomorrow.getMonth());
    setCurrentYear(tomorrow.getFullYear());
  }, [availabilityError, loadingSlots, mounted, salonTimeZone, selectedDate, visibleSlots]);

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

      // Find the first available section ref (morning preferred, then afternoon)
      const targetRef = morningSlotsRef.current ?? afternoonSlotsRef.current;
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

  const calendarDays = generateCalendarDays(currentYear, currentMonth);

  // Filter time slots for display
  const availableTimeSet = new Set(filterPastTimeSlots(visibleSlots.map(slot => slot.time), selectedDate, salonTimeZone));
  const availableTimeSlots = toDisplaySlots(visibleSlots.filter(slot => availableTimeSet.has(slot.time)));
  const morningSlots = availableTimeSlots.filter(s => s.period === 'morning');
  const afternoonSlots = availableTimeSlots.filter(s => s.period === 'afternoon');

  // Check if a slot is booked
  const isSlotBooked = (time: string) => bookedSlots.includes(time);

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
      || loadingSlots
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
    setSelectedDate(dateAtMidnight);
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

    // Use stateTechId if available, otherwise fall back to URL techId
    const effectiveTechId = stateTechId || techId || 'any';
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
    }, {
      routeSalonSlug,
      locale,
    }));
  };

  const handleBack = () => {
    const prevStep = getPrevStep('time', bookingFlow);
    if (prevStep) {
      // Use stateTechId if available, otherwise fall back to URL techId
      const effectiveTechId = stateTechId || techId;
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

  const formatSelectedDate = (date: Date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  // Check if there are no available slots at all for today
  const noSlotsAvailable = selectedDate && availableTimeSlots.length === 0;
  const allSlotsBooked = selectedDate && availableTimeSlots.length > 0 && availableTimeSlots.every(s => isSlotBooked(s.time));

  return (
    <div
      className="min-h-screen"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
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
          Same-day bookings need 2 hours notice.
          {' '}
          All times are shown in salon time (
          {getTimeZoneLabel(salonTimeZone)}
          ).
        </p>

        {/* Calendar Card */}
        <div
          className="mb-4 overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
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
              className="flex size-10 items-center justify-center rounded-full transition-all hover:bg-neutral-100 active:scale-95"
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
              className="flex size-10 items-center justify-center rounded-full transition-all hover:bg-neutral-100 active:scale-95"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Day Names */}
          <div className="grid grid-cols-7 px-4 pt-3">
            {dayNames.map(day => (
              <div key={day.key} className="py-2 text-center text-xs font-bold text-neutral-400">
                {day.label}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1 px-4 pb-4">
            {calendarDays.map(({ key, date }) => {
              if (!date) {
                return <div key={key} className="h-11" />;
              }

              const isSelected = selectedDate && date.toDateString() === selectedDate.toDateString();
              const isToday = date.toDateString() === today.toDateString();
              const isPast = date < today && !isToday;

              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  data-testid={`calendar-day-${getDateKey(date)}`}
                  onClick={() => handleDateSelect(date)}
                  disabled={Boolean(isPast || loadingSlots || isSelected)}
                  className="h-11 rounded-xl text-sm font-semibold transition-all duration-200"
                  style={{
                    transform: isSelected ? 'scale(1.1)' : undefined,
                    zIndex: isSelected ? 10 : undefined,
                    background: isSelected
                      ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                      : isToday
                        ? themeVars.accent
                        : undefined,
                    color: isPast
                      ? '#d4d4d4'
                      : isSelected
                        ? '#171717'
                        : isToday
                          ? 'white'
                          : '#404040',
                    boxShadow: isSelected ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
                    cursor: isPast ? 'not-allowed' : 'pointer',
                    opacity: loadingSlots && !isSelected ? 0.6 : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (!isPast && !isSelected && !isToday) {
                      e.currentTarget.style.backgroundColor = themeVars.background;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isPast && !isSelected && !isToday) {
                      e.currentTarget.style.backgroundColor = '';
                    }
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {/* No slots available message */}
        {availabilityError && !loadingSlots && (
          <StateCard
            tone="error"
            className="mb-4"
            contentClassName="py-4"
            title="Availability could not be loaded"
            description={availabilityError}
          />
        )}

        {(noSlotsAvailable || allSlotsBooked) && !availabilityError && (
          <StateCard
            tone="warning"
            className="mb-4"
            contentClassName="py-4"
            icon="⏰"
            title={noSlotsAvailable
              ? 'No bookable times remain for this day.'
              : 'This day is fully booked.'}
            description={nextAvailableMessage || 'Choose another date or let Luster find the next opening.'}
            action={(
              <button type="button" onClick={() => void findNextAvailableDate()} disabled={findingNextAvailable} className="mt-2 rounded-full bg-amber-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {findingNextAvailable ? 'Checking the next 30 days…' : 'Find next available'}
              </button>
            )}
          />
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
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-950">
                Your service takes
                {' '}
                <strong>{totalDuration >= 60 ? `${Math.floor(totalDuration / 60)}h ${totalDuration % 60 ? `${totalDuration % 60}m` : ''}`.trim() : `${totalDuration}m`}</strong>
                {availabilityBufferMinutes > 0 ? ` plus ${availabilityBufferMinutes} minutes of preparation time` : ''}
                . Times marked unavailable overlap existing schedule time.
              </div>
            )}

            {/* Morning Times */}
            {morningSlots.length > 0 && !loadingSlots && (
              <div
                ref={morningSlotsRef}
                className="scroll-mt-4 overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                style={{
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: themeVars.cardBorder,
                }}
              >
                <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
                  <span className="text-xl">🌅</span>
                  <span className="text-sm font-bold text-neutral-900">Morning</span>
                  <span className="text-xs text-neutral-400">Earlier time slots</span>
                </div>
                <div className="grid grid-cols-3 gap-2 p-4">
                  {morningSlots.map((slot, i) => {
                    const booked = isSlotBooked(slot.time);
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        data-testid={`time-slot-${slot.time}`}
                        onClick={() => handleTimeSelect(slot)}
                        disabled={booked}
                        className={`relative rounded-xl px-2 py-3 text-sm font-bold transition-all duration-200 ${
                          booked
                            ? 'cursor-not-allowed opacity-50'
                            : 'text-neutral-800 hover:scale-105 hover:text-neutral-900 hover:shadow-md active:scale-95'
                        }`}
                        style={{
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: booked
                            ? '#e5e5e5'
                            : `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`,
                          background: booked
                            ? '#f5f5f5'
                            : `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`,
                          animationDelay: `${i * 30}ms`,
                        }}
                        onMouseEnter={(e) => {
                          if (!booked) {
                            e.currentTarget.style.background = `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!booked) {
                            e.currentTarget.style.background = `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`;
                          }
                        }}
                      >
                        {formatTime12h(slot.time)}
                        {booked && (
                          <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            Unavailable
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Afternoon Times */}
            {afternoonSlots.length > 0 && !loadingSlots && (
              <div
                ref={afternoonSlotsRef}
                className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                style={{
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: themeVars.cardBorder,
                }}
              >
                <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
                  <span className="text-xl">☀️</span>
                  <span className="text-sm font-bold text-neutral-900">Afternoon</span>
                  <span className="text-xs text-neutral-400">Later time slots</span>
                </div>
                <div className="grid grid-cols-3 gap-2 p-4">
                  {afternoonSlots.map((slot, i) => {
                    const booked = isSlotBooked(slot.time);
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        data-testid={`time-slot-${slot.time}`}
                        onClick={() => handleTimeSelect(slot)}
                        disabled={booked}
                        className={`relative rounded-xl px-2 py-3 text-sm font-bold transition-all duration-200 ${
                          booked
                            ? 'cursor-not-allowed opacity-50'
                            : 'text-neutral-800 hover:scale-105 hover:text-neutral-900 hover:shadow-md active:scale-95'
                        }`}
                        style={{
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: booked
                            ? '#e5e5e5'
                            : `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`,
                          background: booked
                            ? '#f5f5f5'
                            : `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`,
                          animationDelay: `${(i + morningSlots.length) * 30}ms`,
                        }}
                        onMouseEnter={(e) => {
                          if (!booked) {
                            e.currentTarget.style.background = `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!booked) {
                            e.currentTarget.style.background = `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`;
                          }
                        }}
                      >
                        {formatTime12h(slot.time)}
                        {booked && (
                          <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            Unavailable
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
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
    </div>
  );
}
