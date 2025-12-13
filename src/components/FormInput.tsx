import * as React from 'react';

import { themeVars } from '@/theme';
import { cn } from '@/utils/Helpers';

export type FormInputProps = {
  error?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>;

/**
 * FormInput Component
 *
 * Text input field with consistent styling. Uses theme CSS variable
 * for focus ring/border color (primaryDark) to match brand.
 */
export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ error = false, className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          `flex-1 rounded-full bg-neutral-50 border border-neutral-200 px-4 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-[${themeVars.primaryDark}] focus:ring-1 focus:ring-[${themeVars.primaryDark}] transition-all`,
          error ? 'border-red-500' : '',
          className,
        )}
        {...props}
      />
    );
  },
);
FormInput.displayName = 'FormInput';
