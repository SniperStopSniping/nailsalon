'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';

type ServiceData = {
  id: string;
  name: string;
  price: number;
  duration: number;
  imageUrl: string | null;
};

type TechnicianData = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  cancelReason: string | null;
  totalPrice: number;
  totalDurationMinutes: number;
  services: ServiceData[];
  technician: TechnicianData | null;
};

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

export default function AppointmentHistoryPage() {
  const router = useRouter();
  const { salonName } = useSalon();

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clientPhone, setClientPhone] = useState('');

  useEffect(() => {
    const clientPhoneCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_phone='));
    if (clientPhoneCookie) {
      const phone = decodeURIComponent(clientPhoneCookie.split('=')[1] || '');
      if (phone) setClientPhone(phone);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    async function fetchHistory() {
      if (!clientPhone) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/appointments/history?phone=${encodeURIComponent(clientPhone)}`);
        if (response.ok) {
          const data = await response.json();
          setAppointments(data.data?.appointments || []);
        }
      } catch (error) {
        console.error('Failed to fetch appointment history:', error);
      } finally {
        setLoading(false);
      }
    }

    if (clientPhone) {
      fetchHistory();
    } else {
      setLoading(false);
    }
  }, [clientPhone]);

  const handleBack = () => {
    router.back();
  };

  const getStatusStyles = (status: AppointmentStatus, cancelReason: string | null) => {
    if (status === 'cancelled' && cancelReason === 'rescheduled') {
      return 'text-orange-600 bg-orange-50 border border-orange-200';
    }
    switch (status) {
      case 'completed':
        return 'text-emerald-700 bg-emerald-50 border border-emerald-200';
      case 'confirmed':
        return 'text-blue-700 bg-blue-50 border border-blue-200';
      case 'pending':
        return 'text-purple-700 bg-purple-50 border border-purple-200';
      case 'cancelled':
        return 'text-rose-600 bg-rose-50 border border-rose-200';
      case 'no_show':
        return 'text-amber-600 bg-amber-50 border border-amber-200';
      default:
        return 'text-neutral-600 bg-neutral-50 border border-neutral-200';
    }
  };

  const getStatusLabel = (status: AppointmentStatus, cancelReason: string | null) => {
    if (status === 'cancelled' && cancelReason === 'rescheduled') return 'Rescheduled';
    switch (status) {
      case 'completed': return 'Completed';
      case 'confirmed': return 'Confirmed';
      case 'pending': return 'Pending';
      case 'cancelled': return 'Cancelled';
      case 'no_show': return 'No Show';
      default: return status;
    }
  };

  const getStatusBarColor = (status: AppointmentStatus, cancelReason: string | null) => {
    if (status === 'cancelled' && cancelReason === 'rescheduled') {
      return 'bg-gradient-to-r from-orange-400 to-orange-500';
    }
    switch (status) {
      case 'completed': return 'bg-gradient-to-r from-emerald-400 to-emerald-500';
      case 'confirmed': return 'bg-gradient-to-r from-blue-400 to-blue-500';
      case 'pending': return 'bg-gradient-to-r from-purple-400 to-purple-500';
      case 'cancelled': return 'bg-gradient-to-r from-rose-400 to-rose-500';
      case 'no_show': return 'bg-gradient-to-r from-amber-400 to-amber-500';
      default: return 'bg-gradient-to-r from-neutral-400 to-neutral-500';
    }
  };

  const isUpcoming = (appointment: Appointment) => {
    return ['pending', 'confirmed'].includes(appointment.status) &&
      new Date(appointment.startTime) > new Date();
  };

  const completedAppointments = appointments.filter(a => a.status === 'completed');
  const totalSpent = completedAppointments.reduce((sum, a) => sum + (a.totalPrice / 100), 0);

  return (
    <div
      className="min-h-screen pb-10"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, var(--n5-bg-page) 95%, white), var(--n5-bg-page), color-mix(in srgb, var(--n5-bg-page) 95%, var(--n5-accent-hover)))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
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
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-[var(--n5-bg-card)]/60 active:scale-95"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight font-heading text-[var(--n5-accent)]">
            {salonName}
          </div>
        </div>

        <div className="pb-6 pt-4 text-center" style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms' }}>
          <h1 className="text-3xl font-bold tracking-tight font-heading text-[var(--n5-ink-main)]">Your Visits</h1>
          <p className="mt-1 text-base italic font-body text-[var(--n5-ink-muted)]">Your nail journey</p>
        </div>

        {loading && (
          <div className="py-12 text-center">
            <div className="text-4xl">⏳</div>
            <p className="mt-2 text-neutral-500">Loading your visits...</p>
          </div>
        )}

        {!loading && appointments.length > 0 && (
          <div
            className="mb-6 overflow-hidden shadow-[var(--n5-shadow-lg)]"
            style={{
              borderRadius: 'var(--n5-radius-card)',
              background: `linear-gradient(to bottom right, var(--n5-ink-main), color-mix(in srgb, var(--n5-ink-main) 70%, black))`
            }}
          >
            <div className="px-6 py-5">
              <div className="flex items-center justify-between">
                <div className="flex-1 text-center">
                  <div className="text-3xl font-bold font-body text-[var(--n5-ink-inverse)]">{appointments.length}</div>
                  <div className="mt-0.5 text-sm font-body text-[var(--n5-ink-inverse)]/70">Total Visits</div>
                </div>
                <div className="h-12 w-px bg-[var(--n5-ink-inverse)]/20" />
                <div className="flex-1 text-center">
                  <div className="text-3xl font-bold font-body text-[var(--n5-ink-inverse)]">{completedAppointments.length}</div>
                  <div className="mt-0.5 text-sm font-body text-[var(--n5-ink-inverse)]/70">Completed</div>
                </div>
                <div className="h-12 w-px bg-[var(--n5-ink-inverse)]/20" />
                <div className="flex-1 text-center">
                  <div className="text-3xl font-bold font-body text-[var(--n5-accent)]">${totalSpent.toFixed(0)}</div>
                  <div className="mt-0.5 text-sm font-body text-[var(--n5-ink-inverse)]/70">Total Spent</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && appointments.length > 0 && (
          <div className="space-y-4">
            {appointments.map((appointment, index) => {
              const serviceNames = appointment.services.map(s => s.name).join(' + ');
              const firstServiceImage = appointment.services[0]?.imageUrl;
              return (
                <div key={appointment.id} className="overflow-hidden shadow-[var(--n5-shadow-md)] bg-[var(--n5-bg-card)] border border-[var(--n5-border)]" style={{ borderRadius: 'var(--n5-radius-card)', opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0) scale(1)' : 'translateY(15px) scale(0.98)', transition: `opacity 300ms ease-out ${200 + index * 60}ms, transform 300ms ease-out ${200 + index * 60}ms` }}>
                  <div className={`h-1 ${getStatusBarColor(appointment.status, appointment.cancelReason)}`} />
                  <div className="p-5">
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <div className="text-xl font-bold tracking-tight text-neutral-900">{formatDate(appointment.startTime)}</div>
                        <div className="mt-0.5 text-sm font-medium text-neutral-500">{formatTime(appointment.startTime)}</div>
                      </div>
                      <span className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${getStatusStyles(appointment.status, appointment.cancelReason)}`}>
                        {getStatusLabel(appointment.status, appointment.cancelReason)}
                      </span>
                    </div>
                    <div className="mb-4 flex gap-4">
                      {firstServiceImage && !['cancelled', 'no_show'].includes(appointment.status) && (
                        <div className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-neutral-100 shadow-sm">
                          <Image src={firstServiceImage} alt={serviceNames} fill className="object-cover" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-bold text-neutral-900">{serviceNames || 'Service'}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-base font-body text-[var(--n5-ink-muted)]">
                          <span className="text-[var(--n5-accent)]">✦</span>
                          <span className="font-medium">Tech:</span>
                          <span>{appointment.technician?.name || 'Any Artist'}</span>
                        </div>
                      </div>
                    </div>
                    {['completed', 'confirmed', 'pending'].includes(appointment.status) && (
                      <div className="space-y-2.5 border-t border-neutral-100 pt-4">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-neutral-500">Price</span>
                          <span className="text-base font-semibold text-neutral-700">${(appointment.totalPrice / 100).toFixed(0)}</span>
                        </div>
                        {appointment.status === 'completed' && (
                          <div className="flex items-center justify-between border-t border-[var(--n5-border)] pt-2.5">
                            <span className="text-lg font-bold font-body text-[var(--n5-ink-main)]">Total Paid</span>
                            <span className="text-xl font-bold font-body text-[var(--n5-accent)]">${(appointment.totalPrice / 100).toFixed(0)}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {isUpcoming(appointment) && (
                      <div className="mt-4 border-t border-neutral-100 pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            const serviceIds = appointment.services.map(s => s.id).join(',');
                            const techId = appointment.technician?.id || 'any';
                            const apptDate = new Date(appointment.startTime);
                            const dateStr = apptDate.toISOString().split('T')[0];
                            const timeStr = `${apptDate.getHours()}:${apptDate.getMinutes().toString().padStart(2, '0')}`;
                            router.push(`/change-appointment?serviceIds=${serviceIds}&techId=${techId}&date=${dateStr}&time=${timeStr}&clientPhone=${encodeURIComponent(clientPhone)}&originalAppointmentId=${encodeURIComponent(appointment.id)}`);
                          }}
                          className="w-full py-3 text-sm font-bold font-body text-[var(--n5-button-primary-text)] transition-all hover:scale-[1.02] active:scale-[0.98]"
                          style={{ borderRadius: 'var(--n5-radius-md)', background: `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover))` }}
                        >
                          View / Change
                        </button>
                      </div>
                    )}
                    {appointment.status === 'cancelled' && appointment.cancelReason !== 'rescheduled' && (
                      <div className="border-t border-neutral-100 pt-4">
                        <div className="flex items-center gap-2 text-sm text-rose-500">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" /><path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                          <span className="font-medium">This appointment was cancelled</span>
                        </div>
                      </div>
                    )}
                    {appointment.status === 'cancelled' && appointment.cancelReason === 'rescheduled' && (
                      <div className="border-t border-neutral-100 pt-4">
                        <div className="flex items-center gap-2 text-sm text-orange-600">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          <span className="font-medium">This appointment was rescheduled to a new time</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && appointments.length === 0 && (
          <div className="overflow-hidden shadow-[var(--n5-shadow-md)] bg-[var(--n5-bg-card)] border border-[var(--n5-border)]" style={{ borderRadius: 'var(--n5-radius-card)' }}>
            <div className="px-6 py-12 text-center">
              <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[var(--n5-bg-page)]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[var(--n5-accent)]">
                  <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-lg font-semibold font-body text-[var(--n5-ink-main)]">No visits yet</p>
              <p className="mt-1 text-sm font-body text-[var(--n5-ink-muted)]">Book your first appointment to start your nail journey</p>
              <button
                type="button"
                onClick={() => router.push('/book/service')}
                className="mt-4 px-6 py-3 text-base font-bold font-body text-[var(--n5-button-primary-text)] shadow-[var(--n5-shadow-sm)] transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                style={{ borderRadius: 'var(--n5-radius-pill)', background: `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover))` }}
              >
                Book Now
              </button>
            </div>
          </div>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
