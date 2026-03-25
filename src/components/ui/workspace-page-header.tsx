import type { ReactNode } from 'react';

import { cn } from '@/utils/Helpers';

type WorkspacePageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
};

export function WorkspacePageHeader({
  title,
  subtitle,
  leading,
  actions,
  className,
  titleClassName,
  subtitleClassName,
}: WorkspacePageHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          <h1 className={cn('text-2xl font-semibold tracking-tight text-neutral-900', titleClassName)}>
            {title}
          </h1>
          {subtitle && (
            <div className={cn('mt-0.5 text-sm text-neutral-500', subtitleClassName)}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
