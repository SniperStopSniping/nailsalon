'use client';

import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

const SERVICES: Record<string, { name: string; price: number; duration: number }> = {
  'biab-short': { name: 'BIAB Short', price: 65, duration: 75 },
  'biab-medium': { name: 'BIAB Medium', price: 75, duration: 90 },
  'gelx-extensions': { name: 'Gel-X Extensions', price: 90, duration: 105 },
  'biab-french': { name: 'BIAB French', price: 75, duration: 90 },
  'spa-pedi': { name: 'SPA Pedicure', price: 60, duration: 60 },
  'gel-pedi': { name: 'Gel Pedicure', price: 70, duration: 75 },
  'biab-gelx-combo': { name: 'BIAB + Gel-X Combo', price: 130, duration: 150 },
  'mani-pedi': { name: 'Classic Mani + Pedi', price: 95, duration: 120 },
};

const TECHNICIANS: Record<string, { name: string; image: string }> = {
  daniela: { name: 'Daniela', image: '/assets/images/tech-daniela.jpeg' },
  tiffany: { name: 'Tiffany', image: '/assets/images/tech-tiffany.jpeg' },
  jenny: { name: 'Jenny', image: '/assets/images/tech-jenny.jpeg' },
};

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

export default function ChangeAppointmentPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const serviceIdsParam = searchParams.get('serviceIds');
  const serviceIds = serviceIdsParam
    ? serviceIdsParam.split(',').filter(id => id.trim() !== '')
    : [];
  const techId = searchParams.get('techId') || '';
  const currentDate = searchParams.get('date') || '';
  const currentTime = searchParams.get('time') || '';

  const selectedServices = serviceIds
    .map(id => SERVICES[id.trim()])
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const totalDuration = selectedServices.reduce(
    (sum, service) => sum + service.duration,
    0,
  );
  const totalPrice = selectedServices.reduce(
    (sum, service) => sum + service.price,
    0,
  );
  const tech = TECHNICIANS[techId];
  const serviceNames
    = selectedServices.length > 0
      ? selectedServices.map(s => s.name).join(' + ')
      : 'Not selected';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const initialDate = currentDate ? new Date(currentDate) : today;
  initialDate.setHours(0, 0, 0, 0);

  const [mounted, setMounted] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(initialDate.getMonth());
  const [currentYear, setCurrentYear] = useState(initialDate.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date | null>(initialDate);
  const [selectedTime, setSelectedTime] = useState<string>(currentTime);

  useEffect(() => {
    setMounted(true);
  }, []);

  const timeSlots = generateTimeSlots();
  const calendarDays = generateCalendarDays(currentYear, currentMonth);

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
    const todayCheck = new Date();
    todayCheck.setHours(0, 0, 0, 0);
    if (date >= todayCheck) {
      setSelectedDate(date);
    }
  };

  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
  };

  const handleConfirm = () => {
    if (!selectedDate || !selectedTime) {
      return;
    }

    const dateStr = selectedDate.toISOString().split('T')[0];
    router.push(
      `/${locale}/book/confirm?serviceIds=${serviceIds.join(',')}&techId=${techId}&date=${dateStr}&time=${selectedTime}`,
    );
  };

  const handleChangeService = () => {
    router.push(`/${locale}/book/service`);
  };

  const handleBack = () => {
    router.back();
  };

  const formatSelectedDate = (date: Date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

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
              {tech && (
                <div className="relative size-14 shrink-0 overflow-hidden rounded-full border-2 border-white/30">
                  <Image src={tech.image} alt={tech.name} fill className="object-cover" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-xs text-white/70">Your appointment</div>
                <div className="truncate text-base font-bold text-white">{serviceNames}</div>
                <div className="text-sm font-medium" style={{ color: themeVars.primary }}>
                  with {tech?.name || 'Artist'} · {totalDuration} min
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

        {/* Time Selection */}
        {selectedDate && (
          <div
            className="space-y-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
            }}
          >
            {/* Morning Times */}
            <div
              className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
              style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: themeVars.cardBorder }}
            >
              <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
                <span className="text-xl">🌅</span>
                <span className="text-sm font-bold text-neutral-900">Morning</span>
                <span className="text-xs text-neutral-400">9:00 AM - 12:00 PM</span>
              </div>
              <div className="grid grid-cols-3 gap-2 p-4">
                {morningSlots.map((slot) => {
                  const isSelected = selectedTime === slot.time;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => handleTimeSelect(slot.time)}
                      className="rounded-xl px-2 py-3 text-sm font-bold transition-all duration-200 hover:scale-105 active:scale-95"
                      style={{
                        transform: isSelected ? 'scale(1.05)' : undefined,
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: isSelected ? themeVars.primaryDark : `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`,
                        background: isSelected
                          ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                          : `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`,
                        color: '#171717',
                        boxShadow: isSelected ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
                      }}
                    >
                      {formatTime12h(slot.time)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Afternoon Times */}
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
                  const isSelected = selectedTime === slot.time;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      onClick={() => handleTimeSelect(slot.time)}
                      className="rounded-xl px-2 py-3 text-sm font-bold transition-all duration-200 hover:scale-105 active:scale-95"
                      style={{
                        transform: isSelected ? 'scale(1.05)' : undefined,
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: isSelected ? themeVars.primaryDark : `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`,
                        background: isSelected
                          ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                          : `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})`,
                        color: '#171717',
                        boxShadow: isSelected ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
                      }}
                    >
                      {formatTime12h(slot.time)}
                    </button>
                  );
                })}
              </div>
            </div>
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
      </div>
    </div>
  );
}
