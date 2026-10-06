'use client';

/**
 * WalkInModal Component
 *
 * Quick walk-in booking flow:
 * 1. Select services (to get total duration)
 * 2. Select a technician (or "Any available")
 * 3. See next available time slots (filtered by duration)
 * 4. Enter client info & book
 */

import { Check, ChevronRight, Clock, Loader2, Phone, Search, User, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { NewAppointmentModal } from '@/components/admin/NewAppointmentModal';
import { DialogShell } from '@/components/ui/dialog-shell';
import { BOOKING_CATEGORY_META, resolveVisibleBookingCategory } from '@/libs/bookingCategory';
import { serializeBookingBasket } from '@/libs/bookingParams';
import { notifyAppointmentDataChanged } from '@/libs/dashboardEvents';
import { getDateKeyInTimeZone } from '@/libs/timeZone';
import type { BookingCategory } from '@/models/Schema';
import { useSalon } from '@/providers/SalonProvider';
import { formatDuration } from '@/utils/Helpers';

// Types
type Technician = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

type Service = {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  category: string | null;
  bookingCategory?: BookingCategory | null;
};

type TimeSlot = {
  time: Date;
  label: string;
  available: boolean;
};

type WalkInModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /**
   * Active salon from the surface that opened the modal. The owner dashboard
   * resolves its salon client-side, after the tenant cookie the SalonProvider
   * reads has been set, so the prop is the reliable source and the provider is
   * only a fallback for surfaces that still rely on it.
   */
  salonSlug?: string | null;
};

/** Shown when no salon could be resolved, instead of an endless spinner. */
const MISSING_SALON_MESSAGE = 'Choose a salon to continue';

// Helper functions
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatTimeSlot(date: Date, timeZone: string): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

export function WalkInModal({ isOpen, onClose, onSuccess, salonSlug: salonSlugProp }: WalkInModalProps) {
  const { salonSlug: contextSalonSlug } = useSalon();
  const salonSlug = salonSlugProp?.trim() || contextSalonSlug;

  // Step tracking: services -> tech -> time -> confirm
  const [step, setStep] = useState<'services' | 'tech' | 'time' | 'confirm'>('services');

  // Selection state
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<Date | null>(null);
  const [clientPhone, setClientPhone] = useState('');
  const [clientName, setClientName] = useState('');

  // Data state
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<TimeSlot[]>([]);
  const [availabilityStatus, setAvailabilityStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [canRetryAvailability, setCanRetryAvailability] = useState(true);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [showNewAppointment, setShowNewAppointment] = useState(false);
  const submitAttempt = useRef<{ body: string; key: string } | null>(null);
  const submittingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [serviceSearch, setServiceSearch] = useState('');

  // Fetch initial data
  const fetchData = useCallback(async (signal?: AbortSignal) => {
    if (!salonSlug) {
      // No tenant to load against: surface it instead of spinning forever.
      setTechnicians([]);
      setServices([]);
      setTimeZone(null);
      setError(MISSING_SALON_MESSAGE);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setTimeZone(null);
      setError(null);

      const [techRes, servicesRes, apptsRes] = await Promise.all([
        fetch(`/api/admin/technicians?salonSlug=${encodeURIComponent(salonSlug)}&status=active`, { signal }),
        fetch(`/api/salon/services?salonSlug=${encodeURIComponent(salonSlug)}`, { signal }),
        fetch(`/api/admin/appointments?salonSlug=${encodeURIComponent(salonSlug)}&limit=1`, { signal }),
      ]);

      if (!techRes.ok || !servicesRes.ok || !apptsRes.ok) {
        throw new Error('Failed to load data');
      }

      const [techData, servicesData, apptsData] = await Promise.all([
        techRes.json(),
        servicesRes.json(),
        apptsRes.json(),
      ]);

      if (signal?.aborted) {
        return;
      }
      setTechnicians(techData.data?.technicians || []);
      setServices(servicesData.data?.services || []);
      if (typeof apptsData.meta?.timeZone !== 'string') {
        throw new TypeError('Could not load the salon time zone.');
      }
      setTimeZone(apptsData.meta.timeZone);
    } catch (err) {
      if (signal?.aborted) {
        return;
      }
      console.error('Failed to fetch data:', err);
      setError('Failed to load data');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [salonSlug]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const controller = new AbortController();
    void fetchData(controller.signal);
    return () => controller.abort();
  }, [isOpen, fetchData]);

  useEffect(() => {
    setStep('services');
    setSelectedServiceIds([]);
    setSelectedTechnicianId(null);
    setSelectedTimeSlot(null);
    setClientPhone('');
    setClientName('');
    setShowNewAppointment(false);
    submitAttempt.current = null;
  }, [salonSlug]);

  // Reset form when closing
  useEffect(() => {
    if (!isOpen) {
      setStep('services');
      setSelectedServiceIds([]);
      setSelectedTechnicianId(null);
      setSelectedTimeSlot(null);
      setClientPhone('');
      setClientName('');
      setError(null);
      setServiceSearch('');
      setShowNewAppointment(false);
      setAvailableSlots([]);
      submitAttempt.current = null;
    }
  }, [isOpen]);

  // Calculate totals
  const selectedServices = services.filter(s => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);

  const bookingBasket = useMemo(() => ({
    version: 2 as const,
    items: selectedServiceIds.map(serviceId => ({ serviceId, selectedAddOns: [] })),
  }), [selectedServiceIds]);

  // The booking server owns notice, time zones, working hours, buffers,
  // days off and calendar conflicts. Never manufacture bookable slots here.
  useEffect(() => {
    if (!isOpen || showNewAppointment || step !== 'time' || !salonSlug || !timeZone || !selectedServiceIds.length) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setAvailabilityStatus('loading');
    setAvailabilityError(null);
    setCanRetryAvailability(true);
    setAvailableSlots([]);
    const query = new URLSearchParams({
      salonSlug,
      date: getDateKeyInTimeZone(new Date(), timeZone),
      bookingBasket: serializeBookingBasket(bookingBasket)!,
    });
    if (selectedTechnicianId) {
      query.set('technicianId', selectedTechnicianId);
    }
    void fetch(`/api/appointments/availability?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          if (!cancelled) {
            setCanRetryAvailability(result.error?.canRetry !== false);
          }
          throw new Error(result.error?.message || 'Could not check availability. Please try again.');
        }
        if (cancelled) {
          return;
        }
        setAvailableSlots((result.slots ?? [])
          .filter((slot: { availability: string; startTime: string }) => slot.availability === 'available' && Number.isFinite(Date.parse(slot.startTime)))
          .map((slot: { startTime: string }) => ({ time: new Date(slot.startTime), label: formatTimeSlot(new Date(slot.startTime), timeZone), available: true })));
        setAvailabilityStatus('ready');
      })
      .catch((reason) => {
        if (cancelled) {
          return;
        }
        setAvailabilityError(reason instanceof Error ? reason.message : 'Could not check availability. Please try again.');
        setAvailabilityStatus('error');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isOpen, showNewAppointment, step, salonSlug, timeZone, bookingBasket, selectedServiceIds.length, selectedTechnicianId, availabilityRevision]);

  useEffect(() => {
    if (!isOpen || showNewAppointment || step !== 'time') {
      return;
    }
    const interval = window.setInterval(() => setAvailabilityRevision(value => value + 1), 60_000);
    return () => window.clearInterval(interval);
  }, [isOpen, showNewAppointment, step]);

  // Filter services by search
  const filteredServices = services.filter(s =>
    s.name.toLowerCase().includes(serviceSearch.toLowerCase())
    || s.category?.toLowerCase().includes(serviceSearch.toLowerCase()),
  );

  // Same visible grouping as client booking and the owner menu.
  const servicesByCategory = filteredServices.reduce((acc, service) => {
    const category = resolveVisibleBookingCategory({
      bookingCategory: service.bookingCategory ?? null,
      category: service.category ?? 'manicure',
    });
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(service);
    return acc;
  }, {} as Record<BookingCategory, Service[]>);

  // Handle service toggle
  const toggleService = (serviceId: string) => {
    setSelectedServiceIds(prev =>
      prev.includes(serviceId)
        ? prev.filter(id => id !== serviceId)
        : [...prev, serviceId],
    );
    // Reset time slot when services change (duration changes)
    setSelectedTimeSlot(null);
  };

  // Format phone
  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '');
    setClientPhone(digits.slice(0, 10));
  };

  const formatPhoneDisplay = (phone: string): string => {
    if (phone.length <= 3) {
      return phone;
    }
    if (phone.length <= 6) {
      return `(${phone.slice(0, 3)}) ${phone.slice(3)}`;
    }
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  };

  // Navigation
  const handleServicesNext = () => {
    if (selectedServiceIds.length === 0) {
      setError('Please select at least one service');
      return;
    }
    setError(null);
    if (technicians.length === 1) {
      setSelectedTechnicianId(technicians[0]!.id);
      setStep('time');
    } else {
      setStep('tech');
    }
  };

  const handleTechSelect = (techId: string | null) => {
    setSelectedTechnicianId(techId);
    setSelectedTimeSlot(null); // Reset time when tech changes
    setStep('time');
  };

  const handleTimeSelect = (slot: TimeSlot) => {
    if (!slot.available) {
      return;
    }
    setError(null);
    setSelectedTimeSlot(slot.time);
    setStep('confirm');
  };

  // Submit
  const handleSubmit = async () => {
    if (submittingRef.current) {
      return;
    }
    if (!selectedTimeSlot) {
      setError('Please select a time slot');
      return;
    }
    if (!clientPhone || clientPhone.length !== 10) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }

    try {
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);

      // Use the same owner-entry contract as New Appointment. Public basket
      // submissions require a separately reviewed quote fingerprint.
      const body = JSON.stringify({ salonSlug, serviceIds: selectedServiceIds, technicianId: selectedTechnicianId, clientPhone, clientName: clientName || undefined, startTime: selectedTimeSlot.toISOString() });
      if (!submitAttempt.current || submitAttempt.current.body !== body) {
        submitAttempt.current = { body, key: globalThis.crypto?.randomUUID?.() ?? `walk-in-${Date.now()}-${Math.random().toString(36).slice(2)}` };
      }
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': submitAttempt.current.key },
        body,
      });

      const result = await response.json();

      if (!response.ok) {
        if (['TOO_SOON', 'TIME_CONFLICT', 'SLOT_UNAVAILABLE', 'TECHNICIAN_UNAVAILABLE'].includes(result.error?.code)) {
          setSelectedTimeSlot(null);
          setStep('time');
          setAvailabilityRevision(value => value + 1);
        }
        throw new Error(result.error?.message || 'Failed to create appointment');
      }

      // Walk-in bookings must refresh the Today/retention queues just like
      // every other appointment mutation.
      notifyAppointmentDataChanged();
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Failed to create appointment:', err);
      setError(err instanceof Error ? err.message : 'Failed to create appointment');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const selectedTechnician = technicians.find(t => t.id === selectedTechnicianId);
  const steps = technicians.length === 1 ? ['services', 'time', 'confirm'] : ['services', 'tech', 'time', 'confirm'];
  const stepLabels: Record<string, string> = { services: 'Services', tech: 'Tech', time: 'Time', confirm: 'Book' };

  if (!isOpen) {
    return null;
  }

  if (showNewAppointment) {
    return (
      <NewAppointmentModal
        isOpen
        onClose={() => setShowNewAppointment(false)}
        onSuccess={() => {
          onSuccess?.();
          onClose();
        }}
        salonSlug={salonSlug}
        clientPrefill={{ name: clientName || null, phone: clientPhone, email: null, serviceIds: selectedServiceIds, technicianId: selectedTechnicianId }}
      />
    );
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      maxWidthClassName="max-w-lg"
      contentClassName="max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl supports-[height:100dvh]:max-h-[90dvh]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="walk-in-modal-title"
        className="owner-workspace-theme flex max-h-[90vh] flex-col supports-[height:100dvh]:max-h-[90dvh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-[var(--owner-accent)]">
              <Zap className="size-4 text-white" />
            </div>
            <h2 id="walk-in-modal-title" className="text-lg font-semibold text-gray-900">Quick Walk-in</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex size-11 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950"
          >
            <X className="size-5 text-gray-600" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="flex shrink-0 items-center justify-center gap-1 border-b border-gray-100 bg-gray-50 px-4 py-3">
          {steps.map((s, idx) => {
            const stepNum = idx + 1;
            const isActive = s === step;
            const isPast = steps.indexOf(step) > idx;

            return (
              <div key={s} className="flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    if (isPast) {
                      setStep(s as typeof step);
                    }
                  }}
                  disabled={!isPast && !isActive}
                  className={`
                        flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all
                        ${isActive
                ? 'bg-[var(--owner-accent)] text-white'
                : isPast
                  ? 'cursor-pointer bg-[var(--owner-blush)] text-[var(--owner-accent)] hover:bg-[var(--owner-ground)]'
                  : 'bg-gray-100 text-gray-400'
              }
                      `}
                >
                  {isPast ? <Check className="size-3" /> : <span>{stepNum}</span>}
                  <span>{stepLabels[s]}</span>
                </button>
                {idx < steps.length - 1 && <ChevronRight className="mx-1 size-4 text-gray-300" />}
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-white p-5">
          {loading
            ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="size-8 animate-spin text-gray-400" />
                </div>
              )
            : (
                <>
                  {/* Error Message */}
                  {error && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3" role="alert" data-testid="walk-in-error">
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  )}

                  {/* Step 1: Services Selection */}
                  {step === 'services' && (
                    <div className="space-y-4">
                      <div>
                        <h3 className="font-semibold text-gray-900">What services today?</h3>
                        <p className="text-sm text-gray-500">Select all services needed</p>
                      </div>

                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          value={serviceSearch}
                          onChange={e => setServiceSearch(e.target.value)}
                          placeholder="Search services..."
                          className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--owner-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--owner-accent)]"
                        />
                      </div>

                      {/* Service List */}
                      <div className="space-y-4">
                        {Object.entries(servicesByCategory).map(([category, categoryServices]) => (
                          <div key={category}>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                              {BOOKING_CATEGORY_META[category as BookingCategory].label}
                            </h4>
                            <div className="space-y-2">
                              {categoryServices.map((service) => {
                                const isSelected = selectedServiceIds.includes(service.id);
                                return (
                                  <button
                                    key={service.id}
                                    type="button"
                                    onClick={() => toggleService(service.id)}
                                    className={`
                                      flex w-full items-center justify-between rounded-xl border-2 p-3 text-left transition-all
                                      ${isSelected
                                    ? 'border-[var(--owner-accent)] bg-[var(--owner-blush)]'
                                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                                  }
                                    `}
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className={`
                                        flex size-6 items-center justify-center rounded-full border-2 transition-colors
                                        ${isSelected
                                    ? 'border-[var(--owner-accent)] bg-[var(--owner-accent)] text-white'
                                    : 'border-gray-300 bg-white'
                                  }
                                      `}
                                      >
                                        {isSelected && <Check className="size-4" />}
                                      </div>
                                      <div>
                                        <p className={`font-medium ${isSelected ? 'text-[var(--owner-ink)]' : 'text-gray-900'}`}>
                                          {service.name}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                          <Clock className="mr-1 inline-block size-3" />
                                          {formatDuration(service.durationMinutes)}
                                        </p>
                                      </div>
                                    </div>
                                    <span className={`font-semibold ${isSelected ? 'text-[var(--owner-ink)]' : 'text-gray-900'}`}>
                                      {formatCurrency(service.price)}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Step 2: Technician Selection */}
                  {step === 'tech' && (
                    <div className="space-y-4">
                      {/* Summary of selected services */}
                      <div className="rounded-xl bg-[var(--owner-blush)] p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-[var(--owner-ink)]">
                              {selectedServices.length}
                              {' '}
                              service
                              {selectedServices.length !== 1 ? 's' : ''}
                            </p>
                            <p className="text-xs text-[var(--owner-accent)]">
                              {formatDuration(totalDuration)}
                              {' '}
                              total •
                              {formatCurrency(totalPrice)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setStep('services')}
                            className="text-xs font-medium text-[var(--owner-accent)] hover:text-[var(--owner-accent-strong)]"
                          >
                            Edit
                          </button>
                        </div>
                      </div>

                      <div>
                        <h3 className="font-semibold text-gray-900">Who would they like?</h3>
                        <p className="text-sm text-gray-500">Select a technician</p>
                      </div>

                      <button type="button" onClick={() => handleTechSelect(null)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-[var(--owner-line)] p-4 text-left">
                        <User aria-hidden="true" className="size-5 text-[var(--owner-accent)]" />
                        <span className="flex-1 font-medium">Any available technician</span>
                        <ChevronRight aria-hidden="true" className="size-4" />
                      </button>
                      {technicians.map(tech => (
                        <button key={tech.id} type="button" onClick={() => handleTechSelect(tech.id)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-[var(--owner-line)] p-4 text-left">
                          <span className="flex size-10 items-center justify-center rounded-full bg-[var(--owner-blush)] text-sm font-semibold text-[var(--owner-accent)]">{getInitials(tech.name)}</span>
                          <span className="flex-1 font-medium">{tech.name}</span>
                          <ChevronRight aria-hidden="true" className="size-4" />
                        </button>
                      ))}
                      <p className="text-xs text-gray-500">Available times are checked with your booking rules and calendar next.</p>
                    </div>
                  )}

                  {/* Step 3: Time Slot Selection */}
                  {step === 'time' && (
                    <div className="space-y-4">
                      {/* Summary */}
                      <div className="rounded-xl bg-[var(--owner-blush)] p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-[var(--owner-ink)]">
                              {selectedTechnician?.name || 'Any Available'}
                            </p>
                            <p className="text-xs text-[var(--owner-accent)]">
                              {formatDuration(totalDuration)}
                              {' '}
                              needed •
                              {formatCurrency(totalPrice)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setStep(technicians.length > 1 ? 'tech' : 'services')}
                            className="text-xs font-medium text-[var(--owner-accent)] hover:text-[var(--owner-accent-strong)]"
                          >
                            Change
                          </button>
                        </div>
                      </div>

                      <div>
                        <h3 className="font-semibold text-gray-900">Pick a time</h3>
                        <p className="text-sm text-gray-500">
                          {availabilityStatus === 'ready'
                            ? `${availableSlots.length} ${availableSlots.length === 1 ? 'slot' : 'slots'} available today`
                            : 'Today’s availability'}
                        </p>
                      </div>

                      <p className="text-xs text-gray-500">
                        Times are in
                        {' '}
                        {timeZone?.replace(/_/g, ' ')}
                        . Your booking notice, preparation time and calendar rules apply.
                      </p>
                      {availabilityStatus === 'loading'
                        ? (
                            <p className="flex items-center gap-2 py-6 text-sm" role="status">
                              <Loader2 className="size-4 animate-spin" />
                              {' '}
                              Checking available times…
                            </p>
                          )
                        : availabilityStatus === 'error'
                          ? (
                              <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
                                <p className="text-sm text-red-800">{availabilityError}</p>
                                <div className="mt-3 flex flex-wrap gap-3">
                                  {canRetryAvailability && <button type="button" className="min-h-11 font-semibold underline" onClick={() => setAvailabilityRevision(value => value + 1)}>Retry availability</button>}
                                  <button type="button" className="min-h-11 font-semibold underline" onClick={() => setStep('services')}>Change services</button>
                                  {technicians.length > 1 && <button type="button" className="min-h-11 font-semibold underline" onClick={() => setStep('tech')}>Change technician</button>}
                                </div>
                              </div>
                            )
                          : availableSlots.length === 0
                            ? (
                                <div className="rounded-xl border border-[var(--owner-line)] bg-[var(--owner-ground)] p-5">
                                  <p className="font-semibold">No bookable times today</p>
                                  <p className="mt-2 text-sm text-gray-600">This selection has no available time under your current booking rules.</p>
                                  <div className="mt-3 flex flex-wrap gap-3">
                                    {technicians.length > 1 && <button type="button" className="min-h-11 font-semibold underline" onClick={() => setStep('tech')}>Change technician</button>}
                                    <button type="button" className="min-h-11 font-semibold underline" onClick={() => setStep('services')}>Change services</button>
                                    <button type="button" className="min-h-11 font-semibold text-[var(--owner-accent)] underline" onClick={() => setShowNewAppointment(true)}>Book another day</button>
                                  </div>
                                </div>
                              )
                            : (
                                <div className="grid grid-cols-3 gap-2">
                                  {availableSlots.map(slot => (
                                    <button key={slot.time.toISOString()} type="button" onClick={() => handleTimeSelect(slot)} className="min-h-16 rounded-xl border border-[var(--owner-line)] bg-white p-3 text-center text-sm font-medium hover:border-[var(--owner-accent)] hover:bg-[var(--owner-blush)]">
                                      <Clock aria-hidden="true" className="mx-auto mb-1 size-4 text-[var(--owner-accent)]" />
                                      {slot.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                    </div>
                  )}

                  {/* Step 4: Confirm & Client Details */}
                  {step === 'confirm' && (
                    <div className="space-y-5">
                      {/* Booking Summary */}
                      <div className="rounded-xl bg-[var(--owner-blush)] p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-[var(--owner-accent)]">
                              {selectedTechnician?.name || 'Any Available'}
                            </p>
                            <p className="text-2xl font-bold text-[var(--owner-ink)]">
                              {selectedTimeSlot && formatTimeSlot(selectedTimeSlot, timeZone!)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setStep('time')}
                            className="text-sm font-medium text-[var(--owner-accent)] hover:text-[var(--owner-ink)]"
                          >
                            Change
                          </button>
                        </div>
                        <div className="border-t border-[var(--owner-line)] pt-3">
                          <p className="text-sm text-[var(--owner-accent)]">
                            {selectedServices.map(s => s.name).join(', ')}
                          </p>
                          <p className="mt-1 text-sm font-medium text-[var(--owner-accent)]">
                            {formatDuration(totalDuration)}
                            {' '}
                            •
                            {formatCurrency(totalPrice)}
                          </p>
                        </div>
                      </div>

                      {/* Client Info */}
                      <div className="space-y-4">
                        <h3 className="font-semibold text-gray-900">Client details</h3>

                        <div>
                          <label htmlFor="walkin-phone" className="mb-1.5 block text-sm font-medium text-gray-700">
                            <Phone className="mr-1.5 inline-block size-4" />
                            Phone Number *
                          </label>
                          <input
                            id="walkin-phone"
                            type="tel"
                            value={formatPhoneDisplay(clientPhone)}
                            onChange={e => handlePhoneChange(e.target.value)}
                            placeholder="(555) 123-4567"
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--owner-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--owner-accent)]"
                          />
                        </div>

                        <div>
                          <label htmlFor="walkin-client-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                            <User className="mr-1.5 inline-block size-4" />
                            Client Name (optional)
                          </label>
                          <input
                            id="walkin-client-name"
                            type="text"
                            value={clientName}
                            onChange={e => setClientName(e.target.value)}
                            placeholder="Jane Doe"
                            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--owner-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--owner-accent)]"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-5 py-4">
          {step === 'services' && (
            <div className="space-y-3">
              {selectedServices.length > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">
                    {selectedServices.length}
                    {' '}
                    selected •
                    {formatDuration(totalDuration)}
                  </span>
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(totalPrice)}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={handleServicesNext}
                disabled={selectedServiceIds.length === 0 || loading || !timeZone}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--owner-accent)] px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--owner-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {technicians.length === 1 ? 'Choose a time' : 'Choose technician'}
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}

          {step === 'confirm' && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || clientPhone.length !== 10}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--owner-accent)] px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--owner-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Booking...
                    </>
                  )
                : (
                    <>
                      <Check className="size-5" />
                      Book Walk-in Now
                    </>
                  )}
            </button>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
