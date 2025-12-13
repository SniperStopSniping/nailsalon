'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ShakeWrapper } from '@/components/animated';
import { BookingFloatingDock } from '@/components/booking/BookingFloatingDock';
import { ANIMATION } from '@/libs/animations';
import { triggerHaptic } from '@/libs/haptics';
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

type BookTimeContentProps = {
  services: ServiceSummary[];
  technician: TechnicianSummary;
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
  const [isShaking, setIsShaking] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const timeSlots = generateTimeSlots();
  const calendarDays = generateCalendarDays(currentYear, currentMonth);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handlePrevMonth = useCallback(() => {
    triggerHaptic('select');
    setSlideDirection('left');
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  }, [currentMonth]);

  const handleNextMonth = useCallback(() => {
    triggerHaptic('select');
    setSlideDirection('right');
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  }, [currentMonth]);

  const isDateDisabled = useCallback((date: Date | null) => {
    if (!date) {
      return true;
    }
    return date < today;
  }, [today]);

  const handleDateSelect = useCallback((date: Date | null) => {
    if (!date) {
      return;
    }

    if (isDateDisabled(date)) {
      // Disabled date - trigger error haptic and shake
      triggerHaptic('error');
      setIsShaking(true);
      return;
    }

    // Valid date - trigger select haptic
    triggerHaptic('select');
    setSelectedDate(date);
  }, [isDateDisabled]);

  const handleTimeSelect = useCallback((time: string) => {
    triggerHaptic('select');
    setSelectedTime(time);
  }, []);

  const handleContinue = useCallback(() => {
    if (!selectedDate || !selectedTime) {
      // Missing selection - trigger error haptic and shake
      triggerHaptic('error');
      setIsShaking(true);
      return;
    }
    // Valid selection - trigger confirm haptic and navigate
    triggerHaptic('confirm');
    const dateStr = selectedDate.toISOString().split('T')[0] ?? '';
    const params = new URLSearchParams();
    params.set('serviceIds', serviceIds.join(','));
    params.set('techId', techId);
    params.set('date', dateStr);
    params.set('time', selectedTime);
    if (clientPhone) {
      params.set('clientPhone', clientPhone);
    }
    if (originalAppointmentId) {
      params.set('originalAppointmentId', originalAppointmentId);
    }
    router.push(`/book/confirm?${params.toString()}`);
  }, [selectedDate, selectedTime, serviceIds, techId, clientPhone, originalAppointmentId, router]);

  const serviceNames = services.map(s => s.name).join(' + ');
  const totalPrice = services.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = services.reduce((sum, s) => sum + s.duration, 0);

  const isReadyToContinue = selectedDate && selectedTime;

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
          <motion.button
            type="button"
            onClick={handleBack}
            aria-label="Go back"
            className="hover:bg-[var(--n5-bg-card)]/60 z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200"
            whileTap={{ scale: 0.95 }}
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
          <div
            className="font-heading absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight text-[var(--n5-accent)]"
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
          <h1 className="font-heading mb-1 text-2xl font-bold text-[var(--n5-ink-main)]">Pick a Date & Time</h1>
          <p className="font-body text-sm text-[var(--n5-ink-muted)]">
            {serviceNames}
            {' '}
            {technician ? `with ${technician.name}` : ''}
          </p>
        </div>

        {/* Calendar */}
        <ShakeWrapper isShaking={isShaking} onShakeComplete={() => setIsShaking(false)}>
          <div
            className="bg-[var(--n5-bg-card)]/80 mb-6 overflow-hidden border border-[var(--n5-border)] p-4 shadow-[var(--n5-shadow-md)] backdrop-blur-sm"
            style={{
              borderRadius: 'var(--n5-radius-card)',
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
            }}
          >
            {/* Month Navigation */}
            <div className="mb-4 flex items-center justify-between">
              <motion.button
                type="button"
                onClick={handlePrevMonth}
                className="flex size-10 items-center justify-center rounded-full hover:bg-[var(--n5-bg-surface)]"
                whileTap={{ scale: 0.95 }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.button>
              <AnimatePresence mode="wait">
                <motion.span
                  key={`${currentMonth}-${currentYear}`}
                  className="font-body text-base font-bold text-[var(--n5-ink-main)]"
                  initial={{ opacity: 0, x: slideDirection === 'right' ? 20 : -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: slideDirection === 'right' ? -20 : 20 }}
                  transition={{ duration: 0.2 }}
                >
                  {MONTHS[currentMonth]}
                  {' '}
                  {currentYear}
                </motion.span>
              </AnimatePresence>
              <motion.button
                type="button"
                onClick={handleNextMonth}
                className="flex size-10 items-center justify-center rounded-full hover:bg-[var(--n5-bg-surface)]"
                whileTap={{ scale: 0.95 }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.button>
            </div>

            {/* Weekday Headers */}
            <div className="mb-2 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((day, i) => (
                <div key={i} className="font-body text-center text-xs font-medium text-[var(--n5-ink-muted)]">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`${currentMonth}-${currentYear}`}
                className="grid grid-cols-7 gap-1"
                initial={{ opacity: 0, x: slideDirection === 'right' ? 30 : -30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: slideDirection === 'right' ? -30 : 30 }}
                transition={{ duration: 0.25 }}
              >
                {calendarDays.map((date, i) => {
                  const isDisabled = isDateDisabled(date);
                  const isSelected = selectedDate && date && date.toDateString() === selectedDate.toDateString();
                  const isToday = date && date.toDateString() === today.toDateString();

                  return (
                    <motion.button
                      key={i}
                      type="button"
                      onClick={() => handleDateSelect(date)}
                      disabled={!date}
                      className={`font-body flex aspect-square items-center justify-center text-sm font-medium ${
                        isDisabled && date ? 'cursor-not-allowed' : ''
                      }`}
                      style={{
                        borderRadius: 'var(--n5-radius-pill)',
                        fontWeight: isToday ? 700 : 500,
                        color: isSelected
                          ? 'var(--n5-button-primary-text)'
                          : isDisabled
                            ? 'var(--n5-border)'
                            : 'var(--n5-ink-main)',
                        backgroundColor: isSelected ? 'var(--n5-accent)' : 'transparent',
                      }}
                      whileTap={date && !isDisabled ? { scale: 0.9 } : undefined}
                      animate={isSelected
                        ? {
                            scale: [1, 1.1, 1],
                          }
                        : {}}
                      transition={{ duration: 0.2 }}
                    >
                      {date?.getDate()}
                    </motion.button>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        </ShakeWrapper>

        {/* Time Slots */}
        <AnimatePresence>
          {selectedDate && (
            <motion.div
              initial={{ opacity: 0, y: ANIMATION.slideY }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: ANIMATION.slideY }}
              transition={{ type: 'spring', ...ANIMATION.spring }}
              className="bg-[var(--n5-bg-card)]/80 mb-6 overflow-hidden border border-[var(--n5-border)] p-4 shadow-[var(--n5-shadow-md)] backdrop-blur-sm"
              style={{
                borderRadius: 'var(--n5-radius-card)',
              }}
            >
              <h3 className="font-body mb-3 text-base font-bold text-[var(--n5-ink-main)]">Available Times</h3>
              <div className="grid grid-cols-4 gap-2">
                {timeSlots.map((slot) => {
                  const isSelected = selectedTime === slot.time;
                  return (
                    <motion.button
                      key={slot.time}
                      type="button"
                      onClick={() => handleTimeSelect(slot.time)}
                      className="font-body border px-3 py-2.5 text-sm font-medium"
                      style={{
                        borderRadius: 'var(--n5-radius-md)',
                        borderColor: isSelected ? 'var(--n5-accent)' : 'var(--n5-border)',
                        backgroundColor: isSelected ? 'var(--n5-accent)' : 'var(--n5-bg-card)',
                        color: isSelected ? 'var(--n5-button-primary-text)' : 'var(--n5-ink-main)',
                      }}
                      whileTap={{ scale: 0.95 }}
                      animate={isSelected
                        ? {
                            scale: [1, 1.05, 1],
                          }
                        : {}}
                      transition={{ duration: 0.15 }}
                    >
                      {slot.time}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Summary */}
        {services.length > 0 && (
          <div
            className="bg-[var(--n5-bg-card)]/60 p-4"
            style={{
              borderRadius: 'var(--n5-radius-md)',
              opacity: mounted ? 1 : 0,
              transition: 'opacity 300ms ease-out 200ms',
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-body text-sm text-[var(--n5-ink-muted)]">Duration</span>
                <p className="font-body font-medium text-[var(--n5-ink-main)]">
                  {totalDuration}
                  {' '}
                  min
                </p>
              </div>
              <div className="text-right">
                <span className="font-body text-sm text-[var(--n5-ink-muted)]">Estimated Total</span>
                <p className="font-body text-lg font-bold text-[var(--n5-accent)]">
                  $
                  {totalPrice.toFixed(0)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fixed Bottom CTA */}
      <div className="bg-[var(--n5-bg-card)]/80 fixed inset-x-0 bottom-0 px-4 pb-8 pt-4 backdrop-blur-md">
        <div className="mx-auto max-w-[430px]">
          <motion.button
            type="button"
            onClick={handleContinue}
            disabled={!isReadyToContinue}
            className={`font-body w-full py-4 text-base font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isReadyToContinue ? 'text-[var(--n5-button-primary-text)] shadow-[var(--n5-shadow-sm)]' : 'bg-[var(--n5-border)] text-[var(--n5-ink-muted)]'
            }`}
            style={{
              borderRadius: 'var(--n5-radius-md)',
              background: isReadyToContinue
                ? `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover))`
                : undefined,
            }}
            whileTap={isReadyToContinue ? { scale: 0.98 } : undefined}
            // Spring animation when button becomes enabled
            animate={isReadyToContinue
              ? {
                  y: [4, 0],
                  opacity: [0.8, 1],
                }
              : {}}
            transition={{ type: 'spring', ...ANIMATION.spring }}
          >
            Continue to Confirm
          </motion.button>
        </div>
      </div>

      <BookingFloatingDock />
    </div>
  );
}
