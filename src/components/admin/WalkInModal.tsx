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

import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, Clock, Loader2, Phone, Search, User, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

// Types
type DaySchedule = {
  start: string; // "09:00"
  end: string; // "18:00"
} | null;

type WeeklySchedule = {
  sunday: DaySchedule;
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
};

type Technician = {
  id: string;
  name: string;
  avatarUrl: string | null;
  currentStatus: string;
  weeklySchedule: WeeklySchedule | null;
};

type Service = {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  category: string | null;
};

type ExistingAppointment = {
  startTime: string;
  endTime: string;
  technicianId: string | null;
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
};

// Helper functions
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatTimeSlot(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

// Day names for schedule lookup
const DAY_NAMES: (keyof WeeklySchedule)[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

// Get technician's working hours for today
function getTechScheduleForToday(tech: Technician): { startHour: number; startMin: number; endHour: number; endMin: number } | null {
  if (!tech.weeklySchedule) {
    return null;
  }

  const today = new Date().getDay(); // 0 = Sunday
  const dayName = DAY_NAMES[today];
  const daySchedule = tech.weeklySchedule[dayName!];

  if (!daySchedule) {
    return null;
  } // Tech doesn't work today

  const [startH, startM] = daySchedule.start.split(':').map(Number);
  const [endH, endM] = daySchedule.end.split(':').map(Number);

  return {
    startHour: startH ?? 9,
    startMin: startM ?? 0,
    endHour: endH ?? 18,
    endMin: endM ?? 0,
  };
}

// Check if a time slot fits within a tech's schedule
function isWithinTechSchedule(
  slotTime: Date,
  slotEnd: Date,
  tech: Technician,
): boolean {
  const schedule = getTechScheduleForToday(tech);
  if (!schedule) {
    return false;
  } // Tech doesn't work today

  const slotStartMinutes = slotTime.getHours() * 60 + slotTime.getMinutes();
  const slotEndMinutes = slotEnd.getHours() * 60 + slotEnd.getMinutes();
  const schedStartMinutes = schedule.startHour * 60 + schedule.startMin;
  const schedEndMinutes = schedule.endHour * 60 + schedule.endMin;

  // Slot must start at or after schedule start, and end at or before schedule end
  return slotStartMinutes >= schedStartMinutes && slotEndMinutes <= schedEndMinutes;
}

// Generate available time slots for today starting from now
function generateTimeSlots(
  existingAppointments: ExistingAppointment[],
  selectedTechId: string | null,
  requiredDuration: number,
  allTechnicians: Technician[],
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const now = new Date();

  // Get the selected tech (or null for "any")
  const selectedTech = selectedTechId
    ? allTechnicians.find(t => t.id === selectedTechId)
    : null;

  // Determine the time range to generate slots for
  let earliestStart = 6; // 6 AM default
  let latestEnd = 22; // 10 PM default

  if (selectedTech) {
    // Use selected tech's schedule
    const schedule = getTechScheduleForToday(selectedTech);
    if (!schedule) {
      return []; // Tech doesn't work today
    }
    earliestStart = schedule.startHour;
    latestEnd = schedule.endHour;
  } else {
    // "Any available" - find the earliest start and latest end across all working techs
    const workingTechs = allTechnicians.filter(t => getTechScheduleForToday(t) !== null);
    if (workingTechs.length === 0) {
      return []; // No one works today
    }

    earliestStart = Math.min(...workingTechs.map((t) => {
      const s = getTechScheduleForToday(t);
      return s ? s.startHour : 24;
    }));
    latestEnd = Math.max(...workingTechs.map((t) => {
      const s = getTechScheduleForToday(t);
      return s ? s.endHour : 0;
    }));
  }

  // Round up to next 15-minute interval + 15 min buffer (walk-in needs some prep time)
  const bufferMinutes = 15;
  const currentMinutes = now.getHours() * 60 + now.getMinutes() + bufferMinutes;
  const minStartMinutes = earliestStart * 60;
  const effectiveStartMinutes = Math.max(currentMinutes, minStartMinutes);
  const startMinutes = Math.ceil(effectiveStartMinutes / 15) * 15;
  const startHour = Math.floor(startMinutes / 60);
  const startMin = startMinutes % 60;

  // If it's already past the latest end time, no slots
  if (startHour >= latestEnd) {
    return slots;
  }

  for (let hour = startHour; hour < latestEnd; hour++) {
    for (let min = (hour === startHour ? startMin : 0); min < 60; min += 30) {
      const slotTime = new Date();
      slotTime.setHours(hour, min, 0, 0);

      const slotEnd = new Date(slotTime.getTime() + requiredDuration * 60 * 1000);

      // Check if slot is available
      let isAvailable = false;

      if (selectedTech) {
        // Check if this specific tech is available for the full duration
        // First, check if it fits within their schedule
        if (!isWithinTechSchedule(slotTime, slotEnd, selectedTech)) {
          continue; // Skip this slot entirely - doesn't fit in tech's schedule
        }

        // Then check for appointment conflicts
        isAvailable = !existingAppointments.some((appt) => {
          if (appt.technicianId !== selectedTech.id) {
            return false;
          }

          const apptStart = new Date(appt.startTime);
          const apptEnd = new Date(appt.endTime);

          // Add 10 min buffer between appointments
          const bufferMs = 10 * 60 * 1000;
          const apptEndWithBuffer = new Date(apptEnd.getTime() + bufferMs);

          return slotTime < apptEndWithBuffer && slotEnd > apptStart;
        });
      } else {
        // "Any available" - check if ANY tech is free for the full duration
        isAvailable = allTechnicians.some((tech) => {
          // First, check if this tech works today and the slot fits their schedule
          if (!isWithinTechSchedule(slotTime, slotEnd, tech)) {
            return false;
          }

          // Then check if this tech has any conflicting appointments
          const hasConflict = existingAppointments.some((appt) => {
            if (appt.technicianId !== tech.id) {
              return false;
            }

            const apptStart = new Date(appt.startTime);
            const apptEnd = new Date(appt.endTime);
            const bufferMs = 10 * 60 * 1000;
            const apptEndWithBuffer = new Date(apptEnd.getTime() + bufferMs);

            return slotTime < apptEndWithBuffer && slotEnd > apptStart;
          });

          return !hasConflict;
        });
      }

      if (isAvailable) {
        slots.push({
          time: slotTime,
          label: formatTimeSlot(slotTime),
          available: true,
        });
      }
    }
  }

  return slots;
}

export function WalkInModal({ isOpen, onClose, onSuccess }: WalkInModalProps) {
  const { salonSlug } = useSalon();

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
  const [existingAppointments, setExistingAppointments] = useState<ExistingAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [serviceSearch, setServiceSearch] = useState('');

  // Fetch initial data
  const fetchData = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const today = new Date().toISOString().split('T')[0];

      const [techRes, servicesRes, apptsRes] = await Promise.all([
        fetch(`/api/admin/technicians?salonSlug=${salonSlug}&status=active`),
        fetch(`/api/salon/services?salonSlug=${salonSlug}`),
        fetch(`/api/admin/appointments?date=${today}&status=pending,confirmed,in_progress`),
      ]);

      if (!techRes.ok || !servicesRes.ok) {
        throw new Error('Failed to load data');
      }

      const [techData, servicesData, apptsData] = await Promise.all([
        techRes.json(),
        servicesRes.json(),
        apptsRes.ok ? apptsRes.json() : { data: { appointments: [] } },
      ]);

      setTechnicians(techData.data?.technicians || []);
      setServices(servicesData.data?.services || []);
      setExistingAppointments(
        (apptsData.data?.appointments || []).map((a: { startTime: string; endTime: string; technician?: { id: string } | null }) => ({
          startTime: a.startTime,
          endTime: a.endTime,
          technicianId: a.technician?.id || null,
        })),
      );
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

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
    }
  }, [isOpen]);

  // Calculate totals
  const selectedServices = services.filter(s => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);

  // Generate time slots based on selected technician and required duration
  const timeSlots = useMemo(() => {
    if (totalDuration === 0) {
      return [];
    }
    return generateTimeSlots(existingAppointments, selectedTechnicianId, totalDuration, technicians);
  }, [existingAppointments, selectedTechnicianId, totalDuration, technicians]);

  // Get available slots only
  const availableSlots = timeSlots.filter(s => s.available);

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
    setStep('tech');
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
    setSelectedTimeSlot(slot.time);
    setStep('confirm');
  };

  // Submit
  const handleSubmit = async () => {
    if (!selectedTimeSlot) {
      setError('Please select a time slot');
      return;
    }
    if (!clientPhone || clientPhone.length !== 10) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          serviceIds: selectedServiceIds,
          technicianId: selectedTechnicianId,
          clientPhone,
          clientName: clientName || undefined,
          startTime: selectedTimeSlot.toISOString(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || 'Failed to create appointment');
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Failed to create appointment:', err);
      setError(err instanceof Error ? err.message : 'Failed to create appointment');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedTechnician = technicians.find(t => t.id === selectedTechnicianId);

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
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 inset-y-[5%] z-50 mx-auto flex max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-emerald-600">
                  <Zap className="size-4 text-white" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Quick Walk-in</h2>
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

            {/* Progress Steps */}
            <div className="flex items-center justify-center gap-1 border-b border-gray-100 bg-gray-50 px-4 py-3">
              {['services', 'tech', 'time', 'confirm'].map((s, idx) => {
                const stepNum = idx + 1;
                const isActive = s === step;
                const isPast = ['services', 'tech', 'time', 'confirm'].indexOf(step) > idx;
                const labels = ['Services', 'Tech', 'Time', 'Book'];

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
                    ? 'bg-[#007AFF] text-white'
                    : isPast
                      ? 'cursor-pointer bg-green-100 text-green-700 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-400'
                  }
                      `}
                    >
                      {isPast ? <Check className="size-3" /> : <span>{stepNum}</span>}
                      <span>{labels[idx]}</span>
                    </button>
                    {idx < 3 && <ChevronRight className="mx-1 size-4 text-gray-300" />}
                  </div>
                );
              })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto bg-white p-5">
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
                        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
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
                              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          {/* Service List */}
                          <div className="space-y-4">
                            {Object.entries(servicesByCategory).map(([category, categoryServices]) => (
                              <div key={category}>
                                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                  {category}
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
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                                      }
                                    `}
                                      >
                                        <div className="flex items-center gap-3">
                                          <div className={`
                                        flex size-6 items-center justify-center rounded-full border-2 transition-colors
                                        ${isSelected
                                        ? 'border-blue-500 bg-blue-500 text-white'
                                        : 'border-gray-300 bg-white'
                                      }
                                      `}
                                          >
                                            {isSelected && <Check className="size-4" />}
                                          </div>
                                          <div>
                                            <p className={`font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
                                              {service.name}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                              <Clock className="mr-1 inline-block size-3" />
                                              {formatDuration(service.durationMinutes)}
                                            </p>
                                          </div>
                                        </div>
                                        <span className={`font-semibold ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>
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
                          <div className="rounded-xl bg-blue-50 p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-blue-900">
                                  {selectedServices.length}
                                  {' '}
                                  service
                                  {selectedServices.length !== 1 ? 's' : ''}
                                </p>
                                <p className="text-xs text-blue-700">
                                  {formatDuration(totalDuration)}
                                  {' '}
                                  total •
                                  {formatCurrency(totalPrice)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStep('services')}
                                className="text-xs font-medium text-blue-600 hover:text-blue-800"
                              >
                                Edit
                              </button>
                            </div>
                          </div>

                          <div>
                            <h3 className="font-semibold text-gray-900">Who would they like?</h3>
                            <p className="text-sm text-gray-500">Select a technician</p>
                          </div>

                          {/* Any Available Option */}
                          {(() => {
                            // Count how many techs work today and have availability
                            const workingTechs = technicians.filter(t => getTechScheduleForToday(t) !== null);
                            const anySlots = generateTimeSlots(existingAppointments, null, totalDuration, technicians);
                            const firstSlot = anySlots[0];

                            return (
                              <button
                                type="button"
                                onClick={() => handleTechSelect(null)}
                                disabled={anySlots.length === 0}
                                className={`
                              flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-all
                              ${anySlots.length > 0
                                ? 'border-green-200 bg-green-50 hover:border-green-400 hover:bg-green-100'
                                : 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-60'
                              }
                            `}
                              >
                                <div className={`
                              flex size-12 items-center justify-center rounded-full
                              ${anySlots.length > 0
                                ? 'bg-gradient-to-br from-green-400 to-emerald-600'
                                : 'bg-gray-400'
                              }
                            `}
                                >
                                  <User className="size-6 text-white" />
                                </div>
                                <div className="flex-1">
                                  <p className={`font-semibold ${anySlots.length > 0 ? 'text-gray-900' : 'text-gray-500'}`}>
                                    Any Available
                                  </p>
                                  {anySlots.length > 0
                                    ? (
                                        <p className="text-sm text-green-600">
                                          {workingTechs.length}
                                          {' '}
                                          tech
                                          {workingTechs.length !== 1 ? 's' : ''}
                                          {' '}
                                          working • Next:
                                          {firstSlot?.label}
                                        </p>
                                      )
                                    : (
                                        <p className="text-sm text-gray-400">
                                          No availability today
                                        </p>
                                      )}
                                </div>
                                {anySlots.length > 0 && <ChevronRight className="size-5 text-gray-400" />}
                              </button>
                            );
                          })()}

                          {/* Technician List */}
                          {technicians.map((tech) => {
                            // Check if tech works today
                            const schedule = getTechScheduleForToday(tech);
                            const worksToday = schedule !== null;

                            // Check if this tech has ANY available slot for the required duration
                            const techSlots = worksToday
                              ? generateTimeSlots(existingAppointments, tech.id, totalDuration, technicians)
                              : [];
                            const nextAvailable = techSlots[0];

                            return (
                              <button
                                key={tech.id}
                                type="button"
                                onClick={() => handleTechSelect(tech.id)}
                                disabled={!worksToday}
                                className={`
                              flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition-all
                              ${worksToday
                                ? 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                                : 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-60'
                              }
                            `}
                              >
                                <div className={`
                              flex size-12 items-center justify-center rounded-full text-sm font-bold text-white
                              ${worksToday
                                ? 'bg-gradient-to-br from-blue-400 to-blue-600'
                                : 'bg-gray-400'
                              }
                            `}
                                >
                                  {getInitials(tech.name)}
                                </div>
                                <div className="flex-1">
                                  <p className={`font-semibold ${worksToday ? 'text-gray-900' : 'text-gray-500'}`}>
                                    {tech.name}
                                  </p>
                                  {!worksToday
                                    ? (
                                        <p className="text-sm text-gray-400">
                                          Off today
                                        </p>
                                      )
                                    : nextAvailable
                                      ? (
                                          <p className="text-sm text-green-600">
                                            Next:
                                            {' '}
                                            {nextAvailable.label}
                                            {' '}
                                            (
                                            {techSlots.length}
                                            {' '}
                                            slot
                                            {techSlots.length !== 1 ? 's' : ''}
                                            )
                                          </p>
                                        )
                                      : (
                                          <p className="text-sm text-orange-600">
                                            Fully booked today
                                          </p>
                                        )}
                                </div>
                                {worksToday && <ChevronRight className="size-5 text-gray-400" />}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Step 3: Time Slot Selection */}
                      {step === 'time' && (
                        <div className="space-y-4">
                          {/* Summary */}
                          <div className="rounded-xl bg-blue-50 p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-blue-900">
                                  {selectedTechnician?.name || 'Any Available'}
                                </p>
                                <p className="text-xs text-blue-700">
                                  {formatDuration(totalDuration)}
                                  {' '}
                                  needed •
                                  {formatCurrency(totalPrice)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStep('tech')}
                                className="text-xs font-medium text-blue-600 hover:text-blue-800"
                              >
                                Change
                              </button>
                            </div>
                          </div>

                          <div>
                            <h3 className="font-semibold text-gray-900">Pick a time</h3>
                            <p className="text-sm text-gray-500">
                              {availableSlots.length}
                              {' '}
                              slot
                              {availableSlots.length !== 1 ? 's' : ''}
                              {' '}
                              available today
                            </p>
                          </div>

                          {availableSlots.length === 0
                            ? (
                                <div className="rounded-xl bg-orange-50 p-6 text-center">
                                  <p className="font-medium text-orange-800">No slots available</p>
                                  <p className="mt-1 text-sm text-orange-600">
                                    No
                                    {' '}
                                    {formatDuration(totalDuration)}
                                    {' '}
                                    slots available today for
                                    {' '}
                                    {selectedTechnician?.name || 'any tech'}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setStep('tech')}
                                    className="mt-3 text-sm font-medium text-orange-700 hover:text-orange-900"
                                  >
                                    Try another technician →
                                  </button>
                                </div>
                              )
                            : (
                                <div className="grid grid-cols-3 gap-2">
                                  {availableSlots.map((slot, idx) => (
                                    <motion.button
                                      key={idx}
                                      type="button"
                                      onClick={() => handleTimeSelect(slot)}
                                      initial={{ opacity: 0, y: 10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      transition={{ delay: idx * 0.02 }}
                                      className="rounded-xl border-2 border-gray-200 bg-white p-3 text-center font-medium text-gray-900 transition-all hover:border-green-400 hover:bg-green-50"
                                    >
                                      <Clock className="mx-auto mb-1 size-4 text-green-500" />
                                      <span className="text-sm">{slot.label}</span>
                                    </motion.button>
                                  ))}
                                </div>
                              )}
                        </div>
                      )}

                      {/* Step 4: Confirm & Client Details */}
                      {step === 'confirm' && (
                        <div className="space-y-5">
                          {/* Booking Summary */}
                          <div className="rounded-xl bg-green-50 p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-green-800">
                                  {selectedTechnician?.name || 'Any Available'}
                                </p>
                                <p className="text-2xl font-bold text-green-900">
                                  {selectedTimeSlot && formatTimeSlot(selectedTimeSlot)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setStep('time')}
                                className="text-sm font-medium text-green-700 hover:text-green-900"
                              >
                                Change
                              </button>
                            </div>
                            <div className="border-t border-green-200 pt-3">
                              <p className="text-sm text-green-700">
                                {selectedServices.map(s => s.name).join(', ')}
                              </p>
                              <p className="mt-1 text-sm font-medium text-green-800">
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
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                              />
                            </div>

                            <div>
                              <label htmlFor="walkin-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                                <User className="mr-1.5 inline-block size-4" />
                                Client Name (optional)
                              </label>
                              <input
                                id="walkin-name"
                                type="text"
                                value={clientName}
                                onChange={e => setClientName(e.target.value)}
                                placeholder="Jane Doe"
                                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
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
                    disabled={selectedServiceIds.length === 0}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#007AFF] px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#0066CC] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Choose Technician
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              )}

              {step === 'confirm' && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || clientPhone.length !== 10}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
