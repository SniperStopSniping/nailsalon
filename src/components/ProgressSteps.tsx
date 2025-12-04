import * as React from 'react';

import { themeVars } from '@/theme';
import { cn } from '@/utils/Helpers';

export type ProgressStepsProps = {
  currentStep: number;
  totalSteps: number;
  stepLabels: string[];
  className?: string;
};

// Use theme variable for muted/pending state color
const pendingColor = themeVars.borderMuted;

/**
 * ProgressSteps Component
 *
 * Multi-step progress indicator. Uses theme CSS variables
 * for completed (primaryDark) and current (accent) step colors.
 */
export const ProgressSteps = React.forwardRef<
  HTMLDivElement,
  ProgressStepsProps
>(({ currentStep, totalSteps, stepLabels, className, ...props }, ref) => {
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
                  isPending && 'bg-transparent',
                )}
                style={{
                  borderColor: isCompleted
                    ? themeVars.primaryDark
                    : isCurrent
                      ? themeVars.accent
                      : pendingColor,
                  backgroundColor: isCompleted
                    ? themeVars.primaryDark
                    : isCurrent
                      ? themeVars.accent
                      : 'transparent',
                  color: isCompleted
                    ? '#171717' // neutral-900
                    : isCurrent
                      ? '#ffffff'
                      : pendingColor,
                }}
              >
                {isCompleted ? '✓' : stepNumber}
              </div>
              {stepLabels[index] && (
                <span
                  className="text-xs font-medium"
                  style={{
                    color: isCurrent
                      ? themeVars.accent
                      : isCompleted
                        ? themeVars.primaryDark
                        : pendingColor,
                  }}
                >
                  {stepLabels[index]}
                </span>
              )}
            </div>
            {index < totalSteps - 1 && (
              <div
                className="h-0.5 flex-1 transition-colors"
                style={{
                  backgroundColor: isCompleted
                    ? themeVars.primaryDark
                    : pendingColor,
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
});
ProgressSteps.displayName = 'ProgressSteps';

