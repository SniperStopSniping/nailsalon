import * as React from 'react';

import { cn } from '@/utils/Helpers';

export type ProgressStepsProps = {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
  className?: string;
};

export const ProgressSteps = React.forwardRef<HTMLDivElement, ProgressStepsProps>(
  ({ currentStep, totalSteps, stepLabels, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('flex items-center justify-between gap-2', className)}
        {...props}
      >
        {Array.from({ length: totalSteps }).map((_, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;
          const isPending = stepNumber > currentStep;

          return (
            <React.Fragment key={stepNumber}>
              <div className="flex flex-1 flex-col items-center gap-2">
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
                    isCompleted &&
                      'border-[#d6a249] bg-[#d6a249] text-neutral-900',
                    isCurrent &&
                      'border-[#7b4ea3] bg-[#7b4ea3] text-white',
                    isPending &&
                      'border-[#d9c6aa] bg-transparent text-[#d9c6aa]',
                  )}
                >
                  {isCompleted ? '✓' : stepNumber}
                </div>
                {stepLabels[index] && (
                  <span
                    className={cn(
                      'text-xs font-medium',
                      isCurrent && 'text-[#7b4ea3]',
                      isCompleted && 'text-[#d6a249]',
                      isPending && 'text-[#d9c6aa]',
                    )}
                  >
                    {stepLabels[index]}
                  </span>
                )}
              </div>
              {index < totalSteps - 1 && (
                <div
                  className={cn(
                    'h-0.5 flex-1 transition-colors',
                    isCompleted ? 'bg-[#d6a249]' : 'bg-[#d9c6aa]',
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  },
);
ProgressSteps.displayName = 'ProgressSteps';

