'use client';

import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BlockingLoginModal } from '@/components/BlockingLoginModal';
import { BookingFloatingDock } from '@/components/booking/BookingFloatingDock';
import { BookingPhoneLogin } from '@/components/booking/BookingPhoneLogin';
import { useBookingAuth } from '@/hooks/useBookingAuth';
import { useBookingState } from '@/hooks/useBookingState';
import { type BookingStep, getFirstStep, getNextStep, getPrevStep, getStepLabel } from '@/libs/bookingFlow';
import { triggerHaptic } from '@/libs/haptics';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type Category = 'hands' | 'feet' | 'combo';

export type ServiceData = {
  id: string;
  name: string;
  description?: string | null;
  duration: number;
  price: number; // In dollars (converted from cents)
  category: Category;
  imageUrl: string;
};

export type LocationData = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  isPrimary: boolean;
};

type BookServiceClientProps = {
  services: ServiceData[];
  bookingFlow: BookingStep[];
  locations: LocationData[];
};

const CATEGORY_LABELS: { id: Category; label: string; icon: string }[] = [
  { id: 'hands', label: 'Hands', icon: '💅' },
  { id: 'feet', label: 'Feet', icon: '🦶' },
  { id: 'combo', label: 'Combo', icon: '✨' },
];

export function BookServiceClient({ services, bookingFlow, locations }: BookServiceClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';

  // Check if this is the first step in the booking flow (for dock/login visibility)
  const isFirstStep = getFirstStep(bookingFlow) === 'service';

  // Get reschedule params from URL (passed from change-appointment page)
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const urlClientPhone = searchParams.get('clientPhone') || '';
  const urlLocationId = searchParams.get('locationId') || '';

  // Use shared auth hook
  const { isLoggedIn, phone, isCheckingSession, handleLoginSuccess } = useBookingAuth(urlClientPhone || undefined);

  // Use global booking state to persist technician selection
  const { technicianId } = useBookingState();

  // Multi-location: show picker only when 2+ locations
  const showLocationPicker = locations.length >= 2;
  const primaryLocation = locations.find(l => l.isPrimary) || locations[0];

  // Check if URL locationId is valid
  const urlLocationValid = urlLocationId && locations.some(l => l.id === urlLocationId);
  const hadInvalidLocation = !!(urlLocationId && !urlLocationValid && showLocationPicker);

  // Initialize selectedLocationId from URL or primary
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(() => {
    if (urlLocationValid) {
      return urlLocationId;
    }
    return primaryLocation?.id || null;
  });

  // Show toast if multi-location salon had invalid locationId in URL
  const [showLocationFallbackToast, setShowLocationFallbackToast] = useState(hadInvalidLocation);

  // Repair URL if locationId was invalid - replace with primary
  // This ensures later steps don't carry garbage locationId
  useEffect(() => {
    if (hadInvalidLocation && primaryLocation?.id) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set('locationId', primaryLocation.id);
      // Replace URL without adding to history
      window.history.replaceState(null, '', `?${newParams.toString()}`);
    }
  }, [hadInvalidLocation, primaryLocation?.id, searchParams]);

  const [selectedCategory, setSelectedCategory] = useState<Category>('hands');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [pendingServiceIds, setPendingServiceIds] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  // Set mounted on client
  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredServices = services.filter((service) => {
    if (searchQuery) {
      return service.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return service.category === selectedCategory;
  });

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) => {
      const wasSelected = prev.includes(id);
      triggerHaptic(wasSelected ? 'deselect' : 'select');
      return wasSelected ? prev.filter(x => x !== id) : [...prev, id];
    });
  };

  const selectedCount = selectedServiceIds.length;
  const selectedServices = services.filter(s => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  const goToNextStep = (serviceIds: string[], clientPhone: string) => {
    const query = serviceIds.join(',');
    // Strip +1 prefix if present to get just 10-digit number for the API
    const normalizedPhone = clientPhone.replace(/^\+1/, '');

    // Get the next step from the booking flow
    const nextStep = getNextStep('service', bookingFlow);
    if (!nextStep) {
      return;
    }

    let url = `/${locale}/book/${nextStep}?serviceIds=${query}&clientPhone=${encodeURIComponent(normalizedPhone)}`;

    // Include technicianId from state if it exists (persists selection across flow reorder)
    if (technicianId) {
      url += `&techId=${encodeURIComponent(technicianId)}`;
    }

    // Pass through originalAppointmentId for reschedule flow
    if (originalAppointmentId) {
      url += `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`;
    }

    // Pass through locationId for multi-location support
    if (selectedLocationId) {
      url += `&locationId=${encodeURIComponent(selectedLocationId)}`;
    }

    router.push(url);
  };

  const handleBack = () => {
    const prevStep = getPrevStep('service', bookingFlow);
    if (prevStep) {
      let url = `/${locale}/book/${prevStep}?clientPhone=${encodeURIComponent(phone)}`;
      if (originalAppointmentId) {
        url += `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`;
      }
      router.push(url);
    } else {
      router.back();
    }
  };

  const handleContinue = () => {
    if (!selectedServiceIds.length) {
      return;
    }

    triggerHaptic('confirm');

    if (isLoggedIn && phone) {
      goToNextStep(selectedServiceIds, phone);
      return;
    }

    // Not logged in - open modal for login
    setPendingServiceIds(selectedServiceIds);
    setIsLoginModalOpen(true);
  };

  // Handle login success from the bottom login bar
  const handleBottomLoginSuccess = (verifiedPhone: string) => {
    handleLoginSuccess(verifiedPhone);
  };

  // Handle login success from the blocking modal
  const handleModalLoginSuccess = (verifiedPhone: string) => {
    handleLoginSuccess(verifiedPhone);
    setIsLoginModalOpen(false);
    if (pendingServiceIds.length > 0) {
      goToNextStep(pendingServiceIds, verifiedPhone);
      setPendingServiceIds([]);
    }
  };

  const handleCloseLoginModal = () => {
    setIsLoginModalOpen(false);
    setPendingServiceIds([]);
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        {/* Header */}
        <div
          className="relative flex items-center pb-2 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          {/* Back button - only show when NOT the first step */}
          {!isFirstStep && (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Go back"
              className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
            >
              <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          <div
            className={`text-lg font-semibold tracking-tight ${isFirstStep ? 'w-full text-center' : 'absolute left-1/2 -translate-x-1/2'}`}
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Progress Steps */}
        <div
          className="mb-4 flex items-center justify-center gap-2"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 50ms',
          }}
        >
          {bookingFlow.map((step, i) => {
            const isCurrentStep = step === 'service';
            return (
              <div key={step} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 ${isCurrentStep ? 'opacity-100' : 'opacity-40'}`}>
                  <div
                    className="flex size-6 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      backgroundColor: isCurrentStep ? themeVars.primary : undefined,
                      color: isCurrentStep ? '#171717' : '#525252',
                    }}
                  >
                    {i + 1}
                  </div>
                  <span className={`text-xs font-medium ${isCurrentStep ? 'text-neutral-900' : 'text-neutral-500'}`}>
                    {getStepLabel(step)}
                  </span>
                </div>
                {i < bookingFlow.length - 1 && <div className="h-px w-4 bg-neutral-300" />}
              </div>
            );
          })}
        </div>

        {/* Search Bar */}
        <div
          className="mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <div
            className="flex items-center rounded-2xl bg-white px-4 py-3 shadow-sm"
            style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: themeVars.cardBorder }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-3 text-neutral-400">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search services..."
              className="flex-1 bg-transparent text-base text-neutral-800 outline-none placeholder:text-neutral-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="ml-2 flex size-6 items-center justify-center rounded-full bg-neutral-100 transition-colors hover:bg-neutral-200"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Location Fallback Toast - shown when URL had invalid locationId for multi-location salon */}
        {showLocationFallbackToast && (
          <div
            className="mb-4 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: '#fbbf24',
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 110ms, transform 300ms ease-out 110ms',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-amber-600">⚠️</span>
              <span className="text-sm text-amber-800">
                Location not found, defaulted to
                {' '}
                {primaryLocation?.name || 'primary location'}
                .
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowLocationFallbackToast(false)}
              className="ml-2 text-amber-600 hover:text-amber-800"
              aria-label="Dismiss"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        {/* Location Picker - shown only when 2+ locations */}
        {showLocationPicker && (
          <div
            className="mb-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 120ms, transform 300ms ease-out 120ms',
            }}
          >
            <div className="mb-2 text-center text-sm font-medium text-neutral-600">
              📍 Choose a location
            </div>
            <div className="flex flex-col gap-2">
              {locations.map((location) => {
                const isSelected = selectedLocationId === location.id;
                return (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => {
                      if (selectedLocationId !== location.id) {
                        setSelectedLocationId(location.id);
                        triggerHaptic('select');
                      }
                    }}
                    className="relative overflow-hidden rounded-xl p-3 text-left transition-all duration-200"
                    style={{
                      backgroundColor: isSelected ? `color-mix(in srgb, ${themeVars.primary} 15%, white)` : 'white',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: isSelected ? themeVars.primary : themeVars.cardBorder,
                      boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.04)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-neutral-900">{location.name}</span>
                          {location.isPrimary && (
                            <span
                              className="rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{ backgroundColor: `color-mix(in srgb, ${themeVars.accent} 15%, white)`, color: themeVars.accent }}
                            >
                              Primary
                            </span>
                          )}
                        </div>
                        {location.address && (
                          <div className="mt-0.5 text-sm text-neutral-500">
                            {location.address}
                            {location.city && `, ${location.city}`}
                            {location.state && ` ${location.state}`}
                          </div>
                        )}
                      </div>
                      {/* Selection indicator */}
                      <div
                        className="flex size-6 shrink-0 items-center justify-center rounded-full transition-all"
                        style={{
                          backgroundColor: isSelected ? themeVars.primary : 'transparent',
                          borderWidth: isSelected ? 0 : '2px',
                          borderStyle: 'solid',
                          borderColor: isSelected ? 'transparent' : '#d4d4d4',
                        }}
                      >
                        {isSelected && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
                            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Category Tabs */}
        <div
          className="mb-5 flex items-center justify-center gap-2"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 150ms',
          }}
        >
          {CATEGORY_LABELS.map((cat) => {
            const active = cat.id === selectedCategory;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  if (cat.id !== selectedCategory) {
                    setSelectedCategory(cat.id);
                    triggerHaptic('select');
                  }
                }}
                className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-200"
                style={{
                  backgroundColor: active ? themeVars.accent : 'white',
                  color: active ? 'white' : '#525252',
                  borderWidth: active ? 0 : '1px',
                  borderStyle: 'solid',
                  borderColor: active ? 'transparent' : themeVars.cardBorder,
                  boxShadow: active ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                }}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-2 gap-3">
          {filteredServices.map((service, index) => {
            const isSelected = selectedServiceIds.includes(service.id);
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => toggleService(service.id)}
                className="relative overflow-hidden rounded-2xl text-left transition-all duration-200"
                style={{
                  transform: mounted ? (isSelected ? 'scale(1.02)' : 'translateY(0)') : 'translateY(15px)',
                  opacity: mounted ? 1 : 0,
                  background: isSelected
                    ? `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.primary} 20%, transparent), color-mix(in srgb, ${themeVars.primaryDark} 10%, transparent))`
                    : 'white',
                  boxShadow: isSelected
                    ? '0 10px 15px -3px rgb(0 0 0 / 0.1)'
                    : '0 4px 20px rgba(0,0,0,0.06)',
                  borderWidth: isSelected ? 0 : '1px',
                  borderStyle: 'solid',
                  borderColor: isSelected ? 'transparent' : themeVars.cardBorder,
                  outline: isSelected ? `2px solid ${themeVars.primary}` : undefined,
                  outlineOffset: isSelected ? '0px' : undefined,
                  transition: `opacity 300ms ease-out ${200 + index * 50}ms, transform 300ms ease-out ${200 + index * 50}ms, box-shadow 200ms ease-out, border-color 200ms ease-out`,
                }}
              >
                {/* Image */}
                <div
                  className="relative h-[120px] overflow-hidden"
                  style={{
                    background: `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}), color-mix(in srgb, ${themeVars.selectedBackground} 90%, ${themeVars.primaryDark}))`,
                  }}
                >
                  <Image
                    src={service.imageUrl}
                    alt={service.name}
                    fill
                    className={`object-cover transition-transform duration-300 ${isSelected ? 'scale-105' : ''}`}
                  />
                  {/* Selection checkmark */}
                  {isSelected && (
                    <div
                      className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full shadow-lg"
                      style={{
                        background: `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
                        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="text-base font-bold leading-tight text-neutral-900">
                    {service.name}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-neutral-500">
                      {service.duration}
                      {' '}
                      min
                    </span>
                    <span className="text-base font-bold" style={{ color: themeVars.accent }}>
                      $
                      {service.price}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Spacer for fixed bottom bar */}
        {selectedCount > 0 && <div className="h-24" />}

        {/* Spacer for floating dock when logged in */}
        {!isCheckingSession && isLoggedIn && isFirstStep && <div className="h-16" />}

        {/* Auth Footer - shown only on first step when not logged in */}
        {isFirstStep && !isCheckingSession && !isLoggedIn && (
          <BookingPhoneLogin
            initialPhone={urlClientPhone || undefined}
            onLoginSuccess={handleBottomLoginSuccess}
          />
        )}

        {/* Floating Dock - shown when logged in and this is the first step */}
        {!isCheckingSession && isLoggedIn && isFirstStep && (
          <BookingFloatingDock />
        )}

        {/* Blocking Login Modal */}
        <BlockingLoginModal
          isOpen={isLoginModalOpen}
          onClose={handleCloseLoginModal}
          onLoginSuccess={handleModalLoginSuccess}
        />
      </div>

      {/* Fixed Bottom Selection Bar */}
      {selectedCount > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.1)]"
          style={{
            borderTopWidth: '1px',
            borderTopStyle: 'solid',
            borderTopColor: themeVars.cardBorder,
            animation: 'slideUp 0.3s ease-out',
          }}
        >
          <style jsx>
            {`
            @keyframes slideUp {
              from {
                transform: translateY(100%);
              }
              to {
                transform: translateY(0);
              }
            }
          `}
          </style>
          <div className="mx-auto flex max-w-[430px] items-center justify-between p-4">
            <div>
              <div className="text-sm text-neutral-500">
                {selectedCount === 1 ? '1 service' : `${selectedCount} services`}
              </div>
              <div className="text-xl font-bold text-neutral-900">
                $
                {totalPrice}
              </div>
            </div>
            <button
              type="button"
              onClick={handleContinue}
              className="flex items-center gap-2 rounded-full px-6 py-3 text-base font-bold text-neutral-900 shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
              style={{
                background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
              }}
            >
              Continue
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {/* Safe area padding for devices with home indicator */}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}
    </div>
  );
}
