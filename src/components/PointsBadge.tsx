import * as React from 'react';

import { themeVars } from '@/theme';
import { cn } from '@/utils/Helpers';

export type PointsBadgeProps = {
  points: number;
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * PointsBadge Component
 *
 * Displays points value in a styled badge. Uses theme CSS variables
 * for highlight background and border colors.
 */
export const PointsBadge = React.forwardRef<HTMLDivElement, PointsBadgeProps>(
  ({ points, size = 'sm', className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs',
          'rounded-full font-semibold text-neutral-900',
          className,
        )}
        style={{
          backgroundColor: themeVars.highlightBackground,
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: `color-mix(in srgb, ${themeVars.primaryDark} 30%, transparent)`,
        }}
      >
        {points}
        {' '}
        pts
      </div>
    );
  },
);
PointsBadge.displayName = 'PointsBadge';
