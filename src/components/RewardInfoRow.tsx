import * as React from 'react';
import { cn } from '@/utils/Helpers';

export interface RewardInfoRowProps {
  points: number;
  message?: string;
  className?: string;
}

export const RewardInfoRow = React.forwardRef<
  HTMLDivElement,
  RewardInfoRowProps
>(({ points, message, className }, ref) => {
  return (
    <div ref={ref} className={cn('py-4', className)}>
      <p className="text-sm font-bold text-neutral-900">
        {message || "Thank you! We'll see you soon 💜"}
      </p>
      <p className="text-[13px] text-neutral-600 mt-1.5">
        You earned {points} points from this visit.
      </p>
    </div>
  );
});
RewardInfoRow.displayName = 'RewardInfoRow';

