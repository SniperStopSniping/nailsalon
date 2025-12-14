'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AnimatedCheckmark, ShakeWrapper } from '@/components/animated';
import { ANIMATION } from '@/libs/animations';
import { triggerHaptic } from '@/libs/haptics';
import { useSalon } from '@/providers/SalonProvider';

export type ServiceSummary = {
  id: string;
  name: string;
  price: number;
  duration: number;
};

export type TechnicianSummary = {
  id: string;
  name: string;
  imageUrl: string;
} | null;

type BookConfirmContentProps = {
  services: ServiceSummary[];
  technician: TechnicianSummary;
  salonSlug: string;
  dateStr: string;
  timeStr: string;
};

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

function Sparkle({ delay, size, left, top }: { delay: number; size: number; left: number; top: number }) {
  return (
    <div
      className="absolute bg-[var(--n5-accent)]"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: size,
        height: size,
        borderRadius: '50%',
        animation: `sparkle 1.5s ease-in-out ${delay}s infinite`,
        boxShadow: `0 0 ${size * 2}px var(--n5-accent)`,
      }}
    />
  );
}

export function BookConfirmContent({ services, technician, salonSlug, dateStr, timeStr }: BookConfirmContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { salonName } = useSalon();
  const serviceIds = searchParams.get('serviceIds')?.split(',') || [];
  const clientPhone = searchParams.get('clientPhone') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';

  const [mounted, setMounted] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const phoneInputRef = useRef<HTMLInputElement>(null);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) {
      return digits;
    }
    if (digits.length <= 6) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    }
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  useEffect(() => {
    setMounted(true);
    // Use clientPhone from URL if provided (e.g., for rescheduling), otherwise load from cookie
    if (clientPhone) {
      setPhone(formatPhone(clientPhone));
    } else {
      const savedPhone = document.cookie.split('; ').find(row => row.startsWith('client_phone='))?.split('=')[1];
      if (savedPhone) {
        setPhone(decodeURIComponent(savedPhone));
      }
    }
    const savedName = document.cookie.split('; ').find(row => row.startsWith('client_name='))?.split('=')[1];
    if (savedName) {
      setName(decodeURIComponent(savedName));
    }
  }, [clientPhone]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setPhone(formatted);
  };

  const handleConfirm = useCallback(async () => {
    if (!phone || !name) {
      setError('Please enter your name and phone number');
      triggerHaptic('error');
      setIsShaking(true);
      return;
    }

    const normalizedPhone = phone.replace(/\D/g, '');
    if (normalizedPhone.length !== 10) {
      setError('Please enter a valid 10-digit phone number');
      triggerHaptic('error');
      setIsShaking(true);
      return;
    }

    // Trigger confirm haptic when starting the booking
    triggerHaptic('confirm');
    setIsConfirming(true);
    setError(null);

    try {
      // Save to cookies
      document.cookie = `client_phone=${encodeURIComponent(phone)}; path=/; max-age=31536000`;
      document.cookie = `client_name=${encodeURIComponent(name)}; path=/; max-age=31536000`;

      const appointmentData = {
        salonSlug,
        serviceIds,
        techId: technician?.id || 'any',
        date: dateStr,
        time: timeStr,
        clientPhone: normalizedPhone,
        clientName: name,
        originalAppointmentId: originalAppointmentId || undefined,
      };

      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appointmentData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || 'Failed to book appointment');
      }

      // Success! Trigger success haptic
      triggerHaptic('success');
      setIsConfirmed(true);
      setShowConfetti(true);

      setTimeout(() => {
        router.push('/profile');
      }, 3000);
    } catch (err) {
      console.error('Booking error:', err);
      setError(err instanceof Error ? err.message : 'Failed to book appointment');
      triggerHaptic('error');
    } finally {
      setIsConfirming(false);
    }
  }, [phone, name, salonSlug, serviceIds, technician, dateStr, timeStr, originalAppointmentId, router]);

  const serviceNames = services.map(s => s.name).join(' + ');
  const totalPrice = services.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = services.reduce((sum, s) => sum + s.duration, 0);

  // Format date for display
  const displayDate = dateStr
    ? new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
    : '';

  // Format time for display
  const displayTime = timeStr
    ? (() => {
        const parts = timeStr.split(':').map(Number);
        const hours = parts[0] ?? 0;
        const minutes = parts[1] ?? 0;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 || 12;
        return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
      })()
    : '';

  const isReadyToConfirm = phone && name;

  return (
    <div
      className="min-h-screen pb-32"
      style={{
        background: `linear-gradient(to bottom, var(--n5-bg-page), color-mix(in srgb, var(--n5-bg-page) 95%, var(--n5-accent-hover)))`,
      }}
    >
      <style jsx global>
        {`
        @keyframes confetti-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes sparkle {
          0%, 100% { opacity: 0; transform: scale(0); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}
      </style>

      {showConfetti && (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
          {Array.from({ length: 50 }).map((_, i) => (
            <Confetti
              key={i}
              delay={Math.random() * 0.5}
              color={['#D6A249', '#FDF7F0', '#3F2B24', '#FF6B6B', '#4ECDC4'][Math.floor(Math.random() * 5)] || '#D6A249'}
              left={Math.random() * 100}
            />
          ))}
          {Array.from({ length: 20 }).map((_, i) => (
            <Sparkle
              key={i}
              delay={Math.random() * 2}
              size={4 + Math.random() * 8}
              left={Math.random() * 100}
              top={Math.random() * 100}
            />
          ))}
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        {/* Header */}
        <div
          className="relative flex items-center pb-2 pt-5"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <motion.button
            type="button"
            onClick={handleBack}
            aria-label="Go back"
            className="hover:bg-[var(--n5-bg-card)]/60 z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200"
            whileTap={{ scale: 0.95 }}
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.button>
          <div
            className="font-heading absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight text-[var(--n5-accent)]"
          >
            {salonName}
          </div>
        </div>

        {/* Title */}
        <div
          className="mb-6 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 50ms, transform 300ms ease-out 50ms',
          }}
        >
          <motion.h1
            className="font-heading mb-1 text-2xl font-bold text-[var(--n5-ink-main)]"
            animate={isConfirmed ? { scale: [1, 1.05, 1] } : {}}
            transition={{ duration: 0.3 }}
          >
            {isConfirmed ? 'Booking Confirmed!' : 'Confirm Your Booking'}
          </motion.h1>
          <p className="font-body text-sm text-[var(--n5-ink-muted)]">
            {isConfirmed ? 'See you soon!' : 'Review your appointment details'}
          </p>
          {/* Success checkmark */}
          {isConfirmed && (
            <motion.div
              className="mx-auto mt-4"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', ...ANIMATION.checkmarkSpring, delay: 0.2 }}
            >
              <AnimatedCheckmark
                isVisible={isConfirmed}
                size={64}
                backgroundColor="var(--n5-accent)"
              />
            </motion.div>
          )}
        </div>

        {/* Booking Summary Card */}
        <motion.div
          className="bg-[var(--n5-bg-card)]/80 mb-6 overflow-hidden border border-[var(--n5-border)] p-5 shadow-[var(--n5-shadow-md)] backdrop-blur-sm"
          style={{
            borderRadius: 'var(--n5-radius-card)',
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
          // Slide up animation on success
          animate={isConfirmed
            ? {
                y: [-ANIMATION.slideY, 0],
                boxShadow: '0 8px 30px rgba(214, 162, 73, 0.2)',
              }
            : {}}
          transition={{ type: 'spring', ...ANIMATION.spring }}
        >
          {/* Service Info */}
          <div className="mb-4 flex items-start gap-4">
            <div
              className="flex size-12 items-center justify-center bg-[var(--n5-bg-surface)] text-xl"
              style={{ borderRadius: 'var(--n5-radius-md)' }}
            >
              💅
            </div>
            <div className="flex-1">
              <h3 className="font-body text-base font-bold text-[var(--n5-ink-main)]">{serviceNames || 'Service'}</h3>
              <p className="font-body text-sm text-[var(--n5-ink-muted)]">
                {totalDuration}
                {' '}
                minutes
              </p>
            </div>
            <div className="text-right">
              <span className="font-body text-lg font-bold text-[var(--n5-accent)]">
                $
                {totalPrice.toFixed(0)}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 h-px bg-[var(--n5-border)]" />

          {/* Technician */}
          <div className="mb-4 flex items-center gap-3">
            <div
              className="relative size-10 overflow-hidden"
              style={{ borderRadius: 'var(--n5-radius-pill)' }}
            >
              {technician
                ? (
                    <Image src={technician.imageUrl} alt={technician.name} fill className="object-cover" />
                  )
                : (
                    <div
                      className="flex size-full items-center justify-center bg-[var(--n5-bg-surface)] text-lg"
                    >
                      🎲
                    </div>
                  )}
            </div>
            <div>
              <p className="font-body text-xs text-[var(--n5-ink-muted)]">Artist</p>
              <p className="font-body font-medium text-[var(--n5-ink-main)]">{technician?.name || 'Any Available'}</p>
            </div>
          </div>

          {/* Date & Time */}
          <div className="flex items-center gap-3">
            <div
              className="flex size-10 items-center justify-center bg-[var(--n5-bg-surface)] text-lg"
              style={{ borderRadius: 'var(--n5-radius-pill)' }}
            >
              📅
            </div>
            <div>
              <p className="font-body text-xs text-[var(--n5-ink-muted)]">Date & Time</p>
              <p className="font-body font-medium text-[var(--n5-ink-main)]">
                {displayDate}
                {' '}
                at
                {' '}
                {displayTime}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Contact Info */}
        {!isConfirmed && (
          <ShakeWrapper isShaking={isShaking} onShakeComplete={() => setIsShaking(false)}>
            <div
              className="bg-[var(--n5-bg-card)]/80 mb-6 overflow-hidden border border-[var(--n5-border)] p-5 shadow-[var(--n5-shadow-md)] backdrop-blur-sm"
              style={{
                borderRadius: 'var(--n5-radius-card)',
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(10px)',
                transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
              }}
            >
              <h3 className="font-body mb-4 text-base font-bold text-[var(--n5-ink-main)]">Your Information</h3>

              <div className="space-y-4">
                <div>
                  <label className="font-body mb-1 block text-sm font-medium text-[var(--n5-ink-main)]">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Your name"
                    className="font-body w-full border border-[var(--n5-border)] bg-[var(--n5-bg-card)] px-4 py-3 text-base text-[var(--n5-ink-main)] outline-none transition-all"
                    style={{
                      borderRadius: 'var(--n5-radius-md)',
                    }}
                  />
                </div>
                <div>
                  <label className="font-body mb-1 block text-sm font-medium text-[var(--n5-ink-main)]">Phone Number</label>
                  <input
                    ref={phoneInputRef}
                    type="tel"
                    value={phone}
                    onChange={handlePhoneChange}
                    placeholder="(555) 123-4567"
                    className="font-body w-full border border-[var(--n5-border)] bg-[var(--n5-bg-card)] px-4 py-3 text-base text-[var(--n5-ink-main)] outline-none transition-all"
                    style={{
                      borderRadius: 'var(--n5-radius-md)',
                    }}
                  />
                </div>
              </div>
            </div>
          </ShakeWrapper>
        )}

        {error && (
          <motion.p
            className="font-body mb-4 text-center text-sm text-[var(--n5-error)]"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {error}
          </motion.p>
        )}
      </div>

      {/* Fixed Bottom CTA */}
      {!isConfirmed && (
        <div className="bg-[var(--n5-bg-card)]/80 fixed inset-x-0 bottom-0 px-4 pb-8 pt-4 backdrop-blur-md">
          <div className="mx-auto max-w-[430px]">
            <motion.button
              type="button"
              onClick={handleConfirm}
              disabled={isConfirming || !isReadyToConfirm}
              className={`font-body w-full py-4 text-base font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isReadyToConfirm ? 'text-[var(--n5-button-primary-text)] shadow-[var(--n5-shadow-sm)]' : 'bg-[var(--n5-border)] text-[var(--n5-ink-muted)]'
              }`}
              style={{
                borderRadius: 'var(--n5-radius-md)',
                background: isReadyToConfirm
                  ? `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover))`
                  : undefined,
              }}
              whileTap={isReadyToConfirm && !isConfirming ? { scale: 0.98 } : undefined}
              // Spring animation when button becomes enabled
              animate={isReadyToConfirm
                ? {
                    y: [4, 0],
                    opacity: [0.8, 1],
                  }
                : {}}
              transition={{ type: 'spring', ...ANIMATION.spring }}
            >
              {isConfirming ? 'Confirming...' : 'Confirm Booking'}
            </motion.button>
          </div>
        </div>
      )}
    </div>
  );
}
