'use client';

import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

// =============================================================================
// TYPES
// =============================================================================

interface ServiceData {
  id: string;
  name: string;
  price: number; // in dollars
  duration: number;
}

interface TechnicianData {
  id: string;
  name: string;
  imageUrl: string;
}

interface ChangeAppointmentClientProps {
  services: ServiceData[];
  technician: TechnicianData | null;
  dateStr: string;
  timeStr: string;
  clientPhone: string;
  originalAppointmentId?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

const generateTimeSlots = () => {
  const slots: { time: string; period: 'morning' | 'afternoon' }[] = [];
  for (let hour = 9; hour < 18; hour++) {
    const period = hour < 12 ? 'morning' : 'afternoon';
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

const formatSelectedDate = (date: Date) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
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
  slots: { time: string; period: 'morning' | 'afternoon' }[],
  date: Date | null,
) => {
  if (!date) return slots;

  const torontoNow = getTorontoNow();
  const torontoToday = getTorontoToday();

  // Check if selected date is today in Toronto timezone
  const selectedDateMidnight = new Date(date);
  selectedDateMidnight.setHours(0, 0, 0, 0);
  const isToday = selectedDateMidnight.toDateString() === torontoToday.toDateString();

  if (!isToday) return slots;

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

// =============================================================================
// COMPONENT
// =============================================================================

export function ChangeAppointmentClient({
  services,
  technician,
  dateStr,
  timeStr,
  clientPhone,
  originalAppointmentId,
}: ChangeAppointmentClientProps) {
  const router = useRouter();
  const params = useParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';

  // Calculate totals from services passed by server
  const totalDuration = services.reduce((sum, s) => sum + s.duration, 0);
  const totalPrice = services.reduce((sum, s) => sum + s.price, 0);
  const serviceNames = services.length > 0
    ? services.map(s => s.name).join(' + ')
    : 'Not selected';
  const serviceIds = services.map(s => s.id);
  const techId = technician?.id || 'any';

  // Use Toronto timezone for "today"
  const today = getTorontoToday();

  // Determine initial date - if dateStr is today and all slots are past, use tomorrow
  const getInitialDate = () => {
    // Parse date string as local date (not UTC) to avoid timezone issues
    let parsedDate: Date;
    if (dateStr) {
      const [year, month, day] = dateStr.split('-').map(Number);
      parsedDate = new Date(year!, month! - 1, day!);
    } else {
      parsedDate = getTorontoToday();
    }
    parsedDate.setHours(0, 0, 0, 0);

    const todayDate = getTorontoToday();

    // If the parsed date is today, check if there are any slots left
    if (parsedDate.toDateString() === todayDate.toDateString()) {
      const allSlots = generateTimeSlots();
      const availableSlots = filterPastTimeSlots(allSlots, parsedDate);

      if (availableSlots.length === 0) {
        // No slots left today, use tomorrow
        const tomorrow = new Date(todayDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
      }
    }

    return parsedDate;
  };

  const initialDate = getInitialDate();

  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(initialDate);
  const [selectedTime, setSelectedTime] = useState<string>(timeStr);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Cancel appointment state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Ref for smooth scrolling to morning time slots
  const morningSlotsRef = useRef<HTMLDivElement>(null);
  // Ref to track if we should scroll after loading completes
  const pendingScrollRef = useRef(false);

  // Custom smooth scroll with adjustable duration
  const smoothScrollTo = useCallback((targetY: number, duration: number): Promise<void> => {
    return new Promise((resolve) => {
      const startY = window.scrollY;
      const difference = targetY - startY;
      const startTime = performance.now();

      const easeInOutCubic = (t: number): number => {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
    if (!salonSlug) return;

    setLoadingSlots(true);
    try {
      const dateStr = date.toISOString().split('T')[0];
      const techParam = techId && techId !== 'any' ? `&technicianId=${techId}` : '';
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
  }, [salonSlug, techId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch booked slots when selected date changes
  useEffect(() => {
    if (selectedDate && mounted) {
      fetchBookedSlots(selectedDate);
    }
  }, [selectedDate, mounted, fetchBookedSlots]);

  // Smooth scroll to time slots after loading completes
  useEffect(() => {
    if (!pendingScrollRef.current || loadingSlots) {
      return;
    }
    
    pendingScrollRef.current = false;
    
    // Small delay to ensure DOM is rendered after loading state change
    const timer = setTimeout(async () => {
      if (!morningSlotsRef.current) return;
      
      // Calculate position to show morning card at bottom of viewport
      const rect = morningSlotsRef.current.getBoundingClientRect();
      const targetY = window.scrollY + rect.bottom - window.innerHeight;
      
      // First scroll - slow and smooth to morning card (800ms)
      await smoothScrollTo(Math.max(0, targetY), 800);
      
      // Pause for 150ms
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Second scroll - continue to bottom (1200ms)
      const bottomY = document.documentElement.scrollHeight - window.innerHeight;
      await smoothScrollTo(bottomY, 1200);
    }, 100);
    
    return () => clearTimeout(timer);
  }, [loadingSlots, smoothScrollTo]);

  const calendarDays = generateCalendarDays(currentYear, currentMonth);

  // Filter time slots for display
  const availableTimeSlots = filterPastTimeSlots(allTimeSlots, selectedDate);
  const morningSlots = availableTimeSlots.filter(s => s.period === 'morning');
  const afternoonSlots = availableTimeSlots.filter(s => s.period === 'afternoon');

  // Check if a slot is booked
  const isSlotBooked = (time: string) => bookedSlots.includes(time);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
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
    const todayCheck = getTorontoToday();
    if (date >= todayCheck) {
      setSelectedDate(date);
      // Clear selected time when date changes (user needs to re-select)
      setSelectedTime('');
      // Mark that we want to scroll after loading completes
      pendingScrollRef.current = true;
    }
  };

  const handleTimeSelect = (time: string) => {
    if (!isSlotBooked(time)) {
      setSelectedTime(time);
    }
  };

  const handleConfirm = () => {
    if (!selectedDate || !selectedTime) {
      return;
    }

    const newDateStr = selectedDate.toISOString().split('T')[0];
    
    // Use technician ID or 'any' for the URL (not empty string)
    const techIdForUrl = technician?.id || 'any';
    
    let confirmUrl = `/${locale}/book/confirm?serviceIds=${serviceIds.join(',')}&techId=${techIdForUrl}&date=${newDateStr}&time=${selectedTime}&clientPhone=${encodeURIComponent(clientPhone)}`;

    // If this is a reschedule, include the original appointment ID
    if (originalAppointmentId) {
      confirmUrl += `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`;
    }
    
    // Debug: log the URL being navigated to
    console.log('[Change Appointment] Navigating to:', confirmUrl);
    console.log('[Change Appointment] originalAppointmentId:', originalAppointmentId);

    router.push(confirmUrl);
  };

  const handleChangeService = () => {
    // Pass originalAppointmentId and clientPhone so the reschedule flow continues
    let url = `/${locale}/book/service?clientPhone=${encodeURIComponent(clientPhone)}`;
    if (originalAppointmentId) {
      url += `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`;
    }
    router.push(url);
  };

  const handleBack = () => {
    router.back();
  };

  // Check if appointment is within 24 hours (for cancellation fee)
  const isWithin24Hours = () => {
    if (!dateStr || !timeStr) return false;

    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    const appointmentTime = new Date(year!, month! - 1, day!, hour!, minute!);

    const now = new Date();
    const hoursUntilAppointment = (appointmentTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    return hoursUntilAppointment < 24;
  };

  const handleCancelAppointment = async () => {
    if (!originalAppointmentId) {
      setCancelError('No appointment to cancel');
      return;
    }

    setIsCancelling(true);
    setCancelError(null);

    try {
      const response = await fetch(`/api/appointments/${originalAppointmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'cancelled',
          cancelReason: 'client_request',
        }),
      });

      if (response.ok) {
        setShowCancelModal(false);
        // Navigate to profile with success message
        router.push(`/${locale}/profile?cancelled=true`);
      } else {
        const data = await response.json();
        setCancelError(data.error?.message || 'Failed to cancel appointment');
      }
    } catch {
      setCancelError('An error occurred. Please try again.');
    } finally {
      setIsCancelling(false);
    }
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
          className="relative flex items-center pb-2 pt-5"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
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

          <div
            className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Appointment Summary Card */}
        <div
          className="mb-5 overflow-hidden rounded-2xl shadow-xl"
          style={{
            background: `linear-gradient(to bottom right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: 'opacity 300ms ease-out 50ms, transform 300ms ease-out 50ms',
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
                <div className="truncate text-base font-bold text-white">{serviceNames}</div>
                <div className="text-sm font-medium" style={{ color: themeVars.primary }}>
                  with {technician?.name || 'Any Artist'} · {totalDuration} min
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">${totalPrice}</div>
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
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <h1 className="text-2xl font-bold text-neutral-900">
            Change Your Appointment
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {selectedDate && selectedTime
              ? `${formatSelectedDate(selectedDate)} at ${formatTime12h(selectedTime)}`
              : selectedDate
                ? `${formatSelectedDate(selectedDate)} · Select a time`
                : 'Select a new date and time'}
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
            transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
          }}
        >
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
              {monthNames[currentMonth]} {currentYear}
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

          <div className="grid grid-cols-7 px-4 pt-3">
            {dayNames.map((day, i) => (
              <div key={i} className="py-2 text-center text-xs font-bold text-neutral-400">
                {day}
              </div>
            ))}
          </div>

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
              transition: 'opacity 300ms ease-out 200ms',
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

        {/* Time Selection */}
        {selectedDate && !noSlotsAvailable && !allSlotsBooked && (
          <div
            className="space-y-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
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
                style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: themeVars.cardBorder }}
              >
                <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
                  <span className="text-xl">🌅</span>
                  <span className="text-sm font-bold text-neutral-900">Morning</span>
                  <span className="text-xs text-neutral-400">9:00 AM - 12:00 PM</span>
                </div>
                <div className="grid grid-cols-3 gap-2 p-4">
                  {morningSlots.map((slot) => {
                    const isSlotSelected = selectedTime === slot.time;
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
                            : 'hover:scale-105 active:scale-95'
                        }`}
                        style={{
                          transform: isSlotSelected && !booked ? 'scale(1.05)' : undefined,
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: booked
                            ? '#e5e5e5'
                            : isSlotSelected
                              ? themeVars.primaryDark
                              : `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`,
                          background: booked
                            ? '#f5f5f5'
                            : isSlotSelected
                              ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                              : `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`,
                          color: '#171717',
                          boxShadow: isSlotSelected && !booked ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
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
                className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: themeVars.cardBorder }}
              >
                <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
                  <span className="text-xl">☀️</span>
                  <span className="text-sm font-bold text-neutral-900">Afternoon</span>
                  <span className="text-xs text-neutral-400">12:00 PM - 6:00 PM</span>
                </div>
                <div className="grid grid-cols-3 gap-2 p-4">
                  {afternoonSlots.map((slot) => {
                    const isSlotSelected = selectedTime === slot.time;
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
                            : 'hover:scale-105 active:scale-95'
                        }`}
                        style={{
                          transform: isSlotSelected && !booked ? 'scale(1.05)' : undefined,
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: booked
                            ? '#e5e5e5'
                            : isSlotSelected
                              ? themeVars.primaryDark
                              : `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`,
                          background: booked
                            ? '#f5f5f5'
                            : isSlotSelected
                              ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                              : `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`,
                          color: '#171717',
                          boxShadow: isSlotSelected && !booked ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
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

        {/* Action Buttons */}
        <div
          className="mt-6 space-y-3"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 300ms',
          }}
        >
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedDate || !selectedTime}
            className="w-full rounded-xl py-4 text-base font-bold transition-all duration-200"
            style={{
              background: selectedDate && selectedTime
                ? `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`
                : '#e5e5e5',
              color: selectedDate && selectedTime ? '#171717' : '#a3a3a3',
              boxShadow: selectedDate && selectedTime ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
              cursor: !selectedDate || !selectedTime ? 'not-allowed' : 'pointer',
            }}
          >
            {selectedDate && selectedTime ? 'Confirm Changes' : 'Select date & time'}
          </button>

          <button
            type="button"
            onClick={handleChangeService}
            className="w-full rounded-xl border-2 py-3 text-base font-semibold transition-all duration-200 active:scale-[0.98]"
            style={{
              borderColor: themeVars.accent,
              color: themeVars.accent,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = `color-mix(in srgb, ${themeVars.accent} 5%, transparent)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '';
            }}
          >
            Change Service or Tech
          </button>
        </div>

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

        {/* Cancel Appointment Link */}
        {originalAppointmentId && (
          <div
            className="mt-8 text-center"
            style={{
              opacity: mounted ? 1 : 0,
              transition: 'opacity 300ms ease-out 500ms',
            }}
          >
            <button
              type="button"
              onClick={() => setShowCancelModal(true)}
              className="text-sm font-medium text-red-500 underline underline-offset-2 transition-colors hover:text-red-600"
            >
              Cancel Appointment
            </button>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            style={{
              animation: 'fadeIn 200ms ease-out',
            }}
          >
            <div className="mb-4 text-center text-4xl">⚠️</div>
            <h3 className="mb-2 text-center text-lg font-bold text-neutral-900">
              Cancel Appointment?
            </h3>
            <p className="mb-4 text-center text-sm text-neutral-500">
              Are you sure you want to cancel your appointment?
            </p>

            {isWithin24Hours() && (
              <div
                className="mb-4 rounded-lg p-3 text-center"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
              >
                <p className="text-sm font-semibold text-red-600">
                  ⚠️ Cancellation Fee: $25
                </p>
                <p className="mt-1 text-xs text-red-500">
                  Less than 24 hours notice
                </p>
              </div>
            )}

            {cancelError && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-center">
                <p className="text-sm text-red-600">{cancelError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowCancelModal(false);
                  setCancelError(null);
                }}
                disabled={isCancelling}
                className="flex-1 rounded-xl border-2 border-neutral-200 py-3 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
              >
                Keep It
              </button>
              <button
                type="button"
                onClick={handleCancelAppointment}
                disabled={isCancelling}
                className="flex-1 rounded-xl bg-red-500 py-3 font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {isCancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChangeAppointmentClient;
