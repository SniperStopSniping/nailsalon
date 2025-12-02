import * as React from 'react';
import { cn } from '@/utils/Helpers';

export interface SectionTitleProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export const SectionTitle = React.forwardRef<HTMLDivElement, SectionTitleProps>(
  ({ children, icon, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('flex items-center gap-2 mb-3 px-1', className)}
      >
        {icon && <div className="text-[#d6a249]">{icon}</div>}
        <h3 className="text-base font-semibold text-neutral-900">{children}</h3>
      </div>
    );
  }
);
SectionTitle.displayName = 'SectionTitle';

