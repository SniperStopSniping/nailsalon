import * as React from 'react';
import { cn } from '@/utils/Helpers';

export interface PageLayoutProps {
  children: React.ReactNode;
  background?: string;
  verticalPadding?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const PageLayout = React.forwardRef<HTMLDivElement, PageLayoutProps>(
  (
    {
      children,
      background = '#f6ebdd',
      verticalPadding = 'md',
      className,
    },
    ref
  ) => {
    const paddingClasses = {
      sm: 'pt-4 pb-6',
      md: 'pt-6 pb-10',
      lg: 'pt-8 pb-12',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'min-h-screen flex justify-center',
          paddingClasses[verticalPadding],
          className
        )}
        style={{ backgroundColor: background }}
      >
        <div className="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-4">
          {children}
        </div>
      </div>
    );
  }
);
PageLayout.displayName = 'PageLayout';

