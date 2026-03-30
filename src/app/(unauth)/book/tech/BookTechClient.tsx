'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BlockingLoginModal } from '@/components/BlockingLoginModal';
import { BookingStepHeader } from '@/components/booking/BookingStepHeader';
import { BookingFloatingDock } from '@/components/booking/BookingFloatingDock';
import { BookingPhoneLogin } from '@/components/booking/BookingPhoneLogin';
import { BookingSummaryCard } from '@/components/booking/BookingSummaryCard';
import { TechnicianAvatar } from '@/components/booking/TechnicianAvatar';
import { StateCard } from '@/components/ui/state-card';
import { useClientSession } from '@/hooks/useClientSession';
import { useBookingState } from '@/hooks/useBookingState';
import { buildBookingUrl, parseSelectedAddOnsParam } from '@/libs/bookingParams';
import { type BookingStep, getFirstStep, getNextStep, getPrevStep } from '@/libs/bookingFlow';
import { getPublicTechnicianRatingDisplay } from '@/libs/technicianRating';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

export type TechnicianData = {
  id: string;
  name: string;
  imageUrl: string | null;
  specialties: string[];
  rating: number | null;
  reviewCount: number;
  bookable: boolean;
  unavailableReason: string | null;
};

export type ServiceSummary = {
  id: string;
  name: string;
  price: number; // In dollars
  duration: number;
};

export type AddOnSummary = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  duration: number;
};

type BookTechClientProps = {
  technicians: TechnicianData[];
  services: ServiceSummary[];
  addOns?: AddOnSummary[];
  totalPrice: number;
  totalDuration: number;
  locationName?: string | null;
  bookingFlow: BookingStep[];
};

export function BookTechClient({
  technicians,
  services,
  addOns = [],
  totalPrice,
  totalDuration,
  locationName = null,
  bookingFlow,
}: BookTechClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;
  const serviceIds = searchParams.get('serviceIds')?.split(',').filter(Boolean) || [];
  const baseServiceId = searchParams.get('baseServiceId');
  const selectedAddOns = parseSelectedAddOnsParam(searchParams.get('selectedAddOns'));
  const techError = searchParams.get('techError');
  const hasBookableTechnicians = technicians.some(tech => tech.bookable);

  // Check if this is the first step in the booking flow (for dock/login visibility)
  const isFirstStep = getFirstStep(bookingFlow) === 'tech';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const locationId = searchParams.get('locationId') || '';

  // Use shared auth hook
  const { isLoggedIn, isCheckingSession, handleLoginSuccess } = useClientSession();

  // Use global booking state for technician persistence
  const { technicianId, setTechnicianId, syncFromUrl, isHydrated = false } = useBookingState();

  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [pendingTechId, setPendingTechId] = useState<string | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const serviceNames = [
    ...services.map(service => service.name),
    ...addOns.map(addOn => addOn.quantity > 1 ? `${addOn.name} x${addOn.quantity}` : addOn.name),
  ].join(' + ');

  // Initialize mounted and sync from URL params/state on mount
  useEffect(() => {
    setMounted(true);

    const urlTechId = searchParams.get('techId');
    if (urlTechId) {
      syncFromUrl({ techId: urlTechId });
      setSelectedTech(urlTechId);
    } else if (technicianId) {
      setSelectedTech(technicianId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  useEffect(() => {
    if (!isHydrated || selectedTech || !technicianId || searchParams.get('techId')) {
      return;
    }

    setSelectedTech(technicianId);
  }, [isHydrated, searchParams, selectedTech, technicianId]);

  const goToNextStep = (techId: string) => {
    // Save to global state first
    setTechnicianId(techId === 'any' ? null : techId);

    const nextStep = getNextStep('tech', bookingFlow);
    if (!nextStep) {
      return;
    }

    router.push(buildBookingUrl(`/${locale}/book/${nextStep}`, {
      salonSlug,
      serviceIds: serviceIds.length > 0 ? serviceIds : undefined,
      baseServiceId,
      selectedAddOns,
      techId,
      originalAppointmentId,
      locationId,
    }, {
      routeSalonSlug,
      locale,
    }));
  };

  const handleSelectTech = (techId: string) => {
    const technician = technicians.find(tech => tech.id === techId);
    if (technician && !technician.bookable) {
      return;
    }

    // Always allow selection
    setSelectedTech(techId);
    // Save to global state immediately
    setTechnicianId(techId === 'any' ? null : techId);

    // Gate navigation on login when this is the first step
    if (isFirstStep && !isLoggedIn) {
      setPendingTechId(techId);
      setIsLoginModalOpen(true);
      return;
    }

    // Use the phone from auth hook (may be updated after login)
    setTimeout(() => {
      goToNextStep(techId);
    }, 300);
  };

  // Handle login success from the blocking modal
  const handleModalLoginSuccess = (verifiedPhone: string) => {
    handleLoginSuccess(verifiedPhone);
    setIsLoginModalOpen(false);

    if (pendingTechId) {
      setSelectedTech(pendingTechId);
      // Save to global state
      setTechnicianId(pendingTechId === 'any' ? null : pendingTechId);
      setTimeout(() => {
        goToNextStep(pendingTechId);
      }, 300);
      setPendingTechId(null);
    }
  };

  const handleCloseLoginModal = () => {
    setIsLoginModalOpen(false);
    setPendingTechId(null);
  };

  const handleBack = () => {
    const prevStep = getPrevStep('tech', bookingFlow);
    if (prevStep) {
      router.push(buildBookingUrl(`/${locale}/book/${prevStep}`, {
        salonSlug,
        serviceIds: serviceIds.length > 0 ? serviceIds : undefined,
        baseServiceId,
        selectedAddOns,
        originalAppointmentId,
        locationId,
      }, {
        routeSalonSlug,
        locale,
      }));
    } else {
      router.back();
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        <BookingStepHeader
          salonName={salonName}
          mounted={mounted}
          title="Choose Your Artist"
          description="Select your favorite nail technician"
          bookingFlow={bookingFlow}
          currentStep="tech"
          isFirstStep={isFirstStep}
          onBack={handleBack}
        />

        {techError === 'unsupported' && (
          <StateCard
            title="That artist can't perform this service yet"
            description="Choose a different artist or use any available artist for this appointment."
            tone="error"
            className="mb-4 border"
          />
        )}

        <BookingSummaryCard
          mounted={mounted}
          label="Selected service"
          serviceNames={serviceNames}
          totalDuration={totalDuration}
          totalPrice={totalPrice}
          locationName={locationName}
        />

        {/* Technicians grid */}
        <div className="grid grid-cols-2 gap-3">
          {technicians.map((tech, index) => {
            const isSelected = selectedTech === tech.id && tech.bookable;
            const ratingDisplay = getPublicTechnicianRatingDisplay({
              rating: tech.rating,
              reviewCount: tech.reviewCount,
            });
            return (
              <button
                key={tech.id}
                type="button"
                disabled={!tech.bookable}
                onClick={() => handleSelectTech(tech.id)}
                className="relative overflow-hidden rounded-2xl text-left transition-all duration-300 disabled:cursor-not-allowed"
                style={{
                  transform: isSelected ? 'scale(1.02)' : undefined,
                  background: isSelected
                    ? `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.primary} 30%, transparent), color-mix(in srgb, ${themeVars.primaryDark} 20%, transparent))`
                    : 'white',
                  boxShadow: isSelected
                    ? '0 20px 25px -5px rgb(0 0 0 / 0.1)'
                    : '0 4px 20px rgba(0,0,0,0.06)',
                  outline: isSelected ? `2px solid ${themeVars.primary}` : undefined,
                  borderWidth: isSelected ? 0 : '1px',
                  borderStyle: 'solid',
                  borderColor: isSelected ? 'transparent' : themeVars.cardBorder,
                  opacity: mounted ? (tech.bookable ? 1 : 0.65) : 0,
                  transition: `opacity 300ms ease-out ${200 + index * 100}ms, transform 300ms ease-out ${200 + index * 100}ms, box-shadow 200ms ease-out, border-color 200ms ease-out`,
                }}
              >
                {/* Selection checkmark */}
                {isSelected && (
                  <div
                    className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-full shadow-lg"
                    style={{
                      background: `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}

                <div className="flex flex-col items-center p-4">
                  {/* Avatar with subtle animation */}
                  <div
                    className={`relative mb-3 size-24 overflow-hidden rounded-full transition-transform duration-300 ${
                      isSelected ? 'scale-105' : ''
                    }`}
                  >
                    {/* Ring around avatar */}
                    <div
                      className="absolute inset-0 rounded-full border-[3px] transition-colors duration-300"
                      style={{
                        borderColor: isSelected ? themeVars.primary : 'transparent',
                      }}
                    />
                    <TechnicianAvatar
                      name={tech.name}
                      imageUrl={tech.imageUrl}
                      className="size-full"
                      sizes="96px"
                    />
                  </div>

                  {/* Name */}
                  <div className="mb-1 text-lg font-bold text-neutral-900">
                    {tech.name}
                  </div>

                  {!tech.bookable ? (
                    <div className="mb-2 rounded-full bg-neutral-100 px-3 py-1 text-center text-xs font-medium text-neutral-600">
                      {tech.unavailableReason ?? 'Unavailable for this service'}
                    </div>
                  ) : ratingDisplay.kind === 'rated' ? (
                    <div className="mb-2 flex items-center gap-1.5">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map(star => (
                          <svg
                            key={star}
                            width="14"
                            height="14"
                            viewBox="0 0 12 12"
                            style={{ fill: star <= Math.floor(ratingDisplay.ratingValue) ? themeVars.primary : '#e5e5e5' }}
                          >
                            <path d="M6 0L7.5 4.5L12 4.5L8.25 7.5L9.75 12L6 9L2.25 12L3.75 7.5L0 4.5L4.5 4.5L6 0Z" />
                          </svg>
                        ))}
                      </div>
                      <span className="text-sm font-bold text-neutral-900">{ratingDisplay.ratingText}</span>
                      <span className="text-xs text-neutral-400">
                        (
                        {ratingDisplay.reviewCountText}
                        )
                      </span>
                    </div>
                  ) : (
                    <div className="mb-2 rounded-full bg-neutral-100 px-3 py-1 text-center text-xs font-medium text-neutral-600">
                      {ratingDisplay.label}
                    </div>
                  )}

                  {/* Specialties */}
                  <div className="flex flex-wrap justify-center gap-1">
                    {tech.specialties.map(specialty => (
                      <span
                        key={specialty}
                        className="rounded-full px-2 py-0.5 text-xs font-medium text-neutral-600"
                        style={{ backgroundColor: themeVars.background }}
                      >
                        {specialty}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* "Any Artist" option */}
        <button
          type="button"
          onClick={() => handleSelectTech('any')}
          disabled={!hasBookableTechnicians}
          className="mt-4 w-full rounded-2xl border border-dashed bg-white/50 py-4 text-center transition-all hover:bg-white"
          style={{
            borderColor: `color-mix(in srgb, ${themeVars.primaryDark} 50%, transparent)`,
            opacity: mounted ? (hasBookableTechnicians ? 1 : 0.55) : 0,
            transition: 'opacity 300ms ease-out 500ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = themeVars.primaryDark;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = `color-mix(in srgb, ${themeVars.primaryDark} 50%, transparent)`;
          }}
        >
          <span className="text-base font-medium text-neutral-600">
            {hasBookableTechnicians
              ? '🎲 Surprise me with any available artist'
              : 'No compatible artists are assigned to this service yet'}
          </span>
        </button>

        {/* Footer */}
        <div
          className="mt-6 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 600ms',
          }}
        >
          <p className="text-xs text-neutral-400">
            All our artists are highly trained professionals
          </p>
        </div>

        {/* Spacer for floating dock when logged in */}
        {!isCheckingSession && isLoggedIn && isFirstStep && <div className="h-16" />}

        {/* Auth Footer - shown only on first step when not logged in */}
        {isFirstStep && !isCheckingSession && !isLoggedIn && (
          <BookingPhoneLogin
            onLoginSuccess={handleLoginSuccess}
          />
        )}
      </div>

      {/* Floating Dock - shown only when logged in and this is the first step */}
      {!isCheckingSession && isLoggedIn && isFirstStep && <BookingFloatingDock />}

      {/* Blocking Login Modal */}
      <BlockingLoginModal
        isOpen={isLoginModalOpen}
        onClose={handleCloseLoginModal}
        onLoginSuccess={handleModalLoginSuccess}
      />
    </div>
  );
}
