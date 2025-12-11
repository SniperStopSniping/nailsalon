'use client';

import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BlockingLoginModal } from '@/components/BlockingLoginModal';
import { BookingFloatingDock } from '@/components/booking/BookingFloatingDock';
import { BookingPhoneLogin } from '@/components/booking/BookingPhoneLogin';
import { useBookingAuth } from '@/hooks/useBookingAuth';
import { type BookingStep, getFirstStep, getNextStep, getPrevStep, getStepIndex, getStepLabel } from '@/libs/bookingFlow';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

export type TechnicianData = {
  id: string;
  name: string;
  imageUrl: string;
  specialties: string[];
  rating: number;
  reviewCount: number;
};

export type ServiceSummary = {
  id: string;
  name: string;
  price: number; // In dollars
  duration: number;
};

type BookTechClientProps = {
  technicians: TechnicianData[];
  services: ServiceSummary[];
  bookingFlow: BookingStep[];
};

export function BookTechClient({ technicians, services, bookingFlow }: BookTechClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const serviceIds = searchParams.get('serviceIds')?.split(',') || [];
  const clientPhone = searchParams.get('clientPhone') || '';

  // Check if this is the first step in the booking flow (for dock/login visibility)
  const isFirstStep = getFirstStep(bookingFlow) === 'tech';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';

  // Use shared auth hook
  const { isLoggedIn, phone, isCheckingSession, handleLoginSuccess } = useBookingAuth(clientPhone || undefined);

  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [pendingTechId, setPendingTechId] = useState<string | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Use services passed from server, fallback to URL params for service names
  const serviceNames = services.map(s => s.name).join(' + ');
  const totalPrice = services.reduce((sum, s) => sum + s.price, 0);

  const goToNextStep = (techId: string, clientPhoneToUse: string) => {
    const nextStep = getNextStep('tech', bookingFlow);
    if (!nextStep) {
      return;
    }

    let url = `/${locale}/book/${nextStep}?serviceIds=${serviceIds.join(',')}&techId=${techId}&clientPhone=${encodeURIComponent(clientPhoneToUse)}`;

    // Pass through originalAppointmentId for reschedule flow
    if (originalAppointmentId) {
      url += `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`;
    }

    router.push(url);
  };

  const handleSelectTech = (techId: string) => {
    // Always allow selection
    setSelectedTech(techId);

    // Gate navigation on login when this is the first step
    if (isFirstStep && !isLoggedIn) {
      setPendingTechId(techId);
      setIsLoginModalOpen(true);
      return;
    }

    // Use the phone from auth hook (may be updated after login)
    const phoneToUse = phone || clientPhone;
    setTimeout(() => {
      goToNextStep(techId, phoneToUse);
    }, 300);
  };

  // Handle login success from the blocking modal
  const handleModalLoginSuccess = (verifiedPhone: string) => {
    handleLoginSuccess(verifiedPhone);
    setIsLoginModalOpen(false);

    if (pendingTechId) {
      setSelectedTech(pendingTechId);
      setTimeout(() => {
        goToNextStep(pendingTechId, verifiedPhone);
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
      let url = `/${locale}/book/${prevStep}?serviceIds=${serviceIds.join(',')}&clientPhone=${encodeURIComponent(clientPhone)}`;
      if (originalAppointmentId) {
        url += `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`;
      }
      router.push(url);
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
        {/* Header */}
        <div
          className="relative flex items-center pb-4 pt-6"
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
          className="mb-6 flex items-center justify-center gap-2"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 50ms',
          }}
        >
          {bookingFlow.map((step, i) => {
            const currentIdx = getStepIndex('tech', bookingFlow);
            const isCurrentStep = step === 'tech';
            const isPastStep = i + 1 < currentIdx;
            return (
              <div key={step} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 ${isCurrentStep ? 'opacity-100' : 'opacity-40'}`}>
                  <div
                    className="flex size-6 items-center justify-center rounded-full text-xs font-bold"
                    style={{
                      backgroundColor: isPastStep ? themeVars.accent : isCurrentStep ? themeVars.primary : '#d4d4d4',
                      color: isPastStep ? 'white' : isCurrentStep ? '#171717' : '#525252',
                    }}
                  >
                    {isPastStep ? '✓' : i + 1}
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

        {/* Service Summary */}
        <div
          className="mb-6 overflow-hidden rounded-2xl shadow-xl"
          style={{
            background: `linear-gradient(to bottom right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <div className="px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="mb-0.5 text-xs text-white/70">You selected</div>
                <div className="text-lg font-bold text-white">{serviceNames || 'Service'}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold" style={{ color: themeVars.primary }}>
                  $
                  {totalPrice}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Title */}
        <div
          className="mb-5 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
          }}
        >
          <h1 className="text-2xl font-bold text-neutral-900">
            Choose Your Artist
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Select your favorite nail technician
          </p>
        </div>

        {/* Technicians grid */}
        <div className="grid grid-cols-2 gap-3">
          {technicians.map((tech, index) => {
            const isSelected = selectedTech === tech.id;
            return (
              <button
                key={tech.id}
                type="button"
                onClick={() => handleSelectTech(tech.id)}
                className="relative overflow-hidden rounded-2xl text-left transition-all duration-300"
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
                  opacity: mounted ? 1 : 0,
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
                    <Image
                      src={tech.imageUrl}
                      alt={tech.name}
                      fill
                      className="object-cover"
                    />
                  </div>

                  {/* Name */}
                  <div className="mb-1 text-lg font-bold text-neutral-900">
                    {tech.name}
                  </div>

                  {/* Rating */}
                  <div className="mb-2 flex items-center gap-1.5">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map(star => (
                        <svg
                          key={star}
                          width="14"
                          height="14"
                          viewBox="0 0 12 12"
                          style={{ fill: star <= Math.floor(tech.rating) ? themeVars.primary : '#e5e5e5' }}
                        >
                          <path d="M6 0L7.5 4.5L12 4.5L8.25 7.5L9.75 12L6 9L2.25 12L3.75 7.5L0 4.5L4.5 4.5L6 0Z" />
                        </svg>
                      ))}
                    </div>
                    <span className="text-sm font-bold text-neutral-900">{tech.rating}</span>
                    <span className="text-xs text-neutral-400">
                      (
                      {tech.reviewCount}
                      )
                    </span>
                  </div>

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
          className="mt-4 w-full rounded-2xl border border-dashed bg-white/50 py-4 text-center transition-all hover:bg-white"
          style={{
            borderColor: `color-mix(in srgb, ${themeVars.primaryDark} 50%, transparent)`,
            opacity: mounted ? 1 : 0,
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
            🎲 Surprise me with any available artist
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
            initialPhone={clientPhone || undefined}
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
