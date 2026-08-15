'use client';

import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useClientSession } from '@/hooks/useClientSession';
import { appendSalonSlug, buildChangeAppointmentUrl } from '@/libs/bookingParams';
import { formatMoney } from '@/libs/formatMoney';

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
  currency: string | null;
  totalDurationMinutes: number;
  financial: {
    serviceInvoiceTotalCents: number;
    totalCents: number;
    depositCreditCents: number;
    appointmentPaymentsCents: number;
    amountAlreadyPaidCents: number;
    balanceCents: number;
    depositState: 'resolved' | 'blocked';
    depositBlockCode: string | null;
    depositPresentationState:
      | 'none'
      | 'creditable'
      | 'refund_candidate'
      | 'refund_in_flight'
      | 'refund_review'
      | 'refunded'
      | 'forfeited'
      | 'blocked';
    collectedDepositCents: number;
    refundedDepositCents: number;
    forfeitedDepositCents: number;
  } | null;
  locationId: string | null;
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

type AppointmentHistoryContentProps = {
  salonName: string;
  salonSlug: string;
};

export default function AppointmentHistoryContent({
  salonName,
  salonSlug,
}: AppointmentHistoryContentProps) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const { isLoggedIn, isCheckingSession } = useClientSession();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function fetchHistory() {
      if (isCheckingSession) {
        return;
      }

      if (!isLoggedIn || !salonSlug) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/appointments/history?salonSlug=${encodeURIComponent(salonSlug)}`,
        );
        if (response.ok) {
          const data = await response.json();
          setAppointments(data.data?.appointments || []);
        } else {
          setAppointments([]);
        }
      } catch (error) {
        console.error('Failed to fetch appointment history:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchHistory();
  }, [isCheckingSession, isLoggedIn, salonSlug]);

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
    if (status === 'cancelled' && cancelReason === 'rescheduled') {
      return 'Rescheduled';
    }
    switch (status) {
      case 'completed': return 'Completed';
      case 'confirmed': return 'Confirmed';
      // A client just booked this — "Booked" reads better than internal "Pending"
      case 'pending': return 'Booked';
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
    return ['pending', 'confirmed'].includes(appointment.status)
      && new Date(appointment.startTime) > new Date();
  };

  const completedAppointments = appointments.filter(a => a.status === 'completed');
  const completedCurrencies = new Set(
    completedAppointments.map(appointment => appointment.currency).filter(Boolean),
  );
  const completedAggregateResolved = completedAppointments.every(appointment =>
    appointment.currency !== null
    && appointment.financial !== null
    && appointment.financial.depositState === 'resolved');
  const totalSpentCurrency = completedAggregateResolved
    && completedCurrencies.size === 1
    ? [...completedCurrencies][0]!
    : null;
  const totalSpentCents = totalSpentCurrency
    ? completedAppointments.reduce(
      (sum, appointment) => sum + appointment.financial!.amountAlreadyPaidCents,
      0,
    )
    : 0;
  const totalSpent = totalSpentCurrency
    ? formatMoney(totalSpentCents, totalSpentCurrency)
    : 'Unavailable';
  const requiresSession = !isCheckingSession && !isLoggedIn;

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
            className="hover:bg-[var(--n5-bg-card)]/60 z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 active:scale-95"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="font-heading absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight text-[var(--n5-accent)]">
            {salonName}
          </div>
        </div>

        <div className="pb-6 pt-4 text-center" style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms' }}>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-[var(--n5-ink-main)]">Your Visits</h1>
          <p className="font-body mt-1 text-base italic text-[var(--n5-ink-muted)]">Your nail journey</p>
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
              background: `linear-gradient(to bottom right, var(--n5-ink-main), color-mix(in srgb, var(--n5-ink-main) 70%, black))`,
            }}
          >
            <div className="px-6 py-5">
              <div className="flex items-center justify-between">
                <div className="flex-1 text-center">
                  <div className="font-body text-3xl font-bold text-[var(--n5-ink-inverse)]">{appointments.length}</div>
                  <div className="font-body text-[var(--n5-ink-inverse)]/70 mt-0.5 text-sm">Total Visits</div>
                </div>
                <div className="bg-[var(--n5-ink-inverse)]/20 h-12 w-px" />
                <div className="flex-1 text-center">
                  <div className="font-body text-3xl font-bold text-[var(--n5-ink-inverse)]">{completedAppointments.length}</div>
                  <div className="font-body text-[var(--n5-ink-inverse)]/70 mt-0.5 text-sm">Completed</div>
                </div>
                <div className="bg-[var(--n5-ink-inverse)]/20 h-12 w-px" />
                <div className="flex-1 text-center">
                  <div className="font-body text-3xl font-bold text-[var(--n5-accent)]">
                    {totalSpent}
                  </div>
                  <div className="font-body text-[var(--n5-ink-inverse)]/70 mt-0.5 text-sm">Total Spent</div>
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
                <div key={appointment.id} className="overflow-hidden border border-[var(--n5-border)] bg-[var(--n5-bg-card)] shadow-[var(--n5-shadow-md)]" style={{ borderRadius: 'var(--n5-radius-card)', opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0) scale(1)' : 'translateY(15px) scale(0.98)', transition: `opacity 300ms ease-out ${200 + index * 60}ms, transform 300ms ease-out ${200 + index * 60}ms` }}>
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
                        <div className="font-body mt-1 flex items-center gap-1.5 text-base text-[var(--n5-ink-muted)]">
                          <span className="text-[var(--n5-accent)]">✦</span>
                          <span className="font-medium">Tech:</span>
                          <span>{appointment.technician?.name || 'Any Artist'}</span>
                        </div>
                      </div>
                    </div>
                    {['cancelled', 'no_show'].includes(appointment.status)
                    && appointment.financial === null
                      ? (
                          <div className="border-t border-neutral-100 pt-4">
                            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                              Financial details are under review. Contact the salon for confirmed amounts.
                            </div>
                          </div>
                        )
                      : null}
                    {['cancelled', 'no_show'].includes(appointment.status)
                    && appointment.financial !== null
                    && (
                      appointment.financial.depositState === 'blocked'
                      || ['refund_in_flight', 'refund_review', 'blocked'].includes(
                        appointment.financial.depositPresentationState,
                      )
                    )
                    && appointment.financial.collectedDepositCents === 0
                      ? (
                          <div className="border-t border-neutral-100 pt-4">
                            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                              Deposit handling is under review. Contact the salon for confirmed refund details.
                            </div>
                          </div>
                        )
                      : null}
                    {['cancelled', 'no_show'].includes(appointment.status)
                    && appointment.financial
                    && appointment.financial.collectedDepositCents > 0
                      ? (
                          <div className="space-y-2 border-t border-neutral-100 pt-4 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Deposit collected</span>
                              <span className="font-semibold text-neutral-700">
                                {appointment.currency
                                  ? formatMoney(
                                    appointment.financial.collectedDepositCents,
                                    appointment.currency,
                                  )
                                  : 'Unavailable'}
                              </span>
                            </div>
                            {appointment.financial.depositPresentationState === 'refund_candidate' && (
                              <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                                Refund due for owner review. This deposit is not appointment credit.
                              </div>
                            )}
                            {appointment.financial.depositPresentationState === 'refund_in_flight' && (
                              <div className="rounded-lg bg-blue-50 px-3 py-2 text-blue-900">
                                Deposit refund in progress.
                              </div>
                            )}
                            {appointment.financial.depositPresentationState === 'refunded' && (
                              <div className="flex items-center justify-between text-emerald-700">
                                <span>Deposit refunded</span>
                                <span className="font-semibold">
                                  {appointment.currency
                                    ? formatMoney(
                                      appointment.financial.refundedDepositCents,
                                      appointment.currency,
                                    )
                                    : 'Unavailable'}
                                </span>
                              </div>
                            )}
                            {appointment.financial.depositPresentationState === 'forfeited' && (
                              <div className="flex items-center justify-between text-amber-800">
                                <span>Deposit retained after no-show</span>
                                <span className="font-semibold">
                                  {appointment.currency
                                    ? formatMoney(
                                      appointment.financial.forfeitedDepositCents,
                                      appointment.currency,
                                    )
                                    : 'Unavailable'}
                                </span>
                              </div>
                            )}
                            {['refund_review', 'blocked'].includes(
                              appointment.financial.depositPresentationState,
                            ) && (
                              <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                                Deposit handling is under review. Contact the salon for details.
                              </div>
                            )}
                          </div>
                        )
                      : null}
                    {['completed', 'confirmed', 'pending'].includes(appointment.status) && (
                      <div className="space-y-2.5 border-t border-neutral-100 pt-4">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-neutral-500">
                            {appointment.status === 'completed' ? 'Final total' : 'Estimated total'}
                          </span>
                          <span className="text-base font-semibold text-neutral-700">
                            {appointment.currency && appointment.financial
                              ? formatMoney(
                                appointment.financial.totalCents,
                                appointment.currency,
                              )
                              : 'Unavailable'}
                          </span>
                        </div>
                        {appointment.financial?.depositState === 'blocked'
                          ? (
                              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                Deposit and balance are under review. Contact the salon before sending payment.
                              </div>
                            )
                          : appointment.financial
                            ? (
                                <>
                                  {appointment.financial.depositCreditCents > 0 && (
                                    <div className="flex items-center justify-between text-sm">
                                      <span className="text-neutral-500">Deposit paid</span>
                                      <span className="font-semibold text-neutral-700">
                                        −
                                        {appointment.currency
                                          ? formatMoney(
                                            appointment.financial.depositCreditCents,
                                            appointment.currency,
                                          )
                                          : 'Unavailable'}
                                      </span>
                                    </div>
                                  )}
                                  {appointment.financial.appointmentPaymentsCents > 0 && (
                                    <div className="flex items-center justify-between text-sm">
                                      <span className="text-neutral-500">Other payments</span>
                                      <span className="font-semibold text-neutral-700">
                                        {appointment.currency
                                          ? formatMoney(
                                            appointment.financial.appointmentPaymentsCents,
                                            appointment.currency,
                                          )
                                          : 'Unavailable'}
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between border-t border-[var(--n5-border)] pt-2.5">
                                    <span className="font-body text-base font-bold text-[var(--n5-ink-main)]">
                                      {appointment.financial.balanceCents === 0 ? 'Amount paid' : 'Balance'}
                                    </span>
                                    <span className="font-body text-xl font-bold text-[var(--n5-accent)]">
                                      {appointment.currency
                                        ? formatMoney(
                                          appointment.financial.balanceCents === 0
                                            ? appointment.financial.amountAlreadyPaidCents
                                            : appointment.financial.balanceCents,
                                          appointment.currency,
                                        )
                                        : 'Unavailable'}
                                    </span>
                                  </div>
                                </>
                              )
                            : (
                                <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                  Financial details are under review. Contact the salon before sending payment.
                                </div>
                              )}
                      </div>
                    )}
                    {isUpcoming(appointment) && (
                      <div className="mt-4 border-t border-neutral-100 pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            router.push(buildChangeAppointmentUrl({
                              salonSlug,
                              serviceIds: appointment.services.map(s => s.id),
                              techId: appointment.technician?.id || 'any',
                              locationId: appointment.locationId,
                              originalAppointmentId: appointment.id,
                              startTime: appointment.startTime,
                              tenantRoute: {
                                routeSalonSlug,
                                locale,
                              },
                            }));
                          }}
                          className="font-body w-full py-3 text-sm font-bold text-[var(--n5-button-primary-text)] transition-all hover:scale-[1.02] active:scale-[0.98]"
                          style={{ borderRadius: 'var(--n5-radius-md)', background: `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover))` }}
                        >
                          View / Change
                        </button>
                      </div>
                    )}
                    {appointment.status === 'cancelled' && appointment.cancelReason !== 'rescheduled' && (
                      <div className="border-t border-neutral-100 pt-4">
                        <div className="flex items-center gap-2 text-sm text-rose-500">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                            <path d="M15 9L9 15M9 9L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                          <span className="font-medium">This appointment was cancelled</span>
                        </div>
                      </div>
                    )}
                    {appointment.status === 'cancelled' && appointment.cancelReason === 'rescheduled' && (
                      <div className="border-t border-neutral-100 pt-4">
                        <div className="flex items-center gap-2 text-sm text-orange-600">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
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
          <div className="overflow-hidden border border-[var(--n5-border)] bg-[var(--n5-bg-card)] shadow-[var(--n5-shadow-md)]" style={{ borderRadius: 'var(--n5-radius-card)' }}>
            <div className="px-6 py-12 text-center">
              <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[var(--n5-bg-page)]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[var(--n5-accent)]">
                  <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="font-body text-lg font-semibold text-[var(--n5-ink-main)]">No visits yet</p>
              <p className="font-body mt-1 text-sm text-[var(--n5-ink-muted)]">
                {requiresSession
                  ? 'Sign in with your booking phone number to view your visit history.'
                  : 'Book your first appointment to start your nail journey'}
              </p>
              <button
                type="button"
                onClick={() => router.push(appendSalonSlug('/book', salonSlug, {
                  routeSalonSlug,
                  locale,
                }))}
                className="font-body mt-4 px-6 py-3 text-base font-bold text-[var(--n5-button-primary-text)] shadow-[var(--n5-shadow-sm)] transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                style={{ borderRadius: 'var(--n5-radius-pill)', background: `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover))` }}
              >
                {requiresSession ? 'Book or Sign In' : 'Book Now'}
              </button>
            </div>
          </div>
        )}

        <div className="h-6" />
      </div>
    </div>
  );
}
