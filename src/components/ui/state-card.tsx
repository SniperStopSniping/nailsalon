import * as React from 'react';

import { cn } from '@/utils/Helpers';

import { Card, CardContent } from './card';

type StateTone = 'neutral' | 'warning' | 'error' | 'success';

const toneClasses: Record<StateTone, string> = {
  neutral: 'border-[var(--theme-card-border)] bg-white text-neutral-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-green-200 bg-green-50 text-green-900',
};

const descriptionClasses: Record<StateTone, string> = {
  neutral: 'text-neutral-500',
  warning: 'text-amber-700',
  error: 'text-red-700',
  success: 'text-green-700',
};

type StateCardProps = {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  tone?: StateTone;
  className?: string;
  contentClassName?: string;
};

export function StateCard({
  title,
  description,
  icon,
  action,
  tone = 'neutral',
  className,
  contentClassName,
}: StateCardProps) {
  return (
    <Card className={cn('text-center', toneClasses[tone], className)}>
      <CardContent className={cn('space-y-2 py-6', contentClassName)}>
        {icon && <div className="text-2xl">{icon}</div>}
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && (
            <div className={cn('text-sm leading-6', descriptionClasses[tone])}>
              {description}
            </div>
          )}
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
