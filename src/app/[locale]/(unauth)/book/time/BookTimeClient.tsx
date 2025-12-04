'use client';

import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

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

interface BookTimeClientProps {
  services: ServiceSummary[];
  technician: TechnicianSummary;
}

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

export function BookTimeClient({ services, technician }: BookTimeClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const serviceIds = searchParams.get('serviceIds')?.split(',') || [];
  const techId = searchParams.get('techId') || '';
  const clientPhone = searchParams.get('clientPhone') || '';

  // Use services passed from server
  const totalDuration = services.reduce((sum, service) => sum + service.duration, 0);
  const totalPrice = services.reduce((sum, service) => sum + service.price, 0);
  const serviceNames = services.map(s => s.name).join(' + ');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(today);

  useEffect(() => {
    setMounted(true);
  }, []);

  const timeSlots = generateTimeSlots();
  const calendarDays = generateCalendarDays(currentYear, currentMonth);

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
    if (date >= today) {
      setSelectedDate(date);
    }
  };

  const handleTimeSelect = (time: string) => {
    if (!selectedDate) {
      return;
    }
    const dateStr = selectedDate.toISOString().split('T')[0];
    router.push(
      `/${locale}/book/confirm?serviceIds=${serviceIds.join(',')}&techId=${techId}&date=${dateStr}&time=${time}&clientPhone=${encodeURIComponent(clientPhone)}`,
    );
  };

  const handleBack = () => {
    router.back();
  };

  const formatSelectedDate = (date: Date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  // Group times by period
  const morningSlots = timeSlots.filter(s => s.period === 'morning');
  const afternoonSlots = timeSlots.filter(s => s.period === 'afternoon');

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

        {/* Progress Steps */}
        <div
          className="mb-6 flex items-center justify-center gap-2"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 50ms',
          }}
        >
          {['Service', 'Artist', 'Time', 'Confirm'].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 ${i === 2 ? 'opacity-100' : 'opacity-40'}`}>
                <div
                  className="flex size-6 items-center justify-center rounded-full text-xs font-bold"
                  style={{
                    backgroundColor: i < 2 ? themeVars.accent : i === 2 ? themeVars.primary : '#d4d4d4',
                    color: i < 2 ? 'white' : i === 2 ? '#171717' : '#525252',
                  }}
                >
                  {i < 2 ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium ${i === 2 ? 'text-neutral-900' : 'text-neutral-500'}`}>
                  {step}
                </span>
              </div>
              {i < 3 && <div className="h-px w-4 bg-neutral-300" />}
            </div>
          ))}
        </div>

        {/* Booking Summary Card */}
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
                <div className="text-sm font-medium" style={{ color: themeVars.primary }}>
                  with
                  {' '}
                  {technician?.name || 'Any Artist'}
                  {' '}
                  ·
                  {' '}
                  {totalDuration}
                  {' '}
                  min
                </div>
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

        {/* Time Selection - Only shows when date is selected */}
        {selectedDate && (
          <div
            className="space-y-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 250ms, transform 300ms ease-out 250ms',
            }}
          >
            {/* Morning Times */}
            <div
              className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
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
                {morningSlots.map((slot, i) => (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => handleTimeSelect(slot.time)}
                    className="rounded-xl px-2 py-3 text-sm font-bold text-neutral-800 transition-all duration-200 hover:scale-105 hover:text-neutral-900 hover:shadow-md active:scale-95"
                    style={{
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`,
                      background: `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`,
                      animationDelay: `${i * 30}ms`,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`;
                    }}
                  >
                    {formatTime12h(slot.time)}
                  </button>
                ))}
              </div>
            </div>

            {/* Afternoon Times */}
            <div
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
                {afternoonSlots.map((slot, i) => (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => handleTimeSelect(slot.time)}
                    className="rounded-xl px-2 py-3 text-sm font-bold text-neutral-800 transition-all duration-200 hover:scale-105 hover:text-neutral-900 hover:shadow-md active:scale-95"
                    style={{
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`,
                      background: `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`,
                      animationDelay: `${(i + morningSlots.length) * 30}ms`,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`;
                    }}
                  >
                    {formatTime12h(slot.time)}
                  </button>
                ))}
              </div>
            </div>
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
      </div>
    </div>
  );
}

