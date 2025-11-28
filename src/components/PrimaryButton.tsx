import * as React from 'react';

import { cn } from '@/utils/Helpers';

import { Button, type ButtonProps } from './ui/button';

export type PrimaryButtonProps = ButtonProps;

export const PrimaryButton = React.forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  ({ className, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        className={cn('bg-[#f4b864] text-neutral-900 hover:bg-[#f4b864]/90', className)}
        {...props}
      />
    );
  },
);
PrimaryButton.displayName = 'PrimaryButton';

