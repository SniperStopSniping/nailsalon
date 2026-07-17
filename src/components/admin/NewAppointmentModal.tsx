'use client';

/**
 * NewAppointmentModal Component
 *
 * Form to create a new appointment from admin dashboard.
 * Features:
 * - Date & time selection
 * - Client phone & name input
 * - Technician selection (or "Any available")
 * - Service multi-select
 * - Duration & price preview
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Calendar, Check, ChevronDown, Clock, Loader2, Phone, Plus, Search, User, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { notifyAppointmentDataChanged } from '@/libs/dashboardEvents';
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
};

export type GoogleEventSourceStatus = 'available' | 'deleted' | 'inaccessible' | 'converted';

export type GoogleEventPrefill = {
  id: string;
  title: string | null;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  description?: string | null;
  location?: string | null;
  sourceVersion?: string | null;
  suggestedClient?: { fullName: string | null; phone: string; email: string | null } | null;
  suggestedService?: { id: string; price: number } | null;
  isReadOnly?: boolean;
};

type NewAppointmentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  preselectedDate?: Date;
  googleEventPrefill?: GoogleEventPrefill | null;
  googleEventSourceStatus?: GoogleEventSourceStatus;
  onRefreshGoogleEvent?: () => void;
  clientPrefill?: {
    name: string | null;
    phone: string;
    email: string | null;
    serviceId?: string | null;
    technicianId?: string | null;
  } | null;
};

// Helper functions
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDateForInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function googleEventFingerprint(event: GoogleEventPrefill): string {
  return JSON.stringify({
    title: event.title,
    startTime: event.startTime,
    endTime: event.endTime ?? null,
    durationMinutes: event.durationMinutes,
    description: event.description ?? null,
    location: event.location ?? null,
    sourceVersion: event.sourceVersion ?? null,
    isReadOnly: Boolean(event.isReadOnly),
  });
}

function createIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `appointment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Generate time slots from 8 AM to 8 PM in 30-minute increments
function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let hour = 8; hour <= 20; hour++) {
    slots.push(`${String(hour).padStart(2, '0')}:00`);
    if (hour < 20) {
      slots.push(`${String(hour).padStart(2, '0')}:30`);
    }
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

export function NewAppointmentModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedDate,
  googleEventPrefill,
  googleEventSourceStatus = 'available',
  onRefreshGoogleEvent,
  clientPrefill,
}: NewAppointmentModalProps) {
  const { salonSlug } = useSalon();

  // Form state
  const [selectedDate, setSelectedDate] = useState<string>(
    preselectedDate ? formatDateForInput(preselectedDate) : formatDateForInput(new Date()),
  );
  const [selectedTime, setSelectedTime] = useState<string>('10:00');
  const [clientPhone, setClientPhone] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [priceOverride, setPriceOverride] = useState('');
  const [durationOverride, setDurationOverride] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);

  // Data state
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [showTechDropdown, setShowTechDropdown] = useState(false);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [submissionSourceStatus, setSubmissionSourceStatus] = useState<GoogleEventSourceStatus | null>(null);

  const activeGoogleSessionIdRef = useRef<string | null>(null);
  const sourceFingerprintRef = useRef<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittingRef = useRef(false);

  const draftKey = salonSlug ? `luster:new-appointment-draft:${salonSlug}` : null;

  useEffect(() => {
    if (!isOpen || !googleEventPrefill) {
      return;
    }
    if (activeGoogleSessionIdRef.current === googleEventPrefill.id) {
      return;
    }
    activeGoogleSessionIdRef.current = googleEventPrefill.id;
    sourceFingerprintRef.current = googleEventFingerprint(googleEventPrefill);
    idempotencyKeyRef.current = createIdempotencyKey();
    const start = new Date(googleEventPrefill.startTime);
    setSelectedDate(formatDateForInput(start));
    setSelectedTime(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`);
    setClientName(googleEventPrefill.suggestedClient?.fullName || '');
    setClientPhone((googleEventPrefill.suggestedClient?.phone || '').replace(/\D/g, '').slice(-10));
    setClientEmail(googleEventPrefill.suggestedClient?.email || '');
    setSelectedServiceIds(googleEventPrefill.suggestedService ? [googleEventPrefill.suggestedService.id] : []);
    setPriceOverride(googleEventPrefill.suggestedService ? String(googleEventPrefill.suggestedService.price / 100) : '');
    setDurationOverride(String(googleEventPrefill.durationMinutes));
    setNotes('');
    setSourceChanged(false);
    setSubmissionSourceStatus(null);
    setSubmitFailed(false);
  }, [googleEventPrefill, isOpen]);

  useEffect(() => {
    if (!isOpen || !googleEventPrefill || activeGoogleSessionIdRef.current !== googleEventPrefill.id) {
      return;
    }
    const nextFingerprint = googleEventFingerprint(googleEventPrefill);
    if (sourceFingerprintRef.current && sourceFingerprintRef.current !== nextFingerprint) {
      setSourceChanged(true);
    }
  }, [googleEventPrefill, isOpen]);

  useEffect(() => {
    if (isOpen && !idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createIdempotencyKey();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !clientPrefill) {
      return;
    }
    setClientName(clientPrefill.name || '');
    setClientPhone(clientPrefill.phone.replace(/\D/g, '').slice(-10));
    setClientEmail(clientPrefill.email || '');
    setSelectedTechnicianId(clientPrefill.technicianId || null);
    setSelectedServiceIds(clientPrefill.serviceId ? [clientPrefill.serviceId] : []);
  }, [clientPrefill, isOpen]);

  // Fetch technicians and services
  const fetchData = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch technicians and services in parallel
      const [techRes, servicesRes] = await Promise.all([
        fetch(`/api/admin/technicians?salonSlug=${salonSlug}&status=active`),
        fetch(`/api/salon/services?salonSlug=${salonSlug}`),
      ]);

      if (!techRes.ok || !servicesRes.ok) {
        throw new Error('Failed to load data');
      }

      const [techData, servicesData] = await Promise.all([
        techRes.json(),
        servicesRes.json(),
      ]);

      setTechnicians(techData.data?.technicians || []);
      setServices(servicesData.data?.services || []);
    } catch {
      setError('Failed to load form data');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

  // Preserve unfinished work only for this browser tab. Session storage avoids
  // keeping client contact information in long-lived local storage.
  useEffect(() => {
    if (!isOpen) {
      setDraftHydrated(false);
      setDraftRestored(false);
      return;
    }

    if (!draftKey || googleEventPrefill || clientPrefill) {
      setDraftHydrated(true);
      return;
    }

    try {
      const rawDraft = window.sessionStorage.getItem(draftKey);
      if (rawDraft) {
        const draft = JSON.parse(rawDraft) as {
          expiresAt?: number;
          selectedDate?: string;
          selectedTime?: string;
          clientPhone?: string;
          clientName?: string;
          clientEmail?: string;
          selectedTechnicianId?: string | null;
          selectedServiceIds?: string[];
        };
        if ((draft.expiresAt || 0) > Date.now()) {
          setSelectedDate(draft.selectedDate || formatDateForInput(new Date()));
          setSelectedTime(draft.selectedTime || '10:00');
          setClientPhone(draft.clientPhone || '');
          setClientName(draft.clientName || '');
          setClientEmail(draft.clientEmail || '');
          setSelectedTechnicianId(draft.selectedTechnicianId || null);
          setSelectedServiceIds(Array.isArray(draft.selectedServiceIds) ? draft.selectedServiceIds : []);
          setDraftRestored(true);
        } else {
          window.sessionStorage.removeItem(draftKey);
        }
      }
    } catch {
      window.sessionStorage.removeItem(draftKey);
    } finally {
      setDraftHydrated(true);
    }
  }, [clientPrefill, draftKey, googleEventPrefill, isOpen]);

  useEffect(() => {
    if (!isOpen || !draftHydrated || !draftKey || googleEventPrefill || clientPrefill) {
      return;
    }
    window.sessionStorage.setItem(draftKey, JSON.stringify({
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      selectedDate,
      selectedTime,
      clientPhone,
      clientName,
      clientEmail,
      selectedTechnicianId,
      selectedServiceIds,
    }));
  }, [clientEmail, clientName, clientPhone, clientPrefill, draftHydrated, draftKey, googleEventPrefill, isOpen, selectedDate, selectedServiceIds, selectedTechnicianId, selectedTime]);

  // Reset form when closing
  useEffect(() => {
    if (!isOpen) {
      setClientPhone('');
      setClientName('');
      setClientEmail('');
      setPriceOverride('');
      setDurationOverride('');
      setNotes('');
      setSelectedTechnicianId(null);
      setSelectedServiceIds([]);
      setError(null);
      setServiceSearch('');
      setSourceChanged(false);
      setSubmitFailed(false);
      setSubmissionSourceStatus(null);
      activeGoogleSessionIdRef.current = null;
      sourceFingerprintRef.current = null;
      idempotencyKeyRef.current = null;
      submittingRef.current = false;
    }
  }, [isOpen]);

  // Update selected date when preselectedDate changes
  useEffect(() => {
    if (preselectedDate) {
      setSelectedDate(formatDateForInput(preselectedDate));
    }
  }, [preselectedDate]);

  // Calculate totals
  const selectedServices = services.filter(s => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);

  // Filter services by search
  const filteredServices = services.filter(s =>
    s.name.toLowerCase().includes(serviceSearch.toLowerCase())
    || s.category?.toLowerCase().includes(serviceSearch.toLowerCase()),
  );

  // Group services by category
  const servicesByCategory = filteredServices.reduce((acc, service) => {
    const category = service.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(service);
    return acc;
  }, {} as Record<string, Service[]>);

  // Handle service toggle
  const toggleService = (serviceId: string) => {
    setSelectedServiceIds(prev =>
      prev.includes(serviceId)
        ? prev.filter(id => id !== serviceId)
        : [...prev, serviceId],
    );
  };

  // Format phone as user types
  const handlePhoneChange = (value: string) => {
    // Remove non-digits
    const digits = value.replace(/\D/g, '');
    // Limit to 10 digits
    setClientPhone(digits.slice(0, 10));
  };

  // Format phone for display
  const formatPhoneDisplay = (phone: string): string => {
    if (phone.length <= 3) {
      return phone;
    }
    if (phone.length <= 6) {
      return `(${phone.slice(0, 3)}) ${phone.slice(3)}`;
    }
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (submittingRef.current) {
      return;
    }

    // Validation
    if (!clientPhone || clientPhone.length !== 10) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }
    if (selectedServiceIds.length === 0) {
      setError('Please select at least one service');
      return;
    }
    const parsedDurationOverride = Number(durationOverride);
    if (googleEventPrefill && (!Number.isInteger(parsedDurationOverride) || parsedDurationOverride < 1 || parsedDurationOverride > 1440)) {
      setError('Please enter a duration between 1 and 1440 minutes');
      return;
    }

    if (googleEventPrefill && (submissionSourceStatus || googleEventSourceStatus) !== 'available') {
      return;
    }

    try {
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);
      setSubmitFailed(false);

      // Build start time ISO string
      const [year, month, day] = selectedDate.split('-').map(Number);
      const [hours, minutes] = selectedTime.split(':').map(Number);
      const startTime = new Date(year!, month! - 1, day, hours, minutes);
      const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey();
      idempotencyKeyRef.current = idempotencyKey;

      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          salonSlug,
          serviceIds: selectedServiceIds,
          technicianId: selectedTechnicianId,
          clientPhone,
          clientName: clientName || undefined,
          clientEmail: clientEmail || undefined,
          startTime: startTime.toISOString(),
          googleEventReviewId: googleEventPrefill?.id,
          durationMinutesOverride: googleEventPrefill ? parsedDurationOverride : undefined,
          notes: googleEventPrefill ? notes.trim() || undefined : undefined,
          priceCentsOverride: googleEventPrefill && priceOverride !== ''
            ? Math.round(Number(priceOverride) * 100)
            : undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.error?.code === 'GOOGLE_EVENT_NOT_FOUND') {
          setSubmissionSourceStatus('inaccessible');
        } else if (result.error?.code === 'GOOGLE_EVENT_ALREADY_CONVERTED') {
          setSubmissionSourceStatus('converted');
        } else if (result.error?.code === 'GOOGLE_EVENT_TIME_CHANGED') {
          setSourceChanged(true);
          onRefreshGoogleEvent?.();
        }
        throw new Error(result.error?.message || 'Failed to create appointment');
      }

      // Success
      if (draftKey) {
        window.sessionStorage.removeItem(draftKey);
      }
      notifyAppointmentDataChanged();
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create appointment');
      setSubmitFailed(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const applyLatestGoogleTiming = () => {
    if (!googleEventPrefill) {
      return;
    }
    const start = new Date(googleEventPrefill.startTime);
    setSelectedDate(formatDateForInput(start));
    setSelectedTime(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`);
    setDurationOverride(String(googleEventPrefill.durationMinutes));
    sourceFingerprintRef.current = googleEventFingerprint(googleEventPrefill);
    setSourceChanged(false);
    setError(null);
  };

  const selectedTechnician = technicians.find(t => t.id === selectedTechnicianId);
  const effectiveSourceStatus = submissionSourceStatus ?? googleEventSourceStatus;

  if (!isOpen) {
    return null;
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            data-testid="appointment-modal-backdrop"
            onClick={googleEventPrefill ? undefined : onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 inset-y-[10%] z-50 mx-auto flex max-w-lg touch-pan-y flex-col overflow-hidden overscroll-contain rounded-2xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-appointment-modal-title"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
              <div>
                <h2 id="new-appointment-modal-title" className="text-lg font-semibold text-gray-900">{googleEventPrefill ? 'Convert Google Event' : 'New Appointment'}</h2>
                {googleEventPrefill && (
                  <p className="text-xs text-gray-500">
                    {googleEventPrefill.title || 'Google Calendar event'}
                    {' '}
                    ·
                    {' '}
                    {googleEventPrefill.durationMinutes}
                    {' '}
                    min
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                className="flex size-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
              >
                <X className="size-5 text-gray-600" />
              </button>
            </div>

            {/* Content — flex sizing, so a taller header (e.g. Google-event
                prefill subtitle) can never clip the body or footer. */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-white p-5">
              {loading
                ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="size-8 animate-spin text-gray-400" />
                    </div>
                  )
                : (
                    <div className="space-y-6">
                      {/* Error Message */}
                      {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                          <p className="text-sm text-red-700">{error}</p>
                        </div>
                      )}

                      {googleEventPrefill && effectiveSourceStatus !== 'available' && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3" role="alert" data-testid="google-event-unavailable">
                          <p className="text-sm font-semibold text-amber-900">
                            {effectiveSourceStatus === 'converted'
                              ? 'This Google event was already converted in another session.'
                              : effectiveSourceStatus === 'deleted'
                                ? 'This Google event was deleted while you were editing.'
                                : 'This Google event is no longer accessible.'}
                          </p>
                          <p className="mt-1 text-xs text-amber-800">Your entries are still here. Acknowledge this message when you are ready to close them.</p>
                          <button type="button" onClick={onClose} className="mt-3 rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white">
                            Acknowledge and close
                          </button>
                        </div>
                      )}

                      {googleEventPrefill && sourceChanged && effectiveSourceStatus === 'available' && (
                        <div className="rounded-lg border border-blue-300 bg-blue-50 p-3" role="status" data-testid="google-event-changed-warning">
                          <p className="text-sm font-semibold text-blue-900">Google changed this event while you were editing.</p>
                          <p className="mt-1 text-xs text-blue-800">
                            Latest timing:
                            {' '}
                            {new Date(googleEventPrefill.startTime).toLocaleString()}
                            {' · '}
                            {googleEventPrefill.durationMinutes}
                            {' min. Your client, service, price, and notes were not changed.'}
                          </p>
                          <button type="button" onClick={applyLatestGoogleTiming} className="mt-3 rounded-lg bg-blue-800 px-3 py-2 text-xs font-semibold text-white">
                            Use latest Google timing
                          </button>
                        </div>
                      )}

                      {draftRestored && !error && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                          Your saved appointment draft was restored.
                        </div>
                      )}

                      {/* Date & Time */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="appointment-date" className="mb-1.5 block text-sm font-medium text-gray-700">
                            <Calendar className="mr-1.5 inline-block size-4" />
                            Date
                          </label>
                          <input
                            id="appointment-date"
                            type="date"
                            value={selectedDate}
                            onChange={e => setSelectedDate(e.target.value)}
                            min={formatDateForInput(new Date())}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div className="relative">
                          <p className="mb-1.5 block text-sm font-medium text-gray-700">
                            <Clock className="mr-1.5 inline-block size-4" />
                            Time
                          </p>
                          <button
                            type="button"
                            aria-label="Appointment time"
                            onClick={() => setShowTimeDropdown(!showTimeDropdown)}
                            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 transition-colors hover:bg-gray-50"
                          >
                            <span>{selectedTime}</span>
                            <ChevronDown className="size-4 text-gray-400" />
                          </button>

                          {showTimeDropdown && (
                            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                              {TIME_SLOTS.map(time => (
                                <button
                                  key={time}
                                  type="button"
                                  onClick={() => {
                                    setSelectedTime(time);
                                    setShowTimeDropdown(false);
                                  }}
                                  className={`
                                w-full px-3 py-2 text-left text-sm transition-colors
                                ${time === selectedTime ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}
                              `}
                                >
                                  {time}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <label htmlFor="new-appt-client-email" className="mb-1.5 block text-sm font-medium text-gray-700">Email (optional)</label>
                          <input
                            id="new-appt-client-email"
                            type="email"
                            value={clientEmail}
                            onChange={e => setClientEmail(e.target.value)}
                            placeholder="client@example.com"
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      {/* Client Info */}
                      <div className="space-y-4">
                        <div>
                          <label htmlFor="new-appt-phone" className="mb-1.5 block text-sm font-medium text-gray-700">
                            <Phone className="mr-1.5 inline-block size-4" />
                            Phone Number *
                          </label>
                          <input
                            id="new-appt-phone"
                            type="tel"
                            value={formatPhoneDisplay(clientPhone)}
                            onChange={e => handlePhoneChange(e.target.value)}
                            placeholder="(555) 123-4567"
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label htmlFor="new-appt-client-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                            <User className="mr-1.5 inline-block size-4" />
                            Client Name (optional)
                          </label>
                          <input
                            id="new-appt-client-name"
                            type="text"
                            value={clientName}
                            onChange={e => setClientName(e.target.value)}
                            placeholder="Jane Doe"
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                      {googleEventPrefill && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label htmlFor="google-event-price" className="mb-1.5 block text-sm font-medium text-gray-700">Appointment price (CAD $)</label>
                              <input
                                id="google-event-price"
                                type="number"
                                min="0"
                                step="0.01"
                                value={priceOverride}
                                onChange={event => setPriceOverride(event.target.value)}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label htmlFor="google-event-duration" className="mb-1.5 block text-sm font-medium text-gray-700">Duration (minutes)</label>
                              <input
                                id="google-event-duration"
                                type="number"
                                min="1"
                                max="1440"
                                step="1"
                                value={durationOverride}
                                onChange={event => setDurationOverride(event.target.value)}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                          <div>
                            <label htmlFor="google-event-notes" className="mb-1.5 block text-sm font-medium text-gray-700">Notes (optional)</label>
                            <textarea
                              id="google-event-notes"
                              value={notes}
                              maxLength={2000}
                              rows={3}
                              onChange={event => setNotes(event.target.value)}
                              placeholder="Private appointment notes"
                              className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          {googleEventPrefill.isReadOnly && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Google event is read-only. Time changes continue to come from Google.</p>}
                        </div>
                      )}

                      {/* Technician Selection */}
                      <div className="relative">
                        <p className="mb-1.5 block text-sm font-medium text-gray-700">
                          Technician
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowTechDropdown(!showTechDropdown)}
                          className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 transition-colors hover:bg-gray-50"
                        >
                          <span className="flex items-center gap-2">
                            {selectedTechnician
                              ? (
                                  <>
                                    <div className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-[10px] font-bold text-white">
                                      {selectedTechnician.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                    </div>
                                    {selectedTechnician.name}
                                  </>
                                )
                              : (
                                  'Any available technician'
                                )}
                          </span>
                          <ChevronDown className="size-4 text-gray-400" />
                        </button>

                        {showTechDropdown && (
                          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTechnicianId(null);
                                setShowTechDropdown(false);
                              }}
                              className={`
                            w-full px-3 py-2.5 text-left text-sm transition-colors
                            ${!selectedTechnicianId ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}
                          `}
                            >
                              Any available technician
                            </button>
                            {technicians.map(tech => (
                              <button
                                key={tech.id}
                                type="button"
                                onClick={() => {
                                  setSelectedTechnicianId(tech.id);
                                  setShowTechDropdown(false);
                                }}
                                className={`
                              flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors
                              ${tech.id === selectedTechnicianId ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}
                            `}
                              >
                                <div className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-[10px] font-bold text-white">
                                  {tech.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                {tech.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Services Selection */}
                      <div>
                        <p className="mb-1.5 block text-sm font-medium text-gray-700">
                          Services *
                        </p>

                        {/* Search */}
                        <div className="relative mb-3">
                          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={serviceSearch}
                            onChange={e => setServiceSearch(e.target.value)}
                            placeholder="Search services..."
                            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        {/* Service List */}
                        <div className="max-h-48 space-y-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3">
                          {Object.entries(servicesByCategory).map(([category, categoryServices]) => (
                            <div key={category}>
                              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                {category}
                              </h4>
                              <div className="space-y-1">
                                {categoryServices.map((service) => {
                                  const isSelected = selectedServiceIds.includes(service.id);
                                  return (
                                    <button
                                      key={service.id}
                                      type="button"
                                      aria-pressed={isSelected}
                                      onClick={() => toggleService(service.id)}
                                      className={`
                                    flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-all
                                    ${isSelected
                                      ? 'bg-blue-50 ring-1 ring-blue-200'
                                      : 'hover:bg-gray-50'
                                    }
                                  `}
                                    >
                                      <div className="flex items-center gap-2">
                                        <div className={`
                                      flex size-5 items-center justify-center rounded-md border transition-colors
                                      ${isSelected
                                      ? 'border-blue-500 bg-blue-500 text-white'
                                      : 'border-gray-300'
                                    }
                                    `}
                                        >
                                          {isSelected && <Check className="size-3" />}
                                        </div>
                                        <span className={isSelected ? 'font-medium text-blue-900' : 'text-gray-700'}>
                                          {service.name}
                                        </span>
                                      </div>
                                      <div className="text-right">
                                        <span className="font-medium text-gray-900">
                                          {formatCurrency(service.price)}
                                        </span>
                                        <span className="ml-2 text-xs text-gray-500">
                                          {formatDuration(service.durationMinutes)}
                                        </span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}

                          {filteredServices.length === 0 && (
                            <p className="py-4 text-center text-sm text-gray-500">
                              No services found
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-5 py-4">
              {/* Summary */}
              {selectedServices.length > 0 && (
                <div className="mb-4 flex items-center justify-between text-sm">
                  <div className="text-gray-600">
                    {selectedServices.length}
                    {' '}
                    service
                    {selectedServices.length !== 1 ? 's' : ''}
                    {' '}
                    ·
                    {formatDuration(googleEventPrefill && Number(durationOverride) > 0 ? Number(durationOverride) : totalDuration)}
                  </div>
                  <div className="text-lg font-semibold text-gray-900">
                    {formatCurrency(totalPrice)}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || selectedServiceIds.length === 0 || clientPhone.length !== 10 || (Boolean(googleEventPrefill) && effectiveSourceStatus !== 'available')}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#007AFF] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#0066CC] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting
                    ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Creating...
                        </>
                      )
                    : (
                        <>
                          <Plus className="size-4" />
                          {submitFailed && googleEventPrefill ? 'Retry conversion' : 'Create Appointment'}
                        </>
                      )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
