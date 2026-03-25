import type { ReactNode } from 'react';

import { cn } from '@/utils/Helpers';

type ListSurfaceProps = {
  children: ReactNode;
  className?: string;
};

export function ListSurface({ children, className }: ListSurfaceProps) {
  return (
    <div className={cn('overflow-hidden rounded-[12px] bg-white shadow-sm', className)}>
      {children}
    </div>
  );
}
