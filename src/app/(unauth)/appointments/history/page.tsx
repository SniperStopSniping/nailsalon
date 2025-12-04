'use client';

import { useRouter } from 'next/navigation';

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
  },
];

export default function AppointmentHistoryPage() {
  const router = useRouter();
  const { salonName } = useSalon();

  const handleBack = () => {
    router.back();
  };

  const getStatusColor = (status: Appointment['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 bg-green-50';
      case 'cancelled':
        return 'text-red-600 bg-red-50';
      case 'no-show':
        return 'text-orange-600 bg-orange-50';
      default:
        return 'text-neutral-600 bg-neutral-50';
    }
  };

  const getStatusLabel = (status: Appointment['status']) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'cancelled':
        return 'Cancelled';
      case 'no-show':
        return 'No Show';
      default:
        return status;
    }
  };

  return (
    <div
      className="flex min-h-screen justify-center py-4"
      style={{ backgroundColor: themeVars.background }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4">
        {/* Top bar with back button */}
        <div className="relative flex items-center pt-2">
          <button
            type="button"
            onClick={handleBack}
            className="z-10 flex size-10 items-center justify-center rounded-full transition-all duration-150 hover:bg-white/50 active:scale-95"
          >
            <svg
              width="20"
              height="20"
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

          {/* Salon name - centered */}
          <div
            className="absolute left-1/2 -translate-x-1/2 text-xl font-semibold"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Title section */}
        <div className="pt-2 text-center">
          <h1 className="text-2xl font-bold text-neutral-900">
            Appointment History
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Your past visits
          </p>
        </div>

        {/* Appointment History List */}
        <div className="space-y-3">
          {APPOINTMENT_HISTORY.map(appointment => (
            <div
              key={appointment.id}
              className="space-y-3 rounded-xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
            >
              {/* Header: Date and Status */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-neutral-900">
                    {appointment.date}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-600">
                    {appointment.time}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusColor(
                    appointment.status,
                  )}`}
                >
                  {getStatusLabel(appointment.status)}
                </span>
              </div>

              {/* Service and Tech */}
              <div className="space-y-1">
                <div className="text-sm font-semibold text-neutral-900">
                  {appointment.service}
                </div>
                <div className="text-xs text-neutral-600">
                  Tech:
                  {' '}
                  {appointment.tech}
                </div>
              </div>

              {/* Price Breakdown */}
              {appointment.status === 'completed' && (
                <div className="space-y-1 border-t border-neutral-200/50 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-600">Price</span>
                    <span className="font-semibold text-neutral-900">
                      $
                      {appointment.originalPrice}
                    </span>
                  </div>
                  {appointment.rewardDiscount && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-neutral-600">Reward Applied</span>
                      <span className="font-semibold text-green-600">
                        -$
                        {appointment.rewardDiscount}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-neutral-200/50 pt-1">
                    <span className="text-sm font-semibold text-neutral-900">
                      Total Paid
                    </span>
                    <span className="text-sm font-bold text-neutral-900">
                      $
                      {appointment.finalPrice}
                    </span>
                  </div>
                </div>
              )}

              {appointment.status === 'cancelled' && (
                <div className="border-t border-neutral-200/50 pt-2">
                  <div className="text-xs text-neutral-500">
                    This appointment was cancelled
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Empty state message (if needed) */}
        {APPOINTMENT_HISTORY.length === 0 && (
          <div className="rounded-xl bg-white p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <p className="text-sm text-neutral-600">
              No appointment history yet
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
