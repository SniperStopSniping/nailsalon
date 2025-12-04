import * as React from 'react';

import { themeVars } from '@/theme';
import { cn } from '@/utils/Helpers';

export interface SummaryRowProps {
  label: string;
  value: string | React.ReactNode;
  highlight?: boolean;
  className?: string;
}

/**
 * SummaryRow Component
 *
 * Two-column layout for displaying label-value pairs (receipt-style).
 * Uses theme CSS variable for highlight background.
 */
export const SummaryRow = React.forwardRef<HTMLDivElement, SummaryRowProps>(
  ({ label, value, highlight = false, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex justify-between items-start',
          highlight ? 'rounded px-2 py-1.5 -mx-2 transition-all duration-500' : '',
          className,
        )}
        style={highlight ? { backgroundColor: themeVars.highlightBackground } : undefined}
      >
        <div className="text-sm text-neutral-500 font-medium">{label}</div>
        <div className="text-base font-semibold text-neutral-900 text-right">
          {value}
        </div>
      </div>
    );
  },
);
SummaryRow.displayName = 'SummaryRow';
