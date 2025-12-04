'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type Appointment = {
  id: string;
  date: string;
  service: string;
  tech: string;
  time: string;
  status: 'completed' | 'cancelled' | 'no-show';
  originalPrice: number;
  rewardDiscount?: number;
  finalPrice: number;
  imageUrl?: string;
};

const APPOINTMENT_HISTORY: Appointment[] = [
  {
    id: '1',
    date: 'Dec 18, 2025',
    service: 'BIAB Refill',
    tech: 'Tiffany',
    time: '2:00 PM',
    status: 'completed',
    originalPrice: 65,
    rewardDiscount: 5,
    finalPrice: 60,
    imageUrl: '/assets/images/biab-medium.webp',
  },
  {
    id: '2',
    date: 'Nov 15, 2025',
    service: 'BIAB French',
    tech: 'Daniela',
    time: '11:00 AM',
    status: 'completed',
    originalPrice: 75,
    rewardDiscount: 10,
    finalPrice: 65,
    imageUrl: '/assets/images/biab-french.jpg',
  },
  {
    id: '3',
    date: 'Oct 20, 2025',
    service: 'Gel-X Extensions',
    tech: 'Jenny',
    time: '3:30 PM',
    status: 'completed',
    originalPrice: 90,
    finalPrice: 90,
    imageUrl: '/assets/images/gel-x-extensions.jpg',
  },
  {
    id: '4',
    date: 'Sep 25, 2025',
    service: 'BIAB Medium',
    tech: 'Tiffany',
    time: '1:00 PM',
    status: 'cancelled',
    originalPrice: 75,
    finalPrice: 0,
  },
  {
    id: '5',
    date: 'Aug 30, 2025',
    service: 'Gel Manicure',
    tech: 'Daniela',
    time: '10:30 AM',
    status: 'completed',
    originalPrice: 45,
    finalPrice: 45,
    imageUrl: '/assets/images/biab-short.webp',
  },
  {
    id: '6',
    date: 'Jul 15, 2025',
    service: 'BIAB Short',
    tech: 'Jenny',
    time: '2:00 PM',
    status: 'completed',
    originalPrice: 65,
    rewardDiscount: 5,
    finalPrice: 60,
    imageUrl: '/assets/images/biab-medium.webp',
  },
];

export default function AppointmentHistoryPage() {
  const router = useRouter();
  const { salonName } = useSalon();
  const t = useTranslations('AppointmentHistory');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleBack = () => {
    router.back();
  };

  const getStatusStyles = (status: Appointment['status']) => {
    switch (status) {
      case 'completed':
        return 'text-emerald-700 bg-emerald-50 border border-emerald-200';
      case 'cancelled':
        return 'text-rose-600 bg-rose-50 border border-rose-200';
      case 'no-show':
        return 'text-amber-600 bg-amber-50 border border-amber-200';
      default:
        return 'text-neutral-600 bg-neutral-50 border border-neutral-200';
    }
  };

  const getStatusLabel = (status: Appointment['status']) => {
    switch (status) {
      case 'completed':
        return t('completed');
      case 'cancelled':
        return t('cancelled');
      case 'no-show':
        return t('no_show');
      default:
        return status;
    }
  };

  const completedAppointments = APPOINTMENT_HISTORY.filter(
    a => a.status === 'completed',
  );
  const totalSpent = completedAppointments.reduce(
    (sum, a) => sum + a.finalPrice,
    0,
  );
  const totalSaved = completedAppointments.reduce(
    (sum, a) => sum + (a.rewardDiscount || 0),
    0,
  );

  return (
    <div
      className="min-h-screen pb-10"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        {/* Top bar with back button */}
        <div
          className="relative flex items-center pb-2 pt-6"
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
            <svg
              width="22"
              height="22"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12.5 15L7.5 10L12.5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div
            className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Title section */}
        <div
          className="pb-6 pt-4 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition:
              'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ color: themeVars.titleText }}
          >
            {t('title')}
          </h1>
          <p className="mt-1 text-base italic text-neutral-500">
            {t('subtitle')}
          </p>
        </div>

        {/* Stats Summary Card */}
        <div
          className="mb-6 overflow-hidden rounded-2xl shadow-xl"
          style={{
            background: `linear-gradient(to bottom right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition:
              'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
          }}
        >
          <div className="px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold text-white">
                  {completedAppointments.length}
                </div>
                <div className="mt-0.5 text-sm text-white/70">Visits</div>
              </div>
              <div className="h-12 w-px bg-white/20" />
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold text-white">
                  ${totalSpent}
                </div>
                <div className="mt-0.5 text-sm text-white/70">Total Spent</div>
              </div>
              <div className="h-12 w-px bg-white/20" />
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold" style={{ color: themeVars.primary }}>
                  ${totalSaved}
                </div>
                <div className="mt-0.5 text-sm text-white/70">Saved</div>
              </div>
            </div>
          </div>
        </div>

        {/* Appointment History List */}
        <div className="space-y-4">
          {APPOINTMENT_HISTORY.map((appointment, index) => (
            <div
              key={appointment.id}
              className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
              style={{
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: themeVars.cardBorder,
                opacity: mounted ? 1 : 0,
                transform: mounted
                  ? 'translateY(0) scale(1)'
                  : 'translateY(15px) scale(0.98)',
                transition: `opacity 300ms ease-out ${200 + index * 60}ms, transform 300ms ease-out ${200 + index * 60}ms`,
              }}
            >
              {/* Status accent bar */}
              <div
                className={`h-1 ${
                  appointment.status === 'completed'
                    ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                    : appointment.status === 'cancelled'
                      ? 'bg-gradient-to-r from-rose-400 to-rose-500'
                      : 'bg-gradient-to-r from-amber-400 to-amber-500'
                }`}
              />

              <div className="p-5">
                {/* Header: Date, Time, Status */}
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <div className="text-xl font-bold tracking-tight text-neutral-900">
                      {appointment.date}
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-neutral-500">
                      {appointment.time}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${getStatusStyles(
                      appointment.status,
                    )}`}
                  >
                    {getStatusLabel(appointment.status)}
                  </span>
                </div>

                {/* Service & Tech with optional image */}
                <div className="mb-4 flex gap-4">
                  {appointment.imageUrl && appointment.status === 'completed' && (
                    <div className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-neutral-100 shadow-sm">
                      <Image
                        src={appointment.imageUrl}
                        alt={appointment.service}
                        fill
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-bold text-neutral-900">
                      {appointment.service}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-base text-neutral-600">
                      <span style={{ color: themeVars.accent }}>✦</span>
                      <span className="font-medium">
                        {t('tech')}:
                      </span>
                      <span>{appointment.tech}</span>
                    </div>
                  </div>
                </div>

                {/* Price breakdown for completed appointments */}
                {appointment.status === 'completed' && (
                  <div className="space-y-2.5 border-t border-neutral-100 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-medium text-neutral-500">
                        {t('price')}
                      </span>
                      <span className="text-base font-semibold text-neutral-700">
                        ${appointment.originalPrice}
                      </span>
                    </div>
                    {appointment.rewardDiscount && (
                      <div className="flex items-center justify-between">
                        <span className="text-base font-medium text-neutral-500">
                          {t('reward_applied')}
                        </span>
                        <span className="text-base font-bold text-emerald-600">
                          -${appointment.rewardDiscount}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-neutral-100 pt-2.5">
                      <span className="text-lg font-bold text-neutral-900">
                        {t('total_paid')}
                      </span>
                      <span className="text-xl font-bold" style={{ color: themeVars.accent }}>
                        ${appointment.finalPrice}
                      </span>
                    </div>
                  </div>
                )}

                {/* Cancelled message */}
                {appointment.status === 'cancelled' && (
                  <div className="border-t border-neutral-100 pt-4">
                    <div className="flex items-center gap-2 text-sm text-rose-500">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M15 9L9 15M9 9L15 15"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="font-medium">
                        {t('this_appointment_cancelled')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {APPOINTMENT_HISTORY.length === 0 && (
          <div
            className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: themeVars.cardBorder,
            }}
          >
            <div className="px-6 py-12 text-center">
              <div
                className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full"
                style={{ backgroundColor: themeVars.background }}
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ color: themeVars.accent }}
                >
                  <path
                    d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-lg font-semibold text-neutral-700">
                {t('no_history')}
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                Book your first appointment to start your nail journey
              </p>
            </div>
          </div>
        )}

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}
