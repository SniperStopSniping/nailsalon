import * as React from 'react';
import { cn } from '@/utils/Helpers';

export interface SummaryRowProps {
  label: string;
  value: string | React.ReactNode;
  highlight?: boolean;
  className?: string;
}

export const SummaryRow = React.forwardRef<HTMLDivElement, SummaryRowProps>(
  ({ label, value, highlight = false, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex justify-between items-start',
          highlight
            ? 'bg-[#fef9e7] rounded px-2 py-1.5 -mx-2 transition-all duration-500'
            : '',
          className
        )}
      >
        <div className="text-sm text-neutral-500 font-medium">{label}</div>
        <div className="text-base font-semibold text-neutral-900 text-right">
          {value}
        </div>
      </div>
    );
  }
);
SummaryRow.displayName = 'SummaryRow';

