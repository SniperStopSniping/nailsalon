'use client';

import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BookingFloatingDock } from '@/components/booking/BookingFloatingDock';
import { BookingPhoneLogin } from '@/components/booking/BookingPhoneLogin';
import { useBookingAuth } from '@/hooks/useBookingAuth';
import { useBookingState } from '@/hooks/useBookingState';
import { type BookingStep, getFirstStep, getNextStep, getPrevStep, getStepIndex, getStepLabel } from '@/libs/bookingFlow';
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
  imageUrl: string;
} | null;

type BookTimeClientProps = {
  services: ServiceSummary[];
  technician: TechnicianSummary;
  bookingFlow: BookingStep[];
};

const generateTimeSlots = () => {
  const slots: { time: string; period: 'morning' | 'afternoon' | 'evening' }[] = [];
  for (let hour = 9; hour < 18; hour++) {
    const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    slots.push({ time: `${hour}:00`, period });
    slots.push({ time: `${hour}:30`, period });
  }
  return slots;
};

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
  slots: { time: string; period: 'morning' | 'afternoon' | 'evening' }[],
  date: Date | null,
) => {
  if (!date) {
    return slots;
  }

  const torontoNow = getTorontoNow();
  const torontoToday = getTorontoToday();

  // Check if selected date is today in Toronto timezone
  const selectedDateMidnight = new Date(date);
  selectedDateMidnight.setHours(0, 0, 0, 0);
  const isToday = selectedDateMidnight.toDateString() === torontoToday.toDateString();

  if (!isToday) {
    return slots;
  }

  // Calculate minimum allowed booking time (now + 30 min buffer)
  const minimumBookingTime = new Date(torontoNow.getTime() + MIN_LEAD_TIME_MINUTES * 60 * 1000);

  // Filter out times that are past OR within the 30-minute buffer
  return slots.filter((slot) => {
    const [hours, minutes] = slot.time.split(':').map(Number);
    const slotTime = new Date(selectedDateMidnight);
    slotTime.setHours(hours || 0, minutes || 0, 0, 0);
    return slotTime >= minimumBookingTime;
  });
};

export function BookTimeClient({ services, technician, bookingFlow }: BookTimeClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const serviceIds = searchParams.get('serviceIds')?.split(',') || [];
  const techId = searchParams.get('techId') || '';
  const clientPhone = searchParams.get('clientPhone') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';

  // Check if this is the first step in the booking flow (for dock/login visibility)
  const isFirstStep = getFirstStep(bookingFlow) === 'time';

  // Use shared auth hook
  const { isLoggedIn, phone, isCheckingSession, handleLoginSuccess } = useBookingAuth(clientPhone || undefined);

  // Use global booking state - this is the single source of truth
  const { technicianId: stateTechId, syncFromUrl } = useBookingState();

  // Sync from URL params on mount (for deep links and reschedule flows)
  useEffect(() => {
    const urlTechId = searchParams.get('techId');
    if (urlTechId) {
      syncFromUrl({ techId: urlTechId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Use services passed from server
  const totalDuration = services.reduce((sum, service) => sum + service.duration, 0);
  const totalPrice = services.reduce((sum, service) => sum + service.price, 0);
  const serviceNames = services.map(s => s.name).join(' + ');

  // Use Toronto timezone for "today"
  const today = getTorontoToday();

  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Refs for smooth scrolling to time slot sections
  const morningSlotsRef = useRef<HTMLDivElement>(null);
  const afternoonSlotsRef = useRef<HTMLDivElement>(null);

  // Scroll state refs - pendingScroll triggers scroll when slots load
  const pendingScrollRef = useRef(false);
  const scrollRequestIdRef = useRef(0);
  const scrollTargetDateRef = useRef<string | null>(null); // Track which date the scroll is for
  const isMountedRef = useRef(true);

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

  const allTimeSlots = generateTimeSlots();

  // Fetch booked slots for selected date and technician
  const fetchBookedSlots = useCallback(async (date: Date) => {
    if (!salonSlug) {
      return;
    }

    setLoadingSlots(true);
    try {
      const dateStr = date.toISOString().split('T')[0];
      // Use stateTechId if available, otherwise fall back to URL techId
      const effectiveTechId = stateTechId || techId;
      const techParam = effectiveTechId && effectiveTechId !== 'any' ? `&technicianId=${effectiveTechId}` : '';
      const response = await fetch(
        `/api/appointments/availability?date=${dateStr}&salonSlug=${salonSlug}${techParam}`,
        { cache: 'no-store' },
      );

      if (response.ok) {
        const data = await response.json();
        setBookedSlots(data.bookedSlots || []);
      } else {
        setBookedSlots([]);
      }
    } catch (error) {
      console.error('Failed to fetch availability:', error);
      setBookedSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [salonSlug, techId, stateTechId]);

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
    const initializeDate = async () => {
      setMounted(true);

      const todayDate = getTorontoToday();

      // Check if today has any time slots left
      const todaySlots = filterPastTimeSlots(allTimeSlots, todayDate);

      if (todaySlots.length === 0) {
        // No slots available today, auto-advance to tomorrow
        const tomorrow = new Date(todayDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        setSelectedDate(tomorrow);

        // Update calendar view if tomorrow is in next month
        if (tomorrow.getMonth() !== currentMonth) {
          setCurrentMonth(tomorrow.getMonth());
          setCurrentYear(tomorrow.getFullYear());
        }
      }
    };

    initializeDate();
  }, []);

  // Fetch booked slots when selected date changes
  useEffect(() => {
    if (selectedDate && mounted) {
      fetchBookedSlots(selectedDate);
    }
  }, [selectedDate, mounted, fetchBookedSlots]);

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
  const availableTimeSlots = filterPastTimeSlots(allTimeSlots, selectedDate);
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

    if (dateAtMidnight >= todayAtMidnight) {
      // Cancel any previous scroll request
      scrollRequestIdRef.current += 1;

      // Set pending scroll flag and target date - useEffect handles scroll when slots load
      pendingScrollRef.current = true;
      scrollTargetDateRef.current = date.toISOString().split('T')[0] ?? null;

      // Update selected date (triggers fetch → loadingSlots → useEffect scroll)
      setSelectedDate(date);
    }
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

    // Use the phone from auth hook (may be updated after login)
    const phoneToUse = phone || clientPhone;
    // Use stateTechId if available, otherwise fall back to URL techId
    const effectiveTechId = stateTechId || techId || 'any';
    let url = `/${locale}/book/${nextStep}?serviceIds=${serviceIds.join(',')}&techId=${effectiveTechId}&date=${dateStr}&time=${time}&clientPhone=${encodeURIComponent(phoneToUse)}`;

    // Pass through originalAppointmentId for reschedule flow
    if (originalAppointmentId) {
      url += `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`;
    }

    router.push(url);
  };

  const handleBack = () => {
    const prevStep = getPrevStep('time', bookingFlow);
    if (prevStep) {
      // Use stateTechId if available, otherwise fall back to URL techId
      const effectiveTechId = stateTechId || techId;
      let url = `/${locale}/book/${prevStep}?serviceIds=${serviceIds.join(',')}&clientPhone=${encodeURIComponent(clientPhone)}`;
      if (effectiveTechId) {
        url += `&techId=${encodeURIComponent(effectiveTechId)}`;
      }
      if (originalAppointmentId) {
        url += `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`;
      }
      router.push(url);
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
        {/* Header */}
        <div
          className="relative flex items-center pb-4 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          {/* Back button - only show when NOT the first step */}
          {!isFirstStep && (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Go back"
              className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
            >
              <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          <div
            className={`text-lg font-semibold tracking-tight ${isFirstStep ? 'w-full text-center' : 'absolute left-1/2 -translate-x-1/2'}`}
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Progress Steps */}
        <div
          className="mb-6 flex items-center justify-center gap-2"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 50ms',
          }}
        >
          {bookingFlow.map((step, i) => {
            const currentIdx = getStepIndex('time', bookingFlow);
            const isCurrentStep = step === 'time';
            const isPastStep = i + 1 < currentIdx;
            return (
              <div key={step} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 ${isCurrentStep ? 'opacity-100' : 'opacity-40'}`}>
                  <div
                    className="flex size-6 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      backgroundColor: isPastStep ? themeVars.accent : isCurrentStep ? themeVars.primary : '#d4d4d4',
                      color: isPastStep ? 'white' : isCurrentStep ? '#171717' : '#525252',
                    }}
                  >
                    {isPastStep ? '✓' : i + 1}
                  </div>
                  <span className={`text-xs font-medium ${isCurrentStep ? 'text-neutral-900' : 'text-neutral-500'}`}>
                    {getStepLabel(step)}
                  </span>
                </div>
                {i < bookingFlow.length - 1 && <div className="h-px w-4 bg-neutral-300" />}
              </div>
            );
          })}
        </div>

        {/* Booking Summary Card - Only show technician if one is selected */}
        <div
          className="mb-6 overflow-hidden rounded-2xl shadow-xl"
          style={{
            background: `linear-gradient(to bottom right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <div className="px-5 py-4">
            <div className="flex items-center gap-4">
              {technician && (
                <div className="relative size-14 shrink-0 overflow-hidden rounded-full border-2 border-white/30">
                  <Image src={technician.imageUrl} alt={technician.name} fill className="object-cover" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-xs text-white/70">Your appointment</div>
                <div className="truncate text-base font-bold text-white">{serviceNames || 'Service'}</div>
                {/* Only show technician info if a technician is actually selected */}
                {technician && (
                  <div className="text-sm font-medium" style={{ color: themeVars.primary }}>
                    with
                    {' '}
                    {technician.name}
                    {' '}
                    ·
                    {' '}
                    {totalDuration}
                    {' '}
                    min
                  </div>
                )}
                {!technician && (
                  <div className="text-sm font-medium" style={{ color: themeVars.primary }}>
                    {totalDuration}
                    {' '}
                    min
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">
                  $
                  {totalPrice}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Title */}
        <div
          className="mb-4 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
          }}
        >
          <h1 className="text-2xl font-bold text-neutral-900">
            Pick Your Time
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {selectedDate
              ? `${formatSelectedDate(selectedDate)} · Tap another date to change`
              : 'Select a day that works for you'}
          </p>
        </div>

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
                  onClick={() => handleDateSelect(date)}
                  disabled={isPast}
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
        {(noSlotsAvailable || allSlotsBooked) && (
          <div
            className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center"
            style={{
              opacity: mounted ? 1 : 0,
              transition: 'opacity 300ms ease-out 250ms',
            }}
          >
            <div className="mb-2 text-2xl">⏰</div>
            <p className="text-sm font-medium text-amber-800">
              {noSlotsAvailable
                ? 'No more time slots available today.'
                : 'All time slots are booked for this day.'}
            </p>
            <p className="mt-1 text-xs text-amber-600">
              Please select another date from the calendar above.
            </p>
          </div>
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
              <div className="py-4 text-center">
                <div className="inline-block size-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
                <p className="mt-2 text-sm text-neutral-500">Checking availability...</p>
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
                  <span className="text-xs text-neutral-400">9:00 AM - 12:00 PM</span>
                </div>
                <div className="grid grid-cols-3 gap-2 p-4">
                  {morningSlots.map((slot, i) => {
                    const booked = isSlotBooked(slot.time);
                    return (
                      <button
                        key={slot.time}
                        type="button"
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
                  <span className="text-xs text-neutral-400">12:00 PM - 6:00 PM</span>
                </div>
                <div className="grid grid-cols-3 gap-2 p-4">
                  {afternoonSlots.map((slot, i) => {
                    const booked = isSlotBooked(slot.time);
                    return (
                      <button
                        key={slot.time}
                        type="button"
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
            initialPhone={clientPhone || undefined}
            onLoginSuccess={handleLoginSuccess}
          />
        )}
      </div>

      {/* Floating Dock - shown only when logged in and this is the first step */}
      {!isCheckingSession && isLoggedIn && isFirstStep && <BookingFloatingDock />}
    </div>
  );
}
