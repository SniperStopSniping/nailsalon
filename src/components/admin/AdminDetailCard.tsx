import type { ReactNode } from 'react';

import { cn } from '@/utils/Helpers';

type AdminDetailCardProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function AdminDetailCard({
  children,
  className,
  contentClassName,
}: AdminDetailCardProps) {
  return (
    <div className={cn('rounded-[16px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)]', className)}>
      <div className={cn('p-4', contentClassName)}>
        {children}
      </div>
    </div>
  );
}
