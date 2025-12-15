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
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

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

type NewAppointmentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  preselectedDate?: Date;
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

function formatDateForInput(date: Date): string {
  const result = date.toISOString().split('T')[0];
  return result ?? '';
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
}: NewAppointmentModalProps) {
  const { salonSlug } = useSalon();

  // Form state
  const [selectedDate, setSelectedDate] = useState<string>(
    preselectedDate ? formatDateForInput(preselectedDate) : formatDateForInput(new Date()),
  );
  const [selectedTime, setSelectedTime] = useState<string>('10:00');
  const [clientPhone, setClientPhone] = useState('');
  const [clientName, setClientName] = useState('');
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
    } catch (err) {
      console.error('Failed to fetch data:', err);
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

  // Reset form when closing
  useEffect(() => {
    if (!isOpen) {
      setClientPhone('');
      setClientName('');
      setSelectedTechnicianId(null);
      setSelectedServiceIds([]);
      setError(null);
      setServiceSearch('');
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
    // Validation
    if (!clientPhone || clientPhone.length !== 10) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }
    if (selectedServiceIds.length === 0) {
      setError('Please select at least one service');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Build start time ISO string
      const [year, month, day] = selectedDate.split('-').map(Number);
      const [hours, minutes] = selectedTime.split(':').map(Number);
      const startTime = new Date(year!, month! - 1, day, hours, minutes);

      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          salonSlug,
          serviceIds: selectedServiceIds,
          technicianId: selectedTechnicianId,
          clientPhone,
          clientName: clientName || undefined,
          startTime: startTime.toISOString(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || 'Failed to create appointment');
      }

      // Success
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
            className="fixed inset-x-4 inset-y-[10%] z-50 mx-auto max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 bg-white px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">New Appointment</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close modal"
                className="flex size-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
              >
                <X className="size-5 text-gray-600" />
              </button>
            </div>

            {/* Content */}
            <div className="h-[calc(100%-140px)] overflow-y-auto bg-white p-5">
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
                          <label htmlFor="newappt-time-btn" className="mb-1.5 block text-sm font-medium text-gray-700">
                            <Clock className="mr-1.5 inline-block size-4" />
                            Time
                          </label>
                          <button
                            id="newappt-time-btn"
                            type="button"
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
                      </div>

                      {/* Client Info */}
                      <div className="space-y-4">
                        <div>
                          <label htmlFor="newappt-phone" className="mb-1.5 block text-sm font-medium text-gray-700">
                            <Phone className="mr-1.5 inline-block size-4" />
                            Phone Number *
                          </label>
                          <input
                            id="newappt-phone"
                            type="tel"
                            value={formatPhoneDisplay(clientPhone)}
                            onChange={e => handlePhoneChange(e.target.value)}
                            placeholder="(555) 123-4567"
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label htmlFor="newappt-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                            <User className="mr-1.5 inline-block size-4" />
                            Client Name (optional)
                          </label>
                          <input
                            id="newappt-name"
                            type="text"
                            value={clientName}
                            onChange={e => setClientName(e.target.value)}
                            placeholder="Jane Doe"
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </div>

                      {/* Technician Selection */}
                      <div className="relative">
                        <label htmlFor="newappt-tech-btn" className="mb-1.5 block text-sm font-medium text-gray-700">
                          Technician
                        </label>
                        <button
                          id="newappt-tech-btn"
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
                        <label htmlFor="newappt-service-search" className="mb-1.5 block text-sm font-medium text-gray-700">
                          Services *
                        </label>

                        {/* Search */}
                        <div className="relative mb-3">
                          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                          <input
                            id="newappt-service-search"
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
            <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
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
                    {formatDuration(totalDuration)}
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
                  disabled={submitting || selectedServiceIds.length === 0 || clientPhone.length !== 10}
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
                          Create Appointment
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
