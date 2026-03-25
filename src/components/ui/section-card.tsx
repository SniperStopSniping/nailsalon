import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/utils/Helpers';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './card';

type SectionCardProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  style?: CSSProperties;
};

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  headerClassName,
  style,
}: SectionCardProps) {
  return (
    <Card className={className} style={style}>
      {(title || description || actions) && (
        <CardHeader className={cn('flex-row items-start justify-between gap-4 pb-3', headerClassName)}>
          <div className="min-w-0 flex-1">
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription className="mt-1">{description}</CardDescription>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className={cn(title || description || actions ? 'pt-0' : '', contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
