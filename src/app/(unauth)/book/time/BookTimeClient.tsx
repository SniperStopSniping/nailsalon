'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BookingStepHeader } from '@/components/booking/BookingStepHeader';
import { BookingSummaryCard } from '@/components/booking/BookingSummaryCard';
import { BookingFloatingDock } from '@/components/booking/BookingFloatingDock';
import { BookingPhoneLogin } from '@/components/booking/BookingPhoneLogin';
import { StateCard } from '@/components/ui/state-card';
import { useClientSession } from '@/hooks/useClientSession';
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
  bookingFlow: BookingStep[];
};

type DisplayTimeSlot = {
  time: string;
  period: 'morning' | 'afternoon';
};

function toDisplaySlots(slotTimes: string[]): DisplayTimeSlot[] {
  return slotTimes.map((time) => {
    const [hour = '0'] = time.split(':');
    return {
      time,
      period: Number.parseInt(hour, 10) < 12 ? 'morning' : 'afternoon',
    };
  });
}

function getDateKey(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}

const generateCalendarDays = (year: number, month: number) => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days: (Date | null)[] = [];

  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
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

// Toronto timezone constant
const TORONTO_TIMEZONE = 'America/Toronto';

// Get current date/time in Toronto timezone
const getTorontoNow = () => {
  const now = new Date();
  // Get Toronto time components
  const torontoString = now.toLocaleString('en-US', { timeZone: TORONTO_TIMEZONE });
  return new Date(torontoString);
};

// Get today's date at midnight in Toronto timezone
const getTorontoToday = () => {
  const torontoNow = getTorontoNow();
  torontoNow.setHours(0, 0, 0, 0);
  return torontoNow;
};

// Minimum lead time in minutes (must book at least this far in advance)
const MIN_LEAD_TIME_MINUTES = 30;

// Filter out past time slots and slots within the lead time buffer (using Toronto timezone)
const filterPastTimeSlots = (
  slotTimes: string[],
  date: Date | null,
) => {
  if (!date) {
    return slotTimes;
  }

  const torontoNow = getTorontoNow();
  const torontoToday = getTorontoToday();

  // Check if selected date is today in Toronto timezone
  const selectedDateMidnight = new Date(date);
  selectedDateMidnight.setHours(0, 0, 0, 0);
  const isToday = selectedDateMidnight.toDateString() === torontoToday.toDateString();

  if (!isToday) {
    return slotTimes;
  }

  // Calculate minimum allowed booking time (now + 30 min buffer)
  const minimumBookingTime = new Date(torontoNow.getTime() + MIN_LEAD_TIME_MINUTES * 60 * 1000);

  // Filter out times that are past OR within the 30-minute buffer
  return slotTimes.filter((slotTimeValue) => {
    const [hours, minutes] = slotTimeValue.split(':').map(Number);
    const slotTime = new Date(selectedDateMidnight);
    slotTime.setHours(hours || 0, minutes || 0, 0, 0);
    return slotTime >= minimumBookingTime;
  });
};

export function BookTimeClient({
  services,
  addOns = [],
  totalPrice,
  totalDuration,
  locationName = null,
  technician,
  bookingFlow,
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

  // Check if this is the first step in the booking flow (for dock/login visibility)
  const isFirstStep = getFirstStep(bookingFlow) === 'time';

  // Use shared auth hook
  const { isLoggedIn, isCheckingSession, handleLoginSuccess } = useClientSession();

  // Use global booking state - this is the single source of truth
  const { technicianId: stateTechId = null, syncFromUrl = () => {} } = useBookingState();

  // Sync from URL params on mount (for deep links and reschedule flows)
  useEffect(() => {
    const urlTechId = searchParams.get('techId');
    if (urlTechId) {
      syncFromUrl({ techId: urlTechId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const serviceNames = [
    ...services.map(s => s.name),
    ...addOns.map(addOn => addOn.quantity > 1 ? `${addOn.name} x${addOn.quantity}` : addOn.name),
  ].join(' + ');

  // Use Toronto timezone for "today"
  const today = getTorontoToday();

  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);
  const [visibleSlotTimes, setVisibleSlotTimes] = useState<string[]>([]);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

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
      const startTime = performance.now();

      const easeInOutCubic = (t: number): number => {
        return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      };

      const step = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
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

  // Fetch booked slots for selected date and technician
  const fetchBookedSlots = useCallback(async (date: Date) => {
    if (!salonSlug) {
      return;
    }

    const requestId = ++availabilityRequestIdRef.current;
    setLoadingSlots(true);
    setAvailabilityError(null);
    try {
      const dateStr = getDateKey(date);
      // The explicit URL selection should win over any persisted local booking state.
      const effectiveTechId = techId || stateTechId;
      const techParam = effectiveTechId && effectiveTechId !== 'any' ? `&technicianId=${effectiveTechId}` : '';
      const durationParam = !baseServiceId ? `&durationMinutes=${totalDuration}` : '';
      const serviceParam = serviceIdsParam
        ? `&serviceIds=${encodeURIComponent(serviceIdsParam)}`
        : '';
      const baseServiceParam = baseServiceId
        ? `&baseServiceId=${encodeURIComponent(baseServiceId)}`
        : '';
      const addOnsParam = selectedAddOns.length > 0
        ? `&selectedAddOns=${encodeURIComponent(JSON.stringify(selectedAddOns))}`
        : '';
      const locationParam = locationId
        ? `&locationId=${encodeURIComponent(locationId)}`
        : '';
      const rescheduleParam = originalAppointmentId
        ? `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`
        : '';
      const response = await fetch(
        `/api/appointments/availability?date=${dateStr}&salonSlug=${salonSlug}${techParam}${durationParam}${serviceParam}${baseServiceParam}${addOnsParam}${locationParam}${rescheduleParam}`,
        { cache: 'no-store' },
      );

      if (response.ok) {
        const data = await response.json();
        if (availabilityRequestIdRef.current !== requestId) {
          return;
        }
        setAvailabilityError(null);
        setVisibleSlotTimes(data.visibleSlots || []);
        setBookedSlots(data.bookedSlots || []);
      } else {
        if (availabilityRequestIdRef.current !== requestId) {
          return;
        }
        const data = await response.json().catch(() => null);
        setAvailabilityError(data?.error?.message ?? 'Unable to load live availability for this technician.');
        setVisibleSlotTimes([]);
        setBookedSlots([]);
      }
    } catch (error) {
      if (availabilityRequestIdRef.current !== requestId) {
        return;
      }
      console.error('Failed to fetch availability:', error);
      setAvailabilityError('Unable to load live availability right now. Please try another date or refresh.');
      setVisibleSlotTimes([]);
      setBookedSlots([]);
    } finally {
      if (availabilityRequestIdRef.current === requestId) {
        setLoadingSlots(false);
      }
    }
  }, [baseServiceId, locationId, originalAppointmentId, totalDuration, salonSlug, selectedAddOns, serviceIdsParam, techId, stateTechId]);

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
    const todayMidnight = getTorontoToday();

    if (selectedDateMidnight.toDateString() !== todayMidnight.toDateString()) {
      return;
    }

    if (filterPastTimeSlots(visibleSlotTimes, selectedDate).length > 0) {
      return;
    }

    autoAdvancedTodayRef.current = true;
    const tomorrow = new Date(todayMidnight);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setSelectedDate(tomorrow);
    setCurrentMonth(tomorrow.getMonth());
    setCurrentYear(tomorrow.getFullYear());
  }, [availabilityError, loadingSlots, mounted, selectedDate, visibleSlotTimes]);

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
    const currentDateKey = selectedDate?.toISOString().split('T')[0] ?? null;
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
  const availableTimeSlots = toDisplaySlots(filterPastTimeSlots(visibleSlotTimes, selectedDate));
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

  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

  const handleTimeSelect = (time: string) => {
    if (!selectedDate || isSlotBooked(time)) {
      return;
    }

    // Gate on login when this is the first step
    if (isFirstStep && !isLoggedIn) {
      // Don't proceed - user needs to log in first via the bottom bar
      return;
    }

    const dateStr = selectedDate.toISOString().split('T')[0];
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
      time,
      locationId,
      originalAppointmentId,
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
            {dayNames.map((day, i) => (
              <div key={i} className="py-2 text-center text-xs font-bold text-neutral-400">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1 px-4 pb-4">
            {calendarDays.map((date, index) => {
              if (!date) {
                return <div key={`empty-${index}`} className="h-11" />;
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
            description="Choose another date to keep booking."
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
                        onClick={() => handleTimeSelect(slot.time)}
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
                            Booked
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
                        onClick={() => handleTimeSelect(slot.time)}
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
                            Booked
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
            Free cancellation up to 24 hours before
          </p>
        </div>

        {/* Spacer for floating dock when logged in */}
        {!isCheckingSession && isLoggedIn && isFirstStep && <div className="h-16" />}

        {/* Auth Footer - shown only on first step when not logged in */}
        {isFirstStep && !isCheckingSession && !isLoggedIn && (
          <BookingPhoneLogin
            onLoginSuccess={handleLoginSuccess}
          />
        )}
      </div>

      {/* Floating Dock - shown only when logged in and this is the first step */}
      {!isCheckingSession && isLoggedIn && isFirstStep && <BookingFloatingDock />}
    </div>
  );
}
