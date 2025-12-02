import * as React from 'react';
import { cn } from '@/utils/Helpers';

export interface PointsBadgeProps {
  points: number;
  size?: 'sm' | 'md';
  className?: string;
}

export const PointsBadge = React.forwardRef<HTMLDivElement, PointsBadgeProps>(
  ({ points, size = 'sm', className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          size === 'md'
            ? 'px-3 py-1.5 text-sm'
            : 'px-2.5 py-1 text-xs',
          'rounded-full bg-[#fef9e7] border border-[#d6a249]/30 font-semibold text-neutral-900',
          className
        )}
      >
        {points} pts
      </div>
    );
  }
);
PointsBadge.displayName = 'PointsBadge';

