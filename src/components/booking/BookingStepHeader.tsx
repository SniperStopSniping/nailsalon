import { Playfair_Display } from 'next/font/google';
import { type ReactNode } from 'react';

import type { BookingStep } from '@/libs/bookingFlow';
import { getStepIndex, getStepLabel } from '@/libs/bookingFlow';
import { themeVars } from '@/theme';

type BookingStepHeaderProps = {
  salonName: string;
  mounted: boolean;
  title: string;
  description?: ReactNode;
  announcement?: ReactNode;
  bookingFlow: BookingStep[];
  currentStep: BookingStep;
  isFirstStep: boolean;
  onBack?: () => void;
  className?: string;
  salonNameVariant?: 'default' | 'editorial';
};

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

export function BookingStepHeader({
  salonName,
  mounted,
  title,
  description,
  announcement,
  bookingFlow,
  currentStep,
  isFirstStep,
  onBack,
  className,
  salonNameVariant = 'default',
}: BookingStepHeaderProps) {
  const currentIdx = getStepIndex(currentStep, bookingFlow);
  const isEditorialSalonName = salonNameVariant === 'editorial';

  return (
    <div className={className} data-testid="booking-step-header">
      <div
        className="relative flex items-center pb-1 pt-4"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
          transition: 'opacity 300ms ease-out, transform 300ms ease-out',
        }}
      >
        {!isFirstStep && onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back"
            className="z-10 flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <div
          data-testid="booking-salon-name"
          className={`${
            isEditorialSalonName
              ? `${playfairDisplay.className} text-[1.36rem] font-normal tracking-[0.05em] sm:text-[1.58rem]`
              : 'text-base font-semibold tracking-tight sm:text-lg'
          } ${isFirstStep ? 'w-full text-center' : 'absolute left-1/2 -translate-x-1/2'} leading-none`}
          style={{ color: themeVars.accent }}
        >
          {salonName}
        </div>
      </div>

      {announcement && (
        <div
          data-testid="booking-step-announcement"
          className="mb-2 flex justify-center"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 35ms',
          }}
        >
          {announcement}
        </div>
      )}

      <div
        className="mb-3 flex items-center justify-center gap-1.5"
        style={{
          opacity: mounted ? 1 : 0,
          transition: 'opacity 300ms ease-out 50ms',
        }}
      >
        {bookingFlow.map((step, i) => {
          const isCurrentStep = step === currentStep;
          const isPastStep = i + 1 < currentIdx;
          return (
            <div key={step} className="flex items-center gap-1.5">
              <div className={`flex items-center gap-1 ${isCurrentStep ? 'opacity-100' : 'opacity-40'}`}>
                <div
                  data-testid={`booking-step-marker-${step}`}
                  className="flex size-5 items-center justify-center rounded-full text-[10px] font-semibold leading-none sm:size-6 sm:text-xs"
                  style={{
                    backgroundColor: isPastStep ? themeVars.accent : isCurrentStep ? themeVars.primary : '#d4d4d4',
                    color: isPastStep ? 'white' : isCurrentStep ? '#171717' : '#525252',
                  }}
                >
                  {isPastStep ? '✓' : i + 1}
                </div>
                <span
                  data-testid={`booking-step-label-${step}`}
                  className={`text-[10px] font-medium leading-none tracking-tight sm:text-xs ${isCurrentStep ? 'text-neutral-900' : 'text-neutral-500'}`}
                >
                  {getStepLabel(step)}
                </span>
              </div>
              {i < bookingFlow.length - 1 && <div className="h-px w-3 bg-neutral-300 sm:w-4" />}
            </div>
          );
        })}
      </div>

      <div
        className="mb-4 text-center"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(10px)',
          transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
        }}
      >
        <h1 className="text-[1.7rem] font-bold tracking-tight text-neutral-900 sm:text-2xl">{title}</h1>
        {description && <div className="mt-0.5 text-[13px] leading-[1.35] text-neutral-500 sm:text-sm">{description}</div>}
      </div>
    </div>
  );
}
