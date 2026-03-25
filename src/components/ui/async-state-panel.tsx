import type { ReactNode } from 'react';

import { cn } from '@/utils/Helpers';

import { SectionCard } from './section-card';

type AsyncStateTone = 'neutral' | 'error' | 'warning';

const toneClasses: Record<AsyncStateTone, string> = {
  neutral: '',
  error: 'border-red-200 bg-red-50',
  warning: 'border-amber-200 bg-amber-50',
};

type AsyncStatePanelProps = {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: AsyncStateTone;
  loading?: boolean;
  action?: ReactNode;
  className?: string;
};

export function AsyncStatePanel({
  title,
  description,
  icon,
  tone = 'neutral',
  loading = false,
  action,
  className,
}: AsyncStatePanelProps) {
  return (
    <SectionCard
      className={cn('text-center', toneClasses[tone], className)}
      contentClassName="space-y-3 py-8"
    >
      {loading ? (
        <div className="mx-auto size-8 animate-spin rounded-full border-4 border-neutral-300 border-t-neutral-600" />
      ) : icon ? (
        <div className="text-4xl">{icon}</div>
      ) : null}
      <div className="space-y-1">
        <p className="text-lg font-semibold text-neutral-900">{title}</p>
        {description && <div className="text-sm leading-6 text-neutral-500">{description}</div>}
      </div>
      {action}
    </SectionCard>
  );
}
