'use client';

import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

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

interface BookTechContentProps {
  technicians: TechnicianData[];
  services: ServiceSummary[];
}

export function BookTechContent({ technicians, services }: BookTechContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { salonName } = useSalon();
  const serviceIds = searchParams.get('serviceIds')?.split(',') || [];
  const clientPhone = searchParams.get('clientPhone') || '';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const serviceNames = services.map(s => s.name).join(' + ');
  const totalPrice = services.reduce((sum, s) => sum + s.price, 0);

  const handleBack = () => {
    router.back();
  };

  const handleContinue = () => {
    if (!selectedTech) return;
    const params = new URLSearchParams();
    params.set('serviceIds', serviceIds.join(','));
    params.set('techId', selectedTech);
    if (clientPhone) params.set('clientPhone', clientPhone);
    if (originalAppointmentId) params.set('originalAppointmentId', originalAppointmentId);
    router.push(`/book/time?${params.toString()}`);
  };

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
          <div
            className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight font-heading text-[var(--n5-accent)]"
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
          <h1 className="mb-1 text-2xl font-bold font-heading text-[var(--n5-ink-main)]">Choose Your Artist</h1>
          <p className="text-sm font-body text-[var(--n5-ink-muted)]">{serviceNames || 'Select a technician'}</p>
        </div>

        {/* Technicians Grid */}
        <div className="space-y-3">
          {/* Any Artist Option */}
          <button
            type="button"
            onClick={() => setSelectedTech('any')}
            className={`w-full overflow-hidden p-4 shadow-[var(--n5-shadow-md)] backdrop-blur-sm transition-all duration-200 bg-[var(--n5-bg-card)]/80 ${
              selectedTech === 'any' ? 'border-2 border-[var(--n5-accent)]' : 'border-2 border-[var(--n5-border)]'
            }`}
            style={{
              borderRadius: 'var(--n5-radius-card)',
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms, border-color 200ms',
            }}
          >
            <div className="flex items-center gap-4">
              <div
                className="flex size-16 items-center justify-center text-2xl bg-[var(--n5-bg-surface)]"
                style={{ borderRadius: 'var(--n5-radius-pill)' }}
              >
                🎲
              </div>
              <div className="flex-1 text-left">
                <h3 className="text-base font-bold font-body text-[var(--n5-ink-main)]">Any Available Artist</h3>
                <p className="text-sm font-body text-[var(--n5-ink-muted)]">First available appointment</p>
              </div>
              {selectedTech === 'any' && (
                <div
                  className="flex size-6 items-center justify-center bg-[var(--n5-accent)]"
                  style={{ borderRadius: 'var(--n5-radius-pill)' }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7L6 10L11 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>
          </button>

          {/* Individual Technicians */}
          {technicians.map((tech, index) => (
            <button
              key={tech.id}
              type="button"
              onClick={() => setSelectedTech(tech.id)}
              className={`w-full overflow-hidden p-4 shadow-[var(--n5-shadow-md)] backdrop-blur-sm transition-all duration-200 bg-[var(--n5-bg-card)]/80 ${
                selectedTech === tech.id ? 'border-2 border-[var(--n5-accent)]' : 'border-2 border-[var(--n5-border)]'
              }`}
              style={{
                borderRadius: 'var(--n5-radius-card)',
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(10px)',
                transition: `opacity 300ms ease-out ${150 + index * 50}ms, transform 300ms ease-out ${150 + index * 50}ms, border-color 200ms`,
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="relative size-16 overflow-hidden"
                  style={{ borderRadius: 'var(--n5-radius-pill)' }}
                >
                  <Image
                    src={tech.imageUrl}
                    alt={tech.name}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="flex-1 text-left">
                  <h3 className="text-base font-bold font-body text-[var(--n5-ink-main)]">{tech.name}</h3>
                  <p className="text-sm font-body text-[var(--n5-ink-muted)]">
                    {tech.specialties.slice(0, 2).join(' · ') || 'All services'}
                  </p>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-[var(--n5-warning)]">★</span>
                    <span className="text-sm font-medium font-body text-[var(--n5-ink-main)]">{tech.rating.toFixed(1)}</span>
                    <span className="text-sm font-body text-[var(--n5-ink-muted)]">({tech.reviewCount})</span>
                  </div>
                </div>
                {selectedTech === tech.id && (
                  <div
                    className="flex size-6 items-center justify-center bg-[var(--n5-accent)]"
                    style={{ borderRadius: 'var(--n5-radius-pill)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7L6 10L11 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Price Summary */}
        {services.length > 0 && (
          <div
            className="mt-6 p-4 bg-[var(--n5-bg-card)]/60"
            style={{
              borderRadius: 'var(--n5-radius-md)',
              opacity: mounted ? 1 : 0,
              transition: 'opacity 300ms ease-out 400ms',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-body text-[var(--n5-ink-muted)]">Estimated Total</span>
              <span className="text-lg font-bold font-body text-[var(--n5-accent)]">
                ${totalPrice.toFixed(0)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Fixed Bottom CTA */}
      <div className="fixed inset-x-0 bottom-0 bg-[var(--n5-bg-card)]/80 px-4 pb-8 pt-4 backdrop-blur-md">
        <div className="mx-auto max-w-[430px]">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!selectedTech}
            className={`w-full py-4 text-base font-bold font-body transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
              selectedTech ? 'text-[var(--n5-button-primary-text)] shadow-[var(--n5-shadow-sm)]' : 'bg-[var(--n5-border)] text-[var(--n5-ink-muted)]'
            }`}
            style={{
              borderRadius: 'var(--n5-radius-md)',
              background: selectedTech
                ? `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover))`
                : undefined,
            }}
          >
            Continue to Select Time
          </button>
        </div>
      </div>
    </div>
  );
}
