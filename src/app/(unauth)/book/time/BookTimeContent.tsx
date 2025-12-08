'use client';

import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

export type ServiceSummary = {
  id: string;
  name: string;
  price: number;
  duration: number;
};

export type TechnicianSummary = {
  id: string;
  name: string;
  imageUrl: string;
} | null;

interface BookTimeContentProps {
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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function BookTimeContent({ services, technician }: BookTimeContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { salonName } = useSalon();
  const serviceIds = searchParams.get('serviceIds')?.split(',') || [];
  const techId = searchParams.get('techId') || '';
  const clientPhone = searchParams.get('clientPhone') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';

  const [mounted, setMounted] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const timeSlots = generateTimeSlots();
  const calendarDays = generateCalendarDays(currentYear, currentMonth);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleBack = () => {
    router.back();
  };

  const handlePrevMonth = useCallback(() => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  }, [currentMonth]);

  const handleNextMonth = useCallback(() => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  }, [currentMonth]);

  const isDateDisabled = (date: Date | null) => {
    if (!date) return true;
    return date < today;
  };

  const handleContinue = () => {
    if (!selectedDate || !selectedTime) return;
    const dateStr = selectedDate.toISOString().split('T')[0];
    const params = new URLSearchParams();
    params.set('serviceIds', serviceIds.join(','));
    params.set('techId', techId);
    params.set('date', dateStr);
    params.set('time', selectedTime);
    if (clientPhone) params.set('clientPhone', clientPhone);
    if (originalAppointmentId) params.set('originalAppointmentId', originalAppointmentId);
    router.push(`/book/confirm?${params.toString()}`);
  };

  const serviceNames = services.map(s => s.name).join(' + ');
  const totalPrice = services.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = services.reduce((sum, s) => sum + s.duration, 0);

  return (
    <div
      className="min-h-screen pb-32"
      style={{
        background: `linear-gradient(to bottom, var(--n5-bg-page), color-mix(in srgb, var(--n5-bg-page) 95%, var(--n5-accent-hover)))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
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
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-[var(--n5-bg-card)]/60 active:scale-95"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div
            className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight font-heading text-[var(--n5-accent)]"
          >
            {salonName}
          </div>
        </div>

        {/* Title */}
        <div
          className="mb-6 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 50ms, transform 300ms ease-out 50ms',
          }}
        >
          <h1 className="mb-1 text-2xl font-bold font-heading text-[var(--n5-ink-main)]">Pick a Date & Time</h1>
          <p className="text-sm font-body text-[var(--n5-ink-muted)]">
            {serviceNames} {technician ? `with ${technician.name}` : ''}
          </p>
        </div>

        {/* Calendar */}
        <div
          className="mb-6 overflow-hidden p-4 shadow-[var(--n5-shadow-md)] backdrop-blur-sm bg-[var(--n5-bg-card)]/80 border border-[var(--n5-border)]"
          style={{
            borderRadius: 'var(--n5-radius-card)',
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          {/* Month Navigation */}
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="flex size-10 items-center justify-center rounded-full hover:bg-[var(--n5-bg-surface)]"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="text-base font-bold font-body text-[var(--n5-ink-main)]">
              {MONTHS[currentMonth]} {currentYear}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="flex size-10 items-center justify-center rounded-full hover:bg-[var(--n5-bg-surface)]"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="mb-2 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day, i) => (
              <div key={i} className="text-center text-xs font-medium font-body text-[var(--n5-ink-muted)]">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((date, i) => {
              const isDisabled = isDateDisabled(date);
              const isSelected = selectedDate && date && date.toDateString() === selectedDate.toDateString();
              const isToday = date && date.toDateString() === today.toDateString();

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => date && !isDisabled && setSelectedDate(date)}
                  disabled={isDisabled}
                  className={`flex aspect-square items-center justify-center text-sm font-medium font-body transition-all ${
                    isSelected ? 'bg-[var(--n5-accent)] text-[var(--n5-button-primary-text)]' : isDisabled ? 'text-[var(--n5-border)]' : 'text-[var(--n5-ink-main)]'
                  }`}
                  style={{
                    borderRadius: 'var(--n5-radius-pill)',
                    fontWeight: isToday ? 700 : 500,
                  }}
                >
                  {date?.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time Slots */}
        {selectedDate && (
          <div
            className="mb-6 overflow-hidden p-4 shadow-[var(--n5-shadow-md)] backdrop-blur-sm bg-[var(--n5-bg-card)]/80 border border-[var(--n5-border)]"
            style={{
              borderRadius: 'var(--n5-radius-card)',
            }}
          >
            <h3 className="mb-3 text-base font-bold font-body text-[var(--n5-ink-main)]">Available Times</h3>
            <div className="grid grid-cols-4 gap-2">
              {timeSlots.map((slot) => {
                const isSelected = selectedTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => setSelectedTime(slot.time)}
                    className={`px-3 py-2.5 text-sm font-medium font-body transition-all border ${
                      isSelected ? 'bg-[var(--n5-accent)] text-[var(--n5-button-primary-text)] border-[var(--n5-accent)]' : 'bg-[var(--n5-bg-card)] text-[var(--n5-ink-main)] border-[var(--n5-border)]'
                    }`}
                    style={{
                      borderRadius: 'var(--n5-radius-md)',
                    }}
                  >
                    {slot.time}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary */}
        {services.length > 0 && (
          <div
            className="p-4 bg-[var(--n5-bg-card)]/60"
            style={{
              borderRadius: 'var(--n5-radius-md)',
              opacity: mounted ? 1 : 0,
              transition: 'opacity 300ms ease-out 200ms',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-body text-[var(--n5-ink-muted)]">Duration</span>
                <p className="font-medium font-body text-[var(--n5-ink-main)]">{totalDuration} min</p>
              </div>
              <div className="text-right">
                <span className="text-sm font-body text-[var(--n5-ink-muted)]">Estimated Total</span>
                <p className="text-lg font-bold font-body text-[var(--n5-accent)]">
                  ${totalPrice.toFixed(0)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fixed Bottom CTA */}
      <div className="fixed inset-x-0 bottom-0 bg-[var(--n5-bg-card)]/80 px-4 pb-8 pt-4 backdrop-blur-md">
        <div className="mx-auto max-w-[430px]">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!selectedDate || !selectedTime}
            className={`w-full py-4 text-base font-bold font-body transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
              selectedDate && selectedTime ? 'text-[var(--n5-button-primary-text)] shadow-[var(--n5-shadow-sm)]' : 'bg-[var(--n5-border)] text-[var(--n5-ink-muted)]'
            }`}
            style={{
              borderRadius: 'var(--n5-radius-md)',
              background: selectedDate && selectedTime
                ? `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover))`
                : undefined,
            }}
          >
            Continue to Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
