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

import './new-appointment.css';

import { ArrowDown, Check, ChevronDown, Loader2, Plus, Search, X } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppointmentClientPicker } from '@/components/admin/AppointmentClientPicker';
import { type AppointmentOpening, AppointmentOpenings, type OpeningQuote } from '@/components/admin/AppointmentOpenings';
import { DialogShell } from '@/components/ui/dialog-shell';
import { useCustomerViewport } from '@/hooks/useCustomerViewport';
import { BOOKING_CATEGORY_META, resolveVisibleBookingCategory } from '@/libs/bookingCategory';
import type { SelectedAddOnParam } from '@/libs/bookingParams';
import type { CalendarOpening } from '@/libs/calendarOpenings';
import {
  buildTimePickerSlots,
  type CalendarSchedule,
  EMPTY_CALENDAR_SCHEDULE,
} from '@/libs/calendarSchedule';
import { notifyAppointmentDataChanged } from '@/libs/dashboardEvents';
import { parseGoogleEventTitle } from '@/libs/googleEventAutofill';
import { normalizePhone } from '@/libs/phone';
import { addDaysToDateKey, getDateKeyInTimeZone } from '@/libs/timeZone';
import type { BookingCategory, WeeklySchedule } from '@/models/Schema';
import { useSalon } from '@/providers/SalonProvider';
import type { AddOnResponse } from '@/types/admin';
import { formatDuration } from '@/utils/Helpers';

// Types
type Technician = {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Used to bound the time picker to the hours this technician works. */
  weeklySchedule?: WeeklySchedule | null;
};

type Service = {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  category: string | null;
  bookingCategory?: BookingCategory | null;
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
  entryPoint?: 'appointment' | 'walk-in';
  onClose: () => void;
  onSuccess?: (date: string) => void;
  /**
   * Active salon from the surface that opened the modal. The owner dashboard
   * resolves its salon client-side, after the tenant cookie the SalonProvider
   * reads has been set, so the prop is the reliable source and the provider is
   * only a fallback for surfaces that still rely on it.
   */
  salonSlug?: string | null;
  preselectedDate?: Date;
  calendarOpening?: CalendarOpening | null;
  findOpeningFrom?: string | null;
  openingTechnicianId?: string | null;
  googleEventPrefill?: GoogleEventPrefill | null;
  googleEventSourceStatus?: GoogleEventSourceStatus;
  onRefreshGoogleEvent?: () => void;
  clientPrefill?: {
    name: string | null;
    phone: string;
    email: string | null;
    serviceId?: string | null;
    serviceIds?: string[];
    technicianId?: string | null;
    nextVisitOffer?: { campaignToken: string; deadlineDate: string; discountType: 'percent' | 'fixed'; value: number };
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

/**
 * Start times the picker offers.
 *
 * The range comes from the selected technician's own weekly schedule for the
 * chosen day (the union of the team's when none is selected), intersected with
 * the salon's opening hours — the same authorities the booking engine enforces.
 * The old fixed 08:00–20:00 list could not reach the last bookable hour of a
 * technician working to 21:00 and offered 08:00 starts nobody works
 * (AG-w2-calendar-writes-09).
 */
const FALLBACK_TIME_BOUNDS = { startHour: 8, endHour: 20 };

/** Shown when no salon could be resolved, instead of an endless spinner. */
const MISSING_SALON_MESSAGE = 'Choose a salon to continue';

export function NewAppointmentModal({
  isOpen,
  entryPoint = 'appointment',
  onClose,
  onSuccess,
  salonSlug: salonSlugProp,
  preselectedDate,
  calendarOpening,
  findOpeningFrom,
  openingTechnicianId,
  googleEventPrefill,
  googleEventSourceStatus = 'available',
  onRefreshGoogleEvent,
  clientPrefill,
}: NewAppointmentModalProps) {
  const { salonSlug: contextSalonSlug, bookingTimeZone } = useSalon();
  const salonSlug = salonSlugProp?.trim() || contextSalonSlug;
  const viewport = useCustomerViewport();
  const today = getDateKeyInTimeZone(new Date(), bookingTimeZone);
  const tomorrow = addDaysToDateKey(today, 1);
  const guidedBooking = !googleEventPrefill && !findOpeningFrom;
  const title = googleEventPrefill ? 'Convert Google Event' : findOpeningFrom ? 'Find Opening' : entryPoint === 'walk-in' ? 'Quick Walk-in' : 'New Appointment';

  // Form state
  const [selectedDate, setSelectedDate] = useState<string>(
    preselectedDate ? formatDateForInput(preselectedDate) : today,
  );
  const [selectedTime, setSelectedTime] = useState<string>('10:00');
  const [verifiedOpening, setVerifiedOpening] = useState<{ scope: string; time: string; startTime: string; quote?: OpeningQuote } | null>(null);
  const [openingRefresh, setOpeningRefresh] = useState(0);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [extras, setExtras] = useState<{ salonSlug: string; items: AddOnResponse[] } | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [extrasError, setExtrasError] = useState(false);
  const [selectedAddOns, setSelectedAddOns] = useState<SelectedAddOnParam[]>([]);
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [showTechDropdown, setShowTechDropdown] = useState(false);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const [showAllServices, setShowAllServices] = useState(false);
  const [showClientSearch, setShowClientSearch] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [submissionSourceStatus, setSubmissionSourceStatus] = useState<GoogleEventSourceStatus | null>(null);

  const activeGoogleSessionIdRef = useRef<string | null>(null);
  const sourceFingerprintRef = useRef<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittedPayloadRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const pendingTechDefaultRef = useRef(false);
  const pendingGoogleServiceNameRef = useRef<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const servicesHeadingRef = useRef<HTMLHeadingElement>(null);
  const timeHeadingRef = useRef<HTMLHeadingElement>(null);
  const clientHeadingRef = useRef<HTMLHeadingElement>(null);
  const clientSectionRef = useRef<HTMLElement>(null);
  const clientPhoneRef = useRef<HTMLInputElement>(null);
  const technicianDefaultAppliedRef = useRef(false);

  const draftKey = salonSlug ? `luster:${entryPoint === 'walk-in' ? 'walk-in' : 'new-appointment'}-draft:${salonSlug}` : null;

  useEffect(() => {
    const active = document.activeElement;
    if (isOpen && viewport.keyboardOpen && active instanceof HTMLElement && bodyRef.current?.contains(active)) {
      active.scrollIntoView?.({ block: 'nearest' });
    }
  }, [isOpen, viewport.height, viewport.keyboardOpen]);

  useEffect(() => {
    if (isOpen && !loading && error && errorRef.current) {
      errorRef.current.focus({ preventScroll: true });
      errorRef.current.scrollIntoView?.({ block: 'nearest' });
    }
  }, [error, isOpen, loading]);

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
    submittedPayloadRef.current = null;
    const start = new Date(googleEventPrefill.startTime);
    const parsedTitle = parseGoogleEventTitle(googleEventPrefill.title);
    setSelectedDate(formatDateForInput(start));
    setSelectedTime(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`);
    setClientName(googleEventPrefill.suggestedClient?.fullName || parsedTitle.clientName || '');
    setClientPhone(normalizePhone(googleEventPrefill.suggestedClient?.phone || ''));
    setClientEmail(googleEventPrefill.suggestedClient?.email || '');
    setSelectedServiceIds(googleEventPrefill.suggestedService ? [googleEventPrefill.suggestedService.id] : []);
    pendingGoogleServiceNameRef.current = googleEventPrefill.suggestedService ? null : parsedTitle.serviceName;
    setPriceOverride(googleEventPrefill.suggestedService ? String(googleEventPrefill.suggestedService.price / 100) : '');
    setDurationOverride(String(googleEventPrefill.durationMinutes));
    setNotes(googleEventPrefill.description?.trim().slice(0, 2000) || '');
    setSourceChanged(false);
    setSubmissionSourceStatus(null);
    setSubmitFailed(false);
    // Conversions default to the salon's primary technician once the list
    // loads (still editable) — a Google event has no technician of its own.
    pendingTechDefaultRef.current = true;
  }, [googleEventPrefill, isOpen]);

  useEffect(() => {
    const candidate = pendingGoogleServiceNameRef.current;
    if (!isOpen || !googleEventPrefill || !candidate || services.length === 0) {
      return;
    }
    const normalizedCandidate = candidate.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const matches = services.filter((service) => {
      const normalizedService = service.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      return normalizedCandidate === normalizedService
        || normalizedCandidate.includes(normalizedService)
        || normalizedService.includes(normalizedCandidate);
    });
    pendingGoogleServiceNameRef.current = null;
    if (matches.length === 1) {
      setSelectedServiceIds([matches[0]!.id]);
      setPriceOverride(String(matches[0]!.price / 100));
    }
  }, [googleEventPrefill, isOpen, services]);

  useEffect(() => {
    if (!isOpen || !googleEventPrefill || !pendingTechDefaultRef.current || technicians.length === 0) {
      return;
    }
    pendingTechDefaultRef.current = false;
    setSelectedTechnicianId(current => current ?? technicians[0]?.id ?? null);
  }, [googleEventPrefill, isOpen, technicians]);

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
    setClientPhone(normalizePhone(clientPrefill.phone));
    setClientEmail(clientPrefill.email || '');
    setSelectedTechnicianId(clientPrefill.technicianId || null);
    setSelectedServiceIds(clientPrefill.serviceIds ?? (clientPrefill.serviceId ? [clientPrefill.serviceId] : []));
  }, [clientPrefill, isOpen]);

  // Fetch technicians and services
  const fetchData = useCallback(async () => {
    if (!salonSlug) {
      // No tenant to load against: surface it instead of spinning forever.
      setTechnicians([]);
      setServices([]);
      setError(MISSING_SALON_MESSAGE);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setLoadFailed(false);
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
      setLoadFailed(true);
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

  useEffect(() => {
    if (!isOpen || loading || loadFailed || !draftHydrated || technicianDefaultAppliedRef.current) {
      return;
    }
    technicianDefaultAppliedRef.current = true;
    if (technicians.length === 1) {
      setSelectedTechnicianId(current => current ?? technicians[0]!.id);
    }
  }, [draftHydrated, isOpen, loadFailed, loading, technicians]);

  // Preserve unfinished work only for this browser tab. Session storage avoids
  // keeping client contact information in long-lived local storage.
  useEffect(() => {
    if (!isOpen) {
      setDraftHydrated(false);
      setDraftRestored(false);
      return;
    }

    if (!draftKey || googleEventPrefill || clientPrefill || calendarOpening || findOpeningFrom) {
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
          setSelectedDate(draft.selectedDate && draft.selectedDate >= today ? draft.selectedDate : today);
          setSelectedTime(draft.selectedTime || '10:00');
          setClientPhone(draft.clientPhone || '');
          setClientName(draft.clientName || '');
          setClientEmail(draft.clientEmail || '');
          setSelectedTechnicianId(draft.selectedTechnicianId || null);
          // A saved "Any available" choice is deliberate, even for a solo salon.
          technicianDefaultAppliedRef.current = Object.hasOwn(draft, 'selectedTechnicianId');
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
  }, [calendarOpening, clientPrefill, draftKey, findOpeningFrom, googleEventPrefill, isOpen, today]);

  useEffect(() => {
    if (!isOpen || !draftHydrated || !draftKey || googleEventPrefill || clientPrefill || calendarOpening || findOpeningFrom) {
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
  }, [calendarOpening, clientEmail, clientName, clientPhone, clientPrefill, draftHydrated, draftKey, findOpeningFrom, googleEventPrefill, isOpen, selectedDate, selectedServiceIds, selectedTechnicianId, selectedTime]);

  // Reset form when closing
  useEffect(() => {
    if (!isOpen) {
      setVerifiedOpening(null);
      setSelectedDate(today);
      setSelectedTime('10:00');
      setOpeningRefresh(0);
      setSelectedAddOns([]);
      setExtrasOpen(false);
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
      setShowAllServices(false);
      setShowClientSearch(false);
      setShowTechDropdown(false);
      setShowTimeDropdown(false);
      technicianDefaultAppliedRef.current = false;
      setSourceChanged(false);
      setSubmitFailed(false);
      setSubmissionSourceStatus(null);
      activeGoogleSessionIdRef.current = null;
      sourceFingerprintRef.current = null;
      idempotencyKeyRef.current = null;
      submittedPayloadRef.current = null;
      submittingRef.current = false;
      pendingGoogleServiceNameRef.current = null;
    }
  }, [isOpen, today]);

  // Update selected date when preselectedDate changes
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (calendarOpening) {
      setSelectedDate(calendarOpening.date);
      setSelectedTime(calendarOpening.time);
      setSelectedTechnicianId(calendarOpening.technicianId);
    } else if (findOpeningFrom) {
      setSelectedDate(findOpeningFrom);
      setSelectedTechnicianId(openingTechnicianId ?? null);
    } else if (preselectedDate) {
      setSelectedDate(formatDateForInput(preselectedDate));
    }
  }, [calendarOpening, findOpeningFrom, isOpen, openingTechnicianId, preselectedDate]);

  const baseServiceId = !googleEventPrefill && selectedServiceIds.length === 1 ? selectedServiceIds[0] : undefined;
  const compatibleExtras = baseServiceId && extras && extras.salonSlug === salonSlug
    ? extras.items.filter(addOn => addOn.isActive && addOn.compatibleServiceIds?.includes(baseServiceId))
    : [];
  const openingScope = JSON.stringify([salonSlug, selectedTechnicianId, selectedServiceIds, selectedAddOns]);
  const chosenOpening = verifiedOpening?.scope === `${openingScope}|${selectedDate}` && verifiedOpening.time === selectedTime
    ? verifiedOpening
    : null;
  const needsOpening = !googleEventPrefill && (!chosenOpening || (selectedAddOns.length > 0 && !chosenOpening.quote));
  const preferredStart = calendarOpening?.date === selectedDate
    && calendarOpening.time === selectedTime.padStart(5, '0')
    && calendarOpening.technicianId === selectedTechnicianId
    ? calendarOpening.startTime
    : undefined;
  function changeDate(date: string) {
    if (date !== selectedDate) {
      setVerifiedOpening(null);
      setSelectedDate(date);
    }
  }

  const selectOpening = useCallback((slot: AppointmentOpening, quote?: OpeningQuote, date = selectedDate) => {
    setSelectedDate(date);
    setSelectedTime(slot.time);
    setVerifiedOpening({ ...slot, scope: `${openingScope}|${date}`, quote });
    if (findOpeningFrom) {
      requestAnimationFrame(() => clientSectionRef.current?.scrollIntoView?.({ block: 'start' }));
    }
  }, [findOpeningFrom, openingScope, selectedDate]);

  const loadExtras = async () => {
    if (!salonSlug || extrasLoading || extras?.salonSlug === salonSlug) {
      return;
    }
    setExtrasError(false);
    setExtrasLoading(true);
    try {
      const response = await fetch(`/api/salon/add-ons?salonSlug=${encodeURIComponent(salonSlug)}`);
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.data?.addOns)) {
        throw new Error('Extras unavailable');
      }
      setExtras({ salonSlug, items: payload.data.addOns });
    } catch {
      setExtrasError(true);
    } finally {
      setExtrasLoading(false);
    }
  };

  // Calculate totals
  const selectedServices = services.filter(s => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);

  // Filter services by search
  const filteredServices = services.filter(s =>
    s.name.toLowerCase().includes(serviceSearch.toLowerCase())
    || s.category?.toLowerCase().includes(serviceSearch.toLowerCase()),
  );
  const visibleServices = serviceSearch.trim() || showAllServices
    ? filteredServices
    : filteredServices.filter((service, index) => index < 4 || selectedServiceIds.includes(service.id));
  const hiddenServiceCount = filteredServices.length - visibleServices.length;

  // Group by the shared visible categories (Manicure / Pedicure / Combos) so
  // staff see the same structure as clients and the owner menu.
  const servicesByCategory = visibleServices.reduce((acc, service) => {
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
    setVerifiedOpening(null);
    setSelectedAddOns([]);
    setSelectedServiceIds(prev =>
      prev.includes(serviceId)
        ? prev.filter(id => id !== serviceId)
        : [...prev, serviceId],
    );
  };

  // Format phone as user types
  const handlePhoneChange = (value: string) => {
    setClientPhone(normalizePhone(value));
  };

  // Format phone for display
  const formatPhoneDisplay = (phone: string): string => {
    if (phone.length > 10) {
      return phone;
    }
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
    if (submittingRef.current || loading || loadFailed || !salonSlug) {
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
    if (needsOpening) {
      setError('Choose an opening that fits the selected services.');
      return;
    }
    if (!selectedDate || !selectedTime) {
      setError('Choose an appointment date and time');
      return;
    }
    if (googleEventPrefill && priceOverride !== '' && (!Number.isFinite(Number(priceOverride)) || Number(priceOverride) < 0)) {
      setError('Please enter a valid appointment price');
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

    let serverFailureMessage: string | null = null;
    try {
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);
      setSubmitFailed(false);

      // Build start time ISO string
      const [year, month, day] = selectedDate.split('-').map(Number);
      const [hours, minutes] = selectedTime.split(':').map(Number);
      const startTime = new Date(year!, month! - 1, day, hours, minutes);
      const requestBody = JSON.stringify({
        salonSlug,
        ...(selectedAddOns.length > 0
          ? { baseServiceId, selectedAddOns }
          : { serviceIds: selectedServiceIds }),
        technicianId: selectedTechnicianId,
        clientPhone,
        clientName: clientName || undefined,
        clientEmail: clientEmail || undefined,
        startTime: chosenOpening?.startTime ?? startTime.toISOString(),
        googleEventReviewId: googleEventPrefill?.id,
        durationMinutesOverride: googleEventPrefill ? parsedDurationOverride : undefined,
        notes: googleEventPrefill ? notes.trim() || undefined : undefined,
        priceCentsOverride: googleEventPrefill && priceOverride !== ''
          ? Math.round(Number(priceOverride) * 100)
          : undefined,
        campaignToken: clientPrefill?.nextVisitOffer?.campaignToken,
      });
      // A lost response may follow a committed appointment. Keep the same
      // identity for an unchanged retry so the server can replay its result.
      // An edited request needs a fresh identity to avoid payload-key reuse.
      const payloadChanged = submittedPayloadRef.current !== null && submittedPayloadRef.current !== requestBody;
      const idempotencyKey = payloadChanged ? createIdempotencyKey() : idempotencyKeyRef.current ?? createIdempotencyKey();
      idempotencyKeyRef.current = idempotencyKey;
      submittedPayloadRef.current = requestBody;

      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: requestBody,
      });

      const result = await response.json();

      if (!response.ok) {
        if (!googleEventPrefill && ['TIME_CONFLICT', 'OUTSIDE_SCHEDULE', 'TOO_SOON', 'SLOT_UNAVAILABLE', 'TECHNICIAN_UNAVAILABLE'].includes(result.error?.code)) {
          setVerifiedOpening(null);
          setOpeningRefresh(value => value + 1);
        }
        if (result.error?.code === 'GOOGLE_EVENT_NOT_FOUND') {
          setSubmissionSourceStatus('inaccessible');
        } else if (result.error?.code === 'GOOGLE_EVENT_ALREADY_CONVERTED') {
          setSubmissionSourceStatus('converted');
        } else if (result.error?.code === 'GOOGLE_EVENT_TIME_CHANGED') {
          setSourceChanged(true);
          onRefreshGoogleEvent?.();
        }
        serverFailureMessage = result.error?.message || 'Failed to create appointment';
        throw new Error(serverFailureMessage!);
      }

      // Success
      if (draftKey && !calendarOpening && !findOpeningFrom) {
        window.sessionStorage.removeItem(draftKey);
      }
      notifyAppointmentDataChanged();
      onSuccess?.(selectedDate);
      onClose();
    } catch {
      setError(serverFailureMessage || 'We couldn’t confirm whether the appointment was saved. Retry with the same details to check, or check your calendar before changing them.');
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

  const timeSlotSchedule = useMemo<CalendarSchedule>(() => ({
    ...EMPTY_CALENDAR_SCHEDULE,
    technicians: technicians.map(technician => ({
      id: technician.id,
      name: technician.name,
      weeklySchedule: technician.weeklySchedule ?? null,
    })),
  }), [technicians]);

  const timeSlots = useMemo(() => buildTimePickerSlots({
    schedule: timeSlotSchedule,
    dateKey: selectedDate,
    technicianId: selectedTechnicianId,
    stepMinutes: 30,
    // A prefilled or already-chosen time stays selectable even when it falls
    // outside the schedule, so converting a Google event never silently
    // rewrites the time the owner is looking at.
    alwaysInclude: selectedTime,
    fallback: FALLBACK_TIME_BOUNDS,
  }), [selectedDate, selectedTechnicianId, selectedTime, timeSlotSchedule]);
  const effectiveSourceStatus = submissionSourceStatus ?? googleEventSourceStatus;

  const extrasAwaitingQuote = selectedAddOns.length > 0 && !chosenOpening?.quote;
  const displayedPrice = googleEventPrefill && priceOverride !== '' && Number.isFinite(Number(priceOverride)) && Number(priceOverride) >= 0
    ? Math.round(Number(priceOverride) * 100)
    : chosenOpening?.quote?.serviceSubtotalCents ?? totalPrice;
  const displayedDuration = googleEventPrefill && Number(durationOverride) > 0 ? Number(durationOverride) : chosenOpening?.quote?.durationMinutes ?? totalDuration;
  const [startHour = 0, startMinute = 0] = selectedTime.split(':').map(Number);
  const endMinutes = startHour * 60 + startMinute + displayedDuration;
  const displayedEnd = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}${endMinutes >= 1440 ? ' next day' : ''}`;
  const summaryDate = selectedDate
    ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Choose a date';
  const openings = !googleEventPrefill && salonSlug && selectedServiceIds.length > 0 && selectedDate
    ? (
        <AppointmentOpenings
          salonSlug={salonSlug}
          date={findOpeningFrom || selectedDate}
          searchAhead={Boolean(findOpeningFrom)}
          preferredStart={preferredStart}
          technicianId={selectedTechnicianId}
          serviceIds={selectedServiceIds}
          selectedAddOns={selectedAddOns}
          selectedStart={chosenOpening?.startTime}
          refreshKey={openingRefresh}
          onNextDay={() => changeDate(addDaysToDateKey(selectedDate, 1))}
          onSelect={selectOpening}
        />
      )
    : null;
  const actionUnavailable = loading || loadFailed || !salonSlug || submitting;
  const canSave = selectedServiceIds.length > 0 && clientPhone.length === 10 && Boolean(selectedDate)
    && !needsOpening && (!googleEventPrefill || effectiveSourceStatus === 'available');
  let nextStep: { label: string; headingRef: typeof servicesHeadingRef } | null = null;
  if (guidedBooking && !actionUnavailable) {
    if (selectedServiceIds.length === 0) {
      nextStep = { label: 'Choose a service', headingRef: servicesHeadingRef };
    } else if (needsOpening) {
      nextStep = { label: selectedDate ? 'See available times' : 'Choose a date', headingRef: timeHeadingRef };
    } else if (clientPhone.length !== 10) {
      nextStep = { label: 'Add client details', headingRef: clientHeadingRef };
    }
  }

  function handlePrimaryAction() {
    if (nextStep) {
      const heading = nextStep.headingRef.current;
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView?.({ block: 'start' });
      return;
    }
    void handleSubmit();
  }

  const overlayStyle = viewport.height > 0
    ? {
        'top': viewport.top,
        'height': viewport.height,
        'bottom': 'auto',
        '--nap-viewport-height': `${viewport.height}px`,
      } as CSSProperties
    : undefined;

  if (!isOpen) {
    return null;
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      closeOnBackdrop={!googleEventPrefill}
      closeOnEscape={!googleEventPrefill}
      overlayTestId="appointment-modal-backdrop"
      maxWidthClassName="h-full max-w-4xl sm:h-auto"
      alignClassName="items-end justify-center p-0 sm:items-center sm:p-6"
      overlayStyle={overlayStyle}
      contentClassName="nap-dialog"
    >
      <div className="nap-root" role="dialog" aria-modal="true" aria-labelledby="new-appointment-modal-title">
        <header className="nap-header">
          <div>
            <h2 id="new-appointment-modal-title">{title}</h2>
            {googleEventPrefill && (
              <p>
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
          <button type="button" onClick={onClose} aria-label="Close modal" className="nap-close"><X aria-hidden="true" className="size-5" /></button>
        </header>
        <div ref={bodyRef} className="nap-body" data-testid="new-appointment-body">
          {loading
            ? (
                <div className="flex items-center justify-center gap-3 py-20" role="status">
                  <Loader2 aria-hidden="true" className="size-6 animate-spin" />
                  Loading appointment form…
                </div>
              )
            : (
                <>
                  <div className="nap-notices">
                    {/* Error Message */}
                    {error && (
                      <div ref={errorRef} tabIndex={-1} className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert" data-testid="new-appointment-error">
                        <p className="text-sm text-red-700">{error}</p>
                        {loadFailed && <button type="button" className="nap-link" onClick={() => void fetchData()}>Retry loading</button>}
                      </div>
                    )}

                    {clientPrefill?.nextVisitOffer && (
                      <div data-testid="next-visit-offer-rebook-summary" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                        <div className="font-semibold">Next Visit Offer</div>
                        <p className="mt-1">
                          Your next appointment must take place by
                          {' '}
                          {clientPrefill.nextVisitOffer.deadlineDate}
                          {' '}
                          to save
                          {' '}
                          {clientPrefill.nextVisitOffer.discountType === 'percent'
                            ? `${clientPrefill.nextVisitOffer.value}%`
                            : formatCurrency(clientPrefill.nextVisitOffer.value)}
                          . The final total is confirmed when the appointment is saved.
                        </p>
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
                      <div className="rounded-lg border border-[var(--owner-line)] bg-[var(--owner-blush)] p-3 text-sm text-[var(--owner-accent)]">
                        Your saved appointment draft was restored.
                      </div>
                    )}

                  </div>
                  <div className={findOpeningFrom ? 'nap-grid !grid-cols-1' : 'nap-grid'}>
                    <section className="nap-section" aria-labelledby="appointment-services-heading">
                      <div className="nap-section-heading">
                        <h3 ref={servicesHeadingRef} id="appointment-services-heading" tabIndex={-1}>Services *</h3>
                        {selectedServices.length > 0 && (
                          <span className="nap-selection-count">
                            {selectedServices.length}
                            {' '}
                            selected
                          </span>
                        )}
                      </div>
                      <label className="sr-only" htmlFor="appointment-service-search">Search services</label>
                      <div className="nap-search">
                        <Search aria-hidden="true" />
                        <input id="appointment-service-search" type="search" value={serviceSearch} onChange={event => setServiceSearch(event.target.value)} placeholder="Search services..." />
                      </div>
                      <div id="appointment-services-list">
                        {Object.entries(servicesByCategory).map(([category, categoryServices]) => (
                          <div className="nap-service-group" key={category}>
                            <h4>{BOOKING_CATEGORY_META[category as BookingCategory].label}</h4>
                            {categoryServices.map(service => (
                              <button key={service.id} type="button" className="nap-service" aria-pressed={selectedServiceIds.includes(service.id)} onClick={() => toggleService(service.id)}>
                                <span className="nap-service-check" aria-hidden="true">{selectedServiceIds.includes(service.id) && <Check className="size-3.5" />}</span>
                                <span className="nap-service-copy">
                                  <span className="nap-service-name">{service.name}</span>
                                  <span className="nap-service-meta">{formatDuration(service.durationMinutes)}</span>
                                </span>
                                <span className="nap-service-price">{formatCurrency(service.price)}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                      {baseServiceId && (
                        <div className="mt-3">
                          <button
                            type="button"
                            className="nap-link nap-extras-toggle"
                            aria-expanded={extrasOpen}
                            aria-controls="new-appointment-extras"
                            onClick={() => {
                              setExtrasOpen(!extrasOpen);
                              if (!extrasOpen) {
                                void loadExtras();
                              }
                            }}
                          >
                            Removal &amp; extras
                            {selectedAddOns.length > 0 ? ` (${selectedAddOns.length} selected)` : ''}
                          </button>
                          {extrasOpen && (
                            <div id="new-appointment-extras" className="space-y-2 rounded-xl border border-stone-200 p-3">
                              {extrasLoading && <p role="status">Loading extras…</p>}
                              {extrasError && (
                                <p role="alert">
                                  Couldn’t load extras.
                                  <button type="button" className="nap-link" onClick={() => void loadExtras()}>Try again</button>
                                </p>
                              )}
                              {!extrasLoading && !extrasError && compatibleExtras.length === 0 && <p className="nap-helper">No extras are listed for this service.</p>}
                              {compatibleExtras.map((addOn) => {
                                const quantity = selectedAddOns.find(item => item.addOnId === addOn.id)?.quantity ?? 0;
                                const updateQuantity = (value: number) => {
                                  setVerifiedOpening(null);
                                  setSelectedAddOns(items => [
                                    ...items.filter(item => item.addOnId !== addOn.id),
                                    ...(value ? [{ addOnId: addOn.id, quantity: value }] : []),
                                  ]);
                                };
                                return (
                                  <div key={addOn.id} className="flex flex-wrap items-center justify-between gap-2">
                                    <label className="nap-extras-choice">
                                      <input type="checkbox" checked={quantity > 0} onChange={event => updateQuantity(event.target.checked ? 1 : 0)} />
                                      <span>
                                        {addOn.name}
                                        <span className="nap-helper block">
                                          +
                                          {addOn.durationMinutes}
                                          {' '}
                                          min ·
                                          {' '}
                                          {addOn.manualConfirmationServiceIds?.includes(baseServiceId) ? 'Price to confirm' : formatCurrency(addOn.priceCents)}
                                          {addOn.pricingType === 'per_unit' && ` per ${addOn.unitLabel || 'unit'}`}
                                        </span>
                                      </span>
                                    </label>
                                    {quantity > 0 && addOn.pricingType === 'per_unit' && (addOn.maxQuantity ?? 1) > 1 && (
                                      <select aria-label={`${addOn.name} quantity`} className="min-h-11 rounded-lg border border-stone-300 px-2" value={quantity} onChange={event => updateQuantity(Number(event.target.value))}>
                                        {Array.from({ length: addOn.maxQuantity! }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
                                      </select>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                      {findOpeningFrom && openings}
                      {filteredServices.length === 0 && <p className="nap-helper py-4">{services.length ? 'No services found. Try another name or category.' : 'No services are available. Add a service in your catalog, then reopen this form.'}</p>}
                      {!serviceSearch.trim() && services.length > 4 && (
                        <button type="button" className="nap-link mt-3" aria-expanded={showAllServices} aria-controls="appointment-services-list" onClick={() => setShowAllServices(value => !value)}>
                          {showAllServices ? 'Show fewer services' : hiddenServiceCount ? `Show all ${services.length} services` : 'Show all services'}
                        </button>
                      )}
                    </section>
                    <div className={findOpeningFrom && !chosenOpening ? 'hidden' : 'nap-fields'}>
                      <section className="nap-section" aria-labelledby="appointment-when-heading">
                        <div className="nap-section-heading">
                          <h3 ref={timeHeadingRef} id="appointment-when-heading" tabIndex={-1}>{guidedBooking ? 'Date & time' : 'When & who'}</h3>
                          {guidedBooking && (
                            <div className="nap-quick-dates" role="group" aria-label="Quick dates">
                              <button type="button" aria-pressed={selectedDate === today} onClick={() => changeDate(today)}>Today</button>
                              <button type="button" aria-pressed={selectedDate === tomorrow} onClick={() => changeDate(tomorrow)}>Tomorrow</button>
                            </div>
                          )}
                        </div>
                        <div className="nap-fields">
                          {!findOpeningFrom && (
                            <div className={googleEventPrefill || calendarOpening ? 'nap-date-time' : undefined}>
                              <div>
                                <label htmlFor="appointment-date">Date</label>
                                <input
                                  id="appointment-date"
                                  type="date"
                                  value={selectedDate}
                                  onChange={event => changeDate(event.target.value)}
                                  min={googleEventPrefill ? formatDateForInput(new Date()) : today}
                                />
                              </div>
                              {googleEventPrefill && (
                                <div className="relative">
                                  <span className="nap-field-label" id="appointment-time-label">Time</span>
                                  <button
                                    type="button"
                                    aria-label="Appointment time"
                                    aria-expanded={showTimeDropdown}
                                    aria-controls="appointment-time-options"
                                    className="nap-field-button"
                                    onClick={() => {
                                      setShowTimeDropdown(value => !value);
                                      setShowTechDropdown(false);
                                    }}
                                  >
                                    <span>{selectedTime}</span>
                                    <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
                                  </button>
                                  {showTimeDropdown && (
                                    <div id="appointment-time-options" className="nap-dropdown" aria-labelledby="appointment-time-label">
                                      {timeSlots.map(time => (
                                        <button
                                          key={time}
                                          type="button"
                                          aria-pressed={time === selectedTime}
                                          onClick={() => {
                                            setVerifiedOpening(null);
                                            setSelectedTime(time);
                                            setShowTimeDropdown(false);
                                          }}
                                        >
                                          {time}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                              {calendarOpening && (
                                <div>
                                  <span className="nap-field-label" id="appointment-time-label">Time</span>
                                  <output className="nap-field-button" aria-labelledby="appointment-time-label">{chosenOpening?.time ?? (calendarOpening.date === selectedDate ? calendarOpening.time : 'Choose a time')}</output>
                                </div>
                              )}
                            </div>
                          )}
                          <div className="relative">
                            <span className="nap-field-label" id="appointment-technician-label">Technician</span>
                            <button
                              type="button"
                              aria-labelledby="appointment-technician-label appointment-technician-value"
                              aria-expanded={showTechDropdown}
                              aria-controls="appointment-technician-options"
                              onClick={() => {
                                setShowTechDropdown(value => !value);
                                setShowTimeDropdown(false);
                              }}
                              className="nap-field-button"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                {selectedTechnician && <span className="nap-avatar" aria-hidden="true">{selectedTechnician.name.split(' ').map(name => name[0]).join('').slice(0, 2).toUpperCase()}</span>}
                                <span id="appointment-technician-value" className="break-words">{selectedTechnician?.name || 'Any available technician'}</span>
                              </span>
                              <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
                            </button>
                            {showTechDropdown && (
                              <div id="appointment-technician-options" className="nap-dropdown" aria-labelledby="appointment-technician-label">
                                <button
                                  type="button"
                                  aria-pressed={!selectedTechnicianId}
                                  onClick={() => {
                                    setVerifiedOpening(null);
                                    setSelectedTechnicianId(null);
                                    setShowTechDropdown(false);
                                  }}
                                >
                                  Any available technician
                                </button>
                                {technicians.map(tech => (
                                  <button
                                    key={tech.id}
                                    type="button"
                                    aria-pressed={tech.id === selectedTechnicianId}
                                    onClick={() => {
                                      setVerifiedOpening(null);
                                      setSelectedTechnicianId(tech.id);
                                      setShowTechDropdown(false);
                                    }}
                                  >
                                    {tech.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        {!findOpeningFrom && (openings || (!googleEventPrefill && !selectedServiceIds.length && <p className="nap-helper">Choose a service to see available times.</p>))}
                      </section>
                      <section ref={clientSectionRef} className="nap-section" aria-labelledby="appointment-client-heading">
                        <div className="nap-section-heading">
                          <h3 ref={clientHeadingRef} id="appointment-client-heading" tabIndex={-1}>Client</h3>
                          {salonSlug && <button type="button" className="nap-link" aria-expanded={showClientSearch} onClick={() => setShowClientSearch(value => !value)}>{showClientSearch ? 'Close search' : 'Find existing client'}</button>}
                        </div>
                        {showClientSearch && salonSlug && (
                          <AppointmentClientPicker
                            salonSlug={salonSlug}
                            onSelect={(client) => {
                              setClientName(client.fullName || '');
                              setClientPhone(client.phone);
                              setClientEmail(client.email || '');
                              setShowClientSearch(false);
                              clientPhoneRef.current?.focus();
                            }}
                          />
                        )}
                        <div className="nap-fields">
                          <div>
                            <label htmlFor="new-appt-phone">Phone Number *</label>
                            <input ref={clientPhoneRef} id="new-appt-phone" type="tel" inputMode="tel" autoComplete="off" value={formatPhoneDisplay(clientPhone)} onChange={event => handlePhoneChange(event.target.value)} placeholder="(555) 123-4567" aria-describedby={clientPhone.length > 10 ? 'appointment-phone-help' : undefined} />
                            {clientPhone.length > 10 && <p className="nap-helper" id="appointment-phone-help">Enter a 10-digit phone number, with an optional +1 country code.</p>}
                          </div>
                          <div>
                            <label htmlFor="new-appt-client-name">Client Name (optional)</label>
                            <input id="new-appt-client-name" type="text" autoComplete="off" value={clientName} onChange={event => setClientName(event.target.value)} placeholder="Client name" />
                          </div>
                          <div>
                            <label htmlFor="new-appt-client-email">Email (optional)</label>
                            <input id="new-appt-client-email" type="email" autoComplete="off" value={clientEmail} onChange={event => setClientEmail(event.target.value)} placeholder="client@example.com" />
                          </div>
                        </div>
                        {!googleEventPrefill && <p className="nap-helper">No deposit is collected here. Confirmations follow salon settings.</p>}
                      </section>
                      {googleEventPrefill && (
                        <section className="nap-section" aria-labelledby="appointment-details-heading">
                          <div className="nap-section-heading"><h3 id="appointment-details-heading">Event details</h3></div>
                          <div className="nap-fields">
                            <div className="nap-date-time">
                              <div>
                                <label htmlFor="google-event-price">Appointment price (CAD $)</label>
                                <input id="google-event-price" type="number" min="0" step="0.01" value={priceOverride} onChange={event => setPriceOverride(event.target.value)} />
                              </div>
                              <div>
                                <label htmlFor="google-event-duration">Duration (minutes)</label>
                                <input id="google-event-duration" type="number" min="1" max="1440" step="1" value={durationOverride} onChange={event => setDurationOverride(event.target.value)} />
                              </div>
                            </div>
                            <div>
                              <label htmlFor="google-event-notes">Notes (optional)</label>
                              <textarea id="google-event-notes" value={notes} maxLength={2000} rows={3} onChange={event => setNotes(event.target.value)} placeholder="Private appointment notes" />
                            </div>
                            {googleEventPrefill.isReadOnly && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Google event is read-only. Time changes continue to come from Google.</p>}
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                </>
              )}
        </div>
        <footer className="nap-footer">
          <div className="nap-summary" aria-live="polite" data-testid="new-appointment-summary">
            {selectedServices.length > 0
              ? (
                  <>
                    <div className="nap-summary-copy">
                      {(!guidedBooking || !needsOpening) && (
                        <p className="font-semibold text-[var(--owner-ink)]">
                          {needsOpening ? 'Choose an available time' : `${summaryDate} · ${selectedTime}${displayedDuration > 0 ? `–${displayedEnd}` : ''}`}
                        </p>
                      )}
                      <p>
                        {selectedServices.length}
                        {' '}
                        service
                        {selectedServices.length !== 1 ? 's' : ''}
                        {' '}
                        ·
                        {' '}
                        {formatDuration(displayedDuration)}
                        {selectedAddOns.length > 0 && (extrasAwaitingQuote ? ' + extras' : ' incl. extras')}
                      </p>
                    </div>
                    <div className="text-right">
                      {clientPrefill?.nextVisitOffer && <p className="text-xs">Before offers</p>}
                      {!extrasAwaitingQuote && <strong>{formatCurrency(displayedPrice)}</strong>}
                      {chosenOpening?.quote?.hasUnpricedExtras && <p className="text-xs">+ extras priced separately</p>}
                    </div>
                  </>
                )
              : findOpeningFrom && <p>Choose a service to see the next openings.</p>}
          </div>
          <div className="nap-actions">
            <button type="button" onClick={onClose} className="nap-cancel">Cancel</button>
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={actionUnavailable || (!nextStep && !canSave)}
              className="nap-submit"
              data-testid="appointment-primary-action"
            >
              {submitting
                ? (
                    <>
                      <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
                      Creating...
                    </>
                  )
                : nextStep
                  ? (
                      <>
                        {nextStep.label}
                        <ArrowDown aria-hidden="true" className="size-4 shrink-0" />
                      </>
                    )
                  : (
                      <>
                        <Plus aria-hidden="true" className="size-4 shrink-0" />
                        {submitFailed && googleEventPrefill ? 'Retry conversion' : 'Create Appointment'}
                      </>
                    )}
            </button>
          </div>
        </footer>
      </div>
    </DialogShell>
  );
}
