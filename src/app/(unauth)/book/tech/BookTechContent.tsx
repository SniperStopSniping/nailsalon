'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { AnimatedCheckmark, ShakeWrapper } from '@/components/animated';
import { BookingFloatingDock } from '@/components/booking/BookingFloatingDock';
import { ANIMATION } from '@/libs/animations';
import { triggerHaptic } from '@/libs/haptics';
import { useSalon } from '@/providers/SalonProvider';

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
  price: number;
  duration: number;
};

type BookTechContentProps = {
  technicians: TechnicianData[];
  services: ServiceSummary[];
};

export function BookTechContent({ technicians, services }: BookTechContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { salonName } = useSalon();
  const serviceIds = searchParams.get('serviceIds')?.split(',') || [];
  const clientPhone = searchParams.get('clientPhone') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const locationId = searchParams.get('locationId') || '';
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const serviceNames = services.map(s => s.name).join(' + ');
  const totalPrice = services.reduce((sum, s) => sum + s.price, 0);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSelectTech = useCallback((techId: string) => {
    // Only trigger haptic if selection is changing
    if (selectedTech !== techId) {
      triggerHaptic('select');
    }
    setSelectedTech(techId);
  }, [selectedTech]);

  const handleContinue = useCallback(() => {
    if (!selectedTech) {
      // No selection - trigger error haptic and shake
      triggerHaptic('error');
      setIsShaking(true);
      return;
    }
    // Valid selection - trigger confirm haptic and navigate
    triggerHaptic('confirm');
    const params = new URLSearchParams();
    params.set('serviceIds', serviceIds.join(','));
    params.set('techId', selectedTech);
    if (clientPhone) {
      params.set('clientPhone', clientPhone);
    }
    if (originalAppointmentId) {
      params.set('originalAppointmentId', originalAppointmentId);
    }
    if (locationId) {
      params.set('locationId', locationId);
    }
    router.push(`/book/time?${params.toString()}`);
  }, [selectedTech, serviceIds, clientPhone, originalAppointmentId, locationId, router]);

  return (
    <div
      className="min-h-screen pb-32"
      style={{
        background: `linear-gradient(to bottom, var(--n5-bg-page), color-mix(in srgb, var(--n5-bg-page) 95%, var(--n5-accent-hover)))`,
      }}
    >
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
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60"
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
          <h1 className="font-heading mb-1 text-2xl font-bold text-[var(--n5-ink-main)]">Choose Your Artist</h1>
          <p className="font-body text-sm text-[var(--n5-ink-muted)]">{serviceNames || 'Select a technician'}</p>
        </div>

        {/* Technicians Grid */}
        <div className="space-y-3">
          {/* Any Artist Option */}
          <motion.button
            type="button"
            onClick={() => handleSelectTech('any')}
            className="bg-[var(--n5-bg-card)]/80 w-full overflow-hidden p-4 shadow-[var(--n5-shadow-md)] backdrop-blur-sm"
            style={{
              borderRadius: 'var(--n5-radius-card)',
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
            }}
            whileTap={{ scale: ANIMATION.scale.tap }}
            animate={{
              borderWidth: 2,
              borderColor: selectedTech === 'any' ? 'var(--n5-accent)' : 'var(--n5-border)',
              boxShadow: selectedTech === 'any'
                ? '0 4px 20px rgba(214, 162, 73, 0.15)'
                : '0 4px 20px rgba(0,0,0,0.08)',
            }}
            transition={{ duration: ANIMATION.glowFade / 1000 }}
          >
            <div className="flex items-center gap-4">
              <motion.div
                className="flex size-16 items-center justify-center bg-[var(--n5-bg-surface)] text-2xl"
                style={{ borderRadius: 'var(--n5-radius-pill)' }}
                animate={{
                  scale: selectedTech === 'any' ? 1.05 : 1,
                  boxShadow: selectedTech === 'any'
                    ? '0 4px 12px rgba(0,0,0,0.1)'
                    : '0 0 0 rgba(0,0,0,0)',
                }}
                transition={{ type: 'spring', ...ANIMATION.spring }}
              >
                🎲
              </motion.div>
              <div className="flex-1 text-left">
                <h3 className="font-body text-base font-bold text-[var(--n5-ink-main)]">Any Available Artist</h3>
                <p className="font-body text-sm text-[var(--n5-ink-muted)]">First available appointment</p>
              </div>
              <AnimatedCheckmark
                isVisible={selectedTech === 'any'}
                size={24}
                backgroundColor="var(--n5-accent)"
              />
            </div>
          </motion.button>

          {/* Individual Technicians */}
          {technicians.map((tech, index) => {
            const isSelected = selectedTech === tech.id;
            return (
              <motion.button
                key={tech.id}
                type="button"
                onClick={() => handleSelectTech(tech.id)}
                className="bg-[var(--n5-bg-card)]/80 w-full overflow-hidden p-4 shadow-[var(--n5-shadow-md)] backdrop-blur-sm"
                style={{
                  borderRadius: 'var(--n5-radius-card)',
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(10px)',
                  transition: `opacity 300ms ease-out ${150 + index * 50}ms, transform 300ms ease-out ${150 + index * 50}ms`,
                }}
                whileTap={{ scale: ANIMATION.scale.tap }}
                animate={{
                  borderWidth: 2,
                  borderColor: isSelected ? 'var(--n5-accent)' : 'var(--n5-border)',
                  boxShadow: isSelected
                    ? '0 4px 20px rgba(214, 162, 73, 0.15)'
                    : '0 4px 20px rgba(0,0,0,0.08)',
                }}
                transition={{ duration: ANIMATION.glowFade / 1000 }}
              >
                <div className="flex items-center gap-4">
                  {/* Profile photo with lift effect */}
                  <motion.div
                    className="relative size-16 overflow-hidden"
                    style={{ borderRadius: 'var(--n5-radius-pill)' }}
                    animate={{
                      scale: isSelected ? 1.05 : 1,
                      boxShadow: isSelected
                        ? '0 4px 12px rgba(0,0,0,0.15)'
                        : '0 0 0 rgba(0,0,0,0)',
                    }}
                    transition={{ type: 'spring', ...ANIMATION.spring }}
                  >
                    <Image
                      src={tech.imageUrl}
                      alt={tech.name}
                      fill
                      className="object-cover"
                    />
                  </motion.div>
                  <div className="flex-1 text-left">
                    <h3 className="font-body text-base font-bold text-[var(--n5-ink-main)]">{tech.name}</h3>
                    <p className="font-body text-sm text-[var(--n5-ink-muted)]">
                      {tech.specialties.slice(0, 2).join(' · ') || 'All services'}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[var(--n5-warning)]">★</span>
                      <span className="font-body text-sm font-medium text-[var(--n5-ink-main)]">{tech.rating.toFixed(1)}</span>
                      <span className="font-body text-sm text-[var(--n5-ink-muted)]">
                        (
                        {tech.reviewCount}
                        )
                      </span>
                    </div>
                  </div>
                  <AnimatedCheckmark
                    isVisible={isSelected}
                    size={24}
                    backgroundColor="var(--n5-accent)"
                  />
                </div>
              </motion.button>
            );
          })}
        </div>

        {/* Price Summary */}
        {services.length > 0 && (
          <div
            className="bg-[var(--n5-bg-card)]/60 mt-6 p-4"
            style={{
              borderRadius: 'var(--n5-radius-md)',
              opacity: mounted ? 1 : 0,
              transition: 'opacity 300ms ease-out 400ms',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="font-body text-sm text-[var(--n5-ink-muted)]">Estimated Total</span>
              <span className="font-body text-lg font-bold text-[var(--n5-accent)]">
                $
                {totalPrice.toFixed(0)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Fixed Bottom CTA */}
      <div className="bg-[var(--n5-bg-card)]/80 fixed inset-x-0 bottom-0 px-4 pb-8 pt-4 backdrop-blur-md">
        <div className="mx-auto max-w-[430px]">
          <ShakeWrapper isShaking={isShaking} onShakeComplete={() => setIsShaking(false)}>
            <motion.button
              type="button"
              onClick={handleContinue}
              disabled={!selectedTech}
              className={`font-body w-full py-4 text-base font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selectedTech ? 'text-[var(--n5-button-primary-text)] shadow-[var(--n5-shadow-sm)]' : 'bg-[var(--n5-border)] text-[var(--n5-ink-muted)]'
              }`}
              style={{
                borderRadius: 'var(--n5-radius-md)',
                background: selectedTech
                  ? `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover))`
                  : undefined,
              }}
              whileTap={selectedTech ? { scale: 0.98 } : undefined}
              // Spring animation when button becomes enabled
              animate={selectedTech
                ? {
                    y: [4, 0],
                    opacity: [0.8, 1],
                  }
                : {}}
              transition={{ type: 'spring', ...ANIMATION.spring }}
            >
              Continue to Select Time
            </motion.button>
          </ShakeWrapper>
        </div>
      </div>

      <BookingFloatingDock />
    </div>
  );
}
