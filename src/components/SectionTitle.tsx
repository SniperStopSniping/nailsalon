import * as React from 'react';

import { themeVars } from '@/theme';
import { cn } from '@/utils/Helpers';

export type SectionTitleProps = {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
};

/**
 * SectionTitle Component
 *
 * Section headers within cards or pages. Uses theme CSS variable
 * for icon color (primaryDark) to match brand identity.
 */
export const SectionTitle = React.forwardRef<HTMLDivElement, SectionTitleProps>(
  ({ children, icon, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('flex items-center gap-2 mb-3 px-1', className)}
      >
        {icon && (
          <div style={{ color: themeVars.primaryDark }}>{icon}</div>
        )}
        <h3 className="text-base font-semibold text-neutral-900">{children}</h3>
      </div>
    );
  },
);
SectionTitle.displayName = 'SectionTitle';
