import { type ReactNode } from 'react';

import type { BookingStep } from '@/libs/bookingFlow';
import { getStepIndex, getStepLabel } from '@/libs/bookingFlow';
import { themeVars } from '@/theme';

type BookingStepHeaderProps = {
  salonName: string;
  mounted: boolean;
  title: string;
  description?: ReactNode;
  bookingFlow: BookingStep[];
  currentStep: BookingStep;
  isFirstStep: boolean;
  onBack?: () => void;
  className?: string;
};

export function BookingStepHeader({
  salonName,
  mounted,
  title,
  description,
  bookingFlow,
  currentStep,
  isFirstStep,
  onBack,
  className,
}: BookingStepHeaderProps) {
  const currentIdx = getStepIndex(currentStep, bookingFlow);

  return (
    <div className={className}>
      <div
        className="relative flex items-center pb-4 pt-6"
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
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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

      <div
        className="mb-5 flex items-center justify-center gap-2"
        style={{
          opacity: mounted ? 1 : 0,
          transition: 'opacity 300ms ease-out 50ms',
        }}
      >
        {bookingFlow.map((step, i) => {
          const isCurrentStep = step === currentStep;
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

      <div
        className="mb-5 text-center"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(10px)',
          transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
        }}
      >
        <h1 className="text-2xl font-bold text-neutral-900">{title}</h1>
        {description && <div className="mt-1 text-sm text-neutral-500">{description}</div>}
      </div>
    </div>
  );
}
