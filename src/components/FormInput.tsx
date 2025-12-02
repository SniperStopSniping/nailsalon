import * as React from 'react';
import { cn } from '@/utils/Helpers';

export interface FormInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ error = false, className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'flex-1 rounded-full bg-neutral-50 border border-neutral-200 px-4 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-[#d6a249] focus:ring-1 focus:ring-[#d6a249] transition-all',
          error ? 'border-red-500' : '',
          className
        )}
        {...props}
      />
    );
  }
);
FormInput.displayName = 'FormInput';

