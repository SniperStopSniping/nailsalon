'use client';

import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

export type ServiceSummary = {
  id: string;
  name: string;
  price: number; // In dollars
  duration: number;
};

export type TechnicianSummary = {
  id: string;
  name: string;
  imageUrl: string;
} | null;

interface BookConfirmClientProps {
  services: ServiceSummary[];
  technician: TechnicianSummary;
  salonSlug: string;
  dateStr: string;
  timeStr: string;
}

// Confetti particle component
function Confetti({ delay, color, left }: { delay: number; color: string; left: number }) {
  return (
    <div
      className="absolute size-3 rounded-sm"
      style={{
        left: `${left}%`,
        top: '-10px',
        backgroundColor: color,
        animation: `confetti-fall 2.5s ease-out ${delay}s forwards`,
        transform: `rotate(${Math.random() * 360}deg)`,
      }}
    />
  );
}

// Sparkle component - uses theme primary color
function Sparkle({ delay, size, left, top }: { delay: number; size: number; left: number; top: number }) {
  return (
    <div
      className="absolute"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        animation: `sparkle 1s ease-out ${delay}s forwards`,
        opacity: 0,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"
          style={{ fill: themeVars.primary }}
        />
      </svg>
    </div>
  );
}

export function BookConfirmClient({
  services,
  technician,
  salonSlug,
  dateStr,
  timeStr,
}: BookConfirmClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  useSalon(); // Keep provider connection active
  const locale = (params?.locale as string) || 'en';
  const techId = searchParams.get('techId') || '';
  const clientPhone = searchParams.get('clientPhone') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';

  // Booking states
  const [isBooking, setIsBooking] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [hasExistingAppointment, setHasExistingAppointment] = useState(false);

  // Ref to prevent double booking in React StrictMode
  const bookingInitiatedRef = useRef(false);

  // Animation states
  const [stage, setStage] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showSparkles, setShowSparkles] = useState(false);
  const [pulseCheck, setPulseCheck] = useState(false);
  const [bounceEmoji, setBounceEmoji] = useState(false);

  // Name capture modal states
  const [showNameModal, setShowNameModal] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const nameCheckInitiatedRef = useRef(false);

  // Calculate totals from services passed by server
  const totalPrice = services.reduce((sum, service) => sum + service.price, 0);
  const totalDuration = services.reduce((sum, service) => sum + service.duration, 0);
  const serviceNames = services.map(s => s.name).join(' + ');
  const pointsEarned = Math.round(totalPrice * 0.1);

  // Start success animations
  const startSuccessAnimations = useCallback(() => {
    const timers = [
      setTimeout(() => setStage(1), 100),
      setTimeout(() => setPulseCheck(true), 300),
      setTimeout(() => setShowConfetti(true), 400),
      setTimeout(() => setShowSparkles(true), 500),
      setTimeout(() => setStage(2), 600),
      setTimeout(() => setBounceEmoji(true), 800),
      setTimeout(() => setStage(3), 900),
      setTimeout(() => setStage(4), 1100),
      setTimeout(() => setStage(5), 1400),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Create the booking
  const createBooking = useCallback(async () => {
    // Use ref for immediate check to prevent double booking in StrictMode
    if (bookingInitiatedRef.current) {
      return;
    }
    bookingInitiatedRef.current = true;

    setIsBooking(true);
    setBookingError(null);

    try {
      // Construct the start time from date and time strings
      const [hours, minutes] = timeStr.split(':').map(Number);
      const startTime = new Date(`${dateStr}T00:00:00`);
      startTime.setHours(hours || 9, minutes || 0, 0, 0);

      const requestBody = {
        salonSlug,
        serviceIds: services.map(s => s.id),
        technicianId: techId === 'any' ? null : techId,
        clientPhone,
        startTime: startTime.toISOString(),
        // If this is a reschedule, include the original appointment ID
        // The API will cancel the old appointment and bypass duplicate check
        ...(originalAppointmentId && { originalAppointmentId }),
      };
      
      // Debug: log what we're sending to the API
      console.log('[BookConfirm] originalAppointmentId from URL:', originalAppointmentId);
      console.log('[BookConfirm] Request body:', requestBody);

      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Check for existing appointment error
        if (errorData.error?.code === 'EXISTING_APPOINTMENT') {
          setHasExistingAppointment(true);
          setBookingError(errorData.error?.message || 'You already have an upcoming appointment.');
          return;
        }

        throw new Error(errorData.error?.message || 'Failed to create booking');
      }

      const data = await response.json();
      setAppointmentId(data.data.appointment.id);
      setBookingComplete(true);

      // Start success animations
      startSuccessAnimations();
    } catch (error) {
      console.error('Booking error:', error);
      setBookingError(error instanceof Error ? error.message : 'Failed to create booking');
    } finally {
      setIsBooking(false);
    }
  }, [isBooking, bookingComplete, dateStr, timeStr, salonSlug, services, techId, clientPhone, originalAppointmentId, startSuccessAnimations]);

  // Auto-create booking on mount
  useEffect(() => {
    if (services.length > 0 && dateStr && timeStr) {
      createBooking();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if we should show name modal after animations complete
  useEffect(() => {
    // Use ref for immediate check to prevent double execution in StrictMode
    if (stage >= 5 && bookingComplete && !nameCheckInitiatedRef.current) {
      nameCheckInitiatedRef.current = true;

      // Check for existing client_name cookie
      const clientNameCookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('client_name='));

      if (!clientNameCookie) {
        // Slight delay to let animations fully settle
        const timer = setTimeout(() => setShowNameModal(true), 800);
        return () => clearTimeout(timer);
      }
    }
    return;
  }, [stage, bookingComplete]);

  // Save name to server
  const handleSaveName = async () => {
    if (!firstName.trim() || isSavingName) return;

    setIsSavingName(true);
    try {
      const response = await fetch('/api/client/update-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: clientPhone,
          firstName: firstName.trim(),
        }),
      });

      if (response.ok) {
        // Cookie is set by the server, close modal
        setShowNameModal(false);
      } else {
        console.error('Failed to save name');
        // Still close modal on error - don't block the user
        setShowNameModal(false);
      }
    } catch (error) {
      console.error('Error saving name:', error);
      setShowNameModal(false);
    } finally {
      setIsSavingName(false);
    }
  };

  // Skip name capture
  const handleSkipName = () => {
    setShowNameModal(false);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) {
      return 'Not selected';
    }
    const date = new Date(`${dateString}T00:00:00`);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  };

  const formatTime = (timeString: string) => {
    if (!timeString) {
      return '';
    }
    const [hours, minutes] = timeString.split(':');
    const hour = Number.parseInt(hours || '0', 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const handleViewAppointment = () => {
    // Use actual booked service IDs and technician (same approach as Profile page)
    const bookedServiceIds = services.map(s => s.id).join(',');
    const bookedTechId = technician?.id || 'any';
    
    let changeUrl = `/${locale}/change-appointment?serviceIds=${bookedServiceIds}&techId=${bookedTechId}&date=${dateStr}&time=${timeStr}&clientPhone=${encodeURIComponent(clientPhone)}`;
    
    // Include appointmentId for rescheduling
    if (appointmentId) {
      changeUrl += `&originalAppointmentId=${encodeURIComponent(appointmentId)}`;
    }
    
    router.push(changeUrl);
  };

  // Confetti colors using theme variables
  const confettiColors = [
    themeVars.primary,
    themeVars.accent,
    themeVars.accentSelected,
    themeVars.primaryDark,
    themeVars.highlightBackground,
    themeVars.accentLight,
  ];

  // Show loading state while booking
  if (isBooking) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{
          background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
        }}
      >
        <div className="text-center">
          <div className="mb-4 text-6xl">💅</div>
          <p className="text-lg font-semibold" style={{ color: themeVars.accent }}>
            Confirming your appointment...
          </p>
        </div>
      </div>
    );
  }

  // Show existing appointment error with friendly UI
  if (hasExistingAppointment) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{
          background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
        }}
      >
        <div className="mx-auto max-w-[430px] px-4 text-center">
          <div className="mb-4 text-6xl">📅</div>
          <h1 className="mb-2 text-2xl font-bold text-neutral-900">
            You Already Have an Appointment!
          </h1>
          <p className="mb-6 text-neutral-500">
            Please change or cancel your existing appointment from your profile instead of booking a new one.
          </p>

          {/* Primary CTA - Go to Profile */}
          <button
            type="button"
            onClick={() => router.push(`/${locale}/profile`)}
            className="mb-3 w-full rounded-2xl px-6 py-4 text-lg font-bold text-neutral-900 shadow-lg transition-all hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
            style={{
              background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
            }}
          >
            View / Change Appointment
          </button>

          {/* Secondary - Go back to browse services */}
          <button
            type="button"
            onClick={() => router.push(`/${locale}/book/service`)}
            className="w-full rounded-2xl border-2 bg-white px-6 py-3 font-bold transition-all active:scale-[0.98]"
            style={{
              borderColor: themeVars.accent,
              color: themeVars.accent,
            }}
          >
            Browse Services
          </button>
        </div>
      </div>
    );
  }

  // Show generic error state
  if (bookingError) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{
          background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
        }}
      >
        <div className="mx-auto max-w-[430px] px-4 text-center">
          <div className="mb-4 text-6xl">😟</div>
          <h1 className="mb-2 text-2xl font-bold text-neutral-900">Oops!</h1>
          <p className="mb-6 text-neutral-500">{bookingError}</p>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-2xl px-6 py-3 font-bold text-white"
            style={{ backgroundColor: themeVars.accent }}
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen overflow-hidden"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      {/* CSS Animations - using theme CSS variables */}
      <style jsx>
        {`
        @keyframes confetti-fall {
          0% {
            transform: translateY(0) rotate(0deg) scale(1);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg) scale(0.5);
            opacity: 0;
          }
        }
        @keyframes sparkle {
          0% {
            transform: scale(0) rotate(0deg);
            opacity: 0;
          }
          50% {
            transform: scale(1.2) rotate(180deg);
            opacity: 1;
          }
          100% {
            transform: scale(0) rotate(360deg);
            opacity: 0;
          }
        }
        @keyframes bounce-in {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          50% {
            transform: scale(1.2);
          }
          70% {
            transform: scale(0.9);
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: 0 0 0 0 color-mix(in srgb, ${themeVars.primary} 70%, transparent);
          }
          50% {
            box-shadow: 0 0 0 20px transparent;
          }
        }
        @keyframes float {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-10px);
          }
        }
        @keyframes slide-up {
          from {
            transform: translateY(30px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes emoji-bounce {
          0%, 100% {
            transform: scale(1);
          }
          25% {
            transform: scale(1.3) rotate(-10deg);
          }
          50% {
            transform: scale(1.1) rotate(10deg);
          }
          75% {
            transform: scale(1.2) rotate(-5deg);
          }
        }
        @keyframes modal-fade-in {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        @keyframes modal-backdrop-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}
      </style>

      {/* Confetti Layer */}
      {showConfetti && (
        <div className="pointer-events-none fixed inset-0 z-50">
          {Array.from({ length: 50 }).map((_, i) => (
            <Confetti
              key={`confetti-${i}`}
              delay={Math.random() * 0.5}
              color={confettiColors[i % confettiColors.length] || themeVars.primary}
              left={Math.random() * 100}
            />
          ))}
        </div>
      )}

      {/* Name Capture Modal */}
      {showNameModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            animation: 'modal-backdrop-fade 0.3s ease-out forwards',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleSkipName();
          }}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"
            style={{
              animation: 'modal-fade-in 0.3s ease-out forwards',
            }}
          >
            <div className="mb-4 text-center">
              <div className="mb-3 text-4xl">👋</div>
              <h2
                className="text-xl font-bold"
                style={{ color: themeVars.titleText }}
              >
                Before you go...
              </h2>
              <p className="mt-1 text-neutral-500">
                What's your name?
              </p>
            </div>

            <div className="mb-4">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="w-full rounded-xl border-2 px-4 py-3 text-lg outline-none transition-colors"
                style={{
                  borderColor: themeVars.cardBorder,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = themeVars.accent;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = themeVars.cardBorder;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && firstName.trim()) {
                    handleSaveName();
                  }
                }}
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSkipName}
                className="flex-1 rounded-xl py-3 font-medium text-neutral-500 transition-colors hover:bg-neutral-100"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={handleSaveName}
                disabled={!firstName.trim() || isSavingName}
                className="flex-1 rounded-xl py-3 font-bold text-white transition-all disabled:opacity-50"
                style={{
                  background: `linear-gradient(to right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 80%, black))`,
                }}
              >
                {isSavingName ? 'Saving...' : 'Save'}
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-neutral-400">
              We'll remember you for next time!
            </p>
          </div>
        </div>
      )}

      <div className="relative mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        {/* Sparkles Layer */}
        {showSparkles && (
          <div className="pointer-events-none absolute inset-0">
            <Sparkle delay={0} size={24} left={15} top={10} />
            <Sparkle delay={0.2} size={18} left={80} top={15} />
            <Sparkle delay={0.4} size={20} left={25} top={25} />
            <Sparkle delay={0.3} size={16} left={70} top={8} />
            <Sparkle delay={0.5} size={22} left={90} top={20} />
          </div>
        )}

        {/* Success Icon */}
        <div className="flex flex-col items-center pb-4 pt-8">
          <div
            className="relative"
            style={{
              animation: stage >= 1 ? 'bounce-in 0.5s ease-out forwards' : 'none',
              opacity: stage >= 1 ? 1 : 0,
            }}
          >
            {/* Glow ring */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                animation: pulseCheck ? 'pulse-glow 1s ease-out' : 'none',
              }}
            />
            {/* Main checkmark circle - using theme gradient */}
            <div
              className="flex size-28 items-center justify-center rounded-full shadow-2xl"
              style={{
                background: `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`,
              }}
            >
              <svg
                width="56"
                height="56"
                viewBox="0 0 24 24"
                fill="none"
                className="text-white"
                style={{
                  strokeDasharray: 30,
                  strokeDashoffset: stage >= 1 ? 0 : 30,
                  transition: 'stroke-dashoffset 0.5s ease-out 0.3s',
                }}
              >
                <path
                  d="M20 6L9 17l-5-5"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          {/* Title - using theme titleText */}
          <h1
            className="mt-6 text-center text-3xl font-bold"
            style={{
              color: themeVars.titleText,
              animation: stage >= 2 ? 'slide-up 0.4s ease-out forwards' : 'none',
              opacity: stage >= 2 ? 1 : 0,
            }}
          >
            You're All Set!
            <span
              className="ml-2 inline-block"
              style={{
                animation: bounceEmoji ? 'emoji-bounce 0.6s ease-out' : 'none',
              }}
            >
              💅
            </span>
          </h1>
          <p
            className="mt-2 text-center text-neutral-500"
            style={{
              animation: stage >= 2 ? 'slide-up 0.4s ease-out 0.1s forwards' : 'none',
              opacity: stage >= 2 ? 1 : 0,
            }}
          >
            Your appointment is confirmed
          </p>
        </div>

        {/* Appointment Card - using theme cardBorder */}
        <div
          className="mb-6 overflow-hidden rounded-3xl bg-white shadow-xl"
          style={{
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: themeVars.cardBorder,
            animation: stage >= 3 ? 'slide-up 0.5s ease-out forwards' : 'none',
            opacity: stage >= 3 ? 1 : 0,
          }}
        >
          {/* Purple Header - using theme accent */}
          <div
            className="px-6 py-5"
            style={{
              background: `linear-gradient(to right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`,
            }}
          >
            <div className="flex items-center gap-4">
              {technician && (
                <div
                  className="relative size-16 shrink-0 overflow-hidden rounded-full border-[3px] border-white/30"
                  style={{ animation: stage >= 4 ? 'float 3s ease-in-out infinite' : 'none' }}
                >
                  <Image src={technician.imageUrl} alt={technician.name} fill className="object-cover" />
                </div>
              )}
              <div className="flex-1">
                <div className="text-sm text-white/70">Your nail artist</div>
                <div className="text-xl font-bold text-white">{technician?.name || 'Any Artist'}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-white/70">Total</div>
                <div
                  className="text-3xl font-bold"
                  style={{ color: themeVars.primary }}
                >
                  $
                  {totalPrice}
                </div>
              </div>
            </div>
          </div>

          {/* Details */}
          <div
            className="space-y-4 px-6 py-5"
            style={{
              animation: stage >= 4 ? 'slide-up 0.4s ease-out forwards' : 'none',
              opacity: stage >= 4 ? 1 : 0,
            }}
          >
            {/* Service - using theme background */}
            <div className="flex items-center gap-4">
              <div
                className="flex size-12 items-center justify-center rounded-xl text-2xl"
                style={{ backgroundColor: themeVars.background }}
              >
                💅
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wide text-neutral-400">Service</div>
                <div className="text-lg font-bold text-neutral-900">{serviceNames || 'Service'}</div>
              </div>
              <div className="text-sm text-neutral-500">
                {totalDuration}
                {' '}
                min
              </div>
            </div>

            {/* Date & Time */}
            <div className="flex items-center gap-4">
              <div
                className="flex size-12 items-center justify-center rounded-xl text-2xl"
                style={{ backgroundColor: themeVars.accentSelected }}
              >
                📅
              </div>
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wide text-neutral-400">When</div>
                <div className="text-lg font-bold text-neutral-900">{formatDate(dateStr)}</div>
                <div
                  className="text-sm font-medium"
                  style={{ color: themeVars.accent }}
                >
                  {formatTime(timeStr)}
                </div>
              </div>
            </div>

            {/* Points Earned - Clickable - using theme colors */}
            <button
              type="button"
              onClick={() => router.push('/rewards')}
              className="flex w-full cursor-pointer items-center gap-4 rounded-2xl p-4 text-left transition-all hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
              style={{
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: `color-mix(in srgb, ${themeVars.primary} 30%, transparent)`,
                background: `linear-gradient(to right, ${themeVars.highlightBackground}, ${themeVars.highlightBackground})`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = themeVars.primary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = `color-mix(in srgb, ${themeVars.primary} 30%, transparent)`;
              }}
            >
              <div
                className="flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl"
                style={{
                  backgroundColor: themeVars.primary,
                  animation: stage >= 4 ? 'float 2s ease-in-out infinite 0.5s' : 'none',
                }}
              >
                ⭐
              </div>
              <div className="flex-1">
                <div className="text-sm text-neutral-600">You'll earn</div>
                <div
                  className="text-xl font-bold"
                  style={{ color: themeVars.accent }}
                >
                  +
                  {pointsEarned}
                  {' '}
                  points
                </div>
              </div>
              <div
                className="flex items-center gap-1 text-xs font-medium"
                style={{ color: themeVars.accent }}
              >
                <span>View Rewards</span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div
          className="space-y-3"
          style={{
            animation: stage >= 5 ? 'slide-up 0.4s ease-out forwards' : 'none',
            opacity: stage >= 5 ? 1 : 0,
          }}
        >
          {/* Pay Now - Primary CTA - using theme gradient */}
          <button
            type="button"
            onClick={() => router.push(`/${locale}/payment?amount=${totalPrice}`)}
            className="flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-lg font-bold text-neutral-900 shadow-lg transition-all hover:scale-[1.02] hover:shadow-xl active:scale-[0.98]"
            style={{
              background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
            }}
          >
            <span className="text-xl">💳</span>
            Pay Now · $
            {totalPrice}
          </button>

          {/* Pay Later option */}
          <div className="py-1 text-center text-sm text-neutral-500">
            or pay at the salon
          </div>

          {/* View / Change - using theme accent */}
          <button
            type="button"
            onClick={handleViewAppointment}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 bg-white px-6 py-4 text-lg font-bold transition-all active:scale-[0.98]"
            style={{
              borderColor: themeVars.accent,
              color: themeVars.accent,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = themeVars.accent;
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'white';
              e.currentTarget.style.color = themeVars.accent;
            }}
          >
            View or Change Appointment
          </button>

          {/* Back to Home - using theme accent on hover */}
          <button
            type="button"
            onClick={() => router.push(`/${locale}/profile`)}
            className="w-full py-3 text-center text-base font-medium text-neutral-500 transition-colors"
            onMouseEnter={(e) => {
              e.currentTarget.style.color = themeVars.accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '';
            }}
          >
            Back to Profile →
          </button>
        </div>

        {/* Fun Footer */}
        <div
          className="mt-8 text-center"
          style={{
            animation: stage >= 5 ? 'slide-up 0.4s ease-out 0.2s forwards' : 'none',
            opacity: stage >= 5 ? 1 : 0,
          }}
        >
          <div className="mb-2 text-4xl">
            <span style={{ animation: 'float 2s ease-in-out infinite' }} className="inline-block">✨</span>
            <span style={{ animation: 'float 2s ease-in-out infinite 0.3s' }} className="mx-1 inline-block">💜</span>
            <span style={{ animation: 'float 2s ease-in-out infinite 0.6s' }} className="inline-block">✨</span>
          </div>
          <p className="text-sm text-neutral-400">
            We can't wait to see you!
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            📱 We'll send you a text reminder
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            Free cancellation up to 24 hours before
          </p>
          {appointmentId && (
            <p className="mt-2 text-xs text-neutral-300">
              Booking ID:
              {' '}
              {appointmentId}
            </p>
          )}
        </div>

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}

