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
    <div className={cn('min-w-0 rounded-owner-card border border-[var(--owner-line)] bg-[var(--owner-surface)] shadow-owner-card', className)}>
      <div className={cn('p-4', contentClassName)}>
        {children}
      </div>
    </div>
  );
}
