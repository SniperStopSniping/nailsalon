import * as React from 'react';

import { themeVars } from '@/theme';
import { cn } from '@/utils/Helpers';

export type PageLayoutProps = {
  children: React.ReactNode;
  /**
   * Background color override. If not provided, uses theme background.
   * Pass `undefined` to use the theme's default background color.
   */
  background?: string;
  verticalPadding?: 'sm' | 'md' | 'lg';
  className?: string;
};

/**
 * PageLayout Component
 *
 * Consistent page container wrapper. Uses theme CSS variable for
 * background color by default, supporting multi-tenant theming.
 */
export const PageLayout = React.forwardRef<HTMLDivElement, PageLayoutProps>(
  ({ children, background, verticalPadding = 'md', className }, ref) => {
    const paddingClasses = {
      sm: 'pt-4 pb-6',
      md: 'pt-6 pb-10',
      lg: 'pt-8 pb-12',
    };

    // Use provided background or fall back to theme variable
    const bgColor = background ?? themeVars.background;

    return (
      <div
        ref={ref}
        className={cn(
          'min-h-screen flex justify-center',
          paddingClasses[verticalPadding],
          className,
        )}
        style={{ backgroundColor: bgColor }}
      >
        <div className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4">
          {children}
        </div>
      </div>
    );
  },
);
PageLayout.displayName = 'PageLayout';
